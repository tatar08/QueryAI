use std::collections::HashMap;

use rand::rngs::OsRng;
use rand::RngCore;
use ring::aead::{
    Aad, BoundKey, Nonce, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM, NONCE_LEN,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EncryptedData {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub key_version: i32,
}

struct SingleNonce(Option<Nonce>);

impl SingleNonce {
    fn new(nonce_bytes: [u8; NONCE_LEN]) -> Self {
        Self(Some(Nonce::assume_unique_for_key(nonce_bytes)))
    }
}

impl NonceSequence for SingleNonce {
    fn advance(&mut self) -> Result<Nonce, ring::error::Unspecified> {
        self.0.take().ok_or(ring::error::Unspecified)
    }
}

#[derive(Clone)]
pub struct KeyManager {
    current_version: i32,
    keys: HashMap<i32, [u8; 32]>,
}

impl KeyManager {
    pub fn new(current_version: i32, primary_key: [u8; 32]) -> Self {
        let mut keys = HashMap::new();
        keys.insert(current_version, primary_key);
        Self {
            current_version,
            keys,
        }
    }

    pub fn with_historical_key(mut self, version: i32, key: [u8; 32]) -> Self {
        self.keys.insert(version, key);
        self
    }

    pub fn dev_default() -> Self {
        let mut key = [0_u8; 32];
        OsRng.fill_bytes(&mut key);
        Self::new(1, key)
    }

    pub fn current_version(&self) -> i32 {
        self.current_version
    }

    pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncryptedData, String> {
        let key_bytes = self.keys.get(&self.current_version).ok_or_else(|| {
            format!(
                "Active master key version {} not found",
                self.current_version
            )
        })?;

        let mut nonce_bytes = [0_u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);

        let unbound = UnboundKey::new(&AES_256_GCM, key_bytes)
            .map_err(|_| "Failed to initialize cipher key".to_string())?;
        let mut sealing_key = SealingKey::new(unbound, SingleNonce::new(nonce_bytes));

        let mut in_out = plaintext.to_vec();
        sealing_key
            .seal_in_place_append_tag(Aad::empty(), &mut in_out)
            .map_err(|_| "Failed to encrypt data with AES-256-GCM".to_string())?;

        Ok(EncryptedData {
            ciphertext: in_out,
            nonce: nonce_bytes.to_vec(),
            key_version: self.current_version,
        })
    }

    pub fn decrypt(
        &self,
        ciphertext: &[u8],
        nonce: &[u8],
        key_version: i32,
    ) -> Result<Vec<u8>, String> {
        let key_bytes = self
            .keys
            .get(&key_version)
            .ok_or_else(|| format!("Encryption key version {key_version} is not configured"))?;

        if nonce.len() != NONCE_LEN {
            return Err(format!("Invalid nonce length: expected {NONCE_LEN} bytes"));
        }

        let mut nonce_bytes = [0_u8; NONCE_LEN];
        nonce_bytes.copy_from_slice(nonce);

        let unbound = UnboundKey::new(&AES_256_GCM, key_bytes)
            .map_err(|_| "Failed to initialize cipher key".to_string())?;
        let mut opening_key = OpeningKey::new(unbound, SingleNonce::new(nonce_bytes));

        let mut in_out = ciphertext.to_vec();
        let decrypted = opening_key
            .open_in_place(Aad::empty(), &mut in_out)
            .map_err(|_| {
                "Failed to decrypt data: invalid ciphertext, tampered tag, or wrong key".to_string()
            })?;

        Ok(decrypted.to_vec())
    }

    pub fn re_encrypt(&self, encrypted: &EncryptedData) -> Result<EncryptedData, String> {
        let decrypted = self.decrypt(
            &encrypted.ciphertext,
            &encrypted.nonce,
            encrypted.key_version,
        )?;
        self.encrypt(&decrypted)
    }
}
