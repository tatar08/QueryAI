import React, { useState } from "react";
import {
  Database,
  Columns,
  Rows,
  Hash,
  Type,
  Key,
  Play,
  Share2,
  PieChart,
} from "lucide-react";
import { Button } from "../ui/Button";

export interface TableauCanvasViewProps {
  sourceConnName: string;
  targetConnName: string;
  sourceDb: string;
  targetDb: string;
  sourceTable: string;
  targetTable: string;
  keyColumn: string;
  onSetKeyColumn: (col: string) => void;
  onRunCompare: () => void;
  isComparing: boolean;
}

export const TableauCanvasView: React.FC<TableauCanvasViewProps> = ({
  sourceConnName,
  targetConnName,
  sourceDb,
  targetDb,
  sourceTable,
  targetTable,
  keyColumn,
  onSetKeyColumn,
  onRunCompare,
  isComparing,
}) => {
  const [columnsShelf, setColumnsShelf] = useState<string[]>([
    "name",
    "email",
    "role",
    "status",
  ]);

  const [availableDimensions] = useState<string[]>([
    "id",
    "name",
    "email",
    "role",
    "status",
    "created_at",
    "last_login",
  ]);

  const [availableMeasures] = useState<string[]>([
    "Diff Count (#)",
    "Match Rate (%)",
    "Source Row Count (#)",
    "Target Row Count (#)",
  ]);

  const handleAddColumn = (col: string) => {
    if (!columnsShelf.includes(col)) {
      setColumnsShelf([...columnsShelf, col]);
    }
  };

  const handleRemoveColumn = (col: string) => {
    setColumnsShelf(columnsShelf.filter((c) => c !== col));
  };

  return (
    <div className="space-y-5 animate-fade-in font-sans">
      {/* Tableau Top Shelves Area */}
      <div className="p-4 bg-elevated border border-default rounded-2xl space-y-3 shadow-sm">
        {/* Columns Shelf */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 w-28 shrink-0 text-xs font-semibold text-secondary">
            <Columns size={14} className="text-blue-400" />
            <span>Columns:</span>
          </div>
          <div className="flex-1 flex items-center gap-2 p-1.5 bg-surface-secondary/70 border border-default/70 rounded-xl min-h-[36px] overflow-x-auto">
            {columnsShelf.map((col) => (
              <span
                key={col}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30 shadow-xs"
              >
                <span>{col}</span>
                <button
                  onClick={() => handleRemoveColumn(col)}
                  className="text-blue-400 hover:text-rose-400 transition-colors"
                >
                  ×
                </button>
              </span>
            ))}
            <span className="text-[11px] text-muted italic ml-1 select-none">
              (คลิกคอลัมน์จาก Dimensions เพื่อเพิ่ม)
            </span>
          </div>
        </div>

        {/* Rows / Key Shelf */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 w-28 shrink-0 text-xs font-semibold text-secondary">
            <Rows size={14} className="text-amber-400" />
            <span>Key Shelf:</span>
          </div>
          <div className="flex-1 flex items-center justify-between gap-2 p-1.5 bg-surface-secondary/70 border border-default/70 rounded-xl min-h-[36px]">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-xs">
                <Key size={12} />
                <span>Primary Key: {keyColumn}</span>
              </span>
              <div className="flex items-center gap-1 text-[11px] text-secondary">
                <span>เลือก:</span>
                {["id", "usr_id", "email"].map((k) => (
                  <button
                    key={k}
                    onClick={() => onSetKeyColumn(k)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      keyColumn === k
                        ? "bg-amber-500/30 text-amber-300 font-bold"
                        : "text-muted hover:text-primary"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              onClick={onRunCompare}
              disabled={isComparing}
              className="flex items-center gap-2 h-7 text-xs"
            >
              <Play size={12} className={isComparing ? "animate-spin" : ""} />
              <span>{isComparing ? "กำลังคำนวณ..." : "รัน Compare"}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Workspace: Left Data Pane + Center Visual Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Data Pane (3 cols) */}
        <div className="lg:col-span-3 p-4 bg-elevated border border-default rounded-2xl space-y-4 shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-default">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <Database size={14} className="text-blue-400" />
              <span>Tableau Data Pane</span>
            </div>
            <span className="text-[10px] text-secondary uppercase font-mono">Fields</span>
          </div>

          {/* Dimensions */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1">
              <Type size={12} />
              <span>Dimensions</span>
            </div>
            <div className="space-y-1">
              {availableDimensions.map((dim) => (
                <button
                  key={dim}
                  onClick={() => handleAddColumn(dim)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono text-secondary hover:text-blue-300 hover:bg-blue-500/10 border border-transparent hover:border-blue-500/30 transition-all text-left group"
                >
                  <span className="flex items-center gap-2">
                    <Type size={11} className="text-blue-400/70" />
                    <span>{dim}</span>
                  </span>
                  <span className="text-[10px] opacity-0 group-hover:opacity-100 text-blue-400 font-sans">
                    + เพิ่ม
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Measures */}
          <div className="space-y-1.5 pt-2 border-t border-default/60">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
              <Hash size={12} />
              <span>Measures</span>
            </div>
            <div className="space-y-1">
              {availableMeasures.map((meas) => (
                <div
                  key={meas}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono text-secondary hover:text-emerald-300 hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/30 transition-all"
                >
                  <Hash size={11} className="text-emerald-400/70" />
                  <span>{meas}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center Visual Canvas (9 cols) */}
        <div className="lg:col-span-9 space-y-4">
          {/* Visual Relationship Node Diagram */}
          <div className="p-6 bg-elevated border border-default rounded-2xl shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2 text-xs font-bold text-secondary uppercase tracking-wider">
                <Share2 size={14} className="text-purple-400" />
                <span>Visual Relationship Canvas (Tableau Model)</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono">
                Join Type: Full Outer Diff
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              {/* Source Node */}
              <div className="p-4 bg-surface-secondary border-2 border-blue-500/50 rounded-xl shadow-md space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-blue-400 font-mono">Source Node (A)</span>
                  <Database size={14} className="text-blue-400" />
                </div>
                <div className="text-sm font-mono font-bold text-primary truncate">
                  {sourceTable || "source_table"}
                </div>
                <div className="text-[10px] text-muted truncate">
                  {sourceConnName} / {sourceDb}
                </div>
                <div className="pt-2 border-t border-default/40 space-y-1">
                  {columnsShelf.slice(0, 3).map((col) => (
                    <div key={col} className="text-[11px] font-mono text-secondary flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      <span>{col}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Relationship Join Pipe */}
              <div className="flex flex-col items-center justify-center text-center space-y-2 py-2">
                <div className="text-[10px] text-secondary font-mono bg-surface-secondary/90 px-3 py-1 rounded-full border border-default">
                  Key: <strong className="text-primary font-mono">{keyColumn}</strong>
                </div>
                <div className="w-full flex items-center justify-center">
                  <div className="h-0.5 w-full bg-linear-to-r from-blue-500 via-purple-500 to-emerald-500 relative flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs shadow-md">
                      ⇄
                    </div>
                  </div>
                </div>
                <span className="text-[10px] text-emerald-400 font-semibold">
                  Row-by-Row Diff Match
                </span>
              </div>

              {/* Target Node */}
              <div className="p-4 bg-surface-secondary border-2 border-emerald-500/50 rounded-xl shadow-md space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 font-mono">Target Node (B)</span>
                  <Database size={14} className="text-emerald-400" />
                </div>
                <div className="text-sm font-mono font-bold text-primary truncate">
                  {targetTable || "target_table"}
                </div>
                <div className="text-[10px] text-muted truncate">
                  {targetConnName} / {targetDb}
                </div>
                <div className="pt-2 border-t border-default/40 space-y-1">
                  {columnsShelf.slice(0, 3).map((col) => (
                    <div key={col} className="text-[11px] font-mono text-secondary flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span>{col}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Visual Match Distribution Bar */}
            <div className="mt-6 pt-5 border-t border-default space-y-2">
              <div className="flex items-center justify-between text-xs text-secondary">
                <span className="flex items-center gap-1.5 font-medium">
                  <PieChart size={14} className="text-purple-400" />
                  <span>สัดส่วนความตรงกันของข้อมูล (Diff Distribution)</span>
                </span>
                <span className="text-[11px] font-mono font-bold text-emerald-400">98.6% Identical</span>
              </div>
              <div className="h-3 w-full bg-surface-secondary rounded-full overflow-hidden flex shadow-inner">
                <div style={{ width: "98.6%" }} className="bg-emerald-500 hover:opacity-90 transition-all" title="Identical (98.6%)" />
                <div style={{ width: "1.1%" }} className="bg-amber-500 hover:opacity-90 transition-all" title="Modified (1.1%)" />
                <div style={{ width: "0.2%" }} className="bg-blue-500 hover:opacity-90 transition-all" title="Added (0.2%)" />
                <div style={{ width: "0.1%" }} className="bg-rose-500 hover:opacity-90 transition-all" title="Deleted (0.1%)" />
              </div>
              <div className="flex items-center gap-4 text-[11px] font-mono pt-1 text-muted">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> 1,240 ตรงกัน
                </span>
                <span className="flex items-center gap-1.5 text-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400" /> 14 มีการแก้ไข
                </span>
                <span className="flex items-center gap-1.5 text-blue-400">
                  <span className="w-2 h-2 rounded-full bg-blue-400" /> 3 เพิ่มใน Source
                </span>
                <span className="flex items-center gap-1.5 text-rose-400">
                  <span className="w-2 h-2 rounded-full bg-rose-400" /> 1 ตกหล่น / ลบ
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
