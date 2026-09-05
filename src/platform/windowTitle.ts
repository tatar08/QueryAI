import { invoke } from '@tauri-apps/api/core';
import type { BackendTransportMode } from '../transports/factory';

export interface WindowTitleAdapter {
  setTitle(title: string): Promise<void>;
}

export type SetWindowTitleCommand = (title: string) => Promise<void>;

type WindowTitleTarget = {
  title: string;
};

const setTauriWindowTitle: SetWindowTitleCommand = async title => {
  await invoke('set_window_title', { title });
};

export class TauriWindowTitleAdapter implements WindowTitleAdapter {
  private readonly setWindowTitleCommand: SetWindowTitleCommand;

  constructor(
    setWindowTitleCommand: SetWindowTitleCommand = setTauriWindowTitle,
  ) {
    this.setWindowTitleCommand = setWindowTitleCommand;
  }

  setTitle(title: string): Promise<void> {
    return this.setWindowTitleCommand(title);
  }
}

export class BrowserWindowTitleAdapter implements WindowTitleAdapter {
  private readonly target: WindowTitleTarget;

  constructor(target?: WindowTitleTarget) {
    if (target) {
      this.target = target;
      return;
    }

    if (typeof document === 'undefined') {
      throw new Error('Browser window title adapter requires a document');
    }

    this.target = document;
  }

  setTitle(title: string): Promise<void> {
    this.target.title = title;
    return Promise.resolve();
  }
}

export interface CreateWindowTitleAdapterOptions {
  mode: BackendTransportMode;
  setWindowTitleCommand?: SetWindowTitleCommand;
  documentTarget?: WindowTitleTarget;
}

export const createWindowTitleAdapter = ({
  mode,
  setWindowTitleCommand,
  documentTarget,
}: CreateWindowTitleAdapterOptions): WindowTitleAdapter => {
  if (mode === 'http') {
    return new BrowserWindowTitleAdapter(documentTarget);
  }

  return new TauriWindowTitleAdapter(setWindowTitleCommand);
};
