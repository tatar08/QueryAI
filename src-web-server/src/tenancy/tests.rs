use std::sync::Arc;
use std::sync::Mutex;

use super::*;

#[test]
fn role_parsing_and_display() {
    assert_eq!("owner".parse::<Role>().unwrap(), Role::Owner);
    assert_eq!("admin".parse::<Role>().unwrap(), Role::Admin);
    assert_eq!("editor".parse::<Role>().unwrap(), Role::Editor);
    assert_eq!("viewer".parse::<Role>().unwrap(), Role::Viewer);
    assert!("superman".parse::<Role>().is_err());

    assert_eq!(Role::Owner.to_string(), "owner");
    assert_eq!(Role::Admin.to_string(), "admin");
    assert_eq!(Role::Editor.to_string(), "editor");
    assert_eq!(Role::Viewer.to_string(), "viewer");
}

#[test]
fn role_permissions_matrix() {
    // Owner can do everything
    assert!(Role::Owner.can_manage_workspace());
    assert!(Role::Owner.can_manage_members());
    assert!(Role::Owner.can_manage_connections());
    assert!(Role::Owner.can_execute_write_query());
    assert!(Role::Owner.can_execute_read_query());
    assert!(Role::Owner.can_view_audit_logs());

    // Admin can do member management, connections, write, read, audit
    assert!(!Role::Admin.can_manage_workspace());
    assert!(Role::Admin.can_manage_members());
    assert!(Role::Admin.can_manage_connections());
    assert!(Role::Admin.can_execute_write_query());
    assert!(Role::Admin.can_execute_read_query());
    assert!(Role::Admin.can_view_audit_logs());

    // Editor can manage connections, write, read
    assert!(!Role::Editor.can_manage_workspace());
    assert!(!Role::Editor.can_manage_members());
    assert!(Role::Editor.can_manage_connections());
    assert!(Role::Editor.can_execute_write_query());
    assert!(Role::Editor.can_execute_read_query());
    assert!(!Role::Editor.can_view_audit_logs());

    // Viewer can only read
    assert!(!Role::Viewer.can_manage_workspace());
    assert!(!Role::Viewer.can_manage_members());
    assert!(!Role::Viewer.can_manage_connections());
    assert!(!Role::Viewer.can_execute_write_query());
    assert!(Role::Viewer.can_execute_read_query());
    assert!(!Role::Viewer.can_view_audit_logs());
}

#[derive(Default)]
pub struct MemoryWorkspaceRepository {
    workspaces: Mutex<Vec<Workspace>>,
}

impl WorkspaceRepository for MemoryWorkspaceRepository {
    fn create<'a>(
        &'a self,
        id: &'a str,
        name: &'a str,
        owner_user_id: &'a str,
    ) -> TenancyFuture<'a, Workspace> {
        Box::pin(async move {
            let ws = Workspace {
                id: id.to_string(),
                name: name.to_string(),
                created_by: owner_user_id.to_string(),
                created_at: "2026-09-06T00:00:00Z".to_string(),
            };
            self.workspaces.lock().unwrap().push(ws.clone());
            Ok(ws)
        })
    }

    fn list_for_user<'a>(&'a self, _user_id: &'a str) -> TenancyFuture<'a, Vec<Workspace>> {
        Box::pin(async move { Ok(self.workspaces.lock().unwrap().clone()) })
    }

    fn get_by_id<'a>(&'a self, workspace_id: &'a str) -> TenancyFuture<'a, Option<Workspace>> {
        Box::pin(async move {
            Ok(self
                .workspaces
                .lock()
                .unwrap()
                .iter()
                .find(|w| w.id == workspace_id)
                .cloned())
        })
    }
}

#[derive(Default)]
pub struct MemoryMembershipRepository {
    members: Mutex<Vec<WorkspaceMember>>,
}

impl MembershipRepository for MemoryMembershipRepository {
    fn get_member_role<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> TenancyFuture<'a, Option<Role>> {
        Box::pin(async move {
            Ok(self
                .members
                .lock()
                .unwrap()
                .iter()
                .find(|m| m.workspace_id == workspace_id && m.user_id == user_id)
                .map(|m| m.role))
        })
    }

    fn list_members<'a>(
        &'a self,
        workspace_id: &'a str,
    ) -> TenancyFuture<'a, Vec<WorkspaceMember>> {
        Box::pin(async move {
            Ok(self
                .members
                .lock()
                .unwrap()
                .iter()
                .filter(|m| m.workspace_id == workspace_id)
                .cloned()
                .collect())
        })
    }

    fn add_member<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
        role: Role,
    ) -> TenancyFuture<'a, ()> {
        Box::pin(async move {
            let mut list = self.members.lock().unwrap();
            list.retain(|m| !(m.workspace_id == workspace_id && m.user_id == user_id));
            list.push(WorkspaceMember {
                workspace_id: workspace_id.to_string(),
                user_id: user_id.to_string(),
                role,
                email: Some(format!("{user_id}@example.com")),
                display_name: Some(user_id.to_string()),
                created_at: "2026-09-06T00:00:00Z".to_string(),
            });
            Ok(())
        })
    }

    fn remove_member<'a>(
        &'a self,
        workspace_id: &'a str,
        user_id: &'a str,
    ) -> TenancyFuture<'a, ()> {
        Box::pin(async move {
            self.members
                .lock()
                .unwrap()
                .retain(|m| !(m.workspace_id == workspace_id && m.user_id == user_id));
            Ok(())
        })
    }
}

#[tokio::test]
async fn memory_repositories_handle_crud() {
    let ws_repo = Arc::new(MemoryWorkspaceRepository::default());
    let mem_repo = Arc::new(MemoryMembershipRepository::default());

    let ws = ws_repo
        .create("ws-1", "Engineering", "user-1")
        .await
        .unwrap();
    assert_eq!(ws.name, "Engineering");

    let found = ws_repo.get_by_id("ws-1").await.unwrap();
    assert_eq!(found, Some(ws));

    mem_repo
        .add_member("ws-1", "user-1", Role::Owner)
        .await
        .unwrap();
    mem_repo
        .add_member("ws-1", "user-2", Role::Viewer)
        .await
        .unwrap();

    assert_eq!(
        mem_repo.get_member_role("ws-1", "user-1").await.unwrap(),
        Some(Role::Owner)
    );
    assert_eq!(
        mem_repo.get_member_role("ws-1", "user-2").await.unwrap(),
        Some(Role::Viewer)
    );
    assert_eq!(
        mem_repo.get_member_role("ws-1", "user-3").await.unwrap(),
        None
    );

    let members = mem_repo.list_members("ws-1").await.unwrap();
    assert_eq!(members.len(), 2);
}
