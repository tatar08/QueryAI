use super::*;
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use tower::ServiceExt;

#[test]
fn classifier_handles_literals_nested_writes_and_sequences() {
    for sql in [
        "SELECT 'delete' AS label",
        "SELECT '-- DROP'",
        "SELECT '/* INSERT */'",
        "SELECT count(*) FROM accounts",
    ] {
        assert!(is_read_query(sql), "{sql}");
    }
    for sql in [
        "SELECT 1 INTO new_table",
        "SELECT nextval('seq')",
        "SELECT * FROM nextval('seq')",
        "SELECT setval('seq', 3)",
        "SELECT custom_mutation()",
        "SELECT 1; DELETE FROM accounts",
        "WITH a AS (DELETE FROM accounts RETURNING *) SELECT * FROM a",
        "SELECT * FROM accounts FOR UPDATE",
        "EXPLAIN ANALYZE DELETE FROM accounts",
    ] {
        assert!(!is_read_query(sql), "{sql}");
    }
}

#[test]
fn development_encryption_instances_do_not_share_keys() {
    let first = KeyManager::dev_default();
    let second = KeyManager::dev_default();
    let encrypted = first.encrypt(b"credential").unwrap();
    assert!(second
        .decrypt(
            &encrypted.ciphertext,
            &encrypted.nonce,
            encrypted.key_version
        )
        .is_err());
}

#[tokio::test]
async fn default_auth_rejects_historical_shared_signatures() {
    let metadata = MetadataStore::connect_lazy("postgres://127.0.0.1:1/test").unwrap();
    let state = AppState::new(metadata);
    let historical = auth::JwtService::new(b"tabularis-default-jwt-secret-key-32b", 3600);
    let token = historical.issue("victim", "victim").unwrap();
    assert!(state.auth.jwt().verify(&token).is_err());
}

