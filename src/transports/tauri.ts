import { invoke } from '@tauri-apps/api/core';

import type {
  BackendTransport,
  ClientLogEvent,
  ConnectionGroupUpdates,
  CreateConnectionGroupOptions,
  CreateConnectionGroupPathOptions,
  SchemaScope,
  SortOrders,
  TestSavedConnectionOptions,
} from './backend';
import type {
  ConnectionGroup,
  ConnectionsFile,
  RoutineInfo,
  SavedConnection,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from '../contexts/DatabaseContext';
import type { PluginManifest } from '../types/plugins';

export type InvokeCommand = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

const invokeCommand: InvokeCommand = (command, args) =>
  args === undefined
    ? invoke(command)
    : invoke(command, args);

export class TauriTransport implements BackendTransport {
  readonly kind = 'tauri' as const;
  private readonly invokeBackend: InvokeCommand;

  constructor(invokeBackend: InvokeCommand = invokeCommand) {
    this.invokeBackend = invokeBackend;
  }

  listConnections(): Promise<SavedConnection[]> {
    return this.invokeBackend<SavedConnection[]>('get_connections');
  }

  listConnectionCatalogue(): Promise<ConnectionsFile> {
    return this.invokeBackend<ConnectionsFile>('get_connections_with_groups');
  }

  async testSavedConnection({
    connection,
    progressId,
  }: TestSavedConnectionOptions): Promise<void> {
    await this.invokeBackend<string>('test_connection', {
      request: {
        params: connection.params,
        connection_id: connection.id,
        ...(progressId === undefined
          ? {}
          : { progress_id: progressId }),
      },
    });
  }

  listAvailableDatabases(connectionId: string): Promise<string[]> {
    return this.invokeBackend<string[]>('get_available_databases', {
      connectionId,
    });
  }

  listSchemas(connectionId: string): Promise<string[]> {
    return this.invokeBackend<string[]>('get_schemas', { connectionId });
  }

  listTables(scope: SchemaScope): Promise<TableInfo[]> {
    return this.invokeBackend<TableInfo[]>('get_tables', { ...scope });
  }

  listViews(scope: SchemaScope): Promise<ViewInfo[]> {
    return this.invokeBackend<ViewInfo[]>('get_views', { ...scope });
  }

  listMaterializedViews(scope: SchemaScope): Promise<ViewInfo[]> {
    return this.invokeBackend<ViewInfo[]>('get_materialized_views', { ...scope });
  }

  listRoutines(scope: SchemaScope): Promise<RoutineInfo[]> {
    return this.invokeBackend<RoutineInfo[]>('get_routines', { ...scope });
  }

  listTriggers(scope: SchemaScope): Promise<TriggerInfo[]> {
    return this.invokeBackend<TriggerInfo[]>('get_triggers', { ...scope });
  }

  createConnectionGroup(
    options: CreateConnectionGroupOptions,
  ): Promise<ConnectionGroup> {
    return this.invokeBackend<ConnectionGroup>(
      'create_connection_group',
      { ...options },
    );
  }

  createConnectionGroupPath(
    options: CreateConnectionGroupPathOptions,
  ): Promise<ConnectionGroup> {
    return this.invokeBackend<ConnectionGroup>(
      'create_group_path',
      { ...options },
    );
  }

  listConnectionGroups(): Promise<ConnectionGroup[]> {
    return this.invokeBackend<ConnectionGroup[]>('get_connection_groups');
  }

  async updateConnectionGroup(
    id: string,
    updates: ConnectionGroupUpdates,
  ): Promise<void> {
    await this.invokeBackend('update_connection_group', { id, ...updates });
  }

  async moveConnectionGroup(
    id: string,
    parentId: string | null,
  ): Promise<void> {
    await this.invokeBackend('move_group_to_parent', { id, parentId });
  }

  async deleteConnectionGroup(id: string): Promise<void> {
    await this.invokeBackend('delete_connection_group', { id });
  }

  async moveConnectionToGroup(
    connectionId: string,
    groupId: string | null,
  ): Promise<void> {
    await this.invokeBackend('move_connection_to_group', {
      connectionId,
      groupId,
    });
  }

  async reorderConnectionGroups(groupOrders: SortOrders): Promise<void> {
    await this.invokeBackend('reorder_groups', { groupOrders });
  }

  async reorderConnections(connectionOrders: SortOrders): Promise<void> {
    await this.invokeBackend('reorder_connections_in_group', {
      connectionOrders,
    });
  }

  getDriverManifest(driverId: string): Promise<PluginManifest | null> {
    return this.invokeBackend<PluginManifest | null>('get_driver_manifest', {
      driverId,
    });
  }

  async registerActiveConnection(connectionId: string): Promise<void> {
    await this.invokeBackend('register_active_connection', { connectionId });
  }

  async disconnectConnection(connectionId: string): Promise<void> {
    await this.invokeBackend('disconnect_connection', { connectionId });
  }

  listActiveConnections(): Promise<string[]> {
    return this.invokeBackend<string[]>('get_active_connections');
  }

  async setSelectedDatabases(
    connectionId: string,
    databases: string[],
  ): Promise<void> {
    await this.invokeBackend('set_selected_databases', {
      connectionId,
      databases,
    });
  }

  async setSelectedSchemas(
    connectionId: string,
    schemas: string[],
  ): Promise<void> {
    await this.invokeBackend('set_selected_schemas', {
      connectionId,
      schemas,
    });
  }

  getSelectedSchemas(connectionId: string): Promise<string[]> {
    return this.invokeBackend<string[]>('get_selected_schemas', {
      connectionId,
    });
  }

  async setSchemaPreference(
    connectionId: string,
    schema: string,
  ): Promise<void> {
    await this.invokeBackend('set_schema_preference', {
      connectionId,
      schema,
    });
  }

  getSchemaPreference(connectionId: string): Promise<string | null> {
    return this.invokeBackend<string | null>('get_schema_preference', {
      connectionId,
    });
  }

  async setLastOpenConnections(connectionIds: string[]): Promise<void> {
    await this.invokeBackend('set_last_open_connections', { connectionIds });
  }

  async setLastActiveConnection(
    connectionId: string | null,
  ): Promise<void> {
    await this.invokeBackend('set_last_active_connection', { connectionId });
  }

  async logClientEvent(event: ClientLogEvent): Promise<void> {
    await this.invokeBackend('log_frontend_event', { ...event });
  }
}
