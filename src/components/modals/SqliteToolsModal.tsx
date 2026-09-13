import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  Database,
  ShieldCheck,
  Wrench,
  HardDrive,
  RefreshCw,
  Play,
  Save,
  CheckCircle2,
  FileDown,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";

export interface SqliteToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId?: string;
  connectionName?: string;
}

interface SqlitePragmaInfo {
  journalMode: string;
  synchronous: string;
  foreignKeys: boolean;
  autoVacuum: string;
  cacheSize: number;
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  encoding: string;
  userVersion: number;
  walAutocheckpoint: number;
  databaseSizeBytes: number;
  databaseSizePretty: string;
}

interface SqliteAttachedDb {
  seq: number;
  name: string;
  file: string;
}

type TabKey = "pragmas" | "integrity" | "maintenance" | "database";

export function SqliteToolsModal({
  isOpen,
  onClose,
  connectionId = "active",
  connectionName = "SQLite Database",
}: SqliteToolsModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("pragmas");
  const [pragmas, setPragmas] = useState<SqlitePragmaInfo | null>(null);
  const [attachedDbs, setAttachedDbs] = useState<SqliteAttachedDb[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Form states for PRAGMA settings
  const [editJournalMode, setEditJournalMode] = useState("WAL");
  const [editSynchronous, setEditSynchronous] = useState("NORMAL");
  const [editForeignKeys, setEditForeignKeys] = useState(true);
  const [editAutoVacuum, setEditAutoVacuum] = useState("NONE");
  const [editCacheSize, setEditCacheSize] = useState(-2000);
  const [editWalCheckpoint, setEditWalCheckpoint] = useState(1000);

  // Integrity Check states
  const [integrityRunning, setIntegrityRunning] = useState(false);
  const [integrityResults, setIntegrityResults] = useState<string[] | null>(null);

  // Maintenance states
  const [maintLoading, setMaintLoading] = useState(false);
  const [maintOutput, setMaintOutput] = useState<string | null>(null);
  const [backupPath, setBackupPath] = useState("");
  const [backupLoading, setBackupLoading] = useState(false);

  const fetchPragmas = useCallback(async () => {
    try {
      setLoading(true);
      const res = await invoke<SqlitePragmaInfo>("get_sqlite_pragmas", { connectionId });
      setPragmas(res);
      setEditJournalMode(res.journalMode.toUpperCase());
      setEditSynchronous(res.synchronous);
      setEditForeignKeys(res.foreignKeys);
      setEditAutoVacuum(res.autoVacuum);
      setEditCacheSize(res.cacheSize);
      setEditWalCheckpoint(res.walAutocheckpoint);
    } catch (err: unknown) {
      console.error("Failed to fetch sqlite pragmas:", err);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  const fetchAttached = useCallback(async () => {
    try {
      const res = await invoke<SqliteAttachedDb[]>("get_sqlite_attached_databases", { connectionId });
      setAttachedDbs(res || []);
    } catch (err: unknown) {
      console.error("Failed to fetch attached databases:", err);
    }
  }, [connectionId]);

  useEffect(() => {
    if (isOpen) {
      void fetchPragmas();
      void fetchAttached();
    }
  }, [isOpen, fetchPragmas, fetchAttached]);

  const handleApplyPragmas = async () => {
    try {
      setLoading(true);
      await invoke("set_sqlite_pragma", { connectionId, pragmaName: "journal_mode", value: editJournalMode });
      await invoke("set_sqlite_pragma", { connectionId, pragmaName: "synchronous", value: editSynchronous });
      await invoke("set_sqlite_pragma", { connectionId, pragmaName: "foreign_keys", value: editForeignKeys ? "ON" : "OFF" });
      await invoke("set_sqlite_pragma", { connectionId, pragmaName: "auto_vacuum", value: editAutoVacuum });
      await invoke("set_sqlite_pragma", { connectionId, pragmaName: "cache_size", value: String(editCacheSize) });
      await invoke("set_sqlite_pragma", { connectionId, pragmaName: "wal_autocheckpoint", value: String(editWalCheckpoint) });

      setActionNotice("SQLite PRAGMA configuration applied successfully!");
      setTimeout(() => setActionNotice(null), 3500);
      void fetchPragmas();
    } catch (err: unknown) {
      alert(`Failed to update PRAGMAs: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunIntegrityCheck = async (quick: boolean) => {
    try {
      setIntegrityRunning(true);
      setIntegrityResults(null);
      const res = await invoke<string[]>("check_sqlite_integrity", { connectionId, quick });
      setIntegrityResults(res);
    } catch (err: unknown) {
      setIntegrityResults([`Error executing check: ${err}`]);
    } finally {
      setIntegrityRunning(false);
    }
  };

  const handleExecuteMaintenance = async (operation: string) => {
    try {
      setMaintLoading(true);
      setMaintOutput(`Executing ${operation}... please wait.`);
      const res = await invoke<string>("execute_sqlite_maintenance", { connectionId, operation });
      setMaintOutput(res);
      void fetchPragmas();
    } catch (err: unknown) {
      setMaintOutput(`Error: ${err}`);
    } finally {
      setMaintLoading(false);
    }
  };

  const handleVacuumInto = async () => {
    if (!backupPath.trim()) {
      alert("Please provide a destination file path for VACUUM INTO backup.");
      return;
    }
    try {
      setBackupLoading(true);
      const res = await invoke<string>("vacuum_sqlite_into", { connectionId, destinationPath: backupPath.trim() });
      setActionNotice(res);
      setTimeout(() => setActionNotice(null), 5000);
    } catch (err: unknown) {
      alert(`Failed to execute VACUUM INTO: ${err}`);
    } finally {
      setBackupLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[820px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-900/30 rounded-lg border border-emerald-500/20">
              <Database size={20} className="text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-primary">SQLite Tools & Diagnostics</h2>
                <Badge variant="info" size="sm">#17</Badge>
              </div>
              <p className="text-xs text-secondary">
                {connectionName} • PRAGMA settings, integrity verification, maintenance & attached files
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

        {/* Action Notice */}
        {actionNotice && (
          <div className="px-4 py-2 bg-emerald-950/60 border-b border-emerald-800/40 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 size={14} />
            <span>{actionNotice}</span>
          </div>
        )}

        {/* Tab Strip */}
        <div className="flex items-center px-4 pt-2 border-b border-default bg-base/30 gap-2">
          <button
            onClick={() => setActiveTab("pragmas")}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
              activeTab === "pragmas"
                ? "border-emerald-500 text-emerald-400 bg-emerald-500/5 rounded-t-md"
                : "border-transparent text-secondary hover:text-primary hover:bg-subsurface/40 rounded-t-md"
            }`}
          >
            <Wrench size={14} />
            <span>PRAGMA Settings</span>
          </button>
          <button
            onClick={() => setActiveTab("integrity")}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
              activeTab === "integrity"
                ? "border-emerald-500 text-emerald-400 bg-emerald-500/5 rounded-t-md"
                : "border-transparent text-secondary hover:text-primary hover:bg-subsurface/40 rounded-t-md"
            }`}
          >
            <ShieldCheck size={14} />
            <span>Integrity Check</span>
          </button>
          <button
            onClick={() => setActiveTab("maintenance")}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
              activeTab === "maintenance"
                ? "border-emerald-500 text-emerald-400 bg-emerald-500/5 rounded-t-md"
                : "border-transparent text-secondary hover:text-primary hover:bg-subsurface/40 rounded-t-md"
            }`}
          >
            <RefreshCw size={14} />
            <span>Maintenance & Backup</span>
          </button>
          <button
            onClick={() => setActiveTab("database")}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
              activeTab === "database"
                ? "border-emerald-500 text-emerald-400 bg-emerald-500/5 rounded-t-md"
                : "border-transparent text-secondary hover:text-primary hover:bg-subsurface/40 rounded-t-md"
            }`}
          >
            <HardDrive size={14} />
            <span>Database Metrics</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: PRAGMA Settings */}
          {activeTab === "pragmas" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-secondary">
                  Configure SQLite core operating modes and memory limits.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchPragmas}
                  disabled={loading}
                  icon={<RefreshCw size={12} className={loading ? "animate-spin" : ""} />}
                >
                  Refresh
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Journal Mode */}
                <div className="p-3.5 bg-base/40 border border-default rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-primary">Journal Mode</label>
                    <Badge variant={editJournalMode === "WAL" ? "success" : "default"} size="sm">
                      {editJournalMode}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted">
                    Controls transaction rollback & WAL concurrency. WAL offers concurrent reads during writes.
                  </p>
                  <select
                    value={editJournalMode}
                    onChange={(e) => setEditJournalMode(e.target.value)}
                    className="w-full bg-subsurface border border-default rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-emerald-500"
                  >
                    <option value="WAL">WAL (Write-Ahead Logging - Recommended)</option>
                    <option value="DELETE">DELETE (Default rollback journal)</option>
                    <option value="TRUNCATE">TRUNCATE (Zero-size journal)</option>
                    <option value="PERSIST">PERSIST (Reuse journal)</option>
                    <option value="MEMORY">MEMORY (In-memory journal)</option>
                    <option value="OFF">OFF (Disable rollback logging)</option>
                  </select>
                </div>

                {/* Synchronous Mode */}
                <div className="p-3.5 bg-base/40 border border-default rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-primary">Synchronous</label>
                    <Badge variant="default" size="sm">{editSynchronous}</Badge>
                  </div>
                  <p className="text-[11px] text-muted">
                    Controls how aggressively SQLite flushes data to disk with fsync.
                  </p>
                  <select
                    value={editSynchronous}
                    onChange={(e) => setEditSynchronous(e.target.value)}
                    className="w-full bg-subsurface border border-default rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-emerald-500"
                  >
                    <option value="NORMAL">NORMAL (Fast, safe with WAL mode)</option>
                    <option value="FULL">FULL (High durability, syncs every write)</option>
                    <option value="EXTRA">EXTRA (Deep flush, also syncs directory)</option>
                    <option value="OFF">OFF (Maximum speed, risk on power outage)</option>
                  </select>
                </div>

                {/* Foreign Keys */}
                <div className="p-3.5 bg-base/40 border border-default rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-primary">Foreign Keys</label>
                    <Badge variant={editForeignKeys ? "success" : "warning"} size="sm">
                      {editForeignKeys ? "Enforced" : "Ignored"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted">
                    Enforces foreign key constraint checks on INSERT/UPDATE/DELETE.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant={editForeignKeys ? "primary" : "outline"}
                      size="sm"
                      onClick={() => setEditForeignKeys(true)}
                    >
                      Enforce (ON)
                    </Button>
                    <Button
                      variant={!editForeignKeys ? "primary" : "outline"}
                      size="sm"
                      onClick={() => setEditForeignKeys(false)}
                    >
                      Disable (OFF)
                    </Button>
                  </div>
                </div>

                {/* Auto Vacuum */}
                <div className="p-3.5 bg-base/40 border border-default rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-primary">Auto Vacuum</label>
                    <Badge variant="default" size="sm">{editAutoVacuum}</Badge>
                  </div>
                  <p className="text-[11px] text-muted">
                    Automatic free-list page reclamation mode for this database file.
                  </p>
                  <select
                    value={editAutoVacuum}
                    onChange={(e) => setEditAutoVacuum(e.target.value)}
                    className="w-full bg-subsurface border border-default rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-emerald-500"
                  >
                    <option value="NONE">NONE (Default - manual VACUUM)</option>
                    <option value="FULL">FULL (Shrinks automatically on delete)</option>
                    <option value="INCREMENTAL">INCREMENTAL (Controlled reclamation)</option>
                  </select>
                </div>

                {/* Cache Size */}
                <div className="p-3.5 bg-base/40 border border-default rounded-xl space-y-2">
                  <label className="text-xs font-semibold text-primary">Cache Size (KiB if negative)</label>
                  <p className="text-[11px] text-muted">
                    Negative number denotes memory in KiB (e.g. -2000 = ~2MB buffer cache).
                  </p>
                  <input
                    type="number"
                    value={editCacheSize}
                    onChange={(e) => setEditCacheSize(Number(e.target.value))}
                    className="w-full bg-subsurface border border-default rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* WAL Auto-checkpoint */}
                <div className="p-3.5 bg-base/40 border border-default rounded-xl space-y-2">
                  <label className="text-xs font-semibold text-primary">WAL Auto-Checkpoint (Pages)</label>
                  <p className="text-[11px] text-muted">
                    Number of WAL pages before an automatic checkpoint runs (default: 1000).
                  </p>
                  <input
                    type="number"
                    value={editWalCheckpoint}
                    onChange={(e) => setEditWalCheckpoint(Number(e.target.value))}
                    className="w-full bg-subsurface border border-default rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApplyPragmas}
                  disabled={loading}
                  icon={<Save size={13} />}
                >
                  Save & Apply PRAGMAs
                </Button>
              </div>
            </div>
          )}

          {/* TAB 2: Integrity Check */}
          {activeTab === "integrity" && (
            <div className="space-y-4">
              <div className="p-4 bg-base/50 border border-default rounded-xl flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                    <ShieldCheck size={16} className="text-emerald-400" />
                    Database Health & Corruption Verification
                  </h3>
                  <p className="text-xs text-secondary mt-0.5">
                    Runs low-level checks against B-trees, freelist chains, indexes, and page offsets.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={integrityRunning}
                    onClick={() => handleRunIntegrityCheck(true)}
                  >
                    Quick Check
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={integrityRunning}
                    onClick={() => handleRunIntegrityCheck(false)}
                    icon={<Play size={12} />}
                  >
                    Full Integrity Check
                  </Button>
                </div>
              </div>

              {integrityRunning && (
                <div className="p-8 text-center text-secondary border border-default rounded-xl bg-base/30 text-xs">
                  <RefreshCw size={24} className="mx-auto mb-2 animate-spin text-emerald-400" />
                  Scanning database pages and indexes...
                </div>
              )}

              {!integrityRunning && integrityResults && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-secondary font-medium">Status:</span>
                    {integrityResults.length === 1 && integrityResults[0].toLowerCase() === "ok" ? (
                      <Badge variant="success" size="sm">Passed (No corruption detected)</Badge>
                    ) : (
                      <Badge variant="danger" size="sm">Corruption or warnings detected</Badge>
                    )}
                  </div>
                  <div className="p-3 bg-base/80 border border-default rounded-xl font-mono text-xs text-primary space-y-1 max-h-64 overflow-y-auto">
                    {integrityResults.map((line, idx) => (
                      <div key={idx} className={line === "ok" ? "text-emerald-400" : "text-amber-300"}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!integrityRunning && !integrityResults && (
                <div className="p-8 text-center text-muted border border-default rounded-xl bg-base/20 text-xs">
                  Click "Quick Check" or "Full Integrity Check" above to scan the database.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Maintenance & Backup */}
          {activeTab === "maintenance" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 bg-base/40 border border-default rounded-xl space-y-2">
                  <div className="font-semibold text-xs text-primary flex items-center gap-1.5">
                    <RefreshCw size={14} className="text-blue-400" />
                    VACUUM
                  </div>
                  <p className="text-[11px] text-muted">
                    Rebuilds the entire database file, reclaiming unused space and packing data pages into minimum size.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExecuteMaintenance("vacuum")}
                    disabled={maintLoading}
                  >
                    Run VACUUM
                  </Button>
                </div>

                <div className="p-4 bg-base/40 border border-default rounded-xl space-y-2">
                  <div className="font-semibold text-xs text-primary flex items-center gap-1.5">
                    <Play size={14} className="text-emerald-400" />
                    ANALYZE
                  </div>
                  <p className="text-[11px] text-muted">
                    Gathers statistics about tables and indices, storing them in sqlite_stat1 to assist the query planner.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExecuteMaintenance("analyze")}
                    disabled={maintLoading}
                  >
                    Run ANALYZE
                  </Button>
                </div>

                <div className="p-4 bg-base/40 border border-default rounded-xl space-y-2">
                  <div className="font-semibold text-xs text-primary flex items-center gap-1.5">
                    <Wrench size={14} className="text-purple-400" />
                    PRAGMA optimize
                  </div>
                  <p className="text-[11px] text-muted">
                    Runs automatic optimization routines recommended by SQLite for applications before closing.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExecuteMaintenance("optimize")}
                    disabled={maintLoading}
                  >
                    Run PRAGMA optimize
                  </Button>
                </div>

                <div className="p-4 bg-base/40 border border-default rounded-xl space-y-2">
                  <div className="font-semibold text-xs text-primary flex items-center gap-1.5">
                    <Database size={14} className="text-amber-400" />
                    WAL Checkpoint (TRUNCATE)
                  </div>
                  <p className="text-[11px] text-muted">
                    Syncs all transactions from the WAL file into the database file and resets WAL file size to 0.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExecuteMaintenance("wal_checkpoint")}
                    disabled={maintLoading}
                  >
                    Flush WAL
                  </Button>
                </div>
              </div>

              {/* VACUUM INTO Online Backup */}
              <div className="p-4 bg-base/50 border border-default rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <FileDown size={16} className="text-sky-400" />
                  <h4 className="text-xs font-semibold text-primary">VACUUM INTO (Live Online Hot Backup)</h4>
                </div>
                <p className="text-[11px] text-muted">
                  Performs an instantaneous, crash-consistent backup of the database to a target file path while concurrent read/write operations continue uninterrupted.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="/path/to/backup.sqlite"
                    value={backupPath}
                    onChange={(e) => setBackupPath(e.target.value)}
                    className="flex-1 bg-subsurface border border-default rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-sky-500"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleVacuumInto}
                    disabled={backupLoading}
                    icon={<FileDown size={13} />}
                  >
                    Backup Database
                  </Button>
                </div>
              </div>

              {maintOutput && (
                <div className="p-3 bg-base/70 border border-default rounded-xl text-xs font-mono text-secondary">
                  {maintOutput}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Database Metrics & Attached Files */}
          {activeTab === "database" && (
            <div className="space-y-4">
              {/* Stat Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-4 bg-base/50 border border-default rounded-xl space-y-1">
                  <div className="text-xs text-muted">Database File Size</div>
                  <div className="text-2xl font-bold text-primary font-mono">
                    {pragmas ? pragmas.databaseSizePretty : "Calculating..."}
                  </div>
                  <div className="text-[11px] text-secondary">
                    {pragmas ? `${pragmas.databaseSizeBytes.toLocaleString()} bytes` : "—"}
                  </div>
                </div>

                <div className="p-4 bg-base/50 border border-default rounded-xl space-y-1">
                  <div className="text-xs text-muted">Page Size & Count</div>
                  <div className="text-2xl font-bold text-emerald-400 font-mono">
                    {pragmas ? `${pragmas.pageSize} B` : "—"}
                  </div>
                  <div className="text-[11px] text-secondary">
                    {pragmas ? `${pragmas.pageCount.toLocaleString()} total pages` : "—"}
                  </div>
                </div>

                <div className="p-4 bg-base/50 border border-default rounded-xl space-y-1">
                  <div className="text-xs text-muted">Unused Freelist Pages</div>
                  <div className="text-2xl font-bold text-blue-400 font-mono">
                    {pragmas ? pragmas.freelistCount.toLocaleString() : "—"}
                  </div>
                  <div className="text-[11px] text-secondary">
                    {pragmas && pragmas.pageCount > 0
                      ? `${((pragmas.freelistCount / pragmas.pageCount) * 100).toFixed(1)}% recoverable space`
                      : "0%"}
                  </div>
                </div>
              </div>

              {/* Extra Specs */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-base/30 border border-default rounded-xl flex items-center justify-between text-xs">
                  <span className="text-secondary">Text Encoding:</span>
                  <span className="font-mono text-primary font-semibold">{pragmas?.encoding || "UTF-8"}</span>
                </div>
                <div className="p-3 bg-base/30 border border-default rounded-xl flex items-center justify-between text-xs">
                  <span className="text-secondary">User Version (PRAGMA user_version):</span>
                  <span className="font-mono text-primary font-semibold">{pragmas?.userVersion ?? 0}</span>
                </div>
              </div>

              {/* Attached Databases */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-primary">
                  Attached Databases (PRAGMA database_list)
                </div>
                <div className="border border-default rounded-xl overflow-hidden bg-base/40">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-default bg-base text-muted uppercase tracking-wider text-[10px]">
                        <th className="p-2.5">Seq</th>
                        <th className="p-2.5">Schema / Name</th>
                        <th className="p-2.5">File Path</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-default">
                      {attachedDbs.map((db) => (
                        <tr key={db.seq} className="hover:bg-subsurface/40 transition-colors">
                          <td className="p-2.5 font-mono text-muted">{db.seq}</td>
                          <td className="p-2.5 font-semibold text-primary">{db.name}</td>
                          <td className="p-2.5 font-mono text-xs text-secondary truncate max-w-md">
                            {db.file || "<in-memory / temporary>"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-between items-center">
          <span className="text-xs text-muted">
            SQLite Suite • Diagnostics & PRAGMA Manager v1.0
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
