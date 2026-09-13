use std::sync::Mutex;

use super::*;

#[derive(Default)]
struct MemorySessionRepository {
    created: Mutex<Option<(String, String, Vec<u8>, i32)>>,
    principal: Mutex<Option<SessionPrincipal>>,
    revoked_hash: Mutex<Option<Vec<u8>>>,
}

impl SessionRepository for MemorySessionRepository {
    fn create<'a>(
        &'a self,
        session_id: &'a str,
        user_id: &'a str,
        token_hash: &'a [u8],
        ttl_seconds: i32,
    ) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            *self.created.lock().unwrap() = Some((
                session_id.to_string(),
                user_id.to_string(),
                token_hash.to_vec(),
                ttl_seconds,
            ));
            Ok(())
        })
    }

    fn resolve<'a>(&'a self, _token_hash: &'a [u8]) -> SessionFuture<'a, Option<SessionPrincipal>> {
        Box::pin(async move { Ok(self.principal.lock().unwrap().clone()) })
    }

    fn revoke<'a>(&'a self, token_hash: &'a [u8]) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            *self.revoked_hash.lock().unwrap() = Some(token_hash.to_vec());
            Ok(())
        })
    }

    fn revoke_all_for_user<'a>(&'a self, _user_id: &'a str) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            *self.principal.lock().unwrap() = None;
            Ok(())
        })
    }
}

#[tokio::test]
async fn issued_session_uses_an_opaque_cookie_and_stores_only_its_hash() {
    let repository = Arc::new(MemorySessionRepository::default());
    let service = AuthService::new(repository.clone(), 3_600, true);

    let (principal, cookie) = service.issue("user-1").await.unwrap();
    let token = session_token(Some(&cookie)).unwrap();
    let created = repository.created.lock().unwrap().clone().unwrap();

    assert_eq!(principal.user_id, "user-1");
    assert_eq!(created.1, "user-1");
    assert_eq!(created.2, hash_token(token));
    assert_ne!(created.2, token.as_bytes());
    assert_eq!(created.3, 3_600);
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
    assert!(cookie.contains("Secure"));
}

#[tokio::test]
async fn authentication_rejects_missing_and_unknown_sessions() {
    let repository = Arc::new(MemorySessionRepository::default());
    let service = AuthService::new(repository, 3_600, false);

    assert_eq!(
        service.authenticate(None).await,
        Err(AuthenticationError::Missing)
    );
    assert_eq!(
        service
            .authenticate(Some("tabularis_session=unknown"))
            .await,
        Err(AuthenticationError::Invalid)
    );
}

#[tokio::test]
async fn logout_revokes_the_hashed_token_and_expires_the_cookie() {
    let repository = Arc::new(MemorySessionRepository::default());
    let service = AuthService::new(repository.clone(), 3_600, true);

    let cookie = service
        .logout(Some("theme=dark; tabularis_session=secret-token"))
        .await
        .unwrap();

    assert_eq!(
        repository.revoked_hash.lock().unwrap().as_deref(),
        Some(hash_token("secret-token").as_slice())
    );
    assert!(cookie.contains("Max-Age=0"));
    assert!(cookie.contains("Secure"));
}
