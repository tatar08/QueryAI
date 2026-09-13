use std::collections::HashMap;
use tokio_postgres::types::ToSql;

use crate::drivers::postgres::client;
use crate::models::{
    ConnectionParams, DbPrivilegeCatalog, DbUserGrantSet, DbUserInfo, PgActivityInfo,
    PgDatabaseMetrics, PgExtensionInfo,
};
use crate::pool_manager::get_postgres_pool;

pub fn get_privilege_catalog() -> DbPrivilegeCatalog {
    DbPrivilegeCatalog {
        database: vec!["CREATE".into(), "CONNECT".into(), "TEMPORARY".into()],
        global: vec![
            "SUPERUSER".into(),
            "CREATEDB".into(),
            "CREATEROLE".into(),
            "INHERIT".into(),
            "LOGIN".into(),
            "REPLICATION".into(),
            "BYPASSRLS".into(),
        ],
        table: vec![
            "SELECT".into(),
            "INSERT".into(),
            "UPDATE".into(),
            "DELETE".into(),
            "TRUNCATE".into(),
            "REFERENCES".into(),
            "TRIGGER".into(),
        ],
    }
}

pub async fn get_db_users(params: &ConnectionParams) -> Result<Vec<DbUserInfo>, String> {
    let pool = get_postgres_pool(params).await?;
    let rows = client::query_all(
        &pool,
        "SELECT rolname::text, rolcanlogin FROM pg_roles ORDER BY rolname",
        &[],
    )
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let user: String = r.get(0);
            let can_login: bool = r.get(1);
            DbUserInfo {
                user,
                host: "%".to_string(),
                locked: !can_login,
            }
        })
        .collect())
}

pub async fn get_db_user_grants(
    params: &ConnectionParams,
    user: &str,
) -> Result<Vec<String>, String> {
    let pool = get_postgres_pool(params).await?;
    let mut grants = Vec::new();

    // Check role global attributes
    let role_rows = client::query_all(
        &pool,
        "SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin \
         FROM pg_roles WHERE rolname = $1",
        &[&user as &(dyn ToSql + Sync)],
    )
    .await?;

    if let Some(r) = role_rows.first() {
        let is_super: bool = r.get(0);
        let is_createrole: bool = r.get(2);
        let is_createdb: bool = r.get(3);
        if is_super {
            grants.push(format!("ALTER ROLE \"{}\" SUPERUSER", user));
        }
        if is_createdb {
            grants.push(format!("ALTER ROLE \"{}\" CREATEDB", user));
        }
        if is_createrole {
            grants.push(format!("ALTER ROLE \"{}\" CREATEROLE", user));
        }
    }

    // Check table-level grants from information_schema
    let rows = client::query_all(
        &pool,
        "SELECT table_schema::text, table_name::text, privilege_type::text \
         FROM information_schema.role_table_grants \
         WHERE grantee = $1 \
         ORDER BY table_schema, table_name, privilege_type",
        &[&user as &(dyn ToSql + Sync)],
    )
    .await?;

    for r in rows {
        let schema: String = r.get(0);
        let table: String = r.get(1);
        let priv_type: String = r.get(2);
        grants.push(format!(
            "GRANT {} ON \"{}\".\"{}\" TO \"{}\"",
            priv_type, schema, table, user
        ));
    }

    Ok(grants)
}

pub async fn get_db_user_privileges(
    params: &ConnectionParams,
    user: &str,
) -> Result<Vec<DbUserGrantSet>, String> {
    let pool = get_postgres_pool(params).await?;
    let mut result = Vec::new();

    // Global scope (database = None, table = None)
    let role_rows = client::query_all(
        &pool,
        "SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls \
         FROM pg_roles WHERE rolname = $1",
        &[&user as &(dyn ToSql + Sync)],
    )
    .await?;

    if let Some(r) = role_rows.first() {
        let mut globals = Vec::new();
        if r.get::<_, bool>(0) { globals.push("SUPERUSER".to_string()); }
        if r.get::<_, bool>(1) { globals.push("INHERIT".to_string()); }
        if r.get::<_, bool>(2) { globals.push("CREATEROLE".to_string()); }
        if r.get::<_, bool>(3) { globals.push("CREATEDB".to_string()); }
        if r.get::<_, bool>(4) { globals.push("LOGIN".to_string()); }
        if r.get::<_, bool>(5) { globals.push("REPLICATION".to_string()); }
        if r.get::<_, bool>(6) { globals.push("BYPASSRLS".to_string()); }
        result.push(DbUserGrantSet {
            database: None,
            table: None,
            privileges: globals,
        });
    }

    // Table grants grouped by (schema, table)
    let rows = client::query_all(
        &pool,
        "SELECT table_schema::text, table_name::text, privilege_type::text \
         FROM information_schema.role_table_grants \
         WHERE grantee = $1",
        &[&user as &(dyn ToSql + Sync)],
    )
    .await?;

    let mut table_map: HashMap<(String, String), Vec<String>> = HashMap::new();
    for r in rows {
        let schema: String = r.get(0);
        let table: String = r.get(1);
        let priv_type: String = r.get(2);
        table_map.entry((schema, table)).or_default().push(priv_type);
    }

    for ((schema, table), privs) in table_map {
        result.push(DbUserGrantSet {
            database: Some(schema),
            table: Some(table),
            privileges: privs,
        });
    }

    Ok(result)
}

