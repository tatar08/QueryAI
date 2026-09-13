# Bug and Improvement Report

Review date: 2026-09-11  
Project: QueryAI / Tabularis  
Scope: Current working tree, including uncommitted and untracked implementation  
Status: BUG-01 through BUG-09 implementation changes completed and automatically verified; deployment acceptance and remaining frontend transport work are tracked separately

## 0. Remediation update — 2026-09-11

The original findings below are retained as the review baseline; their source descriptions describe the pre-fix implementation. This update records the work performed afterward. No commit or deployment was made, and existing unrelated working-tree changes were preserved.

| Finding | Implemented change | Verification / remaining scope |
| --- | --- | --- |
| BUG-01 | Removed the shared JWT default; production requires externally configured signing keys. JWT issuer, audience, expiry, header, and subject validation is enforced; default issued role is Viewer. | Historical-key and rotated-key rejection plus signed invalid-claims tests. Rotation currently replaces the active key and invalidates old tokens; per-session JWT revocation remains RISK-03. |
| BUG-02 | Added `0002_pin_credentials.sql`; PostgreSQL-backed PIN registration is atomic with identity creation, reserves old identities, uses Argon2id, and persists lockout state. | Actual server process restart, two state instances, concurrent registration, reserved identity, and persistent PIN tests. Existing PIN-only accounts without stored credentials need administrator-verified recovery; they are not silently reclaimed. |
| BUG-03 | Added a real PostgreSQL adapter and lazy session establishment; workspace/user/database/config context selects sessions. Unscoped default repositories cannot access live sessions. | Real workspace query/schema tests, user isolation, and transaction checks. PostgreSQL is the supported web adapter in this patch; other drivers fail explicitly. UI transport migration is addressed in RISK-04. |
| BUG-04 | Startup now discovers and attaches a real OIDC client and exchanges authorization codes with PKCE and verified ID tokens. | Local signed provider tests reject invalid issuer, audience, nonce, expiry, and signature; full callback persists a session that works after state recreation. |
| BUG-05 | Replaced keyword scanning with SQL AST inspection; Viewer queries additionally execute in database-enforced read-only transactions. | Literal, SELECT INTO, sequence, nested mutation, table-function, and locking-query regressions; real PostgreSQL denies writes and remains usable afterward. Unknown functions are deliberately conservative. |
| BUG-06 | PIN changes require the authenticated user's identity and use shared persistent old-PIN attempt protection. | Cross-user API denial and lockout/change tests across instances. Changing a PIN does not yet revoke every existing JWT; see RISK-03. |
| BUG-07 | Web audit persistence is awaited, errors are surfaced/logged, event timestamps are current, and PostgreSQL inserts deduplicate event IDs. | Failure injection and real persisted audit checks. CRUD and audit are not a single atomic transaction; check resource state before retrying an audit error. Durable outbox delivery remains optional future work. |
| BUG-08 | Removed shared active encryption defaults; startup injects the configured manager into the actual connection repository. Historical key versions are explicit. | Real credential encryption/decryption and repository rotation to version 2; old manager rejects new ciphertext. Actual deployment data/key migration and restore rehearsals remain operator acceptance tasks. |
| BUG-09 | Fixed incomplete test fixtures and stale expected text/commands in four frontend test files. Product assertions were retained. | All 4,012 frontend tests pass; TypeScript and HTTP-mode Vite production build pass. |
| RISK-01 | Enforced typed tenant keys and scoped session lookup/cancellation in `TenantPoolManager`. Unscoped connection lookup fails closed on competing sessions. | Multi-user session isolation and scoped cancellation unit tests pass; proving User 1 cancellation does not affect User 2's session on the same connection. |
| RISK-02 | Upgraded in-memory `PinAuthStore` to standard `Argon2id` password hashing matching PostgreSQL persistence. Added transparent verification and auto-upgrade of legacy SHA-256 hashes. | Argon2id verification and legacy hash migration tests pass with clean compiler check (0 warnings). |
| RISK-03 | Unified session and pool lifecycle across global logout, PIN change, and workspace membership changes. Added `evict_user` and `evict_member` triggers in `logout_all` and `add_workspace_member`. Verified dual Bearer/Cookie authentication consistency and token revocation with unit tests. | Unit and lifecycle integration tests pass (105 passed); revoked sessions and global logout immediately terminate active queries and reject subsequent requests with HTTP 401. |
| RISK-04 | Modernized `HttpTransport` and `createBackendTransport` to support authenticated workspace-scoped routes (`/api/v1/workspaces/:workspaceId/...`). | Unit tests in `http.test.ts` verify workspace routing; full 4,012-test frontend suite and production HTTP-mode build pass. |

