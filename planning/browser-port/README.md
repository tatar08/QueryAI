# Browser Port — Planning Artifacts

Planning-owned deliverables for replacing Tauri IPC with an API server so Tabularis runs in a browser.
All Round-1 figures machine-extracted from commit `9e6975aa`.

> **Read PLAN-02 first.** Round 2 audited `Improvement plan.md` against the real working tree and found that
> all 81 items it marks complete are **uncommitted** — 61 source files exist only in one working directory,
> and the plan file itself is untracked. The Round-1 artifacts below were measured at `9e6975aa`, which
> contains none of that work, so their step numbering is partly stale. Both must be regenerated once the work
> is committed. Do not hand PLAN-01 or the execution plan to DEV as a work queue until then.

| Artifact | Contents |
|---|---|
| [PLAN-02-plan-audit.md](./PLAN-02-plan-audit.md) | Audit of `Improvement plan.md`, Gap Register v1 (11 gaps), corrected R0–R5 sequence. **Start here.** |
| [PLANNING-DELIVERABLE-execution-plan.md](./PLANNING-DELIVERABLE-execution-plan.md) | Architecture, 10 ordered steps, acceptance criteria, testing strategy, handoffs. Steps S1–S4 partly superseded — see PLAN-02 F3. |
| [PLAN-01-ipc-inventory.md](./PLAN-01-ipc-inventory.md) | Inventory method, headline numbers, defects found, risk classification. |
| [PLAN-01-parity-matrix.csv](./PLAN-01-parity-matrix.csv) | 255 rows — one per `#[tauri::command]`. The work queue. |
| [PLAN-01-frontend-native-surface.csv](./PLAN-01-frontend-native-surface.csv) | 8 rows — Tauri JS modules used directly by the frontend, bypassing `invoke`. |
| [AI-01-native-capability-gap-register.md](./AI-01-native-capability-gap-register.md) | Every risk-flagged surface classified viable / needs-a-shim / impossible, with substitutes and open questions. |

## Numbers at a glance

- **255** Tauri commands · **363** frontend `invoke` sites across **84** files · **0** ghost calls
- **152 GREEN** (mechanical) · **65 YELLOW** (needs a shim) · **38 RED** (needs a product ruling)
- **~60** additional files use `@tauri-apps/*` plugins directly, never touching `invoke`

## Three things not to miss

0. **Nothing claimed as done is in git.** `src-core/`, `src-web-server/`, `src/transports/`, `src/platform/`
   and `src-tauri/src/services/` are all untracked; `DatabaseProvider.tsx`, `lib.rs` and `vite.config.ts` are
   modified and unstaged. One `git clean -fd` erases Phase 1 and Phase 2. Committing this is gap **A1** and it
   blocks every other item.


1. **The command matrix is not the whole surface.** The dominant export idiom (`save()` → `writeTextFile()`)
   never calls `invoke` — it lives entirely in TypeScript across 35 files. Endpoint-only parity would drop
   every export/save flow in the product. Hence the second CSV.
2. **`AiTab.tsx:195,211` invoke a computed command name.** Any codemod over string-literal invokes skips these
   and breaks 10 commands with no compile error.
3. **Tenancy is the blocking question.** Single-user vs multi-tenant determines the security model for the
   plugin host, the secret store, and SSH tunnels. Three of the seven RED clusters resolve differently
   depending on the answer.

## Reproducing the matrices

Both CSVs are generated, not hand-maintained. Regeneration is: scan `src-tauri/src/**/*.rs` for
`#[tauri::command]` → next `fn` name; parse the `generate_handler![…]` block at `src-tauri/src/lib.rs:382`
(strip comments before splitting); regex `invoke<T>("name")` across `src/**/*.{ts,tsx}` excluding `.test.`;
parse `@tauri-apps/*` imports for per-module symbol usage. Method detail in the inventory doc.

Re-run after any command is added or removed — the contract test in the testing strategy is designed to fail
CI when the matrix drifts from the code.
