use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::json;
use tabularis_core::SchemaResource;

use super::key::TenantPoolKey;
use super::manager::{PoolFuture, TenantDatabaseSession, TenantPoolManager};

struct MockSession {
    cancelled: Arc<AtomicBool>,
}

impl TenantDatabaseSession for MockSession {
    fn execute_query<'a>(
        &'a self,
        _sql: &'a str,
        _limit: Option<u32>,
        _page: u32,
        _schema: Option<&'a str>,
    ) -> PoolFuture<'a, serde_json::Value> {
        Box::pin(async { Ok(json!({ "rows": [] })) })
    }

    fn discover_schema<'a>(
        &'a self,
        _resource: SchemaResource,
        _schema: Option<&'a str>,
    ) -> PoolFuture<'a, Vec<serde_json::Value>> {
        Box::pin(async { Ok(vec![]) })
    }

    fn cancel(&self) -> Result<(), String> {
        self.cancelled.store(true, Ordering::SeqCst);
        Ok(())
    }
}

#[test]
fn test_pool_key_generation_and_stability() {
    let params = json!({ "host": "127.0.0.1", "port": 5432, "database": "prod_db" });
    let key1 = TenantPoolKey::new("ws-1", "user-1", "conn-1", None, &params);
    let key2 = TenantPoolKey::new("ws-1", "user-1", "conn-1", Some("prod_db"), &params);

    assert_eq!(key1.workspace_id, "ws-1");
    assert_eq!(key1.user_id, "user-1");
    assert_eq!(key1.connection_id, "conn-1");
    assert_eq!(key1.database, "prod_db");
    assert_eq!(key1.config_hash, key2.config_hash);
    assert_eq!(key1.to_key_string(), key2.to_key_string());
}

#[test]
fn test_pool_manager_register_and_get() {
    let manager = TenantPoolManager::new(2);
    let key = TenantPoolKey::new("ws-1", "user-1", "conn-1", Some("db1"), &json!({}));
    let cancelled = Arc::new(AtomicBool::new(false));
    let session = Arc::new(MockSession {
        cancelled: cancelled.clone(),
    });

    assert!(manager.get_session(&key).is_none());
    assert!(manager.register_session(&key, session).is_ok());
    assert_eq!(manager.active_pool_count(), 1);
    assert!(manager.get_session(&key).is_some());
    assert!(manager.get_session_by_connection("conn-1").is_some());
    assert!(manager.get_session_by_connection("other").is_none());
}

#[test]
fn test_pool_manager_bounds_enforcement() {
    let manager = TenantPoolManager::new(2);
    let key1 = TenantPoolKey::new("ws-1", "u1", "c1", Some("db1"), &json!({}));
    let key2 = TenantPoolKey::new("ws-1", "u1", "c2", Some("db2"), &json!({}));
    let key3 = TenantPoolKey::new("ws-1", "u1", "c3", Some("db3"), &json!({}));

    let session = Arc::new(MockSession {
        cancelled: Arc::new(AtomicBool::new(false)),
    });

    assert!(manager.register_session(&key1, session.clone()).is_ok());
    assert!(manager.register_session(&key2, session.clone()).is_ok());
    let err = manager.register_session(&key3, session.clone());
    assert!(err.is_err());
    assert!(err
        .unwrap_err()
        .contains("Workspace pool limit of 2 exceeded"));

    // A different workspace can still register pools
    let key_ws2 = TenantPoolKey::new("ws-2", "u1", "c1", Some("db1"), &json!({}));
    assert!(manager.register_session(&key_ws2, session).is_ok());
}

