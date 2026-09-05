use super::{create_saved_connection, remove_saved_connections, update_saved_connection};
use crate::models::{
    ConnectionAppearance, ConnectionParams, ConnectionsFile, IconOverride, SavedConnection,
};

fn saved_connection(id: &str) -> SavedConnection {
    SavedConnection {
        id: id.to_string(),
        name: "Original".to_string(),
        params: ConnectionParams::default(),
        group_id: Some("group-1".to_string()),
        sort_order: Some(2),
        detect_json_in_text_columns: Some(false),
        appearance: Some(ConnectionAppearance {
            accent_color: Some("#336699".to_string()),
            icon: Some(IconOverride::Emoji {
                value: "🦀".to_string(),
            }),
        }),
        tag_ids: Some(vec!["tag-1".to_string()]),
        environment: Some("development".to_string()),
    }
}

#[test]
fn new_connections_start_without_collection_metadata() {
    let connection = create_saved_connection(
        "connection-1".to_string(),
        "New".to_string(),
        ConnectionParams::default(),
        Some(true),
        Some("production".to_string()),
    );

    assert_eq!(connection.id, "connection-1");
    assert_eq!(connection.name, "New");
    assert_eq!(connection.group_id, None);
    assert_eq!(connection.sort_order, None);
    assert!(connection.appearance.is_none());
    assert_eq!(connection.tag_ids, None);
    assert_eq!(connection.detect_json_in_text_columns, Some(true));
    assert_eq!(connection.environment.as_deref(), Some("production"));
}

#[test]
fn updates_preserve_collection_metadata() {
    let existing = saved_connection("connection-1");
    let updated = update_saved_connection(
        &existing,
        "Updated".to_string(),
        ConnectionParams::default(),
        Some(true),
        Some("staging".to_string()),
    );

    assert_eq!(updated.id, existing.id);
    assert_eq!(updated.name, "Updated");
    assert_eq!(updated.group_id, existing.group_id);
    assert_eq!(updated.sort_order, existing.sort_order);
    let appearance = updated
        .appearance
        .as_ref()
        .expect("appearance should be preserved");
    assert_eq!(appearance.accent_color.as_deref(), Some("#336699"));
    assert!(matches!(
        &appearance.icon,
        Some(IconOverride::Emoji { value }) if value == "🦀"
    ));
    assert_eq!(updated.tag_ids, existing.tag_ids);
    assert_eq!(updated.detect_json_in_text_columns, Some(true));
    assert_eq!(updated.environment.as_deref(), Some("staging"));
}

#[test]
fn removal_returns_metadata_needed_by_the_adapter() {
    let expected = saved_connection("connection-1");
    let mut file = ConnectionsFile {
        groups: Vec::new(),
        connections: vec![expected.clone(), saved_connection("connection-2")],
        tags: Vec::new(),
    };

    let removed = remove_saved_connections(&mut file, "connection-1").unwrap();

    assert_eq!(removed.id, expected.id);
    assert_eq!(removed.group_id, expected.group_id);
    assert!(removed.appearance.is_some());
    assert_eq!(file.connections.len(), 1);
    assert_eq!(file.connections[0].id, "connection-2");
}

#[test]
fn removal_deletes_duplicate_ids_to_preserve_existing_behavior() {
    let mut file = ConnectionsFile {
        groups: Vec::new(),
        connections: vec![
            saved_connection("duplicate"),
            saved_connection("duplicate"),
            saved_connection("kept"),
        ],
        tags: Vec::new(),
    };

    let removed = remove_saved_connections(&mut file, "duplicate");

    assert!(removed.is_some());
    assert_eq!(file.connections.len(), 1);
    assert_eq!(file.connections[0].id, "kept");
}

#[test]
fn removal_of_an_unknown_id_is_a_no_op() {
    let mut file = ConnectionsFile {
        groups: Vec::new(),
        connections: vec![saved_connection("connection-1")],
        tags: Vec::new(),
    };

    let removed = remove_saved_connections(&mut file, "missing");

    assert!(removed.is_none());
    assert_eq!(file.connections.len(), 1);
}
