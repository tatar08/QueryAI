# PLAN-02 — Audit of `Improvement plan.md`

**Owner:** Planning · **Round:** 2 · **Trigger:** CEO — "ที่ทำไปไม่เรียบร้อย"
**Audited file:** `Improvement plan.md` (repo root) · **Audited against:** working tree of
`/home/tar-ai-lab/Projects/QueryAI`, branch `octooffice/integration`, and commit `9e6975aa`.

## Verdict

The plan's *content* is sound. Its *status reporting* is not trustworthy, for one reason that dominates
everything else:

> **Every line of work the plan claims as done is uncommitted.** 81 items are checked `[x]`. Zero of them
> exist in git. `Improvement plan.md` itself has never been committed on any branch.

This is what "ไม่เรียบร้อย" is. The plan is not wrong about *what* to build — it is wrong to describe the work
as complete when it exists only as unversioned files in one developer's working directory.

---

## F1 — 61 source files of Phase 1/2 work exist only as uncommitted changes · **CRITICAL**

**Evidence:** `git status --porcelain` on `octooffice/integration`; `git ls-files src-core` → 0;
`git ls-files src-web-server` → 0; `git log --all -- "Improvement plan.md"` → empty.

| Category | Paths | Files |
|---|---|---|
| Untracked new crates | `src-core/`, `src-web-server/` | 9 + 17 `.rs` |
| Untracked new frontend | `src/transports/`, `src/platform/`, `src/tauri-web-shim/` | 6 + 3 + 10 `.ts` |
| Untracked new backend | `src-tauri/src/services/`, `connection_persistence_adapter.rs` | 12 + 1 `.rs` |
| Untracked new tests | `tests/transports/`, `tests/platform/` | 3 + 1 `.ts` |
| Modified, unstaged | `src-tauri/{Cargo.toml,Cargo.lock,src/lib.rs,src/commands.rs,src/mcp/mod.rs}`, `src/contexts/DatabaseProvider.tsx`, `src/pages/Editor.tsx`, `vite.config.ts` | 8 |
| Untracked config/doc | `.env.web.example`, `Improvement plan.md` | 2 |

Consequences, in order of severity:

1. **A single `git clean -fd` destroys Phase 1 and Phase 2 in full.** There is no second copy.
2. **Nobody can review it.** There is no diff, no PR, no commit range. The 81 checkboxes are unverifiable
   by anyone except the person holding the working directory.
3. **The regression numbers cannot be reproduced.** The plan claims `3,898 passed` frontend,
   `1,189 passed` Rust, `23 passed` core. Those runs cannot be re-executed by a second party, so they are
   assertions, not evidence.
4. **The prior planning round measured a different tree.** PLAN-01 and AI-01 were built at `9e6975aa`, which
   contains none of this. See F3.

**This is the only item that must be fixed before anything else in the plan proceeds.** It is also cheap:
the work appears to exist and to function; it needs to be committed.

## F2 — `src-web-server` is not in any Cargo workspace · **HIGH**

**Evidence:** no root `Cargo.toml`. `src-tauri/Cargo.toml:95` declares `tabularis-core = { path = "../src-core" }`;
`src-web-server/Cargo.toml:15` declares the same. Neither is a workspace member of anything.

The plan claims *"รัน Production Rust `cargo check --lib` ผ่านโดยไม่มี Warning"*. That check runs in `src-tauri`
and therefore **never compiles `src-web-server` at all**. A build from the repo root does not build the web
server; CI, once it exists, will not build it either. The 35 web-server unit tests the plan cites are only
reachable by `cd src-web-server` first.

**Fix:** add a root `Cargo.toml` workspace with `src-tauri`, `src-core`, `src-web-server` as members, so one
`cargo check --workspace` covers the whole backend. Until then, treat every green Rust result in the plan as
covering the desktop crate only.

## F3 — The plan and the Round-1 planning artifacts describe two different trees · **HIGH**