#[test]
fn test_pool_manager_eviction_by_connection() {
    let manager = TenantPoolManager::new(5);
    let key1 = TenantPoolKey::new("ws-1", "u1", "c1", Some("db1"), &json!({}));
    let key2 = TenantPoolKey::new("ws-1", "u1", "c2", Some("db2"), &json!({}));

    let cancelled1 = Arc::new(AtomicBool::new(false));
    let session1 = Arc::new(MockSession {
        cancelled: cancelled1.clone(),
    });
    let cancelled2 = Arc::new(AtomicBool::new(false));
    let session2 = Arc::new(MockSession {
        cancelled: cancelled2.clone(),
    });

    manager.register_session(&key1, session1).unwrap();
    manager.register_session(&key2, session2).unwrap();
    assert_eq!(manager.active_pool_count(), 2);

    manager.evict_for_connection("c1");
    assert!(cancelled1.load(Ordering::SeqCst));
    assert!(!cancelled2.load(Ordering::SeqCst));
    assert_eq!(manager.active_pool_count(), 1);
    assert!(manager.get_session(&key1).is_none());
    assert!(manager.get_session(&key2).is_some());
}

#[test]
fn test_pool_manager_eviction_by_workspace() {
    let manager = TenantPoolManager::new(5);
    let key1 = TenantPoolKey::new("ws-1", "u1", "c1", Some("db1"), &json!({}));
    let key2 = TenantPoolKey::new("ws-2", "u1", "c1", Some("db1"), &json!({}));

    let cancelled1 = Arc::new(AtomicBool::new(false));
    let session1 = Arc::new(MockSession {
        cancelled: cancelled1.clone(),
    });
    let cancelled2 = Arc::new(AtomicBool::new(false));
    let session2 = Arc::new(MockSession {
        cancelled: cancelled2.clone(),
    });

    manager.register_session(&key1, session1).unwrap();
    manager.register_session(&key2, session2).unwrap();

    manager.evict_for_workspace("ws-1");
    assert!(cancelled1.load(Ordering::SeqCst));
    assert!(!cancelled2.load(Ordering::SeqCst));
    assert_eq!(manager.active_pool_count(), 1);
    assert!(manager.get_session(&key1).is_none());
    assert!(manager.get_session(&key2).is_some());
}

#[test]
fn test_pool_manager_cancel_for_connection() {
    let manager = TenantPoolManager::new(5);
    let key = TenantPoolKey::new("ws-1", "u1", "c1", Some("db1"), &json!({}));
    let cancelled = Arc::new(AtomicBool::new(false));
    let session = Arc::new(MockSession {
        cancelled: cancelled.clone(),
    });

    manager.register_session(&key, session).unwrap();
    assert!(manager.cancel_for_connection("c1").is_ok());
    assert!(cancelled.load(Ordering::SeqCst));

    assert!(manager.cancel_for_connection("c2").is_err());
}

#[test]
fn typed_keys_separate_colon_components_and_reject_ambiguous_cancellation() {
    let manager = TenantPoolManager::new(5);
    let first = TenantPoolKey::new("a:b", "c", "shared", Some("db"), &json!({}));
    let second = TenantPoolKey::new("a", "b:c", "shared", Some("db"), &json!({}));
    assert_eq!(first.to_key_string(), second.to_key_string());
    let cancelled = Arc::new(AtomicBool::new(false));
    manager.register_session(&first, Arc::new(MockSession { cancelled: cancelled.clone() })).unwrap();
    manager.register_session(&second, Arc::new(MockSession { cancelled: Arc::new(AtomicBool::new(false)) })).unwrap();
    assert_eq!(manager.active_pool_count(), 2);
    assert!(manager.get_session_by_connection("shared").is_none());
    assert!(manager.cancel_for_connection("shared").is_err());
    assert!(!cancelled.load(Ordering::SeqCst));
    manager.evict_workspace_connection("a:b", "shared");
    assert!(manager.get_session(&first).is_none());
    assert!(manager.get_session(&second).is_some());
    assert!(cancelled.load(Ordering::SeqCst));
}

#[test]
fn member_eviction_preserves_other_users_and_workspaces() {
    let manager = TenantPoolManager::new(5);
    for (workspace, user) in [("one", "alice"), ("one", "bob"), ("two", "alice")] {
        let key = TenantPoolKey::new(workspace, user, "db", None, &json!({}));
        manager.register_session(&key, Arc::new(MockSession { cancelled: Arc::new(AtomicBool::new(false)) })).unwrap();
    }
    manager.evict_member("one", "alice");
    assert_eq!(manager.active_pool_count(), 2);
    assert!(manager.get_session(&TenantPoolKey::new("one", "bob", "db", None, &json!({}))).is_some());
    assert!(manager.get_session(&TenantPoolKey::new("two", "alice", "db", None, &json!({}))).is_some());
}

