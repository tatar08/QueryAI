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

#[tokio::test]
async fn test_memory_audit_repository_filtering_and_pagination() {
    use super::{MemoryAuditRepository, WorkspaceAuditRepository};
    use serde_json::json;

    let repo = MemoryAuditRepository::new();

    let event1 = AuditEvent {
        id: "ev-1".to_string(),
        scope: AuditScope::Workspace {
            workspace_id: "ws-1".to_string(),
            actor_user_id: "u-1".to_string(),
        },
        action: "connection.created".to_string(),
        resource_type: "connection".to_string(),
        resource_id: Some("c-1".to_string()),
        request_id: None,
        occurred_at: "2026-09-06T00:00:00Z".to_string(),
        metadata: json!({ "name": "DB 1" }),
    };

    let event2 = AuditEvent {
        id: "ev-2".to_string(),
        scope: AuditScope::Workspace {
            workspace_id: "ws-2".to_string(),
            actor_user_id: "u-2".to_string(),
        },
        action: "connection.deleted".to_string(),
        resource_type: "connection".to_string(),
        resource_id: Some("c-2".to_string()),
        request_id: None,
        occurred_at: "2026-09-06T00:01:00Z".to_string(),
        metadata: json!({}),
    };

    repo.record(&event1).unwrap();
    repo.record(&event2).unwrap();

    let list_ws1 = repo.list_for_workspace("ws-1", 10, 0).await.unwrap();
    assert_eq!(list_ws1.len(), 1);
    assert_eq!(list_ws1[0].id, "ev-1");
    assert_eq!(list_ws1[0].action, "connection.created");

    let list_ws2 = repo.list_for_workspace("ws-2", 10, 0).await.unwrap();
    assert_eq!(list_ws2.len(), 1);
    assert_eq!(list_ws2[0].id, "ev-2");

    let list_ws3 = repo.list_for_workspace("ws-3", 10, 0).await.unwrap();
    assert!(list_ws3.is_empty());
}
