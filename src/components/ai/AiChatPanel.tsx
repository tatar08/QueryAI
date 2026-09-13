import { useState, useEffect, useRef, useCallback } from "react";
import Markdown from "react-markdown";
import {
  Sparkles,
  X,
  Plus,
  Send,
  Copy,
  Check,
  Play,
  ArrowDownToLine,
  Paperclip,
  Bot,
  User,
  Trash2,
  Loader2,
  ChevronDown,
  Database,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../../hooks/useDatabase";
import { useSettings } from "../../hooks/useSettings";
import { copyTextToClipboard } from "../../utils/clipboard";
import clsx from "clsx";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
}

interface AiChatPanelProps {
  onClose: () => void;
  onInsertSql?: (sql: string) => void;
  onRunSql?: (sql: string) => void;
  activeQuery?: string;
  connectionId?: string | null;
  schema?: string | null;
  activeDatabaseName?: string | null;
}

const STORAGE_KEY_CHATS = "tabularis_ai_chat_conversations";
const STORAGE_KEY_ACTIVE_CHAT = "tabularis_ai_chat_active_id";

function getLocalConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHATS);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore parse error
  }
  return [
    {
      id: "conv_default",
      title: "New conversation",
      messages: [],
      createdAt: Date.now(),
    },
  ];
}

function saveLocalConversations(convs: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY_CHATS, JSON.stringify(convs));
  } catch {
    // Ignore write error
  }
}

