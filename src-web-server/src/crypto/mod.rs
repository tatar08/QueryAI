pub mod envelope;

pub use envelope::{EncryptedData, KeyManager};

#[cfg(test)]
mod tests;
