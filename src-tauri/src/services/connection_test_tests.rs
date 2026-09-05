use tempfile::NamedTempFile;

use crate::drivers::sqlite::SqliteDriver;
use crate::models::{ConnectionParams, DatabaseSelection};

use super::test_driver_connection;

fn sqlite_params(path: &str) -> ConnectionParams {
    ConnectionParams {
        driver: "sqlite".to_string(),
        database: DatabaseSelection::Single(path.to_string()),
        ..Default::default()
    }
}

#[tokio::test]
async fn rejects_a_missing_file_before_opening_the_driver() {
    let path = format!("/tmp/tabularis-missing-{}.db", ulid::Ulid::new());
    let error = test_driver_connection(&SqliteDriver::new(), &sqlite_params(&path))
        .await
        .unwrap_err();

    assert_eq!(error, format!("Database file not found: {path}"));
}

#[tokio::test]
async fn tests_an_existing_sqlite_database() {
    let file = NamedTempFile::new().expect("temp file");
    let path = file.path().to_str().expect("utf8 path");

    test_driver_connection(&SqliteDriver::new(), &sqlite_params(path))
        .await
        .expect("existing SQLite database should connect");
}
