import { describe, expect, it, vi } from 'vitest';
import {
  BrowserWindowTitleAdapter,
  TauriWindowTitleAdapter,
  createWindowTitleAdapter,
  type SetWindowTitleCommand,
} from '../../src/platform';

describe('window title platform adapters', () => {
  it('delegates desktop title changes to the Tauri command', async () => {
    const command = vi.fn<SetWindowTitleCommand>().mockResolvedValue(undefined);
    const adapter = new TauriWindowTitleAdapter(command);

    await adapter.setTitle('tabularis - Production');

    expect(command).toHaveBeenCalledOnce();
    expect(command).toHaveBeenCalledWith('tabularis - Production');
  });

  it('updates document.title in browser mode', async () => {
    const documentTarget = { title: 'old title' };
    const adapter = new BrowserWindowTitleAdapter(documentTarget);

    await adapter.setTitle('tabularis - Browser');

    expect(documentTarget.title).toBe('tabularis - Browser');
  });

  it('selects an adapter from the backend mode', () => {
    const command = vi.fn<SetWindowTitleCommand>().mockResolvedValue(undefined);
    const documentTarget = { title: '' };

    expect(createWindowTitleAdapter({ mode: 'tauri', setWindowTitleCommand: command }))
      .toBeInstanceOf(TauriWindowTitleAdapter);
    expect(createWindowTitleAdapter({ mode: 'http', documentTarget }))
      .toBeInstanceOf(BrowserWindowTitleAdapter);
  });
});
