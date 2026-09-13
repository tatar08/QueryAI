import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Search, Database, Check, CornerDownLeft, Server, ArrowUpDown } from "lucide-react";

export interface QuickDatabaseSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableDatabases: string[];
  activeDatabase: string | null;
  connectionName: string | null;
  host?: string;
  onSelectDatabase: (dbName: string) => void;
}

export const QuickDatabaseSwitcherModal = ({
  isOpen,
  onClose,
  availableDatabases,
  activeDatabase,
  connectionName,
  host,
  onSelectDatabase,
}: QuickDatabaseSwitcherModalProps) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filtered databases based on search
  const filteredDatabases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableDatabases;
    return availableDatabases.filter((db) => db.toLowerCase().includes(q));
  }, [availableDatabases, searchQuery]);

  // Reset search and selection on open
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      // Select the active database initially if in list
      const idx = availableDatabases.findIndex((db) => db === activeDatabase);
      setSelectedIndex(idx >= 0 ? idx : 0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, availableDatabases, activeDatabase]);

  // Adjust selection bounds when filter changes
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (filteredDatabases.length === 0) return 0;
      return Math.min(prev, filteredDatabases.length - 1);
    });
  }, [filteredDatabases]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`
    ) as HTMLElement | null;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (dbName: string) => {
      onSelectDatabase(dbName);
      onClose();
    },
    [onSelectDatabase, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredDatabases.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredDatabases.length - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredDatabases[selectedIndex]) {
        handleSelect(filteredDatabases[selectedIndex]);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[100] backdrop-blur-md flex items-start justify-center pt-[12vh] px-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-elevated/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-[560px] overflow-hidden flex flex-col backdrop-blur-xl border-t border-t-white/20 transition-all"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="flex items-center px-4 py-3.5 border-b border-default/60 bg-surface/50 gap-3">
          <Search size={18} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              host
                ? `Search databases across ${host}...`
                : t("sidebar.filterDatabases") || "Search databases..."
            }
            className="w-full bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <kbd className="px-2 py-0.5 text-[10px] font-medium text-muted bg-surface-secondary/80 border border-default/60 rounded shadow-xs">
              ESC
            </kbd>
          </div>
        </div>

        {/* Server Context Breadcrumb */}
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-muted bg-surface-secondary/30 border-b border-default/30">
          <div className="flex items-center gap-2">
            <Server size={12} className="text-blue-400" />
            <span className="font-medium text-secondary">
              {connectionName || "PostgreSQL Cluster"}
            </span>
            {host && <span className="text-muted/70">({host})</span>}
          </div>
          <span className="text-[10px] font-mono text-muted">
            {filteredDatabases.length} databases
          </span>
        </div>

        {/* Database List */}
        <div
          ref={listRef}
          className="max-h-[340px] overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-default/40"
        >
          {filteredDatabases.length === 0 ? (
            <div className="py-8 text-center text-muted text-xs">
              No databases found matching &ldquo;{searchQuery}&rdquo;
            </div>
          ) : (
            filteredDatabases.map((db, idx) => {
              const isActive = db === activeDatabase;
              const isSelected = idx === selectedIndex;

              return (
                <div
                  key={db}
                  data-index={idx}
                  onClick={() => handleSelect(db)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 group ${
                    isSelected
                      ? "bg-blue-500/15 border border-blue-500/30 text-primary shadow-xs"
                      : "hover:bg-surface-secondary/60 text-secondary border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-lg transition-colors ${
                        isActive
                          ? "bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/40"
                          : isSelected
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-surface-secondary/80 text-muted group-hover:text-secondary"
                      }`}
                    >
                      <Database size={15} />
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm truncate font-medium ${
                            isActive
                              ? "text-cyan-300 font-semibold"
                              : isSelected
                              ? "text-primary"
                              : "text-secondary"
                          }`}
                        >
                          {db}
                        </span>

                        {isActive && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                            ACTIVE
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isActive ? (
                      <Check size={16} className="text-cyan-400" />
                    ) : isSelected ? (
                      <div className="flex items-center gap-1 text-[11px] text-blue-400 font-medium">
                        <span>Switch</span>
                        <CornerDownLeft size={12} />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Keyboard Hints Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-default/50 bg-surface/60 text-[11px] text-muted">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 text-[9px] bg-surface-secondary border border-default/60 rounded">
                <ArrowUpDown size={10} className="inline" />
              </kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 text-[9px] bg-surface-secondary border border-default/60 rounded">
                ↵
              </kbd>
              Switch Database
            </span>
          </div>
          <span className="text-[10px] text-muted/80">Tabularis Quick Switcher</span>
        </div>
      </div>
    </div>
  );
};
