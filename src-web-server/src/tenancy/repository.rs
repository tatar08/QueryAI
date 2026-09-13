use sqlx::PgPool;
use std::future::Future;
use std::pin::Pin;

use super::models::{Role, Workspace, WorkspaceMember};

pub type TenancyFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait WorkspaceRepository: Send + Sync {
    fn create<'a>(
        &'a self,
        id: &'a str,
        name: &'a str,
        owner_user_id: &'a str,
    ) -> TenancyFuture<'a, Workspace>;

    fn list_for_user<'a>(&'a self, user_id: &'a str) -> TenancyFuture<'a, Vec<Workspace>>;

    fn get_by_id<'a>(&'a self, workspace_id: &'a str) -> TenancyFuture<'a, Option<Workspace>>;
}

pub trait MembershipRepository: Send + Sync {
    fn get_member_role<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> TenancyFuture<'a, Option<Role>>;

    fn list_members<'a>(&'a self, workspace_id: &'a str)
        -> TenancyFuture<'a, Vec<WorkspaceMember>>;

    fn add_member<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
        role: Role,
    ) -> TenancyFuture<'a, ()>;

    fn remove_member<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> TenancyFuture<'a, ()>;
}

#[derive(Clone)]
pub struct PostgresWorkspaceRepository {
    pool: PgPool,
}

impl PostgresWorkspaceRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl WorkspaceRepository for PostgresWorkspaceRepository {
    fn create<'a>(
        &'a self,
        id: &'a str,
        name: &'a str,
        owner_user_id: &'a str,
    ) -> TenancyFuture<'a, Workspace> {
        Box::pin(async move {
            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|error| format!("Failed to begin transaction: {error}"))?;

            #[derive(sqlx::FromRow)]
            struct WorkspaceRow {
                id: String,
                name: String,
                created_by: String,
                created_at: String,
            }

            let row = sqlx::query_as::<_, WorkspaceRow>(
                "INSERT INTO workspaces (id, name, created_by) \
                 VALUES ($1, $2, $3) \
                 RETURNING id, name, created_by, created_at::TEXT",
            )
            .bind(id)
            .bind(name)
            .bind(owner_user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| format!("Failed to create workspace: {error}"))?;

            sqlx::query(
                "INSERT INTO workspace_members (workspace_id, user_id, role) \
                 VALUES ($1, $2, 'owner')",
            )
            .bind(id)
            .bind(owner_user_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("Failed to add owner membership: {error}"))?;

            tx.commit()
                .await
                .map_err(|error| format!("Failed to commit workspace transaction: {error}"))?;

            Ok(Workspace {
                id: row.id,
                name: row.name,
                created_by: row.created_by,
                created_at: row.created_at,
            })
        })
    }

    fn list_for_user<'a>(&'a self, user_id: &'a str) -> TenancyFuture<'a, Vec<Workspace>> {
        Box::pin(async move {
            #[derive(sqlx::FromRow)]
            struct WorkspaceRow {
                id: String,
                name: String,
                created_by: String,
                created_at: String,
            }

            let rows = sqlx::query_as::<_, WorkspaceRow>(
                "SELECT w.id, w.name, w.created_by, w.created_at::TEXT \
                 FROM workspaces w \
                 INNER JOIN workspace_members wm ON w.id = wm.workspace_id \
                 WHERE wm.user_id = $1 \
                 ORDER BY w.created_at ASC",
            )
            .bind(user_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|error| format!("Failed to list workspaces for user: {error}"))?;

            Ok(rows
                .into_iter()
                .map(|r| Workspace {
                    id: r.id,
                    name: r.name,
                    created_by: r.created_by,
                    created_at: r.created_at,
                })
                .collect())
        })
    }

    fn get_by_id<'a>(&'a self, workspace_id: &'a str) -> TenancyFuture<'a, Option<Workspace>> {
        Box::pin(async move {
            #[derive(sqlx::FromRow)]
            struct WorkspaceRow {
                id: String,
                name: String,
                created_by: String,
                created_at: String,
            }

            let row = sqlx::query_as::<_, WorkspaceRow>(
                "SELECT id, name, created_by, created_at::TEXT \
                 FROM workspaces \
                 WHERE id = $1",
            )
            .bind(workspace_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| format!("Failed to get workspace by id: {error}"))?;

            Ok(row.map(|r| Workspace {
                id: r.id,
                name: r.name,
                created_by: r.created_by,
                created_at: r.created_at,
            }))
        })
    }
}

#[derive(Clone)]
pub struct PostgresMembershipRepository {
    pool: PgPool,
}

impl PostgresMembershipRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl MembershipRepository for PostgresMembershipRepository {
    fn get_member_role<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> TenancyFuture<'a, Option<Role>> {
        Box::pin(async move {
            let role_str = sqlx::query_scalar::<_, String>(
                "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
            )
            .bind(workspace_id)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| format!("Failed to query member role: {error}"))?;

            match role_str {
                Some(s) => s
                    .parse::<Role>()
                    .map(Some)
                    .map_err(|e| format!("Invalid role in database: {e}")),
                None => Ok(None),
            }
        })
    }

    fn list_members<'a>(
        &'a self,
        workspace_id: &'a str,
    ) -> TenancyFuture<'a, Vec<WorkspaceMember>> {
        Box::pin(async move {
            #[derive(sqlx::FromRow)]
            struct MemberRow {
                workspace_id: String,
                user_id: String,
                role: String,
                email: Option<String>,
                display_name: Option<String>,
                created_at: String,
            }

            let rows = sqlx::query_as::<_, MemberRow>(
                "SELECT wm.workspace_id, wm.user_id, wm.role, u.email, u.display_name, wm.created_at::TEXT \
                 FROM workspace_members wm \
                 LEFT JOIN users u ON wm.user_id = u.id \
                 WHERE wm.workspace_id = $1 \
                 ORDER BY wm.created_at ASC",
            )
            .bind(workspace_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|error| format!("Failed to list workspace members: {error}"))?;

            let mut members = Vec::with_capacity(rows.len());
            for r in rows {
                let role = r
                    .role
                    .parse::<Role>()
                    .map_err(|e| format!("Invalid member role in database: {e}"))?;
                members.push(WorkspaceMember {
                    workspace_id: r.workspace_id,
                    user_id: r.user_id,
                    role,
                    email: r.email,
                    display_name: r.display_name,
                    created_at: r.created_at,
                });
            }

            Ok(members)
        })
    }

    fn add_member<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
        role: Role,
    ) -> TenancyFuture<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "INSERT INTO workspace_members (workspace_id, user_id, role) \
                 VALUES ($1, $2, $3) \
                 ON CONFLICT (workspace_id, user_id) \
                 DO UPDATE SET role = EXCLUDED.role",
            )
            .bind(workspace_id)
            .bind(user_id)
            .bind(role.as_str())
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|error| format!("Failed to add member to workspace: {error}"))
        })
    }

    fn remove_member<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> TenancyFuture<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "DELETE FROM workspace_members \
                 WHERE workspace_id = $1 AND user_id = $2",
            )
            .bind(workspace_id)
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|error| format!("Failed to remove member from workspace: {error}"))
        })
    }
}
