pub mod audit;
pub mod auth;
pub mod config;
pub mod connections;
pub mod crypto;
pub mod engine;
pub mod history;
pub mod metadata;
pub mod pools;
pub mod saved_queries;
pub mod security;
pub mod tenancy;

use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::header::{AUTHORIZATION, COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tabularis_core::{
    ConnectionService, ConnectionValidationError, ConnectionValidationInput,
    ConnectionValidationResult, QueryCancellationRepository, QueryExecutionInput, QueryRepository,
    QueryService, QueryServiceError, SchemaDiscoveryInput, SchemaRepository, SchemaResource,
    SchemaService, SchemaServiceError,
};

pub use audit::{
    record_workspace_audit, AuditEventRecord, MemoryAuditRepository, PostgresAuditRepository,
    WorkspaceAuditContext, WorkspaceAuditInput, WorkspaceAuditRepository,
};
#[cfg(test)]
pub use auth::SessionRepository;
use auth::{
    generate_pkce_challenge, random_value, AuthService, AuthenticationError, OidcClient,
    PostgresSessionRepository, PostgresUserRepository, UserRepository, OIDC_FLOW_COOKIE_NAME,
};
pub use connections::{
    ConnectionFuture, ConnectionRepository, ConnectionSummary, CreateConnectionPayload,
    PostgresConnectionRepository, UpdateConnectionPayload,
};
pub use crypto::{EncryptedData, KeyManager};
pub use engine::{
    is_read_query, TenantQueryCancellationRepository, TenantQueryRepository, TenantSchemaRepository,
};
pub use history::{
    HistoryFuture, MemoryQueryHistoryRepository, PostgresQueryHistoryRepository, QueryHistoryEntry,
    QueryHistoryRepository, RecordQueryFinishInput, RecordQueryStartInput,
};
use metadata::MetadataStore;
pub use pools::{PoolFuture, TenantDatabaseSession, TenantPoolKey, TenantPoolManager};
pub use saved_queries::{
    CreateSavedQueryPayload, MemorySavedQueryRepository, PostgresSavedQueryRepository, SavedQuery,
    SavedQueryFuture, SavedQueryRepository, UpdateSavedQueryPayload,
};
pub use security::{RateLimiter, SecurityPolicy};
pub use tenancy::{
    MembershipRepository, PostgresMembershipRepository, PostgresWorkspaceRepository, Role,
    Workspace, WorkspaceMember, WorkspaceRepository,
};

#[derive(Clone)]
pub struct AppState {
    metadata: MetadataStore,
    session_creation: Arc<tokio::sync::Mutex<()>>,
    connections: ConnectionService,
    queries: QueryService,
    query_repository: Arc<dyn QueryRepository<Value>>,
    query_cancellation_repository: Arc<dyn QueryCancellationRepository>,
    schema: SchemaService,
    schema_repository: Arc<dyn SchemaRepository<Value>>,
    pub pool_manager: Arc<TenantPoolManager>,
    pub audit_repo: Arc<dyn WorkspaceAuditRepository>,
    pub saved_queries_repo: Arc<dyn SavedQueryRepository>,
    pub history_repo: Arc<dyn QueryHistoryRepository>,
    pub security_policy: SecurityPolicy,
    pub rate_limiter: RateLimiter,
    auth: AuthService,
    users: Arc<dyn UserRepository>,
    workspaces: Arc<dyn WorkspaceRepository>,
    memberships: Arc<dyn MembershipRepository>,
    connection_repo: Arc<dyn ConnectionRepository>,
    key_manager: KeyManager,
    oidc_client: Option<Arc<dyn OidcClient>>,
    allow_dev_login: bool,
    secure_cookie: bool,
}

impl AppState {
    pub async fn from_config(
        metadata: MetadataStore,
        config: &config::AppConfig,
    ) -> Result<Self, String> {
        let key_manager = config.secrets.key_manager()?;
        let mut state = Self::with_auth_settings(
            metadata,
            config.session_ttl_seconds,
            config.session_cookie_secure,
        )
        .with_key_manager(key_manager)
        .with_security_policy(SecurityPolicy::new(
            config.allowed_origins.clone(),
            config.deployment_mode == config::DeploymentMode::Production,
        ))
        .with_rate_limiter(RateLimiter::new(
            config.rate_limit_per_minute,
            config.rate_limit_burst,
        ))
        .with_dev_login(config.deployment_mode == config::DeploymentMode::Development);
        if let Some(secret) = &config.secrets.jwt {
            state.auth = state.auth.with_jwt_secret(secret);
        }
        if let Some(oidc) = &config.oidc {
            state = state
                .with_oidc_client(Arc::new(auth::StandardOidcClient::new(oidc.clone()).await?));
        }
        Ok(state)
    }

    pub fn new(metadata: MetadataStore) -> Self {
        Self::with_auth_settings(metadata, 8 * 60 * 60, false)
    }

    pub fn with_auth_settings(
        metadata: MetadataStore,
        session_ttl_seconds: i32,
        secure_cookie: bool,
    ) -> Self {
        let pool = metadata.pool().clone();
        let key_manager = KeyManager::dev_default();
        let session_repository = Arc::new(PostgresSessionRepository::new(pool.clone()));
        let users = Arc::new(PostgresUserRepository::new(pool.clone()));
        let workspaces = Arc::new(PostgresWorkspaceRepository::new(pool.clone()));
        let memberships = Arc::new(PostgresMembershipRepository::new(pool.clone()));
        let connection_repo = Arc::new(PostgresConnectionRepository::new(
            pool.clone(),
            key_manager.clone(),
        ));
        let pool_manager = Arc::new(TenantPoolManager::default_limits());
        let query_repository = Arc::new(engine::scoped::UnscopedRepository);
        let query_cancellation_repository = Arc::new(engine::scoped::UnscopedRepository);
        let schema_repository = Arc::new(engine::scoped::UnscopedRepository);
        let audit_repo = Arc::new(PostgresAuditRepository::new(pool.clone()));
        let saved_queries_repo = Arc::new(PostgresSavedQueryRepository::new(pool.clone()));
        let history_repo = Arc::new(PostgresQueryHistoryRepository::new(pool));
        Self {
            metadata: metadata.clone(),
            session_creation: Arc::new(tokio::sync::Mutex::new(())),
            connections: ConnectionService,
            queries: QueryService,
            query_repository,
            query_cancellation_repository,
            schema: SchemaService,
            schema_repository,
            pool_manager,
            audit_repo,
            saved_queries_repo,
            history_repo,
            security_policy: SecurityPolicy::default(),
            rate_limiter: RateLimiter::default(),
            auth: AuthService::new(session_repository, session_ttl_seconds, secure_cookie)
                .with_pin_store(auth::PinAuthStore::postgres(metadata.pool().clone())),
            users,
            workspaces,
            memberships,
            connection_repo,
            key_manager,
            oidc_client: None,
            allow_dev_login: !secure_cookie,
            secure_cookie,
        }
    }

    pub fn with_schema_repository(
        metadata: MetadataStore,
        schema_repository: Arc<dyn SchemaRepository<Value>>,
    ) -> Self {
        let mut state = Self::new(metadata);
        state.schema_repository = schema_repository;
        state
    }

    pub fn with_repositories(
        metadata: MetadataStore,
        schema_repository: Arc<dyn SchemaRepository<Value>>,
        query_repository: Arc<dyn QueryRepository<Value>>,
        query_cancellation_repository: Arc<dyn QueryCancellationRepository>,
    ) -> Self {
        let mut state = Self::new(metadata);
        state.schema_repository = schema_repository;
        state.query_repository = query_repository;
        state.query_cancellation_repository = query_cancellation_repository;
        state
    }

    pub fn with_connection_repository(
        mut self,
        connection_repo: Arc<dyn ConnectionRepository>,
    ) -> Self {
        self.connection_repo = connection_repo;
        self
    }

    pub fn with_pool_manager(mut self, pool_manager: Arc<TenantPoolManager>) -> Self {
        self.pool_manager = pool_manager;
        self
    }

    pub fn with_audit_repository(mut self, repo: Arc<dyn WorkspaceAuditRepository>) -> Self {
        self.audit_repo = repo;
        self
    }

    pub fn with_saved_queries_repository(mut self, repo: Arc<dyn SavedQueryRepository>) -> Self {
        self.saved_queries_repo = repo;
        self
    }

    pub fn with_history_repository(mut self, repo: Arc<dyn QueryHistoryRepository>) -> Self {
        self.history_repo = repo;
        self
    }

    pub fn with_key_manager(mut self, key_manager: KeyManager) -> Self {
        self.connection_repo = Arc::new(PostgresConnectionRepository::new(
            self.metadata.pool().clone(),
            key_manager.clone(),
        ));
        self.key_manager = key_manager;
        self
    }

    pub fn with_oidc_client(mut self, client: Arc<dyn OidcClient>) -> Self {
        self.oidc_client = Some(client);
        self
    }

    pub fn with_tenancy_repositories(
        mut self,
        workspaces: Arc<dyn WorkspaceRepository>,
        memberships: Arc<dyn MembershipRepository>,
        users: Arc<dyn UserRepository>,
    ) -> Self {
        self.workspaces = workspaces;
        self.memberships = memberships;
        self.users = users;
        self
    }

    pub fn with_dev_login(mut self, allow: bool) -> Self {
        self.allow_dev_login = allow;
        self
    }

    pub fn with_security_policy(mut self, policy: SecurityPolicy) -> Self {
        self.security_policy = policy;
        self
    }

    pub fn with_rate_limiter(mut self, rate_limiter: RateLimiter) -> Self {
        self.rate_limiter = rate_limiter;
        self
    }

    #[cfg(test)]
    pub fn with_session_repository(
        metadata: MetadataStore,
        session_repository: Arc<dyn SessionRepository>,
        secure_cookie: bool,
    ) -> Self {
        let mut state = Self::with_auth_settings(metadata, 8 * 60 * 60, secure_cookie);
        state.auth = AuthService::new(session_repository, 8 * 60 * 60, secure_cookie);
        state.audit_repo = Arc::new(MemoryAuditRepository::new());
        state.saved_queries_repo = Arc::new(MemorySavedQueryRepository::new());
        state.history_repo = Arc::new(MemoryQueryHistoryRepository::new());
        state.rate_limiter = RateLimiter::new(100_000, 10_000);
        state
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    service: &'static str,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidationErrorResponse {
    code: &'static str,
    message: String,
}

#[derive(Debug, Deserialize)]
struct SchemaQuery {
    resource: SchemaResource,
    schema: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryRequest {
    query: String,
    limit: Option<u32>,
    page: Option<u32>,
    schema: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    authenticated: bool,
    user_id: String,
}

pub fn app(state: AppState) -> Router {
    let security_policy = state.security_policy.clone();
    let cors_policy = state.security_policy.clone();
    let rate_limiter = state.rate_limiter.clone();

    Router::new()
        .route("/health/live", get(liveness))
        .route("/health/ready", get(readiness))
        .route("/api/v1/auth/session", get(get_session))
        .route("/api/v1/session", get(get_session))
        .route("/api/v1/auth/login", get(auth_login))
        .route("/api/v1/auth/callback", get(auth_callback))
        .route("/api/v1/auth/dev-login", post(auth_dev_login))
        .route("/api/v1/auth/pin/register", post(auth_pin_register))
        .route("/api/v1/auth/pin/login", post(auth_pin_login))
        .route("/api/v1/auth/pin/change", post(auth_pin_change))
        .route("/api/v1/auth/pin/me", get(auth_pin_me))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/logout", post(logout))
        .route("/api/v1/auth/logout-all", post(logout_all))
        .route(
            "/api/v1/workspaces",
            get(list_workspaces).post(create_workspace),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/members",
            get(list_workspace_members).post(add_workspace_member),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/members/{user_id}",
            delete(remove_workspace_member),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/connections",
            get(list_workspace_connections).post(create_workspace_connection),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/connections/{connection_id}",
            get(get_workspace_connection)
                .patch(update_workspace_connection)
                .delete(delete_workspace_connection),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/connections/{connection_id}/schema",
            get(discover_workspace_connection_schema),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/connections/{connection_id}/queries",
            post(execute_workspace_connection_query).delete(cancel_workspace_connection_query),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/audit-events",
            get(list_workspace_audit_events),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/saved-queries",
            get(list_workspace_saved_queries).post(create_workspace_saved_query),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/saved-queries/{query_id}",
            get(get_workspace_saved_query)
                .patch(update_workspace_saved_query)
                .delete(delete_workspace_saved_query),
        )
        .route(
            "/api/v1/workspaces/{workspace_id}/query-history",
            get(list_workspace_query_history),
        )
        .route("/api/v1/connections/validate", post(validate_connection))
        .route(
            "/api/v1/connections/{connection_id}/schema",
            get(discover_schema),
        )
        .route(
            "/api/v1/connections/{connection_id}/queries",
            post(execute_query).delete(cancel_query),
        )
        .layer(axum::middleware::from_fn(move |req, next| {
            let policy = security_policy.clone();
            security::security_headers_middleware(policy, req, next)
        }))
        .layer(axum::middleware::from_fn(move |req, next| {
            let policy = cors_policy.clone();
            security::cors_and_csrf_middleware(policy, req, next)
        }))
        .layer(axum::middleware::from_fn(move |req, next| {
            let limiter = rate_limiter.clone();
            security::rate_limit_middleware(limiter, req, next)
        }))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .with_state(state)
}

async fn get_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SessionResponse>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|value| value.to_str().ok());
    let auth = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    state
        .auth
        .authenticate_request(cookie, auth)
        .await
        .map(|principal| {
            Json(SessionResponse {
                authenticated: true,
                user_id: principal.user_id,
            })
        })
        .map_err(authentication_error_response)
}

async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let cookie = headers.get(COOKIE).and_then(|value| value.to_str().ok());
    if let Err(message) = state
        .auth
        .revoke_bearer(headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()))
        .await
    {
        tracing::error!(%message, "Failed to revoke bearer session");
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    match state.auth.logout(cookie).await {
        Ok(expired_cookie) => {
            let mut response = StatusCode::NO_CONTENT.into_response();
            if let Ok(value) = HeaderValue::from_str(&expired_cookie) {
                response.headers_mut().insert(SET_COOKIE, value);
            }
            if let Ok(value) = HeaderValue::from_str(&state.auth.expired_jwt_cookie()) {
                response.headers_mut().append(SET_COOKIE, value);
            }
            response
        }
        Err(message) => {
            tracing::error!(error = %message, "Failed to revoke server session");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "session_repository_error",
                    message: "The session service is temporarily unavailable".to_string(),
                }),
            )
                .into_response()
        }
    }
}

