use crate::models::{ConnectionParams, SqliteAttachedDatabase, SqlitePragmaInfo};
use crate::pool_manager::get_sqlite_pool;
use sqlx::Row;

fn format_bytes(bytes: i64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.2} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

pub async fn get_sqlite_pragmas(params: &ConnectionParams) -> Result<SqlitePragmaInfo, String> {
    let pool = get_sqlite_pool(params).await?;

    // Journal Mode
    let jm_row = sqlx::query("PRAGMA journal_mode")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let journal_mode: String = jm_row.try_get(0).unwrap_or_else(|_| "delete".to_string());

    // Synchronous: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA
    let sync_row = sqlx::query("PRAGMA synchronous")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let sync_val: i32 = sync_row.try_get(0).unwrap_or(2);
    let synchronous = match sync_val {
        0 => "OFF",
        1 => "NORMAL",
        2 => "FULL",
        3 => "EXTRA",
        _ => "NORMAL",
    }
    .to_string();

    // Foreign Keys
    let fk_row = sqlx::query("PRAGMA foreign_keys")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let fk_val: i32 = fk_row.try_get(0).unwrap_or(0);
    let foreign_keys = fk_val != 0;

    // Auto Vacuum: 0=NONE, 1=FULL, 2=INCREMENTAL
    let av_row = sqlx::query("PRAGMA auto_vacuum")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let av_val: i32 = av_row.try_get(0).unwrap_or(0);
    let auto_vacuum = match av_val {
        1 => "FULL",
        2 => "INCREMENTAL",
        _ => "NONE",
    }
    .to_string();

    // Cache Size
    let cs_row = sqlx::query("PRAGMA cache_size")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let cache_size: i64 = cs_row.try_get(0).unwrap_or(-2000);

    // Page Size
    let ps_row = sqlx::query("PRAGMA page_size")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let page_size: i64 = ps_row.try_get(0).unwrap_or(4096);

    // Page Count
    let pc_row = sqlx::query("PRAGMA page_count")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let page_count: i64 = pc_row.try_get(0).unwrap_or(0);

    // Freelist Count
    let fl_row = sqlx::query("PRAGMA freelist_count")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let freelist_count: i64 = fl_row.try_get(0).unwrap_or(0);

    // Encoding
    let enc_row = sqlx::query("PRAGMA encoding")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let encoding: String = enc_row.try_get(0).unwrap_or_else(|_| "UTF-8".to_string());

    // User Version
    let uv_row = sqlx::query("PRAGMA user_version")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let user_version: i64 = uv_row.try_get(0).unwrap_or(0);

    // WAL Auto Checkpoint
    let wac_row = sqlx::query("PRAGMA wal_autocheckpoint")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let wal_autocheckpoint: i64 = wac_row.try_get(0).unwrap_or(1000);

    let database_size_bytes = page_size * page_count;
    let database_size_pretty = format_bytes(database_size_bytes);

    Ok(SqlitePragmaInfo {
        journal_mode,
        synchronous,
        foreign_keys,
        auto_vacuum,
        cache_size,
        page_size,
        page_count,
        freelist_count,
        encoding,
        user_version,
        wal_autocheckpoint,
        database_size_bytes,
        database_size_pretty,
    })
}

