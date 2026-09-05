import { describe, expect, it, vi } from 'vitest';

import type { SavedConnection } from '../../src/contexts/DatabaseContext';
import { TauriTransport, type InvokeCommand } from '../../src/transports';

function connection(): SavedConnection {
  return {
    id: 'connection-1',
    name: 'Production',
    params: {
      driver: 'postgres',
      database: 'app',
      host: 'db.internal',
      password: 'runtime-secret',
    },
  };
}

describe('TauriTransport', () => {
  it('lists connections through the existing Tauri command', async () => {
    const expected = [connection()];
    const invoke = vi.fn<InvokeCommand>().mockResolvedValue(expected);
    const transport = new TauriTransport(invoke);

    await expect(transport.listConnections()).resolves.toEqual(expected);
    expect(invoke).toHaveBeenCalledWith('get_connections');
  });

  it('loads the connection catalogue through the grouped command', async () => {
    const expected = {
      connections: [connection()],
      groups: [],
    };
    const invoke = vi.fn<InvokeCommand>().mockResolvedValue(expected);
    const transport = new TauriTransport(invoke);

    await expect(transport.listConnectionCatalogue()).resolves.toEqual(expected);
    expect(invoke).toHaveBeenCalledWith('get_connections_with_groups');
  });

  it('maps schema discovery methods to the existing Tauri commands', async () => {
    const invoke = vi.fn<InvokeCommand>().mockResolvedValue([]);
    const transport = new TauriTransport(invoke);
    const scope = { connectionId: 'connection-1', schema: 'reporting' };

    await transport.listAvailableDatabases(scope.connectionId);
    await transport.listSchemas(scope.connectionId);
    await transport.listTables(scope);
    await transport.listViews(scope);
    await transport.listMaterializedViews(scope);
    await transport.listRoutines(scope);
    await transport.listTriggers(scope);

    expect(invoke.mock.calls).toEqual([
      ['get_available_databases', { connectionId: 'connection-1' }],
      ['get_schemas', { connectionId: 'connection-1' }],
      ['get_tables', scope],
      ['get_views', scope],
      ['get_materialized_views', scope],
      ['get_routines', scope],
      ['get_triggers', scope],
    ]);
  });

  it('maps connection group methods to the existing Tauri commands', async () => {
    const invoke = vi.fn<InvokeCommand>().mockResolvedValue([]);
    const transport = new TauriTransport(invoke);
    const parentId = 'parent-1';
    const groupOrders: Array<[string, number]> = [['group-1', 0]];
    const connectionOrders: Array<[string, number]> = [['connection-1', 0]];

    await transport.createConnectionGroup({ name: 'Cloud', parentId });
    await transport.createConnectionGroupPath({ path: 'Cloud/Prod', parentId });
    await transport.listConnectionGroups();
    await transport.updateConnectionGroup('group-1', {
      name: 'Production',
      collapsed: true,
    });
    await transport.moveConnectionGroup('group-1', null);
    await transport.deleteConnectionGroup('group-1');
    await transport.moveConnectionToGroup('connection-1', 'group-1');
    await transport.reorderConnectionGroups(groupOrders);
    await transport.reorderConnections(connectionOrders);

    expect(invoke.mock.calls).toEqual([
      ['create_connection_group', { name: 'Cloud', parentId }],
      ['create_group_path', { path: 'Cloud/Prod', parentId }],
      ['get_connection_groups'],
      [
        'update_connection_group',
        { id: 'group-1', name: 'Production', collapsed: true },
      ],
      ['move_group_to_parent', { id: 'group-1', parentId: null }],
      ['delete_connection_group', { id: 'group-1' }],
      [
        'move_connection_to_group',
        { connectionId: 'connection-1', groupId: 'group-1' },
      ],
      ['reorder_groups', { groupOrders }],
      ['reorder_connections_in_group', { connectionOrders }],
    ]);
  });

  it('maps session and preference methods to existing Tauri commands', async () => {
    const invoke = vi.fn<InvokeCommand>().mockResolvedValue([]);
    const transport = new TauriTransport(invoke);

    await transport.getDriverManifest('postgres');
    await transport.registerActiveConnection('connection-1');
    await transport.disconnectConnection('connection-1');
    await transport.listActiveConnections();
    await transport.setSelectedDatabases('connection-1', ['app']);
    await transport.setSelectedSchemas('connection-1', ['public']);
    await transport.getSelectedSchemas('connection-1');
    await transport.setSchemaPreference('connection-1', 'public');
    await transport.getSchemaPreference('connection-1');
    await transport.setLastOpenConnections(['connection-1']);
    await transport.setLastActiveConnection(null);
    await transport.logClientEvent({ level: 'warn', message: 'selection changed' });

    expect(invoke.mock.calls).toEqual([
      ['get_driver_manifest', { driverId: 'postgres' }],
      ['register_active_connection', { connectionId: 'connection-1' }],
      ['disconnect_connection', { connectionId: 'connection-1' }],
      ['get_active_connections'],
      [
        'set_selected_databases',
        { connectionId: 'connection-1', databases: ['app'] },
      ],
      [
        'set_selected_schemas',
        { connectionId: 'connection-1', schemas: ['public'] },
      ],
      ['get_selected_schemas', { connectionId: 'connection-1' }],
      [
        'set_schema_preference',
        { connectionId: 'connection-1', schema: 'public' },
      ],
      ['get_schema_preference', { connectionId: 'connection-1' }],
      ['set_last_open_connections', { connectionIds: ['connection-1'] }],
      ['set_last_active_connection', { connectionId: null }],
      [
        'log_frontend_event',
        { level: 'warn', message: 'selection changed' },
      ],
    ]);
  });

  it('keeps the existing test_connection request shape', async () => {
    const invoke = vi.fn<InvokeCommand>().mockResolvedValue('ok');
    const transport = new TauriTransport(invoke);
    const saved = connection();

    await transport.testSavedConnection({
      connection: saved,
      progressId: 'progress-1',
    });

    expect(invoke).toHaveBeenCalledWith('test_connection', {
      request: {
        params: saved.params,
        connection_id: saved.id,
        progress_id: 'progress-1',
      },
    });
  });
});
