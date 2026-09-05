mod audit;
mod connection_crud;
mod connection_persistence;
mod connection_test;
mod query;
mod schema;

pub use audit::{record_mcp_audit, McpAuditRecord};
pub use connection_crud::{
    create_saved_connection, remove_saved_connections, update_saved_connection,
};
pub use connection_persistence::{
    persist_deleted_connection, persist_new_connection, persist_updated_connection,
    ConnectionCredentialStore, ConnectionRepository, DeleteConnectionResult, SaveConnectionInput,
    UpdateConnectionInput, UpdateConnectionResult,
};
pub use connection_test::test_driver_connection;
pub use query::execute_prepared_query;
pub use schema::{
    discover_routines, discover_schema_names, discover_tables, discover_triggers, discover_views,
};

#[cfg(test)]
mod audit_tests;

#[cfg(test)]
mod connection_crud_tests;

#[cfg(test)]
mod connection_persistence_tests;

#[cfg(test)]
mod connection_test_tests;

#[cfg(test)]
mod schema_tests;
