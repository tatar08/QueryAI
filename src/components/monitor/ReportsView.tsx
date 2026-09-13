import React, { useState } from "react";
import {
  FileBarChart,
  Download,
  CheckCircle2,
  TrendingUp,
  Database,
  Shield,
} from "lucide-react";
import { Button } from "../ui/Button";

export const ReportsView: React.FC = () => {
  const [selectedReport, setSelectedReport] = useState<"performance" | "capacity" | "security">("performance");
  const [dateRange, setDateRange] = useState("7d");
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const handleExport = () => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 2500);
    }, 600);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="p-5 bg-elevated border border-strong rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-xl text-purple-400">
            <FileBarChart size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-primary tracking-tight">Database Reports</h1>
              <span className="text-xs px-2.5 py-0.5 rounded-lg bg-surface-secondary text-secondary border border-default">
                Performance & Audit Summary
              </span>
            </div>
            <p className="text-xs text-secondary mt-1">
              รายงานสรุปประสิทธิภาพ ประวัติการใช้งาน สถิติความเร็วของคิวรี และความปลอดภัยของฐานข้อมูล
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-3 py-1.5 bg-surface-secondary border border-default rounded-xl text-xs text-secondary hover:text-primary outline-none cursor-pointer"
          >
            <option value="24h">24 ชั่วโมงล่าสุด (Last 24h)</option>
            <option value="7d">7 วันล่าสุด (Last 7 Days)</option>
            <option value="30d">30 วันล่าสุด (Last 30 Days)</option>
            <option value="90d">90 วันล่าสุด (Last Quarter)</option>
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2"
          >
            <Download size={14} />
            <span>{isExporting ? "กำลังส่งออก..." : exportSuccess ? "ส่งออกสำเร็จ!" : "Export Report"}</span>
          </Button>
        </div>
      </div>

      {/* Report Types Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => setSelectedReport("performance")}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            selectedReport === "performance"
              ? "bg-purple-500/10 border-purple-500/40 shadow-sm"
              : "bg-elevated border-default hover:bg-surface-secondary/40"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-primary">Query Performance</span>
            <TrendingUp size={16} className="text-purple-400" />
          </div>
          <p className="text-xs text-secondary">
            สรุปจำนวนคิวรี, Throughput, คิวรีที่ใช้เวลานาน และ Cache Hit Ratio
          </p>
        </button>

        <button
          onClick={() => setSelectedReport("capacity")}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            selectedReport === "capacity"
              ? "bg-blue-500/10 border-blue-500/40 shadow-sm"
              : "bg-elevated border-default hover:bg-surface-secondary/40"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-primary">Storage & Growth</span>
            <Database size={16} className="text-blue-400" />
          </div>
          <p className="text-xs text-secondary">
            อัตราการเติบโตของ Disk Space, สถิติตารางขนาดใหญ่ และ Index Overhead
          </p>
        </button>

        <button
          onClick={() => setSelectedReport("security")}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            selectedReport === "security"
              ? "bg-emerald-500/10 border-emerald-500/40 shadow-sm"
              : "bg-elevated border-default hover:bg-surface-secondary/40"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-primary">Security & Audit</span>
            <Shield size={16} className="text-emerald-400" />
          </div>
          <p className="text-xs text-secondary">
            ประวัติการเข้าใช้งาน, การเรียกใช้คำสั่ง DDL/DML, สิทธิ์การเขียนข้อมูล
          </p>
        </button>
      </div>

      {/* Performance Report View */}
      {selectedReport === "performance" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Total Queries Executed</span>
              <div className="text-2xl font-bold text-primary font-mono mt-1">1,842,910</div>
              <span className="text-[11px] text-emerald-400 mt-1 inline-block">+12.4% vs last week</span>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Mean Query Time</span>
              <div className="text-2xl font-bold text-cyan-400 font-mono mt-1">1.82 ms</div>
              <span className="text-[11px] text-emerald-400 mt-1 inline-block">Healthy latency</span>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Slow Queries (&gt; 500ms)</span>
              <div className="text-2xl font-bold text-amber-400 font-mono mt-1">28</div>
              <span className="text-[11px] text-muted mt-1 inline-block">0.0015% of all queries</span>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Execution Error Rate</span>
              <div className="text-2xl font-bold text-emerald-400 font-mono mt-1">0.02%</div>
              <span className="text-[11px] text-emerald-400 mt-1 inline-block">99.98% Success</span>
            </div>
          </div>

          <div className="p-5 bg-elevated border border-default rounded-2xl space-y-3 shadow-sm">
            <h3 className="text-sm font-bold text-primary">สรุปคำแนะนำการเพิ่มประสิทธิภาพ (Optimization Insights)</h3>
            <ul className="space-y-2 text-xs text-secondary">
              <li className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                <span>ตาราง <code>audit_logs</code> ควรสลับเป็น Partitioning รายเดือนเพื่อลดขนาด Index</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                <span>แนะนำสร้าง Partial Index สำหรับ <code>orders(status) WHERE status = 'PENDING'</code></span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                <span>Buffer pool cache hit ratio เฉลี่ย 99.82% ทำงานได้มีประสิทธิภาพสูงมาก</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Capacity Report View */}
      {selectedReport === "capacity" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Current Database Size</span>
              <div className="text-2xl font-bold text-primary font-mono mt-1">979 MB</div>
              <span className="text-[11px] text-blue-400 mt-1 inline-block">+42 MB in 7 days</span>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Projected 30-Day Growth</span>
              <div className="text-2xl font-bold text-blue-400 font-mono mt-1">~1.15 GB</div>
              <span className="text-[11px] text-muted mt-1 inline-block">Safe storage headroom</span>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Index / Data Ratio</span>
              <div className="text-2xl font-bold text-purple-400 font-mono mt-1">32.4%</div>
              <span className="text-[11px] text-secondary mt-1 inline-block">Normal index balance</span>
            </div>
          </div>
        </div>
      )}

      {/* Security Report View */}
      {selectedReport === "security" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Authenticated Users</span>
              <div className="text-2xl font-bold text-primary font-mono mt-1">4 Active</div>
              <span className="text-[11px] text-emerald-400 mt-1 inline-block">JWT Verified</span>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Mutating Queries (Write)</span>
              <div className="text-2xl font-bold text-amber-400 font-mono mt-1">12,840</div>
              <span className="text-[11px] text-secondary mt-1 inline-block">INSERT, UPDATE, DELETE</span>
            </div>
            <div className="p-4 bg-elevated border border-default rounded-xl">
              <span className="text-xs text-secondary">Blocked / RBAC Denied</span>
              <div className="text-2xl font-bold text-emerald-400 font-mono mt-1">0</div>
              <span className="text-[11px] text-emerald-400 mt-1 inline-block">No violations</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
