use std::future::Future;
use std::pin::Pin;

use serde_json::Value;
use sqlx::PgPool;

use super::models::ConnectionSummary;
use crate::crypto::KeyManager;

pub type ConnectionFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait ConnectionRepository: Send + Sync {
    fn create<'a>(
        &'a self,
        id: &'a str,
        workspace_id: &'a str,
        name: &'a str,
        driver: &'a str,
        public_params: Value,
        environment: Option<&'a str>,
        credentials: Option<Value>,
        created_by: &'a str,
    ) -> ConnectionFuture<'a, ConnectionSummary>;

    fn list_for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
    ) -> ConnectionFuture<'a, Vec<ConnectionSummary>>;

    fn get_by_id<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
    ) -> ConnectionFuture<'a, Option<ConnectionSummary>>;

    fn update<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
        name: Option<&'a str>,
        driver: Option<&'a str>,
        public_params: Option<Value>,
        environment: Option<&'a str>,
        credentials: Option<Value>,
        updated_by: &'a str,
    ) -> ConnectionFuture<'a, ConnectionSummary>;

    fn delete<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
    ) -> ConnectionFuture<'a, ()>;

    fn get_credentials<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
    ) -> ConnectionFuture<'a, Option<Value>>;
}

#[derive(Clone)]
pub struct PostgresConnectionRepository {
    pool: PgPool,
    key_manager: KeyManager,
}

impl PostgresConnectionRepository {
    pub fn new(pool: PgPool, key_manager: KeyManager) -> Self {
        Self { pool, key_manager }
    }
}

