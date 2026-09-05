use std::cell::RefCell;
use std::collections::HashMap;

use crate::models::{ConnectionParams, ConnectionsFile, SavedConnection};

use super::{
    persist_deleted_connection, persist_new_connection, persist_updated_connection,
    ConnectionCredentialStore, ConnectionRepository, SaveConnectionInput, UpdateConnectionInput,
};

#[derive(Default)]
struct MemoryRepository {
    exists: bool,
    file: RefCell<ConnectionsFile>,
    saves: RefCell<usize>,
    save_error: RefCell<Option<String>>,
}

impl MemoryRepository {
    fn with_connections(connections: Vec<SavedConnection>) -> Self {
        Self {
            exists: true,
            file: RefCell::new(ConnectionsFile {
                connections,
                ..Default::default()
            }),
            ..Default::default()
        }
    }
}

impl ConnectionRepository for MemoryRepository {
    fn exists(&self) -> bool {
        self.exists
    }

    fn load(&self) -> Result<ConnectionsFile, String> {
        Ok(self.file.borrow().clone())
    }

    fn save(&self, file: &ConnectionsFile) -> Result<(), String> {
        if let Some(error) = self.save_error.borrow().clone() {
            return Err(error);
        }
        *self.file.borrow_mut() = file.clone();
        *self.saves.borrow_mut() += 1;
        Ok(())
    }
}

#[derive(Default)]
struct MemoryCredentials {
    connection_uris: RefCell<HashMap<String, String>>,
    db_passwords: RefCell<HashMap<String, String>>,
    ssh_passwords: RefCell<HashMap<String, String>>,
    ssh_passphrases: RefCell<HashMap<String, String>>,
    invalidated: RefCell<Vec<String>>,
}

impl ConnectionCredentialStore for MemoryCredentials {
    fn get_connection_uri(&self, connection_id: &str) -> Result<String, String> {
        self.connection_uris
            .borrow()
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "missing URI".to_string())
    }

    fn set_connection_uri(&self, connection_id: &str, value: &str) -> Result<(), String> {
        self.connection_uris
            .borrow_mut()
            .insert(connection_id.to_string(), value.to_string());
        Ok(())
    }

    fn delete_connection_uri(&self, connection_id: &str) -> Result<(), String> {
        self.connection_uris.borrow_mut().remove(connection_id);
        Ok(())
    }

    fn set_db_password(&self, connection_id: &str, value: &str) -> Result<(), String> {
        self.db_passwords
            .borrow_mut()
            .insert(connection_id.to_string(), value.to_string());
        Ok(())
    }

    fn delete_db_password(&self, connection_id: &str) -> Result<(), String> {
        self.db_passwords.borrow_mut().remove(connection_id);
        Ok(())
    }

    fn set_ssh_password(&self, connection_id: &str, value: &str) -> Result<(), String> {
        self.ssh_passwords
            .borrow_mut()
            .insert(connection_id.to_string(), value.to_string());
        Ok(())
    }

    fn delete_ssh_password(&self, connection_id: &str) -> Result<(), String> {
        self.ssh_passwords.borrow_mut().remove(connection_id);
        Ok(())
    }

    fn set_ssh_key_passphrase(&self, connection_id: &str, value: &str) -> Result<(), String> {
        self.ssh_passphrases
            .borrow_mut()
            .insert(connection_id.to_string(), value.to_string());
        Ok(())
    }

    fn delete_ssh_key_passphrase(&self, connection_id: &str) -> Result<(), String> {
        self.ssh_passphrases.borrow_mut().remove(connection_id);
        Ok(())
    }

    fn invalidate_connection(&self, connection_id: &str) {
        self.invalidated
            .borrow_mut()
            .push(connection_id.to_string());
    }
}

