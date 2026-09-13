import type { WorkspaceRole } from '../types/rbac';

export interface WebWorkspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  is_personal: boolean;
}
export interface WebSession {
  userId: string | null;
  workspace: WebWorkspace | null;
  revision: number;
}
let snapshot: WebSession = { userId: null, workspace: null, revision: 0 };
const listeners = new Set<() => void>();
export const webMode = import.meta.env.VITE_TABULARIS_BACKEND_MODE === 'http';
export const getWebSession = (): WebSession => snapshot;
export function subscribeWebSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setWebSession(userId: string | null, workspace: WebWorkspace | null): void {
  if (snapshot.userId === userId && snapshot.workspace?.id === workspace?.id && snapshot.workspace?.role === workspace?.role) return;
  snapshot = { userId, workspace, revision: snapshot.revision + 1 };
  // Remove obsolete browser credentials; HTTP authentication uses HttpOnly cookies.
  for (const key of ['tabularis_jwt_token', 'tabularis_web_current_user']) localStorage.removeItem(key);
  if (userId && workspace) localStorage.setItem(`tabularis_web_workspace:${userId}`, workspace.id);
  listeners.forEach(listener => listener());
}
export function selectWebWorkspace(workspace: WebWorkspace): void {
  if (!snapshot.userId) throw new Error('Sign in before selecting a workspace');
  setWebSession(snapshot.userId, workspace);
}
export function webScope(): string {
  if (!snapshot.userId || !snapshot.workspace) throw new Error('Select an authenticated workspace first');
  return JSON.stringify([snapshot.userId, snapshot.workspace.id]);
}
