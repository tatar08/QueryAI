use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::header::SET_COOKIE;
use axum::http::{Request, StatusCode};
use axum::Router;
use serde_json::Value;
use tabularis_core::{
    QueryCancellationRepository, QueryExecutionScope, QueryFuture, QueryRepository,
    SchemaDiscoveryScope, SchemaFuture, SchemaRepository,
};
use tower::ServiceExt;

use super::auth::{SessionFuture, SessionPrincipal, SessionRepository};
use super::metadata::MetadataStore;
use super::{app, AppState};

struct StaticSchemaRepository;

impl SchemaRepository<Value> for StaticSchemaRepository {
    fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, Value> {
        Box::pin(async move {
            Ok(vec![serde_json::json!({
                "connectionId": scope.connection_id,
                "resource": scope.resource,
                "schema": scope.schema,
            })])
        })
    }
}

struct StaticQueryRepository;

impl QueryRepository<Value> for StaticQueryRepository {
    fn execute<'a>(&'a self, scope: &'a QueryExecutionScope) -> QueryFuture<'a, Value> {
        Box::pin(async move {
            Ok(serde_json::json!({
                "connectionId": scope.connection_id,
                "query": scope.query,
                "limit": scope.limit,
                "page": scope.page,
                "schema": scope.schema,
            }))
        })
    }
}

#[derive(Default)]
struct RecordingQueryCancellationRepository {
    cancelled: AtomicBool,
}

impl QueryCancellationRepository for RecordingQueryCancellationRepository {
    fn cancel(&self, _connection_id: &str) -> Result<(), String> {
        self.cancelled.store(true, Ordering::SeqCst);
        Ok(())
    }
}

struct StaticSessionRepository {
    principal: Option<SessionPrincipal>,
    revoked: AtomicBool,
}

impl SessionRepository for StaticSessionRepository {
    fn create<'a>(
        &'a self,
        _session_id: &'a str,
        _user_id: &'a str,
        _token_hash: &'a [u8],
        _ttl_seconds: i32,
    ) -> SessionFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }

    fn resolve<'a>(&'a self, _token_hash: &'a [u8]) -> SessionFuture<'a, Option<SessionPrincipal>> {
        let principal = self.principal.clone();
        Box::pin(async move { Ok(principal) })
    }

    fn revoke<'a>(&'a self, _token_hash: &'a [u8]) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            self.revoked.store(true, Ordering::SeqCst);
            Ok(())
        })
    }
}

struct FailingSessionRepository;

impl SessionRepository for FailingSessionRepository {
    fn create<'a>(
        &'a self,
        _session_id: &'a str,
        _user_id: &'a str,
        _token_hash: &'a [u8],
        _ttl_seconds: i32,
    ) -> SessionFuture<'a, ()> {
        Box::pin(async { Err("secret database host".to_string()) })
    }

    fn resolve<'a>(&'a self, _token_hash: &'a [u8]) -> SessionFuture<'a, Option<SessionPrincipal>> {
        Box::pin(async { Err("secret database host".to_string()) })
    }

    fn revoke<'a>(&'a self, _token_hash: &'a [u8]) -> SessionFuture<'a, ()> {
        Box::pin(async { Err("secret database host".to_string()) })
    }
}

fn app_with_unavailable_metadata() -> Router {
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    app(AppState::new(metadata))
}

fn app_with_session_repository(repository: Arc<dyn SessionRepository>) -> Router {
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    app(AppState::with_session_repository(
        metadata, repository, true,
    ))
}

fn app_with_schema_repository() -> Router {
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    app(AppState::with_schema_repository(
        metadata,
        Arc::new(StaticSchemaRepository),
    ))
}

fn app_with_query_repositories(
    cancellation_repository: Arc<RecordingQueryCancellationRepository>,
) -> Router {
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    app(AppState::with_repositories(
        metadata,
        Arc::new(StaticSchemaRepository),
        Arc::new(StaticQueryRepository),
        cancellation_repository,
    ))
}

#[tokio::test]
async fn liveness_endpoint_reports_service_status() {
    let response = app_with_unavailable_metadata()
        .oneshot(Request::get("/health/live").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["service"], "tabularis-web-server");
    assert_eq!(payload["status"], "ok");
}

#[tokio::test]
async fn readiness_endpoint_reports_unavailable_metadata() {
    let response = app_with_unavailable_metadata()
        .oneshot(Request::get("/health/ready").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["status"], "unavailable");
}

#[tokio::test]
async fn session_endpoint_requires_an_authenticated_cookie() {
    let response = app_with_session_repository(Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    }))
    .oneshot(Request::get("/api/v1/session").body(Body::empty()).unwrap())
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["code"], "authentication_required");
}

#[tokio::test]
async fn session_endpoint_returns_the_server_resolved_identity() {
    let response = app_with_session_repository(Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-1".to_string(),
        }),
        revoked: AtomicBool::new(false),
    }))
    .oneshot(
        Request::get("/api/v1/session")
            .header("cookie", "tabularis_session=opaque-token")
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["authenticated"], true);
    assert_eq!(payload["userId"], "user-1");
}