fn authentication_error_response(
    error: AuthenticationError,
) -> (StatusCode, Json<ValidationErrorResponse>) {
    match error {
        AuthenticationError::Missing | AuthenticationError::Invalid => (
            StatusCode::UNAUTHORIZED,
            Json(ValidationErrorResponse {
                code: "authentication_required",
                message: "A valid authenticated session is required".to_string(),
            }),
        ),
        AuthenticationError::Repository(message) => {
            tracing::error!(error = %message, "Failed to resolve server session");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "session_repository_error",
                    message: "The session service is temporarily unavailable".to_string(),
                }),
            )
        }
    }
}

async fn auth_login(State(state): State<AppState>) -> Response {
    let Some(oidc) = state.oidc_client.as_ref() else {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(ValidationErrorResponse {
                code: "oidc_not_configured",
                message: "OIDC provider is not configured on this server".to_string(),
            }),
        )
            .into_response();
    };

    let state_token = random_value(24);
    let code_verifier = random_value(32);
    let code_challenge = generate_pkce_challenge(&code_verifier);
    let auth_url = oidc.authorization_url(&state_token, &code_challenge);

    let secure = if state.secure_cookie { "; Secure" } else { "" };
    let flow_cookie = format!(
        "{OIDC_FLOW_COOKIE_NAME}={state_token}:{code_verifier}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300{secure}"
    );

    let mut response = StatusCode::FOUND.into_response();
    if let Ok(val) = HeaderValue::from_str(&auth_url) {
        response
            .headers_mut()
            .insert(axum::http::header::LOCATION, val);
    }
    if let Ok(val) = HeaderValue::from_str(&flow_cookie) {
        response.headers_mut().insert(SET_COOKIE, val);
    }
    response
}

