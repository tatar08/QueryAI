/**
 * Browser polyfills for Node.js modules
 * This file makes Buffer and process available globally for libraries that expect them (like wkx)
 */

import { Buffer } from 'buffer';
import process from 'process';

// Make Buffer available globally for browser environment
if (typeof window !== 'undefined') {
  (window as typeof window & { Buffer: typeof Buffer; process: typeof process }).Buffer = Buffer;
  (window as typeof window & { Buffer: typeof Buffer; process: typeof process }).process = process;
}

// Also set on globalThis for broader compatibility
if (typeof globalThis !== 'undefined') {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer; process: typeof process }).Buffer = Buffer;
  (globalThis as typeof globalThis & { Buffer: typeof Buffer; process: typeof process }).process = process;
}

// Fallback for Tauri internals in standard browser environments (e.g. Chrome / Web preview)
if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
  const callbacks = new Map<number, (res: any) => void>();
  let nextCallbackId = 1;
  const eventListeners = new Map<string, Set<number>>();

  (window as any).__TAURI_INTERNALS__ = {
    transformCallback: (callback: (res: any) => void, once = false) => {
      const id = nextCallbackId++;
      callbacks.set(id, (res: any) => {
        if (once) callbacks.delete(id);
        if (typeof callback === 'function') callback(res);
      });
      return id;
    },
    unregisterCallback: (id: number) => {
      callbacks.delete(id);
    },
    invoke: async (cmd: string, args: any = {}) => {
      if (cmd === 'plugin:event|listen') {
        const id = args?.handler || nextCallbackId++;
        const eventName = args?.event;
        if (eventName) {
          if (!eventListeners.has(eventName)) {
            eventListeners.set(eventName, new Set());
          }
          eventListeners.get(eventName)!.add(id);
        }
        return id;
      }
      if (cmd === 'plugin:event|unlisten') {
        const eventName = args?.event;
        const id = args?.eventId;
        if (eventName && id) {
          eventListeners.get(eventName)?.delete(id);
          callbacks.delete(id);
        }
        return null;
      }
      if (cmd === 'plugin:event|emit') {
        const eventName = args?.event;
        const payload = args?.payload;
        if (eventName && eventListeners.has(eventName)) {
          for (const cbId of eventListeners.get(eventName)!) {
            const cb = callbacks.get(cbId);
            if (cb) {
              cb({ event: eventName, id: cbId, payload });
            }
          }
        }
        return null;
      }
      try {
        const { invoke: shimInvoke } = await import('./tauri-web-shim/core');
        return await shimInvoke(cmd, args);
      } catch {
        return null;
      }
    },
    convertFileSrc: (path: string) => path,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' },
    },
    plugins: {},
  };

  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event: string, eventId: number) => {
      eventListeners.get(event)?.delete(eventId);
      callbacks.delete(eventId);
    },
  };
}
