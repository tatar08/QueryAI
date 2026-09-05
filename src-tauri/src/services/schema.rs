use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::{ConnectionParams, RoutineInfo, TableInfo, TriggerInfo, ViewInfo};
use tabularis_core::{
    SchemaDiscoveryInput, SchemaDiscoveryScope, SchemaFuture, SchemaRepository, SchemaResource,
    SchemaService,
};

struct DriverSchemaRepository<'a> {
    driver: &'a dyn DatabaseDriver,
    params: &'a ConnectionParams,
}

impl SchemaRepository<String> for DriverSchemaRepository<'_> {
    fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, String> {
        Box::pin(async move {
            match scope.resource {
                SchemaResource::Databases => self.driver.get_databases(self.params).await,
                SchemaResource::Schemas => self.driver.get_schemas(self.params).await,
                _ => Err("Schema resource does not return a list of names".to_string()),
            }
        })
    }
}

impl SchemaRepository<TableInfo> for DriverSchemaRepository<'_> {
    fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, TableInfo> {
        Box::pin(async move {
            match scope.resource {
                SchemaResource::Tables => {
                    self.driver
                        .get_tables(self.params, scope.schema.as_deref())
                        .await
                }
                _ => Err("Schema resource does not return tables".to_string()),
            }
        })
    }
}

impl SchemaRepository<ViewInfo> for DriverSchemaRepository<'_> {
    fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, ViewInfo> {
        Box::pin(async move {
            match scope.resource {
                SchemaResource::Views => {
                    self.driver
                        .get_views(self.params, scope.schema.as_deref())
                        .await
                }
                SchemaResource::MaterializedViews => {
                    self.driver
                        .get_materialized_views(self.params, scope.schema.as_deref())
                        .await
                }
                _ => Err("Schema resource does not return views".to_string()),
            }
        })
    }
}

impl SchemaRepository<RoutineInfo> for DriverSchemaRepository<'_> {
    fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, RoutineInfo> {
        Box::pin(async move {
            match scope.resource {
                SchemaResource::Routines => {
                    self.driver
                        .get_routines(self.params, scope.schema.as_deref())
                        .await
                }
                _ => Err("Schema resource does not return routines".to_string()),
            }
        })
    }
}

impl SchemaRepository<TriggerInfo> for DriverSchemaRepository<'_> {
    fn discover<'a>(&'a self, scope: &'a SchemaDiscoveryScope) -> SchemaFuture<'a, TriggerInfo> {
        Box::pin(async move {
            match scope.resource {
                SchemaResource::Triggers => {
                    self.driver
                        .get_triggers(self.params, scope.schema.as_deref())
                        .await
                }
                _ => Err("Schema resource does not return triggers".to_string()),
            }
        })
    }
}

async fn discover_driver_resources<T: Send>(
    repository: &dyn SchemaRepository<T>,
    connection_id: String,
    resource: SchemaResource,
    schema: Option<String>,
) -> Result<Vec<T>, String> {
    SchemaService
        .discover(
            repository,
            SchemaDiscoveryInput {
                connection_id,
                resource,
                schema,
            },
        )
        .await
        .map_err(|error| error.to_string())
}

pub async fn discover_schema_names(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    connection_id: String,
    resource: SchemaResource,
) -> Result<Vec<String>, String> {
    discover_driver_resources(
        &DriverSchemaRepository { driver, params },
        connection_id,
        resource,
        None,
    )
    .await
}

pub async fn discover_tables(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    discover_driver_resources(
        &DriverSchemaRepository { driver, params },
        connection_id,
        SchemaResource::Tables,
        schema,
    )
    .await
}

pub async fn discover_views(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    connection_id: String,
    schema: Option<String>,
    materialized: bool,
) -> Result<Vec<ViewInfo>, String> {
    let resource = if materialized {
        SchemaResource::MaterializedViews
    } else {
        SchemaResource::Views
    };
    discover_driver_resources(
        &DriverSchemaRepository { driver, params },
        connection_id,
        resource,
        schema,
    )
    .await
}

pub async fn discover_routines(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<RoutineInfo>, String> {
    discover_driver_resources(
        &DriverSchemaRepository { driver, params },
        connection_id,
        SchemaResource::Routines,
        schema,
    )
    .await
}

pub async fn discover_triggers(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<TriggerInfo>, String> {
    discover_driver_resources(
        &DriverSchemaRepository { driver, params },
        connection_id,
        SchemaResource::Triggers,
        schema,
    )
    .await
}
