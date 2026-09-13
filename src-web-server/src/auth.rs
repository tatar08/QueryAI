use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

pub mod jwt;
pub mod oidc;
pub mod pin;
mod pin_persistence;
pub mod user;

pub use jwt::{JwtClaims, JwtService};
pub use oidc::{
    generate_pkce_challenge, MockOidcClient, OidcClaims, OidcClient, StandardOidcClient,
    OIDC_FLOW_COOKIE_NAME,
};
pub use pin::{validate_pin, PinAuthStore, PinUserRecord};
pub use user::{PostgresUserRepository, User, UserFuture, UserRepository};

pub const SESSION_COOKIE_NAME: &str = "tabularis_session";
pub const JWT_COOKIE_NAME: &str = "tabularis_jwt";

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

    fn revoke_all_for_user<'a>(&'a self, user_id: &'a str) -> SessionFuture<'a, ()>;
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

    fn revoke_all_for_user<'a>(&'a self, user_id: &'a str) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "UPDATE sessions SET revoked_at = COALESCE(revoked_at, NOW()) \
                 WHERE user_id = $1 AND revoked_at IS NULL",
            )
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|error| format!("Failed to revoke all sessions: {error}"))
        })
    }
}

#[derive(Clone)]
pub struct AuthService {
    repository: Arc<dyn SessionRepository>,
    ttl_seconds: i32,
    secure_cookie: bool,
    jwt: JwtService,
    pin_store: PinAuthStore,
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
        let mut secret = [0_u8; 32];
        OsRng.fill_bytes(&mut secret);
        let jwt = JwtService::new(&secret, ttl_seconds as u64);
        let pin_store = PinAuthStore::new();
        Self {
            repository,
            ttl_seconds,
            secure_cookie,
            jwt,
            pin_store,
        }
    }

    pub fn with_pin_store(mut self, store: PinAuthStore) -> Self {
        self.pin_store = store;
        self
    }

    pub fn with_jwt_secret(mut self, secret: &[u8]) -> Self {
        self.jwt = JwtService::new(secret, self.ttl_seconds as u64);
        self
    }

    pub fn jwt(&self) -> &JwtService {
        &self.jwt
    }

    pub fn pin_store(&self) -> &PinAuthStore {
        &self.pin_store
    }

    pub fn jwt_cookie(&self, token: &str) -> String {
        let secure = if self.secure_cookie { "; Secure" } else { "" };
        format!(
            "{JWT_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
            self.jwt.ttl_seconds(),
            secure
        )
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
        self.authenticate_request(cookie_header, None).await
    }

    pub async fn authenticate_request(
        &self,
        cookie_header: Option<&str>,
        auth_header: Option<&str>,
    ) -> Result<SessionPrincipal, AuthenticationError> {
        // Explicit credentials take precedence; invalid credentials never fall back.
        let jwt_token = if let Some(header) = auth_header {
            Some(
                header
                    .strip_prefix("Bearer ")
                    .or_else(|| header.strip_prefix("bearer "))
                    .ok_or(AuthenticationError::Invalid)?
                    .trim(),
            )
        } else {
            jwt_token_from_cookie(cookie_header)
        };
        if let Some(token) = jwt_token {
            let claims = self
                .jwt
                .verify(token)
                .map_err(|_| AuthenticationError::Invalid)?;
            let principal = self
                .repository
                .resolve(&hash_token(token))
                .await
                .map_err(AuthenticationError::Repository)?
                .ok_or(AuthenticationError::Invalid)?;
            return if principal.user_id == claims.sub {
                Ok(principal)
            } else {
                Err(AuthenticationError::Invalid)
            };
        }
        let token = session_token(cookie_header).ok_or(AuthenticationError::Missing)?;
        self.repository
            .resolve(&hash_token(token))
            .await
            .map_err(AuthenticationError::Repository)?
            .ok_or(AuthenticationError::Invalid)
    }

    pub async fn issue_pin_token(&self, user_id: &str, username: &str) -> Result<String, String> {
        let token = self.jwt.issue(user_id, username)?;
        self.repository
            .create(
                &random_value(18),
                user_id,
                &hash_token(&token),
                self.ttl_seconds,
            )
            .await?;
        Ok(token)
    }

    pub fn expired_jwt_cookie(&self) -> String {
        let secure = if self.secure_cookie { "; Secure" } else { "" };
        format!("{JWT_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}")
    }

    pub async fn revoke_bearer(&self, header: Option<&str>) -> Result<(), String> {
        if let Some(token) = header.and_then(|h| {
            h.strip_prefix("Bearer ")
                .or_else(|| h.strip_prefix("bearer "))
        }) {
            self.repository.revoke(&hash_token(token.trim())).await?;
        }
        Ok(())
    }

    pub async fn logout(&self, cookie_header: Option<&str>) -> Result<String, String> {
        if let Some(token) = session_token(cookie_header) {
            self.repository.revoke(&hash_token(token)).await?;
        }
        if let Some(token) = jwt_token_from_cookie(cookie_header) {
            self.repository.revoke(&hash_token(token)).await?;
        }
        Ok(self.expired_session_cookie())
    }

    pub async fn logout_all(&self, user_id: &str) -> Result<String, String> {
        self.repository.revoke_all_for_user(user_id).await?;
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

pub fn random_value(byte_count: usize) -> String {
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

fn jwt_token_from_cookie(cookie_header: Option<&str>) -> Option<&str> {
    cookie_header?.split(';').find_map(|cookie| {
        let (name, value) = cookie.trim().split_once('=')?;
        (name == JWT_COOKIE_NAME && !value.is_empty()).then_some(value)
    })
}

#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) mod session_test_repository;