#[derive(Debug, Deserialize)]
struct CallbackParams {
    code: String,
    state: String,
}

async fn auth_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Response {
    let Some(oidc) = state.oidc_client.as_ref() else {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(ValidationErrorResponse {
                code: "oidc_not_configured",
                message: "OIDC provider is not configured on this server".to_string(),
            }),
        )
            .into_response();
    };

    let cookie_header = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let flow_cookie = cookie_header.and_then(|h| {
        h.split(';').find_map(|c| {
            let (k, v) = c.trim().split_once('=')?;
            (k == OIDC_FLOW_COOKIE_NAME && !v.is_empty()).then_some(v)
        })
    });

    let Some((cookie_state, code_verifier)) = flow_cookie.and_then(|v| v.split_once(':')) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                code: "invalid_oidc_flow",
                message: "Missing or expired OIDC flow state".to_string(),
            }),
        )
            .into_response();
    };

    if cookie_state != params.state {
        return (
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                code: "state_mismatch",
                message: "OIDC state validation failed".to_string(),
            }),
        )
            .into_response();
    }

    let claims = match oidc.exchange_code(&params.code, code_verifier).await {
        Ok(claims) => claims,
        Err(err) => {
            tracing::error!(error = %err, "Failed to exchange OIDC authorization code");
            return (
                StatusCode::BAD_GATEWAY,
                Json(ValidationErrorResponse {
                    code: "oidc_exchange_failed",
                    message: "Failed to exchange authorization code with identity provider"
                        .to_string(),
                }),
            )
                .into_response();
        }
    };

    let user = match state
        .users
        .find_or_create(
            &claims.issuer,
            &claims.subject,
            claims.email.as_deref(),
            claims.display_name.as_deref(),
        )
        .await
    {
        Ok(user) => user,
        Err(err) => {
            tracing::error!(error = %err, "Failed to provision user identity");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "user_provisioning_error",
                    message: "Failed to provision user account".to_string(),
                }),
            )
                .into_response();
        }
    };

    let (_, session_cookie) = match state.auth.issue(&user.id).await {
        Ok(res) => res,
        Err(err) => {
            tracing::error!(error = %err, "Failed to issue session after OIDC login");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "session_creation_error",
                    message: "Failed to create session".to_string(),
                }),
            )
                .into_response();
        }
    };

    let secure = if state.secure_cookie { "; Secure" } else { "" };
    let clear_flow_cookie =
        format!("{OIDC_FLOW_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}");

    let mut response = StatusCode::FOUND.into_response();
    if let Ok(val) = HeaderValue::from_str("/") {
        response
            .headers_mut()
            .insert(axum::http::header::LOCATION, val);
    }
    if let Ok(val) = HeaderValue::from_str(&session_cookie) {
        response.headers_mut().insert(SET_COOKIE, val);
    }
    if let Ok(val) = HeaderValue::from_str(&clear_flow_cookie) {
        response.headers_mut().append(SET_COOKIE, val);
    }
    response
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DevLoginRequest {
    email: Option<String>,
    display_name: Option<String>,
}

