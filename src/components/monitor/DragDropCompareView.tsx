import React, { useState } from "react";
import {
  Database,
  ArrowRightLeft,
  GripVertical,
  CheckCircle2,
  Trash2,
  Play,
  Layers,
  Sparkles,
  ArrowLeftRight,
} from "lucide-react";
import { Button } from "../ui/Button";

export interface DragDropCompareViewProps {
  allConnections: any[];
  openConnections: any[];
  sourceTablesList: string[];
  targetTablesList: string[];
  sourceConnId: string;
  targetConnId: string;
  sourceDb: string;
  targetDb: string;
  sourceTable: string;
  targetTable: string;
  onSelectSourceTable: (tbl: string) => void;
  onSelectTargetTable: (tbl: string) => void;
  onSwap: () => void;
  onRunCompare: () => void;
  isComparing: boolean;
}

export const DragDropCompareView: React.FC<DragDropCompareViewProps> = ({
  allConnections,
  sourceTablesList,
  targetTablesList,
  sourceConnId,
  targetConnId,
  sourceDb,
  targetDb,
  sourceTable,
  targetTable,
  onSelectSourceTable,
  onSelectTargetTable,
  onSwap,
  onRunCompare,
  isComparing,
}) => {
  const [draggedTable, setDraggedTable] = useState<string | null>(null);
  const [isHoverSource, setIsHoverSource] = useState(false);
  const [isHoverTarget, setIsHoverTarget] = useState(false);
  const [searchTable, setSearchTable] = useState("");

  const srcConnObj = allConnections.find((c) => c.id === sourceConnId);
  const tgtConnObj = allConnections.find((c) => c.id === targetConnId);

  const filteredPaletteTables = Array.from(
    new Set([...sourceTablesList, ...targetTablesList])
  ).filter((tbl) => tbl.toLowerCase().includes(searchTable.toLowerCase()));

  const handleDragStart = (e: React.DragEvent, tbl: string) => {
    e.dataTransfer.setData("text/plain", tbl);
    setDraggedTable(tbl);
  };

  const handleDragEnd = () => {
    setDraggedTable(null);
    setIsHoverSource(false);
    setIsHoverTarget(false);
  };

  const handleDropSource = (e: React.DragEvent) => {
    e.preventDefault();
    const tbl = e.dataTransfer.getData("text/plain") || draggedTable;
    if (tbl) onSelectSourceTable(tbl);
    setIsHoverSource(false);
  };

  const handleDropTarget = (e: React.DragEvent) => {
    e.preventDefault();
    const tbl = e.dataTransfer.getData("text/plain") || draggedTable;
    if (tbl) onSelectTargetTable(tbl);
    setIsHoverTarget(false);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Banner / Instructions */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-xl">
            <Sparkles size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-primary">
              ลากและวางตารางอย่างง่ายดาย (Easy Drag & Drop)
            </h3>
            <p className="text-xs text-secondary mt-0.5">
              หยิบการ์ดตารางจากพาเนลซ้าย แล้วลากมาวางในช่อง <strong>ต้นทาง (Source)</strong> หรือ <strong>ปลายทาง (Target)</strong> ได้ทันที
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={onRunCompare}
          disabled={isComparing}
          className="flex items-center gap-2 shadow-lg shadow-blue-500/20"
        >
          <Play size={14} className={isComparing ? "animate-spin" : ""} />
          <span>{isComparing ? "กำลังเทียบ..." : "เริ่มเปรียบเทียบ"}</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Draggable Tables Palette (4 cols) */}
        <div className="lg:col-span-4 p-5 bg-elevated border border-default rounded-2xl space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-primary">
              <Layers size={16} className="text-blue-400" />
              <span>รายการตาราง (Table Palette)</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-secondary text-secondary border border-default font-mono">
              {filteredPaletteTables.length} ตาราง
            </span>
          </div>

          <input
            type="text"
            placeholder="ค้นหาชื่อตาราง..."
            value={searchTable}
            onChange={(e) => setSearchTable(e.target.value)}
            className="w-full px-3 py-1.5 bg-surface-secondary border border-default rounded-xl text-xs text-primary placeholder-muted focus:outline-none focus:border-blue-500"
          />

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {filteredPaletteTables.map((tbl) => {
              const isSelectedSource = sourceTable === tbl;
              const isSelectedTarget = targetTable === tbl;

              return (
                <div
                  key={tbl}
                  draggable
                  onDragStart={(e) => handleDragStart(e, tbl)}
                  onDragEnd={handleDragEnd}
                  className={`group p-3 bg-surface-secondary hover:bg-surface-elevated border transition-all rounded-xl cursor-grab active:cursor-grabbing flex items-center justify-between gap-2 select-none shadow-sm hover:shadow-md hover:border-blue-500/50 ${
                    isSelectedSource
                      ? "border-blue-500/60 bg-blue-500/10"
                      : isSelectedTarget
                      ? "border-emerald-500/60 bg-emerald-500/10"
                      : "border-default"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <GripVertical size={14} className="text-muted group-hover:text-primary transition-colors" />
                    <span className="text-xs font-mono font-medium text-primary truncate">
                      {tbl}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isSelectedSource && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-400">
                        Source
                      </span>
                    )}
                    {isSelectedTarget && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400">
                        Target
                      </span>
                    )}
                    <button
                      onClick={() => onSelectSourceTable(tbl)}
                      title="ตั้งเป็น Source"
                      className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-all"
                    >
                      + ต้นทาง
                    </button>
                    <button
                      onClick={() => onSelectTargetTable(tbl)}
                      title="ตั้งเป็น Target"
                      className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-all"
                    >
                      + ปลายทาง
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Drop Zones (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="relative grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Source Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsHoverSource(true);
              }}
              onDragLeave={() => setIsHoverSource(false)}
              onDrop={handleDropSource}
              className={`p-6 bg-elevated border-2 rounded-2xl transition-all duration-200 flex flex-col justify-between min-h-[260px] shadow-sm relative ${
                isHoverSource
                  ? "border-blue-500 bg-blue-500/10 scale-[1.01] ring-4 ring-blue-500/20"
                  : "border-dashed border-default hover:border-blue-500/50"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-blue-400">
                    <Database size={18} />
                    <span>ข้อมูลต้นทาง (Source)</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase font-mono">
                    {srcConnObj?.name || "Source DB"} ({sourceDb || "default"})
                  </span>
                </div>

                {sourceTable ? (
                  <div className="p-4 bg-surface-secondary/90 border border-blue-500/40 rounded-xl space-y-2 animate-fade-in shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-blue-400" />
                        <span className="text-xs font-semibold text-secondary">ตารางที่เลือก:</span>
                      </div>
                      <button
                        onClick={() => onSelectSourceTable("")}
                        className="text-muted hover:text-rose-400 transition-colors p-1"
                        title="ล้างตารางนี้"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="text-base font-mono font-bold text-blue-400">
                      {sourceTable}
                    </div>
                    <div className="text-[11px] text-muted">
                      ฐานข้อมูล: <span className="text-primary font-mono">{srcConnObj?.name}</span> / <span className="text-primary font-mono">{sourceDb}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                    <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center">
                      <ArrowRightLeft size={22} />
                    </div>
                    <div className="text-xs font-medium text-primary">
                      ลากตารางมาปล่อยที่นี่
                    </div>
                    <div className="text-[11px] text-muted">
                      หรือกดปุ่ม &quot;+ ต้นทาง&quot; จากพาเนลซ้าย
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-default/50 text-[11px] text-secondary flex items-center justify-between">
                <span>สถานะ: {sourceTable ? "พร้อมเปรียบเทียบ" : "ยังไม่ได้เลือกตาราง"}</span>
                <span className="font-mono text-blue-400">{sourceTable || "-"}</span>
              </div>
            </div>

            {/* Swap Button */}
            <button
              onClick={onSwap}
              title="สลับต้นทางและปลายทาง (Swap)"
              className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 p-3 bg-surface-elevated border border-strong rounded-full shadow-xl text-secondary hover:text-blue-400 hover:scale-110 active:scale-95 transition-all"
            >
              <ArrowLeftRight size={18} />
            </button>

            {/* Target Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsHoverTarget(true);
              }}
              onDragLeave={() => setIsHoverTarget(false)}
              onDrop={handleDropTarget}
              className={`p-6 bg-elevated border-2 rounded-2xl transition-all duration-200 flex flex-col justify-between min-h-[260px] shadow-sm relative ${
                isHoverTarget
                  ? "border-emerald-500 bg-emerald-500/10 scale-[1.01] ring-4 ring-emerald-500/20"
                  : "border-dashed border-default hover:border-emerald-500/50"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                    <Database size={18} />
                    <span>ข้อมูลปลายทาง (Target)</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase font-mono">
                    {tgtConnObj?.name || "Target DB"} ({targetDb || "default"})
                  </span>
                </div>

                {targetTable ? (
                  <div className="p-4 bg-surface-secondary/90 border border-emerald-500/40 rounded-xl space-y-2 animate-fade-in shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-emerald-400" />
                        <span className="text-xs font-semibold text-secondary">ตารางที่เลือก:</span>
                      </div>
                      <button
                        onClick={() => onSelectTargetTable("")}
                        className="text-muted hover:text-rose-400 transition-colors p-1"
                        title="ล้างตารางนี้"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="text-base font-mono font-bold text-emerald-400">
                      {targetTable}
                    </div>
                    <div className="text-[11px] text-muted">
                      ฐานข้อมูล: <span className="text-primary font-mono">{tgtConnObj?.name}</span> / <span className="text-primary font-mono">{targetDb}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                      <ArrowRightLeft size={22} />
                    </div>
                    <div className="text-xs font-medium text-primary">
                      ลากตารางมาปล่อยที่นี่
                    </div>
                    <div className="text-[11px] text-muted">
                      หรือกดปุ่ม &quot;+ ปลายทาง&quot; จากพาเนลซ้าย
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-default/50 text-[11px] text-secondary flex items-center justify-between">
                <span>สถานะ: {targetTable ? "พร้อมเปรียบเทียบ" : "ยังไม่ได้เลือกตาราง"}</span>
                <span className="font-mono text-emerald-400">{targetTable || "-"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
