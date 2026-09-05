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

export interface TestSavedConnectionOptions {
  connection: SavedConnection;
  progressId?: string;
}

export interface SchemaScope {
  connectionId: string;
  schema?: string;
}

export interface CreateConnectionGroupOptions {
  name: string;
  parentId: string | null;
}

export interface CreateConnectionGroupPathOptions {
  path: string;
  parentId: string | null;
}

export interface ConnectionGroupUpdates {
  name?: string;
  collapsed?: boolean;
  sort_order?: number;
}

export type SortOrders = Array<[string, number]>;

export interface ClientLogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface BackendTransport {
  readonly kind: 'tauri' | 'http';

  listConnections(): Promise<SavedConnection[]>;

  listConnectionCatalogue(): Promise<ConnectionsFile>;

  testSavedConnection(options: TestSavedConnectionOptions): Promise<void>;

  listAvailableDatabases(connectionId: string): Promise<string[]>;

  listSchemas(connectionId: string): Promise<string[]>;

  listTables(scope: SchemaScope): Promise<TableInfo[]>;

  listViews(scope: SchemaScope): Promise<ViewInfo[]>;

  listMaterializedViews(scope: SchemaScope): Promise<ViewInfo[]>;

  listRoutines(scope: SchemaScope): Promise<RoutineInfo[]>;

  listTriggers(scope: SchemaScope): Promise<TriggerInfo[]>;

  createConnectionGroup(
    options: CreateConnectionGroupOptions,
  ): Promise<ConnectionGroup>;

  createConnectionGroupPath(
    options: CreateConnectionGroupPathOptions,
  ): Promise<ConnectionGroup>;

  listConnectionGroups(): Promise<ConnectionGroup[]>;

  updateConnectionGroup(
    id: string,
    updates: ConnectionGroupUpdates,
  ): Promise<void>;

  moveConnectionGroup(id: string, parentId: string | null): Promise<void>;

  deleteConnectionGroup(id: string): Promise<void>;

  moveConnectionToGroup(
    connectionId: string,
    groupId: string | null,
  ): Promise<void>;

  reorderConnectionGroups(groupOrders: SortOrders): Promise<void>;

  reorderConnections(connectionOrders: SortOrders): Promise<void>;

  getDriverManifest(driverId: string): Promise<PluginManifest | null>;

  registerActiveConnection(connectionId: string): Promise<void>;

  disconnectConnection(connectionId: string): Promise<void>;

  listActiveConnections(): Promise<string[]>;

  setSelectedDatabases(
    connectionId: string,
    databases: string[],
  ): Promise<void>;

  setSelectedSchemas(connectionId: string, schemas: string[]): Promise<void>;

  getSelectedSchemas(connectionId: string): Promise<string[]>;

  setSchemaPreference(connectionId: string, schema: string): Promise<void>;

  getSchemaPreference(connectionId: string): Promise<string | null>;

  setLastOpenConnections(connectionIds: string[]): Promise<void>;

  setLastActiveConnection(connectionId: string | null): Promise<void>;

  logClientEvent(event: ClientLogEvent): Promise<void>;
}