PLAN-01, AI-01 and the execution plan were all machine-extracted at `9e6975aa` — the committed tree, where the
port has not started. `Improvement plan.md` describes the dirty working tree, where a lot of it has. Both are
internally honest; together they are contradictory, and the contradiction is invisible to a reader.

Concrete example — the execution plan's critical path is now partly stale:

| Execution plan step | Plan says | Working tree says |
|---|---|---|
| S1 create transport seam | not started | `src/transports/` exists — 6 files |
| S2 migrate call sites off direct `invoke` | 363 sites across 84 files to do | `DatabaseProvider.tsx` already at **0** direct `invoke`, 66 transport references |
| S4 add HTTP transport | not started | `src/transports/http.ts` exists |

**Neither document is safe to hand to DEV as a work queue as written.** Once F1 is fixed, both must be
re-derived against the new base commit. The regeneration recipe in `PLAN-01-ipc-inventory.md` §Method is
sound — it just needs re-running.

## F4 — The delivered transport contradicts the approach the execution plan ratified · **MEDIUM**

`PLANNING-DELIVERABLE-execution-plan.md` §1.1 explicitly weighs and **rejects** a typed-per-command client:

> "A typed-per-command client (`api.getTables(...)`) … **Rejected *for this round*** because it forces all 363
> sites to change semantically at once."

The recommendation was an `invoke`-compatible seam changed by *import swap*. What was actually built
(`src/transports/backend.ts:45`) is the rejected design: `BackendTransport` with `listConnections()`,
`listTables(scope)`, `listViews(scope)`, `getDriverManifest(driverId)` — typed methods, one per operation.

This is not necessarily the wrong call; the typed client has real advantages and the migration evidently
succeeded for `DatabaseProvider`. **The defect is that the decision was reversed silently.** An ADR exists for
shared core services and for OIDC/tenancy, but none records this reversal, so the plan still documents a
trade-off the codebase no longer honours.

**Fix:** write an ADR recording the reversal and its rationale, and correct §1.1 of the execution plan.
Whichever way the decision lands, plan and code must state the same thing.

## F5 — Phase status labels overstate readiness · **MEDIUM**

The plan's own prose contradicts its table. Phase 4 is labelled **Pending** with the note *"Browser ยังเชื่อมต่อ
ฐานข้อมูลจริงไม่ได้"*, while Phase 1 and 2 are **In progress** — but the Phase 1/2 deliverables that exist are
fail-closed stubs: the plan states web schema/query repositories *"ค่าเริ่มต้น Fail closed ด้วย `503` จนกว่า
Authenticated tenant pool จะพร้อม"*.

So the HTTP surface returns `503` for every real request. That is a legitimate and well-chosen intermediate
state — but "In progress" invites a reader to think the endpoints work. They are wired, not functional.

**Fix:** state the fail-closed condition in the Phase table itself, not only in the checklist 80 lines below.

## F6 — Minor: headline counts are not exactly reproducible · **LOW**

The inventory states **363** `invoke` call sites across **84** files at `9e6975aa`. Re-running an equivalent
extraction gives **371** across **82** non-test files. The gap is small and methodological (which `invoke`
forms and which files count), and it does not change any conclusion. But the document claims the numbers are
machine-extracted and reproducible, so the exact command should be committed alongside the CSVs rather than
described in prose.

Verified as correct and unchanged: **255** `#[tauri::command]` definitions in the working tree, matching the
inventory's 255 at `9e6975aa`.

---

## Gap Register v1

Every gap found in this audit, with owner, done criteria and dependency. Ordered by blocking severity.

