import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { devDbProxyPlugin } from './src/tauri-web-shim/devDbProxy'

// Detect if running inside Tauri dev/build environment
const isTauriBuild = Boolean(
  process.env.TAURI_ENV_PLATFORM ||
  process.env.TAURI_PLATFORM ||
  process.env.TAURI_FAMILY
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devDbProxyPlugin()],
  resolve: {
    alias: {
      // Polyfills for browser environment (needed by wkx library)
      buffer: 'buffer',
      util: 'util',
      // Tauri Web Shim Layer (active only in browser mode, bypassed in desktop Tauri)
      ...(isTauriBuild
        ? {}
        : {
            '@tauri-apps/api/core': path.resolve(__dirname, 'src/tauri-web-shim/core.ts'),
            '@tauri-apps/api/event': path.resolve(__dirname, 'src/tauri-web-shim/event.ts'),
            '@tauri-apps/api/window': path.resolve(__dirname, 'src/tauri-web-shim/window.ts'),
            '@tauri-apps/api/path': path.resolve(__dirname, 'src/tauri-web-shim/path.ts'),
            '@tauri-apps/plugin-clipboard-manager': path.resolve(__dirname, 'src/tauri-web-shim/plugins/clipboard.ts'),
            '@tauri-apps/plugin-dialog': path.resolve(__dirname, 'src/tauri-web-shim/plugins/dialog.ts'),
            '@tauri-apps/plugin-fs': path.resolve(__dirname, 'src/tauri-web-shim/plugins/fs.ts'),
            '@tauri-apps/plugin-notification': path.resolve(__dirname, 'src/tauri-web-shim/plugins/notification.ts'),
            '@tauri-apps/plugin-opener': path.resolve(__dirname, 'src/tauri-web-shim/plugins/opener.ts'),
            '@tauri-apps/plugin-updater': path.resolve(__dirname, 'src/tauri-web-shim/plugins/updater.ts'),
          }),
    },
  },
  define: {
    // Make Node.js globals available in browser
    global: 'globalThis',
    'process.env': {},
  },
  build: {
    // Monaco editor ships pre-built web workers (ts.worker ~7MB, css.worker ~1MB)
    // that are loaded lazily on demand — bumping the limit accommodates them.
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['monaco-editor', '@monaco-editor/react'],
          recharts: ['recharts'],
          xyflow: ['@xyflow/react', 'dagre'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          markdown: ['react-markdown'],
          table: ['@tanstack/react-table', '@tanstack/react-virtual'],
          wkx: ['wkx', 'buffer', 'util'],
        },
      },
    },
  },
})
