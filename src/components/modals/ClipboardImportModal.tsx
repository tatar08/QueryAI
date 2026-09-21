import { useState, useEffect, useCallback, useMemo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Clipboard,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Upload,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Rows,
  Table2,
  FileText,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { useDatabase } from '../../hooks/useDatabase';
import { useSettings } from '../../hooks/useSettings';
import { SchemaEditor, type SchemaColumn } from './ClipboardImport/SchemaEditor';
import { DataPreview } from './ClipboardImport/DataPreview';
import { TableNameInput } from './ClipboardImport/TableNameInput';
import { ParseSummary } from './ClipboardImport/ParseSummary';
import { ModeToggle } from './ClipboardImport/ModeToggle';
import { useDataTypes } from '../../hooks/useDataTypes';
import type { TableColumn } from '../../utils/sqlGenerator';
import {
  parseClipboardText,
  reParseWithHeaderOption,
  parseMultipleFiles,
  parseMultipleFilesWithSchemas,
  detectFileColumnCounts,
  type ParsedClipboardData,
  type InferredColumn,
  type FileImportSource,
} from '../../utils/clipboardParser';

type ImportMode = 'create' | 'append';
type IfExistsStrategy = 'fail' | 'append' | 'replace';
type ImportSource = 'clipboard' | 'files';

interface ClipboardImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ImportResult {
  rows_inserted: number;
  table_created: boolean;
}

export function ClipboardImportModal({ isOpen, onClose, onSuccess }: ClipboardImportModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const warningsId = useId();
  const { activeConnectionId, activeDriver, activeSchema } = useDatabase();
  const { settings } = useSettings();
  const { dataTypes } = useDataTypes(activeDriver ?? undefined);

  const [rawText, setRawText] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedClipboardData | null>(null);
  const [columns, setColumns] = useState<SchemaColumn[]>([]);
  const [tableName, setTableName] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('create');
  const [ifExists, setIfExists] = useState<IfExistsStrategy>('fail');
  const [existingTables, setExistingTables] = useState<string[]>([]);
  const [maximizedPane, setMaximizedPane] = useState<'schema' | 'preview' | null>(null);
  const [targetColumns, setTargetColumns] = useState<TableColumn[]>([]);

  const [importSource, setImportSource] = useState<ImportSource>('clipboard');
  const [importedFiles, setImportedFiles] = useState<FileImportSource[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  // Populated when picked files span more than one column-count shape (e.g. a
  // 15-column export mixed with a 14-column one) — lets the user name each
  // shape's columns explicitly instead of merging them by raw position.
  const [fileShapes, setFileShapes] = useState<Map<number, string[]> | null>(null);
  const [shapeNamesInput, setShapeNamesInput] = useState<Record<number, string>>({});
  // Collapsed once names are applied, since the panel is tall and (once set
  // up) rarely needs revisiting — keeping it open otherwise squeezes the
  // Review & Adjust section down to a couple of visible rows.
  const [shapesCollapsed, setShapesCollapsed] = useState(false);

  const [isLoadingClipboard, setIsLoadingClipboard] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ImportResult | null>(null);
  const [warningsExpanded, setWarningsExpanded] = useState(false);

  const toSchemaColumns = useCallback(
    async (inferred: InferredColumn[]): Promise<SchemaColumn[]> => {
      const base = inferred.map((c, i) => ({
        name: c.name,
        sqlType: c.sqlType,
        nullable: c.nullable,
        confidence: c.confidence,
        sampleValues: c.sampleValues,
        originalIndex: i,
        targetColumn: null as string | null,
      }));
      if (!activeDriver || inferred.length === 0) return base;
      try {
        const mapped = await invoke<string[]>('map_inferred_column_types', {
          driver: activeDriver,
          kinds: inferred.map((c) => c.sqlType),
        });
        return base.map((c, i) => ({ ...c, sqlType: mapped[i] ?? c.sqlType }));
      } catch {
        return base;
      }
    },
    [activeDriver],
  );

  const tableExists = existingTables.some(
    (t) => t.toLowerCase() === tableName.toLowerCase() && tableName !== ''
  );

  const readClipboard = useCallback(async () => {
    setIsLoadingClipboard(true);
    setError(null);
    setSuccess(null);
    try {
      const text = await readText();
      if (!text || !text.trim()) {
        setError(t('clipboardImport.noData'));
        setParsed(null);
        return;
      }
      setRawText(text);
      const result = parseClipboardText(text);
      setParsed(result);
      const mapped = await toSchemaColumns(result.inferredColumns);
      setColumns(mapped);
    } catch {
      setError(t('clipboardImport.noData'));
    } finally {
      setIsLoadingClipboard(false);
    }
  }, [t, toSchemaColumns]);

  // Lets the user pick one or more CSV/TXT files from disk. When several are
  // picked, their rows are merged into one dataset with a trailing column
  // recording each row's originating file name (parseMultipleFiles).
  const pickAndImportFiles = useCallback(async () => {
    setError(null);
    setSuccess(null);
    try {
      const picked = await open({
        multiple: true,
        filters: [{ name: 'CSV / Text', extensions: ['csv', 'txt', 'tsv'] }],
      });
      if (!picked) return;
      const filePaths = Array.isArray(picked) ? picked : [picked];
      if (filePaths.length === 0) return;

      setIsLoadingFiles(true);
      const files: FileImportSource[] = await Promise.all(
        filePaths.map(async (p) => ({
          name: p.split(/[\\/]/).pop() ?? p,
          text: await readTextFile(p),
        })),
      );
      setImportedFiles(files);
      const shapes = detectFileColumnCounts(files);
      // Always offer the naming panel, even for a single shape — it's the
      // only way to name headerless-file columns properly; "First row as
      // header" would otherwise pick up an actual data row as headers.
      setFileShapes(shapes);
      setShapeNamesInput({});
      setShapesCollapsed(false);
      const result = parseMultipleFiles(files);
      setParsed(result);
      const mapped = await toSchemaColumns(result.inferredColumns);
      setColumns(mapped);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t('clipboardImport.fileReadError', { defaultValue: 'Failed to read selected files' }),
      );
    } finally {
      setIsLoadingFiles(false);
    }
  }, [t, toSchemaColumns]);

  // Re-merges the picked files using the per-shape column names the user typed
  // into fileShapes' inputs, aligning rows by name instead of raw position.
  const applyNamedSchemas = useCallback(async () => {
    if (!fileShapes) return;
    const namesByCount: Record<number, string[]> = {};
    for (const count of fileShapes.keys()) {
      const raw = shapeNamesInput[count]?.trim();
      if (!raw) continue;
      namesByCount[count] = raw.split(',').map((n) => n.trim()).filter(Boolean);
    }
    if (Object.keys(namesByCount).length === 0) return;
    const result = parseMultipleFilesWithSchemas(importedFiles, namesByCount);
    setParsed(result);
    const mapped = await toSchemaColumns(result.inferredColumns);
    setColumns(mapped);
    setShapesCollapsed(true);
  }, [fileShapes, shapeNamesInput, importedFiles, toSchemaColumns]);

  // Load existing tables for conflict detection
  const loadTables = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const tables = await invoke<{ name: string }[]>('get_tables', {
        connectionId: activeConnectionId,
        ...(activeSchema ? { schema: activeSchema } : {}),
      });
      setExistingTables(tables.map((t) => t.name));
    } catch {
      // Non-critical
    }
  }, [activeConnectionId, activeSchema]);

  useEffect(() => {
    if (isOpen) {
      setTableName('');
      setError(null);
      setSuccess(null);
      setImportMode('create');
      setIfExists('fail');
      setWarningsExpanded(false);
      setMaximizedPane(null);
      setTargetColumns([]);
      setImportSource('clipboard');
      setImportedFiles([]);
      setFileShapes(null);
      setShapeNamesInput({});
      readClipboard();
      loadTables();
    }
  }, [isOpen, readClipboard, loadTables]);

  // Fetch columns of the existing target table when append mode is active.
  useEffect(() => {
    if (importMode !== 'append' || !tableExists || !activeConnectionId) {
      setTargetColumns([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cols = await invoke<TableColumn[]>('get_columns', {
          connectionId: activeConnectionId,
          tableName: tableName.trim(),
          schema: activeSchema ?? null,
        });
        if (!cancelled) setTargetColumns(cols);
      } catch {
        if (!cancelled) setTargetColumns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [importMode, tableExists, tableName, activeConnectionId, activeSchema]);

  // Auto-map parsed columns to target columns by name (case-insensitive) when
  // entering append mode or when the target column list changes.
  useEffect(() => {
    if (importMode !== 'append' || targetColumns.length === 0) return;
    const lookup = new Map(targetColumns.map((c) => [c.name.toLowerCase(), c.name]));
    setColumns((prev) =>
      prev.map((c) => ({
        ...c,
        targetColumn: c.targetColumn ?? lookup.get(c.name.toLowerCase()) ?? null,
      }))
    );
  }, [importMode, targetColumns]);

  // Auto-switch mode when table already exists
  useEffect(() => {
    if (tableExists && importMode === 'create') {
      setIfExists('append');
    }
  }, [tableExists, importMode]);

  const handleColumnChange = useCallback(
    (index: number, patch: Partial<SchemaColumn>) => {
      setColumns((prev) =>
        prev.map((col, i) => (i === index ? { ...col, ...patch } : col))
      );
    },
    []
  );

  const handleDeleteColumns = useCallback((indices: number[]) => {
    const toRemove = new Set(indices);
    setColumns((prev) => prev.filter((_, i) => !toRemove.has(i)));
  }, []);

  const visibleHeaders = useMemo(() => columns.map((c) => c.name), [columns]);
  const visibleRows = useMemo(() => {
    if (!parsed) return [] as string[][];
    return parsed.rows.map((row) => columns.map((c) => row[c.originalIndex] ?? ''));
  }, [parsed, columns]);

  const handleHeaderToggle = useCallback(
    async (hasHeader: boolean) => {
      if (importSource === 'files') {
        if (importedFiles.length === 0) return;
        const reparsed = parseMultipleFiles(importedFiles, { hasHeaderRow: hasHeader });
        setParsed(reparsed);
        const mapped = await toSchemaColumns(reparsed.inferredColumns);
        setColumns(mapped);
        return;
      }
      if (!parsed || !rawText) return;
      const reparsed = reParseWithHeaderOption(rawText, hasHeader, parsed);
      setParsed(reparsed);
      const mapped = await toSchemaColumns(reparsed.inferredColumns);
      setColumns(mapped);
    },
    [importSource, importedFiles, parsed, rawText, toSchemaColumns]
  );

  const handleAiSuggest = useCallback(async () => {
    if (!settings.aiProvider || !parsed) return;
    setIsAiLoading(true);
    try {
      const name = await invoke<string>('suggest_table_name', {
        req: {
          provider: settings.aiProvider,
          model: settings.aiModel || '',
          headers: parsed.headers,
          sample_rows: parsed.rows.slice(0, 3).map((r) =>
            r.map((cell) => (cell === '' ? 'NULL' : cell))
          ),
        },
      });
      if (name) setTableName(name);
    } catch {
      // Silently fail AI suggestion
    } finally {
      setIsAiLoading(false);
    }
  }, [settings, parsed]);

  const handleImport = useCallback(async () => {
    if (!activeConnectionId || !parsed || !tableName.trim() || columns.length === 0) return;

    setIsImporting(true);
    setError(null);
    setSuccess(null);

    try {
      // In append mode, keep columns mapped to an existing target OR flagged
      // as new (to be created via ALTER TABLE). In create mode, keep all.
      const activeColumns =
        importMode === 'append'
          ? columns.filter((c) => c.isNewColumn || c.targetColumn)
          : columns;

      const resolvedName = (col: SchemaColumn) =>
        importMode === 'append'
          ? (col.isNewColumn ? col.name : (col.targetColumn as string))
          : col.name;

      const colDefs = activeColumns.map((col) => ({
        name: resolvedName(col),
        data_type: col.sqlType,
        is_nullable: col.nullable,
        is_pk: false,
        is_auto_increment: false,
        default_value: null,
      }));

      const addColumns =
        importMode === 'append'
          ? columns
              .filter((c) => c.isNewColumn)
              .map((col) => ({
                name: col.name,
                data_type: col.sqlType,
                is_nullable: col.nullable,
                is_pk: false,
                is_auto_increment: false,
                default_value: null,
              }))
          : [];

      const rows = parsed.rows.map((row) =>
        activeColumns.map((col) => {
          const cell = row[col.originalIndex];
          return cell === '' || cell === undefined ? null : cell;
        })
      );

      const result = await invoke<ImportResult>('execute_clipboard_import', {
        req: {
          connection_id: activeConnectionId,
          table_name: tableName.trim(),
          schema: activeSchema ?? null,
          columns: colDefs,
          rows,
          create_table: importMode === 'create',
          if_exists: tableExists ? ifExists : 'fail',
          add_columns: addColumns,
        },
      });

      setSuccess(result);
      onSuccess();
    } catch (e) {
      setError(String(e));
    } finally {
      setIsImporting(false);
    }
  }, [activeConnectionId, parsed, tableName, columns, importMode, ifExists, tableExists, activeSchema, onSuccess]);

  const mappedColumnsCount =
    importMode === 'append'
      ? columns.filter((c) => c.isNewColumn || c.targetColumn).length
      : columns.length;
  const appendModeBlocked = importMode === 'append' && !tableExists;
  const selectedModeHint =
    importMode === 'append'
      ? t('clipboardImport.modeAppendHint')
      : t('clipboardImport.modeCreateHint');
  const describedBy = [descriptionId, error ? errorId : null, parsed?.warnings.length ? warningsId : null]
    .filter(Boolean)
    .join(' ');
  const canImport =
    !!parsed &&
    parsed.rowCount > 0 &&
    tableName.trim() !== '' &&
    mappedColumnsCount > 0 &&
    !appendModeBlocked &&
    !isImporting;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] px-4 py-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy || undefined}
        aria-busy={isLoadingClipboard || isImporting}
        className="bg-elevated rounded-xl shadow-2xl w-full max-w-[1040px] border border-strong flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="relative flex items-start justify-between gap-4 px-5 py-4 border-b border-default bg-gradient-to-br from-indigo-900/20 via-base to-base">
          <div className="flex min-w-0 flex-1 gap-3">
            <div className="bg-indigo-500/15 p-2.5 rounded-lg ring-1 ring-indigo-400/20 shadow-inner shrink-0">
              <Clipboard className="text-indigo-300" size={20} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-semibold text-primary leading-tight">
                  {importSource === 'files'
                    ? t('clipboardImport.titleFiles', { defaultValue: 'Import from File(s)' })
                    : t('clipboardImport.title')}
                </h2>
                <p id={descriptionId} className="text-[11px] text-muted leading-relaxed">
                  {importSource === 'files'
                    ? t('clipboardImport.subtitleFiles', {
                        defaultValue:
                          'Pick one or more CSV/TXT files. When several are selected, rows are merged and a "source_file" column is appended.',
                      })
                    : t('clipboardImport.subtitle')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-0.5 bg-surface-secondary border border-default rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setImportSource('clipboard')}
                    className={`px-2.5 py-1 text-[11px] rounded-md flex items-center gap-1.5 transition-colors ${
                      importSource === 'clipboard'
                        ? 'bg-base text-primary border border-strong'
                        : 'text-secondary hover:bg-surface-tertiary border border-transparent'
                    }`}
                  >
                    <Clipboard size={12} />
                    {t('clipboardImport.sourceClipboard', { defaultValue: 'Clipboard' })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportSource('files')}
                    className={`px-2.5 py-1 text-[11px] rounded-md flex items-center gap-1.5 transition-colors ${
                      importSource === 'files'
                        ? 'bg-base text-primary border border-strong'
                        : 'text-secondary hover:bg-surface-tertiary border border-transparent'
                    }`}
                  >
                    <FileText size={12} />
                    {t('clipboardImport.sourceFiles', { defaultValue: 'File(s)' })}
                  </button>
                </div>
                {importSource === 'files' && (
                  <button
                    type="button"
                    onClick={pickAndImportFiles}
                    disabled={isLoadingFiles}
                    className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-1 text-[11px] text-indigo-200 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
                  >
                    {isLoadingFiles ? (
                      <Loader2 size={12} className="animate-spin shrink-0" />
                    ) : (
                      <Upload size={12} className="shrink-0" />
                    )}
                    {importedFiles.length > 0
                      ? t('clipboardImport.chooseFilesAgain', { defaultValue: 'Choose files...' })
                      : t('clipboardImport.chooseFiles', { defaultValue: 'Choose CSV/TXT files...' })}
                  </button>
                )}
                {importSource === 'files' && importedFiles.length > 0 && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-default bg-base/70 px-2.5 py-1 text-[11px] text-secondary">
                    <FileText size={12} className="text-blue-400 shrink-0" />
                    <span className="text-primary font-medium">{importedFiles.length}</span>
                    <span>{t('clipboardImport.filesLabel', { defaultValue: 'file(s)' })}</span>
                  </div>
                )}
                {importSource === 'clipboard' && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-1 text-[11px] text-indigo-200">
                    <Clipboard size={12} className="shrink-0" />
                    <span>{selectedModeHint}</span>
                  </div>
                )}
                {parsed && (
                  <>
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-default bg-base/70 px-2.5 py-1 text-[11px] text-secondary">
                      <Table2 size={12} className="text-blue-400 shrink-0" />
                      <span className="text-primary font-medium">{columns.length}</span>
                      <span>{t('clipboardImport.columnsLabel')}</span>
                    </div>
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-default bg-base/70 px-2.5 py-1 text-[11px] text-secondary">
                      <Rows size={12} className="text-green-400 shrink-0" />
                      <span className="text-primary font-medium">{parsed.rowCount}</span>
                      <span>{t('clipboardImport.rowsLabel')}</span>
                    </div>
                    {parsed.warnings.length > 0 && (
                      <div className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-[11px] text-yellow-300">
                        <AlertTriangle size={12} className="shrink-0" />
                        <span>{t('clipboardImport.warningsCount', { count: parsed.warnings.length })}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="text-muted hover:text-primary transition-colors p-1.5 rounded-md hover:bg-surface-secondary/50 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col p-4 md:p-5 gap-4 min-h-0">
          {importSource === 'files' && importedFiles.length === 0 && !isLoadingFiles ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
              <Upload size={32} className="text-muted" />
              <p className="text-sm text-secondary max-w-md">
                {t('clipboardImport.noFilesSelected', {
                  defaultValue: 'Choose one or more CSV/TXT files to import.',
                })}
              </p>
              <button
                type="button"
                onClick={pickAndImportFiles}
                className="text-xs text-blue-400 hover:underline"
              >
                {t('clipboardImport.chooseFiles', { defaultValue: 'Choose CSV/TXT files...' })}
              </button>
            </div>
          ) : isLoadingClipboard || isLoadingFiles ? (
            <div className="flex items-center justify-center h-40 gap-3 text-secondary">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">{t('common.loading')}</span>
            </div>
          ) : error && !parsed ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
              <AlertTriangle size={32} className="text-yellow-400" />
              <p className="text-sm text-secondary">{error}</p>
              <button
                type="button"
                onClick={importSource === 'files' ? pickAndImportFiles : readClipboard}
                className="text-xs text-blue-400 hover:underline"
              >
                {t('clipboardImport.retry')}
              </button>
            </div>
          ) : success ? (
            <SuccessState result={success} tableName={tableName} onClose={onClose} />
          ) : parsed ? (
            <>
              {fileShapes && (
                <section className="flex flex-col gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 md:p-4 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShapesCollapsed((v) => !v)}
                    className="flex items-center gap-2 text-yellow-300"
                  >
                    {shapesCollapsed ? <ChevronRight size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
                    <AlertTriangle size={14} className="shrink-0" />
                    <span className="text-xs font-semibold">
                      {fileShapes.size > 1
                        ? t('clipboardImport.multipleShapesTitle', {
                            defaultValue: 'Selected files have {{count}} different column layouts',
                            count: fileShapes.size,
                          })
                        : t('clipboardImport.nameColumnsTitle', {
                            defaultValue: 'Name the columns for these headerless files',
                          })}
                    </span>
                  </button>
                  {!shapesCollapsed && (
                    <>
                      <p className="text-[11px] text-yellow-200/80">
                        {fileShapes.size > 1
                          ? t('clipboardImport.multipleShapesHint', {
                              defaultValue:
                                'Merging by raw column position can be wrong when the same column number means different things across layouts. Name each layout\u2019s columns (comma-separated) to align rows by name instead.',
                            })
                          : t('clipboardImport.nameColumnsHint', {
                              defaultValue:
                                'These files have no header row, so columns are named col_1, col_2, ... by default. Type real names (comma-separated) instead of ticking "First row as header", which would otherwise use an actual data row as the column names.',
                            })}
                      </p>
                      {[...fileShapes.entries()].map(([count, fileNames]) => (
                        <div key={count} className="flex flex-col gap-1">
                          <label className="text-[11px] text-secondary">
                            {t('clipboardImport.shapeLabel', {
                              defaultValue: '{{count}} columns \u2014 {{n}} file(s), e.g. "{{example}}"',
                              count,
                              n: fileNames.length,
                              example: fileNames[0],
                            })}
                          </label>
                          <input autoCorrect="off" autoCapitalize="off" autoComplete="off" spellCheck={false}
                            value={shapeNamesInput[count] ?? ''}
                            onChange={(e) =>
                              setShapeNamesInput((prev) => ({ ...prev, [count]: e.target.value }))
                            }
                            placeholder={t('clipboardImport.shapeNamesPlaceholder', {
                              defaultValue: 'col1, col2, col3, ...',
                            })}
                            className="w-full bg-base border border-strong rounded px-2 py-1.5 text-xs font-mono text-primary focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={applyNamedSchemas}
                        className="self-start px-3 py-1.5 text-xs bg-yellow-900/30 hover:bg-yellow-900/50 border border-yellow-800/40 text-yellow-200 rounded transition-colors"
                      >
                        {t('clipboardImport.applyShapeNames', { defaultValue: 'Apply names & re-merge' })}
                      </button>
                    </>
                  )}
                </section>
              )}

              <ParseSummary
                format={parsed.format}
                rowCount={parsed.rowCount}
                columnCount={columns.length}
                activeDriver={activeDriver}
                hasHeaderRow={parsed.hasHeaderRow}
                onToggleHeader={handleHeaderToggle}
              />

              <section className="flex flex-col gap-3 rounded-xl border border-default bg-base/40 p-3 md:p-4">
                <StepHeader number={1} label={t('clipboardImport.stepConfigure')} />
                <div className="grid gap-3 lg:grid-cols-12">
                  <div className="lg:col-span-5 rounded-lg border border-default bg-base/60 p-3">
                    <label className="block text-xs uppercase font-bold text-muted mb-2">
                      {t('clipboardImport.mode')}
                    </label>
                    <ModeToggle value={importMode} onChange={setImportMode} />
                  </div>

                  <div className="lg:col-span-7 rounded-lg border border-default bg-base/60 p-3 flex flex-col gap-3">
                    <div>
                      {importMode === 'create' ? (
                        <TableNameInput
                          value={tableName}
                          onChange={setTableName}
                          tableExists={tableExists}
                          aiEnabled={!!settings.aiProvider}
                          aiLoading={isAiLoading}
                          onAiSuggest={handleAiSuggest}
                        />
                      ) : (
                        <>
                          <label className="block text-xs uppercase font-bold text-muted mb-2">
                            {t('clipboardImport.tableName')}
                          </label>
                          <Select
                            value={tableName || null}
                            options={existingTables}
                            onChange={setTableName}
                            placeholder={t('clipboardImport.selectTablePlaceholder')}
                            searchPlaceholder={t('common.search')}
                            noResultsLabel={t('common.noResults')}
                            hasError={!tableName || !tableExists}
                          />
                        </>
                      )}
                    </div>

                    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-secondary">
                      <span className="text-primary font-medium">{selectedModeHint}</span>
                    </div>

                    {tableExists && importMode === 'create' && (
                      <div className="flex flex-col gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-3">
                        <div className="flex items-center gap-2 text-yellow-300">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span className="text-xs font-medium">{t('clipboardImport.tableExists')}</span>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <span className="text-[11px] text-yellow-200/90 shrink-0">
                            {t('clipboardImport.onConflict')}:
                          </span>
                          <div className="min-w-0 flex-1">
                            <Select
                              value={ifExists}
                              options={['fail', 'append', 'replace']}
                              onChange={(v) => setIfExists(v as IfExistsStrategy)}
                              searchable={false}
                              hasError
                              labels={{
                                fail: t('clipboardImport.conflictFail'),
                                append: t('clipboardImport.conflictAppend'),
                                replace: t('clipboardImport.conflictReplace'),
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden rounded-xl border border-default bg-base/40 p-3 md:p-4">
                <StepHeader number={2} label={t('clipboardImport.stepReview')} />
                <div className="flex flex-col xl:flex-row gap-3 flex-1 min-h-0 overflow-hidden">
                  {maximizedPane !== 'preview' && (
                    <div className="flex-1 min-h-[260px] xl:min-h-0 overflow-hidden flex flex-col">
                      <SchemaEditor
                        key={columns.length}
                        columns={columns}
                        availableTypes={dataTypes?.types ?? []}
                        onColumnChange={handleColumnChange}
                        onDeleteColumns={handleDeleteColumns}
                        isMaximized={maximizedPane === 'schema'}
                        onToggleMaximize={() =>
                          setMaximizedPane((m) => (m === 'schema' ? null : 'schema'))
                        }
                        targetColumnOptions={
                          importMode === 'append' && tableExists
                            ? targetColumns.map((c) => c.name)
                            : undefined
                        }
                      />
                    </div>
                  )}
                  {maximizedPane !== 'schema' && (
                    <div className="flex-1 min-h-[240px] xl:min-h-0 overflow-hidden flex flex-col">
                      <DataPreview
                        headers={visibleHeaders}
                        rows={visibleRows}
                        rowCount={parsed.rowCount}
                        isMaximized={maximizedPane === 'preview'}
                        onToggleMaximize={() =>
                          setMaximizedPane((m) => (m === 'preview' ? null : 'preview'))
                        }
                      />
                    </div>
                  )}
                </div>
              </section>

              {parsed.warnings.length > 0 && (
                <div
                  id={warningsId}
                  className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg overflow-hidden shrink-0"
                >
                  <button
                    type="button"
                    onClick={() => setWarningsExpanded((v) => !v)}
                    aria-expanded={warningsExpanded}
                    aria-controls={`${warningsId}-panel`}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                  >
                    {warningsExpanded ? (
                      <ChevronDown size={14} className="shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0" />
                    )}
                    <AlertTriangle size={12} className="shrink-0" />
                    <span className="font-medium">
                      {t('clipboardImport.warningsCount', { count: parsed.warnings.length })}
                    </span>
                  </button>
                  {warningsExpanded && (
                    <div
                      id={`${warningsId}-panel`}
                      className="max-h-32 overflow-y-auto px-3 pb-2 pt-1 flex flex-col gap-1 border-t border-yellow-500/20"
                    >
                      {parsed.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-yellow-400/90">
                          <span className="text-yellow-500/60 mt-0.5">•</span>
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div
                  id={errorId}
                  role="alert"
                  className="flex items-center gap-2 text-xs text-error-text bg-error-bg border border-error-border p-3 rounded-lg shrink-0"
                >
                  <AlertTriangle size={14} className="shrink-0" />
                  {error}
                </div>
              )}
            </>
          ) : null}
        </div>

        {parsed && !success && (
          <div className="px-4 md:px-5 py-3 border-t border-default bg-gradient-to-t from-base to-base/70 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                {parsed.rowCount > 0
                  ? t('clipboardImport.rowsTotal', { count: parsed.rowCount })
                  : t('clipboardImport.noData')}
              </span>
              {appendModeBlocked && (
                <span className="text-[11px] text-yellow-300">{t('clipboardImport.selectTablePlaceholder')}</span>
              )}
            </div>
            <div className="flex gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-secondary hover:text-primary hover:bg-surface-secondary/50 rounded-lg transition-colors text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={!canImport}
                className="bg-gradient-to-br from-indigo-500 to-indigo-700 hover:from-indigo-400 hover:to-indigo-600 disabled:from-indigo-800/50 disabled:to-indigo-900/50 disabled:opacity-60 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm flex items-center gap-2 shadow-lg shadow-indigo-900/30 transition-all"
              >
                {isImporting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Upload size={16} />
                )}
                {isImporting
                  ? t('clipboardImport.importingCount', {
                      count: parsed.rowCount,
                      defaultValue: 'Importing {{count}} rows...',
                    })
                  : t('clipboardImport.import', { count: parsed.rowCount })}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface StepHeaderProps {
  number: number;
  label: string;
}

function StepHeader({ number, label }: StepHeaderProps) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500/30 to-indigo-800/40 border border-indigo-500/40 text-[11px] font-bold text-indigo-200 shadow-inner shrink-0">
        {number}
      </span>
      <span className="text-xs font-semibold text-primary uppercase tracking-wider truncate">{label}</span>
      <div className="flex-1 h-px bg-gradient-to-r from-default to-transparent" />
    </div>
  );
}

interface SuccessStateProps {
  result: ImportResult;
  tableName: string;
  onClose: () => void;
}

function SuccessState({ result, tableName, onClose }: SuccessStateProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-4 text-center" role="status" aria-live="polite">
      <CheckCircle2 size={40} className="text-green-400" />
      <div>
        <p className="text-sm font-medium text-primary">
          {t('clipboardImport.success', { count: result.rows_inserted, table: tableName })}
        </p>
        {result.table_created && (
          <p className="text-xs text-muted mt-1">{t('clipboardImport.tableCreated')}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 px-4 py-2 bg-green-900/30 hover:bg-green-900/50 border border-green-800/40 text-green-300 rounded-lg text-sm transition-colors"
      >
        <ExternalLink size={14} />
        {t('clipboardImport.openTable')}
      </button>
    </div>
  );
}
