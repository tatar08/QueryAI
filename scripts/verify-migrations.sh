#!/usr/bin/env bash
# ==============================================================================
# Tabularis Database Migration Verification Script
# ==============================================================================
set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../src-web-server/migrations" && pwd)"

log() {
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [MIGRATION-CHECK] $*"
}

log "Verifying PostgreSQL migrations in: ${MIGRATIONS_DIR}"

if [ ! -d "${MIGRATIONS_DIR}" ]; then
    log "Error: Migrations directory not found!"
    exit 1
fi

migration_count=0
for migration in "${MIGRATIONS_DIR}"/*.sql; do
    if [ ! -f "${migration}" ]; then
        continue
    fi
    filename="$(basename "${migration}")"
    log "Checking migration: ${filename}"
    
    # Check basic SQL syntax indicators
    if ! grep -q -i "CREATE TABLE" "${migration}"; then
        log "Warning: ${filename} does not contain CREATE TABLE"
    fi

    # Check for syntax closure (semicolons)
    if ! grep -q ";" "${migration}"; then
        log "Error: ${filename} does not contain any terminating semicolons!"
        exit 1
    fi

    migration_count=$((migration_count + 1))
done

log "Total migrations verified: ${migration_count}"
log "Migration validation succeeded."
