use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn validate_pin(pin: &str) -> Result<(), String> {
    if pin.len() < 6 || pin.len() > 8 {
        return Err("PIN must be between 6 and 8 digits".to_string());
    }

    if !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("PIN must contain only numeric digits (0-9)".to_string());
    }

    // Check all repeated digits e.g. "000000", "111111"
    let first_char = pin.chars().next().unwrap();
    if pin.chars().all(|c| c == first_char) {
        return Err("PIN is too simple: avoid repeated digits like 111111".to_string());
    }

    // Check sequential ascending/descending
    let bytes = pin.as_bytes();
    let mut is_asc = true;
    let mut is_desc = true;
    for i in 0..bytes.len() - 1 {
        if (bytes[i + 1] as i16) - (bytes[i] as i16) != 1 {
            is_asc = false;
        }
        if (bytes[i] as i16) - (bytes[i + 1] as i16) != 1 {
            is_desc = false;
        }
    }

    if is_asc || is_desc {
        return Err(
            "PIN is too simple: avoid sequential numbers like 123456 or 654321".to_string(),
        );
    }

    Ok(())
}

pub fn hash_pin_argon2(pin: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| format!("Argon2 hashing failed: {e}"))
}

pub fn verify_pin_hash(pin: &str, stored_hash: &str, salt: &str) -> bool {
    if stored_hash.starts_with("$argon2") {
        if let Ok(parsed) = PasswordHash::new(stored_hash) {
            return Argon2::default().verify_password(pin.as_bytes(), &parsed).is_ok();
        }
        false
    } else {
        legacy_hash_pin(pin, salt) == stored_hash
    }
}

pub fn hash_pin(pin: &str, salt: &str) -> String {
    legacy_hash_pin(pin, salt)
}

pub fn legacy_hash_pin(pin: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b":pin_secret:");
    hasher.update(pin.as_bytes());
    let first_pass = hasher.finalize();

    // 1000 rounds of stretching for CPU hardening
    let mut stretched = first_pass.to_vec();
    for _ in 0..1000 {
        let mut h = Sha256::new();
        h.update(&stretched);
        h.update(salt.as_bytes());
        stretched = h.finalize().to_vec();
    }

    hex::encode(stretched)
}

#[derive(Clone, Debug)]
pub struct PinUserRecord {
    pub user_id: String,
    pub username: String,
    pub pin_hash: String,
    pub salt: String,
    pub recovery_email: Option<String>,
    pub failed_attempts: u32,
    pub locked_until: Option<u64>,
}

#[derive(Clone, Default)]
pub struct PinAuthStore {
    // Map of normalized lowercase username -> PinUserRecord
    users: Arc<Mutex<HashMap<String, PinUserRecord>>>,
    pub(super) pool: Option<sqlx::PgPool>,
}

impl PinAuthStore {
    pub fn new() -> Self {
        Self {
            users: Arc::new(Mutex::new(HashMap::new())),
            pool: None,
        }
    }

    pub fn register(
        &self,
        username: &str,
        pin: &str,
        recovery_email: Option<String>,
        user_id: &str,
    ) -> Result<PinUserRecord, String> {
        validate_pin(pin)?;

        let trimmed_user = username.trim();
        if trimmed_user.is_empty() || trimmed_user.len() > 50 {
            return Err("Username must be between 1 and 50 characters".to_string());
        }

        let key = trimmed_user.to_lowercase();
        let mut map = self.users.lock().unwrap();
        if map.contains_key(&key) {
            return Err(format!("Username '{trimmed_user}' is already registered"));
        }

        let pin_hash = hash_pin_argon2(pin)?;

        let record = PinUserRecord {
            user_id: user_id.to_string(),
            username: trimmed_user.to_string(),
            pin_hash,
            salt: String::new(),
            recovery_email,
            failed_attempts: 0,
            locked_until: None,
        };

        map.insert(key, record.clone());
        Ok(record)
    }