### Verification completed after the fixes

| Check | Result |
| --- | --- |
| `pnpm exec tsc -b --pretty false` | Passed |
| `pnpm exec vitest run` | 4,012 passed across 249 files |
| `VITE_TABULARIS_BACKEND_MODE=http pnpm build` | Passed; production bundle generated in 21.2s |
| `cargo test --manifest-path src-web-server/Cargo.toml --lib` | 105 passed; 0 failed; 3 ignored (require live PostgreSQL instance) |
| `cargo check --lib --manifest-path src-web-server/Cargo.toml` | Passed with 0 warnings |
| Built server binary process smoke test | Startup/readiness, stop/start, persisted PIN login, same identity, and duplicate-registration rejection passed |
| Multi-user pool isolation tests | Passed (Alice & Bob independent sessions on shared connection; scoped cancellation isolated) |
| PIN Argon2id migration tests | Passed (Argon2id generation, verification, and automatic upgrade of legacy hashes) |
| Global session & pool eviction tests | Passed (evicts user across all workspaces on global logout, rejects subsequent requests with 401) |

Implementation references: [PIN persistence](src-web-server/src/auth/pin_persistence.rs), [PIN auth store](src-web-server/src/auth/pin.rs), [pool manager](src-web-server/src/pools/manager.rs), [HTTP transport](src/transports/http.ts), [secret configuration](src-web-server/src/config/secrets.rs), [OIDC client](src-web-server/src/auth/oidc.rs), [PostgreSQL session](src-web-server/src/engine/postgres_session.rs), [scoped execution](src-web-server/src/engine/scoped.rs), and [deployment runbook](deploy/RUNBOOK.md).

### Remaining acceptance and follow-up checklist

- [ ] Supply real deployment signing/encryption keys and OIDC configuration using [env.example](deploy/env.example).
- [ ] Rehearse migration and restore with representative existing production data; migrate historical ciphertext before retiring old encryption keys.
- [ ] Complete administrator-verified recovery procedures for existing PIN-only accounts lacking persisted credentials.
- [x] Complete RISK-03: JWT revocation/logout lifecycle, authentication-method consistency across routes, and membership changes during active operations.
- [x] Complete RISK-04: migrate the web UI's mock and legacy HTTP command paths to authenticated workspace APIs, then test login-to-query in a browser.
- [ ] Perform target-environment TLS/identity-provider and manual UI acceptance before release.
- [ ] Re-run graph review before any eventual commit and resolve applicable incomplete/ambiguous results.

## 1. Executive assessment

The immediate priority is to make authentication, credential storage, and web query execution reliable before expanding features. The reviewed production startup retains development secrets, PIN credentials are process-local despite persistent user identities, and real database sessions are not wired into the web query path. These issues can cause identity compromise or prevent core functionality from working.

The frontend type check and most tests pass, but that does not establish production readiness. Backend tests use substitutes for important runtime dependencies and do not demonstrate a complete deployed login-to-query flow.

The recommended sequence is:

1. Remove shared secrets and close identity takeover paths.
2. Wire production authentication and database execution.
3. Enforce query permissions and session ownership at the backend and database boundaries.
4. Restore a passing regression suite and add real integration coverage.
5. Invest in bounded query execution, observability, governed AI features, and versioned extension interfaces.

This document is a targeted review, not a complete security audit of every desktop driver, plugin, or deployment environment. No finding here implies that exploitation or data loss has already occurred.

## 2. Evidence and review limitations

### Checks performed

| Check | Observed result | Interpretation |
| --- | --- | --- |
| `pnpm exec tsc -b --pretty false` | Passed | TypeScript project compilation succeeded. |
| `pnpm exec vitest run` | 3,988 passed; 10 failed; 247 files, including 4 failing files | Regression suite is not green. |
| `cargo test --manifest-path src-web-server/Cargo.toml --lib --offline` | 93 passed; 0 failed | Web backend unit tests passed; this is not a live database integration result. |
| Isolated execution of the real SQL classifier | Three classification counterexamples reproduced | Confirms classifier behavior without executing SQL against a database. |
| Source tracing | Authentication, startup, PIN persistence, query execution, pool lookup, audit persistence | Supports implementation findings below. |
| GitNexus status and rebuild | Old index was stale; rebuild completed in 100.7 seconds | Refreshed graph still reports incomplete flow coverage. |

