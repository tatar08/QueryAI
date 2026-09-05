# Tabularis Multi-user Web App Improvement Plan

## 1. เป้าหมาย

พัฒนา Tabularis จากแอป Desktop แบบผู้ใช้คนเดียวให้รองรับการใช้งานผ่าน Browser แบบ deploy ได้และมีผู้ใช้หลายคน โดยยังรักษา Desktop application เดิมไว้ และใช้ database drivers กับ query engine ร่วมกันระหว่าง Desktop และ Web

เป้าหมายหลัก:

- ใช้งานผ่าน Browser โดยไม่พึ่ง Tauri runtime
- รองรับผู้ใช้ ทีม และ Workspace หลายชุด
- ป้องกันการเข้าถึง Connections และข้อมูลข้าม Tenant
- จัดเก็บ Database credentials อย่างปลอดภัย
- รองรับการขยายระบบ การตรวจสอบย้อนหลัง และการดูแล Production
- ไม่ทำให้ Desktop application เดิมเกิด Regression

## Progress checklist

อัปเดตล่าสุด: 2026-09-04

สถานะโดยรวม: **ยังไม่เสร็จ** — Phase 0 เสร็จแล้ว, Phase 1 และ Phase 2 เริ่มดำเนินการแล้ว โดยมี Shared Connection/Schema/Query/Audit service boundaries, Web adapters, Metadata PostgreSQL และ Secure server-session foundation แล้ว แต่ OIDC login callback, Authorization/RBAC, Tenant-scoped repositories, Production HTTP database API และ Browser database connectivity ยังไม่พร้อมใช้งาน

| Phase | สถานะ | ความคืบหน้า |
|---|---|---|
| Phase 0 — Architecture and security baseline | Done | ADR, Threat model และ Feature matrix พร้อมแล้ว |
| Phase 1 — Extract reusable core services | In progress | สร้าง Shared Core crate และให้ Desktop/Web ใช้ Connection validation, Schema discovery ทุก list resource, Query execution, Cancellation และ Audit boundaries ร่วมกัน พร้อมแยก Connection CRUD persistence, Frontend Transport และ Platform UI adapter แล้ว แต่ Tauri side effects อื่นยังแยกไม่ครบ |
| Phase 2 — Authentication and multi-tenancy | In progress | เพิ่ม PostgreSQL schema, migration runner, metadata readiness, OIDC production config และ Secure session lifecycle foundation แล้ว แต่ OIDC login callback, tenant repositories และ RBAC ยังไม่เสร็จ |
| Phase 3 — Secure connection management | Pending | ยังไม่เริ่ม Implementation |
| Phase 4 — Web MVP | Pending | มี Query HTTP contract แบบ injectable/fail-closed แล้ว แต่ Browser ยังเชื่อมต่อฐานข้อมูลจริงไม่ได้ |
| Phase 5 — Collaboration and governance | Pending | ยังไม่เริ่ม Implementation |
| Phase 6 — Production hardening | Pending | ยังไม่เริ่ม Implementation |

### งานที่เสร็จแล้ว

