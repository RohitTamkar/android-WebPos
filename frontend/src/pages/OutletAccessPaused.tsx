import { useId, useLayoutEffect, useRef } from 'react';
import { Clock3, LoaderCircle, LogOut, Pause, Play, ShieldCheck, Store } from 'lucide-react';
import './OutletAccessPaused.css';

export function OutletAccessPaused({ outlet, userName, message, blocked, checking, signedOut = false, onResume, onChangeOutlet, onSignOut }: {
  outlet: { name: string; branch: string }; userName: string; message: string;
  blocked: boolean; checking: boolean; signedOut?: boolean; onResume: () => void; onChangeOutlet: () => void; onSignOut: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId(), description = useId();
  useLayoutEffect(() => {
    const lockout = dialog.current!;
    const bodyOverflow = document.body.style.overflow, pageOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
    lockout.showModal();
    // A save completing while paused may open a native success dialog. Keep the
    // lockout on top; its hidden editor and pending result remain mounted.
    const workspace = document.querySelector('.retail-dashboard-shell');
    const observer = new MutationObserver(records => {
      if (!lockout.isConnected || !lockout.open) return;
      if (records.some(record => record.target instanceof HTMLDialogElement && record.target.open)) {
        lockout.close(); lockout.showModal();
      }
    });
    if (workspace) observer.observe(workspace, { subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => {
      observer.disconnect();
      document.body.style.overflow = bodyOverflow; document.documentElement.style.overflow = pageOverflow;
    };
  }, []);
  const words = outlet.name.trim().split(/\s+/);
  const initials = (words.length === 1 ? words[0]!.slice(0, 2) : words.map(word => word[0]).join('').slice(0, 2)).toUpperCase();
  return <dialog ref={dialog} className="outlet-lockout" data-outlet-access-notice aria-modal="true" aria-labelledby={title}
    aria-describedby={description} onCancel={event => event.preventDefault()}>
    <section className="outlet-lockout-card">
      <span className="outlet-lockout-status"><span />{checking ? 'Checking session' : blocked ? 'Daily limit reached' : 'Session paused'}</span>
      <div className="outlet-lockout-icon" aria-hidden="true">
        {checking ? <LoaderCircle className="outlet-lockout-spinner" /> : <Pause fill="currentColor" />}
        <span><Clock3 /></span>
      </div>
      <h1 id={title}>{checking ? 'Checking outlet access' : 'Outlet access paused'}</h1>
      <p id={description} className="outlet-lockout-description" role={checking ? 'status' : 'alert'}>{blocked
        ? `The daily 30-minute allowance has been used.${signedOut ? ' Your outlet session has ended.' : ''} Access resumes on the next calendar day.`
        : message || (checking ? 'Verifying your outlet session. Please wait a moment.' : 'Web POS usage paused. Continue when you are ready.')}</p>
      <div className="outlet-lockout-context">
        <div className="outlet-lockout-context-heading"><span>{signedOut ? 'Previous outlet' : 'Active context'}</span><span>{blocked ? 'Daily allowance exhausted' : 'Protected outlet session'}</span></div>
        <div className="outlet-lockout-context-body">
          <span className="outlet-lockout-avatar" aria-hidden="true">{initials || <Store />}</span>
          <div className="outlet-lockout-outlet"><strong>{outlet.name}</strong><span>{outlet.branch}</span></div>
          <div className="outlet-lockout-user"><span>{signedOut ? 'Last signed in as' : 'Logged in as'}</span><strong>{userName}</strong></div>
        </div>
      </div>
      <div className="outlet-lockout-actions">
        <button type="button" autoFocus={!blocked} className="outlet-lockout-resume" disabled={blocked} onClick={onResume}>
          {checking ? <LoaderCircle className="outlet-lockout-spinner" /> : <Play fill="currentColor" />}{checking ? 'Retry connection' : 'Continue / Resume'}
        </button>
        <div>
          <button type="button" autoFocus={blocked} className="outlet-lockout-change" onClick={onChangeOutlet}><Store />Change Outlet</button>
          <button type="button" className="outlet-lockout-signout" onClick={onSignOut}><LogOut />Sign Out</button>
        </div>
      </div>
      <p className="outlet-lockout-footer"><ShieldCheck aria-hidden="true" />Secure session access · Sensible Connect</p>
    </section>
  </dialog>;
}

// Admission is an authentication check, not a daily-allowance warning. Keep it
// neutral until the backend has authorized the selected outlet and its policy.
export function OutletAdmission({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return <main className="outlet-admission" data-outlet-admission aria-labelledby="outlet-admission-title">
    <LoaderCircle className="outlet-lockout-spinner" aria-hidden="true" />
    <h1 id="outlet-admission-title">Checking outlet access</h1>
    <p role="status">Verifying your authorized outlet session…</p>
    <div><button type="button" autoFocus onClick={onRetry}>Retry connection</button><button type="button" onClick={onSignOut}>Sign Out</button></div>
  </main>;
}
