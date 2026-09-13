use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::header::SET_COOKIE;
use axum::http::{Request, StatusCode};
use axum::Router;
use serde_json::Value;
use tabularis_core::{
    AuditRepository, QueryCancellationRepository, QueryExecutionScope, QueryFuture,
    QueryRepository, SchemaDiscoveryScope, SchemaFuture, SchemaRepository,
};
use tower::ServiceExt;

use super::auth::{SessionFuture, SessionPrincipal, SessionRepository};
use super::history::QueryHistoryRepository;
use super::metadata::MetadataStore;
use super::{app, AppState, RateLimiter, SecurityPolicy};

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
        let principal = if self.revoked.load(Ordering::SeqCst) {
            None
        } else {
            self.principal.clone()
        };
        Box::pin(async move { Ok(principal) })
    }

    fn revoke<'a>(&'a self, _token_hash: &'a [u8]) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            self.revoked.store(true, Ordering::SeqCst);
            Ok(())
        })
    }

    fn revoke_all_for_user<'a>(&'a self, _user_id: &'a str) -> SessionFuture<'a, ()> {
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

    fn revoke_all_for_user<'a>(&'a self, _user_id: &'a str) -> SessionFuture<'a, ()> {
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

use super::auth::oidc::{MockOidcClient, OidcClaims, OIDC_FLOW_COOKIE_NAME};
use super::auth::user::{User, UserFuture, UserRepository};
use super::connections::ConnectionRepository;
use super::tenancy::{
    MembershipRepository, Role, TenancyFuture, Workspace, WorkspaceMember, WorkspaceRepository,
};

#[derive(Default)]
struct MemoryUserRepository {
    users: std::sync::Mutex<Vec<User>>,
}

impl UserRepository for MemoryUserRepository {
    fn find_or_create<'a>(
        &'a self,
        issuer: &'a str,
        subject: &'a str,
        email: Option<&'a str>,
        display_name: Option<&'a str>,
    ) -> UserFuture<'a, User> {
        Box::pin(async move {
            let mut list = self.users.lock().unwrap();
            if let Some(user) = list
                .iter()
                .find(|u| u.oidc_issuer == issuer && u.oidc_subject == subject)
            {
                return Ok(user.clone());
            }
            let new_user = User {
                id: format!("usr_{}", list.len() + 1),
                oidc_issuer: issuer.to_string(),
                oidc_subject: subject.to_string(),
                email: email.map(ToString::to_string),
                display_name: display_name.map(ToString::to_string),
            };
            list.push(new_user.clone());
            Ok(new_user)
        })
    }

    fn find_by_id<'a>(&'a self, user_id: &'a str) -> UserFuture<'a, Option<User>> {
        Box::pin(async move {
            Ok(self
                .users
                .lock()
                .unwrap()
                .iter()
                .find(|u| u.id == user_id)
                .cloned())
        })
    }
}

#[derive(Default)]
struct TestWorkspaceRepository {
    workspaces: std::sync::Mutex<Vec<Workspace>>,
}

impl WorkspaceRepository for TestWorkspaceRepository {
    fn create<'a>(
        &'a self,
        id: &'a str,
        name: &'a str,
        owner_user_id: &'a str,
    ) -> TenancyFuture<'a, Workspace> {
        Box::pin(async move {
            let ws = Workspace {
                id: id.to_string(),
                name: name.to_string(),
                created_by: owner_user_id.to_string(),
                created_at: "2026-09-06T00:00:00Z".to_string(),
            };
            self.workspaces.lock().unwrap().push(ws.clone());
            Ok(ws)
        })
    }

    fn list_for_user<'a>(&'a self, _user_id: &'a str) -> TenancyFuture<'a, Vec<Workspace>> {
        Box::pin(async move { Ok(self.workspaces.lock().unwrap().clone()) })
    }

    fn get_by_id<'a>(&'a self, workspace_id: &'a str) -> TenancyFuture<'a, Option<Workspace>> {
        Box::pin(async move {
            Ok(self
                .workspaces
                .lock()
                .unwrap()
                .iter()
                .find(|w| w.id == workspace_id)
                .cloned())
        })
    }
}

#[derive(Default)]
struct TestMembershipRepository {
    members: std::sync::Mutex<Vec<WorkspaceMember>>,
}