#[tokio::test]
async fn logout_endpoint_revokes_the_session_and_expires_secure_cookie() {
    let repository = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let response = app_with_session_repository(repository.clone())
        .oneshot(
            Request::post("/api/v1/logout")
                .header("cookie", "tabularis_session=opaque-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(repository.revoked.load(Ordering::SeqCst));
    let cookie = response
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cookie.contains("Max-Age=0"));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
    assert!(cookie.contains("Secure"));
}

#[tokio::test]
async fn session_endpoint_does_not_expose_repository_errors() {
    let response = app_with_session_repository(Arc::new(FailingSessionRepository))
        .oneshot(
            Request::get("/api/v1/session")
                .header("cookie", "tabularis_session=opaque-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["code"], "session_repository_error");
    assert_eq!(
        payload["message"],
        "The session service is temporarily unavailable"
    );
    assert!(!body.as_ref().windows(6).any(|window| window == b"secret"));
}

#[tokio::test]
async fn logout_endpoint_does_not_expose_repository_errors() {
    let response = app_with_session_repository(Arc::new(FailingSessionRepository))
        .oneshot(
            Request::post("/api/v1/logout")
                .header("cookie", "tabularis_session=opaque-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["code"], "session_repository_error");
    assert_eq!(
        payload["message"],
        "The session service is temporarily unavailable"
    );
    assert!(!body.as_ref().windows(6).any(|window| window == b"secret"));
}

#[tokio::test]
async fn connection_validation_uses_the_shared_core_service() {
    let response = app_with_unavailable_metadata()
        .oneshot(
            Request::post("/api/v1/connections/validate")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"environment":"staging","connectionUri":null,"saveCredentials":false}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["environment"], "staging");
    assert_eq!(payload["connectionUriPresent"], false);
}

#[tokio::test]
async fn connection_validation_rejects_plaintext_credentials() {
    let response = app_with_unavailable_metadata()
        .oneshot(
            Request::post("/api/v1/connections/validate")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"connectionUri":"postgres://user:secret@host/db","saveCredentials":false}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["code"], "connection_uri_requires_credential_store");
}

#[tokio::test]
async fn connection_validation_rejects_an_unknown_environment() {
    let response = app_with_unavailable_metadata()
        .oneshot(
            Request::post("/api/v1/connections/validate")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"environment":"preview","saveCredentials":false}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["code"], "invalid_environment");
    assert_eq!(payload["message"], "Invalid environment: preview");
}

#[tokio::test]
async fn schema_endpoint_uses_the_injected_shared_repository() {
    let response = app_with_schema_repository()
        .oneshot(
            Request::get("/api/v1/connections/connection-1/schema?resource=tables&schema=public")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload[0]["connectionId"], "connection-1");
    assert_eq!(payload[0]["resource"], "tables");
    assert_eq!(payload[0]["schema"], "public");
}

#[tokio::test]
async fn schema_endpoint_fails_closed_without_a_tenant_pool_repository() {
    let response = app_with_unavailable_metadata()
        .oneshot(
            Request::get("/api/v1/connections/connection-1/schema?resource=schemas")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["code"], "schema_repository_error");
}

#[tokio::test]
async fn query_endpoint_uses_the_injected_shared_repository() {
    let response =
        app_with_query_repositories(Arc::new(RecordingQueryCancellationRepository::default()))
            .oneshot(
                Request::post("/api/v1/connections/connection-1/queries")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"query":" SELECT ‘value’; ","limit":100,"schema":"public"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["connectionId"], "connection-1");
    assert_eq!(payload["query"], "SELECT 'value'");
    assert_eq!(payload["limit"], 100);
    assert_eq!(payload["page"], 1);
    assert_eq!(payload["schema"], "public");
}

#[tokio::test]
async fn query_endpoint_fails_closed_without_a_tenant_pool_repository() {
    let response = app_with_unavailable_metadata()
        .oneshot(
            Request::post("/api/v1/connections/connection-1/queries")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"query":"SELECT 1"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["code"], "query_repository_error");
}

#[tokio::test]
async fn cancellation_endpoint_uses_the_injected_shared_repository() {
    let cancellation_repository = Arc::new(RecordingQueryCancellationRepository::default());
    let response = app_with_query_repositories(cancellation_repository.clone())
        .oneshot(
            Request::delete("/api/v1/connections/connection-1/queries")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(cancellation_repository.cancelled.load(Ordering::SeqCst));
}

#[tokio::test]
async fn cancellation_endpoint_fails_closed_without_a_tenant_pool_repository() {
    let response = app_with_unavailable_metadata()
        .oneshot(
            Request::delete("/api/v1/connections/connection-1/queries")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["code"], "query_cancellation_error");
}
