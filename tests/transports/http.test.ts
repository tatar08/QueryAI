import { describe, expect, it, vi } from 'vitest';

import type { SavedConnection } from '../../src/contexts/DatabaseContext';
import { HttpTransport, HttpTransportError } from '../../src/transports';

function connection(): SavedConnection {
  return {
    id: 'connection/with space',
    name: 'Production',
    params: {
      driver: 'postgres',
      database: 'app',
      password: 'must-not-cross-http-again',
    },
  };
}

describe('HttpTransport', () => {
  it('lists connections with the authenticated session cookie', async () => {
    const expected = [connection()];
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(expected));
    const transport = new HttpTransport({
      baseUrl: 'https://tabularis.example/',
      fetchImplementation,
    });

    await expect(transport.listConnections()).resolves.toEqual(expected);
    expect(fetchImplementation).toHaveBeenCalledOnce();

    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe('https://tabularis.example/api/v1/connections');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('include');
  });

  it('loads the grouped catalogue through the versioned API', async () => {
    const expected = {
      connections: [connection()],
      groups: [],
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(expected));
    const transport = new HttpTransport({ fetchImplementation });

    await expect(transport.listConnectionCatalogue()).resolves.toEqual(
      expected,
    );

    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe('/api/v1/connections?include=groups');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('include');
  });

  it('loads available databases from the connection-scoped endpoint', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(['app', 'analytics']));
    const transport = new HttpTransport({ fetchImplementation });

    await expect(
      transport.listAvailableDatabases('connection/with space'),
    ).resolves.toEqual(['app', 'analytics']);

    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe(
      '/api/v1/connections/connection%2Fwith%20space/databases',
    );
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('include');
  });

  it('loads schema resources through the versioned schema endpoint', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json([])));
    const transport = new HttpTransport({ fetchImplementation });
    const scope = {
      connectionId: 'connection/with space',
      schema: 'reporting & sales',
    };

    await transport.listSchemas(scope.connectionId);
    await transport.listTables(scope);
    await transport.listViews(scope);
    await transport.listMaterializedViews(scope);
    await transport.listRoutines(scope);
    await transport.listTriggers(scope);

    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/connections/connection%2Fwith%20space/schema?resource=schemas',
      '/api/v1/connections/connection%2Fwith%20space/schema?resource=tables&schema=reporting+%26+sales',
      '/api/v1/connections/connection%2Fwith%20space/schema?resource=views&schema=reporting+%26+sales',
      '/api/v1/connections/connection%2Fwith%20space/schema?resource=materialized_views&schema=reporting+%26+sales',
      '/api/v1/connections/connection%2Fwith%20space/schema?resource=routines&schema=reporting+%26+sales',
      '/api/v1/connections/connection%2Fwith%20space/schema?resource=triggers&schema=reporting+%26+sales',
    ]);
  });

  it('creates and lists connection groups through versioned routes', async () => {
    const group = {
      id: 'group/1',
      name: 'Cloud',
      collapsed: false,
      sort_order: 0,
      parent_id: null,
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(group))
      .mockResolvedValueOnce(Response.json(group))
      .mockResolvedValueOnce(Response.json([group]));
    const transport = new HttpTransport({
      fetchImplementation,
      getCsrfToken: () => 'csrf-token',
    });

    await transport.createConnectionGroup({
      name: 'Cloud',
      parentId: null,
    });
    await transport.createConnectionGroupPath({
      path: 'Cloud/Prod',
      parentId: 'group/1',
    });
    await expect(transport.listConnectionGroups()).resolves.toEqual([group]);

    expect(fetchImplementation.mock.calls.map(([url, init]) => ({
      url,
      method: init?.method,
      body: init?.body,
    }))).toEqual([
      {
        url: '/api/v1/connection-groups',
        method: 'POST',
        body: JSON.stringify({ name: 'Cloud', parentId: null }),
      },
      {
        url: '/api/v1/connection-groups/path',
        method: 'POST',
        body: JSON.stringify({ path: 'Cloud/Prod', parentId: 'group/1' }),
      },
      {
        url: '/api/v1/connection-groups',
        method: 'GET',
        body: undefined,
      },
    ]);
    expect(
      new Headers(fetchImplementation.mock.calls[0][1]?.headers).get(
        'content-type',
      ),
    ).toBe('application/json');
  });

  it('mutates and reorders groups without exposing ids in JSON paths', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );
    const transport = new HttpTransport({
      fetchImplementation,
      getCsrfToken: () => 'csrf-token',
    });
    const groupOrders: Array<[string, number]> = [['group/1', 0]];
    const connectionOrders: Array<[string, number]> = [['connection/1', 0]];

    await transport.updateConnectionGroup('group/1', { name: 'Production' });
    await transport.moveConnectionGroup('group/1', null);
    await transport.deleteConnectionGroup('group/1');
    await transport.moveConnectionToGroup('connection/1', 'group/1');
    await transport.reorderConnectionGroups(groupOrders);
    await transport.reorderConnections(connectionOrders);

    expect(fetchImplementation.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      init?.body,
    ])).toEqual([
      [
        '/api/v1/connection-groups/group%2F1',
        'PATCH',
        JSON.stringify({ name: 'Production' }),
      ],
      [
        '/api/v1/connection-groups/group%2F1',
        'PATCH',
        JSON.stringify({ parentId: null }),
      ],
      ['/api/v1/connection-groups/group%2F1', 'DELETE', undefined],
      [
        '/api/v1/connections/connection%2F1/group',
        'PATCH',
        JSON.stringify({ groupId: 'group/1' }),
      ],
      [
        '/api/v1/connection-groups/order',
        'PUT',
        JSON.stringify({ groupOrders }),
      ],
      [
        '/api/v1/connections/order',
        'PUT',
        JSON.stringify({ connectionOrders }),
      ],
    ]);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-token');
      expect(init?.credentials).toBe('include');
    }
  });

  it('loads manifests and manages connection sessions through versioned routes', async () => {
    const manifest = { id: 'postgres', capabilities: {} };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(manifest))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(['connection/1']));
    const transport = new HttpTransport({
      fetchImplementation,
      getCsrfToken: () => 'csrf-token',
    });

    await expect(transport.getDriverManifest('driver/1')).resolves.toEqual(
      manifest,
    );
    await transport.registerActiveConnection('connection/1');
    await transport.disconnectConnection('connection/1');
    await expect(transport.listActiveConnections()).resolves.toEqual([
      'connection/1',
    ]);

    expect(fetchImplementation.mock.calls.map(([url, init]) => [
      url,
      init?.method,
    ])).toEqual([
      ['/api/v1/drivers/driver%2F1/manifest', 'GET'],
      ['/api/v1/connections/connection%2F1/connect', 'POST'],
      ['/api/v1/connections/connection%2F1/session', 'DELETE'],
      ['/api/v1/connection-sessions', 'GET'],
    ]);
    expect(
      new Headers(fetchImplementation.mock.calls[1][1]?.headers).get(
        'x-csrf-token',
      ),
    ).toBe('csrf-token');
  });

  it('loads and saves connection-scoped database preferences', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json(['public']))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json('public'));
    const transport = new HttpTransport({
      fetchImplementation,
      getCsrfToken: () => 'csrf-token',
    });

    await transport.setSelectedDatabases('connection/1', ['app']);
    await transport.setSelectedSchemas('connection/1', ['public']);
    await expect(
      transport.getSelectedSchemas('connection/1'),
    ).resolves.toEqual(['public']);
    await transport.setSchemaPreference('connection/1', 'public');
    await expect(
      transport.getSchemaPreference('connection/1'),
    ).resolves.toBe('public');

    expect(fetchImplementation.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      init?.body,
    ])).toEqual([
      [
        '/api/v1/connections/connection%2F1/preferences/databases',
        'PUT',
        JSON.stringify({ databases: ['app'] }),
      ],
      [
        '/api/v1/connections/connection%2F1/preferences/schemas',
        'PUT',
        JSON.stringify({ schemas: ['public'] }),
      ],
      [
        '/api/v1/connections/connection%2F1/preferences/schemas',
        'GET',
        undefined,
      ],
      [
        '/api/v1/connections/connection%2F1/preferences/schema',
        'PUT',
        JSON.stringify({ schema: 'public' }),
      ],
      [
        '/api/v1/connections/connection%2F1/preferences/schema',
        'GET',
        undefined,
      ],
    ]);
  });

  it('persists browser session state and client events with CSRF', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );
    const transport = new HttpTransport({
      fetchImplementation,
      getCsrfToken: () => 'csrf-token',
    });

    await transport.setLastOpenConnections(['connection/1']);
    await transport.setLastActiveConnection(null);
    await transport.logClientEvent({
      level: 'warn',
      message: 'selection changed',
    });

    expect(fetchImplementation.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      init?.body,
    ])).toEqual([
      [
        '/api/v1/session/preferences/open-connections',
        'PUT',
        JSON.stringify({ connectionIds: ['connection/1'] }),
      ],
      [
        '/api/v1/session/preferences/active-connection',
        'PUT',
        JSON.stringify({ connectionId: null }),
      ],
      [
        '/api/v1/client-events',
        'POST',
        JSON.stringify({ level: 'warn', message: 'selection changed' }),
      ],
    ]);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-token');
      expect(new Headers(init?.headers).get('content-type')).toBe(
        'application/json',
      );
      expect(init?.credentials).toBe('include');
    }
  });

  it('tests a saved connection by id without resending credentials', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const transport = new HttpTransport({
      fetchImplementation,
      getCsrfToken: () => 'csrf-token',
    });

    await transport.testSavedConnection({ connection: connection() });

    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe('/api/v1/connections/connection%2Fwith%20space/test');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-token');
    expect(init?.credentials).toBe('include');
  });

  it('does not attach a csrf header to safe requests', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json([]));
    const transport = new HttpTransport({
      fetchImplementation,
      getCsrfToken: () => 'csrf-token',
    });

    await transport.listConnections();

    const [, init] = fetchImplementation.mock.calls[0];
    expect(new Headers(init?.headers).has('x-csrf-token')).toBe(false);
  });

  it('exposes structured server errors without losing the request id', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'connection_not_found',
            message: 'Connection not found',
            requestId: 'request-1',
          },
        },
        { status: 404 },
      ),
    );
    const transport = new HttpTransport({ fetchImplementation });

    const error = await transport
      .testSavedConnection({ connection: connection() })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(HttpTransportError);
    expect(error).toMatchObject({
      message: 'Connection not found',
      status: 404,
      code: 'connection_not_found',
      requestId: 'request-1',
    });
  });
});
