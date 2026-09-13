# Tabularis UI Design System & Visual Identity

Welcome to the **Tabularis Design System & Visual Identity** documentation. This guide defines the aesthetic principles, design tokens, component primitives, and guidelines for contributing to Tabularis's user interface.

> [!TIP]
> **Call for Contributors (Issue #195)**
> We are actively inviting designers and frontend developers to help refine our visual identity, expand component primitives, design database iconography, and craft rich dark/light themes. See the [Contributing to the Design System](#contributing-to-the-design-system) section below to get started!

---

## 🎨 Visual Identity & Principles

Tabularis is an open-source, multi-engine SQL workspace designed to feel **precise, ultra-responsive, and modern**:

1. **High Information Density with Visual Clarity**: Database architects and data engineers need high data density without clutter. We use crisp lines, consistent 1px borders, and clear hierarchical contrast.
2. **Elevated Dark Theme by Default**: Deep slate and dark neutral tones reduce eye strain during extended query sessions.
3. **Semantic Accent Colors**: Colors have consistent semantic meaning across all tabs and editors:
   - 🔵 **Primary Blue (`#3b82f6`)**: Active navigation, primary actions, running queries.
   - 🟢 **Success Emerald (`#10b981`)**: Connected status, successful executions, valid transactions.
   - 🟡 **Warning Amber (`#f59e0b`)**: Connection warnings, unsaved changes, destructive action alerts.
   - 🔴 **Danger Rose (`#ef4444`)**: Errors, query termination, drops and deletes.
   - 🟣 **Purple / Violet (`#8b5cf6`)**: AI assists, explain analysis, schema relationships.

---

## 🔲 Design Tokens

### 1. Color Palette

| Token Name | Tailwind Class | HEX / CSS Variable | Description |
| :--- | :--- | :--- | :--- |
| **Base** | `bg-base` | `#0f172a` (Slate 900) | Root application background |
| **Elevated** | `bg-elevated` | `#1e293b` (Slate 800) | Cards, modals, sidebars, toolbars |
| **Subsurface** | `bg-subsurface` | `#334155` (Slate 700) | Hover states, active inputs, tab bars |
| **Border Default**| `border-default`| `rgba(255, 255, 255, 0.08)` | Subtle card/panel dividers |
| **Border Strong** | `border-strong` | `rgba(255, 255, 255, 0.16)` | Modal borders, focused elements |
| **Text Primary** | `text-primary` | `#f8fafc` (Slate 50) | Headers, primary data cells, active titles |
| **Text Secondary**| `text-secondary`| `#94a3b8` (Slate 400)| Subtitles, metadata, inactive labels |
| **Text Muted** | `text-muted` | `#64748b` (Slate 500)| Disabled text, placeholder indicators |

---

### 2. Typography Hierarchy

Tabularis utilizes clean system sans fonts (`Inter`, system UI, `-apple-system`, `Segoe UI`, `sans-serif`) paired with a monospace font for SQL and data tables (`JetBrains Mono`, `Fira Code`, `Consolas`, `monospace`).

| Level | Size | Weight | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Display / H1** | `text-2xl` (24px) | Semibold (`font-semibold`) | 32px | Main page titles |
| **Section / H2** | `text-lg` (18px) | Semibold (`font-semibold`) | 28px | Modal titles, card headers |
| **Subsection / H3**| `text-base` (16px) | Medium (`font-medium`) | 24px | Tab titles, grouped sections |
| **Body Default** | `text-sm` (14px) | Regular (`font-normal`) | 20px | Forms, toolbars, descriptions |
| **Caption / Meta** | `text-xs` (12px) | Medium (`font-medium`) | 16px | Status badges, timestamps, tags |
| **Code / Data** | `text-xs` / `text-sm`| Monospace (`font-mono`) | 18px | SQL queries, table cells, JSON |

---

### 3. Spacing & Elevation Scale

- **Grid Base**: 4px.
- **Padding standard**: `p-2` (8px), `p-3` (12px), `p-4` (16px), `p-6` (24px).
- **Border Radii**:
  - `rounded-lg` (8px): Buttons, inputs, small cards.
  - `rounded-xl` (12px): Modals, major panels, elevated cards.
  - `rounded-full`: Status pills, avatar badges.
- **Modals Overlay**: `fixed inset-0 bg-black/50 z-[100] backdrop-blur-sm` (per `.rules/modals.md`).

---

## 🧩 Standard Component Primitives

### 1. Button (`src/components/ui/Button.tsx`)
Standard button component supporting `variant` (`primary`, `secondary`, `outline`, `ghost`, `danger`), `size` (`sm`, `md`, `lg`), `loading` spinner, and leading/trailing icons.

```tsx
import { Button } from "./components/ui/Button";

<Button variant="primary" size="md" onClick={handleSave}>
  Save Connection
</Button>
<Button variant="ghost" size="sm" icon={<RefreshCw size={14} />}>
  Refresh
</Button>
```

### 2. Badge (`src/components/ui/Badge.tsx`)
Status badges supporting `default`, `success`, `warning`, `danger`, `info`, and `purple` variants with optional dot indicator.

```tsx
import { Badge } from "./components/ui/Badge";

<Badge variant="success" dot>Connected</Badge>
<Badge variant="purple">AI Assistant</Badge>
```

### 3. Card (`src/components/ui/Card.tsx`)
Card container conforming to `bg-elevated border border-strong rounded-xl`.

```tsx
import { Card, CardHeader, CardBody, CardFooter } from "./components/ui/Card";

<Card hover>
  <CardHeader title="PostgreSQL Production" subtitle="localhost:5432" />
  <CardBody>Active connections: 12</CardBody>
</Card>
```

---

## 🤝 Contributing to the Design System

We welcome contributions from designers, developers, and users! Here are areas where you can help:

### 1. New Component Primitives
- Create reusable components in `src/components/ui/` (e.g. `Tooltip`, `Tabs`, `DropdownMenu`, `Slider`).
- Ensure all components support keyboard navigation and ARIA accessibility.
- Adhere to the zero-driver-condition rule (`.rules/frontend.md`).

### 2. Database & Driver Iconography
- Submit vector SVG icons for new database drivers in `src/utils/driverIcons.tsx`.
- Icons should be clean 24x24 or 32x32 SVGs with proper `viewBox`.

### 3. Theme Variants
- Tabularis supports theme customization via `src/themes/`. Contribute new color palettes (e.g. Catppuccin, Nord, Tokyo Night, High Contrast).

### 4. How to Submit
1. Check open issues labeled `design` or `ui` on [GitHub Issues](https://github.com/TabularisDB/tabularis/issues/195).
2. Create a feature branch (e.g., `feat/design-system-badge`).
3. Verify changes visually using the in-app **Design System Showcase** (`Ctrl/Cmd + K` → "Design System").
4. Submit a Pull Request referencing issue **#195**.
