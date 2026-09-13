use std::sync::Arc;

use serde_json::Value;
use tabularis_core::{SchemaDiscoveryScope, SchemaFuture, SchemaRepository};

use crate::pools::TenantPoolManager;

#[derive(Clone)]
pub struct TenantSchemaRepository {
    pool_manager: Arc<TenantPoolManager>,
}

impl TenantSchemaRepository {
    pub fn new(pool_manager: Arc<TenantPoolManager>) -> Self {
        Self { pool_manager }
    }
}

impl SchemaRepository<Value> for TenantSchemaRepository {
    fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, Value> {
        Box::pin(async move {
            let session = self
                .pool_manager
                .get_session_by_connection(&scope.connection_id)
                .ok_or_else(|| {
                    format!(
                        "No active database session found for connection '{}'. Please establish a connection first.",
                        scope.connection_id
                    )
                })?;

            session
                .discover_schema(scope.resource, scope.schema.as_deref())
                .await
        })
    }
}
