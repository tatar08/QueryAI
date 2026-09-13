import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Building2, User, Plus, Users, Check } from "lucide-react";
import { useWorkspace, type Workspace } from "../../contexts/WorkspaceContext";

export const WorkspaceSelector: React.FC = () => {
  const { t } = useTranslation();
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspace,
    createWorkspace,
    setIsTeamModalOpen,
  } = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    try {
      await createWorkspace(newWsName.trim());
      setNewWsName("");
      setIsCreating(false);
      setIsOpen(false);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-secondary/60 hover:bg-surface-secondary border border-default text-xs font-medium text-primary transition-colors"
        title={t("team.switchWorkspace", { defaultValue: "Switch Workspace" })}
      >
        {activeWorkspace?.is_personal ? (
          <User size={14} className="text-secondary" />
        ) : (
          <Building2 size={14} className="text-blue-400" />
        )}
        <span className="max-w-[130px] truncate">{activeWorkspace?.name || "Workspace"}</span>
        <ChevronDown size={12} className="text-secondary opacity-70" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-64 bg-elevated border border-strong rounded-xl shadow-2xl z-50 overflow-hidden divide-y divide-default">
          {/* Header */}
          <div className="p-2.5 bg-base/50">
            <span className="text-[10px] uppercase font-bold text-muted tracking-wider">
              {t("team.workspacesHeader", { defaultValue: "Workspaces" })}
            </span>
          </div>

          {/* List */}
          <div className="p-1 space-y-0.5 max-h-56 overflow-y-auto">
            {workspaces.map((ws: Workspace) => {
              const isSelected = ws.id === activeWorkspace?.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => {
                    setActiveWorkspace(ws);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors ${
                    isSelected
                      ? "bg-blue-600/15 text-blue-400 font-medium"
                      : "text-secondary hover:text-primary hover:bg-surface-secondary"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {ws.is_personal ? (
                      <User size={14} className="text-secondary shrink-0" />
                    ) : (
                      <Building2 size={14} className="text-blue-400 shrink-0" />
                    )}
                    <span className="truncate">{ws.name}</span>
                  </div>
                  {isSelected && <Check size={14} className="text-blue-400 shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="p-1.5 space-y-1 bg-base/30">
            {!activeWorkspace?.is_personal && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  setIsTeamModalOpen(true);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-secondary hover:text-primary hover:bg-surface-secondary transition-colors"
              >
                <Users size={14} className="text-purple-400" />
                <span>{t("team.manageMembers", { defaultValue: "Manage Team Members" })}</span>
              </button>
            )}

            {isCreating ? (
              <form onSubmit={handleCreate} className="p-1 space-y-1.5">
                <input
                  type="text"
                  autoFocus
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  placeholder={t("team.workspaceName", { defaultValue: "Workspace name" })}
                  className="w-full px-2 py-1 bg-base border border-strong rounded text-xs text-primary focus:border-blue-500 focus:outline-none"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="px-2 py-0.5 text-[11px] text-secondary hover:text-primary"
                  >
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </button>
                  <button
                    type="submit"
                    disabled={!newWsName.trim()}
                    className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-medium"
                  >
                    {t("common.create", { defaultValue: "Create" })}
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-secondary hover:text-primary hover:bg-surface-secondary transition-colors"
              >
                <Plus size={14} className="text-blue-400" />
                <span>{t("team.createWorkspace", { defaultValue: "Create Team Workspace" })}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
