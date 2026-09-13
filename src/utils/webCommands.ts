import { workspaceHttp } from '../transports/workspaceHttp';
import { webRequest, workspacePath } from './webApi';
import { setWebSession, type WebWorkspace } from './webSession';
import { webPostgresDriver } from './webDriver';

export const browserLocalCommands = new Set([
  'get_config', 'save_config', 'is_debug_mode', 'set_window_title', 'get_installation_source',
  'get_all_themes', 'get_keybindings', 'save_keybindings', 'log_frontend_event',
]);
interface QueryResult { columns: string[]; rows: unknown[][]; affected_rows?: number; has_more?: boolean }
interface SavedQueryDto { id: string; name: string; queryText: string; createdAt: string; updatedAt: string }
interface HistoryDto { id: string; connectionId: string; queryText: string; startedAt: string; durationMs: number | null; rowsAffected: number | null; status: string; errorCode: string | null; databaseName: string | null }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function literal(value: string): string { return `'${value.replace(/'/g, "''")}'`; }
function connectionPayload(args: Record<string, unknown>): Record<string, unknown> {
  const params = record(args.params);
  const driver = text(params.driver, 'postgres');
  if (!['postgres', 'postgresql'].includes(driver)) throw new Error('The web server supports PostgreSQL connections');
  if (params.ssh_enabled || params.k8s_enabled || params.startup_script) throw new Error('SSH, Kubernetes and startup scripts require the desktop application');
  if (args.read_only || args.readOnly) throw new Error('Per-connection read-only settings are not yet supported by the web API; use a Viewer workspace role');
  const credentials: Record<string, unknown> = {};
  if (typeof params.username === 'string') credentials.username = params.username;
  if (typeof params.password === 'string') credentials.password = params.password;
  // Send only documented connection parameters; never place credentials in public metadata.
  return {
    ...(args.name === undefined ? {} : { name: args.name }), driver,
    ...(args.params === undefined ? {} : { publicParams: {
      host: params.host, port: params.port, database: Array.isArray(params.database) ? params.database[0] : params.database,
      ssl: params.ssl_mode === 'disable' || params.ssl === false ? false : true,
    } }),
    ...(Object.keys(credentials).length && (args.id === undefined || typeof params.password === "string") ? { credentials } : {}),
    ...(args.environment === undefined ? {} : { environment: args.environment }),
  };
}
async function history(connectionId: string) {
  const rows = await webRequest<HistoryDto[]>(workspacePath('/query-history?limit=100'));
  return rows.filter(r => r.connectionId === connectionId).map(r => ({ id: r.id, sql: r.queryText, executedAt: r.startedAt,
    executionTimeMs: r.durationMs, rowsAffected: r.rowsAffected, status: r.status, error: r.errorCode, database: r.databaseName }));
}
export async function listWebWorkspaces(): Promise<WebWorkspace[]> {
  const values = await webRequest<Array<{ id: string; name: string; role?: WebWorkspace['role'] }>>('/api/v1/workspaces');
  return values.map(w => ({ ...w, role: w.role ?? 'viewer', is_personal: false }));
}
export async function invokeWebCommand(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const id = text(args.connectionId ?? args.connection_id ?? args.id);
  const schema = typeof args.schema === 'string' ? args.schema : undefined;
  switch (command) {
    case 'get_registered_drivers': return [webPostgresDriver];
    case 'get_driver_manifest': return workspaceHttp.getDriverManifest(text(args.driverId ?? args.driver));
    case 'get_installed_plugins': case 'fetch_plugin_registry': return [];
    case 'consume_pending_deep_link_install': return null;
    case 'check_for_updates': return null;
    case 'check_ai_key': case 'check_ai_key_status': return false;
    case 'get_ssh_connections': case 'get_k8s_connections': return [];
    case 'pin_register': case 'pin_login': {
      const result = await webRequest<{ token: string; tokenType: string; expiresAt: number; user: { id: string; username: string; recoveryEmail?: string } }>(
        `/api/v1/auth/pin/${command === 'pin_register' ? 'register' : 'login'}`, 'POST',
        { username: args.username, pin: args.pin, recoveryEmail: args.recovery_email });
      setWebSession(result.user.id, null);
      localStorage.setItem('tabularis_web_auth_change', crypto.randomUUID());
      return { ...result, token_type: result.tokenType, expires_at: result.expiresAt,
        user: { ...result.user, recovery_email: result.user.recoveryEmail } };
    }
    case 'pin_get_current_user': {
      const me = await webRequest<{ authenticated: boolean; userId: string; username: string | null }>('/api/v1/auth/pin/me');
      return { authenticated: true, token: null, user: { id: me.userId, username: me.username } };
    }
    case 'pin_logout': case 'logout_all':
      await webRequest(`/api/v1/auth/${command === 'logout_all' ? 'logout-all' : 'logout'}`, 'POST');
      setWebSession(null, null);
      localStorage.setItem('tabularis_web_auth_change', crypto.randomUUID());
      return;
    case 'pin_change':
      await webRequest('/api/v1/auth/pin/change', 'POST', { username: args.username, oldPin: args.old_pin, newPin: args.new_pin });
      setWebSession(null, null);
      localStorage.setItem('tabularis_web_auth_change', crypto.randomUUID());
      return;
    case 'list_workspaces': return listWebWorkspaces();
    case 'create_workspace': {
      const created = await webRequest<{ id: string }>('/api/v1/workspaces', 'POST', { name: args.name });
      const result = (await listWebWorkspaces()).find(w => w.id === created.id);
      if (!result) throw new Error('Created workspace could not be loaded');
      return result;
    }
    case 'get_workspace_members': {
      const members = await webRequest<Array<Record<string, unknown>>>(`/api/v1/workspaces/${encodeURIComponent(text(args.workspaceId))}/members`);
      return members.map(m => ({ workspace_id: m.workspaceId, user_id: m.userId, role: m.role, email: m.email, display_name: m.displayName, created_at: m.createdAt }));
    }
    case 'add_workspace_member': {
      const userId = text(args.userId ?? args.email);
      if (!userId.startsWith('usr_')) throw new Error('The web API requires the existing user ID (usr_…), available in their profile');
      return webRequest(`/api/v1/workspaces/${encodeURIComponent(text(args.workspaceId))}/members`, 'POST', { userId, role: args.role });
    }
    case 'remove_workspace_member': return webRequest(`/api/v1/workspaces/${encodeURIComponent(text(args.workspaceId))}/members/${encodeURIComponent(text(args.userId))}`, 'DELETE');
    case 'get_connections': return workspaceHttp.listConnections();
    case 'get_connections_with_groups': return workspaceHttp.listConnectionCatalogue();
    case 'save_connection': return webRequest(workspacePath('/connections'), 'POST', connectionPayload(args));
    case 'update_connection': return webRequest(workspaceHttp.connectionPath(id), 'PATCH', connectionPayload(args));
    case 'delete_connection': return webRequest(workspaceHttp.connectionPath(id), 'DELETE');
    case 'set_connection_appearance': workspaceHttp.savePreference(`appearance:${id}`, args.appearance); return;
    case 'list_connection_tags': return [];
    case 'set_connection_tags':
      if (Array.isArray(args.tagIds) && args.tagIds.length === 0) return;
      break;
    case 'get_connection_groups': return workspaceHttp.listConnectionGroups();
    case 'test_connection': {
      const savedId = text(record(args.request).connection_id);
      if (!savedId) throw new Error('Save the connection first, then connect to verify it against the workspace server');
      await workspaceHttp.listSchemas(savedId); return 'Connection successful';
    }
    case 'connect': case 'register_active_connection': return workspaceHttp.registerActiveConnection(id);
    case 'disconnect_connection': return workspaceHttp.disconnectConnection(id);
    case 'get_active_connections': return workspaceHttp.listActiveConnections();
    case 'get_last_open_connections': return workspaceHttp.preference('open', []);
    case 'get_last_active_connection': return workspaceHttp.preference('active', null);
    case 'set_last_open_connections': return workspaceHttp.setLastOpenConnections(args.connectionIds as string[]);
    case 'set_last_active_connection': return workspaceHttp.setLastActiveConnection(typeof args.connectionId === 'string' ? args.connectionId : null);
    case 'get_selected_schemas': return workspaceHttp.getSelectedSchemas(id);
    case 'get_schema_preference': return workspaceHttp.getSchemaPreference(id);
    case 'get_selected_databases': return workspaceHttp.preference(`databases:${id}`, []);
    case 'set_selected_schemas': return workspaceHttp.setSelectedSchemas(id, args.schemas as string[]);
    case 'set_schema_preference': return workspaceHttp.setSchemaPreference(id, text(args.schema));
    case 'set_selected_databases': return workspaceHttp.setSelectedDatabases(id, args.databases as string[]);
    case 'get_available_databases': case 'list_databases': return workspaceHttp.listAvailableDatabases(id);
    case 'get_schemas': return workspaceHttp.listSchemas(id);
    case 'get_tables': return workspaceHttp.listTables({ connectionId: id, schema });
    case 'get_views': return workspaceHttp.listViews({ connectionId: id, schema });
    case 'get_materialized_views': return workspaceHttp.listMaterializedViews({ connectionId: id, schema });
    case 'get_routines': return workspaceHttp.listRoutines({ connectionId: id, schema });
    case 'get_triggers': return workspaceHttp.listTriggers({ connectionId: id, schema });
    case 'execute_query': {
      const page = typeof args.page === 'number' ? Math.max(1, args.page) : 1;
      const limit = typeof args.limit === 'number' ? Math.min(10000, Math.max(1, args.limit)) : 10000;
      const result = await webRequest<QueryResult>(workspaceHttp.connectionPath(id, '/queries'), 'POST', { query: args.query, limit, page, schema });
      return { ...result, truncated: args.limit === undefined && result.has_more === true,
        pagination: { page, page_size: limit, total_rows: page === 1 && !result.has_more ? result.rows.length : null, has_more: result.has_more === true } };
    }
    case 'cancel_query': return webRequest(workspaceHttp.connectionPath(id, '/queries'), 'DELETE');
    case 'get_columns': {
      const table = text(args.tableName);
      const query = `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.is_identity,
        EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k
          ON tc.constraint_catalog = k.constraint_catalog AND tc.constraint_schema = k.constraint_schema AND tc.constraint_name = k.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND k.column_name = c.column_name) AS is_pk,
        c.is_generated FROM information_schema.columns c
        WHERE c.table_schema = ${literal(schema ?? 'public')} AND c.table_name = ${literal(table)} ORDER BY c.ordinal_position`;
      const result = await webRequest<QueryResult>(workspaceHttp.connectionPath(id, '/queries'), 'POST', { query, limit: 10000 });
      return result.rows.map(row => ({ name: row[0], data_type: row[1], is_nullable: row[2] === 'YES', default_value: row[3], is_auto_increment: row[4] === 'YES' || text(row[3]).startsWith('nextval('), is_pk: row[5] === 't', is_generated: row[6] === 'ALWAYS' }));
    }
    case 'get_foreign_keys': {
      const query = `SELECT tc.constraint_name, k.column_name, target.table_name, target.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage k ON tc.constraint_schema = k.constraint_schema AND tc.constraint_name = k.constraint_name
        JOIN information_schema.referential_constraints rc ON rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name
        JOIN information_schema.key_column_usage target ON target.constraint_schema = rc.unique_constraint_schema AND target.constraint_name = rc.unique_constraint_name AND target.ordinal_position = k.position_in_unique_constraint
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ${literal(schema ?? 'public')} AND tc.table_name = ${literal(text(args.tableName))}`;
      const result = await webRequest<QueryResult>(workspaceHttp.connectionPath(id, '/queries'), 'POST', { query, limit: 10000 });
      return result.rows.map(row => ({ name: row[0], column_name: row[1], ref_table: row[2], ref_column: row[3] }));
    }
    case 'get_saved_queries': {
      const queries = await webRequest<SavedQueryDto[]>(workspacePath('/saved-queries'));
      return queries.map(q => ({ id: q.id, name: q.name, sql: q.queryText, connection_id: id, database: null, created_at: q.createdAt, updated_at: q.updatedAt }));
    }
    case 'save_query': return webRequest(workspacePath('/saved-queries'), 'POST', { name: args.name, queryText: args.sql, isShared: false });
    case 'update_saved_query': return webRequest(workspacePath(`/saved-queries/${encodeURIComponent(text(args.id))}`), 'PATCH', { name: args.name, queryText: args.sql });
    case 'delete_saved_query': return webRequest(workspacePath(`/saved-queries/${encodeURIComponent(text(args.id))}`), 'DELETE');
    case 'get_query_history': return { entries: await history(id), recoveredBackupPath: null };
    case 'add_query_history_entry': {
      const entry = (await history(id)).find(e => e.sql === args.sql);
      if (!entry) throw new Error('The server has not recorded this query yet');
      return entry;
    }
    default: break;
  }
  throw new Error(`The command "${command}" is not supported by the web API`);
}
