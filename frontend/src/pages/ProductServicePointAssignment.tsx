import { useEffect, useRef, useState } from 'react';
import './CategoryPage.css';
import './ProductServicePointAssignment.css';

interface Assignment { categoryId: string; servicePointId: string; assignedCount: number }
export function ProductServicePointAssignment({ outletId, token, categories, onCancel, onAssigned, onSessionExpired }: {
  outletId: string; token: string; categories: { id: string; name: string }[];
  onCancel: () => void; onAssigned: (result: Assignment) => void; onSessionExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), pending = useRef<AbortController | null>(null);
  const [categoryId, setCategoryId] = useState(''), [servicePointId, setServicePointId] = useState('');
  const [points, setPoints] = useState<{ documentId: string; name: string }[] | null>(null);
  const [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState(false), [saving, setSaving] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => pending.current?.abort(); }, []);
  useEffect(() => {
    if (!categoryId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/service-points`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { success?: boolean; data?: { servicePoints?: { documentId: string; name: string }[] }; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || result.success !== true || !Array.isArray(result.data?.servicePoints)) throw new Error(result.message || 'Unable to load service points.');
        setPoints(result.data.servicePoints);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    })();
    return () => controller.abort();
  }, [categoryId, outletId, token, reload, onSessionExpired]);
  const assign = async () => {
    if (!confirm || !categoryId || !servicePointId || pending.current) return;
    const controller = new AbortController(); pending.current = controller; setSaving(true); setError('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outletId)}/products/assign-service-point`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify({ categoryId, servicePointId }),
      });
      const result = await response.json() as { success?: boolean; data?: Assignment; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || result.success !== true || result.data?.categoryId !== categoryId || result.data.servicePointId !== servicePointId || !(result.data.assignedCount > 0)) {
        throw new Error(result.message || 'Unable to confirm the service point assignment. Please try again.');
      }
      onAssigned(result.data);
    } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { pending.current = null; setSaving(false); } }
  };
  const category = categories.find(row => row.id === categoryId), point = points?.find(row => row.documentId === servicePointId);
  return <dialog ref={dialog} className="category-modal service-point-assignment" aria-labelledby="assign-service-point-title"
    onCancel={event => { event.preventDefault(); if (!pending.current) onCancel(); }} aria-busy={saving}>
    <div className="modal-header"><h3 id="assign-service-point-title">{confirm ? 'Confirm Service Point Assignment' : 'Assign Service Point'}</h3></div>
    <div className="modal-body">
      {confirm ? <p>Are you sure you want to assign <strong>{point?.name}</strong> to all products in <strong>{category?.name}</strong>? This replaces their current service point assignments.</p>
        : !categoryId ? <><p>Choose a category</p>{categories.length ? <div className="assignment-choice-list" aria-label="Categories">{categories.map(row => <button type="button" className="btn-secondary" key={row.id}
          onClick={() => { setError(''); setPoints(null); setServicePointId(''); setCategoryId(row.id); }}>{row.name}</button>)}</div> : <p>No categories found for this outlet.</p>}</>
        : <><p>Category: <strong>{category?.name}</strong></p><p>Choose a service point</p>
          {points === null ? !error && <p role="status">Loading service points…</p> : !points.length ? <p>No service points found. Add one under Masters → Service Point.</p>
            : <fieldset className="assignment-choice-list"><legend>Service points</legend>{points.map(row => <label key={row.documentId}><input type="radio" name="assignedServicePoint" value={row.documentId} checked={servicePointId === row.documentId} onChange={() => setServicePointId(row.documentId)} />{row.name || 'Unnamed service point'}</label>)}</fieldset>}
        </>}
      {error && <p className="category-form-error" role="alert">{error}</p>}
      {!confirm && categoryId && error && points === null && <button type="button" className="btn-secondary" onClick={() => { setError(''); setReload(value => value + 1); }}>Retry</button>}
    </div>
    <div className="modal-footer">
      <button type="button" className="btn-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
      {confirm ? <><button type="button" className="btn-secondary" disabled={saving} onClick={() => { setConfirm(false); setError(''); }}>No</button><button type="button" className="btn-primary-add" disabled={saving} onClick={() => void assign()}>{saving ? 'Assigning…' : 'Yes'}</button></>
        : categoryId && <><button type="button" className="btn-secondary" onClick={() => { setCategoryId(''); setServicePointId(''); setError(''); }}>Back</button><button type="button" className="btn-primary-add" disabled={!servicePointId} onClick={() => setConfirm(true)}>Assign</button></>}
    </div>
  </dialog>;
}
