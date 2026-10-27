import { useTimedNotice } from '../utils/useTimedNotice.ts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Printer, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { DeleteConfirmation } from './DeleteConfirmation.tsx';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { createRequestId } from '../utils/requestId.ts';
import './CategoryPage.css';
import './MasterForm.css';
import './ServicePointsPage.css';

interface ServicePoint {
  documentId: string; name: string; paperSize: number | null; printerType: number | null;
  header: string; subHeader: string; footer: string; printerIpAddress: string; port: number | null; usbPath: string | null;
}
interface Draft { requestId: string; name: string; paperSize: number | null; printerType: number | null; header: string; subHeader: string; footer: string; printerIpAddress: string; port: string; usbPath: string }
const printerTypes = ['Serial', 'Ethernet', 'USB'];
interface Props {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}
export function ServicePointsPage(props: Props) {
  return <ServicePointsContent key={`${props.outlet.id}:${props.token}`} {...props} />;
}
function ServicePointsContent({ outlet, token, onSessionExpired }: Props) {
  const [rows, setRows] = useState<ServicePoint[] | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useTimedNotice();
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<ServicePoint | null>(null);
  const [deleting, setDeleting] = useState<ServicePoint | null>(null);
  const [deleteError, setDeleteError] = useState(''), [deleteBusy, setDeleteBusy] = useState(false);
  const original = useRef<Draft | null>(null);
  const [saveError, setSaveError] = useState(''), [saving, setSaving] = useState(false);
  const busy = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/service-points`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { success?: boolean; data?: { servicePoints: ServicePoint[] }; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || result.success !== true || !Array.isArray(result.data?.servicePoints)) throw new Error(result.message || 'Unable to load service points.');
        setRows(result.data.servicePoints);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    })();
    return () => controller.abort();
  }, [outlet.id, token, onSessionExpired, reload]);
  const confirmDelete = async () => {
    const controller = request.current;
    if (!deleting || busy.current || !controller || controller.signal.aborted) return;
    busy.current = true; setDeleteBusy(true); setDeleteError('');
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/service-points/${encodeURIComponent(deleting.documentId)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      const result = await response.json() as { success?: boolean; data?: { documentId: string }; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || result.success !== true || result.data?.documentId !== deleting.documentId) {
        throw new Error(result.message || 'Unable to confirm the service point deletion. Please retry.');
      }
      setRows(current => current?.filter(row => row.documentId !== deleting.documentId) ?? null);
      setDeleting(null); setNotice('Service point deleted successfully.');
    } catch (failure) { if (!controller.signal.aborted) setDeleteError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { busy.current = false; setDeleteBusy(false); } }
  };
  const openAdd = () => {
    setNotice(''); setSaveError(''); setEditing(null); original.current = null;
    setDraft({ requestId: createRequestId(), name: '', paperSize: 2, printerType: 0, header: '', subHeader: '', footer: '', printerIpAddress: '', port: '9100', usbPath: '' });
  };
  const openEdit = (row: ServicePoint) => {
    setNotice(''); setSaveError(''); setEditing(row);
    const initial = { ...row, requestId: '', port: String(row.port ?? 0), usbPath: row.usbPath ?? '' };
    original.current = initial; setDraft(initial);
  };
  const payload = (value: Draft) => ({ name: value.name.trim(), paperSize: value.paperSize, printerType: value.printerType,
    header: value.header.trim(), subHeader: value.subHeader.trim(), footer: value.footer.trim(),
    port: value.printerType === 1 ? Number(value.port) : 0,
    printerIpAddress: value.printerType === 1 ? value.printerIpAddress.trim() : '', usbPath: value.printerType === 2 ? value.usbPath.trim() || null : null });
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => { setSaveError(''); setDraft(current => current ? { ...current, [key]: value } : current); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const controller = request.current;
    if (!draft || busy.current || !controller || controller.signal.aborted) return;
    if (!draft.name.trim()) { setSaveError('Enter a service point name.'); return; }
    const port = draft.printerType === 1 ? Number(draft.port) : 0;
    if (!Number.isInteger(port) || port < 0 || port > 65535 || (draft.printerType === 1 && !draft.port.trim())) {
      setSaveError('Enter a printer port between 0 and 65535.'); return;
    }
    busy.current = true; setSaving(true); setSaveError('');
    try {
      const values = payload(draft), baseline = original.current ? payload(original.current) : null;
      const changes = baseline ? Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== baseline[key as keyof typeof baseline])) : null;
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/service-points${editing ? `/${encodeURIComponent(editing.documentId)}` : ''}`, {
        method: editing ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify(editing ? changes : { ...values, requestId: draft.requestId }),
      });
      const result = await response.json() as { success?: boolean; data?: ServicePoint; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || result.success !== true || !result.data?.documentId) throw new Error(result.message || 'Unable to confirm the service point save. Retry without changing the form.');
      const saved = result.data;
      setRows(current => [...(current ?? []).filter(row => row.documentId !== saved.documentId), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(null); setEditing(null); original.current = null;
      setNotice(editing ? 'Service point updated successfully.' : 'Service point saved successfully.');
    } catch (failure) { if (!controller.signal.aborted) setSaveError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { busy.current = false; setSaving(false); } }
  };
  if (draft) return <section className="category-modal service-point-form-page master-form-page" aria-labelledby="service-point-title">
    <form onSubmit={save}>
      <div className="modal-header master-form-header"><div className="master-form-title"><span className="master-form-icon"><Printer size={24} /></span><div><h3 id="service-point-title">{editing ? 'Edit Service Point' : 'Add Service Point'}</h3><p>{outlet.name} · Service Point details</p></div></div>
        <button type="button" className="modal-close-btn" aria-label="Close service point form" disabled={saving} onClick={() => setDraft(null)}><X size={18} /></button></div>
      <fieldset className="service-point-fields" disabled={saving}>
        <div className="form-field"><label htmlFor="service-point-name">Name</label><input id="service-point-name" autoFocus required maxLength={200} value={draft.name} onChange={event => change('name', event.target.value)} /></div>
        <fieldset className="service-point-options"><legend>Select printer paper size</legend>{[2, 3].map(size => <label key={size}><input type="radio" name="paperSize" value={size} checked={draft.paperSize === size} onChange={() => change('paperSize', size)} />{size} Inch</label>)}</fieldset>
        <fieldset className="service-point-options"><legend>Select printer type</legend>{printerTypes.map((name, index) => <label key={name}><input type="radio" name="printerType" value={index} checked={draft.printerType === index} onChange={() => change('printerType', index)} />{name}</label>)}</fieldset>
        {editing && (![2, 3].includes(draft.paperSize ?? -1) || ![0, 1, 2].includes(draft.printerType ?? -1)) && <p>Some saved printer settings are unavailable or unsupported. They will be preserved unless you select a new value.</p>}
        {draft.printerType === 1 && <div className="service-point-connection">
          <div className="form-field"><label htmlFor="service-point-ip">Printer IP Address (optional)</label><input id="service-point-ip" maxLength={255} value={draft.printerIpAddress} onChange={event => change('printerIpAddress', event.target.value)} /></div>
          <div className="form-field"><label htmlFor="service-point-port">Port</label><input id="service-point-port" type="number" min={0} max={65535} step={1} required value={draft.port} onChange={event => change('port', event.target.value)} /></div>
        </div>}
        {draft.printerType === 2 && <div className="form-field"><label htmlFor="service-point-usb">USB Path (optional)</label><input id="service-point-usb" maxLength={1000} value={draft.usbPath} onChange={event => change('usbPath', event.target.value)} /></div>}
        {(['header', 'subHeader', 'footer'] as const).map(key => <div className="form-field" key={key}><label htmlFor={`service-point-${key}`}>Service Point {key === 'subHeader' ? 'Sub Header' : key === 'header' ? 'Header' : 'Footer'}</label>
          <textarea id={`service-point-${key}`} rows={2} maxLength={2000} value={draft[key]} onChange={event => change(key, event.target.value)} /></div>)}
      </fieldset>
      {saveError && <p className="service-point-error" role="alert">{saveError}</p>}
      <div className="modal-footer"><button type="button" className="btn-secondary" disabled={saving} onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="btn-primary-add" disabled={saving}><Save size={16} />{saving ? 'Saving…' : editing ? 'Update' : 'Save'}</button></div>
    </form>
  </section>;
  return <section className="category-page service-points-page" aria-label="Service Points">
    <div className="category-header-row"><h1>Service Points</h1><button type="button" className="btn-primary-add" disabled={rows === null || !!error} onClick={openAdd}><Plus size={16} />Add Service Point</button></div>
    {notice && <p className="service-point-notice" role="status">{notice}</p>}
    {error ? <div className="service-point-state" role="alert">{error}<button type="button" className="btn-secondary" onClick={() => { setRows(null); setError(''); setReload(value => value + 1); }}><RefreshCw size={15} />Retry</button></div>
      : rows === null ? <p className="service-point-state" role="status">Loading service points…</p>
      : !rows.length ? <p className="service-point-state">No service points yet. Add a service point to get started.</p>
      : <div className="service-points-table"><table><thead><tr><th>Name</th><th>Paper Size</th><th>Printer Type</th><th>Header</th><th>Sub Header</th><th>Footer</th><th>Actions</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.documentId} onClick={() => openEdit(row)}><td><button type="button" className="service-point-name-button" aria-label={`Edit service point ${row.name || 'Unnamed service point'}`} onClick={event => { event.stopPropagation(); openEdit(row); }}>{row.name || 'Unnamed service point'}</button></td><td>{row.paperSize === 2 || row.paperSize === 3 ? `${row.paperSize} Inch` : '—'}</td><td>{row.printerType !== null && printerTypes[row.printerType] || '—'}</td><td>{row.header || '—'}</td><td>{row.subHeader || '—'}</td><td>{row.footer || '—'}</td><td><button type="button" className="service-point-delete-button" aria-label={`Delete service point ${row.name || 'Unnamed service point'}`} onClick={event => { event.stopPropagation(); setNotice(''); setDeleteError(''); setDeleting(row); }}><Trash2 size={15} />Delete</button></td></tr>)}
      </tbody></table></div>}
    {deleting && <DeleteConfirmation kind="service point" name={deleting.name || 'Unnamed service point'} busy={deleteBusy} error={deleteError}
      onCancel={() => { if (!busy.current) setDeleting(null); }} onConfirm={() => void confirmDelete()} />}
  </section>;
}
