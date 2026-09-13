import { webMode } from "../../utils/webSession";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Users, Loader2, UserPlus, Trash2, Mail, Check } from "lucide-react";
import { useWorkspace } from "../../contexts/WorkspaceContext";

interface TeamMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TeamMembersModal: React.FC<TeamMembersModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { activeWorkspace, members, isMembersLoading, addMember, removeMember } = useWorkspace();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("editor");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const canManage = activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !activeWorkspace) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await addMember(activeWorkspace.id, email.trim(), role);
      setEmail("");
      setSuccess(t("team.memberAdded", { defaultValue: "Member invited successfully" }));
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to add member");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!activeWorkspace) return;
    try {
      await removeMember(activeWorkspace.id, userId);
    } catch (err: any) {
      setError(err?.message || "Failed to remove member");
    }
  };

  const getRoleBadge = (r: string) => {
    switch (r) {
      case "owner":
        return "bg-purple-900/30 text-purple-400 border-purple-800/50";
      case "admin":
        return "bg-blue-900/30 text-blue-400 border-blue-800/50";
      case "editor":
        return "bg-green-900/30 text-green-400 border-green-800/50";
      case "viewer":
      default:
        return "bg-slate-800/60 text-slate-400 border-slate-700/50";
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[640px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-900/30 rounded-lg">
              <Users size={20} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("team.title", { defaultValue: "Team Collaboration & Members" })}
              </h2>
              <p className="text-xs text-secondary">
                {activeWorkspace?.name || "Workspace"} · {activeWorkspace?.role.toUpperCase()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors p-1 rounded hover:bg-surface-secondary"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Description Box */}
          <div className="bg-surface-secondary/50 p-4 rounded-lg border border-strong">
            <p className="text-xs text-secondary leading-relaxed">
              {t("team.description", {
                defaultValue:
                  "Members of this workspace can share database connections, saved queries, and collaborate on schemas. Permissions are enforced according to each member's role.",
              })}
            </p>
          </div>

          {/* Add Member Form (Admins & Owners) */}
          {canManage && (
            <form onSubmit={handleAddMember} className="space-y-3 bg-base p-4 rounded-lg border border-default">
              <div className="text-xs uppercase font-bold text-muted flex items-center gap-1.5">
                <UserPlus size={14} className="text-blue-400" />
                {t("team.inviteLabel", { defaultValue: "Invite New Team Member" })}
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail size={16} className="absolute left-3 top-2.5 text-secondary pointer-events-none" />
                  <input
                    type={webMode ? "text" : "email"}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={webMode ? t("web.memberUserId", { defaultValue: "Existing user ID (usr_…)" }) : t("team.emailPlaceholder", { defaultValue: "teammate@company.com" })}
                    className="w-full pl-9 pr-3 py-2 bg-base border border-strong rounded-lg text-primary text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="px-3 py-2 bg-base border border-strong rounded-lg text-primary text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="viewer">Viewer (Read-only)</option>
                  <option value="editor">Editor (Query & Tables)</option>
                  <option value="admin">Admin (Manage Members & DBs)</option>
                </select>

                <button
                  type="submit"
                  disabled={isSubmitting || !email.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                  <span>{t("team.inviteButton", { defaultValue: "Invite" })}</span>
                </button>
              </div>

              {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
              {success && (
                <p className="text-xs text-green-400 flex items-center gap-1 mt-1">
                  <Check size={14} />
                  {success}
                </p>
              )}
            </form>
          )}

          {/* Members List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-bold text-muted">
                {t("team.membersCount", {
                  defaultValue: `Team Members (${members.length})`,
                  count: members.length,
                })}
              </span>
            </div>

            {isMembersLoading ? (
              <div className="text-center py-8 text-muted">
                <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                {t("common.loading", { defaultValue: "Loading members..." })}
              </div>
            ) : members.length === 0 ? (
              <div className="text-center py-8 text-secondary text-sm">
                {t("team.noMembers", { defaultValue: "No other members in this workspace yet." })}
              </div>
            ) : (
              <div className="divide-y divide-default border border-default rounded-lg overflow-hidden bg-base">
                {members.map((member) => (
                  <div key={member.user_id} className="p-3 flex items-center justify-between hover:bg-surface-secondary/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-surface-secondary flex items-center justify-center text-primary font-semibold text-xs border border-strong">
                        {(member.display_name || member.email || "U").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-primary">
                          {member.display_name || member.email || member.user_id}
                        </div>
                        {member.email && (
                          <div className="text-xs text-secondary">{member.email}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 text-xs rounded-full border font-medium uppercase ${getRoleBadge(member.role)}`}>
                        {member.role}
                      </span>

                      {canManage && member.role !== "owner" && (
                        <button
                          onClick={() => handleRemoveMember(member.user_id)}
                          title={t("common.remove", { defaultValue: "Remove member" })}
                          className="p-1.5 text-secondary hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-surface-secondary hover:bg-surface-tertiary text-primary rounded-lg text-sm font-medium transition-colors"
          >
            {t("common.close", { defaultValue: "Close" })}
          </button>
        </div>
      </div>
    </div>
  );
};