pub async fn set_sqlite_pragma(
    params: &ConnectionParams,
    pragma_name: &str,
    value: &str,
) -> Result<String, String> {
    let pool = get_sqlite_pool(params).await?;

    let safe_pragma = match pragma_name {
        "journal_mode" => {
            let upper = value.trim().to_uppercase();
            if !["DELETE", "TRUNCATE", "PERSIST", "MEMORY", "WAL", "OFF"].contains(&upper.as_str()) {
                return Err(format!("Invalid journal_mode value: {}", value));
            }
            format!("PRAGMA journal_mode = {}", upper)
        }
        "synchronous" => {
            let upper = value.trim().to_uppercase();
            if !["OFF", "NORMAL", "FULL", "EXTRA", "0", "1", "2", "3"].contains(&upper.as_str()) {
                return Err(format!("Invalid synchronous value: {}", value));
            }
            format!("PRAGMA synchronous = {}", upper)
        }
        "foreign_keys" => {
            let val = match value.trim().to_lowercase().as_str() {
                "on" | "1" | "true" => "ON",
                "off" | "0" | "false" => "OFF",
                _ => return Err(format!("Invalid foreign_keys value: {}", value)),
            };
            format!("PRAGMA foreign_keys = {}", val)
        }
        "cache_size" => {
            let num: i64 = value.trim().parse().map_err(|_| "Invalid cache_size number")?;
            format!("PRAGMA cache_size = {}", num)
        }
        "auto_vacuum" => {
            let upper = value.trim().to_uppercase();
            if !["NONE", "FULL", "INCREMENTAL", "0", "1", "2"].contains(&upper.as_str()) {
                return Err(format!("Invalid auto_vacuum value: {}", value));
            }
            format!("PRAGMA auto_vacuum = {}", upper)
        }
        "wal_autocheckpoint" => {
            let num: i64 = value.trim().parse().map_err(|_| "Invalid wal_autocheckpoint number")?;
            format!("PRAGMA wal_autocheckpoint = {}", num)
        }
        "user_version" => {
            let num: i64 = value.trim().parse().map_err(|_| "Invalid user_version number")?;
            format!("PRAGMA user_version = {}", num)
        }
        _ => return Err(format!("Unsupported or non-writable PRAGMA: {}", pragma_name)),
    };

    let row = sqlx::query(&safe_pragma)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let res_str = if let Some(r) = row {
        r.try_get::<String, _>(0)
            .or_else(|_| r.try_get::<i64, _>(0).map(|n| n.to_string()))
            .unwrap_or_else(|_| "OK".to_string())
    } else {
        "OK".to_string()
    };

    Ok(format!("PRAGMA '{}' set successfully. Result: {}", pragma_name, res_str))
}

pub async fn check_sqlite_integrity(
    params: &ConnectionParams,
    quick: bool,
) -> Result<Vec<String>, String> {
    let pool = get_sqlite_pool(params).await?;
    let sql = if quick {
        "PRAGMA quick_check"
    } else {
        "PRAGMA integrity_check"
    };

    let rows = sqlx::query(sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let results: Vec<String> = rows
        .into_iter()
        .map(|r| r.try_get::<String, _>(0).unwrap_or_default())
        .collect();

    Ok(results)
}

pub async fn execute_sqlite_maintenance(
    params: &ConnectionParams,
    operation: &str,
) -> Result<String, String> {
    let pool = get_sqlite_pool(params).await?;

    match operation {
        "vacuum" => {
            sqlx::query("VACUUM")
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok("VACUUM completed successfully. Unused pages reclaimed and database defragmented.".to_string())
        }
        "analyze" => {
            sqlx::query("ANALYZE")
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok("ANALYZE completed successfully. Query planner statistics updated.".to_string())
        }
        "optimize" => {
            sqlx::query("PRAGMA optimize")
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok("PRAGMA optimize completed successfully.".to_string())
        }
        "wal_checkpoint" => {
            sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok("WAL Checkpoint (TRUNCATE) completed successfully. All WAL frames synced and truncated.".to_string())
        }
        _ => Err(format!("Unsupported maintenance operation: {}", operation)),
    }
}

pub async fn get_sqlite_attached_databases(
    params: &ConnectionParams,
) -> Result<Vec<SqliteAttachedDatabase>, String> {
    let pool = get_sqlite_pool(params).await?;

    let rows = sqlx::query("PRAGMA database_list")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        let seq: i32 = r.try_get("seq").unwrap_or(0);
        let name: String = r.try_get("name").unwrap_or_default();
        let file: String = r.try_get("file").unwrap_or_default();
        list.push(SqliteAttachedDatabase { seq, name, file });
    }

    Ok(list)
}

pub async fn vacuum_sqlite_into(
    params: &ConnectionParams,
    destination_path: &str,
) -> Result<String, String> {
    let pool = get_sqlite_pool(params).await?;
    let escaped_path = destination_path.replace('\'', "''");
    let sql = format!("VACUUM INTO '{}'", escaped_path);

    sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("VACUUM INTO completed successfully. Live backup written to {}", destination_path))
}