- [x] จัดทำ Improvement plan สำหรับ Multi-user Web App
- [x] สร้าง ADR สำหรับ Shared Core services และ Tauri/HTTP adapters
- [x] สร้าง ADR สำหรับ OIDC identity และ Workspace tenancy
- [x] จัดทำ Web threat model
- [x] จัดทำ Desktop/Web feature matrix
- [x] สร้าง Rust Web server crate ด้วย Axum
- [x] เพิ่ม Development/Production environment validation
- [x] บังคับ Production public origin ให้ใช้ HTTPS
- [x] เพิ่ม `/health/live` และ `/health/ready`
- [x] เพิ่ม PostgreSQL metadata schema ครบ 10 ตารางตาม Phase 2
- [x] เพิ่ม SQLx MetadataStore, connection pool และ startup migration runner
- [x] บังคับ Production ให้กำหนด Metadata database URL และตรวจขนาด pool
- [x] ให้ `/health/ready` ตรวจ Metadata PostgreSQL และคืน `503` เมื่อไม่พร้อม
- [x] เพิ่ม Web server unit tests จำนวน 35 รายการ (35 passed, 0 failed)
- [x] เพิ่ม OIDC environment contract และบังคับ Production ให้กำหนด Issuer, Client ID, Client secret และ HTTPS redirect URI
- [x] เพิ่ม Session TTL validation ช่วง 5 นาทีถึง 30 วัน และบังคับ `Secure` cookie ใน Production
- [x] สร้าง Injectable `SessionRepository`, `AuthService` และ PostgreSQL session adapter
- [x] สร้าง Opaque session token ด้วย CSPRNG และเก็บเฉพาะ SHA-256 hash ใน Metadata PostgreSQL
- [x] ตรวจ Session expiration/revocation ฝั่ง Server และอัปเดต `last_seen_at`
- [x] เพิ่ม `GET /api/v1/session` ที่ Resolve identity จาก trusted server session
- [x] เพิ่ม `POST /api/v1/logout` ที่ Revoke session และล้าง `HttpOnly`, `SameSite=Lax` cookie
- [x] ปิดบัง OIDC client secret จาก Debug output และไม่ส่งรายละเอียด Session repository error กลับ Browser
- [x] เพิ่ม Secure session/config/HTTP contract tests 13 รายการ
- [x] ทำ GitNexus impact analysis ก่อนแก้ `test_connection`
- [x] ตรวจพบและหลีกเลี่ยงการย้าย `driver_for` ซึ่งมี Critical blast radius
- [x] แยก File preflight และ Driver connection test เป็น Core service ที่ไม่ผูกกับ Tauri
- [x] เพิ่ม Connection service tests จำนวน 2 รายการ
- [x] แยก pure logic สำหรับสร้าง อัปเดต และลบ SavedConnection ออกจาก Tauri commands
- [x] เพิ่ม Connection CRUD service tests จำนวน 5 รายการ
- [x] สร้าง `ConnectionRepository` และ `ConnectionCredentialStore` interfaces ที่ไม่ผูกกับ Tauri
- [x] แยก Credential, Filesystem และ Persistence orchestration ของ Connection save/update/delete เป็น Core service
- [x] ให้ Tauri Connection CRUD commands ใช้ Desktop repository/credential adapters และคง command signatures เดิม
- [x] เพิ่ม Connection persistence service tests จำนวน 8 รายการโดยไม่เปิด Tauri runtime
- [x] สร้าง `tabularis-core` crate ที่ไม่ผูกกับ Tauri หรือ Axum
- [x] ให้ Desktop persistence และ Web server เรียก `ConnectionService` validation ชุดเดียวกัน
- [x] เพิ่ม `POST /api/v1/connections/validate` พร้อมจำกัด Request body 16 KiB และ Error code แบบมีโครงสร้าง
- [x] เพิ่ม Shared Core validation tests จำนวน 5 รายการ และ Web contract tests จำนวน 3 รายการ
- [x] ทำให้ Web server เรียก Core services ร่วมกับ Desktop ได้
- [x] สร้าง Shared `SchemaService`, typed `SchemaResource` และ generic `SchemaRepository<T>` boundary
- [x] ให้ Desktop `get_schemas` และ `get_available_databases` delegate ผ่าน Shared SchemaService โดยใช้ Driver logic เดิม
- [x] เพิ่ม `GET /api/v1/connections/{connection_id}/schema` พร้อม Injectable Web repository
- [x] ให้ Web Schema repository ค่าเริ่มต้น Fail closed ด้วย `503` จนกว่า Authenticated tenant pool จะพร้อม
- [x] เพิ่ม Shared SchemaService tests จำนวน 4 รายการ, Desktop adapter tests 3 รายการ และ Web contract tests 2 รายการ
- [x] แยก `SchemaService` boundary และเชื่อม Schema discovery adapter ระหว่าง Desktop/Web โดยไม่ทำ Driver logic ซ้ำ
- [x] ขยาย Desktop `SchemaRepository<T>` adapter ให้รองรับ `TableInfo`, `ViewInfo`, `RoutineInfo` และ `TriggerInfo`
- [x] ให้ Desktop `get_tables`, `get_views`, `get_materialized_views`, `get_routines` และ `get_triggers` delegate ผ่าน Shared SchemaService โดยคง Tauri signatures และ logging เดิม
- [x] เพิ่ม SQLite integration test สำหรับ Shared SchemaService ที่ตรวจ Tables, Views, Materialized Views, Routines และ Triggers ผ่าน Driver จริง
- [x] สร้าง Shared `QueryService`, `QueryRepository<T>` และ `QueryCancellationRepository` boundaries
- [x] ย้าย Query normalization และ default page policy ไปไว้ใน Shared QueryService โดยคงพฤติกรรม Desktop เดิม
- [x] ให้ Desktop `execute_query` delegate ผ่าน Shared QueryService/Driver adapter และคง abort-handle lifecycle เดิม
- [x] ให้ Desktop `cancel_query` delegate ผ่าน Shared Cancellation boundary และยังยกเลิก Query/Explain ที่ใช้ Connection เดียวกันทั้งหมด
- [x] เพิ่ม `POST /api/v1/connections/{connection_id}/queries` และ `DELETE /api/v1/connections/{connection_id}/queries` พร้อม Injectable Web repositories
- [x] ให้ Web Query execution/cancellation repositories ค่าเริ่มต้น Fail closed ด้วย `503` จนกว่า Authenticated tenant pool จะพร้อม
- [x] เพิ่ม Shared QueryService tests 8 รายการ, Desktop query normalization tests 2 รายการ และ Web Query/Cancellation contract tests 4 รายการ
- [x] สร้าง Shared `AuditService`, generic `AuditRepository<M>` และ typed `AuditScope` boundary
- [x] แยก Desktop session scope ออกจาก Workspace scope โดยไม่สร้าง Tenant ปลอมให้ Desktop
- [x] บังคับ Workspace audit scope ให้มีทั้ง `workspace_id` และ `actor_user_id` ก่อนเรียก repository
- [x] ให้ MCP Desktop audit delegate ผ่าน Shared AuditService/adapter โดยคง AI Activity JSONL contract และ rotation เดิม
- [x] เพิ่ม Web `WorkspaceAuditContext` adapter สำหรับรับ Tenant/Actor จาก trusted authentication layer โดยยังไม่เปิด Public audit endpoint
- [x] เพิ่ม Shared AuditService tests 6 รายการ, Desktop audit adapter tests 2 รายการ และ Web workspace audit contract tests 3 รายการ
- [x] สร้าง Connection-focused `BackendTransport` interface สำหรับ Frontend
- [x] แยก `TauriTransport` และ `HttpTransport` implementations
- [x] ให้ HTTP transport ใช้ Session cookie/CSRF และไม่ส่ง Credential ซ้ำตอนทดสอบ Saved connection
- [x] เพิ่ม Runtime transport selector ผ่าน `VITE_TABULARIS_BACKEND_MODE=tauri|http`
- [x] เชื่อม DatabaseProvider Connection catalogue และ Saved connection test ผ่าน `BackendTransport`
- [x] ย้าย DatabaseProvider schema discovery ทั้ง databases, schemas, tables, views, materialized views, routines และ triggers ผ่าน `BackendTransport`
- [x] เพิ่ม Tauri/HTTP schema discovery contract พร้อมตรวจ Connection ID, Schema และ Query parameter encoding
- [x] ย้าย DatabaseProvider Connection Group CRUD, nested path, move และ reorder operations ผ่าน `BackendTransport`
- [x] เพิ่ม Tauri/HTTP Connection Group contract พร้อม JSON body, CSRF และ ID encoding tests
- [x] ย้าย DatabaseProvider driver manifest, connection session, schema/database preferences, last-open/last-active และ client event calls ผ่าน `BackendTransport`
- [x] เพิ่ม Tauri/HTTP session และ persistence contract พร้อม CSRF, JSON body และ ID encoding tests
- [x] แยก Window title เป็น Platform UI adapter โดย Desktop ใช้ Tauri และ Browser ใช้ `document.title`
- [x] เชื่อม DatabaseProvider และ Editor ให้เปลี่ยน Window title ผ่าน Platform UI adapter
- [x] เพิ่ม Platform UI adapter tests จำนวน 3 รายการ
- [x] เพิ่ม `.env.web.example` และผ่าน Production HTTP-mode build
- [x] เพิ่ม Transport tests จำนวน 22 รายการ พร้อมผ่าน ESLint และ TypeScript typecheck
- [x] รัน Frontend regression suite ล่าสุด: 239 test files, 3,898 passed, 0 failed
- [x] รัน Shared Core regression suite ล่าสุด: 23 passed, 0 failed
- [x] รัน Rust library regression suite ล่าสุด: 1,189 passed, 4 ignored, 0 failed
- [x] รัน Production Rust `cargo check --lib` ผ่านโดยไม่มี Warning
- [x] ตรวจสอบ Diff และแก้ Formatting noise ที่ไม่เกี่ยวข้องแล้ว

