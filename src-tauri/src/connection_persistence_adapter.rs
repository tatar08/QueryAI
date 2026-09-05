use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use crate::credential_cache;
use crate::models::ConnectionsFile;
use crate::services::{ConnectionCredentialStore, ConnectionRepository};

pub struct DesktopConnectionRepository<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    path: PathBuf,
}

impl<'a, R: Runtime> DesktopConnectionRepository<'a, R> {
    pub fn new(app: &'a AppHandle<R>, path: PathBuf) -> Self {
        Self { app, path }
    }
}

impl<R: Runtime> ConnectionRepository for DesktopConnectionRepository<'_, R> {
    fn exists(&self) -> bool {
        self.path.exists()
    }

    fn load(&self) -> Result<ConnectionsFile, String> {
        crate::persistence::load_connections_file(&self.path)
    }

    fn save(&self, file: &ConnectionsFile) -> Result<(), String> {
        crate::persistence::save_connections_file(&self.path, file)?;
        self.app
            .state::<std::sync::Arc<crate::connection_cache::ConnectionCache>>()
            .invalidate();
        Ok(())
    }
}

pub struct DesktopConnectionCredentialStore<'a> {
    cache: &'a credential_cache::CredentialCache,
}

impl<'a> DesktopConnectionCredentialStore<'a> {
    pub fn new(cache: &'a credential_cache::CredentialCache) -> Self {
        Self { cache }
    }
}

impl ConnectionCredentialStore for DesktopConnectionCredentialStore<'_> {
    fn get_connection_uri(&self, connection_id: &str) -> Result<String, String> {
        crate::keychain_utils::get_connection_uri(connection_id)
    }

    fn set_connection_uri(&self, connection_id: &str, value: &str) -> Result<(), String> {
        crate::keychain_utils::set_connection_uri(connection_id, value)?;
        credential_cache::set_connection_uri_cached(self.cache, connection_id, value);
        Ok(())
    }

    fn delete_connection_uri(&self, connection_id: &str) -> Result<(), String> {
        crate::keychain_utils::delete_connection_uri(connection_id)?;
        credential_cache::invalidate_connection_uri(self.cache, connection_id);
        Ok(())
    }

    fn set_db_password(&self, connection_id: &str, value: &str) -> Result<(), String> {
        crate::keychain_utils::set_db_password(connection_id, value)?;
        credential_cache::set_db_password_cached(self.cache, connection_id, value);
        Ok(())
    }

    fn delete_db_password(&self, connection_id: &str) -> Result<(), String> {
        let result = crate::keychain_utils::delete_db_password(connection_id);
        credential_cache::invalidate_db_password(self.cache, connection_id);
        result
    }

    fn set_ssh_password(&self, connection_id: &str, value: &str) -> Result<(), String> {
        crate::keychain_utils::set_ssh_password(connection_id, value)?;
        credential_cache::set_ssh_password_cached(self.cache, connection_id, value);
        Ok(())
    }

    fn delete_ssh_password(&self, connection_id: &str) -> Result<(), String> {
        let result = crate::keychain_utils::delete_ssh_password(connection_id);
        credential_cache::invalidate_ssh_password(self.cache, connection_id);
        result
    }

    fn set_ssh_key_passphrase(&self, connection_id: &str, value: &str) -> Result<(), String> {
        crate::keychain_utils::set_ssh_key_passphrase(connection_id, value)?;
        credential_cache::set_ssh_key_passphrase_cached(self.cache, connection_id, value);
        Ok(())
    }

    fn delete_ssh_key_passphrase(&self, connection_id: &str) -> Result<(), String> {
        let result = crate::keychain_utils::delete_ssh_key_passphrase(connection_id);
        credential_cache::invalidate_ssh_key_passphrase(self.cache, connection_id);
        result
    }

    fn invalidate_connection(&self, connection_id: &str) {
        credential_cache::invalidate_all_for_connection(self.cache, connection_id);
    }
}
