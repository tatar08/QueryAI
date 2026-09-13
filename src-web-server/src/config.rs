pub mod secrets;
use secrets::RuntimeSecrets;
use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;

const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1:3000";
const DEFAULT_PUBLIC_ORIGIN: &str = "http://localhost:5173";
const DEFAULT_METADATA_DATABASE_URL: &str =
    "postgres://tabularis:tabularis@127.0.0.1:5432/tabularis";
const DEFAULT_METADATA_MAX_CONNECTIONS: u32 = 10;
const DEFAULT_SESSION_TTL_SECONDS: i32 = 8 * 60 * 60;
const MIN_SESSION_TTL_SECONDS: i32 = 5 * 60;
const MAX_SESSION_TTL_SECONDS: i32 = 30 * 24 * 60 * 60;
const DEFAULT_RATE_LIMIT_PER_MINUTE: u32 = 120;
const DEFAULT_RATE_LIMIT_BURST: u32 = 30;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeploymentMode {
    Development,
    Production,
}

#[derive(Clone, Eq, PartialEq)]
pub struct OidcConfig {
    pub issuer_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

impl std::fmt::Debug for OidcConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OidcConfig")
            .field("issuer_url", &self.issuer_url)
            .field("client_id", &self.client_id)
            .field("client_secret", &"[REDACTED]")
            .field("redirect_uri", &self.redirect_uri)
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppConfig {
    pub secrets: RuntimeSecrets,
    pub bind_address: SocketAddr,
    pub deployment_mode: DeploymentMode,
    pub metadata_database_url: String,
    pub metadata_max_connections: u32,
    pub public_origin: String,
    pub allowed_origins: Vec<String>,
    pub oidc: Option<OidcConfig>,
    pub session_ttl_seconds: i32,
    pub session_cookie_secure: bool,
    pub rate_limit_per_minute: u32,
    pub rate_limit_burst: u32,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        Self::from_values(env::vars())
    }