export const AiChatPanel = ({
  onClose,
  onInsertSql,
  onRunSql,
  activeQuery,
  connectionId,
  schema,
  activeDatabaseName,
}: AiChatPanelProps) => {
  const { connections, activeConnectionId, activeSchema } = useDatabase();
  const { settings } = useSettings();

  const resolvedConnId = connectionId ?? activeConnectionId;
  const resolvedSchema = schema ?? activeSchema ?? activeDatabaseName ?? "";
  const activeConn = connections.find((c) => c.id === resolvedConnId);

  const [conversations, setConversations] = useState<Conversation[]>(
    getLocalConversations,
  );
  const [activeConvId, setActiveConvId] = useState<string>(() => {
    return (
      localStorage.getItem(STORAGE_KEY_ACTIVE_CHAT) ||
      conversations[0]?.id ||
      "conv_default"
    );
  });

  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [attachContext, setAttachContext] = useState(true);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [schemaContext, setSchemaContext] = useState<string>("");
  const [isFetchingSchema, setIsFetchingSchema] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const currentConv =
    conversations.find((c) => c.id === activeConvId) || conversations[0];

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentConv?.messages, isLoading]);

  // Sync active chat ID to storage
  useEffect(() => {
    if (activeConvId) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_CHAT, activeConvId);
    }
  }, [activeConvId]);

  // Load database schema context if attached
  useEffect(() => {
    if (!resolvedConnId || !attachContext) {
      setSchemaContext("");
      return;
    }

    let isMounted = true;
    setIsFetchingSchema(true);

    invoke<string>("get_ai_schema_context", {
      connectionId: resolvedConnId,
      ...(resolvedSchema ? { schema: resolvedSchema } : {}),
    })
      .then((ctx) => {
        if (isMounted) {
          setSchemaContext(ctx || "");
        }
      })
      .catch((err) => {
        console.warn("Failed to load schema context for AI chat:", err);
      })
      .finally(() => {
        if (isMounted) {
          setIsFetchingSchema(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [resolvedConnId, resolvedSchema, attachContext]);

  // Save conversations whenever updated
  const updateCurrentMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setConversations((prev) => {
        const next = prev.map((conv) => {
          if (conv.id === (currentConv?.id ?? activeConvId)) {
            const newMessages = updater(conv.messages);
            let newTitle = conv.title;
            if (conv.title === "New conversation" && newMessages.length > 0) {
              const firstUserMsg = newMessages.find((m) => m.role === "user");
              if (firstUserMsg) {
                newTitle =
                  firstUserMsg.content.slice(0, 30) +
                  (firstUserMsg.content.length > 30 ? "..." : "");
              }
            }
            return { ...conv, title: newTitle, messages: newMessages };
          }
          return conv;
        });
        saveLocalConversations(next);
        return next;
      });
    },
    [activeConvId, currentConv?.id],
  );

  const handleNewConversation = () => {
    const newId = `conv_${Date.now()}`;
    const newConv: Conversation = {
      id: newId,
      title: "New conversation",
      messages: [],
      createdAt: Date.now(),
    };
    const updated = [newConv, ...conversations];
    setConversations(updated);
    setActiveConvId(newId);
    saveLocalConversations(updated);
  };

  const handleClearCurrentChat = () => {
    updateCurrentMessages(() => []);
  };

  const handleCopyCode = async (code: string, id: string) => {
    await copyTextToClipboard(code);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const promptToSend = (customPrompt ?? inputPrompt).trim();
    if (!promptToSend || isLoading) return;

    setInputPrompt("");

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: "user",
      content: promptToSend,
      timestamp: Date.now(),
    };

    const nextHistory = [...(currentConv?.messages || []), userMessage];
    updateCurrentMessages(() => nextHistory);
    setIsLoading(true);

    try {
      // Build schema & active query contextual additions
      let fullSchemaText = schemaContext;
      if (attachContext && activeQuery && activeQuery.trim()) {
        fullSchemaText += `\n\nCurrent Query in Editor:\n\`\`\`sql\n${activeQuery.trim()}\n\`\`\``;
      }

      const response = await invoke<string>("chat_ai", {
        req: {
          provider: settings.aiProvider || "ollama",
          model: settings.aiModel || "",
          messages: nextHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          schema: fullSchemaText ? fullSchemaText : undefined,
        },
      });

      const assistantMessage: ChatMessage = {
        id: `msg_${Date.now()}_ai`,
        role: "assistant",
        content: response,
        timestamp: Date.now(),
      };

      updateCurrentMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const errorMessage: ChatMessage = {
        id: `msg_${Date.now()}_err`,
        role: "assistant",
        content: `⚠️ Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      updateCurrentMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  // Estimate approximate tokens from messages
  const estimatedTokens = (currentConv?.messages || []).reduce(
    (acc, m) => acc + Math.ceil(m.content.length / 3.8),
    0,
  );

  return (
    <div className="flex flex-col h-full bg-elevated border-l border-default text-primary select-text w-full">
      {/* 1. Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-default bg-surface-secondary/40 shrink-0">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Sparkles size={16} className="text-yellow-400" />
          <span>AI Chat</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-muted hover:text-primary hover:bg-surface-secondary rounded transition-colors"
          title="Close AI Chat"
        >
          <X size={15} />
        </button>
      </div>

      {/* 2. Connection Selector Bar */}
      <div className="px-3 py-1.5 border-b border-default/60 flex items-center justify-between text-xs bg-base/50 shrink-0">
        <div className="flex items-center gap-1.5 truncate text-secondary">
          <Database size={13} className="text-blue-400 shrink-0" />
          <span className="font-medium text-primary truncate">
            {activeConn?.name || "No Connection"}
          </span>
          {resolvedSchema && (
            <span className="text-muted truncate">({resolvedSchema})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span
            className={clsx(
              "w-2 h-2 rounded-full",
              activeConn ? "bg-green-500" : "bg-muted",
            )}
            title={activeConn ? "Connected" : "Disconnected"}
          />
        </div>
      </div>

      {/* 3. Conversation Selector & Action Bar */}
      <div className="px-3 py-1.5 border-b border-default/60 flex items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex-1 relative min-w-0">
          <select
            value={currentConv?.id}
            onChange={(e) => setActiveConvId(e.target.value)}
            className="w-full bg-surface-secondary/70 border border-default rounded px-2 py-1 text-xs text-primary appearance-none cursor-pointer pr-6 truncate focus:outline-none focus:border-blue-500"
          >
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
        </div>
        <button
          onClick={handleNewConversation}
          className="p-1.5 rounded hover:bg-surface-secondary text-muted hover:text-primary border border-default transition-colors shrink-0"
          title="New conversation"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* 4. Tokens & Reset Sub-bar */}
      <div className="px-3 py-1 border-b border-default/40 flex items-center justify-between text-[11px] text-muted shrink-0">
        <div className="flex items-center gap-1">
          <span>{estimatedTokens}t tokens</span>
          {isFetchingSchema && (
            <span className="text-blue-400 flex items-center gap-1 ml-1">
              <Loader2 size={10} className="animate-spin" /> schema loading...
            </span>
          )}
        </div>
        <button
          onClick={handleClearCurrentChat}
          disabled={!currentConv?.messages.length}
          className="p-0.5 hover:text-red-400 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          title="Clear conversation"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* 5. Messages Container */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs leading-relaxed">
        {(!currentConv?.messages || currentConv.messages.length === 0) && (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-muted">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-3">
              <Sparkles size={20} />
            </div>
            <p className="text-sm font-medium text-primary mb-1">
              Tabularis AI Chat
            </p>
            <p className="text-xs text-muted mb-4 max-w-[260px]">
              Ask anything about your database, generate SQL queries, or request
              optimizations.
            </p>

            <div className="w-full space-y-1.5 text-left">
              <button
                onClick={() =>
                  void handleSendMessage(
                    "Show all tables in this database with their row counts",
                  )
                }
                className="w-full text-xs p-2 rounded-lg bg-surface-secondary/60 hover:bg-surface-secondary border border-default text-secondary hover:text-primary transition-colors text-left"
              >
                📊 List all tables with row counts
              </button>
              <button
                onClick={() =>
                  void handleSendMessage(
                    activeQuery && activeQuery.trim()
                      ? `How can I optimize this query:\n\`\`\`sql\n${activeQuery.trim()}\n\`\`\``
                      : "How to optimize slow queries and create proper indexes?",
                  )
                }
                className="w-full text-xs p-2 rounded-lg bg-surface-secondary/60 hover:bg-surface-secondary border border-default text-secondary hover:text-primary transition-colors text-left"
              >
                ⚡ Optimize current query
              </button>
              <button
                onClick={() =>
                  void handleSendMessage(
                    "Find the top 10 most recent records from the main table",
                  )
                }
                className="w-full text-xs p-2 rounded-lg bg-surface-secondary/60 hover:bg-surface-secondary border border-default text-secondary hover:text-primary transition-colors text-left"
              >
                🔍 Query recent records
              </button>
            </div>
          </div>
        )}

        {currentConv?.messages.map((msg) => (
          <div
            key={msg.id}
            className={clsx(
              "flex gap-2.5",
              msg.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            {msg.role !== "user" && (
              <div className="w-6 h-6 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={14} />
              </div>
            )}

            <div
              className={clsx(
                "max-w-[88%] rounded-xl px-3 py-2.5 break-words",
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-tr-none shadow-sm"
                  : "bg-surface-secondary border border-default/70 text-primary rounded-tl-none",
              )}
            >
              {msg.role === "user" ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div
                  className={
                    "prose prose-invert max-w-none text-xs " +
                    "[&_p]:mb-2 [&_p:last-child]:mb-0 [&_p]:leading-relaxed " +
                    "[&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-2 " +
                    "[&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-2 " +
                    "[&_li]:mb-0.5 " +
                    "[&_strong]:font-semibold [&_strong]:text-primary " +
                    "[&_code]:bg-base/70 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_code]:font-mono"
                  }
                >
                  <Markdown
                    components={{
                      code({ className, children }) {
                        const match = /language-(\w+)/.exec(className || "");
                        const isInline = !match && !String(children).includes("\n");
                        const codeString = String(children).replace(/\n$/, "");

                        if (isInline) {
                          return (
                            <code className="bg-base/80 px-1 py-0.5 rounded font-mono text-[11px] text-blue-300">
                              {children}
                            </code>
                          );
                        }

                        const codeId = `${msg.id}_${codeString.slice(0, 16)}`;
                        const isCopied = copiedCodeId === codeId;
                        const isSql = !match || match[1] === "sql";

                        return (
                          <div className="my-2 rounded-lg border border-default bg-base overflow-hidden font-mono text-xs">
                            {/* Code header bar */}
                            <div className="flex items-center justify-between px-2.5 py-1 bg-surface-secondary/70 border-b border-default text-[11px] text-muted">
                              <span className="font-sans uppercase font-semibold text-secondary text-[10px]">
                                {match ? match[1] : "sql"}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => void handleCopyCode(codeString, codeId)}
                                  className="flex items-center gap-1 px-1.5 py-0.5 hover:text-primary hover:bg-surface-secondary rounded transition-colors"
                                  title="Copy Code"
                                >
                                  {isCopied ? (
                                    <Check size={11} className="text-green-400" />
                                  ) : (
                                    <Copy size={11} />
                                  )}
                                  <span>{isCopied ? "Copied" : "Copy"}</span>
                                </button>

                                {isSql && onInsertSql && (
                                  <button
                                    onClick={() => onInsertSql(codeString)}
                                    className="flex items-center gap-1 px-1.5 py-0.5 hover:text-blue-300 hover:bg-blue-900/30 rounded text-blue-400 transition-colors"
                                    title="Insert SQL into active editor tab"
                                  >
                                    <ArrowDownToLine size={11} />
                                    <span>Insert</span>
                                  </button>
                                )}

                                {isSql && onRunSql && (
                                  <button
                                    onClick={() => onRunSql(codeString)}
                                    className="flex items-center gap-1 px-1.5 py-0.5 hover:text-green-300 hover:bg-green-900/30 rounded text-green-400 font-medium transition-colors"
                                    title="Run SQL directly"
                                  >
                                    <Play size={11} />
                                    <span>Run</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Code Body */}
                            <pre className="p-2.5 overflow-x-auto text-[11px] leading-relaxed text-blue-200 bg-base/90">
                              <code>{children}</code>
                            </pre>
                          </div>
                        );
                      },
                    }}
                  >
                    {msg.content}
                  </Markdown>
                </div>
              )}
            </div>

            {msg.role === "user" && (
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <User size={14} />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2.5 justify-start">
            <div className="w-6 h-6 rounded-full bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
              <Bot size={14} />
            </div>
            <div className="bg-surface-secondary border border-default/70 rounded-xl rounded-tl-none px-3 py-2 text-muted flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-blue-400" />
              <span>Generating response...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 6. Context Attachment Badge (if enabled) */}
      {attachContext && (
        <div className="px-3 py-1 bg-surface-secondary/50 border-t border-default/50 text-[11px] text-muted flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1 text-blue-400 truncate">
            <Paperclip size={11} />
            Attached: Schema ({resolvedSchema || "default"})
            {activeQuery ? " + Editor Query" : ""}
          </span>
          <button
            onClick={() => setAttachContext(false)}
            className="text-muted hover:text-primary ml-1"
            title="Remove attachment"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* 7. Bottom Input Box */}
      <div className="p-2.5 border-t border-default bg-base/80 shrink-0">
        <div className="flex items-end gap-1.5 bg-surface-secondary border border-default rounded-xl p-1.5 focus-within:border-blue-500 transition-colors">
          <button
            type="button"
            onClick={() => setAttachContext((prev) => !prev)}
            className={clsx(
              "p-1.5 rounded-lg transition-colors shrink-0",
              attachContext
                ? "text-blue-400 bg-blue-500/10"
                : "text-muted hover:text-primary hover:bg-surface-secondary",
            )}
            title={
              attachContext
                ? "Schema Context is attached"
                : "Attach Database Schema Context"
            }
          >
            <Paperclip size={15} />
          </button>

          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI or write prompt (Enter to send)..."
            rows={1}
            style={{ minHeight: "28px", maxHeight: "100px" }}
            className="flex-1 bg-transparent border-0 resize-none text-xs text-primary placeholder:text-muted focus:outline-none py-1 leading-normal"
          />

          <button
            type="button"
            disabled={!inputPrompt.trim() || isLoading}
            onClick={() => void handleSendMessage()}
            className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-30 disabled:pointer-events-none transition-colors shrink-0"
            title="Send (Enter)"
          >
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>

        {/* 8. Footer Status Bar */}
        <div className="mt-1.5 px-1 flex items-center justify-between text-[10px] text-muted">
          <span>GMT+07:00</span>
          <div className="flex items-center gap-2">
            <span>en</span>
            <span>•</span>
            <span className="text-secondary truncate max-w-[150px]">
              {settings.aiProvider || "ollama"}
              {settings.aiModel ? ` (${settings.aiModel})` : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
