-- Existing PIN identities deliberately cannot be registered again. Their owners
-- must recover access through an administrator who verifies their identity.
CREATE TABLE pin_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    normalized_username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    recovery_email TEXT,
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
