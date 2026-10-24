import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Phone, ShieldCheck, Store, UserRound, X } from 'lucide-react';
import type { UserSession } from './LoginPage.tsx';
import './ProfileMenu.css';

interface ProfileDetails { name: string; mobile: string; role: string; outletName: string }

export function ProfileMenu({ session, outletId, onSessionExpired }: {
  session: Pick<UserSession, 'name' | 'role' | 'token'>;
  outletId: string;
  onSessionExpired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<ProfileDetails | null>(null);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setDetails(null);
    setError('');
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/profile`, {
          headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { data?: ProfileDetails; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load your account details.');
        setDetails(result.data);
      } catch (requestError) {
        if (!controller.signal.aborted) setError((requestError as Error).message);
      }
    })();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      controller.abort();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, outletId, session.token, onSessionExpired]);

  return <div className="profile-menu" ref={container}>
    <button ref={trigger} type="button" className="admin-chip profile-menu-trigger" aria-label="Account details"
      aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <span>{session.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</span>
      <div><strong>{session.name}</strong><small>{session.role}</small></div><ChevronDown />
    </button>
    {open && <section id={id} className="profile-menu-panel" role="dialog" aria-labelledby={`${id}-title`}>
      <div className="profile-menu-heading">
        <span className="profile-menu-avatar" aria-hidden="true"><UserRound size={22} /></span>
        <div><h2 id={`${id}-title`}>Account details</h2><p>Your workspace profile</p></div>
        <button className="profile-menu-close" type="button" aria-label="Close account details" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button>
      </div>
      {error ? <p role="alert">{error}</p> : !details ? <p role="status">Loading account details…</p> : <dl>
        <div className="profile-detail-row profile-detail-outlet"><span aria-hidden="true"><Store size={18} /></span><dt>Outlet name</dt><dd>{details.outletName || 'Not provided'}</dd></div>
        <div className="profile-detail-row"><span aria-hidden="true"><UserRound size={16} /></span><dt>Name</dt><dd>{details.name || 'Not provided'}</dd></div>
        <div className="profile-detail-row"><span aria-hidden="true"><Phone size={16} /></span><dt>Mobile number</dt><dd>{details.mobile || 'Not provided'}</dd></div>
        <div className="profile-detail-row"><span aria-hidden="true"><ShieldCheck size={16} /></span><dt>Role</dt><dd className="profile-role-badge">{details.role || 'Not provided'}</dd></div>
      </dl>}
    </section>}
  </div>;
}