| ID | Gap | Sev | Owner | Done criteria | Depends on |
|---|---|---|---|---|---|
| **A1** | 61 source files of Phase 1/2 work uncommitted; `Improvement plan.md` untracked | CRITICAL | DEV | All Phase 1/2 work committed on a named branch; `git status` clean; plan file tracked; commit SHA recorded in the plan header | — |
| **A2** | `src-web-server` outside any Cargo workspace; root build never compiles it | HIGH | DEV | Root `Cargo.toml` workspace added; `cargo check --workspace` builds all three crates clean | A1 |
| **A3** | Planning artifacts measured at `9e6975aa`, plan describes dirty tree | HIGH | Planning | PLAN-01 CSVs + AI-01 regenerated against the A1 commit; base SHA stated in each | A1 |
| **A4** | Execution plan S1–S4 stale — seam and HTTP transport already exist | HIGH | Planning | Steps re-baselined to remaining work; completed steps marked done with evidence | A3 |
| **A5** | Typed-transport decision reversed with no ADR; plan documents rejected design | MEDIUM | Planning + DEV | ADR written recording the reversal; execution plan §1.1 corrected | A1 |
| **A6** | Phase table overstates readiness; `503` fail-closed state not visible | MEDIUM | Planning | Phase table carries the fail-closed caveat inline | — |
| **A7** | Test results cited in the plan are unreproducible by a second party | MEDIUM | DEV | Suites re-run on the A1 commit; counts + command recorded | A1, A2 |
| **A8** | 19 registered-but-uninvoked commands still unclassified live/dead | MEDIUM | DEV | Each of the 19 marked live or dead with evidence; dead ones deleted, not ported | A3 |
| **A9** | `cancel_dump` registered twice; `clear_ai_models_cache` defined but never registered | LOW | DEV | Duplicate removed; dead command wired or deleted | — |
| **A10** | Inventory counts not exactly reproducible (363/84 vs 371/82) | LOW | Planning | Extraction script committed next to the CSVs | A3 |
| **A11** | Tenancy ruling still open — gates G2, G4, G6 and the whole auth story | CRITICAL (decision) | CEO | Written ruling: single-user or multi-tenant | — |

**A1 and A11 are the two that block everything else** — one is a process fix, one is a decision. Neither
requires writing feature code.

---

## Corrected sequence

The Round-1 recommendation — land the mechanical ~60% while decisions resolve — still holds. It is now
preceded by the recovery work this audit found.

| # | Step | Owner | Gate |
|---|---|---|---|
| **R0** | Commit the 61 files. Nothing else starts until this lands. | DEV | A1 |
| **R1** | Root Cargo workspace; re-run all three suites; record real numbers. | DEV | A2, A7 |
| **R2** | Regenerate PLAN-01 CSVs + AI-01 against the R0 commit. | Planning | A3 |
| **R3** | Re-baseline the execution plan; ADR for the transport reversal; fix the Phase table. | Planning | A4, A5, A6 |
| **R4** | Resolve the 19 uninvoked commands; drop the duplicate registration. | DEV | A8, A9 |
| **R5** | Resume Phase 2 — OIDC callback, then tenant repositories and RBAC. | DEV | A11 ruling |

R0–R2 are mechanical and can be done in a day. R5 is the first step that needs the CEO's tenancy answer.

## Scope

**In scope:** audit of `Improvement plan.md` against the real tree; gap register; corrected sequence.

**Out of scope:** editing `Improvement plan.md` (it is untracked — editing it before A1 risks losing the
edit); writing the ADR (needs DEV's rationale for the reversal); regenerating the CSVs (needs the A1 commit
to exist first). Planning does not cut code — every finding above is reported, not fixed.

## Acceptance criteria for this audit

- [x] Every claim checked against the working tree, not against the plan's own narrative.
- [x] `git`-verified status for all 81 completed items (all uncommitted).
- [x] Cross-check of Round-1 artifacts against the tree they were built from.
- [x] Every gap carries ID, severity, owner, done criteria, dependency.
- [x] Findings separated into process defects, stale artifacts, and open decisions.
- [ ] **Open — CEO:** tenancy ruling (A11).
- [ ] **Open — DEV:** confirm the transport-design reversal rationale for the ADR (A5).
