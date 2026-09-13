import { useState } from "react";
import {
  X,
  Palette,
  Layers,
  Sparkles,
  Code2,
  ExternalLink,
  Check,
  Copy,
  Database,
  Terminal,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Card, CardHeader, CardBody, CardFooter } from "../ui/Card";

export interface DesignSystemModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = "tokens" | "components" | "icons" | "contribute";

export function DesignSystemModal({ isOpen, onClose }: DesignSystemModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("tokens");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [btnLoading, setBtnLoading] = useState(false);

  if (!isOpen) return null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(text);
    setTimeout(() => setCopiedToken(null), 1800);
  };

  const tokens = [
    { name: "bg-base", hex: "#0f172a", label: "Base Background", desc: "Root canvas and backdrop" },
    { name: "bg-elevated", hex: "#1e293b", label: "Elevated Surface", desc: "Modals, sidebars, cards" },
    { name: "bg-subsurface", hex: "#334155", label: "Subsurface / Hover", desc: "Interactive hover, active inputs" },
    { name: "border-default", hex: "rgba(255,255,255,0.08)", label: "Border Default", desc: "Inner dividers and panels" },
    { name: "border-strong", hex: "rgba(255,255,255,0.16)", label: "Border Strong", desc: "Modal frames & active inputs" },
    { name: "text-primary", hex: "#f8fafc", label: "Text Primary", desc: "Headings & main data" },
    { name: "text-secondary", hex: "#94a3b8", label: "Text Secondary", desc: "Subtitles & descriptive text" },
    { name: "text-muted", hex: "#64748b", label: "Text Muted", desc: "Placeholders & timestamps" },
    { name: "blue-500", hex: "#3b82f6", label: "Accent Blue", desc: "Primary actions & selection" },
    { name: "emerald-500", hex: "#10b981", label: "Success Emerald", desc: "Connected & passed states" },
    { name: "amber-500", hex: "#f59e0b", label: "Warning Amber", desc: "Alerts & caution states" },
    { name: "rose-500", hex: "#ef4444", label: "Danger Rose", desc: "Errors & destructive actions" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[750px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-900/30 rounded-lg border border-purple-500/20">
              <Palette size={20} className="text-purple-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-primary">Tabularis UI Design System</h2>
                <Badge variant="purple" size="sm">#195</Badge>
              </div>
              <p className="text-xs text-secondary">Visual identity, token scale & call for contributors</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors p-1.5 rounded-lg hover:bg-subsurface"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center px-4 pt-2 border-b border-default bg-base/30 gap-2">
          {[
            { key: "tokens" as const, label: "Tokens & Palette", icon: Palette },
            { key: "components" as const, label: "Component Primitives", icon: Layers },
            { key: "icons" as const, label: "Iconography & Assets", icon: Sparkles },
            { key: "contribute" as const, label: "Call for Contributors", icon: Code2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
                  active
                    ? "border-blue-500 text-blue-400 bg-blue-500/5 rounded-t-md"
                    : "border-transparent text-secondary hover:text-primary hover:bg-subsurface/40 rounded-t-md"
                }`}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {activeTab === "tokens" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-primary">Core Design Tokens</h3>
                  <p className="text-xs text-secondary">Click any token to copy its utility class to clipboard.</p>
                </div>
                {copiedToken && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check size={14} /> Copied {copiedToken}!
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {tokens.map((tok) => (
                  <div
                    key={tok.name}
                    onClick={() => copyToClipboard(tok.name)}
                    className="p-3 bg-base/50 border border-default hover:border-blue-500/40 rounded-lg cursor-pointer transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-7 h-7 rounded-md border border-white/10 shrink-0 shadow-inner"
                        style={{ backgroundColor: tok.hex }}
                      />
                      <div>
                        <div className="text-xs font-medium text-primary flex items-center gap-1.5">
                          <span>{tok.label}</span>
                          <span className="text-[10px] text-muted font-mono">({tok.name})</span>
                        </div>
                        <div className="text-[11px] text-secondary">{tok.desc}</div>
                      </div>
                    </div>
                    <Copy size={14} className="text-muted group-hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "components" && (
            <div className="space-y-6">
              {/* Buttons */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">Button Primitives</div>
                <div className="p-4 bg-base/40 border border-default rounded-xl space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" size="sm">Primary</Button>
                    <Button variant="secondary" size="sm">Secondary</Button>
                    <Button variant="outline" size="sm">Outline</Button>
                    <Button variant="ghost" size="sm">Ghost</Button>
                    <Button variant="danger" size="sm">Danger</Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={btnLoading}
                      onClick={() => {
                        setBtnLoading(true);
                        setTimeout(() => setBtnLoading(false), 1500);
                      }}
                    >
                      {btnLoading ? "Processing" : "Click for Loading"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Badges */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">Badge Primitives</div>
                <div className="p-4 bg-base/40 border border-default rounded-xl flex flex-wrap gap-2">
                  <Badge variant="default">Default</Badge>
                  <Badge variant="success" dot>Connected</Badge>
                  <Badge variant="warning" dot>Reconnecting</Badge>
                  <Badge variant="danger" dot>Disconnected</Badge>
                  <Badge variant="info">Read Only</Badge>
                  <Badge variant="purple">AI Assistant</Badge>
                </div>
              </div>

              {/* Cards */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">Card Primitive</div>
                <Card hover>
                  <CardHeader
                    icon={<Database size={16} className="text-blue-400" />}
                    title="Production PostgreSQL"
                    subtitle="db-prod-cluster-01.internal"
                    action={<Badge variant="success" size="sm" dot>Online</Badge>}
                  />
                  <CardBody className="text-xs text-secondary space-y-1">
                    <div>Engine: PostgreSQL 16.4 • Schemas: 6 • Tables: 48</div>
                    <div className="text-[11px] text-muted">Latency: 12ms • Active Queries: 3</div>
                  </CardBody>
                  <CardFooter>
                    <span>Last synced 2 minutes ago</span>
                    <Button variant="outline" size="sm">Explore</Button>
                  </CardFooter>
                </Card>
              </div>
            </div>
          )}

          {activeTab === "icons" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-primary">Driver & System Iconography</h3>
                <p className="text-xs text-secondary">Consistent 20x20 and 24x24 vector iconography with semantic status badges.</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { name: "PostgreSQL", category: "Relational", icon: Database, color: "text-sky-400" },
                  { name: "MySQL / MariaDB", category: "Relational", icon: Database, color: "text-amber-400" },
                  { name: "SQLite", category: "Embedded", icon: Database, color: "text-cyan-400" },
                  { name: "SQL Server", category: "Enterprise", icon: Database, color: "text-red-400" },
                  { name: "MongoDB", category: "Document Store", icon: Database, color: "text-emerald-400" },
                  { name: "CLI / Terminal", category: "Tooling", icon: Terminal, color: "text-slate-300" },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.name} className="p-3 bg-base/50 border border-default rounded-lg flex items-center gap-3">
                      <div className={`p-2 bg-slate-800 rounded-lg ${item.color}`}>
                        <Icon size={18} />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-primary">{item.name}</div>
                        <div className="text-[11px] text-secondary">{item.category}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "contribute" && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-950/30 border border-blue-800/40 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-blue-400 font-semibold text-sm">
                  <Sparkles size={16} />
                  <span>Join the Visual Identity Initiative (#195)</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  We are actively looking for contributors to help shape the next-generation Tabularis design system.
                  Whether you are a product designer, UI engineer, or theme enthusiast, your contributions are welcomed!
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">How to Contribute</div>
                <div className="space-y-2 text-xs text-secondary">
                  <div className="p-3 bg-base/40 border border-default rounded-lg flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0">1</span>
                    <div>
                      <strong className="text-primary">Review DESIGN_SYSTEM.md</strong>: Read through the specification in the repository root for full token definitions.
                    </div>
                  </div>
                  <div className="p-3 bg-base/40 border border-default rounded-lg flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0">2</span>
                    <div>
                      <strong className="text-primary">Pick an Area</strong>: Design new primitives (Sliders, Multi-selects, Tooltips), improve dark mode contrast, or submit custom themes.
                    </div>
                  </div>
                  <div className="p-3 bg-base/40 border border-default rounded-lg flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0">3</span>
                    <div>
                      <strong className="text-primary">Submit a PR</strong>: Reference issue <code className="text-blue-400 font-mono">#195</code> with screenshots or interactive component previews.
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <a
                  href="https://github.com/TabularisDB/tabularis/issues/195"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                >
                  <span>View GitHub Issue #195</span>
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex justify-between items-center">
          <span className="text-xs text-muted">Tabularis Design System v1.0 • Built with TailwindCSS & React</span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