#[test]
fn multi_user_competing_sessions_isolation_and_cancellation() {
    let manager = TenantPoolManager::new(10);
    let alice_key = TenantPoolKey::new("ws-team", "alice", "conn-shared", Some("db_alpha"), &json!({}));
    let bob_key = TenantPoolKey::new("ws-team", "bob", "conn-shared", Some("db_alpha"), &json!({}));

    let alice_cancelled = Arc::new(AtomicBool::new(false));
    let bob_cancelled = Arc::new(AtomicBool::new(false));

    manager
        .register_session(
            &alice_key,
            Arc::new(MockSession {
                cancelled: alice_cancelled.clone(),
            }),
        )
        .unwrap();
    manager
        .register_session(
            &bob_key,
            Arc::new(MockSession {
                cancelled: bob_cancelled.clone(),
            }),
        )
        .unwrap();

    // Both sessions exist and can be resolved by scoped owner key
    assert!(manager.get_scoped_session("ws-team", "alice", "conn-shared").is_some());
    assert!(manager.get_scoped_session("ws-team", "bob", "conn-shared").is_some());

    // Unscoped connection lookups fail closed due to competing sessions
    assert!(manager.get_session_by_connection("conn-shared").is_none());
    assert!(manager.cancel_for_connection("conn-shared").is_err());

    // Charlie (no session) cannot cancel any session
    assert!(manager.cancel_scoped_session("ws-team", "charlie", "conn-shared").is_err());
    assert!(!alice_cancelled.load(Ordering::SeqCst));
    assert!(!bob_cancelled.load(Ordering::SeqCst));

    // Alice cancels her session: only Alice's session is cancelled, Bob's is unaffected
    assert!(manager.cancel_scoped_session("ws-team", "alice", "conn-shared").is_ok());
    assert!(alice_cancelled.load(Ordering::SeqCst));
    assert!(!bob_cancelled.load(Ordering::SeqCst));
}

#[test]
fn user_eviction_on_global_logout_cancels_all_workspaces() {
    let manager = TenantPoolManager::new(10);
    let alice_ws1_key = TenantPoolKey::new("ws-1", "alice", "c1", None, &json!({}));
    let alice_ws2_key = TenantPoolKey::new("ws-2", "alice", "c2", None, &json!({}));
    let bob_ws1_key = TenantPoolKey::new("ws-1", "bob", "c1", None, &json!({}));

    let alice_ws1_cancel = Arc::new(AtomicBool::new(false));
    let alice_ws2_cancel = Arc::new(AtomicBool::new(false));
    let bob_ws1_cancel = Arc::new(AtomicBool::new(false));

    manager
        .register_session(
            &alice_ws1_key,
            Arc::new(MockSession {
                cancelled: alice_ws1_cancel.clone(),
            }),
        )
        .unwrap();
    manager
        .register_session(
            &alice_ws2_key,
            Arc::new(MockSession {
                cancelled: alice_ws2_cancel.clone(),
            }),
        )
        .unwrap();
    manager
        .register_session(
            &bob_ws1_key,
            Arc::new(MockSession {
                cancelled: bob_ws1_cancel.clone(),
            }),
        )
        .unwrap();

    assert_eq!(manager.active_pool_count(), 3);

    // Global logout evicts Alice from all workspaces
    manager.evict_user("alice");

    assert!(alice_ws1_cancel.load(Ordering::SeqCst));
    assert!(alice_ws2_cancel.load(Ordering::SeqCst));
    assert!(!bob_ws1_cancel.load(Ordering::SeqCst));

    assert_eq!(manager.active_pool_count(), 1);
    assert!(manager.get_session(&alice_ws1_key).is_none());
    assert!(manager.get_session(&alice_ws2_key).is_none());
    assert!(manager.get_session(&bob_ws1_key).is_some());
}