async fn auth_dev_login(
    State(state): State<AppState>,
    payload: Option<Json<DevLoginRequest>>,
) -> Response {
    if !state.allow_dev_login {
        return (
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "not_found",
                message: "Dev login is disabled in production".to_string(),
            }),
        )
            .into_response();
    }

    let req = payload.map(|p| p.0).unwrap_or_default();
    let email = req
        .email
        .unwrap_or_else(|| "dev@tabularis.local".to_string());
    let display_name = req.display_name.unwrap_or_else(|| "Dev User".to_string());
    let subject = format!("dev-{}", &email);

    let user = match state
        .users
        .find_or_create(
            "tabularis:local",
            &subject,
            Some(&email),
            Some(&display_name),
        )
        .await
    {
        Ok(u) => u,
        Err(err) => {
            tracing::error!(error = %err, "Failed to provision dev user");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "user_provisioning_error",
                    message: "Failed to provision user".to_string(),
                }),
            )
                .into_response();
        }
    };

    let (principal, session_cookie) = match state.auth.issue(&user.id).await {
        Ok(res) => res,
        Err(err) => {
            tracing::error!(error = %err, "Failed to issue session for dev user");
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "session_error",
                    message: "Failed to create session".to_string(),
                }),
            )
                .into_response();
        }
    };

    let mut response = Json(SessionResponse {
        authenticated: true,
        user_id: principal.user_id,
    })
    .into_response();

    if let Ok(val) = HeaderValue::from_str(&session_cookie) {
        response.headers_mut().insert(SET_COOKIE, val);
    }
    response
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinRegisterRequest {
    pub username: String,
    pub pin: String,
    pub recovery_email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinLoginRequest {
    pub username: String,
    pub pin: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinUserDto {
    pub id: String,
    pub username: String,
    pub recovery_email: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinAuthResponse {
    pub token: String,
    pub token_type: String,
    pub expires_at: u64,
    pub user: PinUserDto,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinMeResponse {
    pub authenticated: bool,
    pub user_id: String,
    pub username: Option<String>,
}

async fn auth_pin_register(
    State(state): State<AppState>,
    Json(payload): Json<PinRegisterRequest>,
) -> Response {
    let username = payload.username.trim();
    if username.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                code: "invalid_username",
                message: "Username is required".to_string(),
            }),
        )
            .into_response();
    }

    if let Err(err) = auth::validate_pin(&payload.pin) {
        return (
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                code: "invalid_pin",
                message: err,
            }),
        )
            .into_response();
    }

    let pin_record = match state
        .auth
        .pin_store()
        .register_account(username, &payload.pin, payload.recovery_email)
        .await
    {
        Ok(record) => record,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ValidationErrorResponse {
                    code: "pin_registration_failed",
                    message: err,
                }),
            )
                .into_response();
        }
    };

    let token = match state
        .auth
        .issue_pin_token(&pin_record.user_id, &pin_record.username)
        .await
    {
        Ok(res) => res,
        Err(err) => {
            tracing::error!(error = %err, "Failed to issue JWT token for PIN register");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ValidationErrorResponse {
                    code: "jwt_issuance_failed",
                    message: "Failed to issue authentication token".to_string(),
                }),
            )
                .into_response();
        }
    };
    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + state.auth.jwt().ttl_seconds();

    let mut response = (
        StatusCode::CREATED,
        Json(PinAuthResponse {
            token: token.clone(),
            token_type: "Bearer".to_string(),
            expires_at,
            user: PinUserDto {
                id: pin_record.user_id,
                username: pin_record.username,
                recovery_email: pin_record.recovery_email,
            },
        }),
    )
        .into_response();

    if let Ok(cookie_val) = HeaderValue::from_str(&state.auth.jwt_cookie(&token)) {
        response.headers_mut().append(SET_COOKIE, cookie_val);
    }

    response
}

async fn auth_pin_login(
    State(state): State<AppState>,
    Json(payload): Json<PinLoginRequest>,
) -> Response {
    let pin_record = match state
        .auth
        .pin_store()
        .login(&payload.username, &payload.pin)
        .await
    {
        Ok(record) => record,
        Err(err) => {
            let status = if err.contains("locked") || err.contains("Try again") {
                StatusCode::TOO_MANY_REQUESTS
            } else {
                StatusCode::UNAUTHORIZED
            };
            return (
                status,
                Json(ValidationErrorResponse {
                    code: "invalid_credentials",
                    message: err,
                }),
            )
                .into_response();
        }
    };

    let token = match state
        .auth
        .issue_pin_token(&pin_record.user_id, &pin_record.username)
        .await
    {
        Ok(res) => res,
        Err(err) => {
            tracing::error!(error = %err, "Failed to issue JWT token for PIN login");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ValidationErrorResponse {
                    code: "jwt_issuance_failed",
                    message: "Failed to issue authentication token".to_string(),
                }),
            )
                .into_response();
        }
    };
    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + state.auth.jwt().ttl_seconds();

    let mut response = (
        StatusCode::OK,
        Json(PinAuthResponse {
            token: token.clone(),
            token_type: "Bearer".to_string(),
            expires_at,
            user: PinUserDto {
                id: pin_record.user_id,
                username: pin_record.username,
                recovery_email: pin_record.recovery_email,
            },
        }),
    )
        .into_response();

    if let Ok(cookie_val) = HeaderValue::from_str(&state.auth.jwt_cookie(&token)) {
        response.headers_mut().append(SET_COOKIE, cookie_val);
    }

    response
}

