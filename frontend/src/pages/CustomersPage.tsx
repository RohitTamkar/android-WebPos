import { readMasterSnapshot, masterSnapshotRevision } from '../utils/masterSnapshots.ts';
import { useMasterSync } from '../utils/useMasterSync.ts';
import { useRowBatches } from '../utils/useRowBatches.ts';
import { ProductListRequestError, streamList } from './productListApi.ts';
import { OutletMasterDeleteButton } from './OutletMasterDeleteButton.tsx';
import { DeleteConfirmation } from './DeleteConfirmation.tsx';
import { DeleteAllError, deleteAllRecords } from './deleteAllApi.ts';
import { SuccessPopup } from './SuccessPopup.tsx';
import { useTimedNotice } from '../utils/useTimedNotice.ts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MoreVertical, Plus, RefreshCw, Save, Trash2, UsersRound, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { ReportDateInput } from './ReportDateInput.tsx';
import { createRequestId } from '../utils/requestId.ts';
import './CategoryPage.css';
import './MasterForm.css';
import './CustomersPage.css';

interface Customer {
  documentId: string; name: string; contact: string; altContact: string; email: string; gstNo: string; address: string;
  creditLimit: number; dayLimit: number; balance: number; birthdayDate: string; anniversaryDate: string; allowedCredit: boolean;
}
interface CustomerDraft extends Omit<Customer, 'documentId' | 'creditLimit' | 'dayLimit' | 'balance'> {
  requestId: string; creditLimit: string; dayLimit: string; balance: string;
}
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);