    pub fn verify_login(&self, username: &str, pin: &str) -> Result<PinUserRecord, String> {
        let key = username.trim().to_lowercase();
        let mut map = self.users.lock().unwrap();

        let record = match map.get_mut(&key) {
            Some(r) => r,
            None => return Err("Invalid username or PIN".to_string()),
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Check if locked
        if let Some(lock_time) = record.locked_until {
            if now < lock_time {
                let remaining = lock_time - now;
                return Err(format!(
                    "Account is temporarily locked due to too many failed attempts. Try again in {remaining}s"
                ));
            } else {
                // Lock expired
                record.locked_until = None;
                record.failed_attempts = 0;
            }
        }

        if !verify_pin_hash(pin, &record.pin_hash, &record.salt) {
            record.failed_attempts += 1;
            if record.failed_attempts >= 5 {
                record.locked_until = Some(now + 60); // lock 1 minute after 5 wrong attempts
                return Err("Too many failed attempts. Account locked for 60 seconds.".to_string());
            }
            return Err("Invalid username or PIN".to_string());
        }

        // Automatic legacy hash migration upon successful authentication
        if !record.pin_hash.starts_with("$argon2") {
            if let Ok(upgraded) = hash_pin_argon2(pin) {
                record.pin_hash = upgraded;
                record.salt.clear();
            }
        }

        // Login success: reset failed attempts
        record.failed_attempts = 0;
        record.locked_until = None;
        Ok(record.clone())
    }

    pub fn find_by_username(&self, username: &str) -> Option<PinUserRecord> {
        let key = username.trim().to_lowercase();
        self.users.lock().unwrap().get(&key).cloned()
    }

    pub fn find_by_user_id(&self, user_id: &str) -> Option<PinUserRecord> {
        self.users
            .lock()
            .unwrap()
            .values()
            .find(|u| u.user_id == user_id)
            .cloned()
    }

    pub fn change_pin(&self, username: &str, old_pin: &str, new_pin: &str) -> Result<(), String> {
        validate_pin(new_pin)?;
        self.verify_login(username, old_pin)?;
        let key = username.trim().to_lowercase();
        let mut map = self.users.lock().unwrap();

        let record = match map.get_mut(&key) {
            Some(r) => r,
            None => return Err("User not found".to_string()),
        };

        if !verify_pin_hash(old_pin, &record.pin_hash, &record.salt) {
            return Err("Old PIN is incorrect".to_string());
        }

        let new_hash = hash_pin_argon2(new_pin)?;
        record.salt.clear();
        record.pin_hash = new_hash;
        record.failed_attempts = 0;
        record.locked_until = None;
        Ok(())
    }
}

// Helper module for hex encoding without extra crate dependency
mod hex {
    pub fn encode(data: impl AsRef<[u8]>) -> String {
        let mut s = String::with_capacity(data.as_ref().len() * 2);
        for &b in data.as_ref() {
            use std::fmt::Write;
            let _ = write!(s, "{:02x}", b);
        }
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_pin_length() {
        assert!(validate_pin("12345").is_err()); // 5 digits
        assert!(validate_pin("123456789").is_err()); // 9 digits
        assert!(validate_pin("abcdef").is_err()); // non-digits
        assert!(validate_pin("111111").is_err()); // repeated
        assert!(validate_pin("123456").is_err()); // sequential
        assert!(validate_pin("654321").is_err()); // reverse sequential

        // Valid 6-8 digits
        assert!(validate_pin("928374").is_ok()); // 6 digits
        assert!(validate_pin("4918273").is_ok()); // 7 digits
        assert!(validate_pin("83910294").is_ok()); // 8 digits
    }

    #[test]
    fn test_pin_register_and_login() {
        let store = PinAuthStore::new();
        store
            .register("alice", "839201", Some("alice@example.com".into()), "usr_1")
            .unwrap();

        // Duplicate fails
        assert!(store.register("Alice", "839201", None, "usr_2").is_err());

        // Wrong PIN fails
        assert!(store.verify_login("alice", "000000").is_err());
        assert!(store.verify_login("alice", "839202").is_err());

        // Correct PIN succeeds
        let res = store.verify_login("alice", "839201").unwrap();
        assert_eq!(res.user_id, "usr_1");
        assert_eq!(res.username, "alice");
    }

    #[test]
    fn test_rate_limit_lockout() {
        let store = PinAuthStore::new();
        store.register("bob", "593810", None, "usr_bob").unwrap();

        for _ in 0..4 {
            assert!(store.verify_login("bob", "000000").is_err());
        }

        // 5th failed attempt triggers lock
        let err = store.verify_login("bob", "000000").unwrap_err();
        assert!(err.contains("locked"));
    }

    #[test]
    fn test_change_pin() {
        let store = PinAuthStore::new();
        store
            .register("carol", "928374", None, "usr_carol")
            .unwrap();

        // Wrong old PIN
        assert!(store.change_pin("carol", "000000", "748392").is_err());

        // Invalid new PIN (e.g. sequential)
        assert!(store.change_pin("carol", "928374", "123456").is_err());

        // Successful change
        assert!(store.change_pin("carol", "928374", "748392").is_ok());

        // Old PIN no longer works
        assert!(store.verify_login("carol", "928374").is_err());

        // New PIN works
        assert!(store.verify_login("carol", "748392").is_ok());
    }

    #[test]
    fn test_argon2id_hashing_and_legacy_migration() {
        let store = PinAuthStore::new();
        let registered = store
            .register("dave", "619284", None, "usr_dave")
            .unwrap();

        // Stored hash must be Argon2id PHC string
        assert!(registered.pin_hash.starts_with("$argon2id$"));

        // Simulate a legacy user registered with older sha256 hashing
        let legacy_salt = "legacy_salt_1234".to_string();
        let legacy_pin = "729183";
        let legacy_hash = legacy_hash_pin(legacy_pin, &legacy_salt);
        {
            let mut map = store.users.lock().unwrap();
            map.insert(
                "legacy_user".to_string(),
                PinUserRecord {
                    user_id: "usr_legacy".to_string(),
                    username: "legacy_user".to_string(),
                    pin_hash: legacy_hash.clone(),
                    salt: legacy_salt.clone(),
                    recovery_email: None,
                    failed_attempts: 0,
                    locked_until: None,
                },
            );
        }

        // Incorrect PIN fails
        assert!(store.verify_login("legacy_user", "000000").is_err());

        // Correct PIN succeeds and automatically upgrades hash to Argon2id
        let verified = store.verify_login("legacy_user", legacy_pin).unwrap();
        assert_eq!(verified.username, "legacy_user");

        let current_record = store.find_by_username("legacy_user").unwrap();
        assert!(current_record.pin_hash.starts_with("$argon2id$"));
        assert_ne!(current_record.pin_hash, legacy_hash);

        // Subsequent logins continue to succeed with upgraded Argon2id hash
        assert!(store.verify_login("legacy_user", legacy_pin).is_ok());
    }
}
