import { useState, useEffect, useRef, useMemo } from "react";
import { X, Loader2, Zap, Sparkles, Check, Copy } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../hooks/useSettings";
import { useEditorTheme } from "../../hooks/useEditorTheme";
import { getAiExplanationLanguage } from "../../i18n/language";
import { Modal } from "../ui/Modal";
import MonacoEditor, { type BeforeMount } from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor";
import { loadMonacoTheme } from "../../themes/themeUtils";

interface AiImproveModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  onApplyImprovement?: (improvedSql: string) => void;
}

export const AiImproveModal = ({
  isOpen,
  onClose,
  query,
  onApplyImprovement,
}: AiImproveModalProps) => {
  const { settings } = useSettings();
  const editorTheme = useEditorTheme();
  const monacoRef = useRef<typeof MonacoTypes | null>(null);
  const [analysis, setAnalysis] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const improvedSql = useMemo(() => {
    if (!analysis) return null;
    const match = analysis.match(/```(?:sql)?([\s\S]*?)```/i);
    if (match && match[1]?.trim()) {
      return match[1].trim();
    }
    return null;
  }, [analysis]);

  // Update Monaco theme when theme changes
  useEffect(() => {
    if (monacoRef.current) {
      loadMonacoTheme(editorTheme, monacoRef.current);
    }
  }, [editorTheme]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    loadMonacoTheme(editorTheme, monaco);
  };

  useEffect(() => {
    if (isOpen && query) {
      handleImprove();
    }
    // eslint-disable-next-line
  }, [isOpen, query]);

  const handleImprove = async () => {
    if (!settings.aiProvider) {
      setError("Please configure AI provider in Settings.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setAnalysis("");
    setCopied(false);

    try {
      const result = await invoke<string>("improve_ai_query", {
        req: {
          provider: settings.aiProvider,
          model: settings.aiModel || "",
          query,
          language: getAiExplanationLanguage(settings.language),
        },
      });
      setAnalysis(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!improvedSql) return;
    navigator.clipboard.writeText(improvedSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="bg-elevated border border-strong rounded-xl w-[750px] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default">
          <div className="flex items-center gap-2 text-primary font-medium">
            <Zap size={18} className="text-emerald-400" />
            <span>AI Query Optimizer & Improvement (ปรับปรุงประสิทธิภาพ SQL)</span>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!settings.aiProvider && (
            <div className="bg-warning-bg border border-warning-border text-warning-text px-4 py-3 rounded text-sm">
              ⚠️ AI Provider not configured. Please go to Settings &gt; AI.
            </div>
          )}

          {/* Current Query */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Current SQL Query (คิวรีปัจจุบัน)
            </label>
            <div className="h-28 border border-default rounded-lg overflow-hidden">
              <MonacoEditor
                height="100%"
                language="sql"
                theme={editorTheme.id}
                value={query}
                beforeMount={handleBeforeMount}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  wordWrap: "on",
                }}
              />
            </div>
          </div>

          {/* Optimization Analysis */}
          <div>
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Optimization Analysis & Suggestions (การวิเคราะห์และข้อเสนอแนะ)
            </label>
            <div className="bg-base border border-strong rounded-lg p-4 min-h-[160px] text-secondary leading-relaxed whitespace-pre-wrap text-sm">
              {isLoading ? (
                <div className="flex items-center gap-2 text-muted">
                  <Loader2 size={16} className="animate-spin text-emerald-400" />
                  กำลังวิเคราะห์และหาแนวทางปรับปรุงประสิทธิภาพคิวรี (Analyzing & Optimizing query)...
                </div>
              ) : error ? (
                <div className="text-error-text">{error}</div>
              ) : (
                analysis
              )}
            </div>
          </div>

          {/* Suggested SQL Preview */}
          {improvedSql && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles size={13} />
                  Optimized SQL Preview (คิวรีที่ปรับปรุงแล้ว)
                </label>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs text-muted hover:text-primary transition-colors cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-green-400" />
                      <span className="text-green-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy SQL</span>
                    </>
                  )}
                </button>
              </div>
              <div className="h-28 border border-emerald-500/40 rounded-lg overflow-hidden bg-emerald-950/10">
                <MonacoEditor
                  height="100%"
                  language="sql"
                  theme={editorTheme.id}
                  value={improvedSql}
                  beforeMount={handleBeforeMount}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                    wordWrap: "on",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-default bg-elevated/50 rounded-b-xl">
          <div className="text-xs text-muted">
            {improvedSql && (
              <span className="text-emerald-400 flex items-center gap-1">
                <Sparkles size={12} />
                พร้อมนำไปใช้งาน
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {improvedSql && onApplyImprovement && (
              <button
                type="button"
                onClick={() => {
                  onApplyImprovement(improvedSql);
                  onClose();
                }}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-sm font-medium transition-all shadow-md shadow-emerald-900/30 flex items-center gap-1.5 cursor-pointer"
                title="นำคิวรีที่ปรับปรุงแล้วไปใส่ใน Editor และรันใหม่ทันที"
              >
                <Zap size={14} />
                <span>นำคิวรีที่ปรับปรุงแล้วไปใช้ (Apply Improved SQL)</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-surface-secondary hover:bg-surface-tertiary text-primary rounded-lg text-sm transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
