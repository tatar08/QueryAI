use std::sync::Arc;

use serde_json::Value;
use tabularis_core::{QueryExecutionScope, QueryFuture, QueryRepository};

use crate::pools::TenantPoolManager;

#[derive(Clone)]
pub struct TenantQueryRepository {
    pool_manager: Arc<TenantPoolManager>,
}

impl TenantQueryRepository {
    pub fn new(pool_manager: Arc<TenantPoolManager>) -> Self {
        Self { pool_manager }
    }
}

impl QueryRepository<Value> for TenantQueryRepository {
    fn execute<'a>(&'a self, scope: &'a QueryExecutionScope) -> QueryFuture<'a, Value> {
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
                .execute_query(
                    &scope.query,
                    scope.limit,
                    scope.page,
                    scope.schema.as_deref(),
                )
                .await
        })
    }
}