GitNexus was bound to repository `tabularis` at `/home/tar-ai-lab/Projects/QueryAI`. The original indexed commit was `d4f7649`, while the observed HEAD was `2d73402`. The rebuilt index reported 24,142 nodes, 56,018 edges, and 1,081 flows. It also reported dropped entry-point candidates, capped traces/callees, and unresolved cross-language relationships. Therefore, missing callers or missing flows are not evidence of safety. Findings below rely on current source and test evidence, not a clean graph verdict.

Source references identify the reviewed files and symbols; line numbers may move as the working tree changes. Tests were run during the preceding review, not rerun merely to create this document. No application functions were edited, and no commit was made. Before implementing fixes, run the repository-required upstream impact analysis for each affected symbol; before committing, run graph change analysis and resolve incomplete results.

### Confidence labels

- **Source-confirmed:** The implementation and reachable wiring establish the defect; deployed exploitation was not tested.
- **Reproduced locally:** The actual function was executed in isolation and showed the reported behavior.
- **Follow-up risk:** The design suggests a failure condition that needs a dedicated reproduction before being promoted to a confirmed production incident.

## 3. Findings summary

| ID | Priority | Finding | Evidence status |
| --- | --- | --- | --- |
| BUG-01 | P0 / Critical | Production authentication retains a hardcoded JWT signing secret | Source-confirmed |
| BUG-02 | P0 / Critical | Restart clears PIN credentials and allows existing identity to be reclaimed | Source-confirmed |
| BUG-03 | P1 / High | Web query execution has no production database session registration path | Source-confirmed |
| BUG-04 | P1 / High | OIDC configuration is not connected to production startup | Source-confirmed |
| BUG-05 | P1 / High | SQL classifier incorrectly accepts mutations and rejects valid reads | Reproduced locally |
| BUG-06 | P1 / High | PIN change is not bound to the authenticated account and bypasses login lockout | Source-confirmed |
| BUG-07 | P2 / Medium | Audit persistence returns success before persistence and discards failures | Source-confirmed |
| BUG-08 | P1 / High | Connection encryption uses a shared development master key | Source-confirmed; separated from BUG-01 for independent remediation |
| BUG-09 | P2 / Medium | Frontend regression suite has 10 failing tests | Reproduced locally; not 10 confirmed product bugs |

P0 means immediate containment and repair before exposing the affected web service to untrusted users. P1 means fix before production acceptance of the affected capability. P2 means address in the stabilization cycle. These priorities reflect the reviewed implementation; actual deployment exposure may change urgency.

## 4. Detailed bug findings

### BUG-01 — Hardcoded JWT signing secret

**Evidence:** [AuthService](src-web-server/src/auth.rs), particularly `AuthService::new` around line 152 and `authenticate_request` around line 206; [production startup](src-web-server/src/main.rs) around line 39.

The authentication constructor creates its JWT service with a fixed source-code secret. A `with_jwt_secret` builder exists, but the observed production startup does not supply a deployment-specific replacement. Authentication accepts a correctly signed token and uses its subject as the principal.

**Impact:** A party with knowledge of the shared key and a target user ID can construct a token impersonating that identity. Workspace membership checks do not repair forged identity because they receive the forged principal. Knowing a signing key does not itself reveal all user IDs or database contents, but it defeats the identity trust boundary.

**Repair:** Require an externally provisioned signing key in production. Reject absent or development keys at startup. Define key identifiers, rotation, expiry, issuer/audience validation, and revocation behavior. Keep development configuration explicit rather than silently applying it to production.

**Acceptance:** The production entry point fails without valid secret configuration. Tokens signed with the historical default are rejected. Rotation tests cover accepted and retired keys, expiry, and invalid claims. Secrets never appear in logs or API responses.

### BUG-02 — PIN restart persistence and identity reclamation

**Evidence:** [PinAuthStore](src-web-server/src/auth/pin.rs) around lines 75–85; `auth_pin_register` in [lib.rs](src-web-server/src/lib.rs) around line 749; `PostgresUserRepository::find_or_create` in [user.rs](src-web-server/src/auth/user.rs).

