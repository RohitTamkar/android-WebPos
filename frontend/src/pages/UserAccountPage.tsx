import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RefreshCw, Save, UserRound } from 'lucide-react';
import './UserAccountPage.css';

interface AccountDetails { name: string | null; email: string | null; hasLoginPin: boolean; loginPin: string | null }
interface UserAccountPageProps {
  token: string;
  onSessionExpired: () => void;
  onSaved: (details: Pick<AccountDetails, 'name' | 'email'>) => void;
}

export function UserAccountPage({ token, onSessionExpired, onSaved }: UserAccountPageProps) {
  const [account, setAccount] = useState<AccountDetails | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setAccount(null); setError(''); setSuccess(''); setSaving(false); busy.current = false;
    void (async () => {
      try {
        const response = await fetch('/api/auth/account', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { data?: AccountDetails; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load your account details.');
        setAccount(result.data); setName(result.data.name ?? ''); setEmail(result.data.email ?? '');
      } catch (failure) {
        if (!controller.signal.aborted) setError((failure as Error).message);
      }
    })();
    return () => controller.abort();
  }, [token, onSessionExpired, reload]);

  const changed = !!account && ((account.name !== null && name !== account.name) || (account.email !== null && email !== account.email));

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!account || !changed || busy.current) return;
    const changes: { name?: string; email?: string } = {};
    if (account.name !== null && name !== account.name) changes.name = name.trim();
    if (account.email !== null && email !== account.email) changes.email = email.trim().toLowerCase();
    setError(''); setSuccess('');
    if (changes.name !== undefined && !changes.name) { setError('Name is required.'); return; }
    const controller = request.current;
    if (!controller || controller.signal.aborted) return;
    busy.current = true; setSaving(true);
    try {
      const response = await fetch('/api/auth/account', {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(changes), signal: controller.signal,
      });
      const result = await response.json() as { data?: AccountDetails; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || !result.data) throw new Error(result.message || 'Unable to save your account details.');
      setAccount(result.data); setName(result.data.name ?? ''); setEmail(result.data.email ?? '');
      setSuccess('Account details saved.');
      onSaved({ name: result.data.name, email: result.data.email });
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) { busy.current = false; setSaving(false); }
    }
  };

  return <section className="user-account-page">
    <div className="user-account-heading"><span>MASTERS</span><h1>User Account</h1><p>View and update your account details.</p></div>
    <div className="user-account-card">
      <h2><UserRound size={20} /> Personal details</h2>
      {!account ? error ? <div className="user-account-state"><p role="alert">{error}</p><button type="button" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : <p className="user-account-state" role="status">Loading account details…</p> :
        <form onSubmit={save} onChange={() => { setSuccess(''); setError(''); }}>
          <fieldset disabled={saving}>
            {account.name !== null && <label>Name<input name="name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} required maxLength={200} /></label>}
            {account.email !== null && <label>Email ID<input name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={320} /></label>}
            {account.hasLoginPin && <label>Login PIN<input id="account-login-pin" type="text" value={account.loginPin ?? 'Unavailable'} readOnly aria-describedby="account-pin-help" autoComplete="off" /><small id="account-pin-help">{account.loginPin ? 'Your current login PIN.' : 'This PIN cannot be displayed.'} PIN changes are not available here.</small></label>}
          </fieldset>
          {error && <p className="user-account-error" role="alert">{error}</p>}
          {success && <p className="user-account-success" role="status">{success}</p>}
          <div className="user-account-actions"><button type="submit" disabled={!changed || saving}>{saving ? <RefreshCw size={16} /> : <Save size={16} />}{saving ? 'Saving…' : 'Save changes'}</button></div>
        </form>}
    </div>
  </section>;
}
