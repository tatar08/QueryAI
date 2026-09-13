use crate::models::{ConnectionParams, ConnectionsFile, SavedConnection};

pub fn create_saved_connection(
    id: String,
    name: String,
    params: ConnectionParams,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
    read_only: Option<bool>,
) -> SavedConnection {
    SavedConnection {
        id,
        name,
        params,
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns,
        appearance: None,
        tag_ids: None,
        environment,
        read_only,
    }
}

pub fn update_saved_connection(
    existing: &SavedConnection,
    name: String,
    params: ConnectionParams,
    detect_json_in_text_columns: Option<bool>,
    environment: Option<String>,
    read_only: Option<bool>,
) -> SavedConnection {
    SavedConnection {
        id: existing.id.clone(),
        name,
        params,
        group_id: existing.group_id.clone(),
        sort_order: existing.sort_order,
        detect_json_in_text_columns,
        appearance: existing.appearance.clone(),
        tag_ids: existing.tag_ids.clone(),
        environment,
        read_only: read_only.or(existing.read_only),
    }
}

/// Removes every record matching `id` while returning the first removed
/// record so adapters can clean up credentials and related resources.
pub fn remove_saved_connections(file: &mut ConnectionsFile, id: &str) -> Option<SavedConnection> {
    let removed = file
        .connections
        .iter()
        .find(|connection| connection.id == id)
        .cloned();
    file.connections.retain(|connection| connection.id != id);
    removed
}
