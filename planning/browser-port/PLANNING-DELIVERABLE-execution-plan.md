# Planning Deliverable — Browser Port Execution Plan

**Owner:** Planning · **Round:** 1 · **Base commit:** `9e6975aa`
**Depends on:** [PLAN-01 inventory](./PLAN-01-ipc-inventory.md) · [AI-01 gap register](./AI-01-native-capability-gap-register.md)

Goal: replace Tauri IPC with an API server so Tabularis runs in a browser with UI/UX and feature parity to desktop.

---

## 1. Architecture

### 1.1 Transport seam — the one decision everything else depends on

Today **363 call sites across 84 files** call `invoke` directly, plus ~60 files importing `@tauri-apps/*`
modules. Rewriting those call-by-call is the failure mode to avoid: it is a huge diff, unreviewable, and it
strands the desktop build mid-migration.

**Approach:** introduce a transport module that re-exports an `invoke`-compatible signature, then change
*imports* rather than *call sites*. A call site changes from

```ts
import { invoke } from "@tauri-apps/api/core";
```

to

```ts
import { invoke } from "@/transport";
```

The call body is untouched. This is a mechanical, greppable, reviewable change, and it lets both transports
coexist behind a build flag while the port proceeds.

**Trade-off considered.** A typed-per-command client (`api.getTables(...)`) is better long-term ergonomics and
gives real type safety. Rejected *for this round* because it forces all 363 sites to change semantically at
once. Recommendation: ship the compatible seam first, then layer typed wrappers incrementally on top of a
stable boundary. This sequences risk instead of compounding it.

**Hazard — must not be missed.** `src/components/settings/AiTab.tsx:195` and `:211` call `invoke(cmd, …)` with a
**computed** command name. A codemod that rewrites string-literal invokes will silently skip these, and the
10 `save_*_prompt` / `reset_*_prompt` commands will fail at runtime with no compile error. The seam must accept
a dynamic name, and this file needs a hand-written test.

### 1.2 Server shape

Rust backend, reusing the existing command functions as handlers so business logic is not rewritten. Commands
are already `async fn` with serializable args/returns — this is the property that makes the port tractable.

- **HTTP** for the 152 GREEN request/response commands.
- **One WebSocket multiplexer** for events. Justified by measurement, not preference: only 3 event names are
  emitted Rust-side and ~6 listened to frontend-side. Per-feature sockets would be over-engineering.
- **Streaming HTTP** for export/dump download and multipart for import upload.

### 1.3 Explicitly out of scope this round

Auth/session model, multi-tenancy, deployment topology. These are **not deferrable indefinitely** — they gate
G2/G4/G6 in the gap register — but they are decisions, not implementation, and are owned above Planning.

---

## 2. Ordered execution steps

Each step is independently committable and independently reviewable.

| # | Step | Owner | Depends on | Output |
|---|---|---|---|---|
| **S1** | Create `src/transport/index.ts` exporting `invoke` re-exported from `@tauri-apps/api/core`. No behaviour change. | DEV | — | Seam exists; desktop still green. |
| **S2** | Codemod imports in all 84 files from `@tauri-apps/api/core` → `@/transport`. Add lint rule banning direct `@tauri-apps/api/core` import outside `src/transport/`. | DEV | S1 | One import per file changed; zero behaviour change. |
| **S3** | Hand-fix `AiTab.tsx` dynamic invoke + add a regression test asserting all 10 dynamic prompt commands resolve. | DEV | S2 | Dynamic seam protected. |
| **S4** | Add `src/transport/http.ts` — same signature, POSTs `{command, args}` to the server. Select via build flag. | DEV | S2 | Both transports selectable. |
| **S5** | Server skeleton: HTTP route dispatching to existing command fns. Start with the 152 GREEN commands. | DEV | S4 | GREEN parity. |
| **S6** | WS multiplexer + `src/transport/events.ts` exposing the existing `listen(channel, cb) => unlisten` shape. Migrate the 12 `api/event` files by import swap. | DEV | S4 | Event parity. |
| **S7** | `src/transport/files.ts` — `saveFile()` / `pickFile()`. Migrate the 25 dialog + 10 fs files. | DEV + Design | S4, DES-01 | File i/o parity. |
| **S8** | Streaming download / multipart upload for the 21 file-i/o commands; WS progress. | DEV | S6, S7 | Export/import parity. |
| **S9** | Cancellation: server-side job tokens for the 4 `cancel_*` commands. | DEV | S6 | Cancel parity. |
| **S10** | RED clusters — **blocked on rulings**, do not start speculatively. | DEV | Open questions | Per gap register. |

