use tempfile::NamedTempFile;

use crate::drivers::sqlite::SqliteDriver;
use crate::models::{ConnectionParams, DatabaseSelection};
use tabularis_core::SchemaResource;

use super::{
    discover_routines, discover_schema_names, discover_tables, discover_triggers, discover_views,
};

fn sqlite_params(path: &str) -> ConnectionParams {
    ConnectionParams {
        driver: "sqlite".to_string(),
        database: DatabaseSelection::Single(path.to_string()),
        connection_id: Some(format!("schema-test-{}", ulid::Ulid::new())),
        ..Default::default()
    }
}

#[tokio::test]
async fn discovers_sqlite_schemas_through_the_shared_service() {
    let result = discover_schema_names(
        &SqliteDriver::new(),
        &ConnectionParams::default(),
        "connection-1".to_string(),
        SchemaResource::Schemas,
    )
    .await
    .unwrap();

    assert!(result.is_empty());
}

#[tokio::test]
async fn rejects_an_empty_connection_id_before_driver_discovery() {
    let error = discover_schema_names(
        &SqliteDriver::new(),
        &ConnectionParams::default(),
        " ".to_string(),
        SchemaResource::Databases,
    )
    .await
    .unwrap_err();

    assert_eq!(error, "Connection ID cannot be empty");
}

#[tokio::test]
async fn discovers_all_typed_schema_resources_through_the_shared_service() {
    let file = NamedTempFile::new().unwrap();
    let path = file.path().to_str().unwrap();
    let database_url = format!("sqlite://{path}");
    let pool = sqlx::SqlitePool::connect(&database_url).await.unwrap();
    sqlx::query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE VIEW active_users AS SELECT * FROM users")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TRIGGER users_insert AFTER INSERT ON users BEGIN UPDATE users SET name = NEW.name WHERE id = NEW.id; END",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;

    let driver = SqliteDriver::new();
    let params = sqlite_params(path);
    let connection_id = "connection-1".to_string();

    let tables = discover_tables(&driver, &params, connection_id.clone(), None)
        .await
        .unwrap();
    let views = discover_views(&driver, &params, connection_id.clone(), None, false)
        .await
        .unwrap();
    let materialized_views = discover_views(&driver, &params, connection_id.clone(), None, true)
        .await
        .unwrap();
    let routines = discover_routines(&driver, &params, connection_id.clone(), None)
        .await
        .unwrap();
    let triggers = discover_triggers(&driver, &params, connection_id, None)
        .await
        .unwrap();

    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "users");
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].name, "active_users");
    assert!(materialized_views.is_empty());
    assert!(routines.is_empty());
    assert_eq!(triggers.len(), 1);
    assert_eq!(triggers[0].name, "users_insert");

    crate::pool_manager::close_pool(&params).await;
}
