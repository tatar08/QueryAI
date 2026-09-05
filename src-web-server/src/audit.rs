use tabularis_core::{
    AuditEventInput, AuditRepository, AuditScope, AuditService, AuditServiceError,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceAuditContext {
    pub workspace_id: String,
    pub actor_user_id: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceAuditInput<M> {
    pub id: String,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub occurred_at: String,
    pub metadata: M,
}

pub fn record_workspace_audit<M>(
    repository: &dyn AuditRepository<M>,
    context: WorkspaceAuditContext,
    input: WorkspaceAuditInput<M>,
) -> Result<(), AuditServiceError> {
    AuditService.record(
        repository,
        AuditEventInput {
            id: input.id,
            scope: AuditScope::Workspace {
                workspace_id: context.workspace_id,
                actor_user_id: context.actor_user_id,
            },
            action: input.action,
            resource_type: input.resource_type,
            resource_id: input.resource_id,
            request_id: context.request_id,
            occurred_at: input.occurred_at,
            metadata: input.metadata,
        },
    )
}

#[cfg(test)]
#[path = "audit_tests.rs"]
mod tests;