impl MembershipRepository for TestMembershipRepository {
    fn get_member_role<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> TenancyFuture<'a, Option<Role>> {
        Box::pin(async move {
            Ok(self
                .members
                .lock()
                .unwrap()
                .iter()
                .find(|m| m.workspace_id == workspace_id && m.user_id == user_id)
                .map(|m| m.role))
        })
    }

    fn list_members<'a>(
        &'a self,
        workspace_id: &'a str,
    ) -> TenancyFuture<'a, Vec<WorkspaceMember>> {
        Box::pin(async move {
            Ok(self
                .members
                .lock()
                .unwrap()
                .iter()
                .filter(|m| m.workspace_id == workspace_id)
                .cloned()
                .collect())
        })
    }

    fn add_member<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
        role: Role,
    ) -> TenancyFuture<'a, ()> {
        Box::pin(async move {
            let mut list = self.members.lock().unwrap();
            list.retain(|m| !(m.workspace_id == workspace_id && m.user_id == user_id));
            list.push(WorkspaceMember {
                workspace_id: workspace_id.to_string(),
                user_id: user_id.to_string(),
                role,
                email: Some(format!("{user_id}@example.com")),
                display_name: Some(user_id.to_string()),
                created_at: "2026-09-06T00:00:00Z".to_string(),
            });
            Ok(())
        })
    }

    fn remove_member<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> TenancyFuture<'a, ()> {
        Box::pin(async move {
            self.members
                .lock()
                .unwrap()
                .retain(|m| !(m.workspace_id == workspace_id && m.user_id == user_id));
            Ok(())
        })
    }
}

fn app_with_tenancy_and_auth(
    session_repo: Arc<dyn SessionRepository>,
    user_repo: Arc<dyn UserRepository>,
    workspace_repo: Arc<dyn WorkspaceRepository>,
    membership_repo: Arc<dyn MembershipRepository>,
    oidc_client: Option<Arc<dyn super::auth::OidcClient>>,
    allow_dev_login: bool,
) -> Router {
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let mut state = AppState::with_session_repository(metadata, session_repo, true)
        .with_tenancy_repositories(workspace_repo, membership_repo, user_repo)
        .with_connection_repository(Arc::new(
            super::connections::tests::MemoryConnectionRepository::default(),
        ))
        .with_dev_login(allow_dev_login);
    if let Some(oidc) = oidc_client {
        state = state.with_oidc_client(oidc);
    }
    app(state)
}

fn app_with_tenancy_auth_and_connections(
    session_repo: Arc<dyn SessionRepository>,
    user_repo: Arc<dyn UserRepository>,
    workspace_repo: Arc<dyn WorkspaceRepository>,
    membership_repo: Arc<dyn MembershipRepository>,
    connection_repo: Arc<dyn ConnectionRepository>,
) -> Router {
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state = AppState::with_session_repository(metadata, session_repo, true)
        .with_tenancy_repositories(workspace_repo, membership_repo, user_repo)
        .with_connection_repository(connection_repo)
        .with_dev_login(true);
    app(state)
}

#[tokio::test]
async fn auth_login_returns_not_implemented_without_oidc() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        None,
        true,
    );

    let response = app
        .oneshot(
            Request::get("/api/v1/auth/login")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_IMPLEMENTED);
}

#[tokio::test]
async fn auth_login_redirects_with_pkce_and_flow_cookie() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let oidc_client = Arc::new(MockOidcClient::default());
    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        Some(oidc_client),
        true,
    );

    let response = app
        .oneshot(
            Request::get("/api/v1/auth/login")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FOUND);
    let location = response
        .headers()
        .get(axum::http::header::LOCATION)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(location.contains("https://idp.example.com/auth"));

    let cookie = response
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cookie.contains(OIDC_FLOW_COOKIE_NAME));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
    assert!(cookie.contains("Secure"));
}

#[tokio::test]
async fn auth_callback_exchanges_code_provisions_user_and_sets_session() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let user_repo = Arc::new(MemoryUserRepository::default());
    let oidc_client = Arc::new(MockOidcClient::new(OidcClaims {
        issuer: "https://idp.example.com".to_string(),
        subject: "sub-123".to_string(),
        email: Some("alice@example.com".to_string()),
        display_name: Some("Alice".to_string()),
    }));
    let app = app_with_tenancy_and_auth(
        session_repo,
        user_repo.clone(),
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        Some(oidc_client),
        true,
    );

    let flow_cookie = format!("{OIDC_FLOW_COOKIE_NAME}=test-state:test-verifier");
    let response = app
        .oneshot(
            Request::get("/api/v1/auth/callback?code=valid-code&state=test-state")
                .header(axum::http::header::COOKIE, flow_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FOUND);

    // Verify user was provisioned
    let users = user_repo.users.lock().unwrap();
    assert_eq!(users.len(), 1);
    assert_eq!(users[0].oidc_subject, "sub-123");
    assert_eq!(users[0].email.as_deref(), Some("alice@example.com"));

    // Verify session and flow-clearing cookies set
    let cookies: Vec<_> = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert!(cookies.iter().any(|c| c.contains("tabularis_session=")));
    assert!(cookies
        .iter()
        .any(|c| c.contains("tabularis_oidc_flow=") && c.contains("Max-Age=0")));
}

#[tokio::test]
async fn auth_callback_rejects_state_mismatch() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let oidc_client = Arc::new(MockOidcClient::default());
    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        Some(oidc_client),
        true,
    );

    let flow_cookie = format!("{OIDC_FLOW_COOKIE_NAME}=state-a:verifier-a");
    let response = app
        .oneshot(
            Request::get("/api/v1/auth/callback?code=code-1&state=state-b")
                .header(axum::http::header::COOKIE, flow_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["code"], "state_mismatch");
}

