import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Sparkles } from "lucide-react";
import type { TFunction } from "i18next";

interface ErrorDisplayProps {
  error: string;
  t: TFunction;
  onFixWithAi?: () => void;
}

export function ErrorDisplay({ error, t, onFixWithAi }: ErrorDisplayProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const separatorIndex = error.indexOf("\n\n");
  const hasDetails = separatorIndex !== -1 && separatorIndex < error.length - 2;
  const brief = hasDetails ? error.slice(0, separatorIndex) : error;
  const details = hasDetails ? error.slice(separatorIndex + 2) : "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(error);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-4 text-red-400 font-mono text-sm bg-red-900/10 h-full overflow-auto select-text">
      <div className="flex items-start gap-3">
        <div className="whitespace-pre-wrap flex-1 min-w-0">Error: {brief}</div>
        <div className="flex items-center gap-2 shrink-0">
          {onFixWithAi && (
            <button
              type="button"
              onClick={onFixWithAi}
              className="inline-flex items-center gap-1.5 rounded border border-purple-500/40 bg-purple-950/50 hover:bg-purple-900/60 text-purple-300 hover:text-purple-100 px-2.5 py-1 text-xs font-medium transition-colors select-none shrink-0 cursor-pointer"
              title="ตรวจสอบสาเหตุข้อผิดพลาดและแนะนำคำสั่งแก้ไขด้วย AI"
            >
              <Sparkles size={13} className="text-purple-400" />
              <span>ตรวจสอบ/แก้ไขด้วย AI</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded border border-red-400/30 px-2 py-1 text-xs text-red-300/80 hover:bg-red-400/10 hover:text-red-200 transition-colors select-none shrink-0"
            title={t("common.copyError")}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
      </div>
      {hasDetails && (
        <>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="mt-2 flex items-center gap-1 text-xs text-red-300/70 hover:text-red-300 transition-colors cursor-pointer"
          >
            {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showDetails
              ? t("editor.hideErrorDetails")
              : t("editor.showErrorDetails")}
          </button>
          {showDetails && (
            <div className="mt-2 whitespace-pre-wrap text-red-400/60 border-t border-red-400/20 pt-2">
              {details}
            </div>
          )}
        </>
      )}
    </div>
  );
}
