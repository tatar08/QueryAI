use crate::pools::{PoolFuture, TenantDatabaseSession};
use futures_util::{pin_mut, StreamExt};
use postgres_native_tls::MakeTlsConnector;
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use tabularis_core::SchemaResource;
use tokio::sync::Mutex;
use tokio_postgres::{Client, Config, SimpleQueryMessage};

pub struct PostgresSession {
    client: Mutex<Client>,
    cancel: tokio_postgres::CancelToken,
    tls: MakeTlsConnector,
}

impl PostgresSession {
    pub async fn connect(params: &Value, credentials: &Value) -> Result<Arc<Self>, String> {
        let mut config = Config::new();
        config.host(params["host"].as_str().unwrap_or("localhost"));
        let port = params["port"].as_u64().unwrap_or(5432);
        config.port(u16::try_from(port).map_err(|_| "Invalid PostgreSQL port")?);
        config.dbname(params["database"].as_str().unwrap_or("postgres"));
        config.user(
            credentials["username"]
                .as_str()
                .or(credentials["user"].as_str())
                .or(params["username"].as_str())
                .or(params["user"].as_str())
                .unwrap_or("postgres"),
        );
        if let Some(password) = credentials["password"].as_str() {
            config.password(password);
        }
        config.connect_timeout(Duration::from_secs(10));
        config.ssl_mode(if params["ssl"].as_bool() == Some(false) {
            tokio_postgres::config::SslMode::Disable
        } else {
            tokio_postgres::config::SslMode::Require
        });
        let tls = MakeTlsConnector::new(
            native_tls::TlsConnector::builder()
                .build()
                .map_err(|e| e.to_string())?,
        );
        let (client, connection) = config.connect(tls.clone()).await.map_err(|error| {
            tracing::warn!(%error, "Target PostgreSQL connection failed");
            "Unable to connect to target PostgreSQL database".to_string()
        })?;
        tokio::spawn(async move {
            if let Err(error) = connection.await {
                tracing::warn!(%error, "Target database session closed");
            }
        });
        let cancel = client.cancel_token();
        Ok(Arc::new(Self {
            client: Mutex::new(client),
            cancel,
            tls,
        }))
    }

    async fn run(
        &self,
        sql: &str,
        limit: Option<u32>,
        page: u32,
        schema: Option<&str>,
        read_only: bool,
    ) -> Result<Value, String> {
        use sqlparser::{ast::Statement, dialect::PostgreSqlDialect, parser::Parser};
        let statements = Parser::parse_sql(&PostgreSqlDialect {}, sql)
            .map_err(|_| "Unsupported or invalid SQL")?;
        if statements.len() != 1
            || matches!(
                statements[0],
                Statement::StartTransaction { .. }
                    | Statement::Commit { .. }
                    | Statement::Rollback { .. }
                    | Statement::Set(_)
                    | Statement::Copy { .. }
            )
        {
            return Err("Execute one statement at a time; transaction/session control is managed by the server".into());
        }
        let mut client = self.client.lock().await;
        let transaction = client
            .build_transaction()
            .read_only(read_only)
            .start()
            .await
            .map_err(|e| e.to_string())?;
        transaction
            .batch_execute("SET LOCAL statement_timeout = '30s'; SET LOCAL lock_timeout = '5s'")
            .await
            .map_err(|e| e.to_string())?;
        if let Some(schema) = schema {
            transaction
                .query_one(
                    "SELECT pg_catalog.set_config('search_path', pg_catalog.quote_ident($1), true)",
                    &[&schema],
                )
                .await
                .map_err(|e| e.to_string())?;
        }
        let count = limit.unwrap_or(1000).clamp(1, 10_000) as usize;
        let skip = (page.max(1) as usize - 1)
            .checked_mul(count)
            .ok_or("Page is too large")?;
        let mut columns = Vec::new();
        let mut rows = Vec::new();
        let mut seen = 0usize;
        let mut bytes = 0usize;
        let mut affected = 0u64;
        {
            let stream = transaction
                .client()
                .simple_query_raw(sql)
                .await
                .map_err(|e| e.to_string())?;
            pin_mut!(stream);
            while let Some(message) = stream.next().await {
                match message.map_err(|e| e.to_string())? {
                    SimpleQueryMessage::RowDescription(description) => {
                        columns = description
                            .iter()
                            .map(|c| c.name().to_owned())
                            .collect::<Vec<_>>();
                    }
                    SimpleQueryMessage::Row(row) => {
                        if seen >= skip && rows.len() < count {
                            let cells: Vec<Value> = (0..row.len())
                                .map(|i| {
                                    row.get(i)
                                        .map(|s| {
                                            bytes += s.len();
                                            Value::String(s.into())
                                        })
                                        .unwrap_or(Value::Null)
                                })
                                .collect();
                            if bytes > 16 * 1024 * 1024 {
                                return Err(
                                    "Result exceeds 16 MiB; select fewer rows or columns".into()
                                );
                            }
                            rows.push(cells);
                        }
                        seen += 1;
                    }
                    SimpleQueryMessage::CommandComplete(n) => affected += n,
                    _ => {}
                }
            }
        }
        transaction.commit().await.map_err(|e| e.to_string())?;
        Ok(
            json!({"columns": columns, "rows": rows, "affected_rows": affected, "has_more": seen > skip + count}),
        )
    }
}

