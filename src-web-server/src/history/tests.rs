use super::models::{RecordQueryFinishInput, RecordQueryStartInput};
use super::repository::{MemoryQueryHistoryRepository, QueryHistoryRepository};

#[tokio::test]
async fn test_query_history_recording_and_filtering() {
    let repo = MemoryQueryHistoryRepository::new();

    // Start query 1 for user-a
    repo.record_start(RecordQueryStartInput {
        id: "qh-1".to_string(),
        workspace_id: "ws-1".to_string(),
        user_id: "user-a".to_string(),
        connection_id: Some("conn-1".to_string()),
        database_name: Some("postgres".to_string()),
        query_text: "SELECT 1".to_string(),
    })
    .await
    .unwrap();

    // Start query 2 for user-b
    repo.record_start(RecordQueryStartInput {
        id: "qh-2".to_string(),
        workspace_id: "ws-1".to_string(),
        user_id: "user-b".to_string(),
        connection_id: Some("conn-1".to_string()),
        database_name: Some("postgres".to_string()),
        query_text: "SELECT 2".to_string(),
    })
    .await
    .unwrap();

    // Finish query 1 successfully
    repo.record_finish(RecordQueryFinishInput {
        id: "qh-1".to_string(),
        status: "succeeded".to_string(),
        duration_ms: 45,
        rows_affected: Some(1),
        error_code: None,
    })
    .await
    .unwrap();

    // Finish query 2 with error
    repo.record_finish(RecordQueryFinishInput {
        id: "qh-2".to_string(),
        status: "failed".to_string(),
        duration_ms: 12,
        rows_affected: None,
        error_code: Some("syntax_error".to_string()),
    })
    .await
    .unwrap();

    // List for user-a only
    let history_user_a = repo
        .list_for_workspace("ws-1", Some("user-a"), 10, 0)
        .await
        .unwrap();
    assert_eq!(history_user_a.len(), 1);
    assert_eq!(history_user_a[0].id, "qh-1");
    assert_eq!(history_user_a[0].status, "succeeded");
    assert_eq!(history_user_a[0].duration_ms, Some(45));

    // List all for workspace (e.g. for Admin/Owner)
    let history_all = repo.list_for_workspace("ws-1", None, 10, 0).await.unwrap();
    assert_eq!(history_all.len(), 2);

    // List for other workspace -> empty
    let history_ws2 = repo.list_for_workspace("ws-2", None, 10, 0).await.unwrap();
    assert!(history_ws2.is_empty());
}