### งานที่กำลังทำ

- [ ] OIDC Authorization Code + PKCE login/callback, Discovery/JWKS และ ID token validation
- [ ] เชื่อม OIDC identity provisioning เข้ากับ Secure server session ที่สร้างแล้ว
- [ ] เพิ่ม Logout จากทุกอุปกรณ์และ OIDC provider logout เมื่อ Provider รองรับ

### งานที่ยังไม่เริ่มหรือยังไม่เสร็จ

- [ ] Users, Workspaces, Memberships และ RBAC
- [ ] Tenant-scoped repositories และ Cross-tenant tests
- [ ] Envelope encryption และ Key rotation สำหรับ Credentials
- [ ] Tenant-aware Connection pool manager
- [ ] Connections REST API
- [ ] เชื่อม Schema discovery REST API กับ Authenticated tenant-aware repository และ database pools จริง
- [ ] เชื่อม Query execution/cancellation HTTP contract กับ Authenticated tenant-aware pools และเพิ่ม Streaming API
- [ ] ลบการพึ่ง Demo connections สำหรับ Production web mode
- [ ] Query history, Saved queries และ Audit events แบบ Multi-user
- [ ] สร้าง PostgreSQL `AuditRepository` และผูก Workspace audit context จาก Authenticated server session
- [ ] Rate limiting, Quotas, CSRF, CORS และ Security headers
- [ ] Docker Compose และ Production deployment stack
- [ ] Backup/restore และ Operational runbooks
- [ ] Security, Load และ Tenant-isolation tests
- [ ] รัน PostgreSQL migration integration test ใน CI หรือ environment ที่มี database credentials
- [ ] ผ่าน Definition of Done ทุกข้อในหัวข้อ 12

