import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Database,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  FileText,
  FileJson,
  FileCode,
  Layers,
  Check,
  Play,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../../hooks/useDatabase";
import { useAlert } from "../../hooks/useAlert";

export type TransferStep = "target" | "tables" | "columns" | "settings" | "transfer";
export type TargetFormat = "database" | "csv" | "json" | "markdown" | "sql";
export type TransferMode = "create" | "append" | "replace";

export interface ColumnMappingItem {
  sourceName: string;
  sourceType: string;
  targetName: string;
  targetType: string;
  included: boolean;
}

export interface DataTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceConnectionId?: string | null;
  sourceDatabaseName?: string | null;
  sourceSchema?: string | null;
  sourceTableName?: string | null;
  sourceQuery?: string | null;
  sourceResult?: {
    columns: string[];
    rows: any[][];
  } | null;
  onSuccess?: () => void;
}

export const DataTransferModal = ({
  isOpen,
  onClose,
  sourceConnectionId,
  sourceDatabaseName,
  sourceSchema,
  sourceTableName,
  sourceQuery,
  sourceResult,
  onSuccess,
}: DataTransferModalProps) => {
  const { t } = useTranslation();
  const { showAlert } = useAlert();
  const {
    connections,
    activeConnectionId,
    activeDatabaseName,
    activeSchema,
  } = useDatabase();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<TransferStep>("target");
  const [targetFormat, setTargetFormat] = useState<TargetFormat>("database");

  // Destination / Container state
  const [targetConnectionId, setTargetConnectionId] = useState<string>("");
  const [targetDatabaseName, setTargetDatabaseName] = useState<string>("");
  const [targetSchema, setTargetSchema] = useState<string>("public");
  const [isContainerPickerOpen, setIsContainerPickerOpen] = useState(false);
  const [containerSearch, setContainerSearch] = useState("");
  const [expandedConnIds, setExpandedConnIds] = useState<Set<string>>(new Set());
  const [availableDatabasesMap, setAvailableDatabasesMap] = useState<Record<string, string[]>>({});
  const [loadingDatabasesFor, setLoadingDatabasesFor] = useState<string | null>(null);

  // Table & Columns mapping
  const [targetTableName, setTargetTableName] = useState<string>("");
  const [transferMode, setTransferMode] = useState<TransferMode>("create");
  const [columnMappings, setColumnMappings] = useState<ColumnMappingItem[]>([]);

  // Extraction & Load settings
  const [batchSize, setBatchSize] = useState<number>(500);
  const [maxRows, setMaxRows] = useState<number | null>(null);
  const [stopOnError, setStopOnError] = useState<boolean>(true);

  // Execution & Progress state
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [transferStatus, setTransferStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [rowsTransferred, setRowsTransferred] = useState<number>(0);
  const [totalRowsEstimate, setTotalRowsEstimate] = useState<number>(0);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  // Loaded Source Rows
  const [cachedSourceRows, setCachedSourceRows] = useState<any[][]>([]);
  const [cachedSourceCols, setCachedSourceCols] = useState<string[]>([]);

  const inferSqlType = (values: any[]): string => {
    let hasInt = false;
    let hasFloat = false;
    let hasBool = false;
    let hasDate = false;

    for (const v of values) {
      if (v === null || v === undefined || v === "") continue;
      if (typeof v === "boolean") {
        hasBool = true;
      } else if (typeof v === "number") {
        if (Number.isInteger(v)) hasInt = true;
        else hasFloat = true;
      } else if (typeof v === "string") {
        if (/^-?\d+$/.test(v)) hasInt = true;
        else if (/^-?\d+\.\d+$/.test(v)) hasFloat = true;
        else if (v.toLowerCase() === "true" || v.toLowerCase() === "false") hasBool = true;
        else if (!isNaN(Date.parse(v)) && v.length >= 10 && (v.includes("-") || v.includes("/"))) hasDate = true;
        else return "VARCHAR(255)";
      }
    }

    if (hasDate) return "TIMESTAMP";
    if (hasFloat) return "NUMERIC(14, 2)";
    if (hasInt) return "BIGINT";
    if (hasBool) return "BOOLEAN";
    return "TEXT";
  };

  const initColumnMappings = (cols: string[], sampleRows: any[][]) => {
    const mappings: ColumnMappingItem[] = cols.map((colName, colIdx) => {
      const sampleVals = sampleRows.slice(0, 50).map((r) => r[colIdx]);
      const inferredType = inferSqlType(sampleVals);
      return {
        sourceName: colName,
        sourceType: inferredType,
        targetName: colName.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        targetType: inferredType,
        included: true,
      };
    });
    setColumnMappings(mappings);
  };

  // Load Source Data (from props or by querying table)
  const loadSourceData = async () => {
    if (sourceResult && sourceResult.columns.length > 0) {
      setCachedSourceCols(sourceResult.columns);
      setCachedSourceRows(sourceResult.rows);
      setTotalRowsEstimate(sourceResult.rows.length);
      initColumnMappings(sourceResult.columns, sourceResult.rows);
      return;
    }

    const connId = sourceConnectionId || activeConnectionId;
    if (!connId) return;

    try {
      let queryToRun = sourceQuery;
      if (!queryToRun && sourceTableName) {
        const schemaPrefix = sourceSchema ? `"${sourceSchema}".` : "";
        queryToRun = `SELECT * FROM ${schemaPrefix}"${sourceTableName}" LIMIT 1000;`;
      }

      if (queryToRun) {
        const res = await invoke<any>("execute_query", {
          connectionId: connId,
          query: queryToRun,
          schema: sourceSchema ?? undefined,
        });

        const cols: string[] = res?.columns || [];
        const rows: any[][] = res?.rows || [];
        setCachedSourceCols(cols);
        setCachedSourceRows(rows);
        setTotalRowsEstimate(rows.length);
        initColumnMappings(cols, rows);
      }
    } catch (e: any) {
      console.error("Failed to load source data for transfer:", e);
    }
  };

  // Initialize on open
  useEffect(() => {
    if (isOpen) {
      setCurrentStep("target");
      setTargetFormat("database");
      setTransferMode("create");
      setBatchSize(500);
      setMaxRows(null);
      setStopOnError(true);
      setIsTransferring(false);
      setTransferStatus("idle");
      setRowsTransferred(0);
      setTransferError(null);
      setStartTime(null);
      setElapsedTime(0);

      // Default target connection
      const initialConnId = sourceConnectionId || activeConnectionId || (connections[0]?.id ?? "");
      setTargetConnectionId(initialConnId);
      const initialDb = sourceDatabaseName || activeDatabaseName || "postgres";
      setTargetDatabaseName(initialDb);
      setTargetSchema(sourceSchema || activeSchema || "public");

      // Default table name
      const defaultTable = sourceTableName || (sourceQuery ? "query_result" : "new_table");
      setTargetTableName(defaultTable);

      // Load initial source data
      loadSourceData();
    }
  }, [isOpen, sourceConnectionId, sourceTableName, sourceQuery, sourceResult]);

  // Timer for elapsed time
  useEffect(() => {
    if (!isTransferring || !startTime) return;
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isTransferring, startTime]);

  // Fetch databases for connection
  const loadDatabasesForConnection = async (connId: string) => {
    if (availableDatabasesMap[connId]) return;
    setLoadingDatabasesFor(connId);
    try {
      const conn = connections.find((c) => c.id === connId);
      const dbs = await invoke<string[]>("get_available_databases", {
        connectionId: connId,
        params: conn?.params,
      });
      if (Array.isArray(dbs) && dbs.length > 0) {
        setAvailableDatabasesMap((prev) => ({ ...prev, [connId]: dbs }));
      } else {
        const fallback = conn?.params?.database ? [String(conn.params.database)] : ["postgres"];
        setAvailableDatabasesMap((prev) => ({ ...prev, [connId]: fallback }));
      }
    } catch {
      const conn = connections.find((c) => c.id === connId);
      const fallback = conn?.params?.database ? [String(conn.params.database)] : ["postgres"];
      setAvailableDatabasesMap((prev) => ({ ...prev, [connId]: fallback }));
    } finally {
      setLoadingDatabasesFor(null);
    }
  };

  const toggleExpandConnection = (connId: string) => {
    setExpandedConnIds((prev) => {
      const next = new Set(prev);
      if (next.has(connId)) {
        next.delete(connId);
      } else {
        next.add(connId);
        loadDatabasesForConnection(connId);
      }
      return next;
    });
  };

  const selectContainer = (connId: string, dbName: string) => {
    setTargetConnectionId(connId);
    setTargetDatabaseName(dbName);
    setIsContainerPickerOpen(false);
  };

  const targetConnObj = useMemo(
    () => connections.find((c) => c.id === targetConnectionId),
    [connections, targetConnectionId]
  );

  const filteredConnections = useMemo(() => {
    if (!containerSearch.trim()) return connections;
    const term = containerSearch.toLowerCase();
    return connections.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.params?.host?.toLowerCase().includes(term) ||
        String(c.params?.database || "").toLowerCase().includes(term)
    );
  }, [connections, containerSearch]);

  // Execute Transfer
  const handleExecuteTransfer = async () => {
    if (!targetConnectionId) {
      showAlert(t("dataTransfer.selectTargetConn", "Please select a target connection"), { kind: "error" });
      return;
    }
    if (!targetTableName.trim()) {
      showAlert(t("dataTransfer.enterTableName", "Please enter a target table name"), { kind: "error" });
      return;
    }

    const activeCols = columnMappings.filter((c) => c.included);
    if (activeCols.length === 0) {
      showAlert(t("dataTransfer.selectAtLeastOneCol", "Please select at least one column to transfer"), { kind: "error" });
      return;
    }

    setCurrentStep("transfer");
    setIsTransferring(true);
    setTransferStatus("running");
    setRowsTransferred(0);
    setTransferError(null);
    setStartTime(Date.now());
    setElapsedTime(0);

    try {
      const schemaPrefix = targetSchema ? `"${targetSchema}".` : "";
      const fullTargetTable = `${schemaPrefix}"${targetTableName.trim()}"`;

      // 1. Table preparation DDL
      if (transferMode === "replace") {
        await invoke("execute_query", {
          connectionId: targetConnectionId,
          database: targetDatabaseName,
          query: `DROP TABLE IF EXISTS ${fullTargetTable};`,
        });
      }

      if (transferMode === "create" || transferMode === "replace") {
        const colDefs = activeCols
          .map((c) => `"${c.targetName}" ${c.targetType}`)
          .join(",\n  ");
        const createSql = `CREATE TABLE IF NOT EXISTS ${fullTargetTable} (\n  ${colDefs}\n);`;
        await invoke("execute_query", {
          connectionId: targetConnectionId,
          database: targetDatabaseName,
          query: createSql,
        });
      }

      // 2. Fetch rows to insert
      let rowsToInsert = cachedSourceRows;
      if (maxRows && maxRows > 0) {
        rowsToInsert = rowsToInsert.slice(0, maxRows);
      }
      setTotalRowsEstimate(rowsToInsert.length);

      if (rowsToInsert.length === 0) {
        setTransferStatus("completed");
        setIsTransferring(false);
        onSuccess?.();
        return;
      }

      // 3. Batch insert
      const targetColNames = activeCols.map((c) => `"${c.targetName}"`).join(", ");
      const sourceColIndices = activeCols.map((c) => cachedSourceCols.indexOf(c.sourceName));

      const escapeSqlVal = (val: any): string => {
        if (val === null || val === undefined) return "NULL";
        if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
        if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
        const str = typeof val === "object" ? JSON.stringify(val) : String(val);
        return `'${str.replace(/'/g, "''")}'`;
      };

      const actualBatchSize = Math.max(10, Math.min(batchSize, 1000));
      let processed = 0;

      for (let i = 0; i < rowsToInsert.length; i += actualBatchSize) {
        const chunk = rowsToInsert.slice(i, i + actualBatchSize);
        const valueRows = chunk
          .map((row) => {
            const vals = sourceColIndices.map((idx) => (idx >= 0 ? escapeSqlVal(row[idx]) : "NULL"));
            return `(${vals.join(", ")})`;
          })
          .join(",\n");

        const insertSql = `INSERT INTO ${fullTargetTable} (${targetColNames}) VALUES\n${valueRows};`;

        try {
          await invoke("execute_query", {
            connectionId: targetConnectionId,
            database: targetDatabaseName,
            query: insertSql,
          });
          processed += chunk.length;
          setRowsTransferred(processed);
        } catch (batchErr: any) {
          if (stopOnError) {
            throw batchErr;
          } else {
            console.warn("Batch failed, continuing due to ignore setting:", batchErr);
            processed += chunk.length;
            setRowsTransferred(processed);
          }
        }
      }

      setTransferStatus("completed");
      setIsTransferring(false);
      onSuccess?.();
    } catch (err: any) {
      console.error("Transfer failed:", err);
      setTransferError(err?.message || String(err));
      setTransferStatus("error");
      setIsTransferring(false);
    }
  };

  if (!isOpen) return null;

  const steps: { key: TransferStep; label: string }[] = [
    { key: "target", label: t("dataTransfer.stepTarget", "Export target") },
    { key: "tables", label: t("dataTransfer.stepTables", "Tables mapping") },
    { key: "columns", label: t("dataTransfer.stepColumns", "Columns mapping") },
    { key: "settings", label: t("dataTransfer.stepSettings", "Extraction settings") },
    { key: "transfer", label: t("dataTransfer.stepConfirm", "Transfer & Confirm") },
  ];

  const sourceDesc = sourceTableName
    ? `Table: ${sourceTableName}`
    : sourceQuery
      ? `Query: ${sourceQuery.length > 35 ? sourceQuery.slice(0, 35) + "..." : sourceQuery}`
      : "Current Result";

  const targetContainerLabel = targetConnObj
    ? `${targetDatabaseName}.${targetSchema} [${targetConnObj.name}]`
    : t("dataTransfer.noneSelected", "Select target container...");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[900px] max-w-[96vw] h-[640px] max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-default bg-base shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
              <ArrowRightLeft size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-primary flex items-center gap-2">
                <span>{t("dataTransfer.title", "Data Transfer")}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">
                  {t("dataTransfer.betaTag", "Cross-Database")}
                </span>
              </h2>
              <p className="text-xs text-secondary mt-0.5">
                {t("dataTransfer.subtitle", "Transfer tables and query results directly between databases and tables")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isTransferring}
            className="text-secondary hover:text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-secondary"
          >
            <X size={18} />
          </button>
        </div>

        {/* Wizard Body: Left Stepper & Right Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Stepper Sidebar (DBeaver style) */}
          <div className="w-56 bg-surface-secondary border-r border-default p-3 flex flex-col gap-1.5 shrink-0 select-none">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider px-2 py-1">
              {t("dataTransfer.stepsHeader", "Workflow Steps")}
            </div>
            {steps.map((step, idx) => {
              const isActive = currentStep === step.key;
              const isPast = steps.findIndex((s) => s.key === currentStep) > idx;

              return (
                <button
                  key={step.key}
                  disabled={isTransferring}
                  onClick={() => setCurrentStep(step.key)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-all ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm font-semibold"
                      : isPast
                        ? "text-primary hover:bg-surface"
                        : "text-muted hover:text-secondary hover:bg-surface/50"
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 font-bold ${
                      isActive
                        ? "bg-white/20 text-white"
                        : isPast
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-surface text-muted border border-default"
                    }`}
                  >
                    {isPast ? <Check size={12} strokeWidth={3} /> : idx + 1}
                  </div>
                  <span className="truncate">{step.label}</span>
                </button>
              );
            })}

            {/* Source info box at bottom of sidebar */}
            <div className="mt-auto p-2.5 bg-surface rounded-lg border border-default text-[11px] space-y-1.5">
              <div className="text-muted font-medium flex items-center gap-1.5">
                <Database size={12} />
                <span>{t("dataTransfer.sourceLabel", "Source")}</span>
              </div>
              <div className="text-primary font-medium truncate" title={sourceDesc}>
                {sourceDesc}
              </div>
              <div className="text-muted text-[10px]">
                {cachedSourceRows.length} {t("dataTransfer.rowsLoaded", "rows cached")}
              </div>
            </div>
          </div>

          {/* Right Content Area */}
          <div className="flex-1 p-6 overflow-y-auto bg-base flex flex-col">
            {/* STEP 1: EXPORT TARGET */}
            {currentStep === "target" && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div>
                  <h3 className="text-sm font-semibold text-primary">
                    {t("dataTransfer.targetTypeTitle", "Configure data transfer target type and format")}
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    {t("dataTransfer.targetTypeSubtitle", "Select destination format or database container for your data")}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-secondary">
                    {t("dataTransfer.targetFormatLabel", "Target Format")}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setTargetFormat("database")}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                        targetFormat === "database"
                          ? "border-blue-500 bg-blue-500/10 shadow-sm"
                          : "border-default bg-surface-secondary hover:border-strong"
                      }`}
                    >
                      <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
                        <Database size={20} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-primary flex items-center gap-2">
                          <span>Database</span>
                          <span className="text-[10px] px-1.5 py-0.2 bg-blue-500/20 text-blue-400 rounded">
                            {t("dataTransfer.recommended", "Recommended")}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted mt-1 leading-relaxed">
                          {t("dataTransfer.dbFormatDesc", "Direct transfer to another PostgreSQL, MySQL, SQLite table")}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTargetFormat("sql")}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                        targetFormat === "sql"
                          ? "border-blue-500 bg-blue-500/10 shadow-sm"
                          : "border-default bg-surface-secondary hover:border-strong"
                      }`}
                    >
                      <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                        <FileCode size={20} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-primary">SQL Script</div>
                        <p className="text-[11px] text-muted mt-1 leading-relaxed">
                          {t("dataTransfer.sqlFormatDesc", "Export as SQL INSERT statements script")}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTargetFormat("csv")}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                        targetFormat === "csv"
                          ? "border-blue-500 bg-blue-500/10 shadow-sm"
                          : "border-default bg-surface-secondary hover:border-strong"
                      }`}
                    >
                      <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0">
                        <FileText size={20} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-primary">CSV File</div>
                        <p className="text-[11px] text-muted mt-1 leading-relaxed">
                          {t("dataTransfer.csvFormatDesc", "Delimited text file compatible with spreadsheets")}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTargetFormat("json")}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                        targetFormat === "json"
                          ? "border-blue-500 bg-blue-500/10 shadow-sm"
                          : "border-default bg-surface-secondary hover:border-strong"
                      }`}
                    >
                      <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400 shrink-0">
                        <FileJson size={20} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-primary">JSON File</div>
                        <p className="text-[11px] text-muted mt-1 leading-relaxed">
                          {t("dataTransfer.jsonFormatDesc", "Structured JavaScript Object Notation")}
                        </p>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Source details card */}
                <div className="p-4 bg-surface-secondary border border-default rounded-xl space-y-2">
                  <div className="text-xs font-medium text-secondary">
                    {t("dataTransfer.sourcePreview", "Source Information")}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted">{t("dataTransfer.sourceObj", "Source Object")}: </span>
                      <span className="text-primary font-medium">{sourceDesc}</span>
                    </div>
                    <div>
                      <span className="text-muted">{t("dataTransfer.totalCols", "Columns")}: </span>
                      <span className="text-primary font-medium">{cachedSourceCols.length} columns</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: TABLES MAPPING */}
            {currentStep === "tables" && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div>
                  <h3 className="text-sm font-semibold text-primary">
                    {t("dataTransfer.tablesMappingTitle", "Map tables and target container")}
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    {t("dataTransfer.tablesMappingSubtitle", "Choose destination database, schema, and target table name")}
                  </p>
                </div>

                {/* Target container picker field */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-secondary">
                    {t("dataTransfer.targetContainer", "Target container:")}
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 bg-surface-secondary border border-strong rounded-lg text-xs font-medium text-primary flex items-center gap-2">
                      <Database size={14} className="text-blue-400 shrink-0" />
                      <span className="truncate">{targetContainerLabel}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsContainerPickerOpen(true)}
                      className="px-3.5 py-2 bg-surface-secondary hover:bg-surface border border-default hover:border-strong rounded-lg text-xs font-medium text-primary transition-colors flex items-center gap-1.5 shrink-0"
                    >
                      <Layers size={13} />
                      <span>{t("dataTransfer.chooseContainerBtn", "Choose...")}</span>
                    </button>
                  </div>
                </div>

                {/* Table mapping source -> target */}
                <div className="border border-default rounded-xl overflow-hidden bg-surface-secondary">
                  <div className="px-4 py-2.5 bg-base border-b border-default flex items-center justify-between text-xs font-semibold text-secondary">
                    <span>{t("dataTransfer.sourceTableCol", "Source")}</span>
                    <ArrowRight size={14} className="text-muted" />
                    <span>{t("dataTransfer.targetTableCol", "Target Table")}</span>
                  </div>

                  <div className="p-4 flex items-center gap-4">
                    <div className="flex-1 px-3 py-2 bg-surface border border-default rounded-lg text-xs font-mono text-primary truncate">
                      {sourceDesc}
                    </div>

                    <ArrowRight size={16} className="text-blue-400 shrink-0" />

                    <div className="flex-1">
                      <input
                        type="text"
                        value={targetTableName}
                        onChange={(e) => setTargetTableName(e.target.value)}
                        placeholder="target_table_name"
                        className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-xs font-mono text-primary focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>
                </div>

                {/* Mode: Create vs Append vs Replace */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-secondary">
                    {t("dataTransfer.modeLabel", "Target Table Action")}
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setTransferMode("create")}
                      className={`p-3 rounded-lg border text-left text-xs transition-all ${
                        transferMode === "create"
                          ? "border-blue-500 bg-blue-500/10 font-medium text-primary"
                          : "border-default bg-surface-secondary text-secondary hover:border-strong"
                      }`}
                    >
                      <div className="font-semibold text-primary">Create New</div>
                      <div className="text-[11px] text-muted mt-0.5">Auto CREATE TABLE if not exists</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTransferMode("append")}
                      className={`p-3 rounded-lg border text-left text-xs transition-all ${
                        transferMode === "append"
                          ? "border-blue-500 bg-blue-500/10 font-medium text-primary"
                          : "border-default bg-surface-secondary text-secondary hover:border-strong"
                      }`}
                    >
                      <div className="font-semibold text-primary">Append</div>
                      <div className="text-[11px] text-muted mt-0.5">Insert rows into existing table</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTransferMode("replace")}
                      className={`p-3 rounded-lg border text-left text-xs transition-all ${
                        transferMode === "replace"
                          ? "border-amber-500 bg-amber-500/10 font-medium text-primary"
                          : "border-default bg-surface-secondary text-secondary hover:border-strong"
                      }`}
                    >
                      <div className="font-semibold text-primary">Drop & Recreate</div>
                      <div className="text-[11px] text-muted mt-0.5">Clean replace table and data</div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: COLUMNS MAPPING */}
            {currentStep === "columns" && (
              <div className="space-y-4 animate-in fade-in duration-150 flex-1 flex flex-col">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-primary">
                      {t("dataTransfer.columnsMappingTitle", "Column Mapping & Types")}
                    </h3>
                    <p className="text-xs text-muted mt-0.5">
                      {t("dataTransfer.columnsMappingSubtitle", "Configure column names and data types for destination table")}
                    </p>
                  </div>
                  <div className="text-xs text-muted">
                    {columnMappings.filter((c) => c.included).length} / {columnMappings.length} {t("dataTransfer.colsSelected", "columns included")}
                  </div>
                </div>

                <div className="flex-1 border border-default rounded-xl overflow-hidden flex flex-col bg-surface-secondary min-h-[260px]">
                  <div className="px-4 py-2 bg-base border-b border-default grid grid-cols-12 gap-2 text-[11px] font-semibold text-secondary">
                    <span className="col-span-1 text-center">Inc.</span>
                    <span className="col-span-4">Source Column</span>
                    <span className="col-span-1 text-center"></span>
                    <span className="col-span-4">Target Column Name</span>
                    <span className="col-span-2">Target Type</span>
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-default p-1">
                    {columnMappings.map((col, idx) => (
                      <div
                        key={col.sourceName}
                        className={`grid grid-cols-12 gap-2 items-center px-3 py-1.5 text-xs transition-colors rounded ${
                          col.included ? "hover:bg-surface" : "opacity-40 bg-surface-secondary/50"
                        }`}
                      >
                        {/* Checkbox */}
                        <div className="col-span-1 flex justify-center">
                          <input
                            type="checkbox"
                            checked={col.included}
                            onChange={(e) => {
                              const updated = [...columnMappings];
                              updated[idx].included = e.target.checked;
                              setColumnMappings(updated);
                            }}
                            className="rounded border-default text-blue-600 focus:ring-0 cursor-pointer"
                          />
                        </div>

                        {/* Source Column */}
                        <div className="col-span-4 font-mono truncate text-primary flex items-center gap-1.5">
                          <span>{col.sourceName}</span>
                          <span className="text-[10px] text-muted font-sans">({col.sourceType})</span>
                        </div>

                        {/* Arrow */}
                        <div className="col-span-1 flex justify-center text-muted">
                          <ArrowRight size={13} />
                        </div>

                        {/* Target Column Name Input */}
                        <div className="col-span-4">
                          <input
                            type="text"
                            value={col.targetName}
                            disabled={!col.included}
                            onChange={(e) => {
                              const updated = [...columnMappings];
                              updated[idx].targetName = e.target.value;
                              setColumnMappings(updated);
                            }}
                            className="w-full px-2 py-1 bg-base border border-default rounded text-xs font-mono text-primary focus:outline-none focus:border-blue-500 disabled:opacity-50"
                          />
                        </div>

                        {/* Target Type Select */}
                        <div className="col-span-2">
                          <select
                            value={col.targetType}
                            disabled={!col.included}
                            onChange={(e) => {
                              const updated = [...columnMappings];
                              updated[idx].targetType = e.target.value;
                              setColumnMappings(updated);
                            }}
                            className="w-full px-2 py-1 bg-base border border-default rounded text-xs text-primary focus:outline-none focus:border-blue-500 disabled:opacity-50"
                          >
                            <option value="TEXT">TEXT</option>
                            <option value="VARCHAR(255)">VARCHAR</option>
                            <option value="BIGINT">BIGINT</option>
                            <option value="INTEGER">INTEGER</option>
                            <option value="NUMERIC(14, 2)">NUMERIC</option>
                            <option value="BOOLEAN">BOOLEAN</option>
                            <option value="TIMESTAMP">TIMESTAMP</option>
                            <option value="JSONB">JSONB</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: EXTRACTION & LOAD SETTINGS */}
            {currentStep === "settings" && (
              <div className="space-y-5 animate-in fade-in duration-150">
                <div>
                  <h3 className="text-sm font-semibold text-primary">
                    {t("dataTransfer.settingsTitle", "Extraction & Data Load Settings")}
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    {t("dataTransfer.settingsSubtitle", "Configure batch size and performance tuning for transfer")}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Batch Size */}
                  <div className="p-4 bg-surface-secondary border border-default rounded-xl space-y-2">
                    <label className="text-xs font-semibold text-primary">
                      {t("dataTransfer.batchSizeLabel", "Commit Batch Size")}
                    </label>
                    <p className="text-[11px] text-muted">
                      {t("dataTransfer.batchSizeDesc", "Number of rows per INSERT statement execution")}
                    </p>
                    <input
                      type="number"
                      min={10}
                      max={2000}
                      step={50}
                      value={batchSize}
                      onChange={(e) => setBatchSize(Number(e.target.value) || 500)}
                      className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-xs font-mono text-primary focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Limit Rows */}
                  <div className="p-4 bg-surface-secondary border border-default rounded-xl space-y-2">
                    <label className="text-xs font-semibold text-primary">
                      {t("dataTransfer.rowLimitLabel", "Max Rows to Transfer")}
                    </label>
                    <p className="text-[11px] text-muted">
                      {t("dataTransfer.rowLimitDesc", "Leave blank or 0 to transfer all available rows")}
                    </p>
                    <input
                      type="number"
                      min={0}
                      placeholder="All rows"
                      value={maxRows ?? ""}
                      onChange={(e) => setMaxRows(e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-3 py-2 bg-base border border-strong rounded-lg text-xs font-mono text-primary focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Error handling options */}
                <div className="p-4 bg-surface-secondary border border-default rounded-xl space-y-3">
                  <div className="text-xs font-semibold text-primary">
                    {t("dataTransfer.errorHandling", "Error Handling")}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="stopOnError"
                      checked={stopOnError}
                      onChange={(e) => setStopOnError(e.target.checked)}
                      className="rounded border-default text-blue-600 focus:ring-0 cursor-pointer"
                    />
                    <label htmlFor="stopOnError" className="text-xs text-secondary cursor-pointer">
                      {t("dataTransfer.stopOnErrorDesc", "Stop immediately if any batch fails to prevent partial data inconsistency")}
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: CONFIRMATION & EXECUTION */}
            {currentStep === "transfer" && (
              <div className="space-y-5 animate-in fade-in duration-150 flex-1 flex flex-col justify-center">
                {transferStatus === "idle" ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-primary">
                        {t("dataTransfer.confirmTitle", "Review and Confirm Transfer")}
                      </h3>
                      <p className="text-xs text-muted mt-0.5">
                        {t("dataTransfer.confirmSubtitle", "Check parameters before executing transfer to the database")}
                      </p>
                    </div>

                    <div className="border border-default rounded-xl divide-y divide-default bg-surface-secondary text-xs">
                      <div className="p-3 flex justify-between">
                        <span className="text-muted">Source Object:</span>
                        <span className="text-primary font-medium">{sourceDesc}</span>
                      </div>
                      <div className="p-3 flex justify-between">
                        <span className="text-muted">Target Container:</span>
                        <span className="text-primary font-medium">{targetContainerLabel}</span>
                      </div>
                      <div className="p-3 flex justify-between">
                        <span className="text-muted">Target Table:</span>
                        <span className="text-blue-400 font-mono font-semibold">{targetTableName}</span>
                      </div>
                      <div className="p-3 flex justify-between">
                        <span className="text-muted">Action Mode:</span>
                        <span className="text-primary font-medium uppercase">{transferMode}</span>
                      </div>
                      <div className="p-3 flex justify-between">
                        <span className="text-muted">Columns to Transfer:</span>
                        <span className="text-primary font-medium">
                          {columnMappings.filter((c) => c.included).length} columns
                        </span>
                      </div>
                      <div className="p-3 flex justify-between">
                        <span className="text-muted">Estimated Rows:</span>
                        <span className="text-primary font-medium">{cachedSourceRows.length} rows</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Progress / Completed / Error View */
                  <div className="space-y-6 text-center py-6">
                    {transferStatus === "running" && (
                      <div className="space-y-4">
                        <div className="flex justify-center">
                          <Loader2 size={40} className="animate-spin text-blue-500" />
                        </div>
                        <div>
                          <h4 className="text-base font-semibold text-primary">
                            {t("dataTransfer.transferringTitle", "Transferring Data...")}
                          </h4>
                          <p className="text-xs text-muted mt-1">
                            {rowsTransferred} / {totalRowsEstimate} rows processed ({elapsedTime}s elapsed)
                          </p>
                        </div>
                        {/* Progress Bar */}
                        <div className="w-full bg-surface-secondary h-2.5 rounded-full overflow-hidden border border-default max-w-md mx-auto">
                          <div
                            className="bg-blue-600 h-full transition-all duration-200"
                            style={{
                              width: `${
                                totalRowsEstimate > 0
                                  ? Math.min(100, Math.round((rowsTransferred / totalRowsEstimate) * 100))
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {transferStatus === "completed" && (
                      <div className="space-y-3">
                        <div className="flex justify-center">
                          <div className="p-3 rounded-full bg-emerald-500/20 text-emerald-400">
                            <CheckCircle2 size={48} />
                          </div>
                        </div>
                        <h4 className="text-base font-semibold text-primary">
                          {t("dataTransfer.successTitle", "Data Transfer Completed Successfully!")}
                        </h4>
                        <p className="text-xs text-secondary max-w-md mx-auto">
                          Transferred {rowsTransferred} rows to{" "}
                          <span className="font-mono text-blue-400 font-semibold">{targetTableName}</span> in {elapsedTime} seconds.
                        </p>
                      </div>
                    )}

                    {transferStatus === "error" && (
                      <div className="space-y-3">
                        <div className="flex justify-center">
                          <div className="p-3 rounded-full bg-rose-500/20 text-rose-400">
                            <AlertCircle size={48} />
                          </div>
                        </div>
                        <h4 className="text-base font-semibold text-rose-400">
                          {t("dataTransfer.errorTitle", "Data Transfer Failed")}
                        </h4>
                        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs font-mono text-rose-300 max-w-lg mx-auto text-left overflow-x-auto">
                          {transferError}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-default bg-base flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            disabled={isTransferring}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-xs font-medium rounded-lg hover:bg-surface"
          >
            {transferStatus === "completed" ? t("common.close", "Close") : t("common.cancel", "Cancel")}
          </button>

          <div className="flex items-center gap-2">
            {currentStep !== "target" && transferStatus !== "completed" && (
              <button
                type="button"
                disabled={isTransferring}
                onClick={() => {
                  const stepIdx = steps.findIndex((s) => s.key === currentStep);
                  if (stepIdx > 0) setCurrentStep(steps[stepIdx - 1].key);
                }}
                className="px-4 py-2 border border-default hover:border-strong text-primary rounded-lg text-xs font-medium transition-colors"
              >
                {t("dataTransfer.back", "< Back")}
              </button>
            )}

            {currentStep !== "transfer" ? (
              <button
                type="button"
                onClick={() => {
                  const stepIdx = steps.findIndex((s) => s.key === currentStep);
                  if (stepIdx < steps.length - 1) setCurrentStep(steps[stepIdx + 1].key);
                }}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
              >
                <span>{t("dataTransfer.next", "Next >")}</span>
              </button>
            ) : transferStatus === "idle" || transferStatus === "error" ? (
              <button
                type="button"
                disabled={isTransferring}
                onClick={handleExecuteTransfer}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Play size={13} fill="currentColor" />
                <span>{t("dataTransfer.proceed", "Proceed / Start Transfer")}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                {t("common.done", "Done")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SUB-MODAL: CHOOSE CONTAINER (DBeaver style tree modal) */}
      {isContainerPickerOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[110] backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-default bg-base">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-blue-400" />
                <h3 className="text-xs font-semibold text-primary">
                  {t("dataTransfer.chooseContainerTitle", "Choose Container")}
                </h3>
              </div>
              <button
                onClick={() => setIsContainerPickerOpen(false)}
                className="text-secondary hover:text-primary transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search Filter */}
            <div className="p-3 border-b border-default bg-surface-secondary">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-muted" />
                <input
                  type="text"
                  value={containerSearch}
                  onChange={(e) => setContainerSearch(e.target.value)}
                  placeholder={t("dataTransfer.filterConnections", "Filter connections by name...")}
                  className="w-full pl-9 pr-3 py-1.5 bg-base border border-default rounded-lg text-xs text-primary focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Tree List */}
            <div className="flex-1 p-2 overflow-y-auto divide-y divide-default/50 space-y-1">
              {filteredConnections.map((conn) => {
                const isExpanded = expandedConnIds.has(conn.id);
                const dbs = availableDatabasesMap[conn.id] || [];
                const isLoadingDbs = loadingDatabasesFor === conn.id;

                return (
                  <div key={conn.id} className="pt-1">
                    <div
                      onClick={() => toggleExpandConnection(conn.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-surface cursor-pointer text-xs group"
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpandConnection(conn.id);
                        }}
                        className="text-muted hover:text-primary transition-colors"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <Database size={14} className="text-blue-400 shrink-0" />
                      <span className="font-semibold text-primary truncate flex-1">{conn.name}</span>
                      <span className="text-[10px] text-muted uppercase font-mono">{conn.params?.driver || "db"}</span>
                    </div>

                    {/* Databases list under connection */}
                    {isExpanded && (
                      <div className="pl-7 pr-2 py-1 space-y-0.5">
                        {isLoadingDbs ? (
                          <div className="flex items-center gap-2 py-1 text-xs text-muted">
                            <Loader2 size={12} className="animate-spin" />
                            <span>Loading databases...</span>
                          </div>
                        ) : dbs.length === 0 ? (
                          <div
                            onClick={() => selectContainer(conn.id, String(conn.params?.database || "postgres"))}
                            className="px-2 py-1 rounded text-xs text-secondary hover:bg-surface cursor-pointer flex items-center justify-between"
                          >
                            <span>{String(conn.params?.database || "Default Database")}</span>
                            <span className="text-[10px] text-muted">Default</span>
                          </div>
                        ) : (
                          dbs.map((db) => {
                            const isSelected = targetConnectionId === conn.id && targetDatabaseName === db;
                            return (
                              <div
                                key={db}
                                onClick={() => selectContainer(conn.id, db)}
                                className={`flex items-center justify-between px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                                  isSelected
                                    ? "bg-blue-500/15 text-blue-400 font-medium"
                                    : "text-secondary hover:bg-surface hover:text-primary"
                                }`}
                              >
                                <span className="font-mono">{db}</span>
                                {isSelected && <Check size={13} className="text-blue-400" />}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-default bg-base flex justify-end gap-2">
              <button
                onClick={() => setIsContainerPickerOpen(false)}
                className="px-4 py-1.5 border border-default text-secondary hover:text-primary rounded-lg text-xs font-medium"
              >
                {t("common.cancel", "Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