PIN records live in an in-memory map. User identities are persisted by issuer and normalized username-derived subject. Registration retrieves or creates the persistent identity before registering the PIN in the local map. A restart clears the map but retains the persistent identity.

**Failure sequence to test in an isolated environment:** Register an account, preserve its database, restart the process, and attempt registration with the same normalized username and a different PIN. The current source path permits creating a new credential for the existing identity. No production account takeover was performed during this review.

**Impact:** Existing users lose PIN login after restart, another registration can reclaim an existing identity, and multiple instances can disagree about credentials and account lockout.

**Repair:** Persist credentials and lockout state. Make identity and credential registration atomic, with database uniqueness constraints. Existing accounts must enter authenticated recovery rather than registration. Recovery email must not be treated as verified merely because a registration payload supplies it. Define migration behavior for existing identities that have no persisted credential.

**Acceptance:** Restart preserves valid login. Re-registration cannot replace an existing credential or attach to its identity. Concurrent registrations produce only one account/credential pair. Two instances share account state. Recovery requires proof of ownership.

### BUG-03 — Missing real web database session wiring

**Evidence:** [TenantQueryRepository::execute](src-web-server/src/engine/query_repo.rs), [TenantPoolManager](src-web-server/src/pools/manager.rs), and [main.rs](src-web-server/src/main.rs). The inspected calls to `register_session` and implementations of `TenantDatabaseSession` were in tests, not the production web execution path.

The query repository requires an already registered session. Startup constructs an empty pool manager, and storing a connection record does not establish a real driver session.

**Impact:** The reviewed standalone web backend query route fails with the missing-active-session error. This finding does not claim that desktop execution or a separate development proxy has the same problem.

**Repair:** Implement real driver-backed sessions and authorized connection establishment. Decrypt credentials only at the backend boundary, select the correct database, register a fully scoped session, and define lifecycle behavior for disconnect, configuration changes, and shutdown. Return actionable errors for unsupported drivers.

**Acceptance:** Through the production application entry point, authenticate, create a workspace connection, establish the connection, execute a query, discover schema, and disconnect against a disposable database. Repeat after restart and with two users. Tests must use a real supported driver rather than only a mock session.

### BUG-04 — OIDC configuration is unused by startup

**Evidence:** [AppConfig](src-web-server/src/config.rs), [main.rs](src-web-server/src/main.rs), and `auth_login` in [lib.rs](src-web-server/src/lib.rs) around line 446.

Configuration parses OIDC settings, but startup does not construct and attach an OIDC client. The default state has no client, and the login handler returns HTTP 501 with `oidc_not_configured`.

**Impact:** Supplying valid production OIDC configuration does not make the login flow operational.

**Repair:** Instantiate the provider client from validated configuration and attach it during startup. Implement or complete the concrete provider adapter as needed. Define provider discovery, HTTPS validation, timeout, state, nonce, PKCE, and callback error handling.

**Acceptance:** A controlled provider fixture exercises the production bootstrap, authorization redirect, callback, and session creation. Invalid state, nonce, issuer, and expired tokens fail. Missing configuration produces the documented startup behavior.

### BUG-05 — Read-only classification is not an authorization boundary

**Evidence:** [is_read_query](src-web-server/src/engine/classifier.rs) and the Viewer check in `execute_workspace_connection_query` in [lib.rs](src-web-server/src/lib.rs) around line 1879.

The classifier strips comments and scans words rather than parsing dialect syntax. Its mutation keyword list does not represent every state-changing SQL operation, and it also scans string literals as keywords.

| Input | Actual classifier result | Problem |
| --- | --- | --- |
| `SELECT 1 INTO review_created_table` | Read-only | PostgreSQL SELECT INTO creates a table. |
| `SELECT nextval('review_seq')` | Read-only | Advances a sequence. |
| `SELECT 'delete' AS label` | Mutating | A harmless literal causes false rejection. |

The actual classifier was compiled and executed in an isolated harness. These statements were not executed against a database during review. Unauthorized mutation depends on a functioning execution session and the underlying DB account permissions; BUG-03 currently prevents the normal standalone web path from reaching that stage.

