# Tabularis Production Operational Runbook

This runbook outlines operational procedures, configuration guidelines, disaster recovery routines, and key rotation workflows for the multi-user Tabularis Web Application.

---

## 1. System Architecture Overview

```text
       Browser (HTTPS)
             │
             ▼
   Caddy Reverse Proxy (:443)
      │                     │
      │ /                   │ /api/*
      ▼                     ▼
Static React Assets   tabularis-web-server (:3000)
                            │
                            ▼
              Metadata Database (PostgreSQL 16)
```

- **Reverse Proxy (Caddy)**: Terminates TLS, enforces security headers (`X-Content-Type-Options`, `X-Frame-Options`, `CSP`), compresses assets (`zstd`, `gzip`), and proxies API requests.
- **Web Server (`tabularis-web-server`)**: Rust Axum daemon running as non-root user `tabularis` (UID 10001).
- **Metadata Database**: PostgreSQL 16 storing tenant workspaces, users, memberships, encrypted credentials, query history, saved queries, and audit events.

---

## 2. Environment Configuration

| Variable | Description | Default | Required in Prod |
|---|---|---|---|
| `TABULARIS_ENVIRONMENT` | Deployment environment (`production` / `development`) | `development` | Yes (`production`) |
| `TABULARIS_BIND_ADDRESS` | Internal socket bind address | `127.0.0.1:3000` | Yes (`0.0.0.0:3000`) |
| `TABULARIS_PUBLIC_ORIGIN` | Public-facing HTTPS origin | `http://localhost:5173` | Yes (`https://...`) |
| `TABULARIS_ALLOWED_ORIGINS` | Comma-separated allowed CORS origins | Same as `PUBLIC_ORIGIN` | Optional |
| `TABULARIS_METADATA_DATABASE_URL` | PostgreSQL connection URI | Local dev URL | Yes |
| `TABULARIS_METADATA_MAX_CONNECTIONS` | Connection pool size for metadata store | `10` | Optional (1–100) |
| `TABULARIS_SESSION_TTL_SECONDS` | Cookie session lifetime in seconds | `28800` (8h) | Optional |
| `TABULARIS_RATE_LIMIT_PER_MINUTE` | General client request rate limit | `120` | Optional |
| `TABULARIS_RATE_LIMIT_BURST` | Token bucket burst capacity | `30` | Optional |
| `TABULARIS_OIDC_ISSUER_URL` | OpenID Connect discovery URL | None | Yes in prod |
| `TABULARIS_OIDC_CLIENT_ID` | OIDC Client ID | None | Yes in prod |
| `TABULARIS_OIDC_CLIENT_SECRET` | OIDC Client Secret | None | Yes in prod |
| `TABULARIS_OIDC_REDIRECT_URI` | OIDC Callback redirect URI | None | Yes in prod |
| `TABULARIS_JWT_SECRET` | Base64 encoding of 32 random signing-key bytes | None | Yes |
| `TABULARIS_MASTER_KEY` | Base64 encoding of 32 random encryption-key bytes | None | Yes (also required by the standalone development server) |
| `TABULARIS_MASTER_KEY_VERSION` | Positive active encryption key version | `1` | Optional |
| `TABULARIS_HISTORICAL_MASTER_KEYS` | JSON object mapping previous key versions to base64 keys | Empty | Only during rotation/migration |

---

## 3. Deployment & Upgrades

### Initial Launch with Docker Compose
```bash
cd deploy
cp env.example .env   # Configure secrets and OIDC credentials
docker compose up -d
```

### Checking Service Health
```bash
# Liveness probe
curl -f http://127.0.0.1:3000/health/live

# Readiness probe (verifies database metadata pool availability)
curl -f http://127.0.0.1:3000/health/ready
```

### Applying Database Migrations
Migrations are stored in `src-web-server/migrations/` and run automatically on server boot via SQLx embedded migrations.
To inspect or verify migrations without launching the full server:
```bash
./scripts/verify-migrations.sh
```

---

## 4. Secret Key Rotation Routine

Tabularis uses **Envelope Encryption (AES-256-GCM)** for database connection passwords, SSH keys, and certificates. Each record in `connection_credentials` includes a `key_version`.

### Adding a New Key Version (Non-Breaking)
1. Generate a new 32-byte cryptographically secure random key:
   ```bash
   openssl rand -base64 32
   ```
2. Set the new key version environment variable alongside previous versions:
   ```bash
   export TABULARIS_ENCRYPTION_KEY_V1="<existing-key>"
   export TABULARIS_ENCRYPTION_KEY_V2="<new-generated-key>"
   export TABULARIS_PRIMARY_KEY_VERSION="2"
   ```
3. Restart `tabularis-web-server`. New and updated connections will automatically encrypt with Key Version 2. Existing connections encrypted with Version 1 continue decrypting seamlessly.
4. (Optional) Run background re-encryption to upgrade all Version 1 credentials to Version 2.

---

## 5. Backup & Disaster Recovery

Backups are executed using `deploy/backup-restore.sh`.

