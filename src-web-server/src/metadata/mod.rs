use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

const READINESS_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct MetadataStore {
    pool: PgPool,
}

impl MetadataStore {
    pub async fn connect(database_url: &str, max_connections: u32) -> Result<Self, String> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .connect(database_url)
            .await
            .map_err(|error| format!("Failed to connect to metadata database: {error}"))?;

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|error| format!("Failed to migrate metadata database: {error}"))?;

        Ok(Self { pool })
    }

    pub async fn is_ready(&self) -> bool {
        matches!(
            tokio::time::timeout(
                READINESS_TIMEOUT,
                sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&self.pool),
            )
            .await,
            Ok(Ok(1))
        )
    }

    pub(crate) fn pool(&self) -> &PgPool {
        &self.pool
    }

    #[cfg(test)]
    pub(crate) fn connect_lazy(database_url: &str) -> Result<Self, String> {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy(database_url)
            .map_err(|error| format!("Failed to configure metadata database: {error}"))?;

        Ok(Self { pool })
    }
}

#[cfg(test)]
mod tests;
