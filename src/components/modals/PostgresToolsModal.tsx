import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  Database,
  Activity,
  Package,
  Wrench,
  BarChart3,
  RefreshCw,
  Play,
  Search,
  CheckCircle2,
  Clock,
  Terminal,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";

export interface PostgresToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId?: string;
  connectionName?: string;
}

interface PgActivity {
  pid: number;
  usename: string;
  datname: string;
  clientAddr: string;
  state: string;
  query: string;
  waitEventType: string;
  waitEvent: string;
  durationSeconds: number;
}

interface PgExtension {
  name: string;
  defaultVersion: string;
  installedVersion: string;
  comment: string;
}

interface PgMetrics {
  databaseSize: string;
  activeConnections: number;
  idleConnections: number;
  totalConnections: number;
  cacheHitRatio: number;
}

type TabKey = "activity" | "extensions" | "maintenance" | "metrics";

export function PostgresToolsModal({
  isOpen,
  onClose,
  connectionId = "active",
  connectionName = "PostgreSQL",
}: PostgresToolsModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("activity");
  const [activities, setActivities] = useState<PgActivity[]>([]);
  const [extensions, setExtensions] = useState<PgExtension[]>([]);
  const [metrics, setMetrics] = useState<PgMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0); // 0 = off
  const [searchFilter, setSearchFilter] = useState("");
  const [maintLoading, setMaintLoading] = useState(false);
  const [maintOutput, setMaintOutput] = useState<string | null>(null);
  const [maintOp, setMaintOp] = useState<"vacuum" | "vacuum_full" | "analyze" | "reindex">("vacuum");
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchActivity = useCallback(async () => {
    try {
      setLoading(true);
      const res = await invoke<PgActivity[]>("get_pg_activity", { connectionId });
      setActivities(res || []);
    } catch (err: unknown) {
      console.error("Failed to fetch pg_stat_activity:", err);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  const fetchExtensions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await invoke<PgExtension[]>("get_pg_extensions", { connectionId });
      setExtensions(res || []);
    } catch (err: unknown) {
      console.error("Failed to fetch pg extensions:", err);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await invoke<PgMetrics>("get_pg_database_metrics", { connectionId });
      setMetrics(res || null);
    } catch (err: unknown) {
      console.error("Failed to fetch pg metrics:", err);
    }
  }, [connectionId]);

  const loadDataForTab = useCallback(() => {
    if (activeTab === "activity") {
      void fetchActivity();
      void fetchMetrics();
    } else if (activeTab === "extensions") {
      void fetchExtensions();
    } else if (activeTab === "metrics") {
      void fetchMetrics();
    }
  }, [activeTab, fetchActivity, fetchExtensions, fetchMetrics]);

  useEffect(() => {
    if (isOpen) {
      loadDataForTab();
    }
  }, [isOpen, loadDataForTab]);

  useEffect(() => {
    if (autoRefreshInterval > 0 && isOpen && activeTab === "activity") {
      timerRef.current = setInterval(() => {
        void fetchActivity();
      }, autoRefreshInterval * 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [autoRefreshInterval, isOpen, activeTab, fetchActivity]);

  const handleCancelQuery = async (pid: number) => {
    try {
      await invoke("cancel_pg_backend", { connectionId, pid });
      setActionNotice(`Query on backend PID ${pid} was cancelled.`);
      setTimeout(() => setActionNotice(null), 3000);
      void fetchActivity();
    } catch (err: unknown) {
      alert(`Failed to cancel query: ${err}`);
    }
  };

  const handleTerminateBackend = async (pid: number) => {
    if (!confirm(`Are you sure you want to terminate session PID ${pid}? Any ongoing transaction will be aborted.`)) {
      return;
    }
    try {
      await invoke("terminate_pg_backend", { connectionId, pid });
      setActionNotice(`Session PID ${pid} was terminated.`);
      setTimeout(() => setActionNotice(null), 3000);
      void fetchActivity();
    } catch (err: unknown) {
      alert(`Failed to terminate session: ${err}`);
    }
  };

  const handleInstallExtension = async (name: string) => {
    try {
      setLoading(true);
      await invoke("install_pg_extension", { connectionId, name });
      setActionNotice(`Extension '${name}' installed successfully.`);
      setTimeout(() => setActionNotice(null), 3000);
      void fetchExtensions();
    } catch (err: unknown) {
      alert(`Failed to install extension: ${err}`);
      setLoading(false);
    }
  };

  const handleDropExtension = async (name: string) => {
    if (!confirm(`Are you sure you want to drop extension '${name}'?`)) return;
    try {
      setLoading(true);
      await invoke("drop_pg_extension", { connectionId, name });
      setActionNotice(`Extension '${name}' dropped.`);
      setTimeout(() => setActionNotice(null), 3000);
      void fetchExtensions();
    } catch (err: unknown) {
      alert(`Failed to drop extension: ${err}`);
      setLoading(false);
    }
  };

  const handleRunMaintenance = async () => {
    try {
      setMaintLoading(true);
      setMaintOutput("Executing maintenance operation... please wait.");
      const res = await invoke<string>("execute_pg_maintenance", {
        connectionId,
        operation: maintOp,
      });
      setMaintOutput(res);
      void fetchMetrics();
    } catch (err: unknown) {
      setMaintOutput(`Error: ${err}`);
    } finally {
      setMaintLoading(false);
    }
  };

  if (!isOpen) return null;

  const filteredExtensions = extensions.filter(
    (e) =>
      e.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      e.comment.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[850px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg border border-blue-500/20">
              <Database size={20} className="text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-primary">PostgreSQL Tools & Activity</h2>
                <Badge variant="info" size="sm">#16</Badge>
              </div>
              <p className="text-xs text-secondary">
                {connectionName} • Activity monitor, extension catalog, maintenance & performance
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-secondary hover:text-primary transition-colors p-1.5 rounded-lg hover:bg-subsurface"
          >
            <X size={20} />
          </button>
        </div>

        {/* Action Notice banner */}
        {actionNotice && (
          <div className="px-4 py-2 bg-emerald-950/60 border-b border-emerald-800/40 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 size={14} />
            <span>{actionNotice}</span>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center px-4 pt-2 border-b border-default bg-base/30 gap-2">
          {[
            { key: "activity" as const, label: "Live Activity (pg_stat_activity)", icon: Activity },
            { key: "extensions" as const, label: "Extensions", icon: Package },
            { key: "maintenance" as const, label: "Maintenance", icon: Wrench },
            { key: "metrics" as const, label: "Database Metrics", icon: BarChart3 },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
                  active
                    ? "border-blue-500 text-blue-400 bg-blue-500/5 rounded-t-md"
                    : "border-transparent text-secondary hover:text-primary hover:bg-subsurface/40 rounded-t-md"
                }`}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: Live Activity */}
          {activeTab === "activity" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={loading}
                    icon={<RefreshCw size={14} />}
                    onClick={fetchActivity}
                  >
                    Refresh
                  </Button>
                  <div className="flex items-center gap-1.5 text-xs text-secondary pl-2 border-l border-default">
                    <Clock size={13} />
                    <span>Auto-refresh:</span>
                    <select
                      value={autoRefreshInterval}
                      onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                      className="bg-subsurface border border-default rounded px-2 py-1 text-xs text-primary focus:outline-none"
                    >
                      <option value={0}>Off</option>
                      <option value={3}>Every 3s</option>
                      <option value={5}>Every 5s</option>
                      <option value={10}>Every 10s</option>
                    </select>
                  </div>
                </div>
                <div className="text-xs text-secondary">
                  Active Sessions: <span className="font-semibold text-primary">{activities.length}</span>
                </div>
              </div>

              {activities.length === 0 ? (
                <div className="p-8 text-center text-secondary border border-default rounded-xl bg-base/30 text-xs">
                  No active queries or idle sessions currently running.
                </div>
              ) : (
                <div className="border border-default rounded-xl overflow-hidden bg-base/40">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-default bg-base text-muted uppercase tracking-wider text-[10px]">
                        <th className="p-2.5">PID</th>
                        <th className="p-2.5">User / DB</th>
                        <th className="p-2.5">State</th>
                        <th className="p-2.5">Wait Event</th>
                        <th className="p-2.5">Duration</th>
                        <th className="p-2.5">Query</th>
                        <th className="p-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-default">
                      {activities.map((act) => (
                        <tr key={act.pid} className="hover:bg-subsurface/40 transition-colors">
                          <td className="p-2.5 font-mono text-primary">{act.pid}</td>
                          <td className="p-2.5">
                            <div className="font-medium text-primary">{act.usename}</div>
                            <div className="text-[10px] text-muted">{act.datname} ({act.clientAddr})</div>
                          </td>
                          <td className="p-2.5">
                            <Badge
                              variant={
                                act.state === "active"
                                  ? "success"
                                  : act.state.includes("idle")
                                  ? "default"
                                  : "warning"
                              }
                              size="sm"
                              dot
                            >
                              {act.state}
                            </Badge>
                          </td>
                          <td className="p-2.5">
                            {act.waitEvent ? (
                              <span className="text-[11px] text-amber-300 font-mono">
                                {act.waitEventType}:{act.waitEvent}
                              </span>
                            ) : (
                              <span className="text-muted text-[11px]">—</span>
                            )}
                          </td>
                          <td className="p-2.5 font-mono text-[11px] text-secondary">
                            {act.durationSeconds > 0 ? `${act.durationSeconds}s` : "<0.01s"}
                          </td>
                          <td className="p-2.5 max-w-[220px] truncate font-mono text-[11px] text-slate-300" title={act.query}>
                            {act.query || "<idle>"}
                          </td>
                          <td className="p-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex gap-1.5">
                              <button
                                onClick={() => handleCancelQuery(act.pid)}
                                title="Cancel Query"
                                className="px-2 py-1 text-[11px] rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleTerminateBackend(act.pid)}
                                title="Terminate Connection"
                                className="px-2 py-1 text-[11px] rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 transition-colors"
                              >
                                Terminate
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Extensions */}
          {activeTab === "extensions" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="text"
                    placeholder="Search extensions (e.g. uuid, crypto, postgis)..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-subsurface border border-default rounded-lg text-primary placeholder-muted focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <div className="text-xs text-secondary">
                  Showing {filteredExtensions.length} of {extensions.length} extensions
                </div>
              </div>

              <div className="border border-default rounded-xl overflow-hidden bg-base/40 max-h-[420px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-default bg-base text-muted uppercase tracking-wider text-[10px] sticky top-0 z-10">
                      <th className="p-2.5">Extension Name</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Version</th>
                      <th className="p-2.5">Description</th>
                      <th className="p-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {filteredExtensions.map((ext) => {
                      const isInstalled = Boolean(ext.installedVersion);
                      return (
                        <tr key={ext.name} className="hover:bg-subsurface/40 transition-colors">
                          <td className="p-2.5 font-mono font-semibold text-primary">{ext.name}</td>
                          <td className="p-2.5">
                            <Badge variant={isInstalled ? "success" : "default"} size="sm" dot={isInstalled}>
                              {isInstalled ? "Installed" : "Available"}
                            </Badge>
                          </td>
                          <td className="p-2.5 font-mono text-secondary">
                            {isInstalled ? ext.installedVersion : `v${ext.defaultVersion}`}
                          </td>
                          <td className="p-2.5 text-secondary text-[11px] max-w-[280px]">{ext.comment}</td>
                          <td className="p-2.5 text-right whitespace-nowrap">
                            {isInstalled ? (
                              <button
                                onClick={() => handleDropExtension(ext.name)}
                                className="px-2.5 py-1 text-xs rounded bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/30 transition-colors"
                              >
                                Drop
                              </button>
                            ) : (
                              <button
                                onClick={() => handleInstallExtension(ext.name)}
                                className="px-2.5 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors font-medium"
                              >
                                Install
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: Maintenance */}
          {activeTab === "maintenance" && (
            <div className="space-y-4">
              <div className="p-4 bg-base/50 border border-default rounded-xl space-y-3">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">
                  PostgreSQL Maintenance Runner
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: "vacuum" as const, label: "VACUUM ANALYZE", desc: "Reclaims storage and updates planner statistics" },
                    { id: "vacuum_full" as const, label: "VACUUM FULL", desc: "Exclusive lock; reclaims maximum disk space" },
                    { id: "analyze" as const, label: "ANALYZE VERBOSE", desc: "Collects statistics without cleaning tuples" },
                    { id: "reindex" as const, label: "REINDEX DATABASE", desc: "Rebuilds all indexes to remove bloat" },
                  ].map((op) => (
                    <div
                      key={op.id}
                      onClick={() => setMaintOp(op.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        maintOp === op.id
                          ? "bg-blue-600/10 border-blue-500/50 text-primary"
                          : "bg-subsurface/50 border-default text-secondary hover:border-slate-600"
                      }`}
                    >
                      <div className="text-xs font-semibold">{op.label}</div>
                      <div className="text-[11px] text-muted mt-1 leading-tight">{op.desc}</div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex justify-between items-center">
                  <span className="text-xs text-secondary">
                    Operation: <code className="font-mono text-blue-400">{maintOp.toUpperCase()}</code>
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={maintLoading}
                    icon={<Play size={14} />}
                    onClick={handleRunMaintenance}
                  >
                    Execute Maintenance
                  </Button>
                </div>
              </div>

              {maintOutput && (
                <div className="p-3 bg-black/60 border border-default rounded-xl font-mono text-xs text-slate-300 space-y-1">
                  <div className="flex items-center gap-1.5 text-muted text-[11px] pb-1 border-b border-default">
                    <Terminal size={12} /> Output Console
                  </div>
                  <pre className="whitespace-pre-wrap leading-relaxed">{maintOutput}</pre>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Database Metrics */}
          {activeTab === "metrics" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 bg-base/50 border border-default rounded-xl space-y-1">
                  <div className="text-xs text-muted">Database Disk Size</div>
                  <div className="text-2xl font-bold text-primary font-mono">
                    {metrics?.databaseSize || "Calculating..."}
                  </div>
                  <div className="text-[11px] text-secondary">Pretty formatted current database storage</div>
                </div>

                <div className="p-4 bg-base/50 border border-default rounded-xl space-y-1">
                  <div className="text-xs text-muted">Buffer Cache Hit Ratio</div>
                  <div className="text-2xl font-bold text-emerald-400 font-mono">
                    {metrics?.cacheHitRatio != null ? `${metrics.cacheHitRatio}%` : "—"}
                  </div>
                  <div className="text-[11px] text-secondary">Target: &gt; 99% (Memory buffer efficiency)</div>
                </div>

                <div className="p-4 bg-base/50 border border-default rounded-xl space-y-1">
                  <div className="text-xs text-muted">Total Server Sessions</div>
                  <div className="text-2xl font-bold text-blue-400 font-mono">
                    {metrics?.totalConnections ?? "—"}
                  </div>
                  <div className="text-[11px] text-secondary">
                    Active: {metrics?.activeConnections ?? 0} • Idle: {metrics?.idleConnections ?? 0}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-base/30 border border-default rounded-xl space-y-2 text-xs text-secondary">
                <div className="font-semibold text-primary">PostgreSQL Performance Tips:</div>
                <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
                  <li>Keep autovacuum enabled to prevent MVCC table and index bloat.</li>
                  <li>Monitor wait events in the Live Activity tab to identify query lock contentions.</li>
                  <li>Use pg_trgm for fuzzy text searching instead of unindexed LIKE queries.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-between items-center">
          <span className="text-xs text-muted">PostgreSQL Suite • Enhanced Tools v1.0</span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