async fn auth_pin_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<PinMeResponse>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(cookie, auth)
        .await
        .map_err(authentication_error_response)?;

    let username = state
        .auth
        .pin_store()
        .account_by_id(&principal.user_id)
        .await
        .map_err(|_| {
            authentication_error_response(AuthenticationError::Repository(
                "PIN lookup failed".into(),
            ))
        })?
        .map(|r| r.username);

    Ok(Json(PinMeResponse {
        authenticated: true,
        user_id: principal.user_id,
        username,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinChangeRequest {
    pub username: String,
    pub old_pin: String,
    pub new_pin: String,
}

async fn auth_pin_change(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PinChangeRequest>,
) -> Response {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let principal = match state.auth.authenticate_request(cookie, auth).await {
        Ok(principal) => principal,
        Err(err) => return authentication_error_response(err).into_response(),
    };
    let account = match state
        .auth
        .pin_store()
        .account_by_id(&principal.user_id)
        .await
    {
        Ok(Some(account))
            if account
                .username
                .eq_ignore_ascii_case(payload.username.trim()) =>
        {
            account
        }
        _ => return StatusCode::FORBIDDEN.into_response(),
    };
    match state
        .auth
        .pin_store()
        .update_pin(
            &account.user_id,
            &account.username,
            &payload.old_pin,
            &payload.new_pin,
        )
        .await
    {
        Ok(_) => match state.auth.logout_all(&principal.user_id).await {
            Ok(cookie) => {
                let mut response = StatusCode::NO_CONTENT.into_response();
                for cookie in [cookie, state.auth.expired_jwt_cookie()] {
                    if let Ok(value) = HeaderValue::from_str(&cookie) {
                        response.headers_mut().append(SET_COOKIE, value);
                    }
                }
                response
            }
            Err(error) => {
                tracing::error!(%error, "PIN changed but session revocation failed");
                StatusCode::SERVICE_UNAVAILABLE.into_response()
            }
        },
        Err(err) => (
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                code: "pin_change_failed",
                message: err,
            }),
        )
            .into_response(),
    }
}

async fn list_workspaces(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let workspaces = state
        .workspaces
        .list_for_user(&principal.user_id)
        .await
        .map_err(|error| authentication_error_response(AuthenticationError::Repository(error)))?;
    let mut result = Vec::new();
    for workspace in workspaces {
        let role = state
            .memberships
            .get_member_role(&workspace.id, &principal.user_id)
            .await
            .map_err(|error| {
                authentication_error_response(AuthenticationError::Repository(error))
            })?;
        let mut value = serde_json::to_value(workspace).expect("Workspace is serializable");
        value["role"] = serde_json::json!(role);
        result.push(value);
    }
    Ok(Json(result))
}

#[derive(Debug, Deserialize)]
struct CreateWorkspaceRequest {
    name: String,
}

async fn create_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateWorkspaceRequest>,
) -> Result<(StatusCode, Json<Workspace>), (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let name = payload.name.trim();
    if name.is_empty() || name.len() > 100 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                code: "invalid_workspace_name",
                message: "Workspace name must be between 1 and 100 characters".to_string(),
            }),
        ));
    }

    let ws_id = format!("ws_{}", random_value(16));
    let ws = state
        .workspaces
        .create(&ws_id, name, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to create workspace");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "workspace_repository_error",
                    message: "The workspace service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    Ok((StatusCode::CREATED, Json(ws)))
}

async fn list_workspace_members(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<Vec<WorkspaceMember>>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    if !role.can_manage_members() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Only workspace owners and admins can view members".to_string(),
            }),
        ));
    }

    state
        .memberships
        .list_members(&workspace_id)
        .await
        .map(Json)
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to list workspace members");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddMemberRequest {
    user_id: String,
    role: Role,
}

async fn add_workspace_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(payload): Json<AddMemberRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    if !role.can_manage_members() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Only workspace owners and admins can manage members".to_string(),
            }),
        ));
    }

    state
        .memberships
        .add_member(&workspace_id, &payload.user_id, payload.role)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to add workspace member");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "Failed to add member to workspace".to_string(),
                }),
            )
        })?;

    state
        .pool_manager
        .evict_member(&workspace_id, &payload.user_id);

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "success": true })),
    ))
}

async fn remove_workspace_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, member_user_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    if !role.can_manage_members() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Only workspace owners and admins can manage members".to_string(),
            }),
        ));
    }

    let target_role = state
        .memberships
        .get_member_role(&workspace_id, &member_user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check target member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    if let Some(Role::Owner) = target_role {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                code: "cannot_remove_owner",
                message: "Workspace owner cannot be removed".to_string(),
            }),
        ));
    }

    state
        .memberships
        .remove_member(&workspace_id, &member_user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to remove workspace member");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "Failed to remove member from workspace".to_string(),
                }),
            )
        })?;

    state
        .pool_manager
        .evict_member(&workspace_id, &member_user_id);

    Ok(StatusCode::NO_CONTENT)
}

async fn list_workspace_connections(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<Vec<ConnectionSummary>>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(_) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    state
        .connection_repo
        .list_for_workspace(&workspace_id)
        .await
        .map(Json)
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to list connections for workspace");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "connection_repository_error",
                    message: "The connection service is temporarily unavailable".to_string(),
                }),
            )
        })
}

async fn create_workspace_connection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(payload): Json<CreateConnectionPayload>,
) -> Result<(StatusCode, Json<ConnectionSummary>), (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    if !role.can_manage_connections() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Only workspace owners, admins, and editors can manage connections"
                    .to_string(),
            }),
        ));
    }

    let name = payload.name.trim();
    if name.is_empty() || name.len() > 100 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                code: "invalid_connection_name",
                message: "Connection name must be between 1 and 100 characters".to_string(),
            }),
        ));
    }

    let driver = payload.driver.trim();
    if driver.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ValidationErrorResponse {
                code: "invalid_driver",
                message: "Connection driver is required".to_string(),
            }),
        ));
    }

    let conn_id = format!("conn_{}", random_value(16));
    let public_params = payload
        .public_params
        .unwrap_or_else(|| serde_json::json!({}));
    let summary = state
        .connection_repo
        .create(
            &conn_id,
            &workspace_id,
            name,
            driver,
            public_params,
            payload.environment.as_deref(),
            payload.credentials,
            &principal.user_id,
        )
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to create connection");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "connection_repository_error",
                    message: "The connection service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let audit_id = format!("aud_{}", random_value(16));
    audit::persist_workspace_audit(
        state.audit_repo.as_ref(),
        WorkspaceAuditContext {
            workspace_id: workspace_id.clone(),
            actor_user_id: principal.user_id.clone(),
            request_id: None,
        },
        WorkspaceAuditInput {
            id: audit_id,
            action: "connection.created".to_string(),
            resource_type: "connection".to_string(),
            resource_id: Some(summary.id.clone()),
            occurred_at: chrono::Utc::now().to_rfc3339(),
            metadata: serde_json::json!({ "name": summary.name, "driver": summary.driver }),
        },
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, "Workspace audit was not persisted");
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ValidationErrorResponse {
                code: "audit_unavailable",
                message: "Audit persistence failed; check operation status before retrying".into(),
            }),
        )
    })?;

    Ok((StatusCode::CREATED, Json(summary)))
}

