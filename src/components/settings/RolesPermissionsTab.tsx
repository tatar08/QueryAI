import { useState } from "react";
import {
  ShieldCheck,
  Eye,
  Check,
  RotateCcw,
  Lock,
  Building2,
  Sliders,
} from "lucide-react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import {
  type WorkspaceRole,
  type RoleMenuPermissions,
  type RoleActionPermissions,
  MENU_DEFINITIONS,
  ACTION_DEFINITIONS,
} from "../../types/rbac";
import { SettingSection } from "./SettingControls";

export function RolesPermissionsTab() {
  const {
    activeWorkspace,
    rolePermissions,
    updateRolePermissions,
    resetRolePermissions,
    previewRole,
    setPreviewRole,
    effectiveRole,
  } = useWorkspace();

  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const canConfigure =
    activeWorkspace?.role === "owner" ||
    activeWorkspace?.role === "admin" ||
    !activeWorkspace; // fallback to true in dev/single-user

  const handleToggleMenu = (
    role: WorkspaceRole,
    menuId: keyof RoleMenuPermissions,
    currentValue: boolean,
  ) => {
    if (!canConfigure || role === "owner") return;
    updateRolePermissions(role, {
      menus: {
        ...rolePermissions[role].menus,
        [menuId]: !currentValue,
      },
    });
    triggerSavedNotice();
  };

  const handleToggleAction = (
    role: WorkspaceRole,
    actionId: keyof RoleActionPermissions,
    currentValue: boolean,
  ) => {
    if (!canConfigure || role === "owner") return;
    updateRolePermissions(role, {
      actions: {
        ...rolePermissions[role].actions,
        [actionId]: !currentValue,
      },
    });
    triggerSavedNotice();
  };

  const triggerSavedNotice = () => {
    setSavedMessage("บันทึกการเปลี่ยนแปลงแล้ว");
    setTimeout(() => setSavedMessage(null), 2500);
  };

  const handleReset = () => {
    resetRolePermissions();
    setSavedMessage("รีเซ็ตสิทธิ์เป็นค่าเริ่มต้นเรียบร้อยแล้ว");
    setTimeout(() => setSavedMessage(null), 2500);
  };

  return (
    <div className="max-w-4xl pb-16 space-y-8 animate-fade-in">
      {/* Header Banner */}
      <div className="p-6 bg-gradient-to-r from-elevated via-elevated to-surface-secondary border border-strong rounded-2xl shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-700 text-white flex items-center justify-center shadow-lg shadow-purple-900/30 shrink-0">
            <ShieldCheck size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-primary">
                จัดการสิทธิ์ & การมองเห็นเมนู (RBAC & Menu Visibility)
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center gap-1">
                <Building2 size={12} />
                {activeWorkspace?.name || "Workspace"} ({effectiveRole.toUpperCase()})
              </span>
            </div>
            <p className="text-xs text-secondary mt-1 max-w-xl leading-relaxed">
              ผู้ดูแลระบบ (Admin/Owner) สามารถเปิดหรือปิดการมองเห็นเมนูในแถบ Sidebar และจำกัดสิทธิ์การรันคำสั่งแก้ไขฐานข้อมูลสำหรับแต่ละ Role ได้อย่างอิสระ
            </p>
          </div>
        </div>

        {canConfigure && (
          <button
            onClick={handleReset}
            className="px-3 py-1.5 bg-elevated hover:bg-hover border border-default text-secondary hover:text-primary rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
            title="คืนค่าสิทธิ์ตามมาตรฐานของระบบ"
          >
            <RotateCcw size={13} />
            รีเซ็ตค่าเริ่มต้น
          </button>
        )}
      </div>

      {savedMessage && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-xs text-emerald-300 flex items-center gap-2 animate-fade-in">
          <Check size={14} className="text-emerald-400" />
          <span>{savedMessage}</span>
        </div>
      )}

      {/* Role Preview Simulator */}
      <div className="p-4 bg-base border border-default rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Sliders size={16} className="text-amber-400" />
          <div>
            <span className="text-xs font-semibold text-primary block">
              จำลองมุมมองบทบาท (Role Simulator)
            </span>
            <span className="text-[11px] text-secondary">
              ทดลองดูว่าสมาชิกในแต่ละ Role จะมองเห็นเมนูและแถบ Sidebar อย่างไร
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 bg-elevated p-1 rounded-xl border border-default">
          <button
            onClick={() => setPreviewRole(null)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              previewRole === null
                ? "bg-purple-600 text-white shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
          >
            ค่าจริง ({activeWorkspace?.role || "Admin"})
          </button>
          <button
            onClick={() => setPreviewRole("admin")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              previewRole === "admin"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
          >
            🛡️ Admin
          </button>
          <button
            onClick={() => setPreviewRole("editor")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              previewRole === "editor"
                ? "bg-green-600 text-white shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
          >
            ✏️ Editor
          </button>
          <button
            onClick={() => setPreviewRole("viewer")}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              previewRole === "viewer"
                ? "bg-amber-600 text-white shadow-sm"
                : "text-secondary hover:text-primary"
            }`}
          >
            👁️ Viewer
          </button>
        </div>
      </div>

      {previewRole && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Eye size={14} />
            กำลังจำลองมุมมองบทบาท: <strong>{previewRole.toUpperCase()}</strong> (เมนูใน Sidebar และการเข้าถึงจะถูกจำลองตามบทบาทนี้)
          </span>
          <button
            onClick={() => setPreviewRole(null)}
            className="text-[11px] underline hover:text-white"
          >
            ปิดการจำลอง
          </button>
        </div>
      )}

      {/* Menu Visibility Matrix Section */}
      <SettingSection title="การมองเห็นเมนูในแถบ Sidebar (Menu Visibility Matrix)">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-default text-secondary">
                <th className="py-3 px-3 font-semibold w-5/12">เมนู / หน้าจอ (Navigation Menu)</th>
                <th className="py-3 px-3 text-center font-semibold w-2/12">
                  <span className="text-purple-400">👑 Owner</span>
                </th>
                <th className="py-3 px-3 text-center font-semibold w-2/12">
                  <span className="text-blue-400">🛡️ Admin</span>
                </th>
                <th className="py-3 px-3 text-center font-semibold w-2/12">
                  <span className="text-green-400">✏️ Editor</span>
                </th>
                <th className="py-3 px-3 text-center font-semibold w-2/12">
                  <span className="text-amber-400">👁️ Viewer</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default/50">
              {MENU_DEFINITIONS.map((menu) => {
                const isOwnerVisible = rolePermissions.owner?.menus[menu.id] ?? true;
                const isAdminVisible = rolePermissions.admin?.menus[menu.id] ?? true;
                const isEditorVisible = rolePermissions.editor?.menus[menu.id] ?? true;
                const isViewerVisible = rolePermissions.viewer?.menus[menu.id] ?? false;

                return (
                  <tr key={menu.id} className="hover:bg-hover/30 transition-colors">
                    <td className="py-3 px-3">
                      <span className="font-semibold text-primary block">{menu.labelKey}</span>
                      <span className="text-[11px] text-secondary">{menu.description}</span>
                    </td>

                    {/* Owner column */}
                    <td className="py-3 px-3 text-center">
                      {menu.id === "discord" ? (
                        <button
                          type="button"
                          disabled={!canConfigure}
                          onClick={() => handleToggleMenu("owner", menu.id, isOwnerVisible)}
                          className={`w-10 h-6 inline-flex items-center rounded-full transition-colors cursor-pointer p-0.5 ${
                            isOwnerVisible ? "bg-purple-600" : "bg-slate-800"
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                          aria-label={`Toggle Owner access for ${menu.labelKey}`}
                        >
                          <span
                            className={`w-5 h-5 rounded-full bg-white transition-transform ${
                              isOwnerVisible ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      ) : (
                        <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-purple-950/40 border border-purple-800/40 text-purple-400" title="Owner มีสิทธิ์เข้าถึงเสมอ">
                          <Lock size={12} />
                        </div>
                      )}
                    </td>

                    {/* Admin column */}
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        disabled={!canConfigure}
                        onClick={() => handleToggleMenu("admin", menu.id, isAdminVisible)}
                        className={`w-10 h-6 inline-flex items-center rounded-full transition-colors cursor-pointer p-0.5 ${
                          isAdminVisible ? "bg-blue-600" : "bg-slate-800"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        aria-label={`Toggle Admin access for ${menu.labelKey}`}
                      >
                        <span
                          className={`w-5 h-5 rounded-full bg-white transition-transform ${
                            isAdminVisible ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>

                    {/* Editor column */}
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        disabled={!canConfigure}
                        onClick={() => handleToggleMenu("editor", menu.id, isEditorVisible)}
                        className={`w-10 h-6 inline-flex items-center rounded-full transition-colors cursor-pointer p-0.5 ${
                          isEditorVisible ? "bg-green-600" : "bg-slate-800"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        aria-label={`Toggle Editor access for ${menu.labelKey}`}
                      >
                        <span
                          className={`w-5 h-5 rounded-full bg-white transition-transform ${
                            isEditorVisible ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>

                    {/* Viewer column */}
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        disabled={!canConfigure}
                        onClick={() => handleToggleMenu("viewer", menu.id, isViewerVisible)}
                        className={`w-10 h-6 inline-flex items-center rounded-full transition-colors cursor-pointer p-0.5 ${
                          isViewerVisible ? "bg-amber-600" : "bg-slate-800"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        aria-label={`Toggle Viewer access for ${menu.labelKey}`}
                      >
                        <span
                          className={`w-5 h-5 rounded-full bg-white transition-transform ${
                            isViewerVisible ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SettingSection>

      {/* Action Capabilities Matrix Section */}
      <SettingSection title="สิทธิ์การทำงาน & ความปลอดภัยของข้อมูล (Feature & Query Actions)">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-default text-secondary">
                <th className="py-3 px-3 font-semibold w-5/12">ความสามารถ (Action Capability)</th>
                <th className="py-3 px-3 text-center font-semibold w-2/12">
                  <span className="text-purple-400">👑 Owner</span>
                </th>
                <th className="py-3 px-3 text-center font-semibold w-2/12">
                  <span className="text-blue-400">🛡️ Admin</span>
                </th>
                <th className="py-3 px-3 text-center font-semibold w-2/12">
                  <span className="text-green-400">✏️ Editor</span>
                </th>
                <th className="py-3 px-3 text-center font-semibold w-2/12">
                  <span className="text-amber-400">👁️ Viewer</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default/50">
              {ACTION_DEFINITIONS.map((action) => {
                const isAdminAllowed = rolePermissions.admin.actions[action.id] ?? true;
                const isEditorAllowed = rolePermissions.editor.actions[action.id] ?? true;
                const isViewerAllowed = rolePermissions.viewer.actions[action.id] ?? false;

                return (
                  <tr key={action.id} className="hover:bg-hover/30 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-primary">{action.labelKey}</span>
                        {action.isDangerous && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
                            Critical
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-secondary">{action.description}</span>
                    </td>

                    {/* Owner column (Fixed) */}
                    <td className="py-3 px-3 text-center">
                      <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-purple-950/40 border border-purple-800/40 text-purple-400">
                        <Check size={14} />
                      </div>
                    </td>

                    {/* Admin column */}
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        disabled={!canConfigure}
                        onClick={() => handleToggleAction("admin", action.id, isAdminAllowed)}
                        className={`w-10 h-6 inline-flex items-center rounded-full transition-colors cursor-pointer p-0.5 ${
                          isAdminAllowed ? "bg-blue-600" : "bg-slate-800"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        aria-label={`Toggle Admin action for ${action.labelKey}`}
                      >
                        <span
                          className={`w-5 h-5 rounded-full bg-white transition-transform ${
                            isAdminAllowed ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>

                    {/* Editor column */}
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        disabled={!canConfigure}
                        onClick={() => handleToggleAction("editor", action.id, isEditorAllowed)}
                        className={`w-10 h-6 inline-flex items-center rounded-full transition-colors cursor-pointer p-0.5 ${
                          isEditorAllowed ? "bg-green-600" : "bg-slate-800"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        aria-label={`Toggle Editor action for ${action.labelKey}`}
                      >
                        <span
                          className={`w-5 h-5 rounded-full bg-white transition-transform ${
                            isEditorAllowed ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>

                    {/* Viewer column */}
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        disabled={!canConfigure}
                        onClick={() => handleToggleAction("viewer", action.id, isViewerAllowed)}
                        className={`w-10 h-6 inline-flex items-center rounded-full transition-colors cursor-pointer p-0.5 ${
                          isViewerAllowed ? "bg-amber-600" : "bg-slate-800"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        aria-label={`Toggle Viewer action for ${action.labelKey}`}
                      >
                        <span
                          className={`w-5 h-5 rounded-full bg-white transition-transform ${
                            isViewerAllowed ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SettingSection>
    </div>
  );
}