fn saved_connection(id: &str, driver: &str, uri_in_keychain: bool) -> SavedConnection {
    SavedConnection {
        id: id.to_string(),
        name: "Existing".to_string(),
        params: ConnectionParams {
            driver: driver.to_string(),
            connection_uri_in_keychain: uri_in_keychain.then_some(true),
            save_in_keychain: Some(uri_in_keychain),
            ..Default::default()
        },
        group_id: Some("group-1".to_string()),
        sort_order: Some(3),
        detect_json_in_text_columns: Some(false),
        appearance: None,
        tag_ids: Some(vec!["tag-1".to_string()]),
        environment: Some("development".to_string()),
    }
}

#[test]
fn save_uses_repository_and_credential_interfaces() {
    let repository = MemoryRepository::default();
    let credentials = MemoryCredentials::default();
    let params = ConnectionParams {
        driver: "postgres".to_string(),
        connection_uri: Some("postgres://user:secret@localhost/db".to_string()),
        password: Some("db-secret".to_string()),
        ssh_enabled: Some(true),
        ssh_password: Some("ssh-secret".to_string()),
        ssh_key_passphrase: Some("key-secret".to_string()),
        save_in_keychain: Some(true),
        ..Default::default()
    };

    let returned = persist_new_connection(
        &repository,
        &credentials,
        SaveConnectionInput {
            id: "connection-1".to_string(),
            name: "Production".to_string(),
            params,
            detect_json_in_text_columns: Some(true),
            environment: Some("production".to_string()),
        },
    )
    .expect("save should succeed");

    let file = repository.file.borrow();
    let persisted = &file.connections[0];
    assert_eq!(persisted.params.connection_uri, None);
    assert_eq!(persisted.params.connection_uri_in_keychain, Some(true));
    assert_eq!(persisted.params.password, None);
    assert_eq!(persisted.params.ssh_password, None);
    assert_eq!(persisted.params.ssh_key_passphrase, None);
    assert!(returned.params.connection_uri.is_some());
    assert_eq!(
        credentials
            .db_passwords
            .borrow()
            .get("connection-1")
            .map(String::as_str),
        Some("db-secret")
    );
    assert_eq!(*repository.saves.borrow(), 1);
}