pub async fn create_db_user(
    params: &ConnectionParams,
    user: &str,
    password: &str,
) -> Result<(), String> {
    let pool = get_postgres_pool(params).await?;
    let quoted_user = format!("\"{}\"", user.replace('"', "\"\""));
    let escaped_pwd = password.replace('\'', "''");
    let sql = format!(
        "CREATE ROLE {} WITH LOGIN PASSWORD '{}'",
        quoted_user, escaped_pwd
    );
    client::execute(&pool, &sql, &[]).await?;
    Ok(())
}

pub async fn drop_db_user(params: &ConnectionParams, user: &str) -> Result<(), String> {
    let pool = get_postgres_pool(params).await?;
    let quoted_user = format!("\"{}\"", user.replace('"', "\"\""));
    let sql = format!("DROP ROLE {}", quoted_user);
    client::execute(&pool, &sql, &[]).await?;
    Ok(())
}

pub async fn set_db_user_password(
    params: &ConnectionParams,
    user: &str,
    password: &str,
) -> Result<(), String> {
    let pool = get_postgres_pool(params).await?;
    let quoted_user = format!("\"{}\"", user.replace('"', "\"\""));
    let escaped_pwd = password.replace('\'', "''");
    let sql = format!(
        "ALTER ROLE {} WITH PASSWORD '{}'",
        quoted_user, escaped_pwd
    );
    client::execute(&pool, &sql, &[]).await?;
    Ok(())
}

