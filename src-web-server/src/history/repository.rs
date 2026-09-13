use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use sqlx::PgPool;

use super::models::{QueryHistoryEntry, RecordQueryFinishInput, RecordQueryStartInput};

pub type HistoryFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait QueryHistoryRepository: Send + Sync {
    fn record_start<'a>(&'a self, input: RecordQueryStartInput) -> HistoryFuture<'a, ()>;
    fn record_finish<'a>(&'a self, input: RecordQueryFinishInput) -> HistoryFuture<'a, ()>;
    fn list_for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: Option<&'a str>,
        limit: i64,
        offset: i64,
    ) -> HistoryFuture<'a, Vec<QueryHistoryEntry>>;
}

#[derive(Clone)]
pub struct PostgresQueryHistoryRepository {
    pool: PgPool,
}

impl PostgresQueryHistoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl QueryHistoryRepository for PostgresQueryHistoryRepository {
    fn record_start<'a>(&'a self, input: RecordQueryStartInput) -> HistoryFuture<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "INSERT INTO query_history (id, workspace_id, user_id, connection_id, database_name, query_text, status) \
                 VALUES ($1, $2, $3, $4, $5, $6, 'running')",
            )
            .bind(input.id)
            .bind(input.workspace_id)
            .bind(input.user_id)
            .bind(input.connection_id)
            .bind(input.database_name)
            .bind(input.query_text)
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|e| format!("Failed to record query start: {e}"))
        })
    }

    fn record_finish<'a>(&'a self, input: RecordQueryFinishInput) -> HistoryFuture<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "UPDATE query_history \
                 SET status = $2, duration_ms = $3, rows_affected = $4, error_code = $5, completed_at = NOW() \
                 WHERE id = $1",
            )
            .bind(input.id)
            .bind(input.status)
            .bind(input.duration_ms)
            .bind(input.rows_affected)
            .bind(input.error_code)
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|e| format!("Failed to record query finish: {e}"))
        })
    }

    fn list_for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: Option<&'a str>,
        limit: i64,
        offset: i64,
    ) -> HistoryFuture<'a, Vec<QueryHistoryEntry>> {
        Box::pin(async move {
            let rows = if let Some(uid) = user_id {
                sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, String, String, Option<i64>, Option<i64>, Option<String>, String, Option<String>)>(
                    "SELECT id, workspace_id, user_id, connection_id, database_name, query_text, status, duration_ms, rows_affected, error_code, \
                            to_char(started_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS started_at, \
                            to_char(completed_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS completed_at \
                     FROM query_history \
                     WHERE workspace_id = $1 AND user_id = $2 \
                     ORDER BY started_at DESC \
                     LIMIT $3 OFFSET $4",
                )
                .bind(workspace_id)
                .bind(uid)
                .bind(limit)
                .bind(offset)
                .fetch_all(&self.pool)
                .await
            } else {
                sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, String, String, Option<i64>, Option<i64>, Option<String>, String, Option<String>)>(
                    "SELECT id, workspace_id, user_id, connection_id, database_name, query_text, status, duration_ms, rows_affected, error_code, \
                            to_char(started_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS started_at, \
                            to_char(completed_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS completed_at \
                     FROM query_history \
                     WHERE workspace_id = $1 \
                     ORDER BY started_at DESC \
                     LIMIT $2 OFFSET $3",
                )
                .bind(workspace_id)
                .bind(limit)
                .bind(offset)
                .fetch_all(&self.pool)
                .await
            }
            .map_err(|e| format!("Failed to list query history: {e}"))?;

            Ok(rows
                .into_iter()
                .map(|r| QueryHistoryEntry {
                    id: r.0,
                    workspace_id: r.1,
                    user_id: r.2,
                    connection_id: r.3,
                    database_name: r.4,
                    query_text: r.5,
                    status: r.6,
                    duration_ms: r.7,
                    rows_affected: r.8,
                    error_code: r.9,
                    started_at: r.10,
                    completed_at: r.11,
                })
                .collect())
        })
    }
}

#[derive(Clone, Default)]
pub struct MemoryQueryHistoryRepository {
    entries: Arc<Mutex<Vec<QueryHistoryEntry>>>,
}

impl MemoryQueryHistoryRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

impl QueryHistoryRepository for MemoryQueryHistoryRepository {
    fn record_start<'a>(&'a self, input: RecordQueryStartInput) -> HistoryFuture<'a, ()> {
        Box::pin(async move {
            let mut guard = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            guard.push(QueryHistoryEntry {
                id: input.id,
                workspace_id: input.workspace_id,
                user_id: input.user_id,
                connection_id: input.connection_id,
                database_name: input.database_name,
                query_text: input.query_text,
                status: "running".to_string(),
                duration_ms: None,
                rows_affected: None,
                error_code: None,
                started_at: "2026-09-06T00:00:00Z".to_string(),
                completed_at: None,
            });
            Ok(())
        })
    }

    fn record_finish<'a>(&'a self, input: RecordQueryFinishInput) -> HistoryFuture<'a, ()> {
        Box::pin(async move {
            let mut guard = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(entry) = guard.iter_mut().find(|e| e.id == input.id) {
                entry.status = input.status;
                entry.duration_ms = Some(input.duration_ms);
                entry.rows_affected = input.rows_affected;
                entry.error_code = input.error_code;
                entry.completed_at = Some("2026-09-06T00:00:01Z".to_string());
            }
            Ok(())
        })
    }

    fn list_for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: Option<&'a str>,
        limit: i64,
        offset: i64,
    ) -> HistoryFuture<'a, Vec<QueryHistoryEntry>> {
        Box::pin(async move {
            let guard = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            let matches: Vec<QueryHistoryEntry> = guard
                .iter()
                .filter(|e| {
                    e.workspace_id == workspace_id && user_id.map_or(true, |uid| e.user_id == uid)
                })
                .cloned()
                .collect();

            let total = matches.len() as i64;
            let start = offset.min(total) as usize;
            let end = (start as i64 + limit).min(total) as usize;
            Ok(matches[start..end].to_vec())
        })
    }
}
