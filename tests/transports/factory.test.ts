import { describe, expect, it, vi } from 'vitest';

import {
  createBackendTransport,
  parseBackendTransportMode,
} from '../../src/transports';
import type { InvokeCommand } from '../../src/transports';

describe('Backend transport factory', () => {
  it('defaults to Tauri when no mode is configured', () => {
    expect(parseBackendTransportMode(undefined)).toBe('tauri');
    expect(parseBackendTransportMode('')).toBe('tauri');
  });

  it('accepts the supported explicit modes', () => {
    expect(parseBackendTransportMode('tauri')).toBe('tauri');
    expect(parseBackendTransportMode('http')).toBe('http');
  });

  it('rejects an unknown mode instead of silently selecting a backend', () => {
    expect(() => parseBackendTransportMode('preview')).toThrow(
      'expected tauri or http',
    );
  });

  it('creates the selected transport implementation', () => {
    const invokeCommand = vi.fn<InvokeCommand>();
    const fetchImplementation = vi.fn<typeof fetch>();

    const tauri = createBackendTransport({
      mode: 'tauri',
      invokeCommand,
    });
    const http = createBackendTransport({
      mode: 'http',
      fetchImplementation,
    });

    expect(tauri.kind).toBe('tauri');
    expect(http.kind).toBe('http');
  });
});
