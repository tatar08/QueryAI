use sqlx::PgPool;
use std::future::Future;
use std::pin::Pin;

pub type UserFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct User {
    pub id: String,
    pub oidc_issuer: String,
    pub oidc_subject: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

pub trait UserRepository: Send + Sync {
    fn find_or_create<'a>(
        &'a self,
        issuer: &'a str,
        subject: &'a str,
        email: Option<&'a str>,
        display_name: Option<&'a str>,
    ) -> UserFuture<'a, User>;

    fn find_by_id<'a>(&'a self, user_id: &'a str) -> UserFuture<'a, Option<User>>;
}

#[derive(Clone)]
pub struct PostgresUserRepository {
    pool: PgPool,
}

impl PostgresUserRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl UserRepository for PostgresUserRepository {
    fn find_or_create<'a>(
        &'a self,
        issuer: &'a str,
        subject: &'a str,
        email: Option<&'a str>,
        display_name: Option<&'a str>,
    ) -> UserFuture<'a, User> {
        Box::pin(async move {
            let new_id = format!("usr_{}", crate::auth::random_value(16));
            #[derive(sqlx::FromRow)]
            struct Row {
                id: String,
                oidc_issuer: String,
                oidc_subject: String,
                email: Option<String>,
                display_name: Option<String>,
            }

            let row = sqlx::query_as::<_, Row>(
                "INSERT INTO users (id, oidc_issuer, oidc_subject, email, display_name) \
                 VALUES ($1, $2, $3, $4, $5) \
                 ON CONFLICT (oidc_issuer, oidc_subject) \
                 DO UPDATE SET \
                     email = COALESCE(EXCLUDED.email, users.email), \
                     display_name = COALESCE(EXCLUDED.display_name, users.display_name), \
                     updated_at = NOW() \
                 RETURNING id, oidc_issuer, oidc_subject, email, display_name",
            )
            .bind(new_id)
            .bind(issuer)
            .bind(subject)
            .bind(email)
            .bind(display_name)
            .fetch_one(&self.pool)
            .await
            .map_err(|error| format!("Failed to find or create user: {error}"))?;

            Ok(User {
                id: row.id,
                oidc_issuer: row.oidc_issuer,
                oidc_subject: row.oidc_subject,
                email: row.email,
                display_name: row.display_name,
            })
        })
    }

    fn find_by_id<'a>(&'a self, user_id: &'a str) -> UserFuture<'a, Option<User>> {
        Box::pin(async move {
            #[derive(sqlx::FromRow)]
            struct Row {
                id: String,
                oidc_issuer: String,
                oidc_subject: String,
                email: Option<String>,
                display_name: Option<String>,
            }

            let row = sqlx::query_as::<_, Row>(
                "SELECT id, oidc_issuer, oidc_subject, email, display_name \
                 FROM users \
                 WHERE id = $1",
            )
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| format!("Failed to find user by id: {error}"))?;

            Ok(row.map(|row| User {
                id: row.id,
                oidc_issuer: row.oidc_issuer,
                oidc_subject: row.oidc_subject,
                email: row.email,
                display_name: row.display_name,
            }))
        })
    }
}
