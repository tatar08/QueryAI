# PLAN-01 — IPC Command Inventory & Parity Matrix

**Owner:** Planning · **Status:** Evidence complete, matrix generated
**Artifacts:** [`PLAN-01-parity-matrix.csv`](./PLAN-01-parity-matrix.csv) (255 rows, one per command) ·
[`PLAN-01-frontend-native-surface.csv`](./PLAN-01-frontend-native-surface.csv) (8 rows, one per Tauri JS module)

## Why two matrices

The kickoff note scoped this as "one row per `#[tauri::command]`". That scope is **incomplete**, and it is the
single most important finding of this round.

A large part of the desktop app's native behaviour never passes through `invoke` at all — it is the frontend
calling `@tauri-apps/plugin-*` directly. The dominant export idiom in this codebase is
`save()` (native dialog) → `writeTextFile()` (direct disk write), executed entirely in TypeScript with no Rust
command involved. That path appears in **25 files** for dialogs and **10 files** for filesystem writes.

An endpoint-only inventory would have reported those surfaces as "no work required" and the port would have
lost every export/save/import flow in the product. Hence a second matrix covering the JS-side native surface.

## Method (reproducible, not hand-curated)

All numbers below are machine-extracted from the tree at commit `9e6975aa`:

1. **Defined commands** — scan every `src-tauri/src/**/*.rs` for `#[tauri::command]`, take the next `fn` name.
2. **Registered commands** — parse the `generate_handler![…]` block at `src-tauri/src/lib.rs:382`, stripping
   line and block comments before splitting, and taking the last `::` path segment.
3. **Frontend call sites** — regex `invoke<T>("name")` across `src/**/*.{ts,tsx}`, excluding `.test.` files.
4. **Native JS surface** — parse `import { … } from "@tauri-apps/<module>"` to get per-module symbol usage.

## Headline numbers

| Metric | Value |
|---|---|
| Commands defined (`#[tauri::command]`) | **255** |
| Commands registered in `generate_handler!` | **255 tokens / 254 unique** |
| Distinct command names invoked from frontend | **225** |
| Total frontend `invoke` call sites | **363** |
| Frontend invokes with no matching command (ghost calls) | **0** ✅ |
| Registered commands with no literal frontend invoke | **29** (see below) |
| Tauri JS modules used directly by frontend | **8**, across **~60 files** |

## Defects found while building the inventory

These are pre-existing, independent of the browser port. Reporting, not fixing — Planning does not cut code.

1. **`cancel_dump` is registered twice** in `generate_handler!`. Harmless today (Tauri dedupes by name), but it
   means the registration list is not a clean set. Flag for DEV to drop the duplicate.
2. **`clear_ai_models_cache` (`ai.rs:334`) is defined but never registered** — it is dead code, unreachable from
   the frontend. Either wire it up or delete it; do not port it.

## The 29 "registered but not invoked by literal"

Not all dead. Breakdown, verified:

- **10 are reached dynamically.** `src/components/settings/AiTab.tsx:195` and `:211` call `invoke(cmd, …)` with a
  computed name. That covers all `save_*_prompt` / `reset_*_prompt` commands (`system`, `explain`, `explainplan`,
  `cellname`, `tabrename`). **These will break silently under any naive codemod** that rewrites literal `invoke`
  calls to typed HTTP clients — the dynamic seam must be preserved explicitly. This is the highest-value
  handoff detail in this document.
- **The rest** (`open_devtools`, `close_devtools`, `test_log`, `get_theme`, `export_theme`, `import_theme`,
  `get_view_columns`, `get_materialized_view_columns`, `detect_mime_type`, `detect_blob_mime`, `get_file_stats`,
  `get_plugin_dir`, `get_plugin_startup_errors`, `restart_plugin_process`, `open_visual_explain_window`,
  `import_connections_payload`, `list_all_preferences`, `delete_editor_preferences`, `get_ai_models`) are either
  invoked from a secondary window entry point, called Rust-side, or genuinely dead.
  **Action for DEV-01:** confirm each before porting. Do not port dead commands — every one carried across is
  permanent surface area on a network boundary.

## Risk classification

Each row carries `risk` ∈ `GREEN` / `YELLOW` / `RED`.

