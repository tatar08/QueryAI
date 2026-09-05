use std::sync::Mutex;

use super::{
    AuditEvent, AuditEventInput, AuditRepository, AuditScope, AuditService, AuditServiceError,
};

#[derive(Default)]
struct RecordingRepository {
    event: Mutex<Option<AuditEvent<String>>>,
    error: Option<String>,
}

impl AuditRepository<String> for RecordingRepository {
    fn record(&self, event: &AuditEvent<String>) -> Result<(), String> {
        *self.event.lock().unwrap() = Some(event.clone());
        self.error.clone().map_or(Ok(()), Err)
    }
}

fn workspace_input() -> AuditEventInput<String> {
    AuditEventInput {
        id: "audit-1".to_string(),
        scope: AuditScope::Workspace {
            workspace_id: "workspace-1".to_string(),
            actor_user_id: "user-1".to_string(),
        },
        action: "query.execute".to_string(),
        resource_type: "connection".to_string(),
        resource_id: Some("connection-1".to_string()),
        request_id: Some("request-1".to_string()),
        occurred_at: "2026-09-04T00:00:00Z".to_string(),
        metadata: "succeeded".to_string(),
    }
}

#[test]
fn records_a_workspace_scoped_event() {
    let repository = RecordingRepository::default();

    AuditService.record(&repository, workspace_input()).unwrap();

    let event = repository.event.lock().unwrap().clone().unwrap();
    assert_eq!(event.action, "query.execute");
    assert_eq!(event.resource_id.as_deref(), Some("connection-1"));
    assert_eq!(event.request_id.as_deref(), Some("request-1"));
}

#[test]
fn records_a_desktop_session_without_fabricating_a_tenant() {
    let repository = RecordingRepository::default();
    let mut input = workspace_input();
    input.scope = AuditScope::Desktop {
        session_id: "session-1".to_string(),
    };

    AuditService.record(&repository, input).unwrap();

    let event = repository.event.lock().unwrap().clone().unwrap();
    assert_eq!(
        event.scope,
        AuditScope::Desktop {
            session_id: "session-1".to_string()
        }
    );
}

#[test]
fn rejects_a_workspace_event_without_a_workspace_id() {
    let repository = RecordingRepository::default();
    let mut input = workspace_input();
    input.scope = AuditScope::Workspace {
        workspace_id: " ".to_string(),
        actor_user_id: "user-1".to_string(),
    };

    let error = AuditService.record(&repository, input).unwrap_err();

    assert_eq!(error, AuditServiceError::InvalidScope("workspace ID"));
    assert!(repository.event.lock().unwrap().is_none());
}

#[test]
fn rejects_a_workspace_event_without_an_actor() {
    let repository = RecordingRepository::default();
    let mut input = workspace_input();
    input.scope = AuditScope::Workspace {
        workspace_id: "workspace-1".to_string(),
        actor_user_id: String::new(),
    };

    let error = AuditService.record(&repository, input).unwrap_err();

    assert_eq!(error, AuditServiceError::InvalidScope("actor user ID"));
}

#[test]
fn rejects_empty_domain_fields_before_persistence() {
    let repository = RecordingRepository::default();
    let mut input = workspace_input();
    input.action = " ".to_string();

    let error = AuditService.record(&repository, input).unwrap_err();

    assert_eq!(error, AuditServiceError::InvalidAction);
    assert_eq!(error.code(), "invalid_audit_action");
    assert!(repository.event.lock().unwrap().is_none());
}

#[test]
fn maps_repository_failures_without_hiding_the_cause() {
    let repository = RecordingRepository {
        event: Mutex::new(None),
        error: Some("audit queue unavailable".to_string()),
    };

    let error = AuditService
        .record(&repository, workspace_input())
        .unwrap_err();

    assert_eq!(
        error,
        AuditServiceError::Repository("audit queue unavailable".to_string())
    );
    assert_eq!(error.code(), "audit_repository_error");
}