async fn request(
    router: &Router,
    method: &str,
    path: &str,
    cookie: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("cookie", cookie)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn local_config() -> config::AppConfig {
    config::AppConfig::from_values([
        (
            "TABULARIS_MASTER_KEY",
            "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=",
        ),
        (
            "TABULARIS_JWT_SECRET",
            "AgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICE=",
        ),
    ])
    .unwrap()
}

#[tokio::test]
#[ignore = "requires QUERYAI_TEST_DATABASE_URL pointing to a disposable PostgreSQL database"]
async fn postgres_restart_identity_lockout_query_and_audit_regressions() {
    let url = std::env::var("QUERYAI_TEST_DATABASE_URL").expect("disposable database URL");
    let metadata = MetadataStore::connect(&url, 8).await.unwrap();
    let config = local_config();
    let state = AppState::from_config(metadata.clone(), &config)
        .await
        .unwrap();
    let suffix = auth::random_value(8);
    let username = format!("owner-{suffix}");
    let owner = state
        .auth
        .pin_store()
        .register_account(&username, "839164", None)
        .await
        .unwrap();
    let original_id = owner.user_id.clone();
    let restarted = AppState::from_config(metadata.clone(), &config)
        .await
        .unwrap();
    assert_eq!(
        restarted
            .auth
            .pin_store()
            .login(&username, "839164")
            .await
            .unwrap()
            .user_id,
        original_id
    );
    assert!(restarted
        .auth
        .pin_store()
        .register_account(&username, "928374", None)
        .await
        .is_err());
    let other = restarted
        .auth
        .pin_store()
        .register_account(&format!("viewer-{suffix}"), "928374", None)
        .await
        .unwrap();
    let owner_cookie = format!(
        "tabularis_jwt={}",
        state
            .auth
            .issue_pin_token(&owner.user_id, &owner.username)
            .await
            .unwrap()
    );
    let other_cookie = format!(
        "tabularis_jwt={}",
        state
            .auth
            .issue_pin_token(&other.user_id, &other.username)
            .await
            .unwrap()
    );
    let router = app(restarted.clone());
    let (status, _) = request(
        &router,
        "POST",
        "/api/v1/auth/pin/change",
        &owner_cookie,
        json!({"username":other.username,"oldPin":"928374","newPin":"748392"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for _ in 0..5 {
        assert!(state
            .auth
            .pin_store()
            .update_pin(&other.user_id, &other.username, "000000", "748392")
            .await
            .is_err());
    }
    assert!(restarted
        .auth
        .pin_store()
        .login(&other.username, "928374")
        .await
        .unwrap_err()
        .contains("locked"));
    sqlx::query("UPDATE pin_credentials SET locked_until = 0 WHERE user_id = $1")
        .bind(&other.user_id)
        .execute(metadata.pool())
        .await
        .unwrap();
    restarted
        .auth
        .pin_store()
        .update_pin(&other.user_id, &other.username, "928374", "748392")
        .await
        .unwrap();
    assert!(state
        .auth
        .pin_store()
        .login(&other.username, "928374")
        .await
        .is_err());
    assert!(state
        .auth
        .pin_store()
        .login(&other.username, "748392")
        .await
        .is_ok());

    let (status, workspace) = request(
        &router,
        "POST",
        "/api/v1/workspaces",
        &owner_cookie,
        json!({"name":format!("test-{suffix}")}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{workspace}");
    let ws = workspace["id"].as_str().unwrap();
    restarted
        .memberships
        .add_member(ws, &other.user_id, Role::Viewer)
        .await
        .unwrap();
    let parsed: tokio_postgres::Config = url.parse().unwrap();
    let params = json!({"host":"127.0.0.1", "port": parsed.get_ports()[0], "database":parsed.get_dbname().unwrap(), "ssl":false});
    let (status, connection) = request(&router, "POST", &format!("/api/v1/workspaces/{ws}/connections"), &owner_cookie,
        json!({"name":"target", "driver":"postgres", "publicParams":params, "credentials":{"username":parsed.get_user().unwrap(),"password":"fixture-not-a-real-secret"}})).await;
    assert_eq!(status, StatusCode::CREATED, "{connection}");
    assert!(!connection.to_string().contains("fixture-not-a-real-secret"));
    let conn = connection["id"].as_str().unwrap();
    assert_eq!(
        restarted
            .connection_repo
            .get_credentials(ws, conn)
            .await
            .unwrap()
            .unwrap()["password"],
        "fixture-not-a-real-secret"
    );
    let query_path = format!("/api/v1/workspaces/{ws}/connections/{conn}/queries");
    let (status, result) = request(
        &router,
        "POST",
        &query_path,
        &owner_cookie,
        json!({"query":"SELECT 1 AS id"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["rows"][0][0], "1");
    let (status, result) = request(
        &router,
        "POST",
        &query_path,
        &other_cookie,
        json!({"query":"SELECT 'delete' AS label"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(restarted.pool_manager.active_pool_count(), 2);
    for sql in [
        "SELECT 1 INTO forbidden_table",
        "SELECT nextval('seq')",
        "SELECT * FROM nextval('seq')",
        "DELETE FROM users",
    ] {
        let (status, _) = request(
            &router,
            "POST",
            &query_path,
            &other_cookie,
            json!({"query":sql}),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{sql}");
    }
    let (status, schema) = request(
        &router,
        "GET",
        &format!("/api/v1/workspaces/{ws}/connections/{conn}/schema?resource=tables"),
        &owner_cookie,
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{schema}");
    assert!(schema
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["name"] == "users"));
    let (status, _) = request(
        &router,
        "POST",
        &format!("/api/v1/connections/{conn}/queries"),
        "",
        json!({"query":"SELECT 1"}),
    )
    .await;
    assert_ne!(status, StatusCode::OK);
    let audit = restarted
        .audit_repo
        .list_for_workspace(ws, 100, 0)
        .await
        .unwrap();
    assert!(audit.iter().any(|event| event.action == "query.executed"));
    assert!(audit
        .iter()
        .all(|event| !event.created_at.starts_with("2026-09-06")));

    let conn_record = restarted
        .connection_repo
        .get_by_id(ws, conn)
        .await
        .unwrap()
        .unwrap();
    let session = engine::scoped::workspace_session(&restarted, &other.user_id, &conn_record)
        .await
        .unwrap();
    assert!(session
        .execute_with_policy("CREATE TABLE forbidden_direct(id int)", None, 1, None, true)
        .await
        .is_err());
    assert!(session
        .execute_with_policy("SELECT 1", None, 1, None, true)
        .await
        .is_ok());

    // Rotation must update the actual repository, not only AppState's key field.
    let mut rotated_config = local_config();
    rotated_config.secrets.historical = vec![(1, config.secrets.master.unwrap())];
    rotated_config.secrets.master = config.secrets.jwt;
    rotated_config.secrets.key_version = 2;
    let rotated = AppState::from_config(metadata.clone(), &rotated_config)
        .await
        .unwrap();
    let credential = rotated
        .connection_repo
        .get_credentials(ws, conn)
        .await
        .unwrap()
        .unwrap();
    rotated
        .connection_repo
        .update(
            ws,
            conn,
            None,
            None,
            None,
            None,
            Some(credential),
            &owner.user_id,
        )
        .await
        .unwrap();
    let version: i32 = sqlx::query_scalar(
        "SELECT key_version FROM connection_credentials WHERE connection_id = $1",
    )
    .bind(conn)
    .fetch_one(metadata.pool())
    .await
    .unwrap();
    assert_eq!(version, 2);
    assert!(restarted
        .connection_repo
        .get_credentials(ws, conn)
        .await
        .is_err());
    assert!(rotated
        .connection_repo
        .get_credentials(ws, conn)
        .await
        .is_ok());

    // A pre-migration identity must never be reclaimed by registering a PIN.
    let reserved = format!("reserved-{suffix}");
    state
        .users
        .find_or_create(
            "tabularis:pin",
            &format!("pin:{}", reserved.to_lowercase()),
            None,
            None,
        )
        .await
        .unwrap();
    assert!(restarted
        .auth
        .pin_store()
        .register_account(&reserved, "839164", None)
        .await
        .is_err());
    // The unique identity constraint serializes competing registrations across instances.
    let concurrent = format!("concurrent-{suffix}");
    let (first, second) = tokio::join!(
        state
            .auth
            .pin_store()
            .register_account(&concurrent, "839164", None),
        restarted
            .auth
            .pin_store()
            .register_account(&concurrent, "928374", None)
    );
    assert_ne!(first.is_ok(), second.is_ok());
}

#[tokio::test]
async fn audit_reports_persistence_failure_instead_of_background_success() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(100))
        .connect_lazy("postgres://127.0.0.1:1/unavailable")
        .unwrap();
    let repository = PostgresAuditRepository::new(pool);
    let result = audit::persist_workspace_audit(
        &repository,
        WorkspaceAuditContext {
            workspace_id: "ws".into(),
            actor_user_id: "user".into(),
            request_id: None,
        },
        WorkspaceAuditInput {
            id: "audit".into(),
            action: "query.executed".into(),
            resource_type: "connection".into(),
            resource_id: None,
            occurred_at: chrono::Utc::now().to_rfc3339(),
            metadata: json!({}),
        },
    )
    .await;
    assert!(result.is_err());
}

#[derive(Clone)]
struct ProviderFixture {
    issuer: String,
}

async fn provider_discovery(State(fixture): State<ProviderFixture>) -> Json<Value> {
    Json(
        json!({"issuer":fixture.issuer, "authorization_endpoint":format!("{}/authorize",fixture.issuer),
        "token_endpoint":format!("{}/token",fixture.issuer), "jwks_uri":format!("{}/keys",fixture.issuer),
        "response_types_supported":["code"], "subject_types_supported":["public"],
        "id_token_signing_alg_values_supported":["HS256"], "token_endpoint_auth_methods_supported":["client_secret_basic"]}),
    )
}

async fn provider_token(
    State(fixture): State<ProviderFixture>,
    axum::extract::Form(form): axum::extract::Form<std::collections::HashMap<String, String>>,
) -> Json<Value> {
    use openidconnect::{
        core::{CoreHmacKey, CoreIdToken, CoreIdTokenClaims, CoreJwsSigningAlgorithm},
        AccessToken, Audience, EmptyAdditionalClaims, IssuerUrl, Nonce, StandardClaims,
        SubjectIdentifier,
    };
    let code = form.get("code").unwrap();
    let verifier = form.get("code_verifier").unwrap();
    let audience = if code == "wrong-audience" {
        "other-app"
    } else {
        "test-client&encoded"
    };
    let issuer = if code == "wrong-issuer" {
        format!("{}/other", fixture.issuer)
    } else {
        fixture.issuer.clone()
    };
    let expiry = if code == "expired" { -3600 } else { 300 };
    let nonce = if code == "wrong-nonce" {
        "incorrect".into()
    } else {
        auth::generate_pkce_challenge(verifier)
    };
    let access = AccessToken::new("fixture-access-token".into());
    let claims = CoreIdTokenClaims::new(
        IssuerUrl::new(issuer).unwrap(),
        vec![Audience::new(audience.into())],
        chrono::Utc::now() + chrono::Duration::seconds(expiry),
        chrono::Utc::now(),
        StandardClaims::new(SubjectIdentifier::new("fixture-user".into())),
        EmptyAdditionalClaims {},
    )
    .set_nonce(Some(Nonce::new(nonce)));
    let secret = if code == "wrong-signature" {
        "wrong-key"
    } else {
        "fixture-client-secret"
    };
    let token = CoreIdToken::new(
        claims,
        &CoreHmacKey::new(secret),
        CoreJwsSigningAlgorithm::HmacSha256,
        Some(&access),
        None,
    )
    .unwrap();
    Json(
        json!({"access_token":"fixture-access-token", "token_type":"Bearer", "id_token":token.to_string(), "expires_in":300}),
    )
}

#[tokio::test]
async fn oidc_discovers_exchanges_and_rejects_invalid_signed_claims() {
    use auth::OidcClient;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let issuer = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new()
        .route("/.well-known/openid-configuration", get(provider_discovery))
        .route("/keys", get(|| async { Json(json!({"keys":[]})) }))
        .route("/token", post(provider_token))
        .with_state(ProviderFixture {
            issuer: issuer.clone(),
        });
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let client = auth::StandardOidcClient::new(config::OidcConfig {
        issuer_url: issuer,
        client_id: "test-client&encoded".into(),
        client_secret: "fixture-client-secret".into(),
        redirect_uri: "http://localhost/callback?part=1&part=2".into(),
    })
    .await
    .unwrap();
    let verifier = auth::random_value(32);
    let url = reqwest::Url::parse(
        &client.authorization_url("fixture-state", &auth::generate_pkce_challenge(&verifier)),
    )
    .unwrap();
    let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
    assert_eq!(params["client_id"], "test-client&encoded");
    assert_eq!(
        params["redirect_uri"],
        "http://localhost/callback?part=1&part=2"
    );
    assert_eq!(params["nonce"], auth::generate_pkce_challenge(&verifier));
    assert_eq!(
        client
            .exchange_code("valid", &verifier)
            .await
            .unwrap()
            .subject,
        "fixture-user"
    );
    for code in [
        "wrong-audience",
        "wrong-issuer",
        "expired",
        "wrong-nonce",
        "wrong-signature",
    ] {
        assert!(
            client.exchange_code(code, &verifier).await.is_err(),
            "{code}"
        );
    }
    task.abort();
}

#[test]
fn secret_configuration_rejects_missing_invalid_and_shared_defaults() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let values = std::collections::HashMap::new();
    assert!(config::secrets::RuntimeSecrets::parse(&values, true).is_err());
    for bad in [
        "invalid".into(),
        STANDARD.encode([0; 32]),
        STANDARD.encode(b"tabularis-dev-master-key-32bytes"),
    ] {
        let values = std::collections::HashMap::from([("TABULARIS_MASTER_KEY".into(), bad)]);
        assert!(config::secrets::RuntimeSecrets::parse(&values, false).is_err());
    }
    let config = local_config();
    assert!(!format!("{:?}", config.secrets).contains("AQID"));
}

#[tokio::test]
#[ignore = "requires QUERYAI_TEST_DATABASE_URL pointing to a disposable PostgreSQL database"]
async fn oidc_bootstrap_callback_creates_a_real_persisted_session() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let issuer = format!("http://{}", listener.local_addr().unwrap());
    let provider = Router::new()
        .route("/.well-known/openid-configuration", get(provider_discovery))
        .route("/keys", get(|| async { Json(json!({"keys":[]})) }))
        .route("/token", post(provider_token))
        .with_state(ProviderFixture {
            issuer: issuer.clone(),
        });
    let task = tokio::spawn(async move {
        axum::serve(listener, provider).await.unwrap();
    });
    let mut config = local_config();
    config.oidc = Some(config::OidcConfig {
        issuer_url: issuer,
        client_id: "test-client&encoded".into(),
        client_secret: "fixture-client-secret".into(),
        redirect_uri: "http://localhost/api/v1/auth/callback".into(),
    });
    let metadata = MetadataStore::connect(&std::env::var("QUERYAI_TEST_DATABASE_URL").unwrap(), 4)
        .await
        .unwrap();
    let state = AppState::from_config(metadata.clone(), &config)
        .await
        .unwrap();
    let router = app(state);
    let response = router
        .clone()
        .oneshot(
            Request::get("/api/v1/auth/login")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FOUND);
    let location = reqwest::Url::parse(response.headers()["location"].to_str().unwrap()).unwrap();
    let state = location
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .to_string();
    let cookie = response.headers()[SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    let response = router
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/auth/callback?code=valid&state={state}"))
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FOUND);
    let session_cookie = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap())
        .find(|v| v.starts_with("tabularis_session="))
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    let restarted = app(AppState::from_config(metadata, &config).await.unwrap());
    let (status, principal) = request(
        &restarted,
        "GET",
        "/api/v1/auth/session",
        session_cookie,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{principal}");
    assert_eq!(principal["authenticated"], true);
    task.abort();
}

#[test]
fn jwt_rotation_and_audience_validation_reject_untrusted_tokens() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let old = auth::JwtService::new(b"previous-key-for-test", 3600);
    let active = auth::JwtService::new(b"current-key-for-test", 3600);
    assert!(active.verify(&old.issue("user", "name").unwrap()).is_err());
    let token = active.issue("user", "name").unwrap();
    assert_eq!(active.verify(&token).unwrap().role, "viewer");
    let parts: Vec<_> = token.split('.').collect();
    let original: Value =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
    for (field, value) in [
        ("aud", json!("other-app")),
        ("iss", json!("other-issuer")),
        ("sub", json!("")),
        ("exp", json!(0)),
    ] {
        let mut claims = original.clone();
        claims[field] = value;
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        let input = format!("{}.{}", parts[0], payload);
        let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, b"current-key-for-test");
        let signature = URL_SAFE_NO_PAD.encode(ring::hmac::sign(&key, input.as_bytes()).as_ref());
        assert!(
            active.verify(&format!("{input}.{signature}")).is_err(),
            "{field}"
        );
    }
}

#[tokio::test]
#[ignore = "requires QUERYAI_TEST_DATABASE_URL pointing to a disposable PostgreSQL database"]
async fn persisted_jwt_logout_and_pin_change_revoke_sessions() {
    let url = std::env::var("QUERYAI_TEST_DATABASE_URL").unwrap();
    let metadata = MetadataStore::connect(&url, 8).await.unwrap();
    let config = local_config();
    let state = AppState::from_config(metadata.clone(), &config)
        .await
        .unwrap();
    let username = format!("lifecycle-{}", auth::random_value(8));
    let router = app(state.clone());
    let (status, registered) = request(
        &router,
        "POST",
        "/api/v1/auth/pin/register",
        "",
        json!({"username":username,"pin":"839164"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let first = registered["token"].as_str().unwrap();
    let (status, login) = request(
        &router,
        "POST",
        "/api/v1/auth/pin/login",
        "",
        json!({"username":username,"pin":"839164"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let second = login["token"].as_str().unwrap();
    assert_ne!(
        first, second,
        "Each login needs an independently revocable token"
    );
    let restarted = AppState::from_config(metadata, &config).await.unwrap();
    let router = app(restarted);
    let first_cookie = format!("tabularis_jwt={first}");
    let second_cookie = format!("tabularis_jwt={second}");
    assert_eq!(
        request(
            &router,
            "GET",
            "/api/v1/auth/session",
            &first_cookie,
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/logout")
                .header("cookie", &first_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let cookies: Vec<_> = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert!(cookies
        .iter()
        .any(|c| c.starts_with("tabularis_jwt=;") && c.contains("Max-Age=0")));
    assert!(cookies
        .iter()
        .any(|c| c.starts_with("tabularis_session=;") && c.contains("Max-Age=0")));
    assert_eq!(
        request(
            &router,
            "GET",
            "/api/v1/auth/session",
            &first_cookie,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header(AUTHORIZATION, format!("Bearer {first}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        request(
            &router,
            "GET",
            "/api/v1/auth/session",
            &second_cookie,
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &router,
            "POST",
            "/api/v1/auth/pin/change",
            &second_cookie,
            json!({"username":username,"oldPin":"839164","newPin":"948273"})
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(
            &router,
            "GET",
            "/api/v1/auth/session",
            &second_cookie,
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &router,
            "POST",
            "/api/v1/auth/pin/login",
            "",
            json!({"username":username,"pin":"839164"})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (_, login) = request(
        &router,
        "POST",
        "/api/v1/auth/pin/login",
        "",
        json!({"username":username,"pin":"948273"}),
    )
    .await;
    let bearer = format!("Bearer {}", login["token"].as_str().unwrap());
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/logout-all")
                .header(AUTHORIZATION, &bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/v1/auth/session")
                .header(AUTHORIZATION, bearer)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
