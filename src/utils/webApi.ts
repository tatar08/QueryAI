import { HttpTransportError } from '../transports/http';
import { getWebSession, setWebSession } from './webSession';

export async function webRequest<T>(path: string, method = 'GET', body?: unknown, fetcher: typeof fetch = fetch): Promise<T> {
  const session = getWebSession();
  const headers = new Headers({ accept: 'application/json' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
  if (csrf && method !== 'GET') headers.set('x-csrf-token', csrf);
  const response = await fetcher(`${(import.meta.env.VITE_TABULARIS_API_BASE_URL ?? '').replace(/\/$/, '')}${path}`, {
    method, headers, credentials: 'include', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // Discard late responses from an identity or workspace that has been replaced.
  if (getWebSession() !== session) throw new Error('Session or workspace changed; discard this response');
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const details = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
    if (response.status === 401 && session.userId) setWebSession(null, null);
    throw new HttpTransportError(typeof details.message === 'string' ? details.message : `Request failed (${response.status})`, response.status,
      typeof details.code === 'string' ? details.code : undefined);
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json() as T;
  if (getWebSession() !== session) throw new Error('Session or workspace changed; discard this response');
  return result;
}
export function workspacePath(suffix = ''): string {
  const workspace = getWebSession().workspace;
  if (!getWebSession().userId || !workspace) throw new Error('Select an authenticated workspace first');
  return `/api/v1/workspaces/${encodeURIComponent(workspace.id)}${suffix}`;
}
