use super::*;
use std::{collections::HashMap, sync::Mutex};

#[derive(Default)]
pub(crate) struct SessionRegistry(Mutex<HashMap<Vec<u8>, String>>);
impl SessionRepository for SessionRegistry {
    fn create<'a>(
        &'a self,
        _: &'a str,
        user_id: &'a str,
        hash: &'a [u8],
        _: i32,
    ) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            self.0.lock().unwrap().insert(hash.to_vec(), user_id.into());
            Ok(())
        })
    }
    fn resolve<'a>(&'a self, hash: &'a [u8]) -> SessionFuture<'a, Option<SessionPrincipal>> {
        Box::pin(async move {
            Ok(self.0.lock().unwrap().get(hash).map(|id| SessionPrincipal {
                user_id: id.clone(),
            }))
        })
    }
    fn revoke<'a>(&'a self, hash: &'a [u8]) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            self.0.lock().unwrap().remove(hash);
            Ok(())
        })
    }
    fn revoke_all_for_user<'a>(&'a self, id: &'a str) -> SessionFuture<'a, ()> {
        Box::pin(async move {
            self.0.lock().unwrap().retain(|_, user| user != id);
            Ok(())
        })
    }
}
