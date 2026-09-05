use std::fmt;
use std::future::Future;
use std::pin::Pin;

use serde::Deserialize;

pub type QueryFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueryExecutionInput {
    pub connection_id: String,
    pub query: String,
    pub limit: Option<u32>,
    pub page: Option<u32>,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryExecutionScope {
    pub connection_id: String,
    pub query: String,
    pub limit: Option<u32>,
    pub page: u32,
    pub schema: Option<String>,
}

pub trait QueryRepository<T>: Send + Sync {
    fn execute<'a>(&'a self, scope: &'a QueryExecutionScope) -> QueryFuture<'a, T>;
}

pub trait QueryCancellationRepository: Send + Sync {
    fn cancel(&self, connection_id: &str) -> Result<(), String>;
}

#[derive(Clone, Default)]
pub struct QueryService;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryServiceError {
    InvalidConnectionId,
    Repository(String),
    Cancellation(String),
}

impl QueryServiceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidConnectionId => "invalid_connection_id",
            Self::Repository(_) => "query_repository_error",
            Self::Cancellation(_) => "query_cancellation_error",
        }
    }
}

impl fmt::Display for QueryServiceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidConnectionId => write!(formatter, "Connection ID cannot be empty"),
            Self::Repository(error) | Self::Cancellation(error) => formatter.write_str(error),
        }
    }
}

impl std::error::Error for QueryServiceError {}

impl QueryService {
    pub fn normalize_query(query: &str) -> String {
        query
            .trim()
            .trim_end_matches(';')
            .replace('\u{2018}', "'")
            .replace('\u{2019}', "'")
            .replace('\u{201C}', "\"")
            .replace('\u{201D}', "\"")
    }

    pub fn prepare(
        &self,
        input: QueryExecutionInput,
    ) -> Result<QueryExecutionScope, QueryServiceError> {
        if input.connection_id.trim().is_empty() {
            return Err(QueryServiceError::InvalidConnectionId);
        }

        Ok(QueryExecutionScope {
            connection_id: input.connection_id,
            query: Self::normalize_query(&input.query),
            limit: input.limit,
            page: input.page.unwrap_or(1),
            schema: input.schema,
        })
    }

    pub async fn execute<T: Send>(
        &self,
        repository: &dyn QueryRepository<T>,
        input: QueryExecutionInput,
    ) -> Result<T, QueryServiceError> {
        let scope = self.prepare(input)?;
        self.execute_prepared(repository, &scope).await
    }

    pub async fn execute_prepared<T: Send>(
        &self,
        repository: &dyn QueryRepository<T>,
        scope: &QueryExecutionScope,
    ) -> Result<T, QueryServiceError> {
        repository
            .execute(scope)
            .await
            .map_err(QueryServiceError::Repository)
    }

    pub fn cancel(
        &self,
        repository: &dyn QueryCancellationRepository,
        connection_id: &str,
    ) -> Result<(), QueryServiceError> {
        if connection_id.trim().is_empty() {
            return Err(QueryServiceError::InvalidConnectionId);
        }

        repository
            .cancel(connection_id)
            .map_err(QueryServiceError::Cancellation)
    }
}

#[cfg(test)]
#[path = "query_tests.rs"]
mod tests;
