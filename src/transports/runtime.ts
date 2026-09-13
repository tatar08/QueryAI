import { workspaceHttp } from "./workspaceHttp";
import {
  createBackendTransport,
  parseBackendTransportMode,
} from './factory';

function readCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const element = document.querySelector<HTMLMetaElement>(
    'meta[name="csrf-token"]',
  );
  return element?.content || undefined;
}

const mode = parseBackendTransportMode(
  import.meta.env.VITE_TABULARIS_BACKEND_MODE,
);

export const backendTransport = mode === "http" ? workspaceHttp : createBackendTransport({
  mode,
  apiBaseUrl: import.meta.env.VITE_TABULARIS_API_BASE_URL,
  getCsrfToken: readCsrfToken,
});
