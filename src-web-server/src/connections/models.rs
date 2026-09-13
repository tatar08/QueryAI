use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub driver: String,
    pub public_params: Value,
    pub environment: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConnectionPayload {
    pub name: String,
    pub driver: String,
    pub public_params: Option<Value>,
    pub environment: Option<String>,
    pub credentials: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectionPayload {
    pub name: Option<String>,
    pub driver: Option<String>,
    pub public_params: Option<Value>,
    pub environment: Option<String>,
    pub credentials: Option<Value>,
}
