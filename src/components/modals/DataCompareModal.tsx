import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  ArrowRightLeft,
  CheckCircle2,
  Loader2,
  Search,
  Play,
  Copy,
  FileCode,
  RefreshCw,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../../hooks/useDatabase";
import { useAlert } from "../../hooks/useAlert";

export type DiffFilterType = "all" | "diffs" | "modified" | "added" | "deleted" | "identical";

export interface RowDiff {
  key: string;
  type: "identical" | "modified" | "added" | "deleted";
  sourceRow?: Record<string, any>;
  targetRow?: Record<string, any>;
  diffCols: string[]; // names of columns that differ
}

export interface DataCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceConnectionId?: string | null;
  sourceDatabaseName?: string | null;
  sourceSchema?: string | null;
  sourceTableName?: string | null;
  sourceQuery?: string | null;
}

export const DataCompareModal = ({
  isOpen,
  onClose,
  sourceConnectionId,
  sourceDatabaseName,
  sourceSchema,
  sourceTableName,
  sourceQuery,
}: DataCompareModalProps) => {
  const { t } = useTranslation();
  const { showAlert } = useAlert();
  const {
    connections,
    activeConnectionId,
    activeDatabaseName,
    activeSchema,
  } = useDatabase();

  // Source Container
  const [srcConnId, setSrcConnId] = useState<string>("");
  const [srcDbName, setSrcDbName] = useState<string>("");
  const [srcSchemaName, setSrcSchemaName] = useState<string>("public");
  const [srcTable, setSrcTable] = useState<string>("");
  const [srcQueryText, setSrcQueryText] = useState<string>("");

  // Target Container
  const [tgtConnId, setTgtConnId] = useState<string>("");
  const [tgtDbName, setTgtDbName] = useState<string>("");
  const [tgtSchemaName, setTgtSchemaName] = useState<string>("public");
  const [tgtTable, setTgtTable] = useState<string>("");
  const [tgtQueryText, setTgtQueryText] = useState<string>("");

  // Key Column Selection
  const [keyColumn, setKeyColumn] = useState<string>("id");
  const [commonColumns, setCommonColumns] = useState<string[]>([]);

  // Tables cache
  const [srcTables, setSrcTables] = useState<string[]>([]);
  const [tgtTables, setTgtTables] = useState<string[]>([]);

  // Comparison State
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [hasCompared, setHasCompared] = useState<boolean>(false);
  const [diffResults, setDiffResults] = useState<RowDiff[]>([]);
  const [activeFilter, setActiveFilter] = useState<DiffFilterType>("diffs");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showSyncSqlModal, setShowSyncSqlModal] = useState<boolean>(false);
  const [generatedSyncSql, setGeneratedSyncSql] = useState<string>("");

  // Initialize on open
  useEffect(() => {
    if (isOpen) {
      const initialConnId = sourceConnectionId || activeConnectionId || (connections[0]?.id ?? "");
      const initialDb = sourceDatabaseName || activeDatabaseName || "postgres";
      const initialSchema = sourceSchema || activeSchema || "public";
      const initialTable = sourceTableName || "";

      setSrcConnId(initialConnId);
      setSrcDbName(initialDb);
      setSrcSchemaName(initialSchema);
      setSrcTable(initialTable);
      setSrcQueryText(sourceQuery || "");

      setTgtConnId(initialConnId);
      setTgtDbName(initialDb);
      setTgtSchemaName(initialSchema);
      setTgtTable(initialTable ? `${initialTable}_copy` : "");
      setTgtQueryText("");

      setHasCompared(false);
      setDiffResults([]);
      setActiveFilter("diffs");
      setShowSyncSqlModal(false);

      loadTables(initialConnId, initialSchema, true);
      loadTables(initialConnId, initialSchema, false);
    }
  }, [isOpen, sourceConnectionId, sourceDatabaseName, sourceTableName, sourceQuery]);

  const loadTables = async (connId: string, schema: string, isSource: boolean) => {
    if (!connId) return;
    try {
      const tablesRes = await invoke<{ name: string }[]>("get_tables", {
        connectionId: connId,
        schema: schema || undefined,
      });
      const names = (tablesRes || []).map((t) => t.name);
      if (isSource) setSrcTables(names);
      else setTgtTables(names);
    } catch {
      // ignore
    }
  };

  const handleRunCompare = async () => {
    if (!srcConnId || (!srcTable && !srcQueryText)) {
      showAlert(t("dataCompare.selectSource", "Please select source table or query"), { kind: "error" });
      return;
    }
    if (!tgtConnId || (!tgtTable && !tgtQueryText)) {
      showAlert(t("dataCompare.selectTarget", "Please select target table or query"), { kind: "error" });
      return;
    }

    setIsComparing(true);
    try {
      const srcSql = srcQueryText || `SELECT * FROM "${srcSchemaName}"."${srcTable}" LIMIT 2000;`;
      const tgtSql = tgtQueryText || `SELECT * FROM "${tgtSchemaName}"."${tgtTable}" LIMIT 2000;`;

      const [srcRes, tgtRes] = await Promise.all([
        invoke<any>("execute_query", {
          connectionId: srcConnId,
          database: srcDbName,
          query: srcSql,
          schema: srcSchemaName,
        }),
        invoke<any>("execute_query", {
          connectionId: tgtConnId,
          database: tgtDbName,
          query: tgtSql,
          schema: tgtSchemaName,
        }),
      ]);

      const sCols: string[] = srcRes?.columns || [];
      const tCols: string[] = tgtRes?.columns || [];
      const shared = sCols.filter((c) => tCols.includes(c));
      setCommonColumns(shared);

      // Determine key column
      let key = keyColumn;
      if (!shared.includes(key)) {
        key = shared.find((c) => c.toLowerCase() === "id" || c.toLowerCase().endsWith("_id")) || shared[0] || "";
        setKeyColumn(key);
      }

      if (!key) {
        throw new Error("No common columns found to match rows between source and target.");
      }

      const sRows: any[][] = srcRes?.rows || [];
      const tRows: any[][] = tgtRes?.rows || [];

      // Convert rows to maps keyed by keyColumn
      const keyIdxSrc = sCols.indexOf(key);
      const keyIdxTgt = tCols.indexOf(key);

      const srcMap = new Map<string, Record<string, any>>();
      sRows.forEach((r) => {
        const kVal = String(r[keyIdxSrc] ?? "");
        const obj: Record<string, any> = {};
        sCols.forEach((c, idx) => (obj[c] = r[idx]));
        srcMap.set(kVal, obj);
      });

      const tgtMap = new Map<string, Record<string, any>>();
      tRows.forEach((r) => {
        const kVal = String(r[keyIdxTgt] ?? "");
        const obj: Record<string, any> = {};
        tCols.forEach((c, idx) => (obj[c] = r[idx]));
        tgtMap.set(kVal, obj);
      });

      const allKeys = new Set([...srcMap.keys(), ...tgtMap.keys()]);
      const diffs: RowDiff[] = [];

      allKeys.forEach((k) => {
        const inSrc = srcMap.has(k);
        const inTgt = tgtMap.has(k);

        if (inSrc && !inTgt) {
          diffs.push({
            key: k,
            type: "deleted",
            sourceRow: srcMap.get(k),
            diffCols: [],
          });
        } else if (!inSrc && inTgt) {
          diffs.push({
            key: k,
            type: "added",
            targetRow: tgtMap.get(k),
            diffCols: [],
          });
        } else {
          const sRow = srcMap.get(k)!;
          const tRow = tgtMap.get(k)!;
          const diffCols: string[] = [];

          shared.forEach((col) => {
            const sVal = sRow[col];
            const tVal = tRow[col];
            if (String(sVal ?? "") !== String(tVal ?? "")) {
              diffCols.push(col);
            }
          });

          if (diffCols.length > 0) {
            diffs.push({
              key: k,
              type: "modified",
              sourceRow: sRow,
              targetRow: tRow,
              diffCols,
            });
          } else {
            diffs.push({
              key: k,
              type: "identical",
              sourceRow: sRow,
              targetRow: tRow,
              diffCols: [],
            });
          }
        }
      });

      setDiffResults(diffs);
      setHasCompared(true);
      if (diffs.filter((d) => d.type !== "identical").length === 0) {
        setActiveFilter("all");
      } else {
        setActiveFilter("diffs");
      }
    } catch (err: any) {
      console.error("Comparison error:", err);
      showAlert(err?.message || String(err), { kind: "error" });
    } finally {
      setIsComparing(false);
    }
  };

  // Filtered diff rows
  const filteredDiffs = useMemo(() => {
    let list = diffResults;
    if (activeFilter === "diffs") {
      list = list.filter((d) => d.type !== "identical");
    } else if (activeFilter !== "all") {
      list = list.filter((d) => d.type === activeFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((d) => {
        if (d.key.toLowerCase().includes(q)) return true;
        const sStr = JSON.stringify(d.sourceRow || "").toLowerCase();
        const tStr = JSON.stringify(d.targetRow || "").toLowerCase();
        return sStr.includes(q) || tStr.includes(q);
      });
    }

    return list;
  }, [diffResults, activeFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const identical = diffResults.filter((d) => d.type === "identical").length;
    const modified = diffResults.filter((d) => d.type === "modified").length;
    const added = diffResults.filter((d) => d.type === "added").length;
    const deleted = diffResults.filter((d) => d.type === "deleted").length;
    const diffs = modified + added + deleted;
    return { identical, modified, added, deleted, diffs, total: diffResults.length };
  }, [diffResults]);

  // Generate Sync SQL
  const generateSyncSql = () => {
    const tableTargetRef = `"${tgtSchemaName}"."${tgtTable || "target_table"}"`;
    const lines: string[] = [];

    lines.push(`-- Synchronization SQL for ${tableTargetRef}`);
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push(`BEGIN;\n`);

    diffResults.forEach((d) => {
      if (d.type === "deleted" && d.sourceRow) {
        // Missing in target -> INSERT INTO target
        const cols = Object.keys(d.sourceRow).filter((c) => commonColumns.includes(c));
        const colList = cols.map((c) => `"${c}"`).join(", ");
        const valList = cols
          .map((c) => {
            const v = d.sourceRow![c];
            if (v === null || v === undefined) return "NULL";
            if (typeof v === "number") return String(v);
            if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
            return `'${String(v).replace(/'/g, "''")}'`;
          })
          .join(", ");
        lines.push(`-- Insert missing row (Key: ${d.key})\nINSERT INTO ${tableTargetRef} (${colList}) VALUES (${valList});\n`);
      } else if (d.type === "modified" && d.sourceRow) {
        // Modified -> UPDATE target SET ... WHERE key = ...
        const sets = d.diffCols.map((c) => {
          const v = d.sourceRow![c];
          if (v === null || v === undefined) return `"${c}" = NULL`;
          if (typeof v === "number") return `"${c}" = ${v}`;
          if (typeof v === "boolean") return `"${c}" = ${v ? "TRUE" : "FALSE"}`;
          return `"${c}" = '${String(v).replace(/'/g, "''")}'`;
        });
        const keyVal = isNaN(Number(d.key)) ? `'${d.key.replace(/'/g, "''")}'` : d.key;
        lines.push(`-- Update modified row (Key: ${d.key})\nUPDATE ${tableTargetRef} SET ${sets.join(", ")} WHERE "${keyColumn}" = ${keyVal};\n`);
      } else if (d.type === "added") {
        // Extra in target -> DELETE FROM target WHERE key = ...
        const keyVal = isNaN(Number(d.key)) ? `'${d.key.replace(/'/g, "''")}'` : d.key;
        lines.push(`-- Delete extraneous row (Key: ${d.key})\nDELETE FROM ${tableTargetRef} WHERE "${keyColumn}" = ${keyVal};\n`);
      }
    });

    lines.push(`COMMIT;`);
    setGeneratedSyncSql(lines.join("\n"));
    setShowSyncSqlModal(true);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[1040px] max-w-[96vw] h-[680px] max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-default bg-base shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <ArrowRightLeft size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-primary flex items-center gap-2">
                <span>{t("dataCompare.title", "Data Compare & Diff Tool")}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                  {t("dataCompare.badge", "DBeaver Style")}
                </span>
              </h2>
              <p className="text-xs text-secondary mt-0.5">
                {t("dataCompare.subtitle", "Compare rows and detect differences between tables or query results")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-secondary"
          >
            <X size={18} />
          </button>
        </div>

        {/* Source & Target Configuration Bar */}
        <div className="px-5 py-3 bg-surface-secondary border-b border-default shrink-0">
          <div className="grid grid-cols-12 gap-3 items-end">
            {/* Left Source */}
            <div className="col-span-5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-muted uppercase">
                <span>Source (A)</span>
                <span className="font-mono text-primary font-normal">{srcDbName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={srcConnId}
                  onChange={(e) => {
                    setSrcConnId(e.target.value);
                    loadTables(e.target.value, srcSchemaName, true);
                  }}
                  className="flex-1 px-2.5 py-1.5 bg-base border border-default rounded-lg text-xs text-primary"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={srcTable}
                  onChange={(e) => setSrcTable(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-base border border-default rounded-lg text-xs font-mono text-primary"
                >
                  <option value="">(Choose Table)</option>
                  {srcTables.map((tbl) => (
                    <option key={tbl} value={tbl}>
                      {tbl}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Middle Controls (Key Column & Compare Button) */}
            <div className="col-span-2 flex flex-col items-center justify-center space-y-1">
              <div className="text-[10px] text-muted font-medium">Key Column</div>
              <select
                value={keyColumn}
                onChange={(e) => setKeyColumn(e.target.value)}
                className="w-full px-2 py-1.5 bg-base border border-default rounded-lg text-xs font-mono text-primary text-center"
              >
                {commonColumns.length > 0 ? (
                  commonColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))
                ) : (
                  <option value="id">id</option>
                )}
              </select>
            </div>

            {/* Right Target */}
            <div className="col-span-5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-muted uppercase">
                <span>Target (B)</span>
                <span className="font-mono text-primary font-normal">{tgtDbName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={tgtConnId}
                  onChange={(e) => {
                    setTgtConnId(e.target.value);
                    loadTables(e.target.value, tgtSchemaName, false);
                  }}
                  className="flex-1 px-2.5 py-1.5 bg-base border border-default rounded-lg text-xs text-primary"
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={tgtTable}
                  onChange={(e) => setTgtTable(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-base border border-default rounded-lg text-xs font-mono text-primary"
                >
                  <option value="">(Choose Table)</option>
                  {tgtTables.map((tbl) => (
                    <option key={tbl} value={tbl}>
                      {tbl}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Results Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-base">
          {!hasCompared ? (
            /* Blank state before running comparison */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="p-4 rounded-full bg-surface-secondary border border-default text-muted">
                <ArrowRightLeft size={36} />
              </div>
              <div className="max-w-md space-y-1">
                <h3 className="text-sm font-semibold text-primary">
                  {t("dataCompare.readyTitle", "Ready to Compare Tables")}
                </h3>
                <p className="text-xs text-muted leading-relaxed">
                  {t(
                    "dataCompare.readyDesc",
                    "Select Source and Target tables above, ensure Key Column is matched, and click Run Compare."
                  )}
                </p>
              </div>
              <button
                type="button"
                disabled={isComparing}
                onClick={handleRunCompare}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-2"
              >
                {isComparing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Comparing Data...</span>
                  </>
                ) : (
                  <>
                    <Play size={14} fill="currentColor" />
                    <span>Run Compare</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            /* Diff Results View */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Diff Stats & Filter Bar */}
              <div className="px-5 py-2.5 border-b border-default bg-surface-secondary flex items-center justify-between gap-4 shrink-0">
                {/* Filter tabs */}
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setActiveFilter("diffs")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      activeFilter === "diffs"
                        ? "bg-amber-500/20 text-amber-400 font-semibold"
                        : "text-secondary hover:bg-surface"
                    }`}
                  >
                    Differences ({stats.diffs})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveFilter("modified")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      activeFilter === "modified"
                        ? "bg-amber-500/20 text-amber-400 font-semibold"
                        : "text-secondary hover:bg-surface"
                    }`}
                  >
                    Modified ({stats.modified})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveFilter("deleted")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      activeFilter === "deleted"
                        ? "bg-rose-500/20 text-rose-400 font-semibold"
                        : "text-secondary hover:bg-surface"
                    }`}
                  >
                    Missing in Target ({stats.deleted})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveFilter("added")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      activeFilter === "added"
                        ? "bg-emerald-500/20 text-emerald-400 font-semibold"
                        : "text-secondary hover:bg-surface"
                    }`}
                  >
                    Extra in Target ({stats.added})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveFilter("identical")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      activeFilter === "identical"
                        ? "bg-blue-500/20 text-blue-400 font-semibold"
                        : "text-secondary hover:bg-surface"
                    }`}
                  >
                    Identical ({stats.identical})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveFilter("all")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      activeFilter === "all"
                        ? "bg-surface text-primary font-semibold"
                        : "text-secondary hover:bg-surface"
                    }`}
                  >
                    All ({stats.total})
                  </button>
                </div>

                {/* Right controls: Search & Sync SQL */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-2 text-muted" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search rows..."
                      className="pl-7 pr-2.5 py-1 bg-base border border-default rounded-md text-xs text-primary focus:outline-none focus:border-blue-500 w-36"
                    />
                  </div>

                  {stats.diffs > 0 && (
                    <button
                      type="button"
                      onClick={generateSyncSql}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
                    >
                      <FileCode size={13} />
                      <span>Generate Sync SQL</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isComparing}
                    onClick={handleRunCompare}
                    title="Re-run compare"
                    className="p-1 border border-default rounded-md text-secondary hover:text-primary hover:bg-surface transition-colors"
                  >
                    <RefreshCw size={14} className={isComparing ? "animate-spin" : ""} />
                  </button>
                </div>
              </div>

              {/* Data Grid with Cell-level Diff Highlights */}
              <div className="flex-1 overflow-auto">
                {filteredDiffs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full p-8 text-center text-xs text-muted">
                    <CheckCircle2 size={32} className="text-emerald-400 mb-2 opacity-80" />
                    <span>No differences found under current filter.</span>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead className="sticky top-0 bg-elevated border-b border-default shadow-sm z-10">
                      <tr>
                        <th className="px-3 py-2 text-muted font-sans font-semibold w-12 text-center">Type</th>
                        <th className="px-3 py-2 text-primary font-semibold w-24">Key ({keyColumn})</th>
                        {commonColumns.map((col) => (
                          <th key={col} className="px-3 py-2 text-secondary font-sans font-semibold">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-default">
                      {filteredDiffs.map((diff) => {
                        const isMod = diff.type === "modified";
                        const isAdd = diff.type === "added";
                        const isDel = diff.type === "deleted";

                        return (
                          <tr
                            key={diff.key}
                            className={`transition-colors ${
                              isMod
                                ? "bg-amber-500/5 hover:bg-amber-500/10"
                                : isAdd
                                  ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                                  : isDel
                                    ? "bg-rose-500/5 hover:bg-rose-500/10"
                                    : "hover:bg-surface-secondary/40"
                            }`}
                          >
                            {/* Diff Type Badge */}
                            <td className="px-3 py-2 text-center">
                              {isMod && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400 font-sans font-semibold">
                                  MOD
                                </span>
                              )}
                              {isAdd && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 font-sans font-semibold">
                                  ADD
                                </span>
                              )}
                              {isDel && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-400 font-sans font-semibold">
                                  DEL
                                </span>
                              )}
                              {!isMod && !isAdd && !isDel && (
                                <span className="text-muted text-[10px]">•</span>
                              )}
                            </td>

                            {/* Key Column */}
                            <td className="px-3 py-2 font-bold text-primary">{diff.key}</td>

                            {/* Data Columns */}
                            {commonColumns.map((col) => {
                              const isColDiff = diff.diffCols.includes(col);
                              const sVal = diff.sourceRow ? String(diff.sourceRow[col] ?? "NULL") : "—";
                              const tVal = diff.targetRow ? String(diff.targetRow[col] ?? "NULL") : "—";

                              return (
                                <td
                                  key={col}
                                  className={`px-3 py-2 max-w-[200px] truncate ${
                                    isColDiff ? "bg-amber-500/15 text-amber-300 font-bold" : "text-secondary"
                                  }`}
                                  title={isColDiff ? `Source: ${sVal}\nTarget: ${tVal}` : sVal}
                                >
                                  {isColDiff ? (
                                    <div className="flex items-center gap-1">
                                      <span className="line-through opacity-70 text-rose-300">{sVal}</span>
                                      <span className="text-muted">➔</span>
                                      <span className="text-emerald-300">{tVal}</span>
                                    </div>
                                  ) : isDel ? (
                                    <span className="text-rose-300">{sVal}</span>
                                  ) : isAdd ? (
                                    <span className="text-emerald-300">{tVal}</span>
                                  ) : (
                                    <span>{sVal}</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-default bg-base flex items-center justify-between shrink-0">
          <div className="text-xs text-muted">
            {hasCompared && (
              <span>
                Compared {stats.total} total rows:{" "}
                <span className="text-amber-400 font-semibold">{stats.diffs} differences</span> (
                {stats.modified} modified, {stats.added} added, {stats.deleted} deleted)
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-surface-secondary hover:bg-surface border border-default text-primary rounded-lg text-xs font-medium transition-colors"
          >
            {t("common.close", "Close")}
          </button>
        </div>
      </div>

      {/* Sync SQL Modal */}
      {showSyncSqlModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[120] backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[600px] max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-default bg-base">
              <div className="flex items-center gap-2">
                <FileCode size={16} className="text-blue-400" />
                <h3 className="text-xs font-semibold text-primary">Generated Synchronization SQL</h3>
              </div>
              <button
                onClick={() => setShowSyncSqlModal(false)}
                className="text-secondary hover:text-primary transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto">
              <textarea
                readOnly
                value={generatedSyncSql}
                className="w-full h-80 px-3 py-2 bg-base border border-default rounded-lg text-xs font-mono text-primary focus:outline-none resize-none"
              />
            </div>

            <div className="p-3 border-t border-default bg-base flex justify-between items-center">
              <span className="text-[11px] text-muted">Review statements before executing in database.</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedSyncSql);
                    showAlert("SQL copied to clipboard!", { kind: "info" });
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                >
                  <Copy size={13} />
                  <span>Copy SQL</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSyncSqlModal(false)}
                  className="px-3 py-1.5 border border-default text-secondary hover:text-primary rounded-lg text-xs font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