#[tokio::test]
async fn auth_dev_login_provisions_user_when_allowed() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let user_repo = Arc::new(MemoryUserRepository::default());
    let app = app_with_tenancy_and_auth(
        session_repo,
        user_repo.clone(),
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        None,
        true,
    );

    let response = app
        .oneshot(
            Request::post("/api/v1/auth/dev-login")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"email":"tester@tabularis.local","displayName":"Tester"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cookie.contains("tabularis_session="));

    let users = user_repo.users.lock().unwrap();
    assert_eq!(users.len(), 1);
    assert_eq!(users[0].email.as_deref(), Some("tester@tabularis.local"));
}

#[tokio::test]
async fn auth_dev_login_is_disabled_in_production() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        None,
        false, // disabled
    );

    let response = app
        .oneshot(
            Request::post("/api/v1/auth/dev-login")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn workspaces_endpoints_require_authentication() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        None,
        true,
    );

    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/workspaces")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .oneshot(
            Request::post("/api/v1/workspaces")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Finance"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn workspace_creation_and_listing_works_for_authenticated_user() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-10".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let ws_repo = Arc::new(TestWorkspaceRepository::default());
    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        ws_repo.clone(),
        Arc::new(TestMembershipRepository::default()),
        None,
        true,
    );

    // Create workspace
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/workspaces")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Data Analytics"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let ws: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(ws["name"], "Data Analytics");
    assert_eq!(ws["createdBy"], "user-10");

    // List workspaces
    let response = app
        .oneshot(
            Request::get("/api/v1/workspaces")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let list: Vec<Value> = serde_json::from_slice(&body).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["name"], "Data Analytics");
}

