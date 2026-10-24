import { useEffect, useRef, useState, type FormEvent } from 'react';
import './TransferPreviewPage.css';

const imageActionLabels = { bulk: 'Bulk Upload Images', shared: 'One Image for Multiple Products', remove: 'Remove all product images' };
export type ImageAction = keyof typeof imageActionLabels;

export function ProductImagePinDialog({ outletId, token, action, onCancel, onVerified, onSessionExpired }: {
  outletId: string; token: string; action: ImageAction; onCancel: () => void;
  onVerified: (grant: string) => void; onSessionExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => request.current?.abort(); }, []);
  const cancel = () => { request.current?.abort(); setPin(''); onCancel(); };
  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (request.current) return;
    if (!/^\d{4}$/.test(pin)) { setError('Enter your 4-digit login Quick PIN.'); return; }
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    const body = JSON.stringify({ action, quickPin: pin }); setPin('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/product-images/verify-quick-pin`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        cache: 'no-store', priority: 'high', signal: controller.signal, body,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      const result = await response.json() as { success?: boolean; message?: string; data?: { verified?: boolean; action?: string; imageToken?: string } };
      if (controller.signal.aborted) return;
      if (!response.ok || result.success !== true || result.data?.verified !== true || result.data.action !== action || !result.data.imageToken)
        throw new Error(result.message || 'Unable to verify your Quick PIN.');
      onVerified(result.data.imageToken);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to verify your Quick PIN.');
    } finally { if (!controller.signal.aborted) { request.current = null; setBusy(false); } }
  };
  return <dialog ref={dialog} className="transfer-preview-pin" aria-labelledby="image-pin-title" onCancel={event => { event.preventDefault(); cancel(); }}>
    <form onSubmit={event => void verify(event)}><h2 id="image-pin-title">Verify Quick PIN</h2><p>{imageActionLabels[action]}</p>
      <label htmlFor="image-quick-pin">Your 4-digit login Quick PIN<input id="image-quick-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus required pattern="[0-9]{4}" minLength={4} maxLength={4}
        value={pin} disabled={busy} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
      {error && <p role="alert">{error}</p>}
      <div><button type="button" className="devices-refresh" onClick={cancel}>Cancel</button><button type="submit" className="devices-refresh" disabled={busy || !/^\d{4}$/.test(pin)}>{busy ? 'Verifying…' : 'Verify'}</button></div>
    </form>
  </dialog>;
}
