import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/utils/webSession', async importOriginal => ({ ...await importOriginal<typeof import('../../src/utils/webSession')>(), webMode: true }));
import { createInitialTabState, loadEditorPreferences, saveTabsToStorage } from '../../src/utils/editor';
import { setWebSession, webScope } from '../../src/utils/webSession';
const workspace = { id: 'one', name: 'One', role: 'owner' as const, is_personal: false };
beforeEach(() => { localStorage.clear(); setWebSession('alice', workspace); });
describe('web editor draft isolation', () => {
  it('restores SQL drafts without retaining query results', async () => {
    const scope = webScope();
    const tab = createInitialTabState('c1', { query: 'SELECT 1', result: { columns: ['secret'], rows: [['private-result']], affected_rows: 1 } });
    await saveTabsToStorage('c1', [tab], tab.id, scope);
    const restored = await loadEditorPreferences('c1', scope);
    expect(restored.tabs[0].query).toBe('SELECT 1');
    expect(restored.tabs[0].result).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('private-result');
  });
  it('does not expose another user or workspace draft', async () => {
    const scope = webScope();
    const tab = createInitialTabState('c1', { query: 'private SQL' });
    await saveTabsToStorage('c1', [tab], tab.id, scope);
    setWebSession('bob', workspace);
    expect((await loadEditorPreferences('c1', webScope())).tabs).toEqual([]);
    setWebSession('alice', { ...workspace, id: 'two' });
    expect((await loadEditorPreferences('c1', webScope())).tabs).toEqual([]);
  });
  it('rejects late saves from an old provider scope', async () => {
    const scope = webScope();
    const tab = createInitialTabState('c1', { query: 'Alice SQL' });
    setWebSession('bob', workspace);
    await saveTabsToStorage('c1', [tab], tab.id, scope);
    expect((await loadEditorPreferences('c1', webScope())).tabs).toEqual([]);
    expect(localStorage.getItem(`tabularis_web_drafts:${scope}:c1`)).toBeNull();
  });
});
