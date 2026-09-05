pub mod audit;
pub mod auth;
pub mod config;
pub mod metadata;

use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tabularis_core::{
    ConnectionService, ConnectionValidationError, ConnectionValidationInput,
    ConnectionValidationResult, QueryCancellationRepository, QueryExecutionInput,
    QueryExecutionScope, QueryFuture, QueryRepository, QueryService, QueryServiceError,
    SchemaDiscoveryInput, SchemaDiscoveryScope, SchemaFuture, SchemaRepository, SchemaResource,
    SchemaService, SchemaServiceError,
};

#[cfg(test)]
use auth::SessionRepository;
use auth::{AuthService, AuthenticationError, PostgresSessionRepository};
use metadata::MetadataStore;

#[derive(Clone)]
pub struct AppState {
    metadata: MetadataStore,
    connections: ConnectionService,
    queries: QueryService,
    query_repository: Arc<dyn QueryRepository<Value>>,
    query_cancellation_repository: Arc<dyn QueryCancellationRepository>,
    schema: SchemaService,
    schema_repository: Arc<dyn SchemaRepository<Value>>,
    auth: AuthService,
}

impl AppState {
    pub fn new(metadata: MetadataStore) -> Self {
        Self::with_auth_settings(metadata, 8 * 60 * 60, false)
    }

    pub fn with_auth_settings(
        metadata: MetadataStore,
        session_ttl_seconds: i32,
        secure_cookie: bool,
    ) -> Self {
        let session_repository = Arc::new(PostgresSessionRepository::new(metadata.pool().clone()));
        Self {
            metadata,
            connections: ConnectionService,
            queries: QueryService,
            query_repository: Arc::new(UnavailableQueryRepository),
            query_cancellation_repository: Arc::new(UnavailableQueryCancellationRepository),
            schema: SchemaService,
            schema_repository: Arc::new(UnavailableSchemaRepository),
            auth: AuthService::new(session_repository, session_ttl_seconds, secure_cookie),
        }
    }

    pub fn with_schema_repository(
        metadata: MetadataStore,
        schema_repository: Arc<dyn SchemaRepository<Value>>,
    ) -> Self {
        let session_repository = Arc::new(PostgresSessionRepository::new(metadata.pool().clone()));
        Self {
            metadata,
            connections: ConnectionService,
            queries: QueryService,
            query_repository: Arc::new(UnavailableQueryRepository),
            query_cancellation_repository: Arc::new(UnavailableQueryCancellationRepository),
            schema: SchemaService,
            schema_repository,
            auth: AuthService::new(session_repository, 8 * 60 * 60, false),
        }
    }

    pub fn with_repositories(
        metadata: MetadataStore,
        schema_repository: Arc<dyn SchemaRepository<Value>>,
        query_repository: Arc<dyn QueryRepository<Value>>,
        query_cancellation_repository: Arc<dyn QueryCancellationRepository>,
    ) -> Self {
        let session_repository = Arc::new(PostgresSessionRepository::new(metadata.pool().clone()));
        Self {
            metadata,
            connections: ConnectionService,
            queries: QueryService,
            query_repository,
            query_cancellation_repository,
            schema: SchemaService,
            schema_repository,
            auth: AuthService::new(session_repository, 8 * 60 * 60, false),
        }
    }

    #[cfg(test)]
    fn with_session_repository(
        metadata: MetadataStore,
        session_repository: Arc<dyn SessionRepository>,
        secure_cookie: bool,
    ) -> Self {
        let mut state = Self::new(metadata);
        state.auth = AuthService::new(session_repository, 8 * 60 * 60, secure_cookie);
        state
    }
}

struct UnavailableQueryRepository;

impl QueryRepository<Value> for UnavailableQueryRepository {
    fn execute<'a>(&'a self, _scope: &'a QueryExecutionScope) -> QueryFuture<'a, Value> {
        Box::pin(async {
            Err(
                "Query execution is unavailable until authenticated tenant pools are configured"
                    .to_string(),
            )
        })
    }
}

struct UnavailableQueryCancellationRepository;

impl QueryCancellationRepository for UnavailableQueryCancellationRepository {
    fn cancel(&self, _connection_id: &str) -> Result<(), String> {
        Err(
            "Query cancellation is unavailable until authenticated tenant pools are configured"
                .to_string(),
        )
    }
}

struct UnavailableSchemaRepository;

impl SchemaRepository<Value> for UnavailableSchemaRepository {
    fn discover<'a>(&'a self, _scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, Value> {
        Box::pin(async {
            Err(
                "Schema discovery is unavailable until authenticated tenant pools are configured"
                    .to_string(),
            )
        })
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
    Router::new()
        .route("/health/live", get(liveness))
        .route("/health/ready", get(readiness))
        .route("/api/v1/session", get(get_session))
        .route("/api/v1/logout", post(logout))
        .route("/api/v1/connections/validate", post(validate_connection))
        .route(
            "/api/v1/connections/{connection_id}/schema",
            get(discover_schema),
        )
        .route(
            "/api/v1/connections/{connection_id}/queries",
            post(execute_query).delete(cancel_query),
        )
        .layer(DefaultBodyLimit::max(16 * 1024))
        .with_state(state)
}

async fn get_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SessionResponse>, (StatusCode, Json<ValidationErrorResponse>)> {
    let cookie = headers.get(COOKIE).and_then(|value| value.to_str().ok());
    state
        .auth
        .authenticate(cookie)
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
    match state.auth.logout(cookie).await {
        Ok(expired_cookie) => {
            let mut response = StatusCode::NO_CONTENT.into_response();
            if let Ok(value) = HeaderValue::from_str(&expired_cookie) {
                response.headers_mut().insert(SET_COOKIE, value);
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

#[cfg(test)]
mod tests;