## 2. สถานะปัจจุบัน

Tabularis ยังเป็น Desktop-first application:

- React frontend เรียก Rust backend ผ่าน Tauri `invoke`
- มี Tauri commands ประมาณ 255 รายการ และจุดเรียก `invoke` ประมาณ 374 จุด
- Connections จัดเก็บในไฟล์ JSON สำหรับผู้ใช้คนเดียว
- Password และ secrets ใช้ OS keychain
- Connection pools เป็น Global map และใช้ `connection_id` เป็นส่วนหนึ่งของ Pool key
- ยังไม่มี HTTP API, Authentication, Workspace หรือ Tenant isolation
- Web Shim ปัจจุบันมีไว้สำหรับ UI preview และไม่รองรับการเชื่อมต่อฐานข้อมูลจริง

ไม่ควรแปลง Tauri commands ทั้งหมดเป็น HTTP endpoints แบบหนึ่งต่อหนึ่ง เพราะจะทำให้ API มีขนาดใหญ่ ผูกกับรายละเอียด Desktop และตรวจสอบ Authorization ได้ยาก

## 3. สถาปัตยกรรมเป้าหมาย

```text
Browser
   │ HTTPS / WebSocket
   ▼
React Web App
   │
   ▼
Rust API Server (Axum)
   ├── Authentication / Session
   ├── Workspace RBAC
   ├── Connection Service
   ├── Query Service
   ├── Schema Service
   ├── Audit Service
   └── Tenant-aware Pool Manager
          │
          ├── PostgreSQL / MySQL
          ├── Managed SQLite
          └── Driver Plugins

Metadata PostgreSQL
   ├── Users
   ├── Workspaces
   ├── Memberships
   ├── Connections
   ├── Encrypted credentials
   └── Audit logs
```

