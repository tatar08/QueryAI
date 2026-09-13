import { webMode } from "../../utils/webSession";
import React, { useState, useEffect } from "react";
import {
  KeyRound,
  Copy,
  Check,
  LogOut,
  Sparkles,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Building2,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { validatePin } from "../../tauri-web-shim/core";
import { SettingSection, SettingRow } from "./SettingControls";

interface ProfileUser {
  id: string;
  username: string;
  display_name?: string | null;
  recovery_email?: string | null;
}

export function ProfileTab() {
  const { activeWorkspace, effectiveRole, canPerformAction } = useWorkspace();

  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Edit profile state
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  // Change PIN state
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmNewPin, setConfirmNewPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);
  const [isSubmittingPin, setIsSubmittingPin] = useState(false);

  // Token copy state
  const [tokenCopied, setTokenCopied] = useState(false);
  const [userIdCopied, setUserIdCopied] = useState(false);

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    setIsLoading(true);
    try {
      const res = await invoke<{
        authenticated: boolean;
        token: string | null;
        user: ProfileUser | null;
      }>("pin_get_current_user");

      if (res?.authenticated && res.user) {
        setUser(res.user);
        setToken(res.token);
        setRecoveryEmail(res.user.recovery_email || "");
      } else {
        // Fallback: check localStorage directly
        const storedToken = localStorage.getItem("tabularis_jwt_token");
        const storedUser = localStorage.getItem("tabularis_web_current_user");
        if (storedToken && storedUser) {
          try {
            const parsed = JSON.parse(storedUser);
            setUser(parsed);
            setToken(storedToken);
            setRecoveryEmail(parsed.recovery_email || "");
          } catch {
            // Ignored
          }
        }
      }
    } catch (err) {
      console.error("Failed to load user profile:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyUserId = () => {
    if (!user?.id) return;
    navigator.clipboard.writeText(user.id);
    setUserIdCopied(true);
    setTimeout(() => setUserIdCopied(false), 2000);
  };

  const handleCopyToken = () => {
    if (!token) return;
    navigator.clipboard.writeText(`Bearer ${token}`);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const handleSaveEmail = async () => {
    if (!user) return;
    setIsSavingEmail(true);
    setEmailSuccess(null);
    try {
      await invoke("pin_update_profile", {
        user_id: user.id,
        recovery_email: recoveryEmail.trim() || null,
      });
      setUser({ ...user, recovery_email: recoveryEmail.trim() || null });
      setEmailSuccess("บันทึกอีเมลเรียบร้อยแล้ว");
      setTimeout(() => setEmailSuccess(null), 3000);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSavingEmail(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setPinSuccess(null);

    if (!user) return;

    if (!oldPin.trim()) {
      setPinError("กรุณากรอกรหัส PIN เดิม");
      return;
    }

    const val = validatePin(newPin);
    if (!val.valid) {
      setPinError(val.error || "รหัส PIN ใหม่ไม่ถูกต้อง");
      return;
    }

    if (newPin !== confirmNewPin) {
      setPinError("รหัส PIN ใหม่ไม่ตรงกัน");
      return;
    }

    if (oldPin === newPin) {
      setPinError("รหัส PIN ใหม่ต้องไม่ซ้ำกับรหัส PIN เดิม");
      return;
    }

    setIsSubmittingPin(true);
    try {
      await invoke("pin_change", {
        username: user.username,
        old_pin: oldPin.trim(),
        new_pin: newPin.trim(),
      });

      setPinSuccess("เปลี่ยนรหัส PIN สำเร็จเรียบร้อยแล้ว!");
      setOldPin("");
      setNewPin("");
      setConfirmNewPin("");
      setTimeout(() => {
        setIsChangingPin(false);
        setPinSuccess(null);
      }, 2500);
    } catch (err: any) {
      setPinError(err?.message || "เปลี่ยนรหัส PIN ไม่สำเร็จ ตรวจสอบรหัส PIN เดิม");
    } finally {
      setIsSubmittingPin(false);
    }
  };

  const handleLogout = async () => {
    try {
      await invoke("pin_logout");
    } catch (cause: unknown) {
      setLogoutError(String(cause));
      return;
    }
    setUser(null);
    setToken(null);
  };

  const parseJwt = (jwtString: string) => {
    try {
      const parts = jwtString.split(".");
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(b64));
    } catch {
      return null;
    }
  };

  const claims = token ? parseJwt(token) : null;
  const pinValidation = newPin ? validatePin(newPin) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted gap-2">
        <Loader2 className="animate-spin" size={20} />
        <span>กำลังโหลดข้อมูลโปรไฟล์...</span>
      </div>
    );
  }

  if (!user || !token) {
    return (
      <div className="max-w-2xl py-6 space-y-6">
        <div className="p-8 border border-default bg-elevated rounded-2xl text-center space-y-4 shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
            <KeyRound size={32} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-primary">
              ยังไม่ได้เข้าสู่ระบบ (Not Authenticated)
            </h2>
            <p className="text-sm text-secondary mt-1 max-w-md mx-auto">
              เข้าสู่ระบบหรือลงทะเบียนด้วยรหัส PIN 6–8 หลัก เพื่อเปิดใช้งานการยืนยันตัวตนด้วย JWT Token และจัดการข้อมูลโปรไฟล์
            </p>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-pin-auth"))}
            className="px-6 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-orange-950/20 inline-flex items-center gap-2 transition-all cursor-pointer"
          >
            <Lock size={16} />
            เข้าสู่ระบบ / ลงทะเบียนด้วย PIN
          </button>
        </div>
      </div>
    );
  }

  const initialLetter = (user.display_name || user.username || "U")[0].toUpperCase();

  return (
    <div className="max-w-3xl pb-12 space-y-8 animate-fade-in">
      {logoutError && <p role="alert" className="text-red-400">{logoutError}</p>}
      {/* Top Profile Hero Card */}
      <div className="p-6 bg-gradient-to-r from-elevated via-elevated to-surface-secondary border border-strong rounded-2xl shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center text-2xl font-bold shadow-lg shadow-amber-500/20 shrink-0">
            {initialLetter}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-primary">
                {user.display_name || user.username}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <ShieldCheck size={12} />
                JWT Active (HS256)
              </span>
              {activeWorkspace && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30 flex items-center gap-1">
                  <Building2 size={12} />
                  {activeWorkspace.role || "Member"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-secondary">
              <span>Username: <strong className="text-primary font-medium">{user.username}</strong></span>
              <span>•</span>
              <button
                onClick={handleCopyUserId}
                className="hover:text-primary transition-colors flex items-center gap-1"
                title="คลิกเพื่อคัดลอก User ID"
              >
                <span>ID: {user.id.slice(0, 14)}...</span>
                {userIdCopied ? (
                  <Check size={12} className="text-emerald-400" />
                ) : (
                  <Copy size={12} />
                )}
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="px-3.5 py-2 bg-red-950/30 hover:bg-red-900/40 text-red-300 border border-red-800/40 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
        >
          <LogOut size={14} />
          ออกจากระบบ (Logout)
        </button>
      </div>

      {/* Account & Details Section */}
      <SettingSection title="ข้อมูลบัญชี (Account Information)">
        <SettingRow
          label="ชื่อผู้ใช้ (Username)"
          description="ชื่อบัญชีที่ใช้เข้าสู่ระบบด้วยรหัส PIN"
        >
          <div className="font-mono text-xs px-3 py-1.5 bg-base border border-default rounded-lg text-primary">
            {user.username}
          </div>
        </SettingRow>

        {!webMode && (<SettingRow
          label="อีเมลสำหรับการกู้คืน (Recovery Email)"
          description="ใช้อีเมลนี้ในการติดต่อหรือกู้คืนบัญชีเมื่อลืมรหัส PIN"
        >
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={recoveryEmail}
              onChange={(e) => setRecoveryEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-64 px-3 py-1.5 bg-base border border-default rounded-lg text-xs text-primary focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={handleSaveEmail}
              disabled={isSavingEmail}
              className="px-3 py-1.5 bg-elevated hover:bg-hover border border-default text-primary rounded-lg text-xs font-medium transition-colors"
            >
              {isSavingEmail ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </SettingRow>)}
        {emailSuccess && (
          <div className="text-xs text-emerald-400 flex items-center gap-1 py-1">
            <CheckCircle2 size={13} /> {emailSuccess}
          </div>
        )}

        <SettingRow
          label="Workspace ปัจจุบัน"
          description="พื้นที่ทำงานที่กำลังใช้งานและการเข้าถึงฐานข้อมูลร่วมกัน"
        >
          <div className="text-xs text-primary flex items-center gap-2">
            <span className="font-medium">{activeWorkspace?.name || "Personal Workspace"}</span>
            <span className="text-[10px] text-muted">({activeWorkspace?.id || "ws-personal"})</span>
          </div>
        </SettingRow>

        <SettingRow
          label="บทบาท & สิทธิ์การทำงาน (Role & Permissions)"
          description="สิทธิ์การเข้าถึงข้อมูลและคำสั่ง SQL ตามนโยบายความปลอดภัย RBAC"
          vertical
        >
          <div className="p-3 bg-base border border-default rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-elevated border border-default/60">
              <span className="text-[10px] text-muted block mb-0.5">Role ในระบบ:</span>
              <span className="font-bold text-purple-400 capitalize">{effectiveRole}</span>
            </div>
            <div className="p-2 rounded-lg bg-elevated border border-default/60">
              <span className="text-[10px] text-muted block mb-0.5">คำสั่ง Read (SELECT):</span>
              <span className="text-emerald-400 font-medium">✅ อนุญาต</span>
            </div>
            <div className="p-2 rounded-lg bg-elevated border border-default/60">
              <span className="text-[10px] text-muted block mb-0.5">คำสั่ง Write (UPDATE/DEL):</span>
              <span className={canPerformAction("write_queries") ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>
                {canPerformAction("write_queries") ? "✅ อนุญาต" : "❌ ถูกระงับ (Viewer)"}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-elevated border border-default/60">
              <span className="text-[10px] text-muted block mb-0.5">จัดการการเชื่อมต่อ:</span>
              <span className={canPerformAction("create_connections") ? "text-emerald-400 font-medium" : "text-slate-400 font-medium"}>
                {canPerformAction("create_connections") ? "✅ อนุญาต" : "❌ ไม่มีสิทธิ์"}
              </span>
            </div>
          </div>
        </SettingRow>
      </SettingSection>

      {/* Security & PIN Section */}
      <SettingSection title="ความปลอดภัย & รหัส PIN (PIN Security)">
        <SettingRow
          label="การป้องกันด้วยรหัส PIN (6–8 หลัก)"
          description="รหัสตัวเลขเฉพาะสำหรับล็อกอินเข้าระบบอย่างรวดเร็วและปลอดภัย"
        >
          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 size={14} /> เปิดใช้งานแล้ว
            </span>
            <button
              onClick={() => setIsChangingPin(!isChangingPin)}
              className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium transition-all"
            >
              {isChangingPin ? "ยกเลิก" : "เปลี่ยนรหัส PIN (Change PIN)"}
            </button>
          </div>
        </SettingRow>

        {/* Change PIN Form */}
        {isChangingPin && (
          <form
            onSubmit={handleChangePin}
            className="my-3 p-4 bg-base border border-default rounded-xl space-y-3 animate-fade-in"
          >
            <h4 className="text-xs font-semibold text-primary flex items-center gap-1.5">
              <Lock size={14} className="text-amber-400" />
              กำหนดรหัส PIN ใหม่
            </h4>

            {pinError && (
              <div className="p-2.5 bg-red-950/40 border border-red-800/50 rounded-lg text-xs text-red-300 flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0 text-red-400" />
                <span>{pinError}</span>
              </div>
            )}
            {pinSuccess && (
              <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/50 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                <span>{pinSuccess}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] text-secondary block mb-1">
                  รหัส PIN เดิม (Current PIN)
                </label>
                <input
                  type="password"
                  maxLength={8}
                  value={oldPin}
                  onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="PIN เดิม 6–8 หลัก"
                  className="w-full px-3 py-1.5 bg-elevated border border-default rounded-lg text-xs text-primary font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-[11px] text-secondary block mb-1">
                  รหัส PIN ใหม่ (New PIN)
                </label>
                <input
                  type="password"
                  maxLength={8}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="PIN ใหม่ 6–8 หลัก"
                  className="w-full px-3 py-1.5 bg-elevated border border-default rounded-lg text-xs text-primary font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-[11px] text-secondary block mb-1">
                  ยืนยัน PIN ใหม่ (Confirm)
                </label>
                <input
                  type="password"
                  maxLength={8}
                  value={confirmNewPin}
                  onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="ยืนยัน PIN ใหม่อีกครั้ง"
                  className="w-full px-3 py-1.5 bg-elevated border border-default rounded-lg text-xs text-primary font-mono focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {newPin.length >= 2 && pinValidation && (
              <div className="text-[11px]">
                {pinValidation.valid ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={12} /> PIN มีความปลอดภัย (6–8 หลัก ไม่ซ้ำ/ไม่เรียง)
                  </span>
                ) : (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={12} /> {pinValidation.error}
                  </span>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsChangingPin(false);
                  setPinError(null);
                }}
                className="px-3 py-1.5 bg-elevated hover:bg-hover text-secondary hover:text-primary rounded-lg text-xs font-medium transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isSubmittingPin || !oldPin || newPin.length < 6 || confirmNewPin.length < 6}
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-all"
              >
                {isSubmittingPin ? "กำลังบันทึก..." : "บันทึกรหัส PIN ใหม่"}
              </button>
            </div>
          </form>
        )}
      </SettingSection>

      {/* Active JWT Authentication Card */}
      <SettingSection title="Session & JWT Bearer Token">
        <SettingRow
          label="Active JWT Token (HS256)"
          description="โทเค็นยืนยันตัวตนสำหรับส่งแนบใน Authorization Header ของ REST API หรือ Tools ภายนอก"
          vertical
        >
          <div className="p-4 bg-base border border-default rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-primary flex items-center gap-1.5">
                <Sparkles size={14} className="text-amber-400" />
                Authorization: Bearer &lt;token&gt;
              </span>
              <button
                onClick={handleCopyToken}
                className="flex items-center gap-1 text-xs text-secondary hover:text-primary px-2.5 py-1 bg-elevated hover:bg-hover rounded-lg border border-default transition-all"
              >
                {tokenCopied ? (
                  <>
                    <Check size={13} className="text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy Bearer Token</span>
                  </>
                )}
              </button>
            </div>

            <div className="p-3 bg-black/40 rounded-lg font-mono text-[11px] text-amber-300/90 break-all select-all border border-default/50 max-h-24 overflow-y-auto">
              Bearer {token}
            </div>

            {claims && (
              <div className="pt-2 border-t border-default/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] text-secondary">
                <div>
                  <span className="text-muted block">Issuer:</span>
                  <span className="text-primary font-medium">{claims.iss || "tabularis"}</span>
                </div>
                <div>
                  <span className="text-muted block">Subject:</span>
                  <span className="text-primary font-medium">{claims.sub || user.id}</span>
                </div>
                <div>
                  <span className="text-muted block">Algorithm:</span>
                  <span className="text-primary font-medium">HS256 (HMAC)</span>
                </div>
                <div>
                  <span className="text-muted block">Expires At:</span>
                  <span className="text-emerald-400 font-medium">
                    {claims.exp ? new Date(claims.exp * 1000).toLocaleTimeString() : "24 hours"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label="เข้าสู่ระบบด้วยบัญชีอื่น"
          description="เปิดหน้าต่าง PIN Authentication เพื่อสลับบัญชีหรือออก Token ชุดใหม่"
        >
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-pin-auth"))}
            className="px-3 py-1.5 bg-elevated hover:bg-hover border border-default text-primary rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <KeyRound size={13} />
            เปิดหน้าต่าง PIN Auth
          </button>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
