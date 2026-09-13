use crate::models::{ConnectionAppearance, ConnectionParams, ConnectionsFile, SavedConnection};
use tabularis_core::{ConnectionService, ConnectionValidationInput};

use super::{create_saved_connection, remove_saved_connections, update_saved_connection};

pub trait ConnectionRepository {
    fn exists(&self) -> bool;
    fn load(&self) -> Result<ConnectionsFile, String>;
    fn save(&self, file: &ConnectionsFile) -> Result<(), String>;
}

pub trait ConnectionCredentialStore {
    fn get_connection_uri(&self, connection_id: &str) -> Result<String, String>;
    fn set_connection_uri(&self, connection_id: &str, value: &str) -> Result<(), String>;
    fn delete_connection_uri(&self, connection_id: &str) -> Result<(), String>;
    fn set_db_password(&self, connection_id: &str, value: &str) -> Result<(), String>;
    fn delete_db_password(&self, connection_id: &str) -> Result<(), String>;
    fn set_ssh_password(&self, connection_id: &str, value: &str) -> Result<(), String>;
    fn delete_ssh_password(&self, connection_id: &str) -> Result<(), String>;
    fn set_ssh_key_passphrase(&self, connection_id: &str, value: &str) -> Result<(), String>;
    fn delete_ssh_key_passphrase(&self, connection_id: &str) -> Result<(), String>;
    fn invalidate_connection(&self, connection_id: &str);
}

pub struct SaveConnectionInput {
    pub id: String,
    pub name: String,
    pub params: ConnectionParams,
    pub detect_json_in_text_columns: Option<bool>,
    pub environment: Option<String>,
    pub read_only: Option<bool>,
}

pub struct UpdateConnectionInput {
    pub id: String,
    pub name: String,
    pub params: ConnectionParams,
    pub detect_json_in_text_columns: Option<bool>,
    pub environment: Option<String>,
    pub read_only: Option<bool>,
}

#[derive(Debug)]
pub struct UpdateConnectionResult {
    pub connection: SavedConnection,
    pub previous_database_for_backfill: Option<String>,
}

#[derive(Debug)]
pub struct DeleteConnectionResult {
    pub deleted: bool,
    pub repository_existed: bool,
    pub appearance: Option<ConnectionAppearance>,
}

fn runtime_connection_uri(params: &ConnectionParams) -> Option<&str> {
    params
        .connection_uri
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn validate_connection_uri_persistence(params: &ConnectionParams) -> Result<(), String> {
    ConnectionService
        .validate(ConnectionValidationInput {
            environment: None,
            connection_uri: params.connection_uri.clone(),
            save_credentials: params.save_in_keychain.unwrap_or(false),
        })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn validate_environment(environment: Option<String>) -> Result<Option<String>, String> {
    ConnectionService
        .validate(ConnectionValidationInput {
            environment,
            connection_uri: None,
            save_credentials: false,
        })
        .map(|result| result.environment)
        .map_err(|error| error.to_string())
}

fn params_for_persistence(
    params: &ConnectionParams,
    connection_uri_in_keychain: bool,
) -> ConnectionParams {
    let mut persisted = params.clone();
    persisted.connection_uri = None;
    persisted.connection_uri_in_keychain = connection_uri_in_keychain.then_some(true);
    persisted
}

fn persist_connection_uri_change(
    credentials: &impl ConnectionCredentialStore,
    connection_id: &str,
    stored_in_keychain: bool,
    change: Option<Option<&str>>,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let Some(value) = change else {
        return persist();
    };
    let previous = stored_in_keychain
        .then(|| credentials.get_connection_uri(connection_id))
        .transpose()
        .map_err(|_| "Failed to read the stored connection URI from the OS keychain".to_string())?;

    if let Some(value) = value {
        credentials.set_connection_uri(connection_id, value)?;
    } else {
        credentials.delete_connection_uri(connection_id)?;
    }

    if let Err(error) = persist() {
        let rollback = match previous.as_deref() {
            Some(value) => credentials.set_connection_uri(connection_id, value),
            None => credentials.delete_connection_uri(connection_id),
        };
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!("{error} ({rollback_error})")),
        };
    }

    Ok(())
}

fn persist_requested_credentials(
    credentials: &impl ConnectionCredentialStore,
    connection_id: &str,
    params: &ConnectionParams,
    persisted: &mut ConnectionParams,
) -> Result<(), String> {
    if params.save_in_keychain.unwrap_or(false) {
        if let Some(password) = &params.password {
            credentials.set_db_password(connection_id, password)?;
        }
        if params.ssh_enabled.unwrap_or(false) {
            if let Some(password) = &params.ssh_password {
                credentials.set_ssh_password(connection_id, password)?;
            }
            if let Some(passphrase) = &params.ssh_key_passphrase {
                if !passphrase.trim().is_empty() {
                    credentials.set_ssh_key_passphrase(connection_id, passphrase)?;
                }
            }
        } else {
            credentials.delete_ssh_password(connection_id).ok();
            credentials.delete_ssh_key_passphrase(connection_id).ok();
        }
        persisted.password = None;
        persisted.ssh_password = None;
        persisted.ssh_key_passphrase = None;
    } else {
        credentials.delete_db_password(connection_id).ok();
        credentials.delete_ssh_password(connection_id).ok();
        credentials.delete_ssh_key_passphrase(connection_id).ok();
    }

    Ok(())
}

