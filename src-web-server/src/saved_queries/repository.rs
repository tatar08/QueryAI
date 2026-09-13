use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use sqlx::PgPool;

use super::models::SavedQuery;

pub type SavedQueryFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait SavedQueryRepository: Send + Sync {
    fn create<'a>(
        &'a self,
        id: &'a str,
        workspace_id: &'a str,
        created_by: &'a str,
        name: &'a str,
        query_text: &'a str,
        is_shared: bool,
    ) -> SavedQueryFuture<'a, SavedQuery>;

    fn list_for_user<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> SavedQueryFuture<'a, Vec<SavedQuery>>;

    fn get_by_id<'a>(
        &'a self,
        workspace_id: &'a str,
        query_id: &'a str,
    ) -> SavedQueryFuture<'a, Option<SavedQuery>>;

    fn update<'a>(
        &'a self,
        workspace_id: &'a str,
        query_id: &'a str,
        name: Option<&'a str>,
        query_text: Option<&'a str>,
        is_shared: Option<bool>,
    ) -> SavedQueryFuture<'a, SavedQuery>;

    fn delete<'a>(&'a self, workspace_id: &'a str, query_id: &'a str) -> SavedQueryFuture<'a, ()>;
}

#[derive(Clone)]
pub struct PostgresSavedQueryRepository {
    pool: PgPool,
}

impl PostgresSavedQueryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl SavedQueryRepository for PostgresSavedQueryRepository {
    fn create<'a>(
        &'a self,
        id: &'a str,
        workspace_id: &'a str,
        created_by: &'a str,
        name: &'a str,
        query_text: &'a str,
        is_shared: bool,
    ) -> SavedQueryFuture<'a, SavedQuery> {
        Box::pin(async move {
            let row = sqlx::query_as::<_, (String, String, String, String, String, bool, String, String)>(
                "INSERT INTO saved_queries (id, workspace_id, created_by, name, query_text, is_shared) \
                 VALUES ($1, $2, $3, $4, $5, $6) \
                 RETURNING id, workspace_id, created_by, name, query_text, is_shared, \
                           to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at, \
                           to_char(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at",
            )
            .bind(id)
            .bind(workspace_id)
            .bind(created_by)
            .bind(name)
            .bind(query_text)
            .bind(is_shared)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| format!("Failed to create saved query: {e}"))?;

            Ok(SavedQuery {
                id: row.0,
                workspace_id: row.1,
                created_by: row.2,
                name: row.3,
                query_text: row.4,
                is_shared: row.5,
                created_at: row.6,
                updated_at: row.7,
            })
        })
    }

    fn list_for_user<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> SavedQueryFuture<'a, Vec<SavedQuery>> {
        Box::pin(async move {
            let rows = sqlx::query_as::<
                _,
                (String, String, String, String, String, bool, String, String),
            >(
                "SELECT id, workspace_id, created_by, name, query_text, is_shared, \
                        to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at, \
                        to_char(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at \
                 FROM saved_queries \
                 WHERE workspace_id = $1 AND (created_by = $2 OR is_shared = TRUE) \
                 ORDER BY updated_at DESC",
            )
            .bind(workspace_id)
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("Failed to list saved queries: {e}"))?;

            Ok(rows
                .into_iter()
                .map(|r| SavedQuery {
                    id: r.0,
                    workspace_id: r.1,
                    created_by: r.2,
                    name: r.3,
                    query_text: r.4,
                    is_shared: r.5,
                    created_at: r.6,
                    updated_at: r.7,
                })
                .collect())
        })
    }

    fn get_by_id<'a>(
        &'a self,
        workspace_id: &'a str,
        query_id: &'a str,
    ) -> SavedQueryFuture<'a, Option<SavedQuery>> {
        Box::pin(async move {
            let row = sqlx::query_as::<
                _,
                (String, String, String, String, String, bool, String, String),
            >(
                "SELECT id, workspace_id, created_by, name, query_text, is_shared, \
                        to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at, \
                        to_char(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at \
                 FROM saved_queries \
                 WHERE workspace_id = $1 AND id = $2",
            )
            .bind(workspace_id)
            .bind(query_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| format!("Failed to get saved query: {e}"))?;

            Ok(row.map(|r| SavedQuery {
                id: r.0,
                workspace_id: r.1,
                created_by: r.2,
                name: r.3,
                query_text: r.4,
                is_shared: r.5,
                created_at: r.6,
                updated_at: r.7,
            }))
        })
    }

    fn update<'a>(
        &'a self,
        workspace_id: &'a str,
        query_id: &'a str,
        name: Option<&'a str>,
        query_text: Option<&'a str>,
        is_shared: Option<bool>,
    ) -> SavedQueryFuture<'a, SavedQuery> {
        Box::pin(async move {
            let row = sqlx::query_as::<
                _,
                (String, String, String, String, String, bool, String, String),
            >(
                "UPDATE saved_queries \
                 SET name = COALESCE($3, name), \
                     query_text = COALESCE($4, query_text), \
                     is_shared = COALESCE($5, is_shared), \
                     updated_at = NOW() \
                 WHERE workspace_id = $1 AND id = $2 \
                 RETURNING id, workspace_id, created_by, name, query_text, is_shared, \
                           to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at, \
                           to_char(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at",
            )
            .bind(workspace_id)
            .bind(query_id)
            .bind(name)
            .bind(query_text)
            .bind(is_shared)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| format!("Failed to update saved query: {e}"))?;

            Ok(SavedQuery {
                id: row.0,
                workspace_id: row.1,
                created_by: row.2,
                name: row.3,
                query_text: row.4,
                is_shared: row.5,
                created_at: row.6,
                updated_at: row.7,
            })
        })
    }

    fn delete<'a>(&'a self, workspace_id: &'a str, query_id: &'a str) -> SavedQueryFuture<'a, ()> {
        Box::pin(async move {
            sqlx::query("DELETE FROM saved_queries WHERE workspace_id = $1 AND id = $2")
                .bind(workspace_id)
                .bind(query_id)
                .execute(&self.pool)
                .await
                .map(|_| ())
                .map_err(|e| format!("Failed to delete saved query: {e}"))
        })
    }
}