pub async fn apply_db_user_privileges(
    params: &ConnectionParams,
    user: &str,
    _host: &str,
    database: Option<&str>,
    table: Option<&str>,
    privileges: &[String],
    grant: bool,
) -> Result<(), String> {
    if privileges.is_empty() {
        return Ok(());
    }
    let pool = get_postgres_pool(params).await?;
    let quoted_user = format!("\"{}\"", user.replace('"', "\"\""));

    if database.is_none() && table.is_none() {
        for priv_name in privileges {
            let attr = if grant {
                priv_name.clone()
            } else {
                format!("NO{}", priv_name)
            };
            let sql = format!("ALTER ROLE {} {}", quoted_user, attr);
            let _ = client::execute(&pool, &sql, &[]).await;
        }
    } else {
        let action = if grant { "GRANT" } else { "REVOKE" };
        let preposition = if grant { "TO" } else { "FROM" };
        let privs_str = privileges.join(", ");

        let sql = match (database, table) {
            (Some(schema), Some(tbl)) => {
                format!(
                    "{} {} ON TABLE \"{}\".\"{}\" {} {}",
                    action,
                    privs_str,
                    schema.replace('"', "\"\""),
                    tbl.replace('"', "\"\""),
                    preposition,
                    quoted_user
                )
            }
            (Some(schema), None) => {
                format!(
                    "{} {} ON ALL TABLES IN SCHEMA \"{}\" {} {}",
                    action,
                    privs_str,
                    schema.replace('"', "\"\""),
                    preposition,
                    quoted_user
                )
            }
            _ => return Ok(()),
        };
        client::execute(&pool, &sql, &[]).await?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Activity & Lock Monitoring (pg_stat_activity)
// ---------------------------------------------------------------------------

pub async fn get_pg_activity(params: &ConnectionParams) -> Result<Vec<PgActivityInfo>, String> {
    let pool = get_postgres_pool(params).await?;
    let sql = r#"
        SELECT
            pid,
            COALESCE(usename::text, '') AS usename,
            COALESCE(datname::text, '') AS datname,
            COALESCE(client_addr::text, 'local') AS client_addr,
            COALESCE(state::text, 'unknown') AS state,
            COALESCE(query::text, '') AS query,
            COALESCE(wait_event_type::text, '') AS wait_event_type,
            COALESCE(wait_event::text, '') AS wait_event,
            COALESCE(ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::numeric, 2)::float8, 0.0) AS duration_seconds
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
        ORDER BY query_start DESC NULLS LAST
    "#;

    let rows = client::query_all(&pool, sql, &[]).await?;
    Ok(rows
        .into_iter()
        .map(|r| PgActivityInfo {
            pid: r.get(0),
            usename: r.get(1),
            datname: r.get(2),
            client_addr: r.get(3),
            state: r.get(4),
            query: r.get(5),
            wait_event_type: r.get(6),
            wait_event: r.get(7),
            duration_seconds: r.get(8),
        })
        .collect())
}

pub async fn cancel_pg_backend(params: &ConnectionParams, pid: i32) -> Result<bool, String> {
    let pool = get_postgres_pool(params).await?;
    let row = client::query_one(
        &pool,
        "SELECT pg_cancel_backend($1)",
        &[&pid as &(dyn ToSql + Sync)],
    )
    .await?;
    Ok(row.get(0))
}

pub async fn terminate_pg_backend(params: &ConnectionParams, pid: i32) -> Result<bool, String> {
    let pool = get_postgres_pool(params).await?;
    let row = client::query_one(
        &pool,
        "SELECT pg_terminate_backend($1)",
        &[&pid as &(dyn ToSql + Sync)],
    )
    .await?;
    Ok(row.get(0))
}

// ---------------------------------------------------------------------------
// Extensions (pg_available_extensions)
// ---------------------------------------------------------------------------

pub async fn get_pg_extensions(params: &ConnectionParams) -> Result<Vec<PgExtensionInfo>, String> {
    let pool = get_postgres_pool(params).await?;
    let sql = r#"
        SELECT
            name::text,
            default_version::text,
            COALESCE(installed_version::text, '') AS installed_version,
            COALESCE(comment::text, '') AS comment
        FROM pg_available_extensions
        ORDER BY installed_version IS NULL, name
    "#;

    let rows = client::query_all(&pool, sql, &[]).await?;
    Ok(rows
        .into_iter()
        .map(|r| PgExtensionInfo {
            name: r.get(0),
            default_version: r.get(1),
            installed_version: r.get(2),
            comment: r.get(3),
        })
        .collect())
}

pub async fn install_pg_extension(params: &ConnectionParams, name: &str) -> Result<(), String> {
    let pool = get_postgres_pool(params).await?;
    let clean_name = name.replace('"', "\"\"");
    let sql = format!("CREATE EXTENSION IF NOT EXISTS \"{}\"", clean_name);
    client::execute(&pool, &sql, &[]).await?;
    Ok(())
}

pub async fn drop_pg_extension(params: &ConnectionParams, name: &str) -> Result<(), String> {
    let pool = get_postgres_pool(params).await?;
    let clean_name = name.replace('"', "\"\"");
    let sql = format!("DROP EXTENSION IF EXISTS \"{}\"", clean_name);
    client::execute(&pool, &sql, &[]).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Database Performance & Maintenance
// ---------------------------------------------------------------------------

pub async fn execute_pg_maintenance(
    params: &ConnectionParams,
    operation: &str,
    target: Option<&str>,
) -> Result<String, String> {
    let pool = get_postgres_pool(params).await?;
    let target_sql = target
        .map(|t| format!(" \"{}\"", t.replace('"', "\"\"")))
        .unwrap_or_default();

    let sql = match operation {
        "vacuum" => format!("VACUUM (VERBOSE, ANALYZE){}", target_sql),
        "vacuum_full" => format!("VACUUM FULL{}", target_sql),
        "reindex" => {
            if let Some(t) = target {
                format!("REINDEX TABLE \"{}\"", t.replace('"', "\"\""))
            } else {
                "REINDEX DATABASE current_database()".to_string()
            }
        }
        "analyze" => format!("ANALYZE VERBOSE{}", target_sql),
        _ => return Err(format!("Unsupported maintenance operation: {}", operation)),
    };

    client::execute(&pool, &sql, &[]).await?;
    Ok(format!("Maintenance operation '{}' completed successfully.", operation))
}

pub async fn get_pg_database_metrics(
    params: &ConnectionParams,
) -> Result<PgDatabaseMetrics, String> {
    let pool = get_postgres_pool(params).await?;

    // Database size
    let size_row = client::query_one(
        &pool,
        "SELECT pg_size_pretty(pg_database_size(current_database()))::text",
        &[],
    )
    .await?;
    let database_size: String = size_row.get(0);

    // Active, idle, total connections
    let conn_row = client::query_one(
        &pool,
        "SELECT
            count(*) FILTER (WHERE state = 'active')::int8,
            count(*) FILTER (WHERE state = 'idle')::int8,
            count(*)::int8
         FROM pg_stat_activity",
        &[],
    )
    .await?;
    let active_connections: i64 = conn_row.get(0);
    let idle_connections: i64 = conn_row.get(1);
    let total_connections: i64 = conn_row.get(2);

    // Cache hit ratio
    let cache_row = client::query_all(
        &pool,
        "SELECT ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2)::float8
         FROM pg_stat_database WHERE datname = current_database()",
        &[],
    )
    .await?;
    let cache_hit_ratio: f64 = cache_row
        .first()
        .and_then(|r| r.try_get(0).ok())
        .unwrap_or(99.0);

    Ok(PgDatabaseMetrics {
        database_size,
        active_connections,
        idle_connections,
        total_connections,
        cache_hit_ratio,
    })
}
