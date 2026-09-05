use std::sync::Mutex;

use tabularis_core::{AuditEvent, AuditRepository, AuditScope, AuditServiceError};

use super::{record_workspace_audit, WorkspaceAuditContext, WorkspaceAuditInput};

#[derive(Default)]
struct RecordingAuditRepository {
    event: Mutex<Option<AuditEvent<String>>>,
}

impl AuditRepository<String> for RecordingAuditRepository {
    fn record(&self, event: &AuditEvent<String>) -> Result<(), String> {
        *self.event.lock().unwrap() = Some(event.clone());
        Ok(())
    }
}

fn context() -> WorkspaceAuditContext {
    WorkspaceAuditContext {
        workspace_id: "workspace-1".to_string(),
        actor_user_id: "user-1".to_string(),
        request_id: Some("request-1".to_string()),
    }
}

fn input() -> WorkspaceAuditInput<String> {
    WorkspaceAuditInput {
        id: "audit-1".to_string(),
        action: "connection.create".to_string(),
        resource_type: "connection".to_string(),
        resource_id: Some("connection-1".to_string()),
        occurred_at: "2026-09-04T00:00:00Z".to_string(),
        metadata: "created".to_string(),
    }
}

#[test]
fn records_the_trusted_workspace_and_actor_context() {
    let repository = RecordingAuditRepository::default();

    record_workspace_audit(&repository, context(), input()).unwrap();

    let event = repository.event.lock().unwrap().clone().unwrap();
    assert_eq!(
        event.scope,
        AuditScope::Workspace {
            workspace_id: "workspace-1".to_string(),
            actor_user_id: "user-1".to_string(),
        }
    );
    assert_eq!(event.request_id.as_deref(), Some("request-1"));
}

#[test]
fn rejects_missing_workspace_context_before_persistence() {
    let repository = RecordingAuditRepository::default();
    let mut invalid_context = context();
    invalid_context.workspace_id = String::new();

    let error = record_workspace_audit(&repository, invalid_context, input()).unwrap_err();

    assert_eq!(error, AuditServiceError::InvalidScope("workspace ID"));
    assert!(repository.event.lock().unwrap().is_none());
}

#[test]
fn rejects_missing_actor_context_before_persistence() {
    let repository = RecordingAuditRepository::default();
    let mut invalid_context = context();
    invalid_context.actor_user_id = " ".to_string();

    let error = record_workspace_audit(&repository, invalid_context, input()).unwrap_err();

    assert_eq!(error, AuditServiceError::InvalidScope("actor user ID"));
    assert!(repository.event.lock().unwrap().is_none());
}