async fn get_workspace_connection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, connection_id)): Path<(String, String)>,
) -> Result<Json<ConnectionSummary>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(_) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    let conn = state
        .connection_repo
        .get_by_id(&workspace_id, &connection_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to get connection");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "connection_repository_error",
                    message: "The connection service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(conn) = conn else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "connection_not_found",
                message: "Connection not found".to_string(),
            }),
        ));
    };

    Ok(Json(conn))
}

async fn update_workspace_connection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, connection_id)): Path<(String, String)>,
    Json(payload): Json<UpdateConnectionPayload>,
) -> Result<Json<ConnectionSummary>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    if !role.can_manage_connections() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Only workspace owners, admins, and editors can manage connections"
                    .to_string(),
            }),
        ));
    }

    if let Some(ref name) = payload.name {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.len() > 100 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ValidationErrorResponse {
                    code: "invalid_connection_name",
                    message: "Connection name must be between 1 and 100 characters".to_string(),
                }),
            ));
        }
    }

    let summary = state
        .connection_repo
        .update(
            &workspace_id,
            &connection_id,
            payload.name.as_deref(),
            payload.driver.as_deref(),
            payload.public_params,
            payload.environment.as_deref(),
            payload.credentials,
            &principal.user_id,
        )
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to update connection");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "connection_repository_error",
                    message: "The connection service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    state
        .pool_manager
        .evict_workspace_connection(&workspace_id, &connection_id);

    let audit_id = format!("aud_{}", random_value(16));
    audit::persist_workspace_audit(
        state.audit_repo.as_ref(),
        WorkspaceAuditContext {
            workspace_id: workspace_id.clone(),
            actor_user_id: principal.user_id.clone(),
            request_id: None,
        },
        WorkspaceAuditInput {
            id: audit_id,
            action: "connection.updated".to_string(),
            resource_type: "connection".to_string(),
            resource_id: Some(summary.id.clone()),
            occurred_at: chrono::Utc::now().to_rfc3339(),
            metadata: serde_json::json!({ "name": summary.name }),
        },
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, "Workspace audit was not persisted");
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ValidationErrorResponse {
                code: "audit_unavailable",
                message: "Audit persistence failed; check operation status before retrying".into(),
            }),
        )
    })?;

    Ok(Json(summary))
}

async fn delete_workspace_connection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, connection_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    if !role.can_manage_connections() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Only workspace owners, admins, and editors can manage connections"
                    .to_string(),
            }),
        ));
    }

    state
        .connection_repo
        .delete(&workspace_id, &connection_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to delete connection");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "connection_repository_error",
                    message: "The connection service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    state
        .pool_manager
        .evict_workspace_connection(&workspace_id, &connection_id);

    let audit_id = format!("aud_{}", random_value(16));
    audit::persist_workspace_audit(
        state.audit_repo.as_ref(),
        WorkspaceAuditContext {
            workspace_id: workspace_id.clone(),
            actor_user_id: principal.user_id.clone(),
            request_id: None,
        },
        WorkspaceAuditInput {
            id: audit_id,
            action: "connection.deleted".to_string(),
            resource_type: "connection".to_string(),
            resource_id: Some(connection_id.clone()),
            occurred_at: chrono::Utc::now().to_rfc3339(),
            metadata: serde_json::json!({}),
        },
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, "Workspace audit was not persisted");
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ValidationErrorResponse {
                code: "audit_unavailable",
                message: "Audit persistence failed; check operation status before retrying".into(),
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

async fn execute_query(
    State(state): State<AppState>,
    Path(connection_id): Path<String>,
    Json(request): Json<QueryRequest>,
) -> Result<Json<Value>, (StatusCode, Json<ValidationErrorResponse>)> {
    state
        .queries
        .execute(
            state.query_repository.as_ref(),
            QueryExecutionInput {
                connection_id,
                query: request.query,
                limit: request.limit,
                page: request.page,
                schema: request.schema,
            },
        )
        .await
        .map(Json)
        .map_err(query_error_response)
}

async fn cancel_query(
    State(state): State<AppState>,
    Path(connection_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ValidationErrorResponse>)> {
    state
        .queries
        .cancel(state.query_cancellation_repository.as_ref(), &connection_id)
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(query_error_response)
}

fn query_error_response(error: QueryServiceError) -> (StatusCode, Json<ValidationErrorResponse>) {
    let status = match error {
        QueryServiceError::InvalidConnectionId => StatusCode::BAD_REQUEST,
        QueryServiceError::Repository(_) | QueryServiceError::Cancellation(_) => {
            StatusCode::SERVICE_UNAVAILABLE
        }
    };
    (
        status,
        Json(ValidationErrorResponse {
            code: error.code(),
            message: error.to_string(),
        }),
    )
}

async fn discover_schema(
    State(state): State<AppState>,
    Path(connection_id): Path<String>,
    Query(query): Query<SchemaQuery>,
) -> Result<Json<Vec<Value>>, (StatusCode, Json<ValidationErrorResponse>)> {
    state
        .schema
        .discover(
            state.schema_repository.as_ref(),
            SchemaDiscoveryInput {
                connection_id,
                resource: query.resource,
                schema: query.schema,
            },
        )
        .await
        .map(Json)
        .map_err(|error| {
            let status = match error {
                SchemaServiceError::InvalidConnectionId => StatusCode::BAD_REQUEST,
                SchemaServiceError::Repository(_) => StatusCode::SERVICE_UNAVAILABLE,
            };
            (
                status,
                Json(ValidationErrorResponse {
                    code: error.code(),
                    message: error.to_string(),
                }),
            )
        })
}

async fn validate_connection(
    State(state): State<AppState>,
    Json(input): Json<ConnectionValidationInput>,
) -> Result<Json<ConnectionValidationResult>, (StatusCode, Json<ValidationErrorResponse>)> {
    state
        .connections
        .validate(input)
        .map(Json)
        .map_err(|error: ConnectionValidationError| {
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(ValidationErrorResponse {
                    code: error.code(),
                    message: error.to_string(),
                }),
            )
        })
}

async fn liveness() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "tabularis-web-server",
        status: "ok",
    })
}

