import React, { useState, useEffect, useMemo } from "react";
import {
  ArrowRightLeft,
  Play,
  Database,
  ArrowLeftRight,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../../hooks/useDatabase";
import { Button } from "../ui/Button";
import { DragDropCompareView } from "./DragDropCompareView";
import { TableauCanvasView } from "./TableauCanvasView";

export const CompareDataView: React.FC = () => {
  const {
    connections,
    activeConnectionId,
    openConnectionIds,
    tables,
    connectionDataMap,
    activeDatabaseName,
    activeSchema,
  } = useDatabase();

  const openConnections = useMemo(() => {
    return connections.filter((c) => openConnectionIds.includes(c.id));
  }, [connections, openConnectionIds]);

  const otherConnections = useMemo(() => {
    return connections.filter((c) => !openConnectionIds.includes(c.id));
  }, [connections, openConnectionIds]);

  // Fallback connections if list is empty
  const allConnections = useMemo(() => {
    if (connections.length > 0) return connections;
    return [
      { id: "localhost_pg", name: "Localhost", params: { driver: "postgres", database: "db_rakbaan" } },
      { id: "local_mongo", name: "Local MongoDB", params: { driver: "mongodb", database: "testDB" } },
    ];
  }, [connections]);

  const [srcConnId, setSrcConnId] = useState<string>(() => {
    if (openConnectionIds.length >= 1) return openConnectionIds[0];
    return activeConnectionId || allConnections[0]?.id || "default";
  });

  const [tgtConnId, setTgtConnId] = useState<string>(() => {
    if (openConnectionIds.length >= 2) return openConnectionIds[1];
    const nonActive = allConnections.find((c) => c.id !== activeConnectionId);
    return nonActive?.id || allConnections[1]?.id || allConnections[0]?.id || "target";
  });

  // Keep srcConnId and tgtConnId synchronized when openConnectionIds become available
  useEffect(() => {
    if (openConnectionIds.length >= 2) {
      setSrcConnId((prev) => (openConnectionIds.includes(prev) ? prev : openConnectionIds[0]));
      setTgtConnId((prev) => {
        if (openConnectionIds.includes(prev) && prev !== openConnectionIds[0]) return prev;
        return openConnectionIds[1];
      });
    } else if (connections.length >= 2 && srcConnId === tgtConnId) {
      const other = connections.find((c) => c.id !== srcConnId);
      if (other) setTgtConnId(other.id);
    }
  }, [openConnectionIds, connections]);

  const [srcAvailableDbs, setSrcAvailableDbs] = useState<string[]>([]);
  const [tgtAvailableDbs, setTgtAvailableDbs] = useState<string[]>([]);
  const [asyncSrcTables, setAsyncSrcTables] = useState<string[]>([]);
  const [asyncTgtTables, setAsyncTgtTables] = useState<string[]>([]);

  // Asynchronously fetch all available databases on the host/cluster
  useEffect(() => {
    let active = true;

    const fetchDbs = async (connId: string, setFn: (dbs: string[]) => void) => {
      if (!connId) return;
      try {
        const res = await invoke<string[]>("get_available_databases", { connectionId: connId });
        if (active && Array.isArray(res) && res.length > 0) {
          setFn(res);
        }
      } catch {
        // ignore fallback
      }
    };

    if (srcConnId) fetchDbs(srcConnId, setSrcAvailableDbs);
    if (tgtConnId) fetchDbs(tgtConnId, setTgtAvailableDbs);

    return () => {
      active = false;
    };
  }, [srcConnId, tgtConnId]);

  // Helper to extract databases / schemas for a given connection
  const getDatabasesForConnection = (connId: string): string[] => {
    const conn = allConnections.find((c) => c.id === connId);
    const connData = connectionDataMap?.[connId];
    const dbSet = new Set<string>();

    if (conn?.params?.database) {
      if (Array.isArray(conn.params.database)) {
        conn.params.database.forEach((d) => d && dbSet.add(d));
      } else if (typeof conn.params.database === "string") {
        dbSet.add(conn.params.database);
      }
    }

    if (connData?.databaseName) {
      dbSet.add(connData.databaseName);
    }

    if (connData?.selectedDatabases && Array.isArray(connData.selectedDatabases)) {
      connData.selectedDatabases.forEach((d) => d && dbSet.add(d));
    }
    if (connData?.databaseDataMap) {
      Object.keys(connData.databaseDataMap).forEach((d) => d && dbSet.add(d));
    }

    if (connData?.schemas && Array.isArray(connData.schemas)) {
      connData.schemas.forEach((s) => s && dbSet.add(s));
    }
    if (connData?.schemaDataMap) {
      Object.keys(connData.schemaDataMap).forEach((s) => s && dbSet.add(s));
    }

    if (connId === activeConnectionId) {
      if (activeDatabaseName) dbSet.add(activeDatabaseName);
      if (activeSchema) dbSet.add(activeSchema);
    }

    return Array.from(dbSet);
  };

  const sourceDbList = useMemo(() => {
    const fromContext = getDatabasesForConnection(srcConnId);
    const combined = Array.from(new Set([...srcAvailableDbs, ...fromContext]));
    if (combined.length > 0) return combined;
    const conn = allConnections.find((c) => c.id === srcConnId);
    if (conn?.params?.driver === "mongodb") return ["testDB", "admin"];
    return ["db_rakbaan", "postgres", "public"];
  }, [srcConnId, srcAvailableDbs, connectionDataMap, allConnections]);

  const targetDbList = useMemo(() => {
    const fromContext = getDatabasesForConnection(tgtConnId);
    const combined = Array.from(new Set([...tgtAvailableDbs, ...fromContext]));
    if (combined.length > 0) return combined;
    const conn = allConnections.find((c) => c.id === tgtConnId);
    if (conn?.params?.driver === "mongodb") return ["testDB", "admin"];
    return ["store_production", "db_rakbaan", "postgres", "public"];
  }, [tgtConnId, tgtAvailableDbs, connectionDataMap, allConnections]);

  const [sourceDb, setSourceDb] = useState<string>("");
  const [targetDb, setTargetDb] = useState<string>("");

  useEffect(() => {
    if (sourceDbList.length > 0 && (!sourceDb || !sourceDbList.includes(sourceDb))) {
      setSourceDb(sourceDbList[0]);
    }
  }, [sourceDbList]);

  useEffect(() => {
    if (targetDbList.length > 0 && (!targetDb || !targetDbList.includes(targetDb))) {
      setTargetDb(targetDbList[0]);
    }
  }, [targetDbList]);

  // Asynchronously fetch live tables using invoke when db or conn changes
  useEffect(() => {
    let active = true;

    const fetchTables = async (connId: string, dbOrSchema: string, setFn: (tbls: string[]) => void) => {
      if (!connId) return;
      try {
        const res = await invoke<{ name: string }[]>("get_tables", {
          connectionId: connId,
          schema: dbOrSchema || undefined,
          database: dbOrSchema || undefined,
        });
        if (active && Array.isArray(res) && res.length > 0) {
          setFn(res.map((t) => t.name));
        }
      } catch {
        // ignore
      }
    };

    if (srcConnId) fetchTables(srcConnId, sourceDb, setAsyncSrcTables);
    if (tgtConnId) fetchTables(tgtConnId, targetDb, setAsyncTgtTables);

    return () => {
      active = false;
    };
  }, [srcConnId, tgtConnId, sourceDb, targetDb]);

  // Extract tables from connectionDataMap across all schemas and databases
  const getTablesFromContext = (connId: string, dbName?: string): string[] => {
    const connData = connectionDataMap?.[connId];
    const tableSet = new Set<string>();

    if (connData) {
      if (dbName && connData.schemaDataMap?.[dbName]?.tables) {
        connData.schemaDataMap[dbName].tables.forEach((t) => t?.name && tableSet.add(t.name));
      }
      if (dbName && connData.databaseDataMap?.[dbName]?.tables) {
        connData.databaseDataMap[dbName].tables.forEach((t) => t?.name && tableSet.add(t.name));
      }

      if (tableSet.size === 0) {
        if (Array.isArray(connData.tables)) {
          connData.tables.forEach((t) => t?.name && tableSet.add(t.name));
        }
        if (connData.schemaDataMap) {
          Object.values(connData.schemaDataMap).forEach((sch) => {
            if (Array.isArray(sch?.tables)) {
              sch.tables.forEach((t) => t?.name && tableSet.add(t.name));
            }
          });
        }
        if (connData.databaseDataMap) {
          Object.values(connData.databaseDataMap).forEach((db) => {
            if (Array.isArray(db?.tables)) {
              db.tables.forEach((t) => t?.name && tableSet.add(t.name));
            }
          });
        }
      }
    }

    if (tableSet.size === 0 && connId === activeConnectionId && Array.isArray(tables)) {
      tables.forEach((t) => t?.name && tableSet.add(t.name));
    }

    return Array.from(tableSet);
  };

  const defaultTables = [
    "users",
    "orders",
    "order_items",
    "products",
    "audit_logs",
    "customer_accounts",
    "transactions",
    "sessions",
  ];

  const sourceTablesList = useMemo(() => {
    const ctx = getTablesFromContext(srcConnId, sourceDb);
    const combined = Array.from(new Set([...asyncSrcTables, ...ctx]));
    if (combined.length > 0) return combined;
    return defaultTables;
  }, [srcConnId, sourceDb, asyncSrcTables, connectionDataMap, activeConnectionId, tables]);

  const targetTablesList = useMemo(() => {
    const ctx = getTablesFromContext(tgtConnId, targetDb);
    const combined = Array.from(new Set([...asyncTgtTables, ...ctx]));
    if (combined.length > 0) return combined;
    return ["users_replica", ...defaultTables];
  }, [tgtConnId, targetDb, asyncTgtTables, connectionDataMap, activeConnectionId, tables]);

  const [sourceTable, setSourceTable] = useState("users");
  const [targetTable, setTargetTable] = useState("users_replica");

  // Keep selected table valid when table list changes
  useEffect(() => {
    if (sourceTablesList.length > 0 && !sourceTablesList.includes(sourceTable)) {
      setSourceTable(sourceTablesList.includes("users") ? "users" : sourceTablesList[0]);
    }
  }, [sourceTablesList]);

  useEffect(() => {
    if (targetTablesList.length > 0 && !targetTablesList.includes(targetTable)) {
      setTargetTable(
        targetTablesList.includes("users_replica")
          ? "users_replica"
          : targetTablesList.includes("users")
          ? "users"
          : targetTablesList[0]
      );
    }
  }, [targetTablesList]);

  const handleSwap = () => {
    const tempConn = srcConnId;
    setSrcConnId(tgtConnId);
    setTgtConnId(tempConn);

    const tempDb = sourceDb;
    setSourceDb(targetDb);
    setTargetDb(tempDb);

    const tempTable = sourceTable;
    setSourceTable(targetTable);
    setTargetTable(tempTable);
  };

  const [keyColumn, setKeyColumn] = useState("id");
  const [isComparing, setIsComparing] = useState(false);
  const [hasCompared, setHasCompared] = useState(true);
  const [diffFilter, setDiffFilter] = useState<"all" | "diffs" | "modified" | "added" | "deleted">("all");
  const [viewMode, setViewMode] = useState<"dropdown" | "dragdrop" | "tableau">("dropdown");

  const srcConnObj = allConnections.find((c) => c.id === srcConnId);
  const tgtConnObj = allConnections.find((c) => c.id === tgtConnId);

  const [diffRows] = useState([
    {
      key: "usr_1001",
      type: "identical",
      source: { id: "usr_1001", name: "Somchai Prasert", email: "somchai@company.com", role: "admin", status: "active" },
      target: { id: "usr_1001", name: "Somchai Prasert", email: "somchai@company.com", role: "admin", status: "active" },
      diffCols: [],
    },
    {
      key: "usr_1002",
      type: "modified",
      source: { id: "usr_1002", name: "Anong Sukjai", email: "anong.new@company.com", role: "editor", status: "active" },
      target: { id: "usr_1002", name: "Anong Sukjai", email: "anong.old@company.com", role: "editor", status: "inactive" },
      diffCols: ["email", "status"],
    },
    {
      key: "usr_1003",
      type: "added",
      source: { id: "usr_1003", name: "Wichai Thongdee", email: "wichai@company.com", role: "viewer", status: "active" },
      target: null,
      diffCols: ["all"],
    },
    {
      key: "usr_1004",
      type: "deleted",
      source: null,
      target: { id: "usr_1004", name: "Old Test User", email: "test@company.com", role: "viewer", status: "deprecated" },
      diffCols: ["all"],
    },
  ]);

  const handleRunCompare = () => {
    setIsComparing(true);
    setTimeout(() => {
      setIsComparing(false);
      setHasCompared(true);
    }, 600);
  };

  const filteredDiffs = diffRows.filter((r) => {
    if (diffFilter === "all") return true;
    if (diffFilter === "diffs") return r.type !== "identical";
    return r.type === diffFilter;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Apple-style Pill Segmented Mode Switcher */}
      <div className="flex items-center justify-center pt-1 pb-2">
        <div className="inline-flex items-center p-1 bg-surface-secondary/90 backdrop-blur-md border border-default rounded-full shadow-md gap-1">
          <button
            onClick={() => setViewMode("dropdown")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs transition-all ${
              viewMode === "dropdown"
                ? "bg-blue-600 text-white shadow-sm font-semibold"
                : "text-secondary hover:text-primary hover:bg-surface-elevated/60 font-medium"
            }`}
          >
            <span>🍏 Dropdown (Classic)</span>
          </button>
          <button
            onClick={() => setViewMode("dragdrop")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs transition-all ${
              viewMode === "dragdrop"
                ? "bg-blue-600 text-white shadow-sm font-semibold"
                : "text-secondary hover:text-primary hover:bg-surface-elevated/60 font-medium"
            }`}
          >
            <span>🖐️ Easy Drag & Drop</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-500/30 text-blue-100 font-normal">
              Non-tech
            </span>
          </button>
          <button
            onClick={() => setViewMode("tableau")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs transition-all ${
              viewMode === "tableau"
                ? "bg-blue-600 text-white shadow-sm font-semibold"
                : "text-secondary hover:text-primary hover:bg-surface-elevated/60 font-medium"
            }`}
          >
            <span>📊 Tableau Canvas</span>
          </button>
        </div>
      </div>

      {viewMode === "dropdown" && (
        <>
          {/* Header */}
          <div className="p-5 bg-elevated border border-strong rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-400">
                <ArrowRightLeft size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-primary tracking-tight">Compare Data</h1>
                  <span className="text-xs px-2.5 py-0.5 rounded-lg bg-surface-secondary text-secondary border border-default">
                    Data & Schema Diff
                  </span>
                </div>
                <p className="text-xs text-secondary mt-1">
                  เปรียบเทียบความแตกต่างของข้อมูลและ Schema ระหว่าง 2 ตารางหรือ 2 ฐานข้อมูลแบบ Row-by-Row
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-surface-secondary/70 border border-default px-3 py-1.5 rounded-xl">
                <span className="text-xs text-secondary font-medium">Key Column:</span>
                <select
                  value={keyColumn}
                  onChange={(e) => setKeyColumn(e.target.value)}
                  className="bg-transparent text-xs font-mono text-primary focus:outline-none cursor-pointer"
                >
                  <option value="id">id</option>
                  <option value="usr_id">usr_id</option>
                  <option value="email">email</option>
                  <option value="uuid">uuid</option>
                </select>
              </div>

              <Button
                variant="primary"
                size="sm"
                onClick={handleRunCompare}
                disabled={isComparing}
                className="flex items-center gap-2"
              >
                <Play size={14} className={isComparing ? "animate-spin" : ""} />
                <span>{isComparing ? "กำลังเปรียบเทียบ..." : "เริ่มเปรียบเทียบ (Compare)"}</span>
              </Button>
            </div>
          </div>

      {/* Comparison Source & Target Setup */}
      <div className="relative grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
        {/* Source Box */}
        <div className="p-5 bg-elevated border border-default rounded-2xl space-y-4 shadow-sm relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-400">
              <Database size={16} />
              <span>Source (ต้นทาง)</span>
            </div>
            <div className="flex items-center gap-1.5">
              {srcConnObj?.params?.driver && (
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {srcConnObj.params.driver}
                </span>
              )}
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-surface-secondary text-secondary border border-default">
                Origin
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {/* 1. Database / Connection */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-secondary">Database / Connection</label>
                {openConnectionIds.includes(srcConnId) && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Open in Rail
                  </span>
                )}
              </div>
              <select
                value={srcConnId}
                onChange={(e) => setSrcConnId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-secondary border border-default rounded-xl text-xs text-primary focus:outline-none focus:border-blue-500 cursor-pointer transition-colors"
              >
                {openConnections.length > 0 && (
                  <optgroup label="⚡ Open Connections (เปิดใช้งานในแถบซ้าย)">
                    {openConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        🟢 {c.name} {c.params?.driver ? `(${c.params.driver})` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherConnections.length > 0 && (
                  <optgroup label="Saved Connections">
                    {otherConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.params?.driver ? `(${c.params.driver})` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {openConnections.length === 0 &&
                  otherConnections.length === 0 &&
                  allConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.params?.driver ? `(${c.params.driver})` : ""}
                    </option>
                  ))}
              </select>
            </div>

            {/* 2. Database / Schema Dropdown */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-secondary">Database / Schema</label>
                <span className="text-[10px] font-mono text-muted">
                  {sourceDbList.length} database{sourceDbList.length === 1 ? "" : "s"}
                </span>
              </div>
              <select
                value={sourceDb}
                onChange={(e) => setSourceDb(e.target.value)}
                className="w-full px-3 py-2 bg-surface-secondary border border-default rounded-xl text-xs font-mono text-primary focus:outline-none focus:border-blue-500 cursor-pointer transition-colors"
              >
                {sourceDbList.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Table Name Dropdown */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-secondary">Table Name</label>
                <span className="text-[10px] font-mono text-muted">
                  {sourceTablesList.length} table{sourceTablesList.length === 1 ? "" : "s"}
                </span>
              </div>
              <select
                value={sourceTable}
                onChange={(e) => setSourceTable(e.target.value)}
                className="w-full px-3 py-2 bg-surface-secondary border border-default rounded-xl text-xs font-mono text-primary focus:outline-none focus:border-blue-500 cursor-pointer transition-colors"
              >
                {sourceTablesList.map((tbl) => (
                  <option key={tbl} value={tbl}>
                    {tbl}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Floating Swap Button in Middle */}
        <button
          onClick={handleSwap}
          title="Swap Source and Target (สลับต้นทางและปลายทาง)"
          className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 p-2.5 bg-surface-elevated border border-strong rounded-full shadow-lg text-secondary hover:text-blue-400 hover:scale-110 active:scale-95 transition-all"
        >
          <ArrowLeftRight size={16} />
        </button>

        {/* Target Box */}
        <div className="p-5 bg-elevated border border-default rounded-2xl space-y-4 shadow-sm relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
              <Database size={16} />
              <span>Target (ปลายทาง / Replica)</span>
            </div>
            <div className="flex items-center gap-1.5">
              {tgtConnObj?.params?.driver && (
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {tgtConnObj.params.driver}
                </span>
              )}
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-surface-secondary text-secondary border border-default">
                Target
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {/* 1. Database / Connection */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-secondary">Database / Connection</label>
                {openConnectionIds.includes(tgtConnId) && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Open in Rail
                  </span>
                )}
              </div>
              <select
                value={tgtConnId}
                onChange={(e) => setTgtConnId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-secondary border border-default rounded-xl text-xs text-primary focus:outline-none focus:border-emerald-500 cursor-pointer transition-colors"
              >
                {openConnections.length > 0 && (
                  <optgroup label="⚡ Open Connections (เปิดใช้งานในแถบซ้าย)">
                    {openConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        🟢 {c.name} {c.params?.driver ? `(${c.params.driver})` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherConnections.length > 0 && (
                  <optgroup label="Saved Connections">
                    {otherConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.params?.driver ? `(${c.params.driver})` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {openConnections.length === 0 &&
                  otherConnections.length === 0 &&
                  allConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.params?.driver ? `(${c.params.driver})` : ""}
                    </option>
                  ))}
              </select>
            </div>

            {/* 2. Database / Schema Dropdown */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-secondary">Database / Schema</label>
                <span className="text-[10px] font-mono text-muted">
                  {targetDbList.length} database{targetDbList.length === 1 ? "" : "s"}
                </span>
              </div>
              <select
                value={targetDb}
                onChange={(e) => setTargetDb(e.target.value)}
                className="w-full px-3 py-2 bg-surface-secondary border border-default rounded-xl text-xs font-mono text-primary focus:outline-none focus:border-emerald-500 cursor-pointer transition-colors"
              >
                {targetDbList.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Table Name Dropdown */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-secondary">Table Name</label>
                <span className="text-[10px] font-mono text-muted">
                  {targetTablesList.length} table{targetTablesList.length === 1 ? "" : "s"}
                </span>
              </div>
              <select
                value={targetTable}
                onChange={(e) => setTargetTable(e.target.value)}
                className="w-full px-3 py-2 bg-surface-secondary border border-default rounded-xl text-xs font-mono text-primary focus:outline-none focus:border-emerald-500 cursor-pointer transition-colors"
              >
                {targetTablesList.map((tbl) => (
                  <option key={tbl} value={tbl}>
                    {tbl}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
        </>
      )}

      {viewMode === "dragdrop" && (
        <DragDropCompareView
          allConnections={allConnections}
          openConnections={openConnections}
          sourceTablesList={sourceTablesList}
          targetTablesList={targetTablesList}
          sourceConnId={srcConnId}
          targetConnId={tgtConnId}
          sourceDb={sourceDb}
          targetDb={targetDb}
          sourceTable={sourceTable}
          targetTable={targetTable}
          onSelectSourceTable={setSourceTable}
          onSelectTargetTable={setTargetTable}
          onSwap={handleSwap}
          onRunCompare={handleRunCompare}
          isComparing={isComparing}
        />
      )}

      {viewMode === "tableau" && (
        <TableauCanvasView
          sourceConnName={srcConnObj?.name || "Source DB"}
          targetConnName={tgtConnObj?.name || "Target DB"}
          sourceDb={sourceDb}
          targetDb={targetDb}
          sourceTable={sourceTable}
          targetTable={targetTable}
          keyColumn={keyColumn}
          onSetKeyColumn={setKeyColumn}
          onRunCompare={handleRunCompare}
          isComparing={isComparing}
        />
      )}

      {/* Comparison Results Summary & Filters */}
      {hasCompared && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 bg-elevated border border-default rounded-xl text-center">
              <span className="text-xs text-secondary">Identical Rows</span>
              <div className="text-xl font-bold text-emerald-400 font-mono mt-1">1,240</div>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl text-center">
              <span className="text-xs text-secondary">Modified Rows</span>
              <div className="text-xl font-bold text-amber-400 font-mono mt-1">14</div>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl text-center">
              <span className="text-xs text-secondary">Added in Source</span>
              <div className="text-xl font-bold text-blue-400 font-mono mt-1">3</div>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl text-center">
              <span className="text-xs text-secondary">Deleted / Missing</span>
              <div className="text-xl font-bold text-rose-400 font-mono mt-1">1</div>
            </div>
          </div>

          {/* Diff Filters */}
          <div className="flex items-center gap-2 border-b border-default pb-2">
            <button
              onClick={() => setDiffFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                diffFilter === "all" ? "bg-blue-500/20 text-blue-400 border border-blue-500/40" : "text-secondary hover:text-primary"
              }`}
            >
              ทั้งหมด (All)
            </button>
            <button
              onClick={() => setDiffFilter("diffs")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                diffFilter === "diffs" ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "text-secondary hover:text-primary"
              }`}
            >
              เฉพาะที่มีผลต่าง (Differences Only)
            </button>
            <button
              onClick={() => setDiffFilter("modified")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                diffFilter === "modified" ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "text-secondary hover:text-primary"
              }`}
            >
              Modified
            </button>
            <button
              onClick={() => setDiffFilter("added")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                diffFilter === "added" ? "bg-blue-500/20 text-blue-400 border border-blue-500/40" : "text-secondary hover:text-primary"
              }`}
            >
              Added
            </button>
            <button
              onClick={() => setDiffFilter("deleted")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                diffFilter === "deleted" ? "bg-rose-500/20 text-rose-400 border border-rose-500/40" : "text-secondary hover:text-primary"
              }`}
            >
              Deleted
            </button>
          </div>

          {/* Results Table */}
          <div className="border border-default rounded-2xl overflow-hidden bg-elevated shadow-sm">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-surface-secondary/70 border-b border-default text-muted uppercase text-[10px]">
                <tr>
                  <th className="py-3 px-4 w-32">Key ({keyColumn})</th>
                  <th className="py-3 px-4 w-28">Status</th>
                  <th className="py-3 px-4">Source Value</th>
                  <th className="py-3 px-4">Target Value</th>
                  <th className="py-3 px-4 w-36">Diff Columns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default/40">
                {filteredDiffs.map((row) => (
                  <tr key={row.key} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="py-3 px-4 text-primary font-bold">{row.key}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          row.type === "identical"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : row.type === "modified"
                            ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                            : row.type === "added"
                            ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                            : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                        }`}
                      >
                        {row.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-secondary text-xs truncate max-w-xs">
                      {row.source ? JSON.stringify(row.source) : <span className="text-muted italic">NULL / None</span>}
                    </td>
                    <td className="py-3 px-4 text-secondary text-xs truncate max-w-xs">
                      {row.target ? JSON.stringify(row.target) : <span className="text-muted italic">NULL / None</span>}
                    </td>
                    <td className="py-3 px-4 text-amber-400 font-bold">
                      {row.diffCols.length > 0 ? row.diffCols.join(", ") : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
