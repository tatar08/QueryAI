use super::MetadataStore;

#[tokio::test]
async fn unavailable_database_is_not_ready() {
    let store = MetadataStore::connect_lazy("postgres://localhost:1/tabularis").unwrap();

    assert!(!store.is_ready().await);
}

#[test]
fn lazy_connection_rejects_an_invalid_url() {
    assert!(MetadataStore::connect_lazy("not-a-postgres-url").is_err());
}
