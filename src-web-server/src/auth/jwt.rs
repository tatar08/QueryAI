use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::hmac;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq)]
pub struct JwtClaims {
    pub sub: String,
    #[serde(default)]
    pub jti: String,
    pub username: String,
    #[serde(default = "default_role")]
    pub role: String,
    pub iss: String,
    #[serde(default)]
    pub aud: String,
    pub exp: u64,
    pub iat: u64,
}

fn default_role() -> String {
    "viewer".to_string()
}

#[derive(Clone)]
pub struct JwtService {
    key: hmac::Key,
    ttl_seconds: u64,
}

impl JwtService {
    pub fn new(secret: &[u8], ttl_seconds: u64) -> Self {
        let key = hmac::Key::new(hmac::HMAC_SHA256, secret);
        Self { key, ttl_seconds }
    }

    pub fn issue(&self, user_id: &str, username: &str) -> Result<String, String> {
        self.issue_with_role(user_id, username, "viewer")
    }

    pub fn issue_with_role(
        &self,
        user_id: &str,
        username: &str,
        role: &str,
    ) -> Result<String, String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("System time error: {e}"))?
            .as_secs();

        let header = serde_json::json!({
            "alg": "HS256",
            "typ": "JWT"
        });

        let claims = JwtClaims {
            sub: user_id.to_string(),
            jti: super::random_value(18),
            username: username.to_string(),
            role: role.to_string(),
            iss: "tabularis".to_string(),
            aud: "tabularis-web".to_string(),
            exp: now + self.ttl_seconds,
            iat: now,
        };

        let header_b64 =
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).map_err(|e| e.to_string())?);
        let claims_b64 =
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).map_err(|e| e.to_string())?);

        let signing_input = format!("{header_b64}.{claims_b64}");
        let signature = hmac::sign(&self.key, signing_input.as_bytes());
        let signature_b64 = URL_SAFE_NO_PAD.encode(signature.as_ref());

        Ok(format!("{signing_input}.{signature_b64}"))
    }

    pub fn verify(&self, token: &str) -> Result<JwtClaims, String> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err("Malformed JWT token".to_string());
        }

        let header_bytes = URL_SAFE_NO_PAD
            .decode(parts[0])
            .map_err(|_| "Invalid JWT header")?;
        let header: serde_json::Value =
            serde_json::from_slice(&header_bytes).map_err(|_| "Invalid JWT header")?;
        if header["alg"] != "HS256" || header["typ"] != "JWT" {
            return Err("Unsupported JWT header".to_string());
        }
        let signing_input = format!("{}.{}", parts[0], parts[1]);
        let signature_bytes = URL_SAFE_NO_PAD
            .decode(parts[2])
            .map_err(|_| "Invalid JWT signature encoding".to_string())?;

        hmac::verify(&self.key, signing_input.as_bytes(), &signature_bytes)
            .map_err(|_| "Invalid JWT signature".to_string())?;

        let claims_bytes = URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|_| "Invalid JWT claims encoding".to_string())?;

        let claims: JwtClaims =
            serde_json::from_slice(&claims_bytes).map_err(|_| "Invalid JWT payload".to_string())?;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("System time error: {e}"))?
            .as_secs();

        if claims.aud != "tabularis-web"
            || claims.iss != "tabularis"
            || claims.sub.trim().is_empty()
            || claims.iat > now + 30
        {
            return Err("Invalid JWT claims".to_string());
        }
        if claims.exp <= now {
            return Err("JWT token has expired".to_string());
        }

        Ok(claims)
    }

    pub fn ttl_seconds(&self) -> u64 {
        self.ttl_seconds
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_issue_and_verify_jwt() {
        let service = JwtService::new(b"super-secret-key-1234567890123456", 3600);
        let token = service.issue("usr_123", "alice").unwrap();

        assert_eq!(token.split('.').count(), 3);

        let claims = service.verify(&token).unwrap();
        assert_eq!(claims.sub, "usr_123");
        assert_eq!(claims.username, "alice");
        assert_eq!(claims.iss, "tabularis");
        assert!(claims.exp > claims.iat);
    }

    #[test]
    fn test_tampered_jwt_rejected() {
        let service = JwtService::new(b"super-secret-key-1234567890123456", 3600);
        let token = service.issue("usr_123", "alice").unwrap();

        let mut tampered = token.clone();
        tampered.push('x');

        assert!(service.verify(&tampered).is_err());
    }

    #[test]
    fn test_expired_jwt_rejected() {
        let service = JwtService::new(b"super-secret-key-1234567890123456", 0);
        let token = service.issue("usr_123", "alice").unwrap();

        // 0 TTL should be expired immediately
        std::thread::sleep(std::time::Duration::from_millis(10));
        assert!(service.verify(&token).is_err());
    }

    #[test]
    fn test_issue_with_role() {
        let service = JwtService::new(b"super-secret-key-1234567890123456", 3600);
        let token = service
            .issue_with_role("usr_viewer", "dave", "viewer")
            .unwrap();

        let claims = service.verify(&token).unwrap();
        assert_eq!(claims.role, "viewer");
        assert_eq!(claims.username, "dave");
    }
}