### Creating a Manual Backup
```bash
./deploy/backup-restore.sh backup
# Backups are saved to ./backups/tabularis_metadata_YYYYMMDD_HHMMSSZ.sql.gz
```

### Restoring from Backup
```bash
./deploy/backup-restore.sh restore ./backups/tabularis_metadata_20260906_120000Z.sql.gz
```

### Running Disaster Recovery Verification Drill
Regular drills ensure backup files are restorable and valid:
```bash
./deploy/backup-restore.sh test-drill
```

---

## 6. Incident Response & Monitoring

### Rate Limiting & Denial of Service
- If legitimate users receive `429 Too Many Requests`, increase `TABULARIS_RATE_LIMIT_PER_MINUTE` and `TABULARIS_RATE_LIMIT_BURST`.
- Check proxy logs for abusive client IPs and block at the Caddy / firewall level.

### Global Session Revocation
- In the event of compromised credentials or a security event:
  - Users can invoke `POST /api/v1/auth/logout-all` to invalidate all active session tokens immediately across all devices.
  - Administrators can revoke sessions directly in PostgreSQL:
    ```sql
    UPDATE sessions SET revoked_at = NOW() WHERE user_id = '<target_user_id>';
    ```


## Bug-fix deployment requirements (2026-09-11)

Generate separate signing and encryption keys using `openssl rand -base64 32` for each variable. Store them in the deployment secret store; do not commit them. The old `TABULARIS_ENCRYPTION_KEY_V1` variable was not connected to runtime and is replaced by `TABULARIS_MASTER_KEY`. Changing the signing key invalidates previously signed PIN JWTs. Existing JWTs signed with the historical source-code secret are intentionally rejected.

Migration `0002_pin_credentials.sql` is applied at startup. PIN registrations now persist atomically with user identities. An old PIN-only identity without a persisted credential remains reserved: do not delete and recreate it to bypass recovery. Verify account ownership through an administrator before provisioning a replacement credential. A supplied recovery email is not proof of ownership. SSO identities are unaffected by this PIN migration.

When migrating credentials encrypted with the old development master key, choose a new active version (for example `2`) and explicitly supply the former version in `TABULARIS_HISTORICAL_MASTER_KEYS`. Re-encrypt existing credentials using the active key before removing the historical entry. Do not simply assign a new key to version `1` while old version-1 ciphertext exists. Back up both metadata and required historical keys, and rehearse restoration. Historical development keys are accepted only when explicitly supplied for migration; they cannot be the new active key.

The standalone web execution adapter currently supports PostgreSQL. Other drivers return an explicit unsupported-driver error; desktop drivers remain separate. PostgreSQL TLS with certificate/hostname validation is required by default. Set connection `publicParams.ssl` to `false` only for an explicitly trusted non-TLS target such as an isolated local test database. Connection credentials accept `username` (or `user`) and `password`. Results preserve PostgreSQL text-protocol values as JSON strings/null; automatic typed cell conversion is not implemented here.

Workspace queries use one managed transaction per statement, with a 30-second statement timeout, 5-second lock timeout, up to 10,000 retained rows per page, and a 16 MiB retained-result budget. User-controlled transaction/session-control statements are rejected. Viewer execution additionally uses a read-only transaction and conservative classification. Use least-privilege database accounts; do not use a superuser account for production connections.

Legacy unscoped query/schema/cancellation endpoints cannot access live workspace sessions. Clients must use `/api/v1/workspaces/{workspace_id}/connections/{connection_id}/...` with an authenticated session cookie. Cancellation is scoped to the current user and connection; a fully query-ID-based lifecycle remains roadmap work.

Audit insertion is awaited. Query execution stops if its pre-execution audit cannot be persisted. Connection CRUD and its audit write are not one atomic transaction: an `audit_unavailable` response after a CRUD operation requires checking resource state before retrying. PostgreSQL audit inserts deduplicate event IDs. No background audit task is silently discarded on shutdown.

For isolated backend integration testing:

```bash
QUERYAI_TEST_DATABASE_URL=postgres://test_user@127.0.0.1:55439/disposable_test_db \
  cargo test --manifest-path src-web-server/Cargo.toml --lib -- --include-ignored
```

The integration suite creates users, workspaces, and connections; run it only on a disposable database. The normal unit suite leaves this external-database test ignored explicitly. OIDC tests run their own local provider fixture and validate issuer, audience, expiry, nonce, signatures, and access-token hashes.


The web server lockfile retains `psm` 0.1.28 because newer transitive archive-writer versions use syntax unavailable on Rust 1.85 despite incomplete MSRV metadata. Docker uses `cargo build --locked`; recheck the declared toolchain when updating dependencies.

### Remaining frontend transport limitation

A successful HTTP-mode frontend build does not verify that all UI commands reach the new workspace API. The current `src/transports/http.ts` still references legacy connection routes, and `src/tauri-web-shim/core.ts` contains local mock PIN/workspace handlers. Migrating those UI call sites and testing them in a browser is separate unfinished work. The backend security and execution fixes in this patch are verified through the real API; do not represent the entire web UI as production-ready from these results.