Desktop และ Web ต้องใช้ Core services ชุดเดียวกัน:

```text
Tauri Commands ─┐
                ├── Core Services ── Database Drivers
HTTP Handlers ──┘
```

## 4. Technical decisions ที่แนะนำ

- **Authentication:** Generic OIDC เพื่อรองรับ Keycloak, Auth0, Azure AD และ Google Workspace
- **Session:** Secure, HttpOnly และ SameSite cookie โดยไม่เก็บ Access token ใน `localStorage`
- **Tenant model:** ผู้ใช้อยู่ใน Workspace และ Connections แชร์ภายใน Workspace
- **Roles:** `owner`, `admin`, `editor` และ `viewer`
- **Metadata database:** PostgreSQL
- **Web backend:** Rust และ Axum
- **Deployment:** เริ่มจาก Docker Compose และเพิ่ม Kubernetes ภายหลัง
- **API:** REST สำหรับ CRUD และ WebSocket หรือ SSE สำหรับ Query progress, streaming และ cancellation
- **Secrets:** Envelope encryption ด้วย AES-256-GCM โดย Master key มาจาก Secret manager หรือ Deployment secret
- **Frontend integration:** ใช้ Transport abstraction แยก Tauri IPC ออกจาก HTTP API

## 5. แผนการส่งมอบ

### Phase 0 — Architecture and security baseline

งาน:

- สร้าง Architecture Decision Records สำหรับ Web architecture และ Tenant model
- จัดทำ Threat model ครอบคลุม Credentials, Query execution, SSRF และ Cross-tenant access
- กำหนด Feature matrix ระหว่าง Desktop และ Web
- ตรวจสอบและจัดการ Local changes ใน `vite.config.ts`, `src/tauri-web-shim/` และ `src-tauri/Cargo.lock`
- กำหนด API versioning, Error format และ Observability conventions
- กำหนด Data classification และ Retention policy

เกณฑ์สำเร็จ:

- Architecture และ Security requirements ได้รับการอนุมัติ
- มีรายการ Feature ที่อยู่และไม่อยู่ใน MVP ชัดเจน
- มี Test strategy สำหรับ Tenant isolation

### Phase 1 — Extract reusable core services

งาน:

- แยก Business logic ออกจาก `#[tauri::command]`
- สร้าง `ConnectionService`, `QueryService`, `SchemaService` และ `AuditService`
- ให้ Tauri commands เป็น Adapter บาง ๆ ที่เรียก Core services
- ปรับ Functions ที่รับ `AppHandle` ให้ใช้ Dependencies ผ่าน Traits
- แยก Filesystem, Keychain, Window events และ Tauri event emitter ออกจาก Domain logic
- เพิ่ม Unit tests ให้ Core services โดยไม่ต้องเปิด Tauri runtime

เกณฑ์สำเร็จ:

- Desktop application ยังทำงานและผ่าน Regression tests
- Core services เรียกใช้จาก Test harness ที่ไม่ใช้ Tauri ได้
- Database drivers และ Query engine ไม่ซ้ำซ้อนระหว่าง Desktop กับ Web