**Critical path insight:** S1–S6 are unblocked by every open question in the gap register. Start there. Do not
let the multi-window and tenancy decisions stall ~60% of the work that does not depend on them.

### Pre-work (cheap, do alongside S1)

- Remove the duplicate `cancel_dump` registration in `generate_handler!` (`lib.rs:382` block).
- Resolve `clear_ai_models_cache` (`ai.rs:334`): wire up or delete. Do not port dead code.
- Confirm live/dead status of the 19 non-dynamic uninvoked commands before porting any of them.

---

## 3. Acceptance criteria

**Transport seam (S1–S4)**
- No file outside `src/transport/` imports `@tauri-apps/api/core`; enforced by lint, not review.
- Desktop build passes `pnpm test:all` and `pnpm typecheck` unchanged after S2.
- Both transports selectable by build flag with no source change at call sites.
- All 10 dynamically-invoked prompt commands covered by an explicit test.

**Server (S5)**
- All 152 GREEN commands reachable over HTTP; request/response shapes byte-identical to IPC.
- Error shape preserved: commands return `Result<T, String>` today — the HTTP layer must not turn a
  structured error into a generic 500, or every error-handling branch in the UI regresses.

**Events (S6)**
- All ~6 channels deliver over WS; `listen()` returns a working `unlisten`.
- Reconnect with backoff; **UI must show a disconnected state** — this state cannot occur on desktop and every
  surface needs it (Design owns the spec).

**Files (S7–S8)**
- Save produces an identical file to the desktop build for the same input.
- Open accepts the same formats.
- Progress events fire for long export/import.
- Known regression, accepted and documented: the app cannot re-read a path it previously wrote.

**Parity gate (all steps)**
- Every matrix row is `ported` / `deferred` / `dropped` — no row left unclassified.
- Deferred and dropped rows each carry a written justification.

---

## 4. Testing strategy

Per [`.rules/testing.md`](../../.rules/testing.md): tests mirror `src/` under `tests/`; Vitest; `pnpm test:all`
runs `cargo test` then `vitest run --coverage`.

| Layer | What | Notes |
|---|---|---|
| **Unit (TS)** | `tests/transport/*.test.ts` — both transports satisfy the same contract. | Existing pattern: `vi.mock("@tauri-apps/api/core", …)` as in `ConnectionIconImage.test.tsx:5`. |
| **Unit (Rust)** | `cargo test` — handlers under HTTP dispatch. | Repo convention: `*_tests.rs` sibling modules. |
| **Contract** | One table-driven test per matrix row asserting the endpoint exists and round-trips its shape. | Drive directly from `PLAN-01-parity-matrix.csv` so the matrix stays honest — a new command with no endpoint fails CI. This is the highest-leverage test in the plan. |
| **Regression** | Dynamic-invoke resolution (`AiTab.tsx`). | Explicitly listed because static analysis cannot catch it. |
| **E2E** | Core flows in a real browser: connect → query → view results → export. | Smallest set that proves the port. |

**Coverage expectation:** `src/transport/` is the highest-risk new code and every call site funnels through it —
it should carry the strictest bar. Existing modules should not regress from current baseline.

**Note for DEV:** `.rules/testing.md` mandates tests in a parallel `tests/` tree, but several `.test.tsx` files
are colocated in `src/` (e.g. `src/components/ConnectionIconImage.test.tsx`). Follow the rule for new files;
the inconsistency is pre-existing and out of scope here.

---

## 5. Handoff

**→ Development (DEV-01):** S1–S3 are fully specified and unblocked; start now. Use
`PLAN-01-parity-matrix.csv` as the work queue — the `command` / `source` columns are your extract, and
`endpoint` is a naming proposal open to revision. Confirm the 19 uninvoked commands before porting them.

**→ Design (DES-01):** your surface list is in the inventory — 25 dialog files and 10 fs files, plus the 12
event files. The new states that cannot exist on desktop and therefore have no existing design: **loading**
(network latency), **connection-lost** (WS drop), **retry**, **upload/download progress**. `ask`/`confirm`/
`message` (39 sites) become in-app modals per [`.rules/modals.md`](../../.rules/modals.md).

**→ CEO:** four blocking questions in the gap register. **Tenancy (single-user vs multi-tenant) is the one to
answer first** — it determines the security model for plugins, secrets, and tunnels, and guessing it wrong is
expensive to unwind. Multi-window (G1) is the largest UX delta and needs a product ruling before DEV builds it.