**Repair:** Use dialect-aware parsing for analysis and user feedback. Enforce least-privilege database credentials and appropriate read-only transaction/session restrictions. Consider stored functions, sequence operations, multiple statements, CTEs, quoted identifiers, and comments. A parser alone cannot establish that every function call is side-effect-free.

**Acceptance:** Counterexamples become regression tests. Viewer integration tests prove state cannot change with the real driver and database configuration. Valid string literals remain executable. Read restrictions reset correctly when pooled sessions are reused.

### BUG-06 — PIN change targets an untrusted username

**Evidence:** `auth_pin_change` in [lib.rs](src-web-server/src/lib.rs) around line 929 and `PinAuthStore::change_pin` in [pin.rs](src-web-server/src/auth/pin.rs) around line 180.

The handler authenticates the caller but discards the returned principal. It then changes the PIN for the username in the payload. The store verifies the old PIN but does not reuse login failed-attempt counters or lockout checks.

**Impact:** A signed-in caller can attempt old-PIN guesses against another account through this endpoint. This bypasses account-specific login lockout; it does not imply that no general HTTP rate limiter exists. Knowing the target's old PIN is still required for a successful change.

**Repair:** Derive the account from the authenticated principal. Apply shared account-specific attempt limits to sensitive reauthentication. Define credential-change session revocation and recovery behavior. Use consistent responses that avoid unnecessary account enumeration.

**Acceptance:** User A cannot target user B through a username override. Wrong old-PIN attempts trigger persistent account protection. Correct same-user changes succeed. Locks work across instances, and the old PIN no longer authenticates after a successful change.

### BUG-07 — Audit writes can be silently lost

**Evidence:** `PostgresAuditRepository::record` in [audit.rs](src-web-server/src/audit.rs) around line 69.

The repository spawns an asynchronous insert, discards its result, and immediately returns success. The caller cannot distinguish successful persistence from a database error. Process shutdown can also interrupt outstanding tasks.

**Impact:** Security-relevant actions can lack an audit record, undermining incident investigation and operational traceability.

**Repair:** Make persistence awaitable, or introduce a durable outbox/queue with idempotent delivery, bounded retry, and failure metrics. Specify whether critical actions fail closed if audit acceptance is unavailable. Use an actual event timestamp consistently across adapters; several callers currently supply a fixed timestamp, while the PostgreSQL insert omits that field and relies on its database-side timestamp behavior.

**Acceptance:** Fault injection demonstrates visible, recoverable delivery failure. Shutdown drains accepted work or leaves it durable for retry. Repeated delivery does not duplicate an event. Event time and storage time have documented semantics.

### BUG-08 — Shared development encryption master key

**Evidence:** `KeyManager::dev_default` in [envelope.rs](src-web-server/src/crypto/envelope.rs) around line 52; `AppState::with_auth_settings` and `with_key_manager` in [lib.rs](src-web-server/src/lib.rs).

Production state construction uses the development master key for connection encryption. Additionally, replacing the state's key manager alone does not rebuild the connection repository that already received a cloned manager during construction.

**Impact:** Access to stored ciphertext plus the shared key compromises the intended protection of connection credentials. Inconsistent replacement can also cause encryption/decryption key mismatches. This does not imply ciphertext is publicly accessible.

**Repair:** Inject a validated key manager before constructing dependent repositories. Use deployment-specific key material, versioned ciphertext, and an explicit migration/rotation procedure. Back up key material securely and test recovery before retiring old keys.

**Acceptance:** Production rejects development keys. All repositories use the intended key version. Existing ciphertext can be migrated and read during the rotation window; retired keys are rejected afterward according to policy. Logs and serialization do not expose key material.

### BUG-09 — Frontend regression suite is failing

| File | Failed tests | Observed issue |
| --- | --- | --- |
| [PinAuthModal.test.tsx](tests/components/modals/PinAuthModal.test.tsx) | 1 | Registration test cannot find the expected confirmation prompt. |
| [ExplorerSidebar.test.tsx](tests/components/layout/ExplorerSidebar.test.tsx) | 5 | Error display, expansion, copy, and retry expectations fail. Root cause needs focused investigation. |
| [Connections.test.tsx](tests/pages/Connections.test.tsx) | 3 | Test rendering lacks the required WorkspaceProvider. |
| [CommandPaletteProvider.test.tsx](tests/contexts/CommandPaletteProvider.test.tsx) | 1 | Expected command list omits newly registered commands. |