#[derive(Clone, Default)]
pub struct MemorySavedQueryRepository {
    queries: Arc<Mutex<Vec<SavedQuery>>>,
}

impl MemorySavedQueryRepository {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SavedQueryRepository for MemorySavedQueryRepository {
    fn create<'a>(
        &'a self,
        id: &'a str,
        workspace_id: &'a str,
        created_by: &'a str,
        name: &'a str,
        query_text: &'a str,
        is_shared: bool,
    ) -> SavedQueryFuture<'a, SavedQuery> {
        Box::pin(async move {
            let mut guard = self.queries.lock().unwrap_or_else(|p| p.into_inner());
            if guard.iter().any(|q| {
                q.workspace_id == workspace_id && q.created_by == created_by && q.name == name
            }) {
                return Err(
                    "A saved query with this name already exists in the workspace".to_string(),
                );
            }

            let item = SavedQuery {
                id: id.to_string(),
                workspace_id: workspace_id.to_string(),
                created_by: created_by.to_string(),
                name: name.to_string(),
                query_text: query_text.to_string(),
                is_shared,
                created_at: "2026-09-06T00:00:00Z".to_string(),
                updated_at: "2026-09-06T00:00:00Z".to_string(),
            };
            guard.push(item.clone());
            Ok(item)
        })
    }

    fn list_for_user<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> SavedQueryFuture<'a, Vec<SavedQuery>> {
        Box::pin(async move {
            let guard = self.queries.lock().unwrap_or_else(|p| p.into_inner());
            let matches = guard
                .iter()
                .filter(|q| {
                    q.workspace_id == workspace_id && (q.created_by == user_id || q.is_shared)
                })
                .cloned()
                .collect();
            Ok(matches)
        })
    }

    fn get_by_id<'a>(
        &'a self,
        workspace_id: &'a str,
        query_id: &'a str,
    ) -> SavedQueryFuture<'a, Option<SavedQuery>> {
        Box::pin(async move {
            let guard = self.queries.lock().unwrap_or_else(|p| p.into_inner());
            Ok(guard
                .iter()
                .find(|q| q.workspace_id == workspace_id && q.id == query_id)
                .cloned())
        })
    }

    fn update<'a>(
        &'a self,
        workspace_id: &'a str,
        query_id: &'a str,
        name: Option<&'a str>,
        query_text: Option<&'a str>,
        is_shared: Option<bool>,
    ) -> SavedQueryFuture<'a, SavedQuery> {
        Box::pin(async move {
            let mut guard = self.queries.lock().unwrap_or_else(|p| p.into_inner());
            let item = guard
                .iter_mut()
                .find(|q| q.workspace_id == workspace_id && q.id == query_id)
                .ok_or_else(|| "Saved query not found".to_string())?;

            if let Some(n) = name {
                item.name = n.to_string();
            }
            if let Some(qt) = query_text {
                item.query_text = qt.to_string();
            }
            if let Some(shared) = is_shared {
                item.is_shared = shared;
            }
            item.updated_at = "2026-09-06T00:01:00Z".to_string();
            Ok(item.clone())
        })
    }

    fn delete<'a>(&'a self, workspace_id: &'a str, query_id: &'a str) -> SavedQueryFuture<'a, ()> {
        Box::pin(async move {
            let mut guard = self.queries.lock().unwrap_or_else(|p| p.into_inner());
            guard.retain(|q| !(q.workspace_id == workspace_id && q.id == query_id));
            Ok(())
        })
    }
}