### Phase 2 — Authentication and multi-tenancy

เพิ่ม Metadata schema:

- `users`
- `workspaces`
- `workspace_members`
- `connections`
- `connection_credentials`
- `user_preferences`
- `saved_queries`
- `query_history`
- `audit_events`
- `sessions`

ข้อกำหนด:

- ทุก Tenant-owned entity ต้องมี `workspace_id`
- ทุก Request ต้อง Resolve Workspace จาก Authenticated session
- Backend ต้องตรวจ Membership และ Role ทุกครั้ง
- ห้ามเชื่อถือ `workspace_id`, `user_id` หรือ Role ที่ Browser ส่งมาโดยไม่ตรวจสอบ
- เพิ่ม Session revocation, expiration และ Logout จากทุกอุปกรณ์

สิทธิ์เบื้องต้น:

| Action | Owner | Admin | Editor | Viewer |
|---|---:|---:|---:|---:|
| Manage workspace | ✓ | – | – | – |
| Manage members | ✓ | ✓ | – | – |
| Manage connections | ✓ | ✓ | ✓ | – |
| Execute read query | ✓ | ✓ | ✓ | ✓ |
| Execute write query | ✓ | ✓ | ✓ | – |
| View audit logs | ✓ | ✓ | – | – |

เกณฑ์สำเร็จ:

- ผู้ใช้ไม่สามารถอ่านหรือเปลี่ยนข้อมูลข้าม Workspace ได้
- มี Automated tests สำหรับ IDOR และ Cross-tenant access ทุก Resource
- Session cookie ผ่าน Security review

### Phase 3 — Secure connection management

งาน:

- ย้าย Connection persistence จาก JSON ไป PostgreSQL
- เข้ารหัส Password, Connection URI, SSH keys และ Certificates ก่อนบันทึก
- ห้ามส่ง Credential กลับไปยัง Browser หลังบันทึกแล้ว
- รองรับ Key rotation และ Credential re-encryption
- ทำ Pool manager ให้รับ Tenant context
- จำกัดจำนวน Pools, Connections และ Concurrent queries ต่อ Workspace
- ปิด Idle pools อัตโนมัติ
- เพิ่ม Connection health monitoring ที่ไม่เปิดเผย Secret
- เพิ่ม SSRF policy สำหรับ Network destinations
- จำกัด SQLite ให้ใช้เฉพาะไฟล์ใน Managed storage

Pool key ขั้นต่ำ:

```text
workspace_id:user_id:connection_id:database:security_config_hash
```

สำหรับ Shared pool อาจตัด `user_id` ออกได้เฉพาะเมื่อ Connection policy ระบุชัด และ Database identity เหมือนกันจริง

เกณฑ์สำเร็จ:

- ไม่มี Plaintext credential ใน Metadata database, Logs หรือ API responses
- Pool ของ Tenant หนึ่งไม่ถูกนำไปใช้กับอีก Tenant
- Admin สามารถ Revoke credential และปิด Pool ที่เกี่ยวข้องได้

### Phase 4 — Web MVP

ฟังก์ชันที่รวมใน MVP:

- Login และ Logout
- Workspace selection
- Connection CRUD
- Test, Connect และ Disconnect
- Connection groups และ Tags
- List databases, Schemas, Tables, Views และ Columns
- SQL editor
- Execute และ Cancel query
- Paginated หรือ Streamed query results
- Query history แยกตามผู้ใช้
- Production write confirmation
- Basic audit log
- Session expiration และ Reconnect handling

Frontend changes:

- สร้าง `BackendTransport` interface
- เพิ่ม `TauriTransport` สำหรับ Desktop
- เพิ่ม `HttpTransport` สำหรับ Browser
- ย้าย Components ออกจากการเรียก `invoke` โดยตรงทีละ Domain
- ใช้ Typed request/response contracts ร่วมกัน
- เลิกใช้ Web Shim เป็น Production backend