| Risk | Count | Meaning |
|---|---|---|
| **GREEN** | 152 | Pure request/response. Mechanical lift to an HTTP endpoint. |
| **YELLOW** | 65 | Works in a browser but needs a deliberate shim — file i/o, progress events, cancellation, secrets. |
| **RED** | 38 | No clean browser analogue. Needs a product decision, not just an engineering one. |

### RED clusters (38 commands)

| # | Cluster | Why it does not port |
|---|---|---|
| 14 | Plugin / MCP lifecycle | `src-tauri/src/plugins/driver.rs:69-89` spawns a child process with piped stdio (JSON-RPC). A browser tab cannot spawn processes. |
| 10 | Multi-window | `WebviewWindowBuilder` in `connection_window.rs`, `results_window.rs`, `json_viewer.rs`, `task_manager.rs`, `explain_import.rs`. Detached OS windows with independent lifecycles. |
| 3 | Desktop self-updater | `updater.rs` — irrelevant once served from a server. |
| 3 | Host process/system introspection | `task_manager.rs` reads host OS process list and system stats. |
| 3 | SSH/k8s tunnel + interactive askpass | `ssh_tunnel.rs` shells out to `ssh`; `askpass/` needs an interactive round-trip. |
| 3 | OS keychain writes | `keychain_utils.rs` uses the `keyring` crate against the OS secret store. |
| 2 | OS devtools | Drop — browsers have their own. |

### YELLOW clusters (65 commands)

| # | Cluster | Shim required |
|---|---|---|
| 21 | Local-disk file i/o + progress events | HTTP streaming download / multipart upload; progress over WS. |
| 13 | SSH/tunnel config CRUD carrying secrets | Ordinary endpoints, but secrets must relocate to a server-side store. |
| 12 | Local filesystem access | Sandboxed server-side workspace. Arbitrary path access must not be exposed. |
| 10 | Local log file reads | Server log API, scoped to the caller's session. |
| 5 | Plugin registry/metadata reads | Network reads — proxy through the server. |
| 4 | In-flight cancellation | WS control message + a server-side job token. |

## Frontend native surface

| Module | Files | APIs | Risk |
|---|---|---|---|
| `plugin-dialog` | 25 | `open` `save` `ask` `confirm` `message` | YELLOW |
| `plugin-opener` | 13 | `openUrl` | GREEN — 1:1 with `window.open` |
| `api/event` | 12 | `listen` `emit` `UnlistenFn` | YELLOW — becomes WS/SSE |
| `plugin-fs` | 10 | `readTextFile` `writeTextFile` `writeFile` | YELLOW |
| `api/window` | 5 | `getCurrentWindow` `UserAttentionType` | **RED** |
| `plugin-clipboard-manager` | 3 | `readText` `writeText` | YELLOW — needs secure context + user gesture |
| `plugin-notification` | 1 | `sendNotification` + permission | YELLOW |
| `api/path` | 1 | `appDataDir` `join` | **RED** |

Rust emits only **3** event names (`update-progress`, `update-installing`, `connection-health-failed`); the
frontend listens on ~6 channels including `export_progress`, `import_progress`, `connections:active-changed`.
The realtime surface is small — **a single WS multiplexer is sufficient**; per-feature sockets are not warranted.

## Scope boundaries

**In scope (this round):** the two matrices, defect list, risk classification, dynamic-invoke warning.

**Out of scope / deferred:** endpoint paths in the CSV are a *naming proposal*, not a ratified API design —
they are mechanically derived (`/api/<domain>/<kebab-command>`) to give DEV a starting point and to make the
matrix joinable against DEV-01's extract. Auth, multi-tenancy, and session model are **not addressed here** and
are the single largest unscoped risk in the project (see AI-01).

## Acceptance criteria

- [x] Every `#[tauri::command]` appears exactly once in the matrix with source file and line.
- [x] Registration cross-check performed; discrepancies enumerated (2 found).
- [x] Every frontend `invoke` literal resolves to a real command (0 ghosts).
- [x] Dynamic-invoke sites identified and called out as a codemod hazard.
- [x] Frontend native-plugin surface inventoried separately from the command surface.
- [x] Every command carries a risk flag and a proposed substitute.
- [ ] **Open — DEV-01:** confirm live/dead status of the 19 non-dynamic uninvoked commands.
- [ ] **Open — Design (DES-01):** the 25 dialog files and 10 fs files are the surface list for network-state specs.