    pub fn from_values<I, K, V>(values: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        let values = values
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect::<HashMap<_, _>>();

        let bind_address = values
            .get("TABULARIS_BIND_ADDRESS")
            .map(String::as_str)
            .unwrap_or(DEFAULT_BIND_ADDRESS)
            .parse::<SocketAddr>()
            .map_err(|error| format!("Invalid TABULARIS_BIND_ADDRESS: {error}"))?;

        let deployment_mode = match values
            .get("TABULARIS_ENVIRONMENT")
            .map(String::as_str)
            .unwrap_or("development")
        {
            "development" => DeploymentMode::Development,
            "production" => DeploymentMode::Production,
            value => {
                return Err(format!(
                    "Invalid TABULARIS_ENVIRONMENT '{value}'; expected development or production"
                ));
            }
        };

        let public_origin = values
            .get("TABULARIS_PUBLIC_ORIGIN")
            .cloned()
            .unwrap_or_else(|| DEFAULT_PUBLIC_ORIGIN.to_string());

        if deployment_mode == DeploymentMode::Production && !public_origin.starts_with("https://") {
            return Err("TABULARIS_PUBLIC_ORIGIN must use https:// in production".to_string());
        }

        let metadata_database_url = values
            .get("TABULARIS_METADATA_DATABASE_URL")
            .cloned()
            .unwrap_or_else(|| DEFAULT_METADATA_DATABASE_URL.to_string());

        if deployment_mode == DeploymentMode::Production
            && !values.contains_key("TABULARIS_METADATA_DATABASE_URL")
        {
            return Err("TABULARIS_METADATA_DATABASE_URL is required in production".to_string());
        }

        let metadata_max_connections = values
            .get("TABULARIS_METADATA_MAX_CONNECTIONS")
            .map(|value| value.parse::<u32>())
            .transpose()
            .map_err(|error| format!("Invalid TABULARIS_METADATA_MAX_CONNECTIONS: {error}"))?;
        let metadata_max_connections =
            metadata_max_connections.unwrap_or(DEFAULT_METADATA_MAX_CONNECTIONS);

        if !(1..=100).contains(&metadata_max_connections) {
            return Err("TABULARIS_METADATA_MAX_CONNECTIONS must be between 1 and 100".to_string());
        }

        let oidc_keys = [
            "TABULARIS_OIDC_ISSUER_URL",
            "TABULARIS_OIDC_CLIENT_ID",
            "TABULARIS_OIDC_CLIENT_SECRET",
            "TABULARIS_OIDC_REDIRECT_URI",
        ];
        let configured_oidc_values = oidc_keys
            .iter()
            .filter(|key| values.get(**key).is_some_and(|value| !value.is_empty()))
            .count();
        let oidc = if configured_oidc_values == 0 {
            None
        } else if configured_oidc_values != oidc_keys.len() {
            return Err("OIDC configuration must provide issuer URL, client ID, client secret, and redirect URI together".to_string());
        } else {
            let config = OidcConfig {
                issuer_url: values["TABULARIS_OIDC_ISSUER_URL"].clone(),
                client_id: values["TABULARIS_OIDC_CLIENT_ID"].clone(),
                client_secret: values["TABULARIS_OIDC_CLIENT_SECRET"].clone(),
                redirect_uri: values["TABULARIS_OIDC_REDIRECT_URI"].clone(),
            };
            if deployment_mode == DeploymentMode::Production
                && (!config.issuer_url.starts_with("https://")
                    || !config.redirect_uri.starts_with("https://"))
            {
                return Err(
                    "OIDC issuer and redirect URI must use https:// in production".to_string(),
                );
            }
            Some(config)
        };

        if deployment_mode == DeploymentMode::Production && oidc.is_none() {
            return Err("OIDC configuration is required in production".to_string());
        }

        let session_ttl_seconds = values
            .get("TABULARIS_SESSION_TTL_SECONDS")
            .map(|value| value.parse::<i32>())
            .transpose()
            .map_err(|error| format!("Invalid TABULARIS_SESSION_TTL_SECONDS: {error}"))?
            .unwrap_or(DEFAULT_SESSION_TTL_SECONDS);
        if !(MIN_SESSION_TTL_SECONDS..=MAX_SESSION_TTL_SECONDS).contains(&session_ttl_seconds) {
            return Err(
                "TABULARIS_SESSION_TTL_SECONDS must be between 300 and 2592000".to_string(),
            );
        }

        let allowed_origins = if let Some(origins_str) = values.get("TABULARIS_ALLOWED_ORIGINS") {
            let list: Vec<String> = origins_str
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if list.is_empty() {
                vec![public_origin.clone()]
            } else {
                list
            }
        } else {
            vec![public_origin.clone()]
        };

        if deployment_mode == DeploymentMode::Production {
            for origin in &allowed_origins {
                if !origin.starts_with("https://") {
                    return Err(format!(
                        "Allowed origin '{origin}' must use https:// in production"
                    ));
                }
            }
        }

        let rate_limit_per_minute = values
            .get("TABULARIS_RATE_LIMIT_PER_MINUTE")
            .map(|value| value.parse::<u32>())
            .transpose()
            .map_err(|error| format!("Invalid TABULARIS_RATE_LIMIT_PER_MINUTE: {error}"))?
            .unwrap_or(DEFAULT_RATE_LIMIT_PER_MINUTE);
        if !(1..=10000).contains(&rate_limit_per_minute) {
            return Err("TABULARIS_RATE_LIMIT_PER_MINUTE must be between 1 and 10000".to_string());
        }

        let rate_limit_burst = values
            .get("TABULARIS_RATE_LIMIT_BURST")
            .map(|value| value.parse::<u32>())
            .transpose()
            .map_err(|error| format!("Invalid TABULARIS_RATE_LIMIT_BURST: {error}"))?
            .unwrap_or(DEFAULT_RATE_LIMIT_BURST);
        if !(1..=1000).contains(&rate_limit_burst) {
            return Err("TABULARIS_RATE_LIMIT_BURST must be between 1 and 1000".to_string());
        }

        let secrets =
            RuntimeSecrets::parse(&values, deployment_mode == DeploymentMode::Production)?;
        Ok(Self {
            secrets,
            bind_address,
            deployment_mode,
            metadata_database_url,
            metadata_max_connections,
            public_origin,
            allowed_origins,
            oidc,
            session_ttl_seconds,
            session_cookie_secure: deployment_mode == DeploymentMode::Production,
            rate_limit_per_minute,
            rate_limit_burst,
        })
    }
}

#[cfg(test)]
mod tests;
