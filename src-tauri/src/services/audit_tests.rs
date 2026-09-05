use tempfile::tempdir;

use crate::ai_activity::{read_events_in, EventFilter};

use super::audit::record_mcp_audit_in;
use super::McpAuditRecord;

fn record() -> McpAuditRecord {
    McpAuditRecord {
        id: "audit-1".to_string(),
        session_id: "session-1".to_string(),
        timestamp: "2026-09-04T00:00:00Z".to_string(),
        tool: "run_query".to_string(),
        connection_id: Some("connection-1".to_string()),
        connection_name: Some("Production".to_string()),
        query: Some("SELECT 1".to_string()),
        query_kind: Some("select".to_string()),
        duration_ms: 25,
        status: "success".to_string(),
        rows: Some(1),
        error: None,
        client_hint: Some("test-client".to_string()),
        approval_id: None,
    }
}

#[test]
fn preserves_the_existing_ai_activity_jsonl_contract() {
    let directory = tempdir().unwrap();

    record_mcp_audit_in(directory.path(), record(), 100).unwrap();

    let events = read_events_in(directory.path(), &EventFilter::default()).unwrap();
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event.id, "audit-1");
    assert_eq!(event.session_id, "session-1");
    assert_eq!(event.tool, "run_query");
    assert_eq!(event.connection_id.as_deref(), Some("connection-1"));
    assert_eq!(event.query.as_deref(), Some("SELECT 1"));
    assert_eq!(event.status, "success");
}

#[test]
fn rejects_an_empty_desktop_session_before_writing() {
    let directory = tempdir().unwrap();
    let mut input = record();
    input.session_id = " ".to_string();

    let error = record_mcp_audit_in(directory.path(), input, 100).unwrap_err();

    assert_eq!(error, "Audit scope session ID cannot be empty");
    assert!(read_events_in(directory.path(), &EventFilter::default())
        .unwrap()
        .is_empty());
}
