import { readMasterSnapshot, rememberMasterSnapshot, masterSnapshotRevision, invalidateMasterSnapshots } from '../utils/masterSnapshots.ts';
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import './OutletLogoPage.css';

type Props = { outletId: string; outletName: string; token: string };
type Variant = 'header' | 'footer';
type Preview = { revision: number; source: string; generation: string | null; loading: boolean; error: string };
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const emptyPreview = (revision: number): Preview => ({ revision, source: '', generation: null, loading: true, error: '' });

function LogoEditor({ outletId, outletName, token, variant, onBusyChange }: Props & { variant: Variant; onBusyChange: (busy: boolean) => void }) {
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<Preview>(() => emptyPreview(0));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [removalMessage, setRemovalMessage] = useState('');
  const confirmation = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mutation = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const current = preview.revision === revision ? preview : emptyPreview(revision);
  const label = variant === 'header' ? 'Header Logo' : 'Footer Logo';
  const endpoint = `/api/outlets/${encodeURIComponent(outletId)}/logo?variant=${variant}`;

  useEffect(() => {
    if (removalMessage) confirmation.current?.showModal();
  }, [removalMessage]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; mutation.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 16_000);
    let generation: string | null = null, active = true, freshSettled = false;
    const objectUrls = new Set<string>();
    const snapshotKey = `${endpoint}#${outletName}`;
    const cached = readMasterSnapshot<Blob>(snapshotKey, token);
    const snapshotRevision = masterSnapshotRevision();
    const makeUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); objectUrls.add(url); return url; };
    if (cached) void (async () => {
      try {
        const url = makeUrl(cached), image = new Image(); image.src = url; await image.decode();
        if (active && !freshSettled) setPreview({ revision, source: url, generation: null, loading: true, error: '' });
      } catch { /* Fresh validation below remains authoritative. */ }
    })();
    void (async () => {
      try {
        const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        const version = response.headers.get('X-Logo-Generation');
        generation = version && /^[1-9]\d*$/.test(version) ? version : null;
        if (response.status === 404) {
          freshSettled = true;
          if (active) setPreview({ revision, source: '', generation: generation ?? '0', loading: false, error: '' });
          return;
        }
        if (!response.ok) throw new Error('Unable to load this logo. Select the tab again to retry.');
        if (!generation) throw new Error('The logo version could not be verified. Select the tab again to retry.');
        const blob = await response.blob();
        if (!IMAGE_TYPES.includes(blob.type) || !blob.size || blob.size > 5 * 1024 * 1024) throw new Error('This image cannot be displayed. Upload a valid JPEG, PNG or WebP image.');
        if (!active || controller.signal.aborted) return;
        const objectUrl = makeUrl(blob);
        const image = new Image(); image.src = objectUrl;
        await image.decode();
        if (active && !controller.signal.aborted) {
          freshSettled = true; rememberMasterSnapshot(snapshotKey, token, blob, snapshotRevision);
          setPreview({ revision, source: objectUrl, generation, loading: false, error: '' });
        }
      } catch (error) {
        freshSettled = true;
        if (active) setPreview({ revision, source: '', generation, loading: false,
          error: controller.signal.aborted ? 'Loading timed out. Select the tab again to retry.' : (error as Error).message });
      } finally { window.clearTimeout(timeout); }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); for (const url of objectUrls) URL.revokeObjectURL(url); };
  }, [endpoint, outletName, token, revision]);

  const save = async (file?: File) => {
    if (busyRef.current || current.loading || current.generation === null) return;
    if (!file && (!current.source || current.generation === '0')) return;
    if (file && (!IMAGE_TYPES.includes(file.type) || !file.size || file.size > 5 * 1024 * 1024)) {
      setNotice({ error: true, message: 'Choose a JPEG, PNG or WebP image up to 5 MB.' }); return;
    }
    busyRef.current = true; setBusy(true); onBusyChange(true); setNotice(null);
    const controller = new AbortController(); mutation.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let attempted = false;
    try {
      if (file) {
        const url = URL.createObjectURL(file);
        try { const image = new Image(); image.src = url; await image.decode(); }
        catch { throw new Error('The selected file is not a readable image. Choose another image.'); }
        finally { URL.revokeObjectURL(url); }
      }
      if (!alive.current || controller.signal.aborted) return;
      attempted = true; invalidateMasterSnapshots(endpoint);
      const response = await fetch(endpoint, { method: file ? 'PUT' : 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'X-Logo-Expected-Generation': current.generation, ...(file ? { 'Content-Type': file.type } : {}) },
        body: file, signal: controller.signal });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || 'Unable to confirm this logo change.');
      if (alive.current) {
        if (!file) {
          setPreview({ revision, source: '', generation: '0', loading: false, error: '' });
          setRemovalMessage(`${label} removed successfully.`);
        }
        setNotice({ error: false, message: `${label} ${file ? 'uploaded' : 'removed'} successfully.` });
      }
    } catch (error) {
      if (alive.current) setNotice({ error: true, message: controller.signal.aborted
        ? 'The change could not be confirmed. The preview will reload; review it before trying again.' : (error as Error).message });
    } finally {
      window.clearTimeout(timeout); mutation.current = null; busyRef.current = false;
      if (alive.current) {
        setBusy(false); onBusyChange(false);
        if (attempted) { invalidateMasterSnapshots(endpoint); setRevision(value => value + 1); } // Reconcile success, conflicts and uncertain outcomes; never retry mutations automatically.
      }
    }
  };

  return <>
    <div className="outlet-logo-preview" role="tabpanel" id={`logo-panel-${variant}`} aria-labelledby={`logo-tab-${variant}`} aria-busy={current.loading || busy}>
      {current.source && <img src={current.source} alt={`${outletName} ${label}`} decoding="async"
        onError={() => setPreview(value => ({ ...value, source: '' }))} />}
      {current.loading && !current.source && <span className="outlet-logo-loading"><LoaderCircle size={20} />Loading logo…</span>}
    </div>
    <div className="outlet-logo-feedback" aria-live="polite">
      {(notice?.message || current.error) && <p role={notice?.error || (!notice && current.error) ? 'alert' : 'status'} className={notice?.error || (!notice && current.error) ? 'logo-error' : 'logo-success'}>{notice?.message || current.error}</p>}
    </div>
    <div className="outlet-logo-actions">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Choose ${label}`} hidden
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void save(file); }} />
      <button type="button" className="logo-upload" disabled={busy || current.loading || current.generation === null} onClick={() => input.current?.click()}>
        {busy ? <LoaderCircle size={17} /> : <ImagePlus size={17} />}{busy ? 'Please wait…' : `Upload ${label}`}
      </button>
      <button type="button" className="logo-remove" disabled={busy || current.loading || !current.source || !current.generation || current.generation === '0'}
        onClick={() => void save()}><Trash2 size={17} />Remove</button>
    </div>
    <p className="outlet-logo-hint">JPEG, PNG or WebP · Up to 5 MB</p>
    <dialog ref={confirmation} className="outlet-logo-confirm" aria-labelledby={`logo-removed-${variant}`}
      aria-describedby={`logo-removed-message-${variant}`} onClose={() => setRemovalMessage('')}>
      <h2 id={`logo-removed-${variant}`}>Logo removed</h2>
      <p id={`logo-removed-message-${variant}`}>{removalMessage}</p>
      <div><button type="button" className="logo-upload" onClick={() => confirmation.current?.close()}>OK</button></div>
    </dialog>
  </>;
}

function LogoManager(props: Props) {
  const [variant, setVariant] = useState<Variant>('header');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  return <section className="outlet-logo-page" aria-label="Outlet logo">
    <header className="outlet-logo-heading"><span>MASTERS</span><h1>Outlet Logo</h1><p>{props.outletName}</p></header>
    <div className="outlet-logo-card">
      <div className="outlet-logo-tabs" role="tablist" aria-label="Logo type">{(['header', 'footer'] as const).map(type => <button key={type} type="button"
        id={`logo-tab-${type}`} role="tab" aria-selected={variant === type} aria-controls={`logo-panel-${type}`} disabled={busy}
        onClick={() => { setVariant(type); setRefresh(value => value + 1); }}>{type === 'header' ? 'Header Logo' : 'Footer Logo'}</button>)}</div>
      <LogoEditor key={`${variant}:${refresh}`} {...props} variant={variant} onBusyChange={setBusy} />
    </div>
  </section>;
}
export function OutletLogoPage(props: Props) {
  return <LogoManager key={JSON.stringify([props.token, props.outletId, props.outletName])} {...props} />;
}
