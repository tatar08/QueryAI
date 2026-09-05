use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::ConnectionParams;
use std::path::PathBuf;

/// Test an already-resolved connection through a selected database driver.
///
/// Transport adapters remain responsible for resolving credentials, tunnels,
/// driver registration, authorization, and progress events before calling this
/// transport-independent service operation.
pub async fn test_driver_connection(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
) -> Result<(), String> {
    if driver.manifest().capabilities.file_based {
        let database_path = if params.driver == "sqlite" {
            crate::sqlite_database::expand_sqlite_filename(params.database.primary())
        } else {
            PathBuf::from(params.database.primary())
        };

        if !database_path.exists() {
            return Err(format!("Database file not found: {}", params.database));
        }
    }

    driver.test_connection(params).await
}
