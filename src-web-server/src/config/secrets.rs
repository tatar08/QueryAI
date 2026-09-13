use crate::crypto::KeyManager;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::collections::HashMap;

#[derive(Clone, Eq, PartialEq)]
pub struct RuntimeSecrets {
    pub jwt: Option<[u8; 32]>,
    pub master: Option<[u8; 32]>,
    pub key_version: i32,
    pub historical: Vec<(i32, [u8; 32])>,
}

impl std::fmt::Debug for RuntimeSecrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RuntimeSecrets([REDACTED])")
    }
}

fn decode(value: &str) -> Result<[u8; 32], String> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| "Secret must be base64 encoding of 32 random bytes")?;
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Secret must contain exactly 32 bytes")?;
    if key.iter().all(|b| *b == key[0]) || key.as_slice() == b"tabularis-dev-master-key-32bytes" {
        return Err("Development or trivial keys are not permitted".into());
    }
    Ok(key)
}

impl RuntimeSecrets {
    pub fn parse(values: &HashMap<String, String>, production: bool) -> Result<Self, String> {
        let read = |name: &str| {
            values
                .get(name)
                .map(|value| decode(value).map_err(|err| format!("{name}: {err}")))
                .transpose()
        };
        let jwt = read("TABULARIS_JWT_SECRET")?;
        let master = read("TABULARIS_MASTER_KEY")?;
        if production && (jwt.is_none() || master.is_none()) {
            return Err(
                "TABULARIS_JWT_SECRET and TABULARIS_MASTER_KEY are required in production".into(),
            );
        }
        let key_version = values
            .get("TABULARIS_MASTER_KEY_VERSION")
            .map(|s| s.parse::<i32>())
            .transpose()
            .map_err(|_| "Invalid master key version")?
            .unwrap_or(1);
        if key_version < 1 {
            return Err("Master key version must be positive".into());
        }
        let encoded: HashMap<String, String> = values
            .get("TABULARIS_HISTORICAL_MASTER_KEYS")
            .filter(|s| !s.trim().is_empty())
            .map(|s| serde_json::from_str(s))
            .transpose()
            .map_err(|_| "Historical keys must be a JSON object")?
            .unwrap_or_default();
        let mut historical = Vec::new();
        for (version, value) in encoded {
            let version = version
                .parse::<i32>()
                .map_err(|_| "Invalid historical key version")?;
            if version < 1 || version == key_version {
                return Err(
                    "Historical key versions must be positive and differ from the active version"
                        .into(),
                );
            }
            // Historical development keys are accepted only explicitly for migration.
            let bytes: [u8; 32] = STANDARD
                .decode(value)
                .map_err(|_| "Invalid historical key encoding")?
                .try_into()
                .map_err(|_| "Historical key must contain 32 bytes")?;
            historical.push((version, bytes));
        }
        historical.sort_by_key(|entry| entry.0);
        Ok(Self {
            jwt,
            master,
            key_version,
            historical,
        })
    }

    pub fn key_manager(&self) -> Result<KeyManager, String> {
        let key = self.master.ok_or(
            "Set TABULARIS_MASTER_KEY to persist encrypted credentials safely across restarts",
        )?;
        let mut manager = KeyManager::new(self.key_version, key);
        for (version, key) in &self.historical {
            manager = manager.with_historical_key(*version, *key);
        }
        Ok(manager)
    }
}