impl ConnectionRepository for PostgresConnectionRepository {
    fn create<'a>(
        &'a self,
        id: &'a str,
        workspace_id: &'a str,
        name: &'a str,
        driver: &'a str,
        public_params: Value,
        environment: Option<&'a str>,
        credentials: Option<Value>,
        created_by: &'a str,
    ) -> ConnectionFuture<'a, ConnectionSummary> {
        Box::pin(async move {
            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|error| format!("Failed to begin transaction: {error}"))?;

            #[derive(sqlx::FromRow)]
            struct ConnRow {
                id: String,
                workspace_id: String,
                name: String,
                driver: String,
                public_params: Value,
                environment: Option<String>,
                created_by: String,
                created_at: String,
                updated_at: String,
            }

            let row = sqlx::query_as::<_, ConnRow>(
                "INSERT INTO connections (id, workspace_id, name, driver, public_params, environment, created_by) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7) \
                 RETURNING id, workspace_id, name, driver, public_params, environment, created_by, created_at::TEXT, updated_at::TEXT",
            )
            .bind(id)
            .bind(workspace_id)
            .bind(name)
            .bind(driver)
            .bind(&public_params)
            .bind(environment)
            .bind(created_by)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| format!("Failed to insert connection: {error}"))?;

            if let Some(creds) = credentials {
                let plaintext = serde_json::to_vec(&creds)
                    .map_err(|error| format!("Failed to serialize credentials: {error}"))?;
                let encrypted = self
                    .key_manager
                    .encrypt(&plaintext)
                    .map_err(|error| format!("Failed to encrypt credentials: {error}"))?;

                sqlx::query(
                    "INSERT INTO connection_credentials (connection_id, ciphertext, nonce, key_version, updated_by) \
                     VALUES ($1, $2, $3, $4, $5)",
                )
                .bind(id)
                .bind(&encrypted.ciphertext)
                .bind(&encrypted.nonce)
                .bind(encrypted.key_version)
                .bind(created_by)
                .execute(&mut *tx)
                .await
                .map_err(|error| format!("Failed to insert connection credentials: {error}"))?;
            }

            tx.commit()
                .await
                .map_err(|error| format!("Failed to commit connection creation: {error}"))?;

            Ok(ConnectionSummary {
                id: row.id,
                workspace_id: row.workspace_id,
                name: row.name,
                driver: row.driver,
                public_params: row.public_params,
                environment: row.environment,
                created_by: row.created_by,
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
        })
    }

    fn list_for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
    ) -> ConnectionFuture<'a, Vec<ConnectionSummary>> {
        Box::pin(async move {
            #[derive(sqlx::FromRow)]
            struct ConnRow {
                id: String,
                workspace_id: String,
                name: String,
                driver: String,
                public_params: Value,
                environment: Option<String>,
                created_by: String,
                created_at: String,
                updated_at: String,
            }

            let rows = sqlx::query_as::<_, ConnRow>(
                "SELECT id, workspace_id, name, driver, public_params, environment, created_by, created_at::TEXT, updated_at::TEXT \
                 FROM connections \
                 WHERE workspace_id = $1 \
                 ORDER BY name ASC",
            )
            .bind(workspace_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|error| format!("Failed to list connections: {error}"))?;

            Ok(rows
                .into_iter()
                .map(|r| ConnectionSummary {
                    id: r.id,
                    workspace_id: r.workspace_id,
                    name: r.name,
                    driver: r.driver,
                    public_params: r.public_params,
                    environment: r.environment,
                    created_by: r.created_by,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                })
                .collect())
        })
    }

    fn get_by_id<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
    ) -> ConnectionFuture<'a, Option<ConnectionSummary>> {
        Box::pin(async move {
            #[derive(sqlx::FromRow)]
            struct ConnRow {
                id: String,
                workspace_id: String,
                name: String,
                driver: String,
                public_params: Value,
                environment: Option<String>,
                created_by: String,
                created_at: String,
                updated_at: String,
            }

            let row = sqlx::query_as::<_, ConnRow>(
                "SELECT id, workspace_id, name, driver, public_params, environment, created_by, created_at::TEXT, updated_at::TEXT \
                 FROM connections \
                 WHERE workspace_id = $1 AND id = $2",
            )
            .bind(workspace_id)
            .bind(connection_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| format!("Failed to get connection: {error}"))?;

            Ok(row.map(|r| ConnectionSummary {
                id: r.id,
                workspace_id: r.workspace_id,
                name: r.name,
                driver: r.driver,
                public_params: r.public_params,
                environment: r.environment,
                created_by: r.created_by,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }))
        })
    }

    fn update<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
        name: Option<&'a str>,
        driver: Option<&'a str>,
        public_params: Option<Value>,
        environment: Option<&'a str>,
        credentials: Option<Value>,
        updated_by: &'a str,
    ) -> ConnectionFuture<'a, ConnectionSummary> {
        Box::pin(async move {
            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|error| format!("Failed to begin transaction: {error}"))?;

            #[derive(sqlx::FromRow)]
            struct ConnRow {
                id: String,
                workspace_id: String,
                name: String,
                driver: String,
                public_params: Value,
                environment: Option<String>,
                created_by: String,
                created_at: String,
                updated_at: String,
            }

            let row = sqlx::query_as::<_, ConnRow>(
                "UPDATE connections SET \
                     name = COALESCE($3, name), \
                     driver = COALESCE($4, driver), \
                     public_params = COALESCE($5, public_params), \
                     environment = COALESCE($6, environment), \
                     updated_at = NOW() \
                 WHERE workspace_id = $1 AND id = $2 \
                 RETURNING id, workspace_id, name, driver, public_params, environment, created_by, created_at::TEXT, updated_at::TEXT",
            )
            .bind(workspace_id)
            .bind(connection_id)
            .bind(name)
            .bind(driver)
            .bind(public_params)
            .bind(environment)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| format!("Failed to update connection: {error}"))?;

            if let Some(creds) = credentials {
                let plaintext = serde_json::to_vec(&creds)
                    .map_err(|error| format!("Failed to serialize credentials: {error}"))?;
                let encrypted = self
                    .key_manager
                    .encrypt(&plaintext)
                    .map_err(|error| format!("Failed to encrypt credentials: {error}"))?;

                sqlx::query(
                    "INSERT INTO connection_credentials (connection_id, ciphertext, nonce, key_version, updated_by) \
                     VALUES ($1, $2, $3, $4, $5) \
                     ON CONFLICT (connection_id) DO UPDATE SET \
                         ciphertext = EXCLUDED.ciphertext, \
                         nonce = EXCLUDED.nonce, \
                         key_version = EXCLUDED.key_version, \
                         updated_by = EXCLUDED.updated_by, \
                         updated_at = NOW()",
                )
                .bind(connection_id)
                .bind(&encrypted.ciphertext)
                .bind(&encrypted.nonce)
                .bind(encrypted.key_version)
                .bind(updated_by)
                .execute(&mut *tx)
                .await
                .map_err(|error| format!("Failed to update credentials: {error}"))?;
            }

            tx.commit()
                .await
                .map_err(|error| format!("Failed to commit connection update: {error}"))?;

            Ok(ConnectionSummary {
                id: row.id,
                workspace_id: row.workspace_id,
                name: row.name,
                driver: row.driver,
                public_params: row.public_params,
                environment: row.environment,
                created_by: row.created_by,
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
        })
    }

    fn delete<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
    ) -> ConnectionFuture<'a, ()> {
        Box::pin(async move {
            let res = sqlx::query("DELETE FROM connections WHERE workspace_id = $1 AND id = $2")
                .bind(workspace_id)
                .bind(connection_id)
                .execute(&self.pool)
                .await
                .map_err(|error| format!("Failed to delete connection: {error}"))?;

            if res.rows_affected() == 0 {
                return Err("Connection not found".to_string());
            }

            Ok(())
        })
    }

    fn get_credentials<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
    ) -> ConnectionFuture<'a, Option<Value>> {
        Box::pin(async move {
            #[derive(sqlx::FromRow)]
            struct CredRow {
                ciphertext: Vec<u8>,
                nonce: Vec<u8>,
                key_version: i32,
            }

            let row = sqlx::query_as::<_, CredRow>(
                "SELECT cc.ciphertext, cc.nonce, cc.key_version \
                 FROM connection_credentials cc \
                 INNER JOIN connections c ON cc.connection_id = c.id \
                 WHERE c.workspace_id = $1 AND c.id = $2",
            )
            .bind(workspace_id)
            .bind(connection_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| format!("Failed to fetch connection credentials: {error}"))?;

            let Some(row) = row else {
                return Ok(None);
            };

            let decrypted_bytes = self
                .key_manager
                .decrypt(&row.ciphertext, &row.nonce, row.key_version)
                .map_err(|error| format!("Failed to decrypt connection credentials: {error}"))?;

            let creds: Value = serde_json::from_slice(&decrypted_bytes)
                .map_err(|error| format!("Failed to deserialize credentials JSON: {error}"))?;

            Ok(Some(creds))
        })
    }
}
