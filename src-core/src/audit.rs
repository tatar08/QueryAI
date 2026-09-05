use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuditScope {
    Desktop {
        session_id: String,
    },
    Workspace {
        workspace_id: String,
        actor_user_id: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuditEventInput<M> {
    pub id: String,
    pub scope: AuditScope,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub request_id: Option<String>,
    pub occurred_at: String,
    pub metadata: M,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuditEvent<M> {
    pub id: String,
    pub scope: AuditScope,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub request_id: Option<String>,
    pub occurred_at: String,
    pub metadata: M,
}

pub trait AuditRepository<M>: Send + Sync {
    fn record(&self, event: &AuditEvent<M>) -> Result<(), String>;
}

#[derive(Clone, Default)]
pub struct AuditService;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuditServiceError {
    InvalidId,
    InvalidScope(&'static str),
    InvalidAction,
    InvalidResourceType,
    InvalidOccurredAt,
    Repository(String),
}

impl AuditServiceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidId => "invalid_audit_id",
            Self::InvalidScope(_) => "invalid_audit_scope",
            Self::InvalidAction => "invalid_audit_action",
            Self::InvalidResourceType => "invalid_audit_resource_type",
            Self::InvalidOccurredAt => "invalid_audit_occurred_at",
            Self::Repository(_) => "audit_repository_error",
        }
    }
}

impl fmt::Display for AuditServiceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidId => write!(formatter, "Audit event ID cannot be empty"),
            Self::InvalidScope(field) => write!(formatter, "Audit scope {field} cannot be empty"),
            Self::InvalidAction => write!(formatter, "Audit action cannot be empty"),
            Self::InvalidResourceType => write!(formatter, "Audit resource type cannot be empty"),
            Self::InvalidOccurredAt => write!(formatter, "Audit occurrence time cannot be empty"),
            Self::Repository(error) => formatter.write_str(error),
        }
    }
}

impl std::error::Error for AuditServiceError {}

impl AuditService {
    pub fn record<M>(
        &self,
        repository: &dyn AuditRepository<M>,
        input: AuditEventInput<M>,
    ) -> Result<(), AuditServiceError> {
        let event = self.prepare(input)?;
        repository
            .record(&event)
            .map_err(AuditServiceError::Repository)
    }

    pub fn prepare<M>(
        &self,
        input: AuditEventInput<M>,
    ) -> Result<AuditEvent<M>, AuditServiceError> {
        if input.id.trim().is_empty() {
            return Err(AuditServiceError::InvalidId);
        }
        match &input.scope {
            AuditScope::Desktop { session_id } if session_id.trim().is_empty() => {
                return Err(AuditServiceError::InvalidScope("session ID"));
            }
            AuditScope::Workspace {
                workspace_id,
                actor_user_id,
            } if workspace_id.trim().is_empty() || actor_user_id.trim().is_empty() => {
                let field = if workspace_id.trim().is_empty() {
                    "workspace ID"
                } else {
                    "actor user ID"
                };
                return Err(AuditServiceError::InvalidScope(field));
            }
            _ => {}
        }
        if input.action.trim().is_empty() {
            return Err(AuditServiceError::InvalidAction);
        }
        if input.resource_type.trim().is_empty() {
            return Err(AuditServiceError::InvalidResourceType);
        }
        if input.occurred_at.trim().is_empty() {
            return Err(AuditServiceError::InvalidOccurredAt);
        }

        Ok(AuditEvent {
            id: input.id,
            scope: input.scope,
            action: input.action,
            resource_type: input.resource_type,
            resource_id: input.resource_id,
            request_id: input.request_id,
            occurred_at: input.occurred_at,
            metadata: input.metadata,
        })
    }
}

#[cfg(test)]
#[path = "audit_tests.rs"]
mod tests;
