use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::json;
use tabularis_core::{
    QueryCancellationRepository, QueryExecutionScope, QueryRepository, SchemaDiscoveryScope,
    SchemaRepository, SchemaResource,
};

use crate::pools::{PoolFuture, TenantDatabaseSession, TenantPoolKey, TenantPoolManager};

use super::cancellation_repo::TenantQueryCancellationRepository;
use super::classifier::is_read_query;
use super::query_repo::TenantQueryRepository;
use super::schema_repo::TenantSchemaRepository;

struct MockEngineSession {
    cancelled: Arc<AtomicBool>,
}

impl TenantDatabaseSession for MockEngineSession {
    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        _limit: Option<u32>,
        _page: u32,
        _schema: Option<&'a str>,
    ) -> PoolFuture<'a, serde_json::Value> {
        let sql = sql.to_string();
        Box::pin(async move {
            Ok(json!({
                "executedSql": sql,
                "rows": [{"id": 1, "name": "alice"}]
            }))
        })
    }

    fn discover_schema<'a>(
        &'a self,
        resource: SchemaResource,
        _schema: Option<&'a str>,
    ) -> PoolFuture<'a, Vec<serde_json::Value>> {
        Box::pin(async move {
            Ok(vec![json!({
                "resource": format!("{resource:?}"),
                "name": "users"
            })])
        })
    }

    fn cancel(&self) -> Result<(), String> {
        self.cancelled.store(true, Ordering::SeqCst);
        Ok(())
    }
}

#[test]
fn test_query_classifier_read_statements() {
    assert!(is_read_query("SELECT * FROM users"));
    assert!(is_read_query(
        "   select id, name from accounts where x = 1"
    ));
    assert!(is_read_query("-- Fetch users\nSELECT * FROM users;"));
    assert!(is_read_query(
        "/* Multi-line\ncomment */ SELECT * FROM users"
    ));
    assert!(is_read_query("EXPLAIN ANALYZE SELECT * FROM users"));
    assert!(is_read_query("SHOW TABLES"));
    assert!(is_read_query("DESCRIBE users"));
    assert!(is_read_query("DESC users"));
    assert!(is_read_query(
        "WITH cte AS (SELECT 1 AS num) SELECT * FROM cte"
    ));
    assert!(is_read_query(""));
}

#[test]
fn test_query_classifier_mutating_statements() {
    assert!(!is_read_query("INSERT INTO users (name) VALUES ('alice')"));
    assert!(!is_read_query("UPDATE users SET name = 'bob' WHERE id = 1"));
    assert!(!is_read_query("DELETE FROM users WHERE id = 1"));
    assert!(!is_read_query("DROP TABLE users"));
    assert!(!is_read_query("ALTER TABLE users ADD COLUMN age INT"));
    assert!(!is_read_query("CREATE TABLE users (id INT)"));
    assert!(!is_read_query("TRUNCATE TABLE users"));
    assert!(!is_read_query(
        "WITH cte AS (SELECT 1 AS id) DELETE FROM users WHERE id IN (SELECT id FROM cte)"
    ));
    assert!(!is_read_query("EXEC sp_danger"));
    assert!(!is_read_query("SELECT 1; DROP TABLE users;"));
}

#[tokio::test]
async fn test_tenant_query_repository_lifecycle() {
    let pool_manager = Arc::new(TenantPoolManager::new(5));
    let query_repo = TenantQueryRepository::new(pool_manager.clone());

    let scope = QueryExecutionScope {
        connection_id: "conn-test-1".to_string(),
        query: "SELECT 1".to_string(),
        limit: Some(10),
        page: 1,
        schema: None,
    };

    // Fails when no session is registered
    let err = query_repo.execute(&scope).await;
    assert!(err.is_err());
    assert!(err.unwrap_err().contains("No active database session"));

    // Succeeds when session is registered
    let key = TenantPoolKey::new("ws-1", "user-1", "conn-test-1", None, &json!({}));
    let session = Arc::new(MockEngineSession {
        cancelled: Arc::new(AtomicBool::new(false)),
    });
    pool_manager.register_session(&key, session).unwrap();

    let result = query_repo.execute(&scope).await.unwrap();
    assert_eq!(result["executedSql"], "SELECT 1");
    assert_eq!(result["rows"][0]["name"], "alice");
}

#[tokio::test]
async fn test_tenant_schema_repository_lifecycle() {
    let pool_manager = Arc::new(TenantPoolManager::new(5));
    let schema_repo = TenantSchemaRepository::new(pool_manager.clone());

    let scope = SchemaDiscoveryScope {
        connection_id: "conn-test-2".to_string(),
        resource: SchemaResource::Tables,
        schema: Some("public".to_string()),
    };

    // Fails when no session is registered
    let err = schema_repo.discover(&scope).await;
    assert!(err.is_err());

    // Succeeds when session registered
    let key = TenantPoolKey::new("ws-1", "user-1", "conn-test-2", None, &json!({}));
    let session = Arc::new(MockEngineSession {
        cancelled: Arc::new(AtomicBool::new(false)),
    });
    pool_manager.register_session(&key, session).unwrap();

    let result = schema_repo.discover(&scope).await.unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0]["resource"], "Tables");
}

#[test]
fn test_tenant_query_cancellation_lifecycle() {
    let pool_manager = Arc::new(TenantPoolManager::new(5));
    let cancel_repo = TenantQueryCancellationRepository::new(pool_manager.clone());

    // Fails when no session
    assert!(cancel_repo.cancel("conn-test-3").is_err());

    let key = TenantPoolKey::new("ws-1", "user-1", "conn-test-3", None, &json!({}));
    let cancelled = Arc::new(AtomicBool::new(false));
    let session = Arc::new(MockEngineSession {
        cancelled: cancelled.clone(),
    });
    pool_manager.register_session(&key, session).unwrap();

    assert!(cancel_repo.cancel("conn-test-3").is_ok());
    assert!(cancelled.load(Ordering::SeqCst));
}
