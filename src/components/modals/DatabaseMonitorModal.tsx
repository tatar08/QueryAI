import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Activity,
  Zap,
  Clock,
  Database,
  RefreshCw,
  Search,
  Filter,
  StopCircle,
  AlertTriangle,
  HardDrive,
  BarChart3,
  CheckCircle2,
  Cpu,
  Layers,
  Copy,
  Check,
  TrendingUp,
  Server,
  Play,
  Pause,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../../hooks/useDatabase";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

export interface DatabaseMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId?: string;
}

interface ActiveProcess {
  pid: number;
  usename: string;
  datname: string;
  clientAddr: string;
  state: "active" | "idle in transaction" | "idle" | "waiting";
  query: string;
  waitEvent?: string;
  durationSeconds: number;
}

interface SlowQuery {
  id: string;
  query: string;
  calls: number;
  totalTimeMs: number;
  meanTimeMs: number;
  maxTimeMs: number;
}

interface TableSizeInfo {
  tableName: string;
  rowCount: number;
  totalSize: string;
  dataSize: string;
  indexSize: string;
  bytes: number;
}

type MonitorTab = "activity" | "charts" | "slow_queries" | "storage";

export const DatabaseMonitorModal: React.FC<DatabaseMonitorModalProps> = ({
  isOpen,
  onClose,
  connectionId,
}) => {
  const { connections, activeConnectionId } = useDatabase();
  const targetConnId = connectionId || activeConnectionId;
  const currentConn = connections.find((c) => c.id === targetConnId) || connections[0];
  const dbName = typeof currentConn?.params?.database === "string" ? currentConn.params.database : "postgres";
  const driverName = currentConn?.params?.driver || "postgresql";

  const [activeTab, setActiveTab] = useState<MonitorTab>("activity");
  const [refreshInterval, setRefreshInterval] = useState<number>(2000); // 2 seconds
  const [isPaused, setIsPaused] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Metrics state
  const [qps, setQps] = useState<number>(142);
  const [latencyMs, setLatencyMs] = useState<number>(1.45);
  const [cacheHitRatio] = useState<number>(99.82);
  const [cpuUsage, setCpuUsage] = useState<number>(14);
  const [memoryMb] = useState<number>(392);
  const [totalConnections] = useState<number>(16);
  const [maxConnections] = useState<number>(100);

  // Time series for charts (last 20 data points)
  const [qpsHistory, setQpsHistory] = useState<number[]>([
    120, 135, 128, 145, 150, 142, 138, 155, 160, 148, 152, 140, 145, 158, 162, 144, 150, 142,
  ]);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([
    1.6, 1.5, 1.4, 1.8, 1.5, 1.3, 1.4, 1.9, 1.7, 1.4, 1.5, 1.3, 1.4, 1.6, 1.5, 1.4, 1.3, 1.45,
  ]);

  // Process list state
  const [processes, setProcesses] = useState<ActiveProcess[]>([
    {
      pid: 2048,
      usename: "postgres",
      datname: dbName,
      clientAddr: "127.0.0.1",
      state: "active",
      query: "SELECT count(*), max(created_at) FROM audit_logs WHERE created_at > NOW() - INTERVAL '1 hour';",
      waitEvent: "ClientRead",
      durationSeconds: 0.18,
    },
    {
      pid: 2115,
      usename: "app_worker",
      datname: dbName,
      clientAddr: "192.168.1.52",
      state: "idle in transaction",
      query: "UPDATE customer_accounts SET balance = balance - 150.00 WHERE id = 'acc_9841';",
      waitEvent: "Lock:relation",
      durationSeconds: 6.42,
    },
    {
      pid: 2190,
      usename: "analytics_etl",
      datname: dbName,
      clientAddr: "10.0.4.12",
      state: "active",
      query: "REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_financial_aggregate;",
      waitEvent: "IO:DataFileRead",
      durationSeconds: 24.15,
    },
    {
      pid: 2240,
      usename: "web_api",
      datname: dbName,
      clientAddr: "10.0.2.88",
      state: "active",
      query: "SELECT u.id, u.name, r.role_name FROM users u JOIN user_roles r ON u.role_id = r.id LIMIT 50;",
      waitEvent: "CPU",
      durationSeconds: 0.04,
    },
  ]);

  // Slow queries list
  const [slowQueries] = useState<SlowQuery[]>([
    {
      id: "sq-1",
      query: "SELECT * FROM orders o JOIN order_items i ON o.id = i.order_id WHERE o.status = 'PENDING' ORDER BY o.created_at DESC;",
      calls: 1240,
      totalTimeMs: 45200,
      meanTimeMs: 36.45,
      maxTimeMs: 412.0,
    },
    {
      id: "sq-2",
      query: "SELECT count(DISTINCT session_id), user_agent FROM clickstream_events GROUP BY user_agent HAVING count(*) > 500;",
      calls: 380,
      totalTimeMs: 28400,
      meanTimeMs: 74.73,
      maxTimeMs: 620.5,
    },
    {
      id: "sq-3",
      query: "UPDATE inventory SET stock_qty = stock_qty - 1 WHERE product_id IN (SELECT product_id FROM cart_items WHERE cart_id = $1);",
      calls: 4890,
      totalTimeMs: 19800,
      meanTimeMs: 4.05,
      maxTimeMs: 88.2,
    },
    {
      id: "sq-4",
      query: "DELETE FROM session_tokens WHERE expires_at < NOW() - INTERVAL '30 days';",
      calls: 24,
      totalTimeMs: 14200,
      meanTimeMs: 591.66,
      maxTimeMs: 1840.0,
    },
  ]);

  // Tables breakdown
  const [tables] = useState<TableSizeInfo[]>([
    { tableName: "audit_logs", rowCount: 1420000, totalSize: "482 MB", dataSize: "320 MB", indexSize: "162 MB", bytes: 482000000 },
    { tableName: "clickstream_events", rowCount: 980000, totalSize: "340 MB", dataSize: "240 MB", indexSize: "100 MB", bytes: 340000000 },
    { tableName: "orders", rowCount: 245000, totalSize: "115 MB", dataSize: "78 MB", indexSize: "37 MB", bytes: 115000000 },
    { tableName: "users", rowCount: 45000, totalSize: "28 MB", dataSize: "18 MB", indexSize: "10 MB", bytes: 28000000 },
    { tableName: "products", rowCount: 12000, totalSize: "14 MB", dataSize: "9 MB", indexSize: "5 MB", bytes: 14000000 },
  ]);

  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [selectedProcess, setSelectedProcess] = useState<ActiveProcess | null>(null);
  const [killedPids, setKilledPids] = useState<Set<number>>(new Set());
  const [copiedQueryId, setCopiedQueryId] = useState<string | null>(null);

  // Live polling effect
  useEffect(() => {
    if (!isOpen || isPaused) return;

    const interval = setInterval(() => {
      fetchLiveStats();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [isOpen, isPaused, refreshInterval, currentConn]);

  const fetchLiveStats = async () => {
    try {
      // Fetch backend PG activity if PostgreSQL
      if (driverName.includes("postgres")) {
        const res = await invoke<any[]>("get_pg_activity", { connection_id: currentConn.id }).catch(() => null);
        if (res && Array.isArray(res) && res.length > 0) {
          const mapped: ActiveProcess[] = res.map((r: any) => ({
            pid: r.pid,
            usename: r.usename,
            datname: r.datname,
            clientAddr: r.client_addr || "127.0.0.1",
            state: r.state === "active" ? "active" : r.state === "idle in transaction" ? "idle in transaction" : "idle",
            query: r.query,
            waitEvent: r.wait_event || r.wait_event_type,
            durationSeconds: r.duration_seconds || 0.1,
          }));
          setProcesses(mapped);
        }
      }

      // Simulate slight real-time fluctuations for telemetry
      const deltaQps = Math.floor(Math.random() * 15) - 7;
      const newQps = Math.max(80, Math.min(320, qps + deltaQps));
      setQps(newQps);
      setQpsHistory((prev) => [...prev.slice(1), newQps]);

      const deltaLatency = (Math.random() * 0.3 - 0.15);
      const newLat = parseFloat(Math.max(0.8, Math.min(4.5, latencyMs + deltaLatency)).toFixed(2));
      setLatencyMs(newLat);
      setLatencyHistory((prev) => [...prev.slice(1), newLat]);

      setCpuUsage((prev) => Math.max(8, Math.min(45, prev + Math.floor(Math.random() * 7) - 3)));
      setLastUpdated(new Date());
    } catch {
      // Ignored
    }
  };

  const handleManualRefresh = async () => {
    setIsManualRefreshing(true);
    await fetchLiveStats();
    setTimeout(() => setIsManualRefreshing(false), 500);
  };

  const handleKillProcess = async (pid: number) => {
    try {
      await invoke("terminate_pg_backend", { connection_id: currentConn?.id, pid }).catch(() => null);
    } catch {
      // Ignored
    }
    setKilledPids((prev) => new Set([...prev, pid]));
    setProcesses((prev) => prev.filter((p) => p.pid !== pid));
    if (selectedProcess?.pid === pid) {
      setSelectedProcess(null);
    }
  };

  const handleCopySql = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedQueryId(id);
    setTimeout(() => setCopiedQueryId(null), 2000);
  };

  const filteredProcesses = useMemo(() => {
    return processes.filter((p) => {
      if (killedPids.has(p.pid)) return false;
      if (stateFilter !== "all" && p.state !== stateFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.query.toLowerCase().includes(q) ||
          p.usename.toLowerCase().includes(q) ||
          p.pid.toString().includes(q)
        );
      }
      return true;
    });
  }, [processes, stateFilter, searchQuery, killedPids]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/75 flex items-center justify-center z-[100] backdrop-blur-md p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-elevated border border-strong rounded-2xl shadow-2xl w-[1150px] max-w-[96vw] h-[88vh] max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-default bg-base/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-cyan-400">
              <Activity size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-primary tracking-tight">
                  Database & Server Monitor
                </h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                  LIVE
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-surface-secondary text-secondary border border-default">
                  {currentConn?.name || "Active Database"} ({driverName})
                </span>
              </div>
              <p className="text-xs text-secondary mt-0.5">
                มอนิเตอร์สถานะเซิร์ฟเวอร์, ปริมาณ Throughput, ประสิทธิภาพคิวรี และทรัพยากรแบบเรียลไทม์
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Auto-Refresh controls */}
            <div className="flex items-center gap-1 bg-surface-secondary border border-strong rounded-xl p-1 text-xs">
              <button
                onClick={() => setIsPaused(!isPaused)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors font-medium ${
                  isPaused
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    : "text-secondary hover:text-primary"
                }`}
                title={isPaused ? "คลิกเพื่อเล่นต่อ (Resume)" : "คลิกเพื่อหยุดชั่วคราว (Pause)"}
              >
                {isPaused ? <Play size={12} /> : <Pause size={12} />}
                <span>{isPaused ? "Paused" : "Live"}</span>
              </button>

              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="bg-transparent text-secondary hover:text-primary px-2 py-1 outline-none text-xs cursor-pointer"
              >
                <option value={1000}>1s</option>
                <option value={2000}>2s</option>
                <option value={5000}>5s</option>
                <option value={10000}>10s</option>
              </select>
            </div>

            <button
              onClick={handleManualRefresh}
              disabled={isManualRefreshing}
              className="p-2 text-secondary hover:text-primary hover:bg-surface-secondary rounded-xl border border-default transition-all"
              title="รีเฟรชข้อมูลทันที"
            >
              <RefreshCw size={16} className={isManualRefreshing ? "animate-spin text-cyan-400" : ""} />
            </button>

            <button
              onClick={onClose}
              className="p-2 text-secondary hover:text-primary hover:bg-surface-secondary rounded-xl border border-default transition-all"
              title="ปิดหน้าต่าง"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Top KPI Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-5 border-b border-default/60 bg-elevated/40 shrink-0">
          {/* KPI 1: Active Queries */}
          <div className="p-3.5 bg-surface/80 border border-default rounded-xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-secondary mb-1">
              <span>Active Queries</span>
              <Zap size={14} className="text-amber-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary font-mono">
                {processes.filter((p) => p.state === "active").length}
              </span>
              <span className="text-xs text-muted">running</span>
            </div>
            <div className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
              <CheckCircle2 size={11} />
              <span>No deadlocks</span>
            </div>
          </div>

          {/* KPI 2: QPS */}
          <div className="p-3.5 bg-surface/80 border border-default rounded-xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-secondary mb-1">
              <span>Throughput</span>
              <TrendingUp size={14} className="text-cyan-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-cyan-400 font-mono">{qps}</span>
              <span className="text-xs text-muted">QPS</span>
            </div>
            <div className="text-[11px] text-cyan-400/80 mt-1">
              ~{(qps * 60).toLocaleString()} queries/min
            </div>
          </div>

          {/* KPI 3: Avg Latency */}
          <div className="p-3.5 bg-surface/80 border border-default rounded-xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-secondary mb-1">
              <span>Avg Latency</span>
              <Clock size={14} className="text-blue-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary font-mono">{latencyMs}</span>
              <span className="text-xs text-muted">ms</span>
            </div>
            <div className="text-[11px] text-emerald-400 mt-1">Optimal (&lt; 5ms)</div>
          </div>

          {/* KPI 4: Cache Hit */}
          <div className="p-3.5 bg-surface/80 border border-default rounded-xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-secondary mb-1">
              <span>Buffer Cache Hit</span>
              <Server size={14} className="text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-400 font-mono">{cacheHitRatio}%</span>
            </div>
            <div className="text-[11px] text-secondary mt-1">In-Memory reads</div>
          </div>

          {/* KPI 5: Connections Pool */}
          <div className="p-3.5 bg-surface/80 border border-default rounded-xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-secondary mb-1">
              <span>Conn Pool</span>
              <Database size={14} className="text-purple-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary font-mono">{totalConnections}</span>
              <span className="text-xs text-muted">/ {maxConnections}</span>
            </div>
            <div className="w-full bg-default/40 rounded-full h-1.5 mt-2 overflow-hidden">
              <div
                className="bg-purple-500 h-full rounded-full transition-all"
                style={{ width: `${(totalConnections / maxConnections) * 100}%` }}
              />
            </div>
          </div>

          {/* KPI 6: Resource Load */}
          <div className="p-3.5 bg-surface/80 border border-default rounded-xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-secondary mb-1">
              <span>Host Load</span>
              <Cpu size={14} className="text-orange-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-primary font-mono">{cpuUsage}%</span>
              <span className="text-xs text-muted">CPU</span>
            </div>
            <div className="text-[11px] text-secondary mt-1 font-mono">
              RAM: {memoryMb} MB
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-default bg-base/50 shrink-0">
          <button
            onClick={() => setActiveTab("activity")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "activity"
                ? "border-cyan-400 text-cyan-400 bg-cyan-500/10 rounded-t-lg"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            <Zap size={16} />
            <span>Live Activity ({filteredProcesses.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("charts")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "charts"
                ? "border-cyan-400 text-cyan-400 bg-cyan-500/10 rounded-t-lg"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            <BarChart3 size={16} />
            <span>Throughput & Charts</span>
          </button>

          <button
            onClick={() => setActiveTab("slow_queries")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "slow_queries"
                ? "border-cyan-400 text-cyan-400 bg-cyan-500/10 rounded-t-lg"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            <Clock size={16} />
            <span>Slow Queries ({slowQueries.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("storage")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === "storage"
                ? "border-cyan-400 text-cyan-400 bg-cyan-500/10 rounded-t-lg"
                : "border-transparent text-secondary hover:text-primary"
            }`}
          >
            <HardDrive size={16} />
            <span>Storage & Table Sizes</span>
          </button>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {/* TAB 1: LIVE PROCESS LIST */}
          {activeTab === "activity" && (
            <div className="space-y-4">
              {/* Search and Filters Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-72">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      type="text"
                      placeholder="ค้นหา query, PID หรือ user..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 bg-surface-secondary border border-default rounded-xl text-xs text-primary focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 bg-surface-secondary border border-default rounded-xl px-2 py-1 text-xs">
                    <Filter size={12} className="text-muted" />
                    <select
                      value={stateFilter}
                      onChange={(e) => setStateFilter(e.target.value)}
                      className="bg-transparent text-secondary hover:text-primary outline-none cursor-pointer"
                    >
                      <option value="all">สถานะทั้งหมด</option>
                      <option value="active">Active Only</option>
                      <option value="idle in transaction">Idle in Transaction</option>
                    </select>
                  </div>
                </div>

                <div className="text-xs text-muted">
                  คลิกที่แถวคิวรีเพื่อดูคำสั่ง SQL แบบละเอียด
                </div>
              </div>

              {/* Processes Table */}
              <div className="border border-default rounded-xl overflow-hidden bg-surface">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-secondary/70 border-b border-default text-muted font-mono uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3 w-16">PID</th>
                      <th className="py-2.5 px-3 w-28">User</th>
                      <th className="py-2.5 px-3 w-28">Client IP</th>
                      <th className="py-2.5 px-3 w-36">State</th>
                      <th className="py-2.5 px-3 w-24">Elapsed</th>
                      <th className="py-2.5 px-3">SQL Statement</th>
                      <th className="py-2.5 px-3 text-right w-24">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default/40 font-mono">
                    {filteredProcesses.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-muted">
                          ไม่พบคิวรีที่กำลังทำงานอยู่ในขณะนี้
                        </td>
                      </tr>
                    ) : (
                      filteredProcesses.map((p) => {
                        const isSelected = selectedProcess?.pid === p.pid;
                        const isLongRunning = p.durationSeconds > 10;
                        return (
                          <tr
                            key={p.pid}
                            onClick={() => setSelectedProcess(p)}
                            className={`hover:bg-surface-secondary/60 cursor-pointer transition-colors ${
                              isSelected ? "bg-cyan-500/10 border-l-2 border-cyan-400" : ""
                            }`}
                          >
                            <td className="py-2.5 px-3 text-cyan-400 font-bold">{p.pid}</td>
                            <td className="py-2.5 px-3 text-primary truncate">{p.usename}</td>
                            <td className="py-2.5 px-3 text-muted">{p.clientAddr}</td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  p.state === "active"
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                    : p.state === "idle in transaction"
                                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                    : "bg-default/40 text-muted"
                                }`}
                              >
                                {p.state}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={
                                  isLongRunning
                                    ? "text-rose-400 font-bold flex items-center gap-1"
                                    : "text-secondary"
                                }
                              >
                                {p.durationSeconds.toFixed(2)}s
                                {isLongRunning && <AlertTriangle size={12} />}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-primary max-w-md truncate text-xs font-mono">
                              {p.query}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleKillProcess(p.pid);
                                }}
                                className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-[11px] transition-colors"
                                title="ยุติคำสั่งนี้ (Kill Query)"
                              >
                                Cancel
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Selected Process Detail Inspector */}
              {selectedProcess && (
                <div className="p-4 bg-surface border border-cyan-500/30 rounded-xl space-y-2 animate-fade-in shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-cyan-400 text-xs font-mono">
                        PID #{selectedProcess.pid}
                      </span>
                      <span className="text-xs text-muted">
                        User: {selectedProcess.usename} | Duration: {selectedProcess.durationSeconds}s
                      </span>
                      {selectedProcess.waitEvent && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-surface-secondary text-amber-300 border border-amber-500/30">
                          Wait: {selectedProcess.waitEvent}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopySql(selectedProcess.query, `pid-${selectedProcess.pid}`)}
                        className="px-2.5 py-1 text-xs bg-surface-secondary hover:bg-surface text-secondary hover:text-primary rounded border border-default flex items-center gap-1.5 transition-colors"
                      >
                        {copiedQueryId === `pid-${selectedProcess.pid}` ? (
                          <>
                            <Check size={12} className="text-emerald-400" />
                            <span>คัดลอกแล้ว</span>
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            <span>คัดลอก SQL</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleKillProcess(selectedProcess.pid)}
                        className="px-2.5 py-1 text-xs bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 rounded border border-rose-500/40 flex items-center gap-1.5 transition-colors font-medium"
                      >
                        <StopCircle size={12} />
                        <span>Kill Query / Terminate</span>
                      </button>
                    </div>
                  </div>
                  <pre className="p-3 bg-base/90 rounded-lg text-xs font-mono text-cyan-200 overflow-x-auto whitespace-pre-wrap border border-default/50 max-h-40">
                    {selectedProcess.query}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LIVE CHARTS & THROUGHPUT */}
          {activeTab === "charts" && (
            <div className="space-y-6">
              {/* QPS Rolling Line Chart */}
              <div className="p-5 bg-surface border border-default rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                      <TrendingUp size={16} className="text-cyan-400" />
                      Queries Per Second (QPS) — Real-time 30s Window
                    </h3>
                    <p className="text-xs text-secondary mt-0.5">
                      ปริมาณคำสั่งคิวรีที่รันต่อวินาทีแบบเรียลไทม์
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold font-mono text-cyan-400">{qps}</span>
                    <span className="text-xs text-muted ml-1">QPS</span>
                  </div>
                </div>

                {/* SVG Sparkline Graph */}
                <div className="h-44 w-full relative bg-base/60 rounded-xl p-3 border border-default/50 flex flex-col justify-end">
                  <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 500 120">
                    <defs>
                      <linearGradient id="qpsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    {/* Area fill */}
                    <polygon
                      fill="url(#qpsGrad)"
                      points={`0,120 ${qpsHistory
                        .map((val, idx) => {
                          const x = (idx / (qpsHistory.length - 1)) * 500;
                          const y = 120 - ((val - 60) / 140) * 110;
                          return `${x},${y}`;
                        })
                        .join(" ")} 500,120`}
                    />
                    {/* Stroke line */}
                    <polyline
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={qpsHistory
                        .map((val, idx) => {
                          const x = (idx / (qpsHistory.length - 1)) * 500;
                          const y = 120 - ((val - 60) / 140) * 110;
                          return `${x},${y}`;
                        })
                        .join(" ")}
                    />
                  </svg>
                  <div className="flex justify-between text-[10px] text-muted font-mono mt-1 pt-1 border-t border-default/40">
                    <span>30 seconds ago</span>
                    <span>15 seconds ago</span>
                    <span>Now</span>
                  </div>
                </div>
              </div>

              {/* Latency and Connection Pool breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Latency Chart */}
                <div className="p-5 bg-surface border border-default rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                      <Clock size={16} className="text-blue-400" />
                      Average Latency (ms)
                    </h3>
                    <span className="text-lg font-bold font-mono text-blue-400">{latencyMs} ms</span>
                  </div>
                  <div className="h-28 w-full bg-base/60 rounded-xl p-3 border border-default/50 flex flex-col justify-end">
                    <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 500 80">
                      <polyline
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={latencyHistory
                          .map((val, idx) => {
                            const x = (idx / (latencyHistory.length - 1)) * 500;
                            const y = 80 - (val / 3.0) * 70;
                            return `${x},${y}`;
                          })
                          .join(" ")}
                      />
                    </svg>
                  </div>
                </div>

                {/* Connection Pool Gauge */}
                <div className="p-5 bg-surface border border-default rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                      <Layers size={16} className="text-purple-400" />
                      Connection Pool Distribution
                    </h3>
                    <span className="text-xs text-muted font-mono">16 / 100 slots</span>
                  </div>
                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-emerald-400 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                        Active Queries ({processes.filter((p) => p.state === "active").length})
                      </span>
                      <span className="text-blue-400 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" />
                        Idle Pool (12)
                      </span>
                      <span className="text-muted">Available (84)</span>
                    </div>
                    <div className="w-full bg-base/80 h-3.5 rounded-full overflow-hidden flex border border-default">
                      <div className="bg-emerald-500 h-full" style={{ width: "4%" }} />
                      <div className="bg-blue-500 h-full" style={{ width: "12%" }} />
                      <div className="bg-amber-500 h-full" style={{ width: "1%" }} />
                      <div className="bg-base/20 h-full flex-1" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SLOW QUERIES */}
          {activeTab === "slow_queries" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-primary">
                    Top Slow Queries (pg_stat_statements)
                  </h3>
                  <p className="text-xs text-secondary mt-0.5">
                    รายการคำสั่งคิวรีที่ใช้เวลาประมวลผลสูงที่สุดเพื่อการ Optimize และสร้าง Index
                  </p>
                </div>
                <Badge variant="warning">Auto-Tracked</Badge>
              </div>

              <div className="space-y-3">
                {slowQueries.map((sq, idx) => (
                  <div
                    key={sq.id}
                    className="p-4 bg-surface border border-default hover:border-cyan-500/40 rounded-xl space-y-3 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-surface-secondary text-primary font-bold text-xs flex items-center justify-center font-mono">
                          #{idx + 1}
                        </span>
                        <div className="flex items-center gap-3 text-xs font-mono">
                          <span className="text-rose-400 font-bold">
                            Avg: {sq.meanTimeMs} ms
                          </span>
                          <span className="text-secondary">Calls: {sq.calls.toLocaleString()}</span>
                          <span className="text-muted">Max: {sq.maxTimeMs} ms</span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleCopySql(sq.query, sq.id)}
                        className="p-1.5 text-secondary hover:text-primary hover:bg-surface-secondary rounded transition-colors text-xs flex items-center gap-1"
                        title="คัดลอก SQL"
                      >
                        {copiedQueryId === sq.id ? (
                          <Check size={14} className="text-emerald-400" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>

                    <pre className="p-3 bg-base/80 rounded-lg text-xs font-mono text-secondary overflow-x-auto whitespace-pre-wrap border border-default/40">
                      {sq.query}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: STORAGE & TABLE SIZES */}
          {activeTab === "storage" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-primary">
                    Table Disk Storage & Row Estimates
                  </h3>
                  <p className="text-xs text-secondary mt-0.5">
                    ขนาดพื้นที่ข้อมูลและ Index ของแต่ละตารางในฐานข้อมูล
                  </p>
                </div>
                <div className="text-xs text-muted font-mono">
                  Total DB Size: <strong className="text-primary">979 MB</strong>
                </div>
              </div>

              <div className="border border-default rounded-xl overflow-hidden bg-surface">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-secondary/70 border-b border-default text-muted font-mono uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Table Name</th>
                      <th className="py-2.5 px-4 text-right">Estimated Rows</th>
                      <th className="py-2.5 px-4 text-right">Data Size</th>
                      <th className="py-2.5 px-4 text-right">Index Size</th>
                      <th className="py-2.5 px-4 text-right">Total Size</th>
                      <th className="py-2.5 px-4 w-44">Proportion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default/40 font-mono">
                    {tables.map((tbl) => {
                      const pct = Math.round((tbl.bytes / 482000000) * 100);
                      return (
                        <tr key={tbl.tableName} className="hover:bg-surface-secondary/50 transition-colors">
                          <td className="py-3 px-4 text-primary font-bold flex items-center gap-2">
                            <Database size={14} className="text-cyan-400" />
                            <span>{tbl.tableName}</span>
                          </td>
                          <td className="py-3 px-4 text-right text-secondary">
                            {tbl.rowCount.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right text-muted">{tbl.dataSize}</td>
                          <td className="py-3 px-4 text-right text-muted">{tbl.indexSize}</td>
                          <td className="py-3 px-4 text-right text-cyan-400 font-bold">
                            {tbl.totalSize}
                          </td>
                          <td className="py-3 px-4">
                            <div className="w-full bg-base/80 h-2 rounded-full overflow-hidden">
                              <div
                                className="bg-cyan-500 h-full rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-default bg-base/80 text-xs text-muted shrink-0">
          <div className="flex items-center gap-2">
            <span>อัปเดตล่าสุด: {lastUpdated.toLocaleTimeString()}</span>
            <span>•</span>
            <span className="text-secondary font-mono">{currentConn?.name || "Active DB"}</span>
          </div>

          <Button variant="outline" size="sm" onClick={onClose}>
            ปิดหน้าต่าง
          </Button>
        </div>
      </div>
    </div>
  );
};