#[tokio::test]
async fn workspace_member_access_enforces_tenant_isolation_and_rbac() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "caller-user".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let mem_repo = Arc::new(TestMembershipRepository::default());
    let ws_repo = Arc::new(TestWorkspaceRepository::default());

    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        ws_repo,
        mem_repo.clone(),
        None,
        true,
    );

    // Case 1: Caller is NOT a member of workspace-x -> 404 (IDOR guard)
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/workspaces/workspace-x/members")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    // Case 2: Caller is a Viewer in workspace-y -> 403 Forbidden (RBAC guard)
    mem_repo
        .add_member("workspace-y", "caller-user", Role::Viewer)
        .await
        .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/workspaces/workspace-y/members")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // Case 3: Caller is an Owner in workspace-y -> 200 OK
    mem_repo
        .add_member("workspace-y", "caller-user", Role::Owner)
        .await
        .unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::get("/api/v1/workspaces/workspace-y/members")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let members: Vec<Value> = serde_json::from_slice(&body).unwrap();
    assert_eq!(members.len(), 1);
    assert_eq!(members[0]["role"], "owner");

    // Case 4: Add member to workspace-y as Owner -> 201 Created
    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/workspaces/workspace-y/members")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"userId":"new-editor","role":"editor"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    // Case 5: Cannot remove workspace owner -> 400 Bad Request
    let response = app
        .clone()
        .oneshot(
            Request::delete("/api/v1/workspaces/workspace-y/members/caller-user")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    // Case 6: Remove member from workspace-y as Owner -> 204 No Content
    let response = app
        .oneshot(
            Request::delete("/api/v1/workspaces/workspace-y/members/new-editor")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn list_workspace_connections_requires_authentication() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        None,
        true,
    );

    let response = app
        .oneshot(
            Request::get("/api/v1/workspaces/ws-1/connections")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn list_workspace_connections_enforces_tenant_isolation() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "intruder".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let mem_repo = Arc::new(TestMembershipRepository::default());
    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        Arc::new(TestWorkspaceRepository::default()),
        mem_repo,
        None,
        true,
    );

    // Intruder is not a member of ws-1 -> 404 (IDOR guard)
    let response = app
        .oneshot(
            Request::get("/api/v1/workspaces/ws-1/connections")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn create_workspace_connection_enforces_rbac_and_never_leaks_secrets() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-editor".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let mem_repo = Arc::new(TestMembershipRepository::default());
    let conn_repo = Arc::new(super::connections::tests::MemoryConnectionRepository::default());

    let app = app_with_tenancy_auth_and_connections(
        session_repo.clone(),
        Arc::new(MemoryUserRepository::default()),
        Arc::new(TestWorkspaceRepository::default()),
        mem_repo.clone(),
        conn_repo.clone(),
    );

    // Case 1: Caller is a Viewer -> 403 Forbidden
    mem_repo
        .add_member("ws-finance", "user-editor", Role::Viewer)
        .await
        .unwrap();

    let create_payload = serde_json::json!({
        "name": "Finance DB",
        "driver": "postgres",
        "publicParams": { "host": "finance-db.local", "port": 5432, "database": "fin" },
        "environment": "production",
        "credentials": { "password": "super-confidential-pw", "sshKey": "ssh-rsa AAAAB3..." }
    });

    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/workspaces/ws-finance/connections")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(create_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // Case 2: Elevate to Editor -> 201 Created
    mem_repo
        .add_member("ws-finance", "user-editor", Role::Editor)
        .await
        .unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::post("/api/v1/workspaces/ws-finance/connections")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(create_payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = to_bytes(response.into_body(), 2048).await.unwrap();
    let body_str = String::from_utf8(body.to_vec()).unwrap();

    // CRITICAL: Ensure secret password or sshKey is NEVER in the response JSON!
    assert!(!body_str.contains("super-confidential-pw"));
    assert!(!body_str.contains("ssh-rsa"));

    let created: Value = serde_json::from_str(&body_str).unwrap();
    assert_eq!(created["name"], "Finance DB");
    assert_eq!(created["driver"], "postgres");
    assert_eq!(created["environment"], "production");
    let conn_id = created["id"].as_str().unwrap().to_string();

    // Case 3: Read single connection -> returns summary without credentials
    let response = app
        .clone()
        .oneshot(
            Request::get(format!(
                "/api/v1/workspaces/ws-finance/connections/{conn_id}"
            ))
            .header(axum::http::header::COOKIE, "tabularis_session=active")
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let get_body = to_bytes(response.into_body(), 2048).await.unwrap();
    let get_str = String::from_utf8(get_body.to_vec()).unwrap();
    assert!(!get_str.contains("super-confidential-pw"));

    // Case 4: Update connection as Editor
    let response = app
        .clone()
        .oneshot(
            Request::patch(format!(
                "/api/v1/workspaces/ws-finance/connections/{conn_id}"
            ))
            .header(axum::http::header::COOKIE, "tabularis_session=active")
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"name":"Finance Primary DB"}"#))
            .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let update_body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 2048).await.unwrap()).unwrap();
    assert_eq!(update_body["name"], "Finance Primary DB");

    // Case 5: Delete connection as Editor
    let response = app
        .oneshot(
            Request::delete(format!(
                "/api/v1/workspaces/ws-finance/connections/{conn_id}"
            ))
            .header(axum::http::header::COOKIE, "tabularis_session=active")
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

struct TestEngineSession {
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}

impl super::pools::TenantDatabaseSession for TestEngineSession {
    fn execute_query<'a>(
        &'a self,
        sql: &'a str,
        _limit: Option<u32>,
        _page: u32,
        _schema: Option<&'a str>,
    ) -> super::pools::PoolFuture<'a, Value> {
        let sql = sql.to_string();
        Box::pin(async move {
            Ok(serde_json::json!({
                "executed": sql,
                "rows": [{"id": 100, "val": "test"}]
            }))
        })
    }

    fn discover_schema<'a>(
        &'a self,
        resource: tabularis_core::SchemaResource,
        _schema: Option<&'a str>,
    ) -> super::pools::PoolFuture<'a, Vec<Value>> {
        Box::pin(async move {
            Ok(vec![serde_json::json!({
                "resource": format!("{resource:?}"),
                "table": "accounts"
            })])
        })
    }

    fn cancel(&self) -> Result<(), String> {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }
}

