use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use tabularis_core::{
    AuditEvent, AuditEventInput, AuditRepository, AuditScope, AuditService, AuditServiceError,
};

pub type AuditFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEventRecord {
    pub id: String,
    pub workspace_id: Option<String>,
    pub actor_user_id: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub request_id: Option<String>,
    pub metadata: Value,
    pub created_at: String,
}

pub trait WorkspaceAuditRepository: AuditRepository<Value> + Send + Sync {
    fn persist<'a>(&'a self, event: &'a AuditEvent<Value>) -> AuditFuture<'a, ()> {
        Box::pin(async move { self.record(event) })
    }

    fn list_for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
        limit: i64,
        offset: i64,
    ) -> AuditFuture<'a, Vec<AuditEventRecord>>;
}

#[derive(Clone)]
pub struct PostgresAuditRepository {
    pool: PgPool,
}

impl PostgresAuditRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AuditRepository<Value> for PostgresAuditRepository {
    fn record(&self, _event: &AuditEvent<Value>) -> Result<(), String> {
        Err("PostgreSQL audit persistence must be awaited using persist".into())
    }
}

impl WorkspaceAuditRepository for PostgresAuditRepository {
    fn persist<'a>(&'a self, event: &'a AuditEvent<Value>) -> AuditFuture<'a, ()> {
        Box::pin(async move {
            let (workspace_id, actor_user_id) = match &event.scope {
                AuditScope::Workspace {
                    workspace_id,
                    actor_user_id,
                } => (Some(workspace_id), Some(actor_user_id)),
                AuditScope::Desktop { .. } => (None, None),
            };
            sqlx::query("INSERT INTO audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, request_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text::timestamptz) ON CONFLICT (id) DO NOTHING")
                .bind(&event.id).bind(workspace_id).bind(actor_user_id).bind(&event.action)
                .bind(&event.resource_type).bind(&event.resource_id).bind(&event.request_id)
                .bind(&event.metadata).bind(&event.occurred_at).execute(&self.pool).await
                .map(|_| ()).map_err(|error| { tracing::error!(%error, event_id = %event.id, "Audit persistence failed"); "Audit persistence unavailable".to_string() })
        })
    }

    fn list_for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
        limit: i64,
        offset: i64,
    ) -> AuditFuture<'a, Vec<AuditEventRecord>> {
        Box::pin(async move {
            let rows = sqlx::query_as::<
                _,
                (
                    String,
                    Option<String>,
                    Option<String>,
                    String,
                    String,
                    Option<String>,
                    Option<String>,
                    Value,
                    String,
                ),
            >(
                "SELECT id, workspace_id, actor_user_id, action, resource_type, resource_id, request_id, metadata, \
                        to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at \
                 FROM audit_events \
                 WHERE workspace_id = $1 \
                 ORDER BY created_at DESC \
                 LIMIT $2 OFFSET $3",
            )
            .bind(workspace_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to list audit events: {e}"))?;

            Ok(rows
                .into_iter()
                .map(|r| AuditEventRecord {
                    id: r.0,
                    workspace_id: r.1,
                    actor_user_id: r.2,
                    action: r.3,
                    resource_type: r.4,
                    resource_id: r.5,
                    request_id: r.6,
                    metadata: r.7,
                    created_at: r.8,
                })
                .collect())
        })
    }
}

#[derive(Clone, Default)]
pub struct MemoryAuditRepository {
    events: Arc<Mutex<Vec<AuditEventRecord>>>,
}

impl MemoryAuditRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

impl AuditRepository<Value> for MemoryAuditRepository {
    fn record(&self, event: &AuditEvent<Value>) -> Result<(), String> {
        let (workspace_id, actor_user_id) = match &event.scope {
            AuditScope::Workspace {
                workspace_id,
                actor_user_id,
            } => (Some(workspace_id.clone()), Some(actor_user_id.clone())),
            AuditScope::Desktop { .. } => (None, None),
        };

        let record = AuditEventRecord {
            id: event.id.clone(),
            workspace_id,
            actor_user_id,
            action: event.action.clone(),
            resource_type: event.resource_type.clone(),
            resource_id: event.resource_id.clone(),
            request_id: event.request_id.clone(),
            metadata: event.metadata.clone(),
            created_at: event.occurred_at.clone(),
        };

        self.events.lock().unwrap().push(record);
        Ok(())
    }
}

impl WorkspaceAuditRepository for MemoryAuditRepository {
    fn list_for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
        limit: i64,
        offset: i64,
    ) -> AuditFuture<'a, Vec<AuditEventRecord>> {
        Box::pin(async move {
            let guard = self.events.lock().unwrap();
            let filtered: Vec<AuditEventRecord> = guard
                .iter()
                .filter(|e| e.workspace_id.as_deref() == Some(workspace_id))
                .cloned()
                .collect();

            let total = filtered.len() as i64;
            let start = offset.min(total) as usize;
            let end = (start as i64 + limit).min(total) as usize;

            Ok(filtered[start..end].to_vec())
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceAuditContext {
    pub workspace_id: String,
    pub actor_user_id: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceAuditInput<M> {
    pub id: String,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub occurred_at: String,
    pub metadata: M,
}

pub fn record_workspace_audit<M>(
    repository: &dyn AuditRepository<M>,
    context: WorkspaceAuditContext,
    input: WorkspaceAuditInput<M>,
) -> Result<(), AuditServiceError> {
    AuditService.record(
        repository,
        AuditEventInput {
            id: input.id,
            scope: AuditScope::Workspace {
                workspace_id: context.workspace_id,
                actor_user_id: context.actor_user_id,
            },
            action: input.action,
            resource_type: input.resource_type,
            resource_id: input.resource_id,
            request_id: context.request_id,
            occurred_at: input.occurred_at,
            metadata: input.metadata,
        },
    )
}

#[cfg(test)]
#[path = "audit_tests.rs"]
mod tests;

pub async fn persist_workspace_audit(
    repository: &dyn WorkspaceAuditRepository,
    context: WorkspaceAuditContext,
    input: WorkspaceAuditInput<Value>,
) -> Result<(), AuditServiceError> {
    let event = AuditService.prepare(AuditEventInput {
        id: input.id,
        scope: AuditScope::Workspace {
            workspace_id: context.workspace_id,
            actor_user_id: context.actor_user_id,
        },
        action: input.action,
        resource_type: input.resource_type,
        resource_id: input.resource_id,
        request_id: context.request_id,
        occurred_at: input.occurred_at,
        metadata: input.metadata,
    })?;
    repository
        .persist(&event)
        .await
        .map_err(AuditServiceError::Repository)
}