async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    if state.metadata.is_ready().await {
        (
            StatusCode::OK,
            Json(HealthResponse {
                service: "tabularis-web-server",
                status: "ready",
            }),
        )
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(HealthResponse {
                service: "tabularis-web-server",
                status: "unavailable",
            }),
        )
    }
}

async fn execute_workspace_connection_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, connection_id)): Path<(String, String)>,
    Json(request): Json<QueryRequest>,
) -> Result<Json<Value>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    let conn = state
        .connection_repo
        .get_by_id(&workspace_id, &connection_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to get connection");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "connection_repository_error",
                    message: "The connection service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(conn) = conn else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "connection_not_found",
                message: "Connection not found in this workspace".to_string(),
            }),
        ));
    };

    let is_read = is_read_query(&request.query);
    if !is_read && !role.can_execute_write_query() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Viewer role cannot execute mutating queries".to_string(),
            }),
        ));
    }

    let session = engine::scoped::workspace_session(&state, &principal.user_id, &conn)
        .await
        .map_err(|error| query_error_response(QueryServiceError::Repository(error)))?;
    let scoped = engine::scoped::ScopedRepository {
        session,
        read_only: !role.can_execute_write_query(),
    };

    let query_history_id = format!("qh_{}", random_value(16));

    let audit_id = format!("aud_{}", random_value(16));
    audit::persist_workspace_audit(
        state.audit_repo.as_ref(),
        WorkspaceAuditContext {
            workspace_id: workspace_id.clone(),
            actor_user_id: principal.user_id.clone(),
            request_id: None,
        },
        WorkspaceAuditInput {
            id: audit_id,
            action: "query.executed".to_string(),
            resource_type: "connection".to_string(),
            resource_id: Some(connection_id.clone()),
            occurred_at: chrono::Utc::now().to_rfc3339(),
            metadata: serde_json::json!({
                "is_read": is_read,
                "query": request.query,
            }),
        },
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, "Workspace audit was not persisted");
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ValidationErrorResponse {
                code: "audit_unavailable",
                message: "Audit persistence failed; check operation status before retrying".into(),
            }),
        )
    })?;

    let _ = state
        .history_repo
        .record_start(RecordQueryStartInput {
            id: query_history_id.clone(),
            workspace_id: workspace_id.clone(),
            user_id: principal.user_id.clone(),
            connection_id: Some(connection_id.clone()),
            database_name: None,
            query_text: request.query.clone(),
        })
        .await;

    let start_instant = std::time::Instant::now();
    let exec_res = state
        .queries
        .execute(
            &scoped,
            QueryExecutionInput {
                connection_id,
                query: request.query,
                limit: request.limit,
                page: request.page,
                schema: request.schema,
            },
        )
        .await;

    let duration_ms = start_instant.elapsed().as_millis() as i64;
    match exec_res {
        Ok(val) => {
            let _ = state
                .history_repo
                .record_finish(RecordQueryFinishInput {
                    id: query_history_id,
                    status: "succeeded".to_string(),
                    duration_ms,
                    rows_affected: None,
                    error_code: None,
                })
                .await;
            Ok(Json(val))
        }
        Err(err) => {
            let _ = state
                .history_repo
                .record_finish(RecordQueryFinishInput {
                    id: query_history_id,
                    status: "failed".to_string(),
                    duration_ms,
                    rows_affected: None,
                    error_code: Some(err.code().to_string()),
                })
                .await;
            Err(query_error_response(err))
        }
    }
}

async fn cancel_workspace_connection_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, connection_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(_role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    let conn = state
        .connection_repo
        .get_by_id(&workspace_id, &connection_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to get connection");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "connection_repository_error",
                    message: "The connection service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(conn) = conn else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "connection_not_found",
                message: "Connection not found in this workspace".to_string(),
            }),
        ));
    };

    let key = TenantPoolKey::new(
        &workspace_id,
        &principal.user_id,
        &connection_id,
        None,
        &conn.public_params,
    );
    let session = state.pool_manager.get_session(&key).ok_or_else(|| {
        query_error_response(QueryServiceError::Cancellation(
            "No active session for this user and connection".into(),
        ))
    })?;
    session
        .cancel()
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(|error| query_error_response(QueryServiceError::Cancellation(error)))
}

async fn discover_workspace_connection_schema(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, connection_id)): Path<(String, String)>,
    Query(query): Query<SchemaQuery>,
) -> Result<Json<Vec<Value>>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to check member role");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(_role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    let conn = state
        .connection_repo
        .get_by_id(&workspace_id, &connection_id)
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "Failed to get connection");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "connection_repository_error",
                    message: "The connection service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(conn) = conn else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "connection_not_found",
                message: "Connection not found in this workspace".to_string(),
            }),
        ));
    };

    let session = engine::scoped::workspace_session(&state, &principal.user_id, &conn)
        .await
        .map_err(|error| query_error_response(QueryServiceError::Repository(error)))?;
    let scoped = engine::scoped::ScopedRepository {
        session,
        read_only: true,
    };

    state
        .schema
        .discover(
            &scoped,
            SchemaDiscoveryInput {
                connection_id,
                resource: query.resource,
                schema: query.schema,
            },
        )
        .await
        .map(Json)
        .map_err(|error| {
            let status = match error {
                SchemaServiceError::InvalidConnectionId => StatusCode::BAD_REQUEST,
                SchemaServiceError::Repository(_) => StatusCode::SERVICE_UNAVAILABLE,
            };
            (
                status,
                Json(ValidationErrorResponse {
                    code: error.code(),
                    message: error.to_string(),
                }),
            )
        })
}

