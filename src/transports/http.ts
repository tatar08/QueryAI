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

interface HttpErrorPayload {
  code?: string;
  message?: string;
  requestId?: string;
}

export interface HttpTransportOptions {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  getCsrfToken?: () => string | undefined;
  getWorkspaceId?: () => string | undefined;
}

export class HttpTransportError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    requestId?: string,
  ) {
    super(message);
    this.name = 'HttpTransportError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function parseErrorPayload(value: unknown): HttpErrorPayload {
  if (!isRecord(value)) return {};
  const error = isRecord(value.error) ? value.error : value;
  return {
    code: readString(error, 'code'),
    message: readString(error, 'message'),
    requestId:
      readString(error, 'requestId') ?? readString(error, 'request_id'),
  };
}

export class HttpTransport implements BackendTransport {
  readonly kind = 'http' as const;

  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly getCsrfToken?: () => string | undefined;
  private readonly getWorkspaceId?: () => string | undefined;

  constructor(options: HttpTransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.getCsrfToken = options.getCsrfToken;
    this.getWorkspaceId = options.getWorkspaceId;
  }

  private getWorkspacePrefix(): string | undefined {
    const wsId = this.getWorkspaceId?.();
    return wsId ? `/api/v1/workspaces/${encodeURIComponent(wsId)}` : undefined;
  }

  async listConnections(): Promise<SavedConnection[]> {
    const prefix = this.getWorkspacePrefix();
    const endpoint = prefix ? `${prefix}/connections` : '/api/v1/connections';
    const response = await this.request(endpoint, {
      method: 'GET',
    });
    return response.json() as Promise<SavedConnection[]>;
  }

  async listConnectionCatalogue(): Promise<ConnectionsFile> {
    const prefix = this.getWorkspacePrefix();
    const endpoint = prefix
      ? `${prefix}/connections`
      : '/api/v1/connections?include=groups';
    const response = await this.request(endpoint, {
      method: 'GET',
    });
    const data = await response.json();
    if (prefix && Array.isArray(data)) {
      return { connections: data, groups: [] };
    }
    return data as ConnectionsFile;
  }

  async testSavedConnection({
    connection,
  }: TestSavedConnectionOptions): Promise<void> {
    const prefix = this.getWorkspacePrefix();
    const endpoint = prefix
      ? `${prefix}/connections/${encodeURIComponent(connection.id)}/schema?resource=schemas`
      : `/api/v1/connections/${encodeURIComponent(connection.id)}/test`;
    await this.request(endpoint, {
      method: prefix ? 'GET' : 'POST',
    });
  }

