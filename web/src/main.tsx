import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { FrontDesk } from './front-desk';
import './styles.css';

type Account = {
  id: string;
  username: string;
  role: 'OWNER' | 'STAFF' | 'TRAINER';
  mustChangePassword: boolean;
};

const roleName = { OWNER: 'Owner', STAFF: 'Staff', TRAINER: 'Trainer' };

async function authRequest(path: string, body: object) {
  return fetch('/api/v1/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function SignIn() {
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function restore() {
      try {
        const response = await fetch('/api/v1/auth/me', { signal: controller.signal });
        if (response.ok) setAccount(await response.json());
        else if (response.status !== 401) setMessage('Could not check your session. Try signing in.');
      } catch {
        if (!controller.signal.aborted) setMessage('Could not reach the sign-in service.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void restore();
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const changing = Boolean(account?.mustChangePassword);
    setBusy(true);
    setMessage('');
    try {
      const response = await authRequest(changing ? 'change-password' : 'login', Object.fromEntries(data));
      if (response.status === 429) setMessage('Too many attempts. Try again in a minute.');
      else if (response.status === 401) setMessage(changing ? 'The current password or session is invalid.' : 'Invalid username or password.');
      else if (response.status === 400 && changing) setMessage('Choose a different password with 12–128 characters.');
      else if (!response.ok) setMessage('The request could not be completed. Try again.');
      else if (changing) {
        setAccount(null);
        setMessage('Password changed. Sign in again with your new password.');
      } else {
        setAccount(await response.json());
        setShowPassword(false);
      }
    } catch {
      setMessage('Could not reach the sign-in service. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setMessage('');
    try {
      const response = await authRequest('logout', {});
      if (!response.ok) throw new Error('Logout failed');
      setAccount(null);
    } catch {
      setMessage('Could not sign out. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const changing = account?.mustChangePassword;
  if (account && !changing && account.role !== 'TRAINER') {
    return <FrontDesk username={account.username} owner={account.role === 'OWNER'}
      busy={busy} onLogout={logout} message={message} />;
  }
  return (
    <main className="sign-in">
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <div className="wordmark">Lion Gym</div>
        <h1 id="sign-in-title">{loading ? 'Sign In' : changing ? 'Change password' : account ? 'Signed in' : 'Sign In'}</h1>
        {loading ? <p role="status">Checking session…</p> : account && !changing ? (
          <>
            <p>{account.username} · {roleName[account.role]}</p>
            <button className="submit session-button" type="button" disabled={busy} onClick={logout}>Sign Out</button>
          </>
        ) : changing ? (
          <>
            <form key="change-password" onSubmit={submit}>
              <div className="field">
                <label htmlFor="current-password">Current password</label>
                <input id="current-password" name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required />
              </div>
              <div className="field">
                <label htmlFor="new-password">New password</label>
                <input id="new-password" name="newPassword" type="password" autoComplete="new-password"
                  minLength={12} maxLength={128} aria-describedby="password-length" required />
                <small id="password-length">Use 12–128 characters.</small>
              </div>
              <button className="submit" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
            </form>
            <button className="recovery" type="button" disabled={busy} onClick={logout}>Sign out</button>
          </>
        ) : (
          <>
        <form key="signin" onSubmit={submit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" name="username" autoComplete="username"
              autoCapitalize="none" spellCheck={false} maxLength={64} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input id="password" name="password" type={showPassword ? 'text' : 'password'}
                autoComplete="current-password" maxLength={128} required />
              <button type="button" className="password-toggle" aria-controls="password"
                onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? 'Hide' : 'Show'}
                <span className="visually-hidden"> password</span>
              </button>
            </div>
          </div>
          <button className="submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</button>
        </form>
        <button className="recovery" type="button"
          onClick={() => setMessage('Owner password recovery email is not available yet.')}>
          Forgot owner password?
        </button>
          </>
        )}
        <p className="feedback" role="status">{message}</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<SignIn />);
