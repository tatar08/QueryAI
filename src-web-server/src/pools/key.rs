use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct TenantPoolKey {
    pub workspace_id: String,
    pub user_id: String,
    pub connection_id: String,
    pub database: String,
    pub config_hash: String,
}

impl TenantPoolKey {
    pub fn new(
        workspace_id: &str,
        user_id: &str,
        connection_id: &str,
        database: Option<&str>,
        public_params: &Value,
    ) -> Self {
        let db_name = database
            .or_else(|| public_params.get("database").and_then(Value::as_str))
            .unwrap_or("default")
            .to_string();

        let mut hasher = Sha256::new();
        if let Ok(serialized) = serde_json::to_vec(public_params) {
            hasher.update(&serialized);
        }
        let hash_result = hasher.finalize();
        let config_hash = hex::encode(&hash_result[..8]);

        Self {
            workspace_id: workspace_id.to_string(),
            user_id: user_id.to_string(),
            connection_id: connection_id.to_string(),
            database: db_name,
            config_hash,
        }
    }

    pub fn to_key_string(&self) -> String {
        format!(
            "{}:{}:{}:{}:{}",
            self.workspace_id, self.user_id, self.connection_id, self.database, self.config_hash
        )
    }
}

mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
