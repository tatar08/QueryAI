import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeWebCommand, listWebWorkspaces } from '../../src/utils/webCommands';
import { getWebSession, setWebSession } from '../../src/utils/webSession';
import { webRequest } from '../../src/utils/webApi';
import { WorkspaceHttpTransport } from '../../src/transports/workspaceHttp';

const workspace = { id: 'ws/one', name: 'One', role: 'owner' as const, is_personal: false };
const fetcher = vi.fn<typeof fetch>();
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
beforeEach(() => {
  localStorage.clear(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher);
  setWebSession('alice', workspace);
});

describe('HTTP command integration', () => {
  it('uses the active workspace API for query execution and cancellation', async () => {
    fetcher.mockResolvedValueOnce(json({ columns: ['value'], rows: [['1']] })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await invokeWebCommand('execute_query', { connectionId: 'c/1', query: 'SELECT 1', page: 2, limit: 20 })).toMatchObject({ columns: ['value'], rows: [['1']] });
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/workspaces/ws%2Fone/connections/c%2F1/queries');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', method: 'POST', body: JSON.stringify({ query: 'SELECT 1', limit: 20, page: 2 }) });
    await invokeWebCommand('cancel_query', { connectionId: 'c/1' });
    expect(fetcher.mock.calls[1][1]?.method).toBe('DELETE');
  });
  it('never falls back to local mocks for unsupported commands', async () => {
    for (const command of ['pin_update_profile', 'get_pg_activity', 'generate_ai_query', 'delete_record']) {
      await expect(invokeWebCommand(command)).rejects.toThrow('not supported');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends credentials separately from public metadata', async () => {
    fetcher.mockResolvedValueOnce(json({ id: 'c1' }));
    await invokeWebCommand('save_connection', { name: 'DB', params: { driver: 'postgres', host: 'localhost', database: 'test', username: 'dbuser', password: 'secret', ssl_mode: 'disable', privateKey: 'must-not-leak' } });
    const body = JSON.parse(fetcher.mock.calls[0][1]?.body as string);
    expect(body.credentials).toEqual({ username: 'dbuser', password: 'secret' });
    expect(body.publicParams).toEqual({ host: 'localhost', database: 'test', ssl: false });
  });
  it('maps connection and schema responses to UI contracts', async () => {
    fetcher.mockResolvedValueOnce(json([{ id: 'c1', workspaceId: workspace.id, name: 'Database', driver: 'postgres', publicParams: { host: 'host', database: 'db' } }]))
      .mockResolvedValueOnce(json([{ name: 'public' }, { name: 'sales' }]));
    const transport = new WorkspaceHttpTransport(fetcher);
    expect((await transport.listConnectionCatalogue()).connections[0]).toMatchObject({ params: { driver: 'postgres', database: 'db' }, workspace_id: workspace.id });
    expect(await transport.listSchemas('c1')).toEqual(['public', 'sales']);
  });
  it('uses the authenticated membership role and fails closed when missing', async () => {
    fetcher.mockResolvedValueOnce(json([{ id: 'a', name: 'A', role: 'editor' }, { id: 'b', name: 'B' }]));
    expect((await listWebWorkspaces()).map(w => w.role)).toEqual(['editor', 'viewer']);
  });
  it('stores no browser JWT on login', async () => {
    setWebSession(null, null); localStorage.setItem('tabularis_jwt_token', 'old-mock');
    fetcher.mockResolvedValueOnce(json({ token: 'signed', tokenType: 'Bearer', expiresAt: 123, user: { id: 'alice', username: 'Alice' } }));
    await invokeWebCommand('pin_login', { username: 'Alice', pin: '839164' });
    expect(getWebSession().userId).toBe('alice');
    expect(localStorage.getItem('tabularis_jwt_token')).toBeNull();
  });
  it('keeps the session when logout fails and clears it after confirmation', async () => {
    fetcher.mockResolvedValueOnce(json({ message: 'Unavailable' }, 503)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(invokeWebCommand('pin_logout')).rejects.toThrow('Unavailable');
    expect(getWebSession().userId).toBe('alice');
    await invokeWebCommand('pin_logout'); expect(getWebSession().userId).toBeNull();
  });
  it('invalidates the UI session when authentication expires', async () => {
    fetcher.mockResolvedValueOnce(json({ message: 'Expired' }, 401));
    await expect(webRequest('/api/v1/auth/session')).rejects.toThrow('Expired');
    expect(getWebSession().workspace).toBeNull();
  });
  it('discards late responses after workspace changes', async () => {
    let finish!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = invokeWebCommand('execute_query', { connectionId: 'c1', query: 'SELECT 1' });
    setWebSession('alice', { ...workspace, id: 'two' }); finish(json({ rows: [['private']] }));
    await expect(pending).rejects.toThrow('workspace changed');
  });
  it('isolates preferences by user and workspace', async () => {
    const transport = new WorkspaceHttpTransport(fetcher);
    await transport.setSchemaPreference('same-id', 'private');
    setWebSession('alice', { ...workspace, id: 'two' }); expect(await transport.getSchemaPreference('same-id')).toBeNull();
    setWebSession('bob', workspace); expect(await transport.getSchemaPreference('same-id')).toBeNull();
    setWebSession('alice', workspace); expect(await transport.getSchemaPreference('same-id')).toBe('private');
  });
});