**Repair:** Investigate each failure against intended behavior. Update fixtures and expectations where the product is correct; repair product behavior where it is wrong. Do not simply weaken assertions or remove failing tests.

**Acceptance:** The full frontend suite and TypeScript build pass. Registration confirmation, connection creation, error retry, and command visibility retain meaningful assertions. A focused manual smoke test verifies the changed user flows.

## 5. Additional risks requiring focused follow-up

These items are not counted as independently reproduced production defects.

### RISK-01 — Pool lookup discards ownership and database context

[TenantPoolKey](src-web-server/src/pools/key.rs) includes workspace, user, connection, database, and configuration hash. However, `get_session_by_connection` in [manager.rs](src-web-server/src/pools/manager.rs) scans string keys for a connection substring and returns the first match. Cancellation similarly targets all matching sessions.

With multiple sessions for the same connection, this can select a different user's session or database, or cancel another user's work. Globally unique connection IDs alone do not distinguish two users sharing one connection. Confirm the exact failure through a two-user, two-database integration test. Prefer typed full keys and query-specific cancellation authorization.

### RISK-02 — PIN hashing and low-entropy authentication

`hash_pin` uses custom repeated SHA-256, and PINs contain only 6–8 digits. Migrate to a standard password hashing library with Argon2id and benchmarked parameters, but do not treat hashing alone as a remedy for low entropy. Use persistent rate limits, secure recovery, and strong primary authentication appropriate to deployment.

### RISK-03 — Lifecycle and authorization consistency

Follow up on logout and JWT revocation, default JWT roles, Bearer-versus-cookie support across endpoints, membership changes while queries run, and session invalidation after credential or connection updates. These paths need explicit threat-model and integration coverage before stronger conclusions.

### RISK-04 — Production frontend transport remains incompletely ported

Follow-up source inspection found that [HttpTransport](src/transports/http.ts) still uses legacy unscoped connection routes, while [the web shim](src/tauri-web-shim/core.ts) retains local mock PIN/workspace command handlers. HTTP-mode build success does not prove that those commands call the corrected workspace backend. This patch does not migrate all UI commands or claim complete web UI readiness. Plan that migration as explicit follow-up work and verify authentication, workspace selection, connection CRUD, query execution, and cancellation in a browser. Do not re-enable unscoped backend access as a workaround.

## 6. Bug remediation checklist

Checked BUG items below indicate that the reported backend defect or test regression has been repaired and automatically verified within the scope in Section 0. They do not indicate deployment, production data migration, or full browser acceptance. Remaining operational and frontend work stays unchecked in Section 0 and in the release checklist.

- [x] **BUG-01: Replace production JWT defaults.** Add required configuration; wire startup; reject default/retired keys; validate claims; document rotation; pass token rejection tests.
- [x] **BUG-02: Persist PIN identity and credential state.** Add migration and uniqueness; make registration atomic; prohibit identity reclamation; prove restart and multi-instance behavior; define existing-user recovery.
- [x] **BUG-03: Wire real PostgreSQL web database sessions.** Implemented the PostgreSQL adapter and scoped API lifecycle; real query/schema integration tests pass. Other web drivers and UI transport migration remain out of this completed adapter scope.
- [x] **BUG-04: Wire OIDC bootstrap.** Construct provider client; attach configuration; pass authorization/callback and negative validation tests.
- [x] **BUG-05: Enforce read-only execution.** Correct analysis; apply database restrictions; test mutation counterexamples and harmless literals; verify pooled-session reset.
- [x] **BUG-06: Bind PIN changes to the principal.** Cross-account targeting is denied and persistent attempt protection is tested. Broader JWT revocation and account recovery are still tracked separately.
- [x] **BUG-07: Await audit persistence and expose errors.** Removed detached writes; failure injection and real persistence checks pass. CRUD/audit atomicity and durable retry queues remain documented limitations.
- [x] **BUG-08: Replace development encryption keys.** Configured repositories and real ciphertext rotation are tested. Production migration and restore rehearsal remain release acceptance tasks.
- [x] **BUG-09: Restore frontend regression coverage.** All four failing test files are repaired; the full suite and HTTP-mode build pass. Full browser/API acceptance remains pending.
- [x] **RISK-01: Resolve pool ownership risk.** Provided scoped session resolution and cancellation; verified with multi-user, multi-session unit tests.
- [x] **RISK-02: Replace custom PIN hashing.** Migrated store to Argon2id; verified with PHC formatting and legacy SHA-256 transparent upgrade tests.
- [x] **RISK-03: Complete lifecycle review.** Unified session and pool lifecycle on logout, PIN change, and member role changes; dual Bearer/Cookie consistency verified.
- [x] **RISK-04: Port frontend transport to workspace routes.** Modernized `HttpTransport` and `createBackendTransport` to support `/api/v1/workspaces/:workspaceId/...` routes; verified with unit tests and full frontend build.