pub fn persist_new_connection(
    repository: &impl ConnectionRepository,
    credentials: &impl ConnectionCredentialStore,
    input: SaveConnectionInput,
) -> Result<SavedConnection, String> {
    validate_connection_uri_persistence(&input.params)?;
    let mut file = repository.load().unwrap_or_default();
    let connection_uri = runtime_connection_uri(&input.params).map(str::to_owned);
    let mut persisted_params = params_for_persistence(&input.params, connection_uri.is_some());
    persist_requested_credentials(credentials, &input.id, &input.params, &mut persisted_params)?;
    let environment = validate_environment(input.environment)?;

    let connection = create_saved_connection(
        input.id.clone(),
        input.name,
        persisted_params,
        input.detect_json_in_text_columns,
        environment,
        input.read_only,
    );
    file.connections.push(connection.clone());
    persist_connection_uri_change(
        credentials,
        &input.id,
        false,
        connection_uri.as_deref().map(Some),
        || repository.save(&file),
    )?;

    let mut returned = connection;
    returned.params = input.params;
    Ok(returned)
}

pub fn persist_updated_connection(
    repository: &impl ConnectionRepository,
    credentials: &impl ConnectionCredentialStore,
    input: UpdateConnectionInput,
) -> Result<UpdateConnectionResult, String> {
    validate_connection_uri_persistence(&input.params)?;
    let mut file = repository.load()?;
    let index = file
        .connections
        .iter()
        .position(|connection| connection.id == input.id)
        .ok_or("Connection not found")?;
    let existing = &file.connections[index];
    let existing_uri_in_keychain = existing.params.connection_uri_in_keychain.unwrap_or(false);
    let same_driver = existing.params.driver == input.params.driver;
    let connection_uri = runtime_connection_uri(&input.params).map(str::to_owned);
    let preserve_stored_uri = connection_uri.is_none()
        && same_driver
        && input.params.save_in_keychain.unwrap_or(false)
        && existing_uri_in_keychain
        && input.params.connection_uri_in_keychain != Some(false);
    let uri_change = match connection_uri.as_deref() {
        Some(value) => Some(Some(value)),
        None if preserve_stored_uri => None,
        None => Some(None),
    };
    let mut persisted_params = params_for_persistence(
        &input.params,
        connection_uri.is_some() || preserve_stored_uri,
    );
    persist_requested_credentials(credentials, &input.id, &input.params, &mut persisted_params)?;
    let environment = validate_environment(input.environment)?;

    let original_database = existing.params.database.clone();
    let updated = update_saved_connection(
        existing,
        input.name,
        persisted_params,
        input.detect_json_in_text_columns,
        environment,
        input.read_only,
    );
    file.connections[index] = updated.clone();
    persist_connection_uri_change(
        credentials,
        &input.id,
        existing_uri_in_keychain,
        uri_change,
        || repository.save(&file),
    )?;

    let previous_database_for_backfill = crate::models::single_db_before_multi_transition(
        &original_database,
        &input.params.database,
    );
    let mut returned = updated;
    returned.params = input.params;
    Ok(UpdateConnectionResult {
        connection: returned,
        previous_database_for_backfill,
    })
}

pub fn persist_deleted_connection(
    repository: &impl ConnectionRepository,
    credentials: &impl ConnectionCredentialStore,
    connection_id: &str,
) -> Result<DeleteConnectionResult, String> {
    if !repository.exists() {
        return Ok(DeleteConnectionResult {
            deleted: false,
            repository_existed: false,
            appearance: None,
        });
    }

    let mut file = repository.load()?;
    let removed = remove_saved_connections(&mut file, connection_id);
    let uri_stored_in_keychain = removed
        .as_ref()
        .and_then(|connection| connection.params.connection_uri_in_keychain)
        .unwrap_or(false);
    let appearance = removed
        .as_ref()
        .and_then(|connection| connection.appearance.clone());
    let deleted = removed.is_some();

    credentials.delete_db_password(connection_id).ok();
    credentials.delete_ssh_password(connection_id).ok();
    credentials.delete_ssh_key_passphrase(connection_id).ok();
    persist_connection_uri_change(
        credentials,
        connection_id,
        uri_stored_in_keychain,
        Some(None),
        || repository.save(&file),
    )?;
    credentials.invalidate_connection(connection_id);

    Ok(DeleteConnectionResult {
        deleted,
        repository_existed: true,
        appearance,
    })
}
