import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DeleteConfirmation } from './DeleteConfirmation.tsx';
import './OutletMasterDeleteButton.css';

export function OutletMasterDeleteButton({ outletId, token, collection, documentId, name, onDeleted, onSessionExpired }: {
  outletId: string; token: string; collection: 'premises' | 'employees' | 'customers'; documentId: string; name: string;
  onDeleted: () => void; onSessionExpired: () => void;
}) {
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const busy = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const kind = collection === 'employees' ? 'employee' : collection === 'customers' ? 'customer' : 'premises';
  const remove = async () => {
    if (busy.current) return;
    const controller = new AbortController(); request.current = controller;
    busy.current = true; setSaving(true); setError('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/${collection}/${encodeURIComponent(documentId)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      const result = await response.json() as { success?: boolean; data?: { documentId: string }; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || result.success !== true || result.data?.documentId !== documentId) throw new Error(result.message || 'Deletion could not be confirmed. Please retry.');
      setOpen(false); onDeleted();
    } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { busy.current = false; setSaving(false); } }
  };
  return <span className="master-delete-action" onClick={event => event.stopPropagation()}>
    <button type="button" className="master-delete-button" aria-label={`Delete ${kind} ${name}`} onClick={() => { setOpen(true); setError(''); }}><Trash2 size={15} />Delete</button>
    {open && <DeleteConfirmation kind={kind} name={name} busy={saving} error={error} onCancel={() => { if (!busy.current) setOpen(false); }} onConfirm={() => void remove()} />}
  </span>;
}