impl TenantDatabaseSession for PostgresSession {
    fn is_closed(&self) -> bool {
        self.client
            .try_lock()
            .map(|client| client.is_closed())
            .unwrap_or(false)
    }

    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        limit: Option<u32>,
        page: u32,
        schema: Option<&'a str>,
    ) -> PoolFuture<'a, Value> {
        Box::pin(self.run(sql, limit, page, schema, false))
    }
    fn execute_with_policy<'a>(
        &'a self,
        sql: &'a str,
        limit: Option<u32>,
        page: u32,
        schema: Option<&'a str>,
        read_only: bool,
    ) -> PoolFuture<'a, Value> {
        Box::pin(self.run(sql, limit, page, schema, read_only))
    }
    fn discover_schema<'a>(
        &'a self,
        resource: SchemaResource,
        schema: Option<&'a str>,
    ) -> PoolFuture<'a, Vec<Value>> {
        Box::pin(async move {
            let (sql, needs_schema) = match resource {
                SchemaResource::Databases => ("SELECT datname AS name FROM pg_catalog.pg_database WHERE datallowconn ORDER BY datname", false),
                SchemaResource::Schemas => ("SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name", false),
                SchemaResource::Tables => ("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name", true),
                SchemaResource::Views => ("SELECT table_name AS name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name", true),
                SchemaResource::MaterializedViews => ("SELECT matviewname AS name FROM pg_catalog.pg_matviews WHERE schemaname = $1 ORDER BY matviewname", true),
                SchemaResource::Routines => ("SELECT routine_name AS name FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name", true),
                SchemaResource::Triggers => ("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = $1 ORDER BY trigger_name", true),
            };
            let client = self.client.lock().await;
            let schema = schema.unwrap_or("public");
            let args: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
                if needs_schema { vec![&schema] } else { vec![] };
            let rows = tokio::time::timeout(Duration::from_secs(10), client.query(sql, &args))
                .await
                .map_err(|_| "Schema discovery timed out")?
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|row| json!({"name": row.get::<_, String>(0)}))
                .collect())
        })
    }
    fn cancel(&self) -> Result<(), String> {
        let cancel = self.cancel.clone();
        let tls = self.tls.clone();
        tokio::spawn(async move {
            if let Err(error) = cancel.cancel_query(tls).await {
                tracing::warn!(%error, "Query cancellation failed");
            }
        });
        Ok(())
    }
}