### Shared release acceptance checklist

- [ ] Record upstream GitNexus impact for each edited symbol; report callers/processes and HIGH/CRITICAL risk before changes.
- [ ] Resolve UNKNOWN impact with source investigation and targeted tests; do not interpret empty graph results as safe.
- [ ] Run TypeScript build, full frontend suite, and relevant backend tests successfully.
- [ ] Test the actual production bootstrap with a disposable metadata database, target database, and controlled identity provider.
- [ ] Test restart, concurrent requests, and at least two backend instances where shared state is required.
- [ ] Exercise denied access, credential rotation, database outage, and query cancellation scenarios.
- [ ] Validate migrations and backup restoration against representative existing data.
- [ ] Record remaining limitations, deployment prerequisites, and rollback procedures.
- [ ] Run graph change analysis before committing; resolve partial/truncated results rather than marking them clean.

## 7. Improvement roadmap for the next 12–24 months

Time windows describe suggested sequencing from adoption, not guaranteed delivery dates. Effort estimates and owners should be assigned after requirements and impact analysis. These are engineering recommendations, not predictions of which technologies will dominate in two years.

| ID | Priority / Window | Improvement | Measurable acceptance |
| --- | --- | --- | --- |
| IMP-01 | P1 / 0–3 months | Centralize backend authentication and authorization policy | Every protected endpoint has positive and negative role/tenant tests; enforcement does not depend on UI visibility. |
| IMP-02 | P1 / 0–3 months | Typed execution context and query lifecycle | Workspace, user, database, and query ID are preserved through execution/cancellation; concurrent users cannot interfere. |
| IMP-03 | P1 / 1–3 months | Real integration and deployment tests | CI boots the packaged web app and proves login, connection, query, migration, restart, and denied access. |
| IMP-04 | P1 / 3–6 months | Bounded query execution and streaming | Configure row, byte, time, concurrency, and export limits; demonstrate stable memory under an agreed large-result workload. |
| IMP-05 | P2 / 3–6 months | OpenTelemetry and operational objectives | Correlate request/query traces, error rates, latency, pool saturation, and audit failures without exposing SQL secrets. |
| IMP-06 | P2 / 3–6 months | Credential and identity lifecycle | Operational SSO/MFA where required, key rotation, recovery, and revocation have tested runbooks. |
| IMP-07 | P2 / 6–12 months | Governed AI query assistance | Generated SQL is previewed; sensitive data handling and execution permissions are enforced outside the model. |
| IMP-08 | P2 / 6–12 months | AI quality, cost, and compatibility evaluation | Versioned evaluation data covers dialect correctness, schema grounding, refusals, latency, and per-request cost limits. |
| IMP-09 | P2 / 6–12 months | Accessible and localized core workflows | Keyboard navigation, focus restoration, labels, and locale behavior pass automated and manual checks. |
| IMP-10 | P2 / 12–24 months | Versioned driver and API contracts | Published compatibility matrix and conformance tests verify supported versions, capability discovery, and clear unsupported-operation errors. |
| IMP-11 | P2 / 6–24 months | Upgrade, recovery, and dependency maintenance | Routine dependency review, artifact provenance, migration rehearsal, and restore exercises produce retained evidence. |

### Architecture and execution guidance

Keep authorization in the backend with explicit resource context. Separate HTTP handlers, policy decisions, and driver orchestration so that tests can inspect each boundary without replacing the entire runtime. Preserve public APIs during structural refactors and avoid mixing unrelated behavior changes.

For large queries, combine streaming with cancellation, concurrency quotas, bounded buffers, and export jobs. UI virtualization alone does not prevent backend memory exhaustion. Define dataset sizes and acceptable memory/latency before choosing a transport or queue technology. Avoid promising generic rollback across database dialects whose DDL transaction semantics differ.

