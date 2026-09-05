use std::fmt;
use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

pub type SchemaFuture<'a, T> = Pin<Box<dyn Future<Output = Result<Vec<T>, String>> + Send + 'a>>;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SchemaResource {
    Databases,
    Schemas,
    Tables,
    Views,
    MaterializedViews,
    Routines,
    Triggers,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDiscoveryInput {
    pub connection_id: String,
    pub resource: SchemaResource,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaDiscoveryScope {
    pub connection_id: String,
    pub resource: SchemaResource,
    pub schema: Option<String>,
}

pub trait SchemaRepository<T>: Send + Sync {
    fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, T>;
}

#[derive(Clone, Default)]
pub struct SchemaService;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaServiceError {
    InvalidConnectionId,
    Repository(String),
}

impl SchemaServiceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidConnectionId => "invalid_connection_id",
            Self::Repository(_) => "schema_repository_error",
        }
    }
}

impl fmt::Display for SchemaServiceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConnectionId => write!(formatter, "Connection ID cannot be empty"),
            Self::Repository(error) => formatter.write_str(error),
        }
    }
}

impl std::error::Error for SchemaServiceError {}

impl SchemaService {
    pub async fn discover<T: Send>(
        &self,
        repository: &dyn SchemaRepository<T>,
        input: SchemaDiscoveryInput,
    ) -> Result<Vec<T>, SchemaServiceError> {
        if input.connection_id.trim().is_empty() {
            return Err(SchemaServiceError::InvalidConnectionId);
        }

        let scope = SchemaDiscoveryScope {
            connection_id: input.connection_id,
            resource: input.resource,
            schema: input.schema,
        };
        repository
            .discover(&scope)
            .await
            .map_err(SchemaServiceError::Repository)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{
        SchemaDiscoveryInput, SchemaDiscoveryScope, SchemaFuture, SchemaRepository, SchemaResource,
        SchemaService, SchemaServiceError,
    };

    struct RecordingRepository {
        calls: AtomicUsize,
        error: Option<String>,
    }

    impl SchemaRepository<String> for RecordingRepository {
        fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                if let Some(error) = &self.error {
                    Err(error.clone())
                } else {
                    Ok(vec![format!(
                        "{}:{:?}:{}",
                        scope.connection_id,
                        scope.resource,
                        scope.schema.as_deref().unwrap_or_default()
                    )])
                }
            })
        }
    }

    fn input(connection_id: &str, resource: SchemaResource) -> SchemaDiscoveryInput {
        SchemaDiscoveryInput {
            connection_id: connection_id.to_string(),
            resource,
            schema: Some("public".to_string()),
        }
    }

    #[tokio::test]
    async fn forwards_a_validated_scope_to_the_repository() {
        let repository = RecordingRepository {
            calls: AtomicUsize::new(0),
            error: None,
        };

        let result = SchemaService
            .discover(&repository, input("connection-1", SchemaResource::Tables))
            .await
            .unwrap();

        assert_eq!(result, vec!["connection-1:Tables:public"]);
        assert_eq!(repository.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn rejects_an_empty_connection_id_without_calling_the_repository() {
        let repository = RecordingRepository {
            calls: AtomicUsize::new(0),
            error: None,
        };

        let error = SchemaService
            .discover(&repository, input("  ", SchemaResource::Schemas))
            .await
            .unwrap_err();

        assert_eq!(error, SchemaServiceError::InvalidConnectionId);
        assert_eq!(repository.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn maps_repository_failures_without_hiding_the_cause() {
        let repository = RecordingRepository {
            calls: AtomicUsize::new(0),
            error: Some("tenant pool unavailable".to_string()),
        };

        let error = SchemaService
            .discover(
                &repository,
                input("connection-1", SchemaResource::Databases),
            )
            .await
            .unwrap_err();

        assert_eq!(
            error,
            SchemaServiceError::Repository("tenant pool unavailable".to_string())
        );
        assert_eq!(error.code(), "schema_repository_error");
    }

    #[test]
    fn resource_names_match_the_http_contract() {
        let value = serde_json::to_string(&SchemaResource::MaterializedViews).unwrap();
        assert_eq!(value, r#""materialized_views""#);
    }
}
