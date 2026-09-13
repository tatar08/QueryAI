import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowRightLeft,
  FileBarChart,
  Database,
} from "lucide-react";
import clsx from "clsx";
import { ServerMonitorView } from "../components/monitor/ServerMonitorView";
import { CompareDataView } from "../components/monitor/CompareDataView";
import { ReportsView } from "../components/monitor/ReportsView";
import { useDatabase } from "../hooks/useDatabase";

export type MonitorNavTab = "monitor" | "compare" | "reports";

interface NavItemDef {
  id: MonitorNavTab;
  icon: React.ComponentType<{ size: number; className?: string }>;
  label: string;
  badge?: string;
}

const NAV_ITEMS: NavItemDef[] = [
  {
    id: "monitor",
    icon: Activity,
    label: "Server Monitor",
    badge: "LIVE",
  },
  {
    id: "compare",
    icon: ArrowRightLeft,
    label: "Compare Data",
  },
  {
    id: "reports",
    icon: FileBarChart,
    label: "Reports",
  },
];

export const MonitorPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as MonitorNavTab | null;
  const [activeTab, setActiveTab] = useState<MonitorNavTab>(
    tabParam && (tabParam === "monitor" || tabParam === "compare" || tabParam === "reports")
      ? tabParam
      : "monitor"
  );

  const { connections, activeConnectionId, switchConnection } = useDatabase();
  const currentConn = connections.find((c) => c.id === activeConnectionId) || connections[0];

  useEffect(() => {
    if (tabParam && (tabParam === "monitor" || tabParam === "compare" || tabParam === "reports")) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleSelectTab = (tab: MonitorNavTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  return (
    <div className="h-full flex bg-base overflow-hidden">
      {/* Secondary Sidebar Panel (Master Navigation) */}
      <aside className="w-56 flex flex-col border-r border-default bg-elevated shrink-0 select-none">
        {/* Panel Header */}
        <div className="p-4 border-b border-default/70 flex items-center gap-2.5">
          <div className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-cyan-400">
            <Activity size={18} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-primary tracking-tight">Monitor & Tools</h2>
            <p className="text-[11px] text-secondary">Real-time Telemetry</p>
          </div>
        </div>

        {/* Navigation Items List */}
        <div className="flex-1 py-3 px-2 overflow-y-auto space-y-1">
          {NAV_ITEMS.map(({ id, icon: Icon, label, badge }) => {
            const isSelected = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => handleSelectTab(id)}
                className={clsx(
                  "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left group",
                  isSelected
                    ? "bg-surface-secondary text-primary font-semibold shadow-sm border border-default"
                    : "text-secondary hover:text-primary hover:bg-surface-secondary/50"
                )}
              >
                <div className="flex items-center gap-3 truncate">
                  <Icon
                    size={16}
                    className={
                      isSelected
                        ? "text-cyan-400"
                        : "text-muted group-hover:text-primary transition-colors"
                    }
                  />
                  <span className="truncate">{label}</span>
                </div>

                {badge && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Bottom Connection Switcher Status */}
        <div className="p-3 border-t border-default/70 bg-base/40 text-xs">
          <div className="text-[10px] text-muted uppercase font-mono mb-1.5 flex items-center gap-1">
            <Database size={12} />
            <span>Target Connection</span>
          </div>
          <select
            value={activeConnectionId || currentConn?.id}
            onChange={(e) => switchConnection(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-surface-secondary border border-default rounded-xl text-xs text-primary outline-none cursor-pointer truncate font-mono"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 overflow-y-auto p-6 md:p-8 bg-base">
        <div className="max-w-7xl mx-auto">
          {activeTab === "monitor" && <ServerMonitorView />}
          {activeTab === "compare" && <CompareDataView />}
          {activeTab === "reports" && <ReportsView />}
        </div>
      </main>
    </div>
  );
};
export default MonitorPage;
