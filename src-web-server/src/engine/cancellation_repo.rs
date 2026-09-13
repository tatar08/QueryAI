use std::sync::Arc;

use tabularis_core::QueryCancellationRepository;

use crate::pools::TenantPoolManager;

#[derive(Clone)]
pub struct TenantQueryCancellationRepository {
    pool_manager: Arc<TenantPoolManager>,
}

impl TenantQueryCancellationRepository {
    pub fn new(pool_manager: Arc<TenantPoolManager>) -> Self {
        Self { pool_manager }
    }
}

impl QueryCancellationRepository for TenantQueryCancellationRepository {
    fn cancel(&self, connection_id: &str) -> Result<(), String> {
        self.pool_manager.cancel_for_connection(connection_id)
    }
}
