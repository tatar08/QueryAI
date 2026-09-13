import { webMode } from "../../utils/webSession";
import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  ShieldCheck,
  KeyRound,
  Lock,
  User,
  Mail,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  LogOut,
  Sparkles,
  Delete,
  Eye,
  EyeOff,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { validatePin } from "../../tauri-web-shim/core";

export interface PinAuthUser {
  id: string;
  username: string;
  recovery_email?: string | null;
}

export interface PinAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (user: PinAuthUser, token: string) => void;
}

type AuthMode = "login" | "register";

export const PinAuthModal: React.FC<PinAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const [showPinDigits, setShowPinDigits] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Authenticated state
  const [currentUser, setCurrentUser] = useState<PinAuthUser | null>(null);
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Fetch current user status on mount / open
  useEffect(() => {
    if (!isOpen) return;
    checkCurrentAuth();
  }, [isOpen]);

  const checkCurrentAuth = async () => {
    try {
      const res = await invoke<{
        authenticated: boolean;
        token: string | null;
        user: PinAuthUser | null;
      }>("pin_get_current_user");

      if (res?.authenticated && res.user) {
        setCurrentUser(res.user);
        setJwtToken(res.token);
      } else if (!webMode) {
        // Also check localStorage
        const storedToken = localStorage.getItem("tabularis_jwt_token");
        if (storedToken) {
          setJwtToken(storedToken);
        }
      }
    } catch {
      // Ignored if unauthenticated
    }
  };

  const handleDigitPress = (digit: string) => {
    if (isConfirming) {
      if (confirmPin.length < 8) {
        setConfirmPin((prev) => prev + digit);
        setError(null);
      }
    } else {
      if (pin.length < 8) {
        setPin((prev) => prev + digit);
        setError(null);
      }
    }
  };

  const handleBackspace = () => {
    if (isConfirming) {
      setConfirmPin((prev) => prev.slice(0, -1));
    } else {
      setPin((prev) => prev.slice(0, -1));
    }
    setError(null);
  };

  const handleClear = () => {
    if (isConfirming) {
      setConfirmPin("");
    } else {
      setPin("");
    }
    setError(null);
  };

  // Keyboard handler for numpad / digits
  useEffect(() => {
    if (!isOpen || currentUser) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if active element is a text input for username or email
      const activeEl = document.activeElement;
      if (
        activeEl?.tagName === "INPUT" &&
        (activeEl.getAttribute("type") === "text" ||
          activeEl.getAttribute("type") === "email")
      ) {
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigitPress(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isConfirming, pin, confirmPin, currentUser]);

  // Real-time validation for current PIN
  const activePin = isConfirming ? confirmPin : pin;
  const pinValidation = validatePin(pin);

  const handleSubmit = async () => {
    setError(null);
    setSuccessMessage(null);

    if (!username.trim()) {
      setError("กรุณากรอก Username ให้ถูกต้อง");
      return;
    }

    if (mode === "register" && !isConfirming) {
      if (!pinValidation.valid) {
        setError(pinValidation.error || "PIN ไม่ถูกต้อง");
        return;
      }
      // Move to confirm PIN step
      setIsConfirming(true);
      return;
    }

    if (mode === "register" && isConfirming) {
      if (pin !== confirmPin) {
        setError("PIN ยืนยันไม่ตรงกับ PIN ครั้งแรก");
        return;
      }
    }

    if (mode === "login") {
      if (pin.length < 6) {
        setError("กรุณากรอก PIN 6–8 ตัวเลข");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (mode === "register") {
        const res = await invoke<{
          token: string;
          token_type: string;
          expires_at: number;
          user: PinAuthUser;
        }>("pin_register", {
          username: username.trim(),
          pin,
          recovery_email: recoveryEmail.trim() || undefined,
        });

        setCurrentUser(res.user);
        setJwtToken(res.token);
        setSuccessMessage("ลงทะเบียนสำเร็จ! บันทึกข้อมูลลงตาราง users ใน Database (tabularis) เรียบร้อยแล้ว");
        onSuccess?.(res.user, res.token);
      } else {
        const res = await invoke<{
          token: string;
          token_type: string;
          expires_at: number;
          user: PinAuthUser;
        }>("pin_login", {
          username: username.trim(),
          pin,
        });

        setCurrentUser(res.user);
        setJwtToken(res.token);
        setSuccessMessage("เข้าสู่ระบบด้วย PIN สำเร็จ!");
        onSuccess?.(res.user, res.token);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      if (mode === "register" && isConfirming) {
        // Reset confirm if needed
        setIsConfirming(false);
        setConfirmPin("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await invoke("pin_logout");
    } catch (cause: unknown) {
      setError(String(cause));
      return;
    }
    setCurrentUser(null);
    setJwtToken(null);
    setPin("");
    setConfirmPin("");
    setIsConfirming(false);
    setSuccessMessage("ออกจากระบบเรียบร้อยแล้ว");
  };

  const handleCopyToken = () => {
    if (!jwtToken) return;
    navigator.clipboard.writeText(`Bearer ${jwtToken}`);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const parseJwtClaims = (token: string) => {
    try {
      const payloadB64 = token.split(".")[1];
      const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = atob(normalized);
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  };

  if (!isOpen) return null;

  const claims = jwtToken ? parseJwtClaims(jwtToken) : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm animate-fade-in p-4">
      <div className="bg-elevated border border-strong rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[92vh] overflow-hidden flex flex-col transition-all">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-amber-500/20 to-orange-500/20 text-amber-400 rounded-xl border border-amber-500/30">
              <KeyRound size={20} className="animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-primary flex items-center gap-2">
                Web PIN & JWT Auth
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  HS256
                </span>
              </h2>
              <p className="text-xs text-secondary">
                เข้าสู่ระบบ / ลงทะเบียนด้วย PIN 6–8 หลัก พร้อมรับ JWT Token
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-secondary hover:text-primary hover:bg-hover rounded-lg transition-colors"
            title={t("common.close", { defaultValue: "Close" })}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(92vh-130px)]">
          {currentUser && jwtToken ? (
            /* Authenticated View with JWT Inspection */
            <div className="space-y-4 animate-fade-in">
              <div className="p-4 bg-emerald-950/30 border border-emerald-800/50 rounded-xl text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-2 border border-emerald-500/30">
                  <ShieldCheck size={26} />
                </div>
                <h3 className="text-sm font-semibold text-emerald-300">
                  ยินดีต้อนรับ, {currentUser.username}!
                </h3>
                <p className="text-xs text-secondary mt-1">
                  User ID: <code className="text-emerald-400/90">{currentUser.id}</code>
                </p>
              </div>

              {/* JWT Bearer Card */}
              <div className="p-3.5 bg-base border border-default rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-primary flex items-center gap-1.5">
                    <Sparkles size={14} className="text-amber-400" />
                    Authorization Bearer JWT
                  </span>
                  <button
                    onClick={handleCopyToken}
                    data-testid="copy-token-btn"
                    className="flex items-center gap-1 text-xs text-secondary hover:text-primary px-2 py-1 bg-elevated hover:bg-hover rounded border border-default transition-all"
                  >
                    {tokenCopied ? (
                      <>
                        <Check size={13} className="text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} />
                        <span>Copy Bearer</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="p-2.5 bg-black/40 rounded-lg font-mono text-[11px] text-amber-300/90 break-all select-all border border-default/50 max-h-20 overflow-y-auto">
                  Bearer {jwtToken}
                </div>

                {claims && (
                  <div className="pt-2 border-t border-default/60 grid grid-cols-2 gap-2 text-[11px] text-secondary">
                    <div>
                      <span className="text-muted">Issuer:</span> {claims.iss || "tabularis"}
                    </div>
                    <div>
                      <span className="text-muted">Username:</span> {claims.username}
                    </div>
                    <div>
                      <span className="text-muted">Expires:</span>{" "}
                      {new Date(claims.exp * 1000).toLocaleTimeString()}
                    </div>
                    <div>
                      <span className="text-muted">Algorithm:</span> HS256 (HMAC-SHA256)
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleLogout}
                  data-testid="pin-logout-btn"
                  className="flex-1 py-2 px-3 bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800/40 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                >
                  <LogOut size={14} />
                  ออกจากระบบ (Logout)
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium transition-colors"
                >
                  ใช้งานแอปพลิเคชันต่อ
                </button>
              </div>
            </div>
          ) : (
            /* Unauthenticated View: Form + Dialpad */
            <div className="space-y-4">
              {/* Mode Toggle Tabs */}
              <div className="grid grid-cols-2 p-1 bg-base border border-default rounded-xl text-xs font-medium">
                <button
                  type="button"
                  data-testid="tab-login"
                  onClick={() => {
                    setMode("login");
                    setIsConfirming(false);
                    setError(null);
                  }}
                  className={`py-1.5 rounded-lg transition-all ${
                    mode === "login"
                      ? "bg-elevated text-primary shadow-sm font-semibold"
                      : "text-secondary hover:text-primary"
                  }`}
                >
                  เข้าสู่ระบบ (Sign In)
                </button>
                <button
                  type="button"
                  data-testid="tab-register"
                  onClick={() => {
                    setMode("register");
                    setIsConfirming(false);
                    setError(null);
                  }}
                  className={`py-1.5 rounded-lg transition-all ${
                    mode === "register"
                      ? "bg-elevated text-primary shadow-sm font-semibold"
                      : "text-secondary hover:text-primary"
                  }`}
                >
                  ลงทะเบียน PIN ใหม่ (Register)
                </button>
              </div>

              {/* Status or Error Banner */}
              {error && (
                <div className="p-2.5 bg-red-950/40 border border-red-800/50 rounded-xl text-red-300 text-xs flex items-start gap-2 animate-shake">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
                  <span>{error}</span>
                </div>
              )}
              {successMessage && (
                <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
                  <span>{successMessage}</span>
                </div>
              )}

              {/* Username Input */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-secondary flex items-center gap-1.5">
                  <User size={13} />
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="เช่น admin หรือ tar"
                  disabled={isConfirming || isSubmitting}
                  className="w-full px-3 py-2 bg-base border border-default rounded-xl text-xs text-primary placeholder:text-muted focus:outline-none focus:border-amber-500/70 transition-all disabled:opacity-50"
                />
              </div>

              {/* Optional Recovery Email for Register */}
              {mode === "register" && !isConfirming && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-secondary flex items-center gap-1.5">
                    <Mail size={13} />
                    Recovery Email (ไม่บังคับ)
                  </label>
                  <input
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="user@example.com"
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 bg-base border border-default rounded-xl text-xs text-primary placeholder:text-muted focus:outline-none focus:border-amber-500/70 transition-all"
                  />
                </div>
              )}

              {/* PIN Dot Indicators Display */}
              <div className="p-3.5 bg-base border border-default rounded-xl flex flex-col items-center space-y-2">
                <div className="flex items-center justify-between w-full text-[11px] text-secondary">
                  <span className="flex items-center gap-1 font-medium text-amber-300">
                    <Lock size={12} />
                    {isConfirming
                      ? "กรุณากดรหัส PIN ตัวเดิมซ้ำอีกครั้ง (Confirm PIN)"
                      : mode === "register"
                      ? "กำหนด PIN (6–8 ตัวเลข)"
                      : "กรอกรหัส PIN (6–8 ตัวเลข)"}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted">{activePin.length}/8 หลัก</span>
                    <button
                      type="button"
                      onClick={() => setShowPinDigits(!showPinDigits)}
                      className="text-muted hover:text-primary transition-colors"
                      title={showPinDigits ? "Hide PIN" : "Show PIN"}
                    >
                      {showPinDigits ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>

                {/* PIN Dots (up to 8 slots) */}
                <div className="flex items-center justify-center gap-2.5 py-1">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
                    const isFilled = index < activePin.length;
                    const isMinRequired = index < 6;
                    const char = activePin[index];

                    return (
                      <div
                        key={index}
                        className={`w-7 h-9 rounded-lg flex items-center justify-center font-mono text-sm font-bold transition-all ${
                          isFilled
                            ? "border-amber-500 bg-amber-500/20 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)] border"
                            : isMinRequired
                            ? "border-default bg-elevated/80 border text-muted"
                            : "border-dashed border-default/60 bg-transparent text-muted/40 border"
                        }`}
                      >
                        {isFilled ? (
                          showPinDigits ? (
                            char
                          ) : (
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 block" />
                          )
                        ) : (
                          <span className="text-[9px]">{index + 1}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Validation Note in Register mode */}
                {mode === "register" && !isConfirming && pin.length >= 2 && (
                  <div className="text-[11px] text-center w-full">
                    {pinValidation.valid ? (
                      <span className="text-emerald-400 flex items-center justify-center gap-1">
                        <CheckCircle2 size={12} /> PIN มีความปลอดภัย (6–8 หลัก ไม่ซ้ำ/ไม่เรียง)
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center justify-center gap-1">
                        <AlertTriangle size={12} /> {pinValidation.error}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* 3x4 Dial Pad */}
              <div className={`grid grid-cols-3 gap-2 pt-1 transition-all rounded-2xl p-1.5 ${isConfirming && confirmPin.length === 0 ? "ring-2 ring-amber-500/40 bg-amber-500/5" : ""}`}>
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleDigitPress(num)}
                    disabled={isSubmitting || activePin.length >= 8}
                    className="py-3 rounded-xl bg-base hover:bg-hover active:scale-95 border border-default text-primary font-semibold text-base transition-all disabled:opacity-40"
                  >
                    {num}
                  </button>
                ))}

                <button
                  type="button"
                  data-testid="pin-clear-btn"
                  onClick={handleClear}
                  disabled={isSubmitting || activePin.length === 0}
                  className="py-3 rounded-xl bg-base hover:bg-hover active:scale-95 border border-default text-secondary hover:text-red-400 text-xs font-medium transition-all disabled:opacity-40"
                >
                  Clear
                </button>

                <button
                  type="button"
                  onClick={() => handleDigitPress("0")}
                  disabled={isSubmitting || activePin.length >= 8}
                  className="py-3 rounded-xl bg-base hover:bg-hover active:scale-95 border border-default text-primary font-semibold text-base transition-all disabled:opacity-40"
                >
                  0
                </button>

                <button
                  type="button"
                  data-testid="pin-backspace-btn"
                  onClick={handleBackspace}
                  disabled={isSubmitting || activePin.length === 0}
                  className="py-3 rounded-xl bg-base hover:bg-hover active:scale-95 border border-default text-secondary hover:text-primary flex items-center justify-center transition-all disabled:opacity-40"
                  title="Backspace"
                >
                  <Delete size={18} />
                </button>
              </div>

              {/* Action Button */}
              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  data-testid="pin-submit-btn"
                  onClick={handleSubmit}
                  disabled={
                    isSubmitting ||
                    !username.trim() ||
                    (isConfirming ? confirmPin.length < 6 : pin.length < 6)
                  }
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-orange-950/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      กำลังประมวลผล...
                    </>
                  ) : isConfirming ? (
                    confirmPin.length < 6 ? (
                      `👉 กด PIN ให้ตรงกับรอบแรก (${confirmPin.length}/6 หลัก)`
                    ) : (
                      "ยืนยันการลงทะเบียน (Confirm Register)"
                    )
                  ) : mode === "register" ? (
                    pin.length < 6 ? (
                      `กด PIN ให้ครบ (${pin.length}/6 หลัก)`
                    ) : (
                      "ถัดไป: ยืนยัน PIN (Next: Confirm)"
                    )
                  ) : (
                    "เข้าสู่ระบบ (Sign In)"
                  )}
                </button>

                {isConfirming && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsConfirming(false);
                      setConfirmPin("");
                    }}
                    className="w-full py-1 text-xs text-muted hover:text-primary transition-colors text-center"
                  >
                    ← ย้อนกลับไปแก้ไข PIN
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
