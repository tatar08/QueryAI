use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::{ConnectionParams, QueryResult};
use tabularis_core::{QueryExecutionScope, QueryFuture, QueryRepository, QueryService};

struct DriverQueryRepository<'a> {
    driver: &'a dyn DatabaseDriver,
    params: &'a ConnectionParams,
}

impl QueryRepository<QueryResult> for DriverQueryRepository<'_> {
    fn execute<'a>(&'a self, scope: &'a QueryExecutionScope) -> QueryFuture<'a, QueryResult> {
        Box::pin(async move {
            self.driver
                .execute_query(
                    self.params,
                    &scope.query,
                    scope.limit,
                    scope.page,
                    scope.schema.as_deref(),
                )
                .await
        })
    }
}

pub async fn execute_prepared_query(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    scope: &QueryExecutionScope,
) -> Result<QueryResult, String> {
    QueryService
        .execute_prepared(&DriverQueryRepository { driver, params }, scope)
        .await
        .map_err(|error| error.to_string())
}