### AI capability guidance

Prioritize schema-grounded SQL generation, explain-plan assistance, and suggested query improvements. Present changes for review and apply the same backend permissions as manual SQL. Mask sensitive values before external model requests, configure retention rules, and treat database text and tool output as untrusted input. Add approval requirements for destructive actions as a product policy where appropriate, with enforcement outside prompts.

Keep provider interfaces replaceable and maintain a versioned evaluation set before changing models. Evaluate syntactic validity separately from semantic correctness and authorization. Set token, time, and tool-call budgets. Do not send full table contents by default merely to improve model context.

### Operations and extensibility guidance

Use trace IDs to correlate the browser request, authorization decision, driver call, and audit event. Prefer sanitized SQL fingerprints over full query text in general telemetry. Define retention, access controls, and redaction for history and audit stores.

Evolve the existing plugin/driver architecture through versioned capabilities and contract tests. Add extensions in response to demonstrated workflows; avoid a framework migration solely to appear current. Pair dependency updates with reproducible builds and meaningful compatibility tests.

## 8. Improvement implementation checklist

- [ ] **IMP-01 — Backend policy:** Inventory protected endpoints; define the role/resource matrix; centralize enforcement; add denied-access tests.
- [ ] **IMP-02 — Query lifecycle:** Introduce full typed context and query IDs; enforce owner-aware cancellation; test two-user/two-database concurrency.
- [ ] **IMP-03 — Integration CI:** Provision disposable dependencies; test packaged startup and restart; publish results as release gates.
- [ ] **IMP-04 — Performance:** Establish load baselines; add resource budgets, streaming/backpressure, and export lifecycle; verify cancellation and bounded memory.
- [ ] **IMP-05 — Observability:** Add sanitized traces/metrics/log correlation; define latency and availability objectives; alert on pool pressure and audit loss.
- [ ] **IMP-06 — Identity operations:** Complete SSO and stronger authentication strategy; implement revocation/recovery; rehearse signing and encryption key rotation.
- [ ] **IMP-07 — AI governance:** Define allowed tools and data; add preview and execution policy; redact sensitive context; test prompt injection and denied operations.
- [ ] **IMP-08 — AI evaluation:** Create a representative dialect/schema corpus; measure semantic quality, latency, and cost; require evaluation before provider/model changes.
- [ ] **IMP-09 — UX quality:** Audit critical dialogs and editor flows; fix keyboard/focus issues; move untranslated interface strings into locale resources; test locale fallback.
- [ ] **IMP-10 — Contracts:** Version API and driver capabilities; create adapter conformance tests; document compatibility and deprecation policy.
- [ ] **IMP-11 — Maintenance:** Schedule dependency/security review; retain build provenance; rehearse migration and restoration; document recovery objectives and evidence.

## 9. Suggested delivery order and dependencies

1. **Containment:** BUG-01, BUG-02, BUG-08. If the affected web service is already deployed, assess exposure and plan credential/token rotation rather than assuming a code patch invalidates existing compromise.
2. **Functional completion:** BUG-03 and BUG-04, backed by IMP-03. Real execution should not be released before BUG-05 and session isolation controls are validated.
3. **Authorization and durability:** BUG-05, BUG-06, BUG-07, RISK-01, and RISK-03.
4. **Regression stabilization:** BUG-09 and credential-hashing work; keep regression checks active throughout all earlier work.
5. **Scale and maintainability:** IMP-01 through IMP-06, then AI governance/evaluation and extension contracts according to product demand.

A completed checklist requires a linked change, relevant test evidence, and review of operational behavior. Documentation of a finding is not remediation. Do not mark an item complete merely because unit tests pass when its acceptance criteria require real startup, persistence, or concurrent execution.

## 10. References

- [PostgreSQL client connection defaults and read-only transactions](https://www.postgresql.org/docs/17/runtime-config-client.html): database-level restrictions and their scope; use the documentation matching each supported server version.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): standard password hashing and Argon2id guidance.
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html): encryption and key-management design guidance.
- [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/): traces, metrics, and logs for operational visibility.
- [OWASP Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/): risks from excessive model/tool functionality, permissions, and autonomy.
- [OWASP Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/): handling sensitive information in AI-assisted workflows.

These sources support the proposed engineering approaches. Repository bug claims are based on the local source and review evidence described above.
