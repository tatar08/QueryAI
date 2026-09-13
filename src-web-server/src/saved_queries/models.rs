use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub workspace_id: String,
    pub created_by: String,
    pub name: String,
    pub query_text: String,
    pub is_shared: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSavedQueryPayload {
    pub name: String,
    pub query_text: String,
    pub is_shared: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSavedQueryPayload {
    pub name: Option<String>,
    pub query_text: Option<String>,
    pub is_shared: Option<bool>,
}
