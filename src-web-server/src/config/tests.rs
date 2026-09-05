use super::{AppConfig, DeploymentMode};

#[test]
fn uses_safe_development_defaults() {
    let config = AppConfig::from_values(Vec::<(String, String)>::new()).unwrap();

    assert_eq!(config.bind_address.to_string(), "127.0.0.1:3000");
    assert_eq!(config.deployment_mode, DeploymentMode::Development);
    assert_eq!(config.metadata_max_connections, 10);
    assert_eq!(
        config.metadata_database_url,
        "postgres://tabularis:tabularis@127.0.0.1:5432/tabularis"
    );
    assert_eq!(config.public_origin, "http://localhost:5173");
    assert_eq!(config.oidc, None);
    assert_eq!(config.session_ttl_seconds, 28_800);
    assert!(!config.session_cookie_secure);
}

#[test]
fn accepts_explicit_production_configuration() {
    let config = AppConfig::from_values([
        ("TABULARIS_BIND_ADDRESS", "0.0.0.0:8080"),
        ("TABULARIS_ENVIRONMENT", "production"),
        ("TABULARIS_PUBLIC_ORIGIN", "https://db.example.com"),
        (
            "TABULARIS_METADATA_DATABASE_URL",
            "postgres://metadata.internal/tabularis",
        ),
        ("TABULARIS_METADATA_MAX_CONNECTIONS", "20"),
        ("TABULARIS_OIDC_ISSUER_URL", "https://identity.example.com"),
        ("TABULARIS_OIDC_CLIENT_ID", "tabularis"),
        ("TABULARIS_OIDC_CLIENT_SECRET", "test-secret"),
        (
            "TABULARIS_OIDC_REDIRECT_URI",
            "https://db.example.com/api/v1/auth/callback",
        ),
        ("TABULARIS_SESSION_TTL_SECONDS", "3600"),
    ])
    .unwrap();

    assert_eq!(config.bind_address.to_string(), "0.0.0.0:8080");
    assert_eq!(config.deployment_mode, DeploymentMode::Production);
    assert_eq!(config.metadata_max_connections, 20);
    assert_eq!(config.public_origin, "https://db.example.com");
    assert_eq!(config.session_ttl_seconds, 3_600);
    assert!(config.session_cookie_secure);
    assert_eq!(
        config.oidc.unwrap().issuer_url,
        "https://identity.example.com"
    );
}

#[test]
fn rejects_insecure_production_origin() {
    let error = AppConfig::from_values([
        ("TABULARIS_ENVIRONMENT", "production"),
        ("TABULARIS_PUBLIC_ORIGIN", "http://db.example.com"),
        (
            "TABULARIS_METADATA_DATABASE_URL",
            "postgres://metadata.internal/tabularis",
        ),
    ])
    .unwrap_err();

    assert_eq!(
        error,
        "TABULARIS_PUBLIC_ORIGIN must use https:// in production"
    );
}

#[test]
fn rejects_unknown_environment() {
    let error = AppConfig::from_values([("TABULARIS_ENVIRONMENT", "staging")]).unwrap_err();

    assert!(error.contains("expected development or production"));
}

#[test]
fn requires_an_explicit_metadata_database_in_production() {
    let error = AppConfig::from_values([
        ("TABULARIS_ENVIRONMENT", "production"),
        ("TABULARIS_PUBLIC_ORIGIN", "https://db.example.com"),
    ])
    .unwrap_err();

    assert_eq!(
        error,
        "TABULARIS_METADATA_DATABASE_URL is required in production"
    );
}

#[test]
fn requires_complete_oidc_configuration_in_production() {
    let error = AppConfig::from_values([
        ("TABULARIS_ENVIRONMENT", "production"),
        ("TABULARIS_PUBLIC_ORIGIN", "https://db.example.com"),
        (
            "TABULARIS_METADATA_DATABASE_URL",
            "postgres://metadata.internal/tabularis",
        ),
    ])
    .unwrap_err();

    assert_eq!(error, "OIDC configuration is required in production");
}

#[test]
fn rejects_partial_oidc_configuration() {
    let error =
        AppConfig::from_values([("TABULARIS_OIDC_ISSUER_URL", "https://identity.example.com")])
            .unwrap_err();

    assert!(error.contains("must provide issuer URL"));
}

#[test]
fn rejects_insecure_production_oidc_urls() {
    let error = AppConfig::from_values([
        ("TABULARIS_ENVIRONMENT", "production"),
        ("TABULARIS_PUBLIC_ORIGIN", "https://db.example.com"),
        (
            "TABULARIS_METADATA_DATABASE_URL",
            "postgres://metadata.internal/tabularis",
        ),
        ("TABULARIS_OIDC_ISSUER_URL", "http://identity.example.com"),
        ("TABULARIS_OIDC_CLIENT_ID", "tabularis"),
        ("TABULARIS_OIDC_CLIENT_SECRET", "test-secret"),
        (
            "TABULARIS_OIDC_REDIRECT_URI",
            "https://db.example.com/api/v1/auth/callback",
        ),
    ])
    .unwrap_err();

    assert_eq!(
        error,
        "OIDC issuer and redirect URI must use https:// in production"
    );
}

#[test]
fn rejects_session_ttl_outside_the_supported_range() {
    for value in ["299", "2592001", "not-a-number"] {
        assert!(AppConfig::from_values([("TABULARIS_SESSION_TTL_SECONDS", value)]).is_err());
    }
}

#[test]
fn redacts_the_oidc_client_secret_from_debug_output() {
    let config = AppConfig::from_values([
        ("TABULARIS_OIDC_ISSUER_URL", "https://identity.example.com"),
        ("TABULARIS_OIDC_CLIENT_ID", "tabularis"),
        ("TABULARIS_OIDC_CLIENT_SECRET", "must-not-leak"),
        (
            "TABULARIS_OIDC_REDIRECT_URI",
            "http://localhost:3000/api/v1/auth/callback",
        ),
    ])
    .unwrap();

    let debug_output = format!("{config:?}");
    assert!(!debug_output.contains("must-not-leak"));
    assert!(debug_output.contains("[REDACTED]"));
}

#[test]
fn rejects_metadata_pool_sizes_outside_the_supported_range() {
    for value in ["0", "101", "not-a-number"] {
        assert!(AppConfig::from_values([("TABULARIS_METADATA_MAX_CONNECTIONS", value)]).is_err());
    }
}