ไม่รวมใน MVP:

- Plugin installation ผ่าน Browser
- MCP server integration
- Arbitrary local filesystem access
- Native notifications
- SSH Askpass UI
- Kubernetes port-forward
- Native multi-window features
- Desktop feature parity ทั้งหมด

### Phase 5 — Collaboration and governance

งาน:

- Workspace invitations
- Connection-level permissions
- Shared saved queries และ Notebooks
- Audit log สำหรับ Login, Permission changes, Connection changes และ Query execution
- Active user และ Active query visibility
- Session และ Pool administration
- Query approval flow สำหรับ Production
- Data retention และ Audit export

เกณฑ์สำเร็จ:

- Admin ตรวจสอบได้ว่าใครทำอะไร เมื่อไร และกับ Connection ใด
- Permission changes มีผลทันทีหรือภายในระยะเวลาที่กำหนด
- Query ที่ต้อง Approval ไม่สามารถข้าม Workflow ผ่าน API ได้

### Phase 6 — Production hardening

งาน:

- Rate limiting ต่อ User, Workspace และ IP
- Query timeout, Row limit, Payload limit และ Concurrency limit
- WebSocket authentication, Heartbeat และ Reconnect handling
- CSRF, CORS, Content Security Policy และ Security headers
- Structured logs, Metrics และ Distributed tracing
- Health และ Readiness endpoints
- Database migrations และ Automated backups
- Container ทำงานแบบ Non-root และใช้ Read-only filesystem เท่าที่ทำได้
- CI security scanning และ Dependency audit
- Integration tests ด้วย PostgreSQL และ MySQL จริง
- Load tests สำหรับ Pool exhaustion และ Large result sets
- Tenant-isolation penetration tests
- Incident response และ Credential rotation runbooks

ข้อสำคัญ: SQL classification ไม่ควรถูกใช้เป็น Security boundary เพียงอย่างเดียว สำหรับ Viewer ควรใช้ Database account แบบ Read-only หรือ Database-native permissions ร่วมด้วย

## 6. MVP API surface

```text
GET    /api/v1/session
POST   /api/v1/logout
GET    /api/v1/workspaces
GET    /api/v1/workspaces/:workspaceId/members

GET    /api/v1/connections
POST   /api/v1/connections
GET    /api/v1/connections/:connectionId
PATCH  /api/v1/connections/:connectionId
DELETE /api/v1/connections/:connectionId
POST   /api/v1/connections/:connectionId/test
POST   /api/v1/connections/:connectionId/connect
DELETE /api/v1/connections/:connectionId/session

GET    /api/v1/connections/:connectionId/databases
GET    /api/v1/connections/:connectionId/schema
POST   /api/v1/connections/:connectionId/queries
DELETE /api/v1/queries/:executionId

GET    /api/v1/query-history
GET    /api/v1/audit-events
WS     /api/v1/events
```

API responses ต้องไม่ส่ง Password, Private key, Connection URI หรือ Encryption metadata ที่ช่วยโจมตีระบบกลับไปยัง Client

## 7. Testing strategy

### Unit tests

- Core service authorization
- Tenant-scoped repositories
- Secret encryption และ Key rotation
- Pool key generation
- Query limits และ Cancellation
- Error sanitization

### Integration tests

- OIDC login และ Session lifecycle
- Connection CRUD และ Permission checks
- PostgreSQL/MySQL connection tests
- Query execution, Pagination, Streaming และ Cancellation
- Metadata migrations
- Audit event creation

### Security tests

- Cross-tenant IDOR
- Role escalation
- CSRF และ CORS bypass
- SSRF ผ่าน Database host และ SSH/Kubernetes configuration
- Secret leakage ผ่าน Errors, Logs และ Telemetry
- WebSocket session reuse
- Resource exhaustion และ Slow queries

### Regression tests

- Desktop connection flows
- Existing Database drivers
- Query editor และ Results grid
- Import/export compatibility
- Connection migration จาก Desktop เมื่อ Feature นี้ถูกเพิ่มภายหลัง

