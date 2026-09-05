use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Clone, Default)]
pub struct ConnectionService;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionValidationInput {
    pub environment: Option<String>,
    pub connection_uri: Option<String>,
    #[serde(default)]
    pub save_credentials: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionValidationResult {
    pub environment: Option<String>,
    pub connection_uri_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionValidationError {
    ConnectionUriRequiresCredentialStore,
    InvalidEnvironment(String),
}

impl ConnectionValidationError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ConnectionUriRequiresCredentialStore => {
                "connection_uri_requires_credential_store"
            }
            Self::InvalidEnvironment(_) => "invalid_environment",
        }
    }
}

impl fmt::Display for ConnectionValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConnectionUriRequiresCredentialStore => {
                write!(
                    formatter,
                    "Connection URIs must be stored in the OS keychain"
                )
            }
            Self::InvalidEnvironment(environment) => {
                write!(formatter, "Invalid environment: {environment}")
            }
        }
    }
}

impl std::error::Error for ConnectionValidationError {}

impl ConnectionService {
    pub fn validate(
        &self,
        input: ConnectionValidationInput,
    ) -> Result<ConnectionValidationResult, ConnectionValidationError> {
        let connection_uri_present = input
            .connection_uri
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        if connection_uri_present && !input.save_credentials {
            return Err(ConnectionValidationError::ConnectionUriRequiresCredentialStore);
        }

        let environment = match input.environment.as_deref() {
            None | Some("") => None,
            Some("development" | "staging" | "production") => input.environment,
            Some(environment) => {
                return Err(ConnectionValidationError::InvalidEnvironment(
                    environment.to_string(),
                ));
            }
        };

        Ok(ConnectionValidationResult {
            environment,
            connection_uri_present,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{ConnectionService, ConnectionValidationError, ConnectionValidationInput};

    fn input(
        environment: Option<&str>,
        connection_uri: Option<&str>,
        save_credentials: bool,
    ) -> ConnectionValidationInput {
        ConnectionValidationInput {
            environment: environment.map(str::to_string),
            connection_uri: connection_uri.map(str::to_string),
            save_credentials,
        }
    }

    #[test]
    fn accepts_supported_environments() {
        let service = ConnectionService;

        for environment in ["development", "staging", "production"] {
            let result = service
                .validate(input(Some(environment), None, false))
                .unwrap();
            assert_eq!(result.environment.as_deref(), Some(environment));
        }
    }

    #[test]
    fn normalizes_an_empty_environment() {
        let result = ConnectionService
            .validate(input(Some(""), None, false))
            .unwrap();

        assert_eq!(result.environment, None);
    }

    #[test]
    fn rejects_an_unknown_environment() {
        let error = ConnectionService
            .validate(input(Some("preview"), None, false))
            .unwrap_err();

        assert_eq!(
            error,
            ConnectionValidationError::InvalidEnvironment("preview".to_string())
        );
        assert_eq!(error.code(), "invalid_environment");
    }

    #[test]
    fn rejects_a_plaintext_connection_uri() {
        let error = ConnectionService
            .validate(input(None, Some("postgres://user:secret@host/db"), false))
            .unwrap_err();

        assert_eq!(
            error,
            ConnectionValidationError::ConnectionUriRequiresCredentialStore
        );
    }

    #[test]
    fn accepts_a_connection_uri_when_credentials_are_persisted_separately() {
        let result = ConnectionService
            .validate(input(None, Some("postgres://user:secret@host/db"), true))
            .unwrap();

        assert!(result.connection_uri_present);
    }
}
