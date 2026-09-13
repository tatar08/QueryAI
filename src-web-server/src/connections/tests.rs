use std::sync::Mutex;

use serde_json::Value;

use super::*;

#[derive(Default)]
pub struct MemoryConnectionRepository {
    connections: Mutex<Vec<ConnectionSummary>>,
    credentials: Mutex<Vec<(String, Value)>>,
}

impl ConnectionRepository for MemoryConnectionRepository {
    fn create<'a>(
        &'a self,
        id: &'a str,
        workspace_id: &'a str,
        name: &'a str,
        driver: &'a str,
        public_params: serde_json::Value,
        environment: Option<&'a str>,
        credentials: Option<serde_json::Value>,
        created_by: &'a str,
    ) -> ConnectionFuture<'a, ConnectionSummary> {
        Box::pin(async move {
            let summary = ConnectionSummary {
                id: id.to_string(),
                workspace_id: workspace_id.to_string(),
                name: name.to_string(),
                driver: driver.to_string(),
                public_params,
                environment: environment.map(ToString::to_string),
                created_by: created_by.to_string(),
                created_at: "2026-09-06T00:00:00Z".to_string(),
                updated_at: "2026-09-06T00:00:00Z".to_string(),
            };
            self.connections.lock().unwrap().push(summary.clone());
            if let Some(creds) = credentials {
                self.credentials
                    .lock()
                    .unwrap()
                    .push((id.to_string(), creds));
            }
            Ok(summary)
        })
    }

    fn list_for_workspace<'a>(
        &'a self,
        workspace_id: &'a str,
    ) -> ConnectionFuture<'a, Vec<ConnectionSummary>> {
        Box::pin(async move {
            Ok(self
                .connections
                .lock()
                .unwrap()
                .iter()
                .filter(|c| c.workspace_id == workspace_id)
                .cloned()
                .collect())
        })
    }

    fn get_by_id<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
    ) -> ConnectionFuture<'a, Option<ConnectionSummary>> {
        Box::pin(async move {
            Ok(self
                .connections
                .lock()
                .unwrap()
                .iter()
                .find(|c| c.workspace_id == workspace_id && c.id == connection_id)
                .cloned())
        })
    }

    fn update<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
        name: Option<&'a str>,
        driver: Option<&'a str>,
        public_params: Option<serde_json::Value>,
        environment: Option<&'a str>,
        credentials: Option<serde_json::Value>,
        _updated_by: &'a str,
    ) -> ConnectionFuture<'a, ConnectionSummary> {
        Box::pin(async move {
            let mut list = self.connections.lock().unwrap();
            let conn = list
                .iter_mut()
                .find(|c| c.workspace_id == workspace_id && c.id == connection_id)
                .ok_or_else(|| "Connection not found".to_string())?;

            if let Some(name) = name {
                conn.name = name.to_string();
            }
            if let Some(driver) = driver {
                conn.driver = driver.to_string();
            }
            if let Some(params) = public_params {
                conn.public_params = params;
            }
            if let Some(env) = environment {
                conn.environment = Some(env.to_string());
            }
            conn.updated_at = "2026-09-06T01:00:00Z".to_string();

            if let Some(creds) = credentials {
                let mut cred_list = self.credentials.lock().unwrap();
                cred_list.retain(|(id, _)| id != connection_id);
                cred_list.push((connection_id.to_string(), creds));
            }

            Ok(conn.clone())
        })
    }

    fn delete<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
    ) -> ConnectionFuture<'a, ()> {
        Box::pin(async move {
            let mut list = self.connections.lock().unwrap();
            let initial_len = list.len();
            list.retain(|c| !(c.workspace_id == workspace_id && c.id == connection_id));
            if list.len() == initial_len {
                return Err("Connection not found".to_string());
            }
            self.credentials
                .lock()
                .unwrap()
                .retain(|(id, _)| id != connection_id);
            Ok(())
        })
    }

    fn get_credentials<'a>(
        &'a self,
        workspace_id: &'a str,
        connection_id: &'a str,
    ) -> ConnectionFuture<'a, Option<serde_json::Value>> {
        Box::pin(async move {
            let exists = self
                .connections
                .lock()
                .unwrap()
                .iter()
                .any(|c| c.workspace_id == workspace_id && c.id == connection_id);
            if !exists {
                return Ok(None);
            }
            let creds = self
                .credentials
                .lock()
                .unwrap()
                .iter()
                .find(|(id, _)| id == connection_id)
                .map(|(_, c)| c.clone());
            Ok(creds)
        })
    }
}

#[tokio::test]
async fn memory_connection_repository_crud() {
    let repo = MemoryConnectionRepository::default();

    let created = repo
        .create(
            "conn-1",
            "ws-1",
            "Production DB",
            "postgres",
            serde_json::json!({"host": "db.example.com", "port": 5432}),
            Some("production"),
            Some(serde_json::json!({"password": "secret-password"})),
            "user-1",
        )
        .await
        .unwrap();

    assert_eq!(created.name, "Production DB");
    assert_eq!(created.driver, "postgres");
    assert_eq!(created.workspace_id, "ws-1");

    let list = repo.list_for_workspace("ws-1").await.unwrap();
    assert_eq!(list.len(), 1);

    // Cross-tenant check
    let other_list = repo.list_for_workspace("ws-2").await.unwrap();
    assert!(other_list.is_empty());

    // Credentials fetch
    let creds = repo.get_credentials("ws-1", "conn-1").await.unwrap();
    assert_eq!(creds.unwrap()["password"], "secret-password");

    // Update
    let updated = repo
        .update(
            "ws-1",
            "conn-1",
            Some("Staging DB"),
            None,
            None,
            Some("staging"),
            None,
            "user-1",
        )
        .await
        .unwrap();
    assert_eq!(updated.name, "Staging DB");
    assert_eq!(updated.environment.as_deref(), Some("staging"));

    // Delete
    repo.delete("ws-1", "conn-1").await.unwrap();
    assert!(repo.get_by_id("ws-1", "conn-1").await.unwrap().is_none());
}