## 8. Observability และ Operations

Metrics ขั้นต่ำ:

- HTTP request rate, Latency และ Error rate
- Active users และ Active sessions
- Active pools และ Connections ต่อ Workspace
- Query duration, Cancellation และ Timeout count
- Rows และ Bytes returned
- Authentication และ Authorization failures
- Secret decryption failures
- Background job failures

Logs ต้องมี `request_id`, `user_id`, `workspace_id`, `connection_id` และ `execution_id` เมื่อเกี่ยวข้อง แต่ห้ามบันทึก SQL parameters หรือ Credentials โดยค่าเริ่มต้น

## 9. Deployment roadmap

### Initial deployment

- Docker Compose
- React static assets
- Rust API server
- PostgreSQL metadata database
- HTTPS reverse proxy
- External OIDC provider
- Backup storage

### Scale-out deployment

- Kubernetes หรือ Managed container platform
- Central Secret manager
- Shared session store หากไม่ใช้ Stateless session
- Distributed rate limiting
- Query workers แยกจาก API process
- PgBouncer สำหรับ Metadata database
- Object storage สำหรับ Managed SQLite, Exports และ Notebooks

## 10. Quality gates ก่อน Production

- Desktop regression suite ผ่าน
- HTTP contract tests ผ่าน
- Cross-tenant tests ผ่านทุก Endpoint
- Credential encryption และ Rotation tests ผ่าน
- Query cancellation และ Timeout ทำงานจริง
- Pool exhaustion ไม่ทำให้ระบบทั้งหมดล่ม
- ไม่มี Secret ใน Responses, Logs หรือ Telemetry
- Backup/restore drill สำเร็จ
- OIDC logout และ Session revocation ทำงาน
- Container และ Dependency security scan ผ่านเกณฑ์
- Security review ก่อนเปิด SSH หรือ Kubernetes features

## 11. ระยะเวลาโดยประมาณ

สำหรับทีม 2–3 คน:

| ระยะ | เวลาโดยประมาณ |
|---|---:|
| Phase 0: Architecture and security baseline | 1–2 สัปดาห์ |
| Phase 1: Core service extraction | 2–3 สัปดาห์ |
| Phase 2: Authentication and multi-tenancy | 2–3 สัปดาห์ |
| Phase 3: Secure connection management | 2–3 สัปดาห์ |
| Phase 4: Web MVP | 4–6 สัปดาห์ |
| Phase 5: Collaboration and governance | 2–4 สัปดาห์ |
| Phase 6: Production hardening | 3–4 สัปดาห์ |

MVP ที่พร้อมใช้งาน Production ใช้เวลาประมาณ 12–17 สัปดาห์เมื่อบาง Phase ทำคู่ขนานกัน ส่วน Feature parity กับ Desktop ควรพัฒนาต่อเป็นราย Feature หลังจาก MVP มี Security และ Operational baseline ที่มั่นคงแล้ว

## 12. Definition of Done สำหรับ Web MVP

- ผู้ใช้ Login ผ่าน OIDC และเลือก Workspace ได้
- Owner/Admin จัดการสมาชิกและ Connections ได้ตามสิทธิ์
- Credentials ถูกเข้ารหัสและไม่ถูกส่งกลับ Browser
- Editor เชื่อมต่อและ Query PostgreSQL/MySQL ผ่าน Browser ได้
- Viewer ใช้งานได้เฉพาะสิทธิ์ Read-only ที่กำหนด
- Query สามารถ Cancel และถูกหยุดเมื่อเกิน Timeout หรือ Limit
- ทุก Resource และ Connection pool แยกตาม Tenant
- การกระทำสำคัญถูกบันทึกใน Audit log
- Deploy และ Upgrade ผ่าน Automated migrations ได้
- Backup และ Restore Metadata database ผ่านการทดสอบ
- Desktop application เดิมยังผ่าน Regression tests