#[tokio::test]
async fn workspace_connection_query_rbac_and_isolation() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-viewer".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });

    let mem_repo = Arc::new(TestMembershipRepository::default());
    let conn_repo = Arc::new(super::connections::tests::MemoryConnectionRepository::default());

    mem_repo
        .add_member("ws-target", "user-viewer", super::tenancy::Role::Viewer)
        .await
        .unwrap();
    mem_repo
        .add_member("ws-target", "user-editor", super::tenancy::Role::Editor)
        .await
        .unwrap();

    let created_conn = conn_repo
        .create(
            "conn-pg",
            "ws-target",
            "Target DB",
            "postgres",
            serde_json::json!({}),
            None,
            None,
            "user-editor",
        )
        .await
        .unwrap();

    let pool_manager = Arc::new(super::pools::TenantPoolManager::new(10));
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let engine_session = Arc::new(TestEngineSession {
        cancelled: cancelled.clone(),
    });
    let pool_key = super::pools::TenantPoolKey::new(
        "ws-target",
        "user-viewer",
        &created_conn.id,
        None,
        &serde_json::json!({}),
    );
    pool_manager
        .register_session(&pool_key, engine_session.clone())
        .unwrap();

    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state = AppState::with_session_repository(metadata, session_repo, true)
        .with_tenancy_repositories(
            Arc::new(TestWorkspaceRepository::default()),
            mem_repo.clone(),
            Arc::new(MemoryUserRepository::default()),
        )
        .with_connection_repository(conn_repo)
        .with_pool_manager(pool_manager.clone())
        .with_dev_login(true);

    let test_app = app(state.clone());

    // Case 1: Unauthenticated request -> 401
    let response = test_app
        .clone()
        .oneshot(
            Request::post(format!(
                "/api/v1/workspaces/ws-target/connections/{}/queries",
                created_conn.id
            ))
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"query":"SELECT 1"}"#))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // Case 2: Non-member -> 404 (IDOR guard)
    let response = test_app
        .clone()
        .oneshot(
            Request::post(format!(
                "/api/v1/workspaces/ws-other/connections/{}/queries",
                created_conn.id
            ))
            .header(axum::http::header::COOKIE, "tabularis_session=active")
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"query":"SELECT 1"}"#))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    // Case 3: Viewer executes read query -> 200 OK
    let response = test_app
        .clone()
        .oneshot(
            Request::post(format!(
                "/api/v1/workspaces/ws-target/connections/{}/queries",
                created_conn.id
            ))
            .header(axum::http::header::COOKIE, "tabularis_session=active")
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"query":"SELECT * FROM users"}"#))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = to_bytes(response.into_body(), 2048).await.unwrap();
    let body_val: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body_val["rows"][0]["id"], 100);

    // Case 4: Viewer executes write query -> 403 Forbidden
    let response = test_app
        .clone()
        .oneshot(
            Request::post(format!(
                "/api/v1/workspaces/ws-target/connections/{}/queries",
                created_conn.id
            ))
            .header(axum::http::header::COOKIE, "tabularis_session=active")
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"query":"DROP TABLE users"}"#))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // Case 5: Discover schema on workspace connection -> 200 OK
    let response = test_app
        .clone()
        .oneshot(
            Request::get(format!(
                "/api/v1/workspaces/ws-target/connections/{}/schema?resource=tables",
                created_conn.id
            ))
            .header(axum::http::header::COOKIE, "tabularis_session=active")
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let schema_bytes = to_bytes(response.into_body(), 2048).await.unwrap();
    let schema_val: Value = serde_json::from_slice(&schema_bytes).unwrap();
    assert_eq!(schema_val[0]["table"], "accounts");

    // Case 6: Cancel query on workspace connection -> 204 NO_CONTENT
    let response = test_app
        .clone()
        .oneshot(
            Request::delete(format!(
                "/api/v1/workspaces/ws-target/connections/{}/queries",
                created_conn.id
            ))
            .header(axum::http::header::COOKIE, "tabularis_session=active")
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(cancelled.load(std::sync::atomic::Ordering::SeqCst));

    // Case 7: Delete connection evicts and cancels pool session
    let cancelled_for_eviction = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let eviction_session = Arc::new(TestEngineSession {
        cancelled: cancelled_for_eviction.clone(),
    });
    let eviction_key = super::pools::TenantPoolKey::new(
        "ws-target",
        "user-viewer",
        &created_conn.id,
        None,
        &serde_json::json!({}),
    );
    state
        .pool_manager
        .register_session(&eviction_key, eviction_session)
        .unwrap();

    // Elevate user-viewer to Owner so they can delete connection
    mem_repo
        .add_member("ws-target", "user-viewer", super::tenancy::Role::Owner)
        .await
        .unwrap();

    let response = test_app
        .oneshot(
            Request::delete(format!(
                "/api/v1/workspaces/ws-target/connections/{}",
                created_conn.id
            ))
            .header(axum::http::header::COOKIE, "tabularis_session=active")
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(cancelled_for_eviction.load(std::sync::atomic::Ordering::SeqCst));
}

#[tokio::test]
async fn test_global_session_revocation() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-revoked".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });

    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state = AppState::with_session_repository(metadata, session_repo.clone(), true);

    let cancelled = Arc::new(AtomicBool::new(false));
    let pool_key = super::pools::TenantPoolKey::new("ws-test", "user-revoked", "conn-1", None, &serde_json::json!({}));
    state
        .pool_manager
        .register_session(
            &pool_key,
            Arc::new(TestEngineSession {
                cancelled: cancelled.clone(),
            }),
        )
        .unwrap();
    assert_eq!(state.pool_manager.active_pool_count(), 1);

    let test_app = app(state.clone());

    let response = test_app
        .oneshot(
            Request::post("/api/v1/auth/logout-all")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(session_repo.revoked.load(Ordering::SeqCst));
    assert_eq!(state.pool_manager.active_pool_count(), 0);
    assert!(cancelled.load(Ordering::SeqCst));

    let cookie_header = response
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cookie_header.contains("Max-Age=0"));

    // Subsequent request with revoked session is rejected with 401
    let next_app = app(state);
    let next_response = next_app
        .oneshot(
            Request::get("/api/v1/session")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(next_response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_audit_events_endpoint_and_rbac() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-admin".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });

    let mem_repo = Arc::new(TestMembershipRepository::default());
    mem_repo
        .add_member("ws-gov", "user-admin", super::tenancy::Role::Admin)
        .await
        .unwrap();
    mem_repo
        .add_member("ws-gov", "user-viewer", super::tenancy::Role::Viewer)
        .await
        .unwrap();

    let audit_repo = Arc::new(super::audit::MemoryAuditRepository::new());
    audit_repo
        .record(&tabularis_core::AuditEvent {
            id: "aud-sample".to_string(),
            scope: tabularis_core::AuditScope::Workspace {
                workspace_id: "ws-gov".to_string(),
                actor_user_id: "user-admin".to_string(),
            },
            action: "workspace.audited".to_string(),
            resource_type: "workspace".to_string(),
            resource_id: Some("ws-gov".to_string()),
            request_id: None,
            occurred_at: "2026-09-06T00:00:00Z".to_string(),
            metadata: serde_json::json!({}),
        })
        .unwrap();

    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state = AppState::with_session_repository(metadata, session_repo, true)
        .with_tenancy_repositories(
            Arc::new(TestWorkspaceRepository::default()),
            mem_repo.clone(),
            Arc::new(MemoryUserRepository::default()),
        )
        .with_audit_repository(audit_repo);

    let test_app = app(state);

    // Case 1: Admin can view audit logs -> 200 OK
    let response = test_app
        .clone()
        .oneshot(
            Request::get("/api/v1/workspaces/ws-gov/audit-events")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 2048).await.unwrap();
    let events: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["id"], "aud-sample");

    // Case 2: Viewer receives 403 Forbidden
    let viewer_session = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-viewer".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let metadata2 = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state_viewer = AppState::with_session_repository(metadata2, viewer_session, true)
        .with_tenancy_repositories(
            Arc::new(TestWorkspaceRepository::default()),
            mem_repo,
            Arc::new(MemoryUserRepository::default()),
        );
    let app_viewer = app(state_viewer);

    let response = app_viewer
        .oneshot(
            Request::get("/api/v1/workspaces/ws-gov/audit-events")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_saved_queries_crud_and_permissions() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-alice".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });

    let mem_repo = Arc::new(TestMembershipRepository::default());
    mem_repo
        .add_member("ws-sq", "user-alice", super::tenancy::Role::Editor)
        .await
        .unwrap();
    mem_repo
        .add_member("ws-sq", "user-bob", super::tenancy::Role::Viewer)
        .await
        .unwrap();

    let saved_repo = Arc::new(super::saved_queries::MemorySavedQueryRepository::new());
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state = AppState::with_session_repository(metadata, session_repo, true)
        .with_tenancy_repositories(
            Arc::new(TestWorkspaceRepository::default()),
            mem_repo.clone(),
            Arc::new(MemoryUserRepository::default()),
        )
        .with_saved_queries_repository(saved_repo.clone());

    let test_app = app(state);

    // Case 1: Alice creates shared query
    let response = test_app
        .clone()
        .oneshot(
            Request::post("/api/v1/workspaces/ws-sq/saved-queries")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Shared Reports","queryText":"SELECT * FROM reports","isShared":true}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let bytes = to_bytes(response.into_body(), 2048).await.unwrap();
    let created_query: Value = serde_json::from_slice(&bytes).unwrap();
    let query_id = created_query["id"].as_str().unwrap().to_string();

    // Case 2: Bob (Viewer) can view Alice's shared query
    let bob_session = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-bob".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let metadata_bob = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state_bob = AppState::with_session_repository(metadata_bob, bob_session, true)
        .with_tenancy_repositories(
            Arc::new(TestWorkspaceRepository::default()),
            mem_repo.clone(),
            Arc::new(MemoryUserRepository::default()),
        )
        .with_saved_queries_repository(saved_repo.clone());

    let app_bob = app(state_bob);

    let response = app_bob
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/workspaces/ws-sq/saved-queries/{query_id}"))
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Case 3: Bob cannot update Alice's shared query -> 403 Forbidden
    let response = app_bob
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/workspaces/ws-sq/saved-queries/{query_id}"))
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Hacked Query"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    // Case 4: Alice (creator) can update her query -> 200 OK
    let response = test_app
        .clone()
        .oneshot(
            Request::patch(format!("/api/v1/workspaces/ws-sq/saved-queries/{query_id}"))
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Renamed Reports"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Case 5: Alice can delete her query -> 204 NO_CONTENT
    let response = test_app
        .oneshot(
            Request::delete(format!("/api/v1/workspaces/ws-sq/saved-queries/{query_id}"))
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_query_history_endpoint_and_isolation() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-analyst".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });

    let mem_repo = Arc::new(TestMembershipRepository::default());
    mem_repo
        .add_member("ws-hist", "user-analyst", super::tenancy::Role::Viewer)
        .await
        .unwrap();
    mem_repo
        .add_member("ws-hist", "user-lead", super::tenancy::Role::Admin)
        .await
        .unwrap();

    let history_repo = Arc::new(super::history::MemoryQueryHistoryRepository::new());
    history_repo
        .record_start(super::history::RecordQueryStartInput {
            id: "qh-entry-1".to_string(),
            workspace_id: "ws-hist".to_string(),
            user_id: "user-analyst".to_string(),
            connection_id: Some("c-pg".to_string()),
            database_name: None,
            query_text: "SELECT 100".to_string(),
        })
        .await
        .unwrap();
    history_repo
        .record_finish(super::history::RecordQueryFinishInput {
            id: "qh-entry-1".to_string(),
            status: "succeeded".to_string(),
            duration_ms: 25,
            rows_affected: Some(1),
            error_code: None,
        })
        .await
        .unwrap();

    history_repo
        .record_start(super::history::RecordQueryStartInput {
            id: "qh-entry-2".to_string(),
            workspace_id: "ws-hist".to_string(),
            user_id: "user-lead".to_string(),
            connection_id: Some("c-pg".to_string()),
            database_name: None,
            query_text: "SELECT 200".to_string(),
        })
        .await
        .unwrap();

    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state = AppState::with_session_repository(metadata, session_repo, true)
        .with_tenancy_repositories(
            Arc::new(TestWorkspaceRepository::default()),
            mem_repo.clone(),
            Arc::new(MemoryUserRepository::default()),
        )
        .with_history_repository(history_repo.clone());

    let test_app = app(state);

    // Case 1: Analyst (Viewer) lists query history -> only sees own history
    let response = test_app
        .oneshot(
            Request::get("/api/v1/workspaces/ws-hist/query-history")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 2048).await.unwrap();
    let history: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0]["id"], "qh-entry-1");
    assert_eq!(history[0]["queryText"], "SELECT 100");

    // Case 2: Lead (Admin) lists query history -> sees all workspace history
    let lead_session = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-lead".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let metadata_lead = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state_lead = AppState::with_session_repository(metadata_lead, lead_session, true)
        .with_tenancy_repositories(
            Arc::new(TestWorkspaceRepository::default()),
            mem_repo,
            Arc::new(MemoryUserRepository::default()),
        )
        .with_history_repository(history_repo);

    let app_lead = app(state_lead);

    let response = app_lead
        .oneshot(
            Request::get("/api/v1/workspaces/ws-hist/query-history")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 2048).await.unwrap();
    let history_all: Vec<Value> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(history_all.len(), 2);
}

#[tokio::test]
async fn test_security_headers_present_on_responses() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-sec".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state =
        AppState::with_session_repository(metadata, session_repo, true).with_security_policy(
            SecurityPolicy::new(vec!["http://localhost:5173".to_string()], true),
        );

    let response = app(state)
        .oneshot(Request::get("/health/live").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers();
    assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
    assert_eq!(headers.get("x-frame-options").unwrap(), "DENY");
    assert_eq!(
        headers.get("referrer-policy").unwrap(),
        "strict-origin-when-cross-origin"
    );
    assert!(headers.get("content-security-policy").is_some());
    assert!(headers.get("permissions-policy").is_some());
    assert_eq!(
        headers.get("strict-transport-security").unwrap(),
        "max-age=31536000; includeSubDomains"
    );
}

#[tokio::test]
async fn test_cors_preflight_and_origin_validation() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state =
        AppState::with_session_repository(metadata, session_repo, false).with_security_policy(
            SecurityPolicy::new(vec!["http://localhost:5173".to_string()], false),
        );

    let test_app = app(state);

    // Case 1: Preflight from allowed origin
    let response = test_app
        .clone()
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/v1/workspaces")
                .header("origin", "http://localhost:5173")
                .header("access-control-request-method", "POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let headers = response.headers();
    assert_eq!(
        headers.get("access-control-allow-origin").unwrap(),
        "http://localhost:5173"
    );
    assert_eq!(
        headers.get("access-control-allow-credentials").unwrap(),
        "true"
    );

    // Case 2: Preflight from disallowed origin
    let response = test_app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/v1/workspaces")
                .header("origin", "http://attacker.com")
                .header("access-control-request-method", "POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_csrf_origin_rejection_on_mutating_requests() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-csrf".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    let state =
        AppState::with_session_repository(metadata, session_repo, false).with_security_policy(
            SecurityPolicy::new(vec!["http://localhost:5173".to_string()], false),
        );

    let test_app = app(state);

    // Case 1: Attacker cross-origin POST rejected
    let response = test_app
        .clone()
        .oneshot(
            Request::post("/api/v1/workspaces")
                .header("origin", "http://attacker.com")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Hacked"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), 2048).await.unwrap();
    let err: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(err["code"], "CSRF_ORIGIN_REJECTED");

    // Case 2: Cross-site sec-fetch-site rejected
    let response = test_app
        .clone()
        .oneshot(
            Request::post("/api/v1/workspaces")
                .header("sec-fetch-site", "cross-site")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"Hacked"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let bytes = to_bytes(response.into_body(), 2048).await.unwrap();
    let err: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(err["code"], "CSRF_DETECTED");
}

#[tokio::test]
async fn test_rate_limiter_throttling_and_retry_after() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: Some(SessionPrincipal {
            user_id: "user-rate".to_string(),
        }),
        revoked: AtomicBool::new(false),
    });
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/tabularis").unwrap();
    // Burst of 2, 60 requests/minute
    let rate_limiter = RateLimiter::new(60, 2);
    let state = AppState::with_session_repository(metadata, session_repo, false)
        .with_rate_limiter(rate_limiter);

    let test_app = app(state);

    // Request 1: OK
    let res1 = test_app
        .clone()
        .oneshot(
            Request::get("/api/v1/auth/session")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header("x-forwarded-for", "198.51.100.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res1.status(), StatusCode::OK);

    // Request 2: OK
    let res2 = test_app
        .clone()
        .oneshot(
            Request::get("/api/v1/auth/session")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header("x-forwarded-for", "198.51.100.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res2.status(), StatusCode::OK);

    // Request 3: Exceeded limit -> 429
    let res3 = test_app
        .clone()
        .oneshot(
            Request::get("/api/v1/auth/session")
                .header(axum::http::header::COOKIE, "tabularis_session=active")
                .header("x-forwarded-for", "198.51.100.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res3.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(res3.headers().get("retry-after").is_some());
    let bytes = to_bytes(res3.into_body(), 2048).await.unwrap();
    let err: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(err["code"], "RATE_LIMIT_EXCEEDED");

    // Health check is exempt from rate limiting
    let health_res = test_app
        .oneshot(
            Request::get("/health/live")
                .header("x-forwarded-for", "198.51.100.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health_res.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_pin_registration_and_jwt_auth_flow() {
    let session_repo = Arc::new(crate::auth::session_test_repository::SessionRegistry::default());
    let user_repo = Arc::new(MemoryUserRepository::default());
    let app = app_with_tenancy_and_auth(
        session_repo,
        user_repo,
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        None,
        true,
    );

    // 1. Register with 6-digit valid PIN
    let register_res = app
        .clone()
        .oneshot(
            Request::post("/api/v1/auth/pin/register")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"username":"developer","pin":"839164","recoveryEmail":"dev@tabularis.local"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(register_res.status(), StatusCode::CREATED);
    let cookie = register_res
        .headers()
        .get(SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(cookie.contains("tabularis_jwt="));

    let body_bytes = to_bytes(register_res.into_body(), 4096).await.unwrap();
    let reg_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let token = reg_json["token"].as_str().unwrap();
    assert_eq!(reg_json["tokenType"], "Bearer");
    assert_eq!(reg_json["user"]["username"], "developer");
    assert!(token.contains('.')); // JWT structure: header.payload.signature

    // 2. Call /api/v1/auth/pin/me with Bearer token
    let me_res = app
        .clone()
        .oneshot(
            Request::get("/api/v1/auth/pin/me")
                .header(axum::http::header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(me_res.status(), StatusCode::OK);
    let me_body = to_bytes(me_res.into_body(), 2048).await.unwrap();
    let me_json: Value = serde_json::from_slice(&me_body).unwrap();
    assert_eq!(me_json["authenticated"], true);
    assert_eq!(me_json["username"], "developer");

    // 3. Login with wrong PIN -> 401
    let wrong_login_res = app
        .clone()
        .oneshot(
            Request::post("/api/v1/auth/pin/login")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"username":"developer","pin":"999999"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(wrong_login_res.status(), StatusCode::UNAUTHORIZED);

    // 4. Login with correct PIN -> 200 and issues new JWT
    let login_res = app
        .oneshot(
            Request::post("/api/v1/auth/pin/login")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"username":"developer","pin":"839164"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(login_res.status(), StatusCode::OK);
    let login_body = to_bytes(login_res.into_body(), 4096).await.unwrap();
    let login_json: Value = serde_json::from_slice(&login_body).unwrap();
    assert_eq!(login_json["tokenType"], "Bearer");
    assert!(login_json["token"].as_str().unwrap().contains('.'));
}

#[tokio::test]
async fn test_pin_registration_validation_errors() {
    let session_repo = Arc::new(StaticSessionRepository {
        principal: None,
        revoked: AtomicBool::new(false),
    });
    let app = app_with_tenancy_and_auth(
        session_repo,
        Arc::new(MemoryUserRepository::default()),
        Arc::new(TestWorkspaceRepository::default()),
        Arc::new(TestMembershipRepository::default()),
        None,
        true,
    );

    // Too short (< 6 digits)
    let res_short = app
        .clone()
        .oneshot(
            Request::post("/api/v1/auth/pin/register")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"username":"user1","pin":"1234"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_short.status(), StatusCode::BAD_REQUEST);

    // Sequential numbers ("123456")
    let res_seq = app
        .clone()
        .oneshot(
            Request::post("/api/v1/auth/pin/register")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"username":"user2","pin":"123456"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_seq.status(), StatusCode::BAD_REQUEST);

    // Repeated numbers ("111111")
    let res_rep = app
        .oneshot(
            Request::post("/api/v1/auth/pin/register")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"username":"user3","pin":"111111"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_rep.status(), StatusCode::BAD_REQUEST);
}
