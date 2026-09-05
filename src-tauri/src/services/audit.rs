use std::path::Path;

use tabularis_core::{AuditEvent, AuditEventInput, AuditRepository, AuditScope, AuditService};

use crate::ai_activity::{self, AiActivityEvent};

#[derive(Debug, Clone)]
pub struct McpAuditRecord {
    pub id: String,
    pub session_id: String,
    pub timestamp: String,
    pub tool: String,
    pub connection_id: Option<String>,
    pub connection_name: Option<String>,
    pub query: Option<String>,
    pub query_kind: Option<String>,
    pub duration_ms: u64,
    pub status: String,
    pub rows: Option<usize>,
    pub error: Option<String>,
    pub client_hint: Option<String>,
    pub approval_id: Option<String>,
}

#[derive(Debug, Clone)]
struct McpAuditMetadata {
    tool: String,
    connection_name: Option<String>,
    query: Option<String>,
    query_kind: Option<String>,
    duration_ms: u64,
    status: String,
    rows: Option<usize>,
    error: Option<String>,
    client_hint: Option<String>,
    approval_id: Option<String>,
}

struct DesktopAuditRepository<'a> {
    directory: Option<&'a Path>,
    max_entries: usize,
}

impl AuditRepository<McpAuditMetadata> for DesktopAuditRepository<'_> {
    fn record(&self, event: &AuditEvent<McpAuditMetadata>) -> Result<(), String> {
        let AuditScope::Desktop { session_id } = &event.scope else {
            return Err("Desktop audit repository requires a desktop scope".to_string());
        };
        let metadata = &event.metadata;
        let activity = AiActivityEvent {
            id: event.id.clone(),
            session_id: session_id.clone(),
            timestamp: event.occurred_at.clone(),
            tool: metadata.tool.clone(),
            connection_id: event.resource_id.clone(),
            connection_name: metadata.connection_name.clone(),
            query: metadata.query.clone(),
            query_kind: metadata.query_kind.clone(),
            duration_ms: metadata.duration_ms,
            status: metadata.status.clone(),
            rows: metadata.rows,
            error: metadata.error.clone(),
            client_hint: metadata.client_hint.clone(),
            approval_id: metadata.approval_id.clone(),
        };

        match self.directory {
            Some(directory) => {
                ai_activity::append_and_rotate_in(directory, &activity, self.max_entries)
            }
            None => ai_activity::append_and_rotate(&activity, self.max_entries),
        }
    }
}

pub fn record_mcp_audit(record: McpAuditRecord, max_entries: usize) -> Result<(), String> {
    record_mcp_audit_at(record, max_entries, None)
}

fn record_mcp_audit_at(
    record: McpAuditRecord,
    max_entries: usize,
    directory: Option<&Path>,
) -> Result<(), String> {
    let resource_type = if record.connection_id.is_some() {
        "connection"
    } else {
        "mcp_tool"
    };
    let input = AuditEventInput {
        id: record.id,
        scope: AuditScope::Desktop {
            session_id: record.session_id,
        },
        action: format!("mcp.{}", record.tool),
        resource_type: resource_type.to_string(),
        resource_id: record.connection_id,
        request_id: None,
        occurred_at: record.timestamp,
        metadata: McpAuditMetadata {
            tool: record.tool,
            connection_name: record.connection_name,
            query: record.query,
            query_kind: record.query_kind,
            duration_ms: record.duration_ms,
            status: record.status,
            rows: record.rows,
            error: record.error,
            client_hint: record.client_hint,
            approval_id: record.approval_id,
        },
    };

    AuditService
        .record(
            &DesktopAuditRepository {
                directory,
                max_entries,
            },
            input,
        )
        .map_err(|error| error.to_string())
}

#[cfg(test)]
pub(super) fn record_mcp_audit_in(
    directory: &Path,
    record: McpAuditRecord,
    max_entries: usize,
) -> Result<(), String> {
    record_mcp_audit_at(record, max_entries, Some(directory))
}