export function CustomersPage({ outlet, token, onSessionExpired }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [liveReady, setLiveReady] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [draft, setDraft] = useState<CustomerDraft | null>(null);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useTimedNotice();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllDone, setDeleteAllDone] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    setLiveReady(false);
    const url = `/api/outlets/${encodeURIComponent(outlet.id)}/customers`;
    const cached = readMasterSnapshot<{ customers: Customer[] }>(url, token);
    const revision = masterSnapshotRevision();
    setCustomers(cached?.customers ?? null); setError(''); setDraft(null); setEditing(null); setNotice(''); setSaving(false); busy.current = false;
    // Objects that came from the server; anything else in the list is a local add or edit.
    const fromServer = new WeakSet<Customer>(cached?.customers ?? []);
    const withLocalChanges = (loaded: Customer[]) => (current: Customer[] | null) =>
      [...new Map([...loaded, ...(current ?? []).filter(customer => !fromServer.has(customer))].map(customer => [customer.documentId, customer])).values()]
        .sort((a, b) => a.name.localeCompare(b.name));
    void (async () => {
      try {
        // Without a cached list, show customers batch by batch while the rest streams in.
        const loaded = await streamList<Customer>(url, token, controller.signal, 'customers', received => {
          if (controller.signal.aborted || cached || !received.length) return;
          for (const customer of received) fromServer.add(customer);
          setCustomers(withLocalChanges(received.slice()));
        }, { fromJson: data => (data as { customers?: unknown } | null)?.customers instanceof Array ? (data as { customers: Customer[] }).customers : null,
          snapshot: customers => ({ customers }) });
        if (controller.signal.aborted) return;
        if (revision !== masterSnapshotRevision()) { setReload(value => value + 1); return; }
        for (const customer of loaded) fromServer.add(customer);
        setCustomers(withLocalChanges(loaded));
        setLiveReady(true);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof ProductListRequestError && failure.status === 401) { onSessionExpired(); return; }
        setError((failure as Error).message);
      }
    })();
    return () => controller.abort();
  }, [outlet.id, token, onSessionExpired, reload]);

  useMasterSync(outlet.id, token, 'customers', liveReady && !error && !draft && !saving && !deleteAllOpen, async signal => {
    const revision = masterSnapshotRevision();
    try {
      const loaded = await streamList<Customer>(`/api/outlets/${encodeURIComponent(outlet.id)}/customers`, token, signal, 'customers', () => {},
        { fromJson: data => (data as { customers?: Customer[] } | null)?.customers ?? null, snapshot: customers => ({ customers }) });
      if (!signal.aborted && revision === masterSnapshotRevision()) setCustomers(loaded.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (failure) {
      if (!signal.aborted && failure instanceof ProductListRequestError && failure.status === 401) onSessionExpired();
      else throw failure;
    }
  });

  const openAdd = () => {
    setEditing(null);
    setSaveError(''); setNotice('');
    setDraft({ requestId: createRequestId(), name: '', contact: '', altContact: '', email: '', gstNo: '', address: '',
      creditLimit: '0', dayLimit: '0', balance: '0', birthdayDate: '', anniversaryDate: '', allowedCredit: false });
  };
  const openEdit = (customer: Customer) => {
    if (busy.current) return;
    const { documentId: _documentId, ...fields } = customer;
    setEditing(customer); setSaveError(''); setNotice('');
    setDraft({ ...fields, requestId: '', creditLimit: String(customer.creditLimit), dayLimit: String(customer.dayLimit), balance: String(customer.balance) });
  };
  // Removes only this outlet's customer masters; bills and balances elsewhere are kept.
  const deleteAllCustomers = async () => {
    if (busy.current) return;
    busy.current = true; setDeletingAll(true); setDeleteAllError(''); setNotice('');
    try {
      await deleteAllRecords(outlet.id, token, 'customers');
      setCustomers([]); setDeleteAllOpen(false); setDeleteAllDone(true);
    } catch (failure) {
      if (failure instanceof DeleteAllError && failure.status === 401) { setDeleteAllOpen(false); onSessionExpired(); return; }
      setDeleteAllError((failure as Error).message);
      setReload(value => value + 1);
    } finally { busy.current = false; setDeletingAll(false); }
  };
  const customerDeleted = (documentId: string) => {
    setCustomers(current => current?.filter(customer => customer.documentId !== documentId) ?? null);
    setDraft(null); setEditing(null); setNotice('Customer deleted successfully.');
  };
  const changeText = (key: Exclude<keyof CustomerDraft, 'allowedCredit' | 'requestId'>, value: string) => {
    setSaveError(''); setDraft(current => current ? { ...current, [key]: value } : current);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || busy.current) return;
    const controller = request.current;
    if (!controller || controller.signal.aborted) return;
    setSaveError('');
    const body = { ...draft, creditLimit: Number(draft.creditLimit), dayLimit: Number(draft.dayLimit), balance: Number(draft.balance) };
    if (![body.creditLimit, body.dayLimit, body.balance].every(Number.isFinite) || !Number.isInteger(body.dayLimit) || body.dayLimit < 0) {
      setSaveError('Enter valid amounts and a non-negative whole day limit.'); return;
    }
    busy.current = true; setSaving(true);
    try {
      const { requestId: _requestId, ...editable } = body;
      const payload = editing ? Object.fromEntries(Object.entries(editable).filter(([key, value]) => value !== editing[key as keyof Customer])) : body;
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/customers${editing ? `/${encodeURIComponent(editing.documentId)}` : ''}`, {
        method: editing ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      const result = await response.json() as { data?: Customer; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || !result.data) throw new Error(result.message || 'Unable to save customer.');
      const saved = result.data;
      setCustomers(current => [...(current ?? []).filter(row => row.documentId !== saved.documentId), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(null); setEditing(null); setNotice(editing ? 'Customer updated successfully.' : 'Customer added successfully.');
    } catch (failure) { if (!controller.signal.aborted) setSaveError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { busy.current = false; setSaving(false); } }
  };

  const { rows: shownCustomers, hasMore: moreCustomers, sentinelRef: moreCustomersRef } = useRowBatches(customers ?? [], outlet.id);
  if (draft) return <section className="category-modal customer-form-page master-form-page" aria-labelledby="customer-form-title"><form onSubmit={save}>
    <div className="modal-header master-form-header"><div className="master-form-title"><span className="master-form-icon" aria-hidden="true"><UsersRound size={24} /></span><div><h3 id="customer-form-title">{editing ? 'Edit Customer' : 'Add Customer'}</h3><p>{outlet.name} · Contact, billing and credit details</p></div></div><button type="button" className="modal-close-btn" aria-label="Close customer form" disabled={saving} onClick={() => setDraft(null)}><X size={18} /></button></div>
    <fieldset className="customer-form-fields" disabled={saving}>
      <div className="master-form-section-heading"><span>01</span><h4>Contact information</h4></div>
      <div className="form-field"><label htmlFor="customer-name">Name</label><input id="customer-name" placeholder="Customer or business name" autoFocus autoComplete="name" maxLength={200} value={draft.name} onChange={event => changeText('name', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-contact">Mobile Number</label><input id="customer-contact" placeholder="Enter mobile number" type="tel" autoComplete="tel" maxLength={30} pattern="\+?[0-9 \(\)\-]+" value={draft.contact} onChange={event => changeText('contact', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-alt-contact">Alternate Mobile Number</label><input id="customer-alt-contact" placeholder="Optional alternate number" type="tel" maxLength={30} pattern="\+?[0-9 \(\)\-]+" value={draft.altContact} onChange={event => changeText('altContact', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-email">Email ID</label><input id="customer-email" placeholder="name@example.com" type="email" autoComplete="email" maxLength={320} value={draft.email} onChange={event => changeText('email', event.target.value)} /></div>
      <div className="master-form-section-heading"><span>02</span><h4>Business details</h4></div>
      <div className="form-field"><label htmlFor="customer-gst">GST Number</label><input id="customer-gst" placeholder="Enter GST number" maxLength={100} value={draft.gstNo} onChange={event => changeText('gstNo', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-address">Address</label><textarea id="customer-address" placeholder="Street, area, city and PIN code" autoComplete="street-address" maxLength={2000} rows={3} value={draft.address} onChange={event => changeText('address', event.target.value)} /></div>
      <div className="master-form-section-heading"><span>03</span><h4>Credit & balance</h4></div>
      <div className="form-field"><label htmlFor="customer-credit-limit">Credit Limit</label><input id="customer-credit-limit" type="number" step="0.01" value={draft.creditLimit} onChange={event => changeText('creditLimit', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-day-limit">Day Limit</label><input id="customer-day-limit" type="number" step="1" min={0} value={draft.dayLimit} onChange={event => changeText('dayLimit', event.target.value)} /></div>
      <div className="form-field"><label htmlFor="customer-balance">Old Balance</label><input id="customer-balance" type="number" step="0.01" value={draft.balance} onChange={event => changeText('balance', event.target.value)} /></div>
      <div className="master-form-section-heading"><span>04</span><h4>Important dates</h4></div>
      <div className="form-field"><label htmlFor="customer-birth-date">Birth Date</label><ReportDateInput id="customer-birth-date" aria-label="Birth Date" value={draft.birthdayDate} onChange={value => changeText('birthdayDate', value)} disabled={saving} /></div>
      <div className="form-field"><label htmlFor="customer-anniversary-date">Anniversary Date</label><ReportDateInput id="customer-anniversary-date" aria-label="Anniversary Date" value={draft.anniversaryDate} onChange={value => changeText('anniversaryDate', value)} disabled={saving} /></div>
      <div className="form-field customer-credit-option"><label className="customer-credit-checkbox" htmlFor="customer-credit-only"><input id="customer-credit-only" type="checkbox" checked={draft.allowedCredit} onChange={event => { setSaveError(''); setDraft(current => current ? { ...current, allowedCredit: event.target.checked } : current); }} />Credit Only</label><small>Set the customer’s credit preference.</small></div>
    </fieldset>
    {saveError && <p className="customer-save-error" role="alert">{saveError}</p>}
    <div className="modal-footer">{editing && !saving && <OutletMasterDeleteButton outletId={outlet.id} token={token} collection="customers" documentId={editing.documentId} name={editing.name || 'Unnamed customer'} onSessionExpired={onSessionExpired} onDeleted={() => customerDeleted(editing.documentId)} />}<button type="button" className="btn-secondary" disabled={saving} onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="btn-primary-add" disabled={saving}>{saving ? <RefreshCw size={16} /> : <Save size={16} />}{saving ? 'Saving…' : editing ? 'Update Customer' : 'Save Customer'}</button></div>
  </form></section>;

  return <section className="customers-page category-page-shell">
    {deleteAllOpen && <DeleteConfirmation kind="customer" name="all customers" busy={deletingAll} error={deleteAllError}
      title="Delete all customers?" description={`Are you sure you want to delete all customers? This will permanently remove all ${customers?.length ?? 0} customers of this outlet.`}
      confirmLabel="Yes" cancelLabel="No" onCancel={() => { if (!busy.current) setDeleteAllOpen(false); }} onConfirm={() => void deleteAllCustomers()} />}
    {deleteAllDone && <SuccessPopup message="Customers deleted successfully" onDismiss={() => setDeleteAllDone(false)} />}
    <div className="category-header-row"><div className="category-title-group"><h1><UsersRound size={22} /> Customers</h1><p>{outlet.name} · Your outlet’s customer list.</p></div>
      <div className="category-header-actions category-master-actions">
        <button type="button" className="btn-primary-add" disabled={!customers || !!error} onClick={openAdd}><Plus size={16} /> Add Customer</button>
        <div className="category-more-actions">
          <button type="button" className="category-menu-toggle" aria-label="Customer options" aria-expanded={menuOpen}
            aria-controls="customer-options-menu" onClick={() => setMenuOpen(value => !value)}><MoreVertical size={17} /></button>
          {menuOpen && <div id="customer-options-menu" className="category-options-menu">
            <button type="button" disabled={!customers || !!error || deletingAll || !customers.length} onClick={() => { setMenuOpen(false); setDeleteAllError(''); setDeleteAllOpen(true); }}><Trash2 size={14} />Delete All</button>
          </div>}
        </div>
      </div></div>
    {notice && <p className="customer-notice" role="status">{notice}</p>}
    {error ? <div className="customer-state"><p role="alert">{error}</p><button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : !customers ? <p className="customer-state" role="status">Loading customers…</p> : !customers.length ?
      <div className="customer-state"><UsersRound size={28} /><h2>No customers found</h2><p>Add your first customer for this outlet.</p><button type="button" className="btn-primary-add" onClick={openAdd}><Plus size={16} /> Add Customer</button></div> :
      <div className="customers-table-scroll"><table><thead><tr><th>Name</th><th>Mobile Number</th><th>Alternate Mobile</th><th>Email ID</th><th>GST Number</th><th>Credit Limit</th><th>Day Limit</th><th>Balance</th><th>Credit Only</th><th>Actions</th></tr></thead><tbody>{shownCustomers.map(customer => <tr key={customer.documentId} onClick={() => openEdit(customer)}><td><button type="button" className="customer-edit-button" aria-label={`Edit customer ${customer.name || 'Unnamed customer'}`} onClick={event => { event.stopPropagation(); openEdit(customer); }}>{customer.name || '—'}</button></td><td>{customer.contact || '—'}</td><td>{customer.altContact || '—'}</td><td>{customer.email || '—'}</td><td>{customer.gstNo || '—'}</td><td>{money(customer.creditLimit)}</td><td>{customer.dayLimit}</td><td>{money(customer.balance)}</td><td>{customer.allowedCredit ? 'Yes' : 'No'}</td><td><OutletMasterDeleteButton outletId={outlet.id} token={token} collection="customers" documentId={customer.documentId} name={customer.name || 'Unnamed customer'} onSessionExpired={onSessionExpired} onDeleted={() => customerDeleted(customer.documentId)} /></td></tr>)}</tbody></table>{moreCustomers && <div ref={moreCustomersRef} className="customers-more-rows" role="status">Showing {shownCustomers.length} of {customers.length} customers…</div>}</div>}
  </section>;
}
