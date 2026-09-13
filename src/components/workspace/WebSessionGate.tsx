import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { HttpTransportError } from '../../transports/http';
import { webRequest } from '../../utils/webApi';
import { invokeWebCommand, listWebWorkspaces } from '../../utils/webCommands';
import { getWebSession, setWebSession, subscribeWebSession, webMode } from '../../utils/webSession';

export function WebSessionGate({ children }: { children: ReactNode }) {
  return webMode ? <AuthenticatedWebApp>{children}</AuthenticatedWebApp> : <>{children}</>;
}

function AuthenticatedWebApp({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const session = useSyncExternalStore(subscribeWebSession, getWebSession);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (!session.userId) {
          const auth = await webRequest<{ userId: string }>('/api/v1/auth/session');
          if (active) setWebSession(auth.userId, null);
        } else if (!session.workspace) {
          const workspaces = await listWebWorkspaces();
          const saved = localStorage.getItem(`tabularis_web_workspace:${session.userId}`);
          const workspace = workspaces.find(w => w.id === saved) ?? workspaces[0];
          if (active && workspace) setWebSession(session.userId, workspace);
        }
      } catch (cause) {
        if (active && !(cause instanceof HttpTransportError && cause.status === 401)) setError(String(cause));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [session.userId, session.workspace, retry]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== 'tabularis_web_auth_change') return;
      setWebSession(null, null);
      setLoading(true);
      setRetry(value => value + 1);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  const authenticate = async (event: FormEvent) => {
    event.preventDefault();
    if (register && pin !== confirmation) { setError(t('web.pinMismatch', { defaultValue: 'PINs do not match' })); return; }
    setBusy(true); setError('');
    try {
      await invokeWebCommand(register ? 'pin_register' : 'pin_login', { username, pin });
      setPin(''); setConfirmation(''); setLoading(true);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const createWorkspace = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await invokeWebCommand('create_workspace', { name: workspaceName });
      setRetry(value => value + 1);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true); setError('');
    try { await invokeWebCommand('pin_logout'); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  if (session.userId && session.workspace) return <Fragment key={session.revision}>{children}</Fragment>;
  const inputClass = 'w-full rounded border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2';
  return <main className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] text-[var(--text-primary)] p-6">
    <section className="w-full max-w-sm rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 space-y-4">
      <h1 className="text-xl font-semibold">Tabularis</h1>
      {error && <p role="alert" className="text-red-400 break-words">{error}</p>}
      {loading ? <p role="status">{t('web.loadingSession', { defaultValue: 'Loading your session…' })}</p> : session.userId ? <form onSubmit={createWorkspace} className="space-y-4">
        <h2>{t('web.createWorkspace', { defaultValue: 'Create your first workspace' })}</h2>
        <label className="block">{t('web.workspaceName', { defaultValue: 'Workspace name' })}<input required maxLength={100} className={inputClass} value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} /></label>
        <button disabled={busy} type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">{t('web.create', { defaultValue: 'Create workspace' })}</button>
        <button disabled={busy} type="button" onClick={() => void logout()} className="ml-3">{t('web.signOut', { defaultValue: 'Sign out' })}</button>
      </form> : <form onSubmit={authenticate} className="space-y-4">
        <h2>{register ? t('web.register', { defaultValue: 'Create an account' }) : t('web.signIn', { defaultValue: 'Sign in' })}</h2>
        <label className="block">{t('web.username', { defaultValue: 'Username' })}<input required autoComplete="username" maxLength={50} className={inputClass} value={username} onChange={e => setUsername(e.target.value)} /></label>
        <label className="block">{t('web.pin', { defaultValue: 'PIN (6–8 digits)' })}<input required type="password" inputMode="numeric" pattern="[0-9]{6,8}" autoComplete={register ? 'new-password' : 'current-password'} className={inputClass} value={pin} onChange={e => setPin(e.target.value)} /></label>
        {register && <label className="block">{t('web.confirmPin', { defaultValue: 'Confirm PIN' })}<input required type="password" inputMode="numeric" pattern="[0-9]{6,8}" autoComplete="new-password" className={inputClass} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
        <button disabled={busy} type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">{register ? t('web.register', { defaultValue: 'Create an account' }) : t('web.signIn', { defaultValue: 'Sign in' })}</button>
        <button disabled={busy} type="button" className="block text-blue-400" onClick={() => { setRegister(value => !value); setError(''); setPin(''); setConfirmation(''); }}>{register ? t('web.existingAccount', { defaultValue: 'Already have an account? Sign in' }) : t('web.newAccount', { defaultValue: 'Create an account' })}</button>
      </form>}
      {error && <button type="button" onClick={() => { setError(''); setLoading(true); setRetry(value => value + 1); }}>{t('web.retry', { defaultValue: 'Retry' })}</button>}
    </section>
  </main>;
}
