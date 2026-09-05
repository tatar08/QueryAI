import type { BackendTransport } from './backend';
import { HttpTransport } from './http';
import type { HttpTransportOptions } from './http';
import { TauriTransport } from './tauri';
import type { InvokeCommand } from './tauri';

export type BackendTransportMode = 'tauri' | 'http';

export interface CreateBackendTransportOptions
  extends Omit<HttpTransportOptions, 'baseUrl'> {
  mode: BackendTransportMode;
  apiBaseUrl?: string;
  invokeCommand?: InvokeCommand;
}

export function parseBackendTransportMode(
  value: string | undefined,
): BackendTransportMode {
  if (value === undefined || value.trim() === '') return 'tauri';
  if (value === 'tauri' || value === 'http') return value;
  throw new Error(
    `Invalid VITE_TABULARIS_BACKEND_MODE "${value}"; expected tauri or http`,
  );
}

export function createBackendTransport({
  mode,
  apiBaseUrl,
  fetchImplementation,
  getCsrfToken,
  invokeCommand,
}: CreateBackendTransportOptions): BackendTransport {
  if (mode === 'http') {
    return new HttpTransport({
      baseUrl: apiBaseUrl,
      fetchImplementation,
      getCsrfToken,
    });
  }
  return new TauriTransport(invokeCommand);
}
