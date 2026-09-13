use super::repository::{MemorySavedQueryRepository, SavedQueryRepository};

#[tokio::test]
async fn test_saved_query_lifecycle_and_sharing() {
    let repo = MemorySavedQueryRepository::new();

    // User A creates private query
    let q1 = repo
        .create(
            "sq-1",
            "ws-1",
            "user-a",
            "My Private Query",
            "SELECT 1",
            false,
        )
        .await
        .unwrap();
    assert_eq!(q1.name, "My Private Query");
    assert!(!q1.is_shared);

    // User A creates shared query
    let q2 = repo
        .create(
            "sq-2",
            "ws-1",
            "user-a",
            "Team Query",
            "SELECT * FROM accounts",
            true,
        )
        .await
        .unwrap();
    assert!(q2.is_shared);

    // Duplicate name for user A in ws-1 should fail
    assert!(repo
        .create(
            "sq-3",
            "ws-1",
            "user-a",
            "My Private Query",
            "SELECT 2",
            false
        )
        .await
        .is_err());

    // User B in ws-1 can create query with same name as user A's private query
    assert!(repo
        .create(
            "sq-4",
            "ws-1",
            "user-b",
            "My Private Query",
            "SELECT 3",
            false
        )
        .await
        .is_ok());

    // User B in ws-1 lists queries: should see own queries + User A's shared query, but NOT User A's private query
    let user_b_queries = repo.list_for_user("ws-1", "user-b").await.unwrap();
    let ids: Vec<String> = user_b_queries.into_iter().map(|q| q.id).collect();
    assert!(ids.contains(&"sq-4".to_string()));
    assert!(ids.contains(&"sq-2".to_string())); // Shared
    assert!(!ids.contains(&"sq-1".to_string())); // Private to user A

    // User in ws-2 sees nothing from ws-1
    let ws2_queries = repo.list_for_user("ws-2", "user-a").await.unwrap();
    assert!(ws2_queries.is_empty());

    // Update query
    let updated = repo
        .update(
            "ws-1",
            "sq-2",
            Some("Updated Team Query"),
            None,
            Some(false),
        )
        .await
        .unwrap();
    assert_eq!(updated.name, "Updated Team Query");
    assert!(!updated.is_shared);

    // Delete query
    repo.delete("ws-1", "sq-1").await.unwrap();
    assert!(repo.get_by_id("ws-1", "sq-1").await.unwrap().is_none());
}
