use super::*;

#[test]
fn encrypt_and_decrypt_round_trip() {
    let km = KeyManager::dev_default();
    let secret = b"super-secret-database-password-12345";

    let encrypted = km.encrypt(secret).unwrap();
    assert_ne!(encrypted.ciphertext, secret);
    assert_eq!(encrypted.nonce.len(), 12);
    assert_eq!(encrypted.key_version, 1);

    let decrypted = km
        .decrypt(
            &encrypted.ciphertext,
            &encrypted.nonce,
            encrypted.key_version,
        )
        .unwrap();
    assert_eq!(decrypted, secret);
}

#[test]
fn tampering_detection() {
    let km = KeyManager::dev_default();
    let secret = b"unaltered-database-password";

    let mut encrypted = km.encrypt(secret).unwrap();
    // Tamper single byte in ciphertext
    encrypted.ciphertext[0] ^= 0xFF;

    let result = km.decrypt(
        &encrypted.ciphertext,
        &encrypted.nonce,
        encrypted.key_version,
    );
    assert!(result.is_err());
}

#[test]
fn wrong_key_version_or_unknown_version() {
    let km = KeyManager::dev_default();
    let secret = b"my-secret";

    let encrypted = km.encrypt(secret).unwrap();
    let result = km.decrypt(&encrypted.ciphertext, &encrypted.nonce, 999);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("version 999 is not configured"));
}

#[test]
fn key_rotation_and_re_encryption() {
    let key1 = [1_u8; 32];
    let key2 = [2_u8; 32];

    let old_km = KeyManager::new(1, key1);
    let secret = b"rotate-me-securely";
    let encrypted_v1 = old_km.encrypt(secret).unwrap();
    assert_eq!(encrypted_v1.key_version, 1);

    // New key manager with version 2 as active and version 1 as historical
    let new_km = KeyManager::new(2, key2).with_historical_key(1, key1);

    // Can decrypt old version 1
    let decrypted = new_km
        .decrypt(
            &encrypted_v1.ciphertext,
            &encrypted_v1.nonce,
            encrypted_v1.key_version,
        )
        .unwrap();
    assert_eq!(decrypted, secret);

    // Re-encrypt to active version 2
    let encrypted_v2 = new_km.re_encrypt(&encrypted_v1).unwrap();
    assert_eq!(encrypted_v2.key_version, 2);

    let decrypted_v2 = new_km
        .decrypt(
            &encrypted_v2.ciphertext,
            &encrypted_v2.nonce,
            encrypted_v2.key_version,
        )
        .unwrap();
    assert_eq!(decrypted_v2, secret);
}
