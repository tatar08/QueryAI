use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, RwLock};

use serde_json::Value;
use tabularis_core::SchemaResource;

use super::key::TenantPoolKey;

pub type PoolFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait TenantDatabaseSession: Send + Sync {
    fn is_closed(&self) -> bool {
        false
    }

    fn execute_with_policy<'a>(
        &'a self,
        sql: &'a str,
        limit: Option<u32>,
        page: u32,
        schema: Option<&'a str>,
        _read_only: bool,
    ) -> PoolFuture<'a, Value> {
        self.execute_query(sql, limit, page, schema)
    }

    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        limit: Option<u32>,
        page: u32,
        schema: Option<&'a str>,
    ) -> PoolFuture<'a, Value>;

    fn discover_schema<'a>(
        &'a self,
        resource: SchemaResource,
        schema: Option<&'a str>,
    ) -> PoolFuture<'a, Vec<Value>>;

    fn cancel(&self) -> Result<(), String>;
}

#[derive(Clone)]
pub struct TenantPoolManager {
    max_pools_per_workspace: usize,
    pools: Arc<RwLock<HashMap<TenantPoolKey, Arc<dyn TenantDatabaseSession>>>>,
}

impl TenantPoolManager {
    pub fn new(max_pools_per_workspace: usize) -> Self {
        Self {
            max_pools_per_workspace,
            pools: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn default_limits() -> Self {
        Self::new(20)
    }

    pub fn get_session(&self, key: &TenantPoolKey) -> Option<Arc<dyn TenantDatabaseSession>> {
        let guard = self.pools.read().ok()?;
        guard.get(key).cloned()
    }

    pub fn get_session_by_connection(
        &self,
        connection_id: &str,
    ) -> Option<Arc<dyn TenantDatabaseSession>> {
        let guard = self.pools.read().ok()?;
        let mut sessions = guard
            .iter()
            .filter(|(key, _)| key.connection_id == connection_id);
        let (_, session) = sessions.next()?;
        if sessions.next().is_some() {
            return None;
        }
        Some(session.clone())
    }

    pub fn register_session(
        &self,
        key: &TenantPoolKey,
        session: Arc<dyn TenantDatabaseSession>,
    ) -> Result<(), String> {
        let mut guard = self
            .pools
            .write()
            .map_err(|e| format!("Lock acquisition error: {e}"))?;

        if guard.contains_key(key) {
            guard.insert(key.clone(), session);
            return Ok(());
        }

        // Enforce quota: count pools belonging to this workspace
        let current_count = guard
            .keys()
            .filter(|k| k.workspace_id == key.workspace_id)
            .count();

        if current_count >= self.max_pools_per_workspace {
            return Err(format!(
                "Workspace pool limit of {} exceeded",
                self.max_pools_per_workspace
            ));
        }

        guard.insert(key.clone(), session);
        Ok(())
    }

    pub fn get_scoped_session(
        &self,
        workspace_id: &str,
        user_id: &str,
        connection_id: &str,
    ) -> Option<Arc<dyn TenantDatabaseSession>> {
        let guard = self.pools.read().ok()?;
        let mut sessions = guard
            .iter()
            .filter(|(key, _)| {
                key.workspace_id == workspace_id
                    && key.user_id == user_id
                    && key.connection_id == connection_id
            });
        let (_, session) = sessions.next()?;
        if sessions.next().is_some() {
            return None;
        }
        Some(session.clone())
    }

    pub fn cancel_session(&self, key: &TenantPoolKey) -> Result<(), String> {
        self.get_session(key)
            .ok_or_else(|| "No active session for this tenant key".to_string())?
            .cancel()
    }

    pub fn cancel_scoped_session(
        &self,
        workspace_id: &str,
        user_id: &str,
        connection_id: &str,
    ) -> Result<(), String> {
        self.get_scoped_session(workspace_id, user_id, connection_id)
            .ok_or_else(|| {
                "No active or unambiguous session for this user and connection".to_string()
            })?
            .cancel()
    }

    pub fn cancel_for_connection(&self, connection_id: &str) -> Result<(), String> {
        self.get_session_by_connection(connection_id)
            .ok_or_else(|| {
                "Missing or ambiguous connection session; use a full tenant key".to_string()
            })?
            .cancel()
    }

    pub fn evict_for_connection(&self, connection_id: &str) {
        if let Ok(mut guard) = self.pools.write() {
            guard.retain(|key, session| {
                let matches = key.connection_id == connection_id;
                if matches {
                    let _ = session.cancel();
                }
                !matches
            });
        }
    }

    pub fn evict_for_workspace(&self, workspace_id: &str) {
        if let Ok(mut guard) = self.pools.write() {
            guard.retain(|key, session| {
                let matches = key.workspace_id == workspace_id;
                if matches {
                    let _ = session.cancel();
                }
                !matches
            });
        }
    }

    pub fn evict_workspace_connection(&self, workspace_id: &str, connection_id: &str) {
        if let Ok(mut guard) = self.pools.write() {
            guard.retain(|key, session| {
                let matches =
                    key.workspace_id == workspace_id && key.connection_id == connection_id;
                if matches {
                    let _ = session.cancel();
                }
                !matches
            });
        }
    }

    pub fn evict_member(&self, workspace_id: &str, user_id: &str) {
        if let Ok(mut guard) = self.pools.write() {
            guard.retain(|key, session| {
                let matches = key.workspace_id == workspace_id && key.user_id == user_id;
                if matches {
                    let _ = session.cancel();
                }
                !matches
            });
        }
    }

    pub fn evict_user(&self, user_id: &str) {
        if let Ok(mut guard) = self.pools.write() {
            guard.retain(|key, session| {
                let matches = key.user_id == user_id;
                if matches {
                    let _ = session.cancel();
                }
                !matches
            });
        }
    }

    pub fn active_pool_count(&self) -> usize {
        self.pools.read().map(|g| g.len()).unwrap_or(0)
    }
}