#[test]
fn save_rejects_plaintext_connection_uri() {
    let repository = MemoryRepository::default();
    let credentials = MemoryCredentials::default();
    let error = persist_new_connection(
        &repository,
        &credentials,
        SaveConnectionInput {
            id: "connection-1".to_string(),
            name: "Unsafe".to_string(),
            params: ConnectionParams {
                connection_uri: Some("postgres://user:secret@localhost/db".to_string()),
                save_in_keychain: Some(false),
                ..Default::default()
            },
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .unwrap_err();

    assert_eq!(error, "Connection URIs must be stored in the OS keychain");
    assert_eq!(*repository.saves.borrow(), 0);
}

#[test]
fn save_rejects_an_unknown_environment() {
    let repository = MemoryRepository::default();
    let credentials = MemoryCredentials::default();
    let error = persist_new_connection(
        &repository,
        &credentials,
        SaveConnectionInput {
            id: "connection-1".to_string(),
            name: "Invalid".to_string(),
            params: ConnectionParams::default(),
            detect_json_in_text_columns: None,
            environment: Some("sandbox".to_string()),
        },
    )
    .unwrap_err();

    assert_eq!(error, "Invalid environment: sandbox");
    assert_eq!(*repository.saves.borrow(), 0);
}

#[test]
fn delete_skips_side_effects_when_the_repository_does_not_exist() {
    let repository = MemoryRepository::default();
    let credentials = MemoryCredentials::default();

    let result = persist_deleted_connection(&repository, &credentials, "missing").unwrap();

    assert!(!result.deleted);
    assert!(!result.repository_existed);
    assert_eq!(*repository.saves.borrow(), 0);
    assert!(credentials.invalidated.borrow().is_empty());
}

#[test]
fn update_preserves_an_untouched_uri_and_collection_metadata() {
    let existing = saved_connection("connection-1", "postgres", true);
    let repository = MemoryRepository::with_connections(vec![existing]);
    let credentials = MemoryCredentials::default();
    credentials
        .connection_uris
        .borrow_mut()
        .insert("connection-1".to_string(), "postgres://stored".to_string());

    let result = persist_updated_connection(
        &repository,
        &credentials,
        UpdateConnectionInput {
            id: "connection-1".to_string(),
            name: "Updated".to_string(),
            params: ConnectionParams {
                driver: "postgres".to_string(),
                save_in_keychain: Some(true),
                ..Default::default()
            },
            detect_json_in_text_columns: Some(true),
            environment: Some("staging".to_string()),
        },
    )
    .expect("update should succeed");

    let file = repository.file.borrow();
    let persisted = &file.connections[0];
    assert_eq!(persisted.params.connection_uri_in_keychain, Some(true));
    assert_eq!(persisted.group_id.as_deref(), Some("group-1"));
    assert_eq!(
        persisted.tag_ids.as_deref(),
        Some(&["tag-1".to_string()][..])
    );
    assert_eq!(result.connection.name, "Updated");
    assert_eq!(
        credentials
            .connection_uris
            .borrow()
            .get("connection-1")
            .map(String::as_str),
        Some("postgres://stored")
    );
}

#[test]
fn update_clears_a_uri_when_the_driver_changes() {
    let existing = saved_connection("connection-1", "postgres", true);
    let repository = MemoryRepository::with_connections(vec![existing]);
    let credentials = MemoryCredentials::default();
    credentials
        .connection_uris
        .borrow_mut()
        .insert("connection-1".to_string(), "postgres://stored".to_string());

    persist_updated_connection(
        &repository,
        &credentials,
        UpdateConnectionInput {
            id: "connection-1".to_string(),
            name: "Changed driver".to_string(),
            params: ConnectionParams {
                driver: "mysql".to_string(),
                save_in_keychain: Some(true),
                ..Default::default()
            },
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .expect("update should succeed");

    assert_eq!(
        repository.file.borrow().connections[0]
            .params
            .connection_uri_in_keychain,
        None
    );
    assert!(!credentials
        .connection_uris
        .borrow()
        .contains_key("connection-1"));
}

#[test]
fn failed_persistence_rolls_back_the_connection_uri() {
    let existing = saved_connection("connection-1", "postgres", true);
    let repository = MemoryRepository::with_connections(vec![existing]);
    *repository.save_error.borrow_mut() = Some("disk full".to_string());
    let credentials = MemoryCredentials::default();
    credentials
        .connection_uris
        .borrow_mut()
        .insert("connection-1".to_string(), "postgres://old".to_string());

    let error = persist_updated_connection(
        &repository,
        &credentials,
        UpdateConnectionInput {
            id: "connection-1".to_string(),
            name: "Updated".to_string(),
            params: ConnectionParams {
                driver: "postgres".to_string(),
                connection_uri: Some("postgres://new".to_string()),
                save_in_keychain: Some(true),
                ..Default::default()
            },
            detect_json_in_text_columns: None,
            environment: None,
        },
    )
    .unwrap_err();

    assert_eq!(error, "disk full");
    assert_eq!(
        credentials
            .connection_uris
            .borrow()
            .get("connection-1")
            .map(String::as_str),
        Some("postgres://old")
    );
}

#[test]
fn delete_cleans_credentials_and_returns_adapter_cleanup_data() {
    let repository = MemoryRepository::with_connections(vec![saved_connection(
        "connection-1",
        "postgres",
        true,
    )]);
    let credentials = MemoryCredentials::default();
    credentials
        .db_passwords
        .borrow_mut()
        .insert("connection-1".to_string(), "secret".to_string());
    credentials
        .connection_uris
        .borrow_mut()
        .insert("connection-1".to_string(), "postgres://stored".to_string());

    let result = persist_deleted_connection(&repository, &credentials, "connection-1")
        .expect("delete should succeed");

    assert!(result.deleted);
    assert!(result.appearance.is_none());
    assert!(repository.file.borrow().connections.is_empty());
    assert!(credentials.db_passwords.borrow().is_empty());
    assert!(credentials.connection_uris.borrow().is_empty());
    assert_eq!(
        credentials.invalidated.borrow().as_slice(),
        &["connection-1".to_string()]
    );
}