async fn logout_all(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let cookie = headers.get(COOKIE).and_then(|value| value.to_str().ok());
    let principal = match state
        .auth
        .authenticate_request(
            cookie,
            headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()),
        )
        .await
    {
        Ok(p) => p,
        Err(err) => return authentication_error_response(err).into_response(),
    };

    state.pool_manager.evict_user(&principal.user_id);

    match state.auth.logout_all(&principal.user_id).await {
        Ok(expired_cookie) => {
            let mut response = StatusCode::NO_CONTENT.into_response();
            if let Ok(value) = HeaderValue::from_str(&expired_cookie) {
                response.headers_mut().insert(SET_COOKIE, value);
            }
            if let Ok(value) = HeaderValue::from_str(&state.auth.expired_jwt_cookie()) {
                response.headers_mut().append(SET_COOKIE, value);
            }
            response
        }
        Err(message) => {
            tracing::error!(error = %message, "Failed to revoke all user sessions");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "session_repository_error",
                    message: "The session service is temporarily unavailable".to_string(),
                }),
            )
                .into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
struct PaginationQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn list_workspace_audit_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Query(pagination): Query<PaginationQuery>,
) -> Result<Json<Vec<AuditEventRecord>>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    if !role.can_view_audit_logs() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Only workspace owners and admins can view audit logs".to_string(),
            }),
        ));
    }

    let limit = pagination.limit.unwrap_or(50).clamp(1, 200);
    let offset = pagination.offset.unwrap_or(0).max(0);

    state
        .audit_repo
        .list_for_workspace(&workspace_id, limit, offset)
        .await
        .map(Json)
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "audit_repository_error",
                    message: "The audit service is temporarily unavailable".to_string(),
                }),
            )
        })
}

async fn list_workspace_saved_queries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
) -> Result<Json<Vec<SavedQuery>>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    if role.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    }

    state
        .saved_queries_repo
        .list_for_user(&workspace_id, &principal.user_id)
        .await
        .map(Json)
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "saved_query_repository_error",
                    message: "The saved queries service is temporarily unavailable".to_string(),
                }),
            )
        })
}

async fn create_workspace_saved_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Json(payload): Json<CreateSavedQueryPayload>,
) -> Result<(StatusCode, Json<SavedQuery>), (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    if role.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    }

    let id = format!("sq_{}", random_value(16));
    let is_shared = payload.is_shared.unwrap_or(false);

    let created = state
        .saved_queries_repo
        .create(
            &id,
            &workspace_id,
            &principal.user_id,
            &payload.name,
            &payload.query_text,
            is_shared,
        )
        .await
        .map_err(|err| {
            (
                StatusCode::BAD_REQUEST,
                Json(ValidationErrorResponse {
                    code: "saved_query_creation_failed",
                    message: err,
                }),
            )
        })?;

    Ok((StatusCode::CREATED, Json(created)))
}

async fn get_workspace_saved_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, query_id)): Path<(String, String)>,
) -> Result<Json<SavedQuery>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    if role.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    }

    let query = state
        .saved_queries_repo
        .get_by_id(&workspace_id, &query_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "saved_query_repository_error",
                    message: "The saved queries service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(query) = query else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "saved_query_not_found",
                message: "Saved query not found".to_string(),
            }),
        ));
    };

    if !query.is_shared && query.created_by != principal.user_id {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "saved_query_not_found",
                message: "Saved query not found".to_string(),
            }),
        ));
    }

    Ok(Json(query))
}

async fn update_workspace_saved_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, query_id)): Path<(String, String)>,
    Json(payload): Json<UpdateSavedQueryPayload>,
) -> Result<Json<SavedQuery>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    let existing = state
        .saved_queries_repo
        .get_by_id(&workspace_id, &query_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "saved_query_repository_error",
                    message: "The saved queries service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(existing) = existing else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "saved_query_not_found",
                message: "Saved query not found".to_string(),
            }),
        ));
    };

    let is_author = existing.created_by == principal.user_id;
    let is_admin = matches!(role, Role::Owner | Role::Admin);
    if !is_author && !is_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Only the query author or workspace admins can update this query"
                    .to_string(),
            }),
        ));
    }

    state
        .saved_queries_repo
        .update(
            &workspace_id,
            &query_id,
            payload.name.as_deref(),
            payload.query_text.as_deref(),
            payload.is_shared,
        )
        .await
        .map(Json)
        .map_err(|err| {
            (
                StatusCode::BAD_REQUEST,
                Json(ValidationErrorResponse {
                    code: "saved_query_update_failed",
                    message: err,
                }),
            )
        })
}

async fn delete_workspace_saved_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((workspace_id, query_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    let existing = state
        .saved_queries_repo
        .get_by_id(&workspace_id, &query_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "saved_query_repository_error",
                    message: "The saved queries service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(existing) = existing else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "saved_query_not_found",
                message: "Saved query not found".to_string(),
            }),
        ));
    };

    let is_author = existing.created_by == principal.user_id;
    let is_admin = matches!(role, Role::Owner | Role::Admin);
    if !is_author && !is_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ValidationErrorResponse {
                code: "insufficient_permissions",
                message: "Only the query author or workspace admins can delete this query"
                    .to_string(),
            }),
        ));
    }

    state
        .saved_queries_repo
        .delete(&workspace_id, &query_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "saved_query_repository_error",
                    message: "The saved queries service is temporarily unavailable".to_string(),
                }),
            )
        })
}

#[derive(Debug, Deserialize)]
struct QueryHistoryQueryParams {
    limit: Option<i64>,
    offset: Option<i64>,
    user_id: Option<String>,
}

async fn list_workspace_query_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(workspace_id): Path<String>,
    Query(query): Query<QueryHistoryQueryParams>,
) -> Result<Json<Vec<QueryHistoryEntry>>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate_request(
            cookie,
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
        )
        .await
        .map_err(authentication_error_response)?;

    let role = state
        .memberships
        .get_member_role(&workspace_id, &principal.user_id)
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "membership_repository_error",
                    message: "The membership service is temporarily unavailable".to_string(),
                }),
            )
        })?;

    let Some(role) = role else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ValidationErrorResponse {
                code: "workspace_not_found",
                message: "Workspace not found or access denied".to_string(),
            }),
        ));
    };

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);

    let user_filter = if role.can_view_audit_logs() {
        query.user_id.as_deref()
    } else {
        Some(principal.user_id.as_str())
    };

    state
        .history_repo
        .list_for_workspace(&workspace_id, user_filter, limit, offset)
        .await
        .map(Json)
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ValidationErrorResponse {
                    code: "query_history_repository_error",
                    message: "The query history service is temporarily unavailable".to_string(),
                }),
            )
        })
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod regression_tests;
