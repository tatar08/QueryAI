use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use super::{
    QueryCancellationRepository, QueryExecutionInput, QueryExecutionScope, QueryFuture,
    QueryRepository, QueryService, QueryServiceError,
};

struct RecordingQueryRepository {
    calls: AtomicUsize,
    scope: Mutex<Option<QueryExecutionScope>>,
    error: Option<String>,
}

impl QueryRepository<String> for RecordingQueryRepository {
    fn execute<'a>(&'a self, scope: &'a QueryExecutionScope) -> QueryFuture<'a, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        *self.scope.lock().unwrap() = Some(scope.clone());
        Box::pin(async move {
            self.error
                .clone()
                .map_or_else(|| Ok(scope.query.clone()), Err)
        })
    }
}

#[derive(Default)]
struct RecordingCancellationRepository {
    connection_id: Mutex<Option<String>>,
    error: Option<String>,
}

impl QueryCancellationRepository for RecordingCancellationRepository {
    fn cancel(&self, connection_id: &str) -> Result<(), String> {
        *self.connection_id.lock().unwrap() = Some(connection_id.to_string());
        self.error.clone().map_or(Ok(()), Err)
    }
}

fn input(connection_id: &str, query: &str) -> QueryExecutionInput {
    QueryExecutionInput {
        connection_id: connection_id.to_string(),
        query: query.to_string(),
        limit: Some(100),
        page: None,
        schema: Some("public".to_string()),
    }
}

#[test]
fn normalizes_whitespace_semicolons_and_smart_quotes() {
    assert_eq!(
        QueryService::normalize_query(
            "  SELECT \u{2018}value\u{2019}, \u{201C}column\u{201D};;;  "
        ),
        "SELECT 'value', \"column\""
    );
}

#[test]
fn preserves_an_empty_query_for_the_driver_to_handle() {
    assert_eq!(QueryService::normalize_query(" ;;; "), "");
}

#[tokio::test]
async fn forwards_a_normalized_scope_with_the_default_page() {
    let repository = RecordingQueryRepository {
        calls: AtomicUsize::new(0),
        scope: Mutex::new(None),
        error: None,
    };

    let result = QueryService
        .execute(&repository, input("connection-1", " SELECT 1; "))
        .await
        .unwrap();

    assert_eq!(result, "SELECT 1");
    assert_eq!(repository.calls.load(Ordering::SeqCst), 1);
    let scope = repository.scope.lock().unwrap().clone().unwrap();
    assert_eq!(scope.connection_id, "connection-1");
    assert_eq!(scope.page, 1);
    assert_eq!(scope.limit, Some(100));
    assert_eq!(scope.schema.as_deref(), Some("public"));
}

#[tokio::test]
async fn rejects_an_empty_connection_id_before_execution() {
    let repository = RecordingQueryRepository {
        calls: AtomicUsize::new(0),
        scope: Mutex::new(None),
        error: None,
    };

    let error = QueryService
        .execute(&repository, input(" ", "SELECT 1"))
        .await
        .unwrap_err();

    assert_eq!(error, QueryServiceError::InvalidConnectionId);
    assert_eq!(repository.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn maps_query_repository_failures() {
    let repository = RecordingQueryRepository {
        calls: AtomicUsize::new(0),
        scope: Mutex::new(None),
        error: Some("tenant pool unavailable".to_string()),
    };

    let error = QueryService
        .execute(&repository, input("connection-1", "SELECT 1"))
        .await
        .unwrap_err();

    assert_eq!(
        error,
        QueryServiceError::Repository("tenant pool unavailable".to_string())
    );
    assert_eq!(error.code(), "query_repository_error");
}

#[test]
fn delegates_cancellation_to_the_repository() {
    let repository = RecordingCancellationRepository::default();

    QueryService.cancel(&repository, "connection-1").unwrap();

    assert_eq!(
        repository.connection_id.lock().unwrap().as_deref(),
        Some("connection-1")
    );
}

#[test]
fn rejects_an_empty_connection_id_before_cancellation() {
    let repository = RecordingCancellationRepository::default();

    let error = QueryService.cancel(&repository, " ").unwrap_err();

    assert_eq!(error, QueryServiceError::InvalidConnectionId);
    assert!(repository.connection_id.lock().unwrap().is_none());
}

#[test]
fn maps_cancellation_repository_failures() {
    let repository = RecordingCancellationRepository {
        connection_id: Mutex::new(None),
        error: Some("No running query found".to_string()),
    };

    let error = QueryService
        .cancel(&repository, "connection-1")
        .unwrap_err();

    assert_eq!(
        error,
        QueryServiceError::Cancellation("No running query found".to_string())
    );
    assert_eq!(error.code(), "query_cancellation_error");
}
