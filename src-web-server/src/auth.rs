use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

pub const SESSION_COOKIE_NAME: &str = "tabularis_session";

pub type SessionFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionPrincipal {
    pub user_id: String,
}

pub trait SessionRepository: Send + Sync {
    fn create<'a>(
        &'a self,
        session_id: &'a str,
        user_id: &'a str,
        token_hash: &'a [u8],
        ttl_seconds: i32,
    ) -> SessionFuture<'a, ()>;

    fn resolve<'a>(&'a self, token_hash: &'a [u8]) -> SessionFuture<'a, Option<SessionPrincipal>>;

    fn revoke<'a>(&'a self, token_hash: &'a [u8]) -> SessionFuture<'a, ()>;
}

#[derive(Clone)]
pub struct PostgresSessionRepository {
    pool: PgPool,
}

impl PostgresSessionRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl SessionRepository for PostgresSessionRepository {
    fn create<'a>(
        &'a self,
        session_id: &'a str,
        user_id: &'a str,
        token_hash: &'a [u8],
        ttl_seconds: i32,
    ) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "INSERT INTO sessions (id, user_id, token_hash, expires_at) \
                 VALUES ($1, $2, $3, NOW() + make_interval(secs => $4))",
            )
            .bind(session_id)
            .bind(user_id)
            .bind(token_hash)
            .bind(ttl_seconds)
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|error| format!("Failed to create session: {error}"))
        })
    }

    fn resolve<'a>(&'a self, token_hash: &'a [u8]) -> SessionFuture<'a, Option<SessionPrincipal>> {
        Box::pin(async move {
            sqlx::query_scalar::<_, String>(
                "UPDATE sessions SET last_seen_at = NOW() \
                 WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW() \
                 RETURNING user_id",
            )
            .bind(token_hash)
            .fetch_optional(&self.pool)
            .await
            .map(|user_id| user_id.map(|user_id| SessionPrincipal { user_id }))
            .map_err(|error| format!("Failed to resolve session: {error}"))
        })
    }

    fn revoke<'a>(&'a self, token_hash: &'a [u8]) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "UPDATE sessions SET revoked_at = COALESCE(revoked_at, NOW()) \
                 WHERE token_hash = $1",
            )
            .bind(token_hash)
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|error| format!("Failed to revoke session: {error}"))
        })
    }
}

#[derive(Clone)]
pub struct AuthService {
    repository: Arc<dyn SessionRepository>,
    ttl_seconds: i32,
    secure_cookie: bool,
}

#[derive(Debug, Eq, PartialEq)]
pub enum AuthenticationError {
    Missing,
    Invalid,
    Repository(String),
}

impl AuthService {
    pub fn new(
        repository: Arc<dyn SessionRepository>,
        ttl_seconds: i32,
        secure_cookie: bool,
    ) -> Self {
        Self {
            repository,
            ttl_seconds,
            secure_cookie,
        }
    }

    pub async fn issue(&self, user_id: &str) -> Result<(SessionPrincipal, String), String> {
        let session_id = random_value(18);
        let token = random_value(32);
        self.repository
            .create(&session_id, user_id, &hash_token(&token), self.ttl_seconds)
            .await?;

        Ok((
            SessionPrincipal {
                user_id: user_id.to_string(),
            },
            self.session_cookie(&token),
        ))
    }

    pub async fn authenticate(
        &self,
        cookie_header: Option<&str>,
    ) -> Result<SessionPrincipal, AuthenticationError> {
        let token = session_token(cookie_header).ok_or(AuthenticationError::Missing)?;
        self.repository
            .resolve(&hash_token(token))
            .await
            .map_err(AuthenticationError::Repository)?
            .ok_or(AuthenticationError::Invalid)
    }

    pub async fn logout(&self, cookie_header: Option<&str>) -> Result<String, String> {
        if let Some(token) = session_token(cookie_header) {
            self.repository.revoke(&hash_token(token)).await?;
        }
        Ok(self.expired_session_cookie())
    }

    fn session_cookie(&self, token: &str) -> String {
        let secure = if self.secure_cookie { "; Secure" } else { "" };
        format!(
            "{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
            self.ttl_seconds, secure
        )
    }

    fn expired_session_cookie(&self) -> String {
        let secure = if self.secure_cookie { "; Secure" } else { "" };
        format!("{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}")
    }
}

fn random_value(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn session_token(cookie_header: Option<&str>) -> Option<&str> {
    cookie_header?.split(';').find_map(|cookie| {
        let (name, value) = cookie.trim().split_once('=')?;
        (name == SESSION_COOKIE_NAME && !value.is_empty()).then_some(value)
    })
}

#[cfg(test)]
mod tests;
