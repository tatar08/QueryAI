# AI-01 — Native-Capability Gap Register

**Owner:** Planning (backing CEO's AI-01 request) · **Input:** [PLAN-01 matrix](./PLAN-01-parity-matrix.csv)
**Classification:** every risk-flagged surface sorted into **browser-viable** / **needs-a-shim** / **impossible**.

The kickoff asked for three buckets. Building it produced a fourth that matters more than the other three:
**impossible-as-built, but the requirement behind it is satisfiable another way.** Most RED rows land there.
Reporting them as flatly "impossible" would understate what is achievable and overstate the schedule risk.

---

## G1 — Multi-window (10 commands) · IMPOSSIBLE AS BUILT · requirement satisfiable

**Evidence:** `WebviewWindowBuilder` at `connection_window.rs:41`, `results_window.rs:60`, `json_viewer.rs:125`,
`task_manager.rs:374`, `explain_import.rs:84`.

Desktop opens genuine detached OS windows: a connection window, a detached results grid, a JSON viewer, an ER
diagram, visual explain, a task manager. Users drag these to a second monitor. That is the actual user need.

A browser tab cannot create an OS window it controls. `window.open` yields a popup that is popup-blocked
without a user gesture, has no shared JS heap, and cannot be positioned reliably.

**Substitute:** in-app dockable panels as the default (works everywhere, keyboard accessible, testable), with
`window.open` + `BroadcastChannel` for cross-tab state sync as an opt-in "pop out" for the two surfaces where
a second monitor is the whole point — detached results grid and JSON viewer.

> **This is a product decision, not an engineering one, and it is the largest single UX delta in the port.**
> It needs an explicit CEO/Design ruling before DEV builds either path. Flagging rather than assuming.

## G2 — Plugin & MCP lifecycle (14 commands) · IMPOSSIBLE IN BROWSER · server-side only

**Evidence:** `plugins/driver.rs:69-89` — `Command::new(...).stdin(piped).stdout(piped).spawn()`, JSON-RPC over
stdio. `mcp/install.rs:236` shells out similarly.

The browser cannot spawn processes; this must move server-side entirely. That flips a per-user desktop feature
into **multi-tenant arbitrary code execution on a shared host**.

**Substitute:** server-side plugin host, install gated to admins, per-user process sandbox, resource limits.

> **Security-critical.** In desktop, a plugin runs as the user, on their machine, with their trust. On a shared
> server it runs next to every other user's data. If the deployment is genuinely single-user, this collapses to
> near-zero risk — so **"single-user or multi-tenant?" is a blocking question** and it gates G2, G4, and G6.
> I do not have an answer and am not going to guess it. See Open Questions.

## G3 — File dialogs + filesystem (25 dialog files / 10 fs files) · NEEDS A SHIM · highest volume

**Evidence:** `save()`→`writeTextFile()` is the export idiom across `Editor.tsx`, `NotebookView.tsx`,
`ResultToolbar.tsx`, `Connections.tsx`, `SchemaDiagram.tsx`, both AI-activity tabs, `NotebooksSection.tsx`.

Split by direction:

| Direction | Desktop | Browser substitute | Viability |
|---|---|---|---|
| **Write** (`save` + `writeTextFile`) | native save dialog, arbitrary path | `<a download>` blob, or File System Access API where available | **Viable.** User loses "choose the exact folder" on non-Chromium. |
| **Read** (`open` + `readTextFile`) | native open dialog, arbitrary path | `<input type="file">` | **Viable**, but the app can no longer *re-read* a path it wrote earlier. |
| **Re-read a known path** | trivial | — | **Impossible.** Browsers have no persistent path handle without an explicit user-granted FS Access handle. |

**Substitute:** one `fileTransfer` shim module with `saveFile()` / `pickFile()`, so all 35 files route through a
single seam rather than each reinventing it. Feature-detect File System Access, fall back to blob download.

`ask()`/`confirm()`/`message()` (39 call sites) are native modals — these become in-app modals. **Design owns
this**; the repo already has modal conventions in `.rules/modals.md` to follow.

## G4 — OS keychain (3 commands + credential paths) · NEEDS A SHIM · security-critical

**Evidence:** `keychain_utils.rs` — `keyring::Entry` against the OS secret store, keyed `{connection_id}:db`
and `{connection_id}:connection_uri`.

Desktop stores DB credentials in the OS keychain, unlocked by the user's OS login. There is no browser analogue —
and storing credentials in `localStorage` would be a serious regression.

**Substitute:** server-side encrypted secret store, keyed to an authenticated session; credentials never reach
the browser. Requires an auth system that **does not exist in this codebase today**.

> Gated on the same tenancy question as G2.

## G5 — Streaming, progress & cancellation (4 cancel + 21 file-i/o commands) · NEEDS A SHIM · viable

**Evidence:** Rust emits 3 event names; frontend listens on ~6 channels (`export_progress`, `import_progress`,
`update-progress`, `update-installing`, `connection-health-failed`, `connections:active-changed`).

**Substitute:** a single WebSocket multiplexer carrying `{channel, payload}`, with the shim exposing the same
`listen(channel, cb) => unlisten` signature the 12 `api/event` files already use. Because the channel count is
small and the shape is uniform, **this is the lowest-risk of the RED/YELLOW clusters** despite sounding scary.

Cancellation (`cancel_query`, `cancel_dump`, `cancel_export`, `cancel_import`) needs server-side job tokens —
a real design task, since desktop cancellation relied on in-process state that a stateless HTTP tier lacks.

## G6 — SSH / k8s tunnels + askpass (3 RED + 13 YELLOW) · NEEDS A SHIM · viable, security-critical

**Evidence:** `ssh_tunnel.rs:90` builds an `ssh` command; `askpass/mod.rs:133` handles interactive prompts.

Tunnels move server-side (they are already a server-ish concern). `respond_ssh_askpass` needs an interactive
round-trip: server pauses, pushes a prompt over WS, waits for the reply.

> Server-side tunnels mean **the server gains network reach into every user's infrastructure**. Tenancy question
> applies again.

## G7 — Trivially viable · NO WORK BEYOND THE SHIM

| Surface | Substitute | Note |
|---|---|---|
| `plugin-opener` (13 files, `openUrl` only) | `window.open(url,"_blank","noopener")` | True 1:1. |
| `plugin-clipboard-manager` (3 files) | `navigator.clipboard` | Needs HTTPS + user gesture. |
| `plugin-notification` (1 file) | `Notification` API | Needs permission prompt. |
| `api/path` (`appDataDir`, `join`) | server-issued URLs | Only 1 non-test file — trivial. |
| 152 GREEN commands | direct HTTP endpoints | Mechanical. |

---

## Summary

| Bucket | Surfaces | Share of commands |
|---|---|---|
| **Browser-viable** (mechanical) | 152 GREEN + `plugin-opener` | ~60% |
| **Needs a shim** (real design work) | G3, G4, G5, G6, clipboard, notification | ~30% |
| **Impossible as built** (needs product ruling) | G1 multi-window, G2 plugin host | ~10% |

The port is **not** blocked on the impossible bucket — it is ~10% of commands and concentrated in two features.
It *is* blocked on decisions about those two, plus auth. Those are cheap to decide and expensive to guess wrong.

## Open questions — blocking, need a ruling before DEV commits to an architecture

1. **Single-user or multi-tenant?** Gates G2, G4, G6 and the entire auth story. Everything security-shaped in
   this register resolves differently depending on the answer. **Highest-priority unblock.**
2. **Is the desktop build still shipping?** If yes, the shim must keep both transports alive indefinitely and
   that constrains DEV-01's seam design. If no, the Tauri path can be deleted after cutover.
3. **Multi-window: dockable panels, pop-out tabs, or both?** (G1) — Design + CEO.
4. **Do plugins ship in v1 of the browser build?** Deferring G2 removes the largest security surface and 14 of
   the 38 RED commands from scope.

## Recommendation

Sequence the work so the ~60% mechanical surface can proceed in parallel with the decisions above: land the
transport shim and the GREEN endpoints first — they are unaffected by every open question — while G1/G2 and the
tenancy ruling are resolved. That keeps the critical path off the blocked items rather than stalling the round.