  async listAvailableDatabases(connectionId: string): Promise<string[]> {
    const prefix = this.getWorkspacePrefix();
    if (prefix) {
      const items = await this.listSchemaResource<{ name: string }>(
        connectionId,
        'databases',
      );
      return items.map((i) => i.name ?? (i as unknown as string));
    }
    const response = await this.request(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/databases`,
      { method: 'GET' },
    );
    return response.json() as Promise<string[]>;
  }

  listSchemas(connectionId: string): Promise<string[]> {
    return this.listSchemaResource<string>(connectionId, 'schemas');
  }

  listTables(scope: SchemaScope): Promise<TableInfo[]> {
    return this.listSchemaResource<TableInfo>(
      scope.connectionId,
      'tables',
      scope.schema,
    );
  }

  listViews(scope: SchemaScope): Promise<ViewInfo[]> {
    return this.listSchemaResource<ViewInfo>(
      scope.connectionId,
      'views',
      scope.schema,
    );
  }

  listMaterializedViews(scope: SchemaScope): Promise<ViewInfo[]> {
    return this.listSchemaResource<ViewInfo>(
      scope.connectionId,
      'materialized_views',
      scope.schema,
    );
  }

  listRoutines(scope: SchemaScope): Promise<RoutineInfo[]> {
    return this.listSchemaResource<RoutineInfo>(
      scope.connectionId,
      'routines',
      scope.schema,
    );
  }

  listTriggers(scope: SchemaScope): Promise<TriggerInfo[]> {
    return this.listSchemaResource<TriggerInfo>(
      scope.connectionId,
      'triggers',
      scope.schema,
    );
  }

  private async listSchemaResource<T>(
    connectionId: string,
    resource: string,
    schema?: string,
  ): Promise<T[]> {
    const query = new URLSearchParams({ resource });
    if (schema !== undefined) query.set('schema', schema);
    const prefix = this.getWorkspacePrefix();
    const endpoint = prefix
      ? `${prefix}/connections/${encodeURIComponent(connectionId)}/schema?${query.toString()}`
      : `/api/v1/connections/${encodeURIComponent(connectionId)}/schema?${query.toString()}`;
    const response = await this.request(endpoint, { method: 'GET' });
    return response.json() as Promise<T[]>;
  }

  async createConnectionGroup(
    options: CreateConnectionGroupOptions,
  ): Promise<ConnectionGroup> {
    const response = await this.requestJson(
      '/api/v1/connection-groups',
      'POST',
      options,
    );
    return response.json() as Promise<ConnectionGroup>;
  }

  async createConnectionGroupPath(
    options: CreateConnectionGroupPathOptions,
  ): Promise<ConnectionGroup> {
    const response = await this.requestJson(
      '/api/v1/connection-groups/path',
      'POST',
      options,
    );
    return response.json() as Promise<ConnectionGroup>;
  }

  async listConnectionGroups(): Promise<ConnectionGroup[]> {
    const response = await this.request('/api/v1/connection-groups', {
      method: 'GET',
    });
    return response.json() as Promise<ConnectionGroup[]>;
  }

  async updateConnectionGroup(
    id: string,
    updates: ConnectionGroupUpdates,
  ): Promise<void> {
    await this.requestJson(
      `/api/v1/connection-groups/${encodeURIComponent(id)}`,
      'PATCH',
      updates,
    );
  }

  async moveConnectionGroup(
    id: string,
    parentId: string | null,
  ): Promise<void> {
    await this.requestJson(
      `/api/v1/connection-groups/${encodeURIComponent(id)}`,
      'PATCH',
      { parentId },
    );
  }

  async deleteConnectionGroup(id: string): Promise<void> {
    await this.request(
      `/api/v1/connection-groups/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  async moveConnectionToGroup(
    connectionId: string,
    groupId: string | null,
  ): Promise<void> {
    await this.requestJson(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/group`,
      'PATCH',
      { groupId },
    );
  }

  async reorderConnectionGroups(groupOrders: SortOrders): Promise<void> {
    await this.requestJson(
      '/api/v1/connection-groups/order',
      'PUT',
      { groupOrders },
    );
  }

  async reorderConnections(connectionOrders: SortOrders): Promise<void> {
    await this.requestJson(
      '/api/v1/connections/order',
      'PUT',
      { connectionOrders },
    );
  }

  async getDriverManifest(driverId: string): Promise<PluginManifest | null> {
    const response = await this.request(
      `/api/v1/drivers/${encodeURIComponent(driverId)}/manifest`,
      { method: 'GET' },
    );
    return response.json() as Promise<PluginManifest | null>;
  }

  async registerActiveConnection(connectionId: string): Promise<void> {
    await this.request(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/connect`,
      { method: 'POST' },
    );
  }

  async disconnectConnection(connectionId: string): Promise<void> {
    await this.request(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/session`,
      { method: 'DELETE' },
    );
  }

  async listActiveConnections(): Promise<string[]> {
    const response = await this.request('/api/v1/connection-sessions', {
      method: 'GET',
    });
    return response.json() as Promise<string[]>;
  }

  async setSelectedDatabases(
    connectionId: string,
    databases: string[],
  ): Promise<void> {
    await this.requestJson(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/preferences/databases`,
      'PUT',
      { databases },
    );
  }

  async setSelectedSchemas(
    connectionId: string,
    schemas: string[],
  ): Promise<void> {
    await this.requestJson(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/preferences/schemas`,
      'PUT',
      { schemas },
    );
  }

  async getSelectedSchemas(connectionId: string): Promise<string[]> {
    const response = await this.request(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/preferences/schemas`,
      { method: 'GET' },
    );
    return response.json() as Promise<string[]>;
  }

  async setSchemaPreference(
    connectionId: string,
    schema: string,
  ): Promise<void> {
    await this.requestJson(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/preferences/schema`,
      'PUT',
      { schema },
    );
  }

  async getSchemaPreference(connectionId: string): Promise<string | null> {
    const response = await this.request(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/preferences/schema`,
      { method: 'GET' },
    );
    return response.json() as Promise<string | null>;
  }

  async setLastOpenConnections(connectionIds: string[]): Promise<void> {
    await this.requestJson(
      '/api/v1/session/preferences/open-connections',
      'PUT',
      { connectionIds },
    );
  }

  async setLastActiveConnection(
    connectionId: string | null,
  ): Promise<void> {
    await this.requestJson(
      '/api/v1/session/preferences/active-connection',
      'PUT',
      { connectionId },
    );
  }

  async logClientEvent(event: ClientLogEvent): Promise<void> {
    await this.requestJson('/api/v1/client-events', 'POST', event);
  }

  private requestJson(
    path: string,
    method: string,
    body: unknown,
  ): Promise<Response> {
    return this.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');

    const csrfToken = this.getCsrfToken?.();
    if (csrfToken && init.method !== 'GET' && init.method !== 'HEAD') {
      headers.set('x-csrf-token', csrfToken);
    }

    const response = await this.fetchImplementation(
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers,
        credentials: 'include',
      },
    );

    if (response.ok) return response;

    const payload: unknown = await response.json().catch(() => null);
    const error = parseErrorPayload(payload);
    throw new HttpTransportError(
      error.message ?? `Request failed with status ${response.status}`,
      response.status,
      error.code,
      error.requestId,
    );
  }
}
