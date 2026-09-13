import type { BackendTransport, SchemaScope, TestSavedConnectionOptions, ClientLogEvent } from './backend';
import type { ConnectionGroup, ConnectionsFile, SavedConnection, TableInfo, ViewInfo, RoutineInfo, TriggerInfo } from '../contexts/DatabaseContext';
import { webRequest, workspacePath } from '../utils/webApi';
import { webScope } from '../utils/webSession';
import { webPostgresDriver } from '../utils/webDriver';

export interface WebConnection {
  id: string; name: string; workspaceId: string; driver: string;
  publicParams: SavedConnection['params'] & { ssl?: boolean };
  environment?: SavedConnection['environment'];
}

/** Browser display preferences are scoped by both authenticated identity and workspace. */
export class WorkspaceHttpTransport implements BackendTransport {
  readonly kind = 'http' as const;
  private readonly fetcher?: typeof fetch;
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher; }
  request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    return webRequest<T>(path, method, body, this.fetcher);
  }
  connectionPath(id: string, suffix = ''): string {
    return workspacePath(`/connections/${encodeURIComponent(id)}${suffix}`);
  }
  preference<T>(key: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(`tabularis_web_prefs:${webScope()}:${key}`) ?? 'null') as T ?? fallback; }
    catch { return fallback; }
  }
  savePreference(key: string, value: unknown): void {
    localStorage.setItem(`tabularis_web_prefs:${webScope()}:${key}`, JSON.stringify(value));
  }
  async listConnections(): Promise<SavedConnection[]> {
    const list = await this.request<WebConnection[]>(workspacePath('/connections'));
    return list.map(c => ({ id: c.id, name: c.name, params: { ...c.publicParams, driver: c.driver, ssl_mode: c.publicParams.ssl === false ? "disable" : "verify-full" },
      workspace_id: c.workspaceId, environment: c.environment, is_shared: true,
      appearance: this.preference(`appearance:${c.id}`, undefined),
    }));
  }
  async listConnectionCatalogue(): Promise<ConnectionsFile> { return { connections: await this.listConnections(), groups: [] }; }
  async testSavedConnection({ connection }: TestSavedConnectionOptions): Promise<void> { await this.listSchemas(connection.id); }
  async schema<T>(id: string, resource: string, schema?: string): Promise<T[]> {
    const query = new URLSearchParams({ resource });
    if (schema) query.set('schema', schema);
    return this.request(this.connectionPath(id, `/schema?${query}`));
  }
  async listAvailableDatabases(id: string): Promise<string[]> { return (await this.schema<{ name: string }>(id, 'databases')).map(x => x.name); }
  async listSchemas(id: string): Promise<string[]> { return (await this.schema<{ name: string }>(id, 'schemas')).map(x => x.name); }
  listTables({ connectionId, schema }: SchemaScope): Promise<TableInfo[]> { return this.schema(connectionId, 'tables', schema); }
  listViews({ connectionId, schema }: SchemaScope): Promise<ViewInfo[]> { return this.schema(connectionId, 'views', schema); }
  listMaterializedViews({ connectionId, schema }: SchemaScope): Promise<ViewInfo[]> { return this.schema(connectionId, 'materialized_views', schema); }
  listRoutines({ connectionId, schema }: SchemaScope): Promise<RoutineInfo[]> { return this.schema(connectionId, 'routines', schema); }
  listTriggers({ connectionId, schema }: SchemaScope): Promise<TriggerInfo[]> { return this.schema(connectionId, 'triggers', schema); }
  async getDriverManifest(id: string) { return id === 'postgres' || id === 'postgresql' ? webPostgresDriver : null; }
  async registerActiveConnection(id: string): Promise<void> { await this.request(this.connectionPath(id)); this.savePreference(`active:${id}`, true); }
  async disconnectConnection(id: string): Promise<void> { this.savePreference(`active:${id}`, false); }
  async listActiveConnections(): Promise<string[]> { return []; }
  async setSelectedDatabases(id: string, value: string[]): Promise<void> { this.savePreference(`databases:${id}`, value); }
  async setSelectedSchemas(id: string, value: string[]): Promise<void> { this.savePreference(`schemas:${id}`, value); }
  async getSelectedSchemas(id: string): Promise<string[]> { return this.preference(`schemas:${id}`, []); }
  async setSchemaPreference(id: string, value: string): Promise<void> { this.savePreference(`schema:${id}`, value); }
  async getSchemaPreference(id: string): Promise<string | null> { return this.preference(`schema:${id}`, null); }
  async setLastOpenConnections(value: string[]): Promise<void> { this.savePreference('open', value); }
  async setLastActiveConnection(value: string | null): Promise<void> { this.savePreference('active', value); }
  async logClientEvent(event: ClientLogEvent): Promise<void> { console[event.level](event.message); }
  async listConnectionGroups(): Promise<ConnectionGroup[]> { return []; }
  async createConnectionGroup(): Promise<ConnectionGroup> { throw new Error('Connection groups are not supported by the web API'); }
  async createConnectionGroupPath(): Promise<ConnectionGroup> { throw new Error('Connection groups are not supported by the web API'); }
  async updateConnectionGroup(): Promise<void> { throw new Error('Connection groups are not supported by the web API'); }
  async moveConnectionGroup(): Promise<void> { throw new Error('Connection groups are not supported by the web API'); }
  async deleteConnectionGroup(): Promise<void> { throw new Error('Connection groups are not supported by the web API'); }
  async moveConnectionToGroup(): Promise<void> { throw new Error('Connection groups are not supported by the web API'); }
  async reorderConnectionGroups(): Promise<void> { throw new Error('Connection ordering is not supported by the web API'); }
  async reorderConnections(): Promise<void> { throw new Error('Connection ordering is not supported by the web API'); }
}
export const workspaceHttp = new WorkspaceHttpTransport();
