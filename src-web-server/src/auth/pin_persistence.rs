use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use sqlx::Row;

use super::{
    pin::{validate_pin, PinAuthStore, PinUserRecord},
    random_value,
};

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

async fn password_hash(pin: &str) -> Result<String, String> {
    let pin = pin.to_owned();
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(pin.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|hash| hash.to_string())
            .map_err(|_| "Credential hashing failed".to_string())
    })
    .await
    .map_err(|_| "Credential hashing failed".to_string())?
}

async fn password_matches(pin: &str, hash: String) -> Result<bool, String> {
    let pin = pin.to_owned();
    tokio::task::spawn_blocking(move || {
        let parsed =
            PasswordHash::new(&hash).map_err(|_| "Invalid stored credential".to_string())?;
        Ok(Argon2::default()
            .verify_password(pin.as_bytes(), &parsed)
            .is_ok())
    })
    .await
    .map_err(|_| "Credential verification failed".to_string())?
}

fn record(row: &sqlx::postgres::PgRow) -> PinUserRecord {
    PinUserRecord {
        user_id: row.get("user_id"),
        username: row.get("username"),
        pin_hash: row.get("password_hash"),
        salt: String::new(),
        recovery_email: row.get("recovery_email"),
        failed_attempts: row.get::<i32, _>("failed_attempts") as u32,
        locked_until: row.get::<Option<i64>, _>("locked_until").map(|x| x as u64),
    }
}

fn storage_error(error: sqlx::Error) -> String {
    tracing::error!(%error, "PIN credential persistence failed");
    "Credential service unavailable".to_string()
}

impl PinAuthStore {
    pub fn postgres(pool: sqlx::PgPool) -> Self {
        let mut store = Self::new();
        store.pool = Some(pool);
        store
    }

    pub async fn register_account(
        &self,
        username: &str,
        pin: &str,
        email: Option<String>,
    ) -> Result<PinUserRecord, String> {
        validate_pin(pin)?;
        let username = username.trim();
        if username.is_empty() || username.len() > 50 {
            return Err("Username must be between 1 and 50 characters".into());
        }
        let user_id = format!("usr_{}", random_value(18));
        let Some(pool) = &self.pool else {
            return self.register(username, pin, email, &user_id);
        };
        let normalized = username.to_lowercase();
        let hash = password_hash(pin).await?;
        let mut tx = pool.begin().await.map_err(storage_error)?;
        // Never use an upsert: old identities without persisted PINs are reserved.
        let created = sqlx::query("INSERT INTO users (id, oidc_issuer, oidc_subject, display_name) VALUES ($1, 'tabularis:pin', $2, $3) ON CONFLICT (oidc_issuer, oidc_subject) DO NOTHING")
            .bind(&user_id).bind(format!("pin:{normalized}")).bind(username)
            .execute(&mut *tx).await.map_err(storage_error)?;
        if created.rows_affected() != 1 {
            return Err("Username unavailable; existing accounts require verified recovery".into());
        }
        let row = sqlx::query("INSERT INTO pin_credentials (user_id, username, normalized_username, password_hash, recovery_email) VALUES ($1, $2, $3, $4, $5) RETURNING *")
            .bind(&user_id).bind(username).bind(normalized).bind(hash).bind(email)
            .fetch_one(&mut *tx).await.map_err(storage_error)?;
        tx.commit().await.map_err(storage_error)?;
        Ok(record(&row))
    }

    pub async fn login(&self, username: &str, pin: &str) -> Result<PinUserRecord, String> {
        if self.pool.is_none() {
            return self.verify_login(username, pin);
        }
        self.verify_persistent(username, pin, None).await
    }

    pub async fn account_by_id(&self, user_id: &str) -> Result<Option<PinUserRecord>, String> {
        let Some(pool) = &self.pool else {
            return Ok(self.find_by_user_id(user_id));
        };
        sqlx::query("SELECT * FROM pin_credentials WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map(|row| row.as_ref().map(record))
            .map_err(storage_error)
    }

    pub async fn update_pin(
        &self,
        user_id: &str,
        username: &str,
        old_pin: &str,
        new_pin: &str,
    ) -> Result<(), String> {
        validate_pin(new_pin)?;
        let account = self
            .account_by_id(user_id)
            .await?
            .ok_or("Account unavailable")?;
        if account.username.to_lowercase() != username.trim().to_lowercase() {
            return Err("Account unavailable".into());
        }
        if self.pool.is_none() {
            return self.change_pin(&account.username, old_pin, new_pin);
        }
        let hash = password_hash(new_pin).await?;
        self.verify_persistent(&account.username, old_pin, Some(hash))
            .await
            .map(|_| ())
    }

    async fn verify_persistent(
        &self,
        username: &str,
        pin: &str,
        new_hash: Option<String>,
    ) -> Result<PinUserRecord, String> {
        let pool = self.pool.as_ref().ok_or("Credential service unavailable")?;
        let mut tx = pool.begin().await.map_err(storage_error)?;
        let row =
            sqlx::query("SELECT * FROM pin_credentials WHERE normalized_username = $1 FOR UPDATE")
                .bind(username.trim().to_lowercase())
                .fetch_optional(&mut *tx)
                .await
                .map_err(storage_error)?
                .ok_or("Invalid username or PIN")?;
        let mut account = record(&row);
        let timestamp = now();
        if account.locked_until.is_some_and(|until| until > timestamp) {
            return Err("Account temporarily locked".into());
        }
        if account.locked_until.is_some() {
            account.failed_attempts = 0;
        }
        let valid = password_matches(pin, account.pin_hash.clone()).await?;
        if !valid {
            let attempts = account.failed_attempts.saturating_add(1).min(5);
            let locked = (attempts >= 5).then_some((timestamp + 60) as i64);
            sqlx::query("UPDATE pin_credentials SET failed_attempts = $2, locked_until = $3 WHERE user_id = $1")
                .bind(&account.user_id).bind(attempts as i32).bind(locked)
                .execute(&mut *tx).await.map_err(storage_error)?;
            tx.commit().await.map_err(storage_error)?;
            return Err(if locked.is_some() {
                "Account temporarily locked"
            } else {
                "Invalid username or PIN"
            }
            .into());
        }
        sqlx::query("UPDATE pin_credentials SET failed_attempts = 0, locked_until = NULL, password_hash = COALESCE($2, password_hash), updated_at = NOW() WHERE user_id = $1")
            .bind(&account.user_id).bind(new_hash).execute(&mut *tx).await.map_err(storage_error)?;
        tx.commit().await.map_err(storage_error)?;
        account.failed_attempts = 0;
        account.locked_until = None;
        Ok(account)
    }
}
