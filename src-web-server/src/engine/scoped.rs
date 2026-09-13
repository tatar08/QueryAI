use crate::{
    pools::{TenantDatabaseSession, TenantPoolKey},
    AppState, ConnectionSummary,
};
use serde_json::Value;
use std::sync::Arc;
use tabularis_core::{
    QueryCancellationRepository, QueryExecutionScope, QueryFuture, QueryRepository,
    SchemaDiscoveryScope, SchemaFuture, SchemaRepository,
};

pub struct ScopedRepository {
    pub session: Arc<dyn TenantDatabaseSession>,
    pub read_only: bool,
}
impl QueryRepository<Value> for ScopedRepository {
    fn execute<'a>(&'a self, scope: &'a QueryExecutionScope) -> QueryFuture<'a, Value> {
        self.session.execute_with_policy(
            &scope.query,
            scope.limit,
            scope.page,
            scope.schema.as_deref(),
            self.read_only,
        )
    }
}
impl SchemaRepository<Value> for ScopedRepository {
    fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, Value> {
        self.session
            .discover_schema(scope.resource, scope.schema.as_deref())
    }
}

/// Unscoped legacy endpoints must never resolve a live workspace session.
pub struct UnscopedRepository;
impl QueryRepository<Value> for UnscopedRepository {
    fn execute<'a>(&'a self, _scope: &'a QueryExecutionScope) -> QueryFuture<'a, Value> {
        Box::pin(async { Err("Use the authenticated workspace connection endpoint".into()) })
    }
}
impl SchemaRepository<Value> for UnscopedRepository {
    fn discover<'a>(&'a self, _scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, Value> {
        Box::pin(async { Err("Use the authenticated workspace connection endpoint".into()) })
    }
}
impl QueryCancellationRepository for UnscopedRepository {
    fn cancel(&self, _connection_id: &str) -> Result<(), String> {
        Err("Use the authenticated workspace connection endpoint".into())
    }
}

pub async fn workspace_session(
    state: &AppState,
    user_id: &str,
    connection: &ConnectionSummary,
) -> Result<Arc<dyn TenantDatabaseSession>, String> {
    let key = TenantPoolKey::new(
        &connection.workspace_id,
        user_id,
        &connection.id,
        None,
        &connection.public_params,
    );
    let _creation = state.session_creation.lock().await;
    if let Some(session) = state.pool_manager.get_session(&key) {
        if !session.is_closed() {
            return Ok(session);
        }
    }
    if connection.driver != "postgres" && connection.driver != "postgresql" {
        return Err(format!(
            "Web execution does not yet support driver '{}'; use PostgreSQL or the desktop driver",
            connection.driver
        ));
    }
    let credentials = state
        .connection_repo
        .get_credentials(&connection.workspace_id, &connection.id)
        .await?
        .unwrap_or(Value::Null);
    let session =
        super::postgres_session::PostgresSession::connect(&connection.public_params, &credentials)
            .await?;
    state.pool_manager.register_session(&key, session.clone())?;
    Ok(session)
}
