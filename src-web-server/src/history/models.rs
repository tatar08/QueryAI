use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryEntry {
    pub id: String,
    pub workspace_id: String,
    pub user_id: String,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub query_text: String,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub rows_affected: Option<i64>,
    pub error_code: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct RecordQueryStartInput {
    pub id: String,
    pub workspace_id: String,
    pub user_id: String,
    pub connection_id: Option<String>,
    pub database_name: Option<String>,
    pub query_text: String,
}

#[derive(Clone, Debug)]
pub struct RecordQueryFinishInput {
    pub id: String,
    pub status: String,
    pub duration_ms: i64,
    pub rows_affected: Option<i64>,
    pub error_code: Option<String>,
}
