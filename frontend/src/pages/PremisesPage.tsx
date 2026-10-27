import { useTimedNotice } from '../utils/useTimedNotice.ts';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Plus, RefreshCw, Search, Store, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { createRequestId } from '../utils/requestId.ts';
import { ANDROID_TAX_OPTIONS } from '../../../shared/androidTaxes.ts';
import './CategoryPage.css';
import './MasterForm.css';
import './PremisesPage.css';

interface Premise { documentId: string; fields: Record<string, unknown> }
interface Configuration {
  premises: Premise[]; nextCode: number;
  taxes: { index: number; percent: number }[];
  userAccounts: { userId: string; name: string }[];
}
interface Draft {
  requestId: string; name: string; code: string; taxIndex: string; userId: string;
  type: 'Table' | 'Room' | 'Bill'; tables: string; range: string; extraPriceFlag: boolean; price: string;
}
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '—';
const sorted = (rows: Premise[]) => [...rows].sort((a, b) => text(a.fields.code).localeCompare(text(b.fields.code), 'en', { numeric: true }));

export function PremisesPage({ outlet, token, onSessionExpired, onClose }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void; onClose?: () => void;
}) {
  const [data, setData] = useState<Configuration | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<Premise | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useTimedNotice();
  const busy = useRef(false);
  const requests = useRef<AbortController | null>(null);
  const endpoint = `/api/outlets/${encodeURIComponent(outlet.id)}/premises`;

  useEffect(() => {
    const controller = new AbortController(); requests.current = controller;
    setData(null); setError(''); setNotice('');
    void (async () => {
      try {
        const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        const result = await response.json() as { data?: Configuration; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load premises.');
        setData(result.data);
        const config = result.data;
        setDraft(current => current ? { ...current, code: current.code || String(config.nextCode),
          userId: current.userId || (config.userAccounts.length === 1 ? config.userAccounts[0]!.userId : '') } : current);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    })();
    return () => controller.abort();
  }, [endpoint, token, onSessionExpired, reload]);

  const visible = useMemo(() => (data?.premises ?? []).filter(row =>
    ['name', 'code', 'type'].some(field => text(row.fields[field]).toLowerCase().includes(search.trim().toLowerCase()))
  ), [data, search]);
  const change = <K extends keyof Draft,>(field: K, value: Draft[K]) => {
    setSaveError(''); setDraft(current => current ? { ...current, [field]: value } : current);
  };
  const openAdd = () => {
    setEditing(null);
    setNotice(''); setSaveError('');
    setDraft({ requestId: createRequestId(), name: '', code: data ? String(data.nextCode) : '',
      taxIndex: '1',
      userId: data?.userAccounts.length === 1 ? data.userAccounts[0]!.userId : '',
      type: 'Table', tables: '1', range: '1', extraPriceFlag: false, price: '0' });
  };
  const openEdit = (premise: Premise) => {
    if (busy.current) return;
    const fields = premise.fields;
    const value = (key: string) => fields[key] === undefined || fields[key] === null ? '' : text(fields[key]);
    setEditing(premise); setSaveError(''); setNotice('');
    setDraft({ requestId: createRequestId(), name: value('name'), code: value('code'), taxIndex: value('taxIndex'),
      userId: value('userId'), type: fields.type as Draft['type'], tables: value('tables'), range: value('range'),
      extraPriceFlag: fields.extraPriceFlag === true, price: value('price') });
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !data || busy.current) return;
    const body = { ...draft, name: draft.name.trim(), code: Number(draft.code), tables: Number(draft.tables),
      range: Number(draft.range), taxIndex: Number(draft.taxIndex), price: Number(draft.price) };
    if (!body.name || !draft.taxIndex || !draft.userId || ![body.code, body.tables, body.range].every(value => Number.isSafeInteger(value) && value > 0)
      || (!onClose && (!draft.price.trim() || !Number.isFinite(body.price) || body.price < 0))) {
      setSaveError('Enter a name, positive whole code/count/range, tax, user account and a non-negative price.'); return;
    }
    const controller = requests.current;
    if (!controller || controller.signal.aborted) return;
    busy.current = true; setSaving(true); setSaveError('');
    try {
      const { requestId: _requestId, ...editable } = body;
      const payload = editing ? Object.fromEntries(Object.entries(editable).filter(([key, value]) =>
        !(onClose && (key === 'price' || key === 'extraPriceFlag')) && value !== editing.fields[key])) : body;
      const response = await fetch(editing ? `${endpoint}/${encodeURIComponent(editing.documentId)}` : endpoint,
        { method: editing ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal });
      const result = await response.json() as { data?: Premise; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || !result.data) throw new Error(result.message || 'Unable to save premises. Retry the same form.');
      const saved = result.data;
      setData(current => current ? { ...current,
        premises: sorted([...current.premises.filter(row => row.documentId !== saved.documentId), saved]),
        nextCode: Math.max(current.nextCode, body.code + 1) } : current);
      setDraft(null); setEditing(null); setSearch(''); setNotice(editing ? 'Premises updated successfully.' : 'Premises created successfully.');
    } catch (failure) { if (!controller.signal.aborted) setSaveError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { busy.current = false; setSaving(false); } }
  };

  if (draft) return (
    <section className="category-modal master-form-page premises-form" aria-labelledby="premise-title">
      <form onSubmit={save}>
        <div className="modal-header master-form-header">
          <div className="master-form-title"><span className="master-form-icon"><Store size={24} /></span>
            <div><h3 id="premise-title">{editing ? 'Edit Premises' : 'Premise Details'}</h3><p>{editing ? 'Edit' : 'Create'} premises for {outlet.name}.</p></div></div>
          <button type="button" className="modal-close-btn" aria-label="Close premises form" disabled={saving} onClick={() => setDraft(null)}><X size={18} /></button>
        </div>
        <fieldset className="premises-fields" disabled={saving}>
          <div className="form-field premises-wide"><label htmlFor="premise-name">Premise Name</label><input id="premise-name" autoFocus required maxLength={200} value={draft.name} onChange={event => change('name', event.target.value)} /></div>
          <div className="form-field"><label htmlFor="premise-code">Code</label><input id="premise-code" type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={draft.code} onChange={event => change('code', event.target.value)} /></div>
          <div className="form-field"><label htmlFor="premise-tax">GST / Tax</label><select id="premise-tax" required value={draft.taxIndex} onChange={event => change('taxIndex', event.target.value)}>
            <option value="">Select Tax</option>{ANDROID_TAX_OPTIONS.map(tax => <option key={tax.index} value={tax.index}>{tax.name}</option>)}
            {draft.taxIndex && !ANDROID_TAX_OPTIONS.some(tax => String(tax.index) === draft.taxIndex)
              && <option value={draft.taxIndex}>Saved tax ({draft.taxIndex})</option>}</select></div>
          <div className="form-field premises-wide"><label htmlFor="premise-user">User Account</label><select id="premise-user" required value={draft.userId} onChange={event => change('userId', event.target.value)}>
            <option value="">Select User Account</option>{(data?.userAccounts ?? []).map(account => <option key={account.userId} value={account.userId}>{account.name}</option>)}
            {draft.userId && !data?.userAccounts.some(account => account.userId === draft.userId)
              && <option value={draft.userId}>Saved account ({draft.userId})</option>}</select></div>
          <fieldset className="premises-types premises-wide"><legend>Premise Type</legend>
            {(['Table', 'Room', 'Bill'] as const).map(type => <label key={type}><input type="radio" name="premise-type" checked={draft.type === type} onChange={() => change('type', type)} />{type}</label>)}
          </fieldset>
          <div className="form-field"><label htmlFor="premise-tables">No. of {draft.type === 'Room' ? 'Rooms' : draft.type === 'Bill' ? 'Bills' : 'Tables'}</label><input id="premise-tables" type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={draft.tables} onChange={event => change('tables', event.target.value)} /></div>
          <div className="form-field"><label htmlFor="premise-range">Range Start With</label><input id="premise-range" type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" required value={draft.range} onChange={event => change('range', event.target.value)} /></div>
          {!onClose && <><label className="premises-extra"><input type="checkbox" checked={draft.extraPriceFlag} onChange={event => change('extraPriceFlag', event.target.checked)} />Extra Price</label>
          <div className="form-field"><label htmlFor="premise-price">Price</label><input id="premise-price" type="number" min="0" step="any" required value={draft.price} onChange={event => change('price', event.target.value)} /></div></>}
          {!data && !error && <p className="product-field-note premises-wide" role="status">Loading premises details. You can enter the information now.</p>}
          {error && <p className="category-form-error premises-wide" role="alert">{error} <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}>Retry</button></p>}
          {data && !data.userAccounts.length && !editing && <p className="category-form-error premises-wide">No active user accounts are assigned to this outlet.</p>}
        </fieldset>
        {saveError && <p className="category-form-error premises-save-error" role="alert">{saveError}</p>}
        <div className="modal-footer"><button type="button" className="btn-secondary" disabled={saving} onClick={() => setDraft(null)}>Cancel</button>
          <button type="submit" className="btn-primary-add" disabled={saving || !data || (!editing && !data.userAccounts.length)}>{saving ? 'Saving…' : editing ? 'Update' : 'Create Premises'}</button></div>
      </form>
    </section>
  );

  return (
    <section className="premises-page" aria-label="Premises" aria-busy={!data && !error}>
      <div className="category-header-row"><div className="category-title-group"><h1><Store size={22} color="#3567f0" />Premises</h1><p>Manage tables, rooms and bill premises.</p></div>
        <div className="category-header-actions">{onClose
          ? <button type="button" className="btn-secondary" onClick={onClose}><ArrowLeft size={16} />Back to Products</button>
          : <button type="button" className="btn-primary-add" onClick={openAdd}><Plus size={16} />Add New Premises</button>}
          <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={15} />Refresh</button></div></div>
      {notice && <p className="premises-notice" role="status">{notice}</p>}
      <div className="category-toolbar"><label className="toolbar-search-box"><span className="search-input-icon"><Search size={16} /></span>
        <input className="search-input" type="search" aria-label="Search premises" placeholder="Search premises name, code, type…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <span className="premises-total">Total Premises <strong>{data?.premises.length ?? '—'}</strong></span></div>
      {error ? <p role="alert" className="category-form-error">{error}<button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}>Retry</button></p>
        : !data ? <p role="status">Loading premises…</p>
        : !visible.length ? <div className="premises-empty">{search ? 'No premises match your search.' : 'No premises created yet.'}</div>
        : <div className="premises-list">{visible.map(row => <button type="button" className="premises-list-item" key={row.documentId} onClick={() => openEdit(row)} aria-label={`Edit premise ${text(row.fields.name)}`}>
          <div><h2><span>{text(row.fields.code)})</span> {text(row.fields.name)}</h2><p>Type {text(row.fields.type)}</p></div>
          <div className="premises-list-count">No. of {row.fields.type === 'Room' ? 'Rooms' : row.fields.type === 'Bill' ? 'Bills' : 'Tables'}: <strong>{text(row.fields.tables)}</strong><small>Range starts at {text(row.fields.range)}</small></div>
        </button>)}</div>}
    </section>
  );
}
