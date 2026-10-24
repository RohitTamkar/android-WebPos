import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, Save, UsersRound, X } from 'lucide-react';
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
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<CustomerDraft | null>(null);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    setCustomers(null); setError(''); setDraft(null); setNotice(''); setSaving(false); busy.current = false;
    void (async () => {
      try {
        const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/customers`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { data?: { customers: Customer[] }; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load customers.');
        setCustomers(result.data.customers);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    })();
    return () => controller.abort();
  }, [outlet.id, token, onSessionExpired, reload]);

  const openAdd = () => {
    setSaveError(''); setNotice('');
    setDraft({ requestId: createRequestId(), name: '', contact: '', altContact: '', email: '', gstNo: '', address: '',
      creditLimit: '0', dayLimit: '0', balance: '0', birthdayDate: '', anniversaryDate: '', allowedCredit: false });
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
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/customers`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      });
      const result = await response.json() as { data?: Customer; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || !result.data) throw new Error(result.message || 'Unable to save customer.');
      const saved = result.data;
      setCustomers(current => [...(current ?? []).filter(row => row.documentId !== saved.documentId), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(null); setNotice('Customer added successfully.');
    } catch (failure) { if (!controller.signal.aborted) setSaveError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { busy.current = false; setSaving(false); } }
  };

  if (draft) return <section className="category-modal customer-form-page master-form-page" aria-labelledby="customer-form-title"><form onSubmit={save}>
    <div className="modal-header master-form-header"><div className="master-form-title"><span className="master-form-icon" aria-hidden="true"><UsersRound size={24} /></span><div><h3 id="customer-form-title">Add Customer</h3><p>{outlet.name} · Contact, billing and credit details</p></div></div><button type="button" className="modal-close-btn" aria-label="Close customer form" disabled={saving} onClick={() => setDraft(null)}><X size={18} /></button></div>
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
    <div className="modal-footer"><button type="button" className="btn-secondary" disabled={saving} onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="btn-primary-add" disabled={saving}>{saving ? <RefreshCw size={16} /> : <Save size={16} />}{saving ? 'Saving…' : 'Save Customer'}</button></div>
  </form></section>;

  return <section className="customers-page category-page-shell">
    <div className="category-header-row"><div className="category-title-group"><h1><UsersRound size={22} /> Customers</h1><p>{outlet.name} · Your outlet’s customer list.</p></div><button type="button" className="btn-primary-add" disabled={!customers || !!error} onClick={openAdd}><Plus size={16} /> Add Customer</button></div>
    {notice && <p className="customer-notice" role="status">{notice}</p>}
    {error ? <div className="customer-state"><p role="alert">{error}</p><button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : !customers ? <p className="customer-state" role="status">Loading customers…</p> : !customers.length ?
      <div className="customer-state"><UsersRound size={28} /><h2>No customers found</h2><p>Add your first customer for this outlet.</p><button type="button" className="btn-primary-add" onClick={openAdd}><Plus size={16} /> Add Customer</button></div> :
      <div className="customers-table-scroll"><table><thead><tr><th>Name</th><th>Mobile Number</th><th>Alternate Mobile</th><th>Email ID</th><th>GST Number</th><th>Credit Limit</th><th>Day Limit</th><th>Balance</th><th>Credit Only</th></tr></thead><tbody>{customers.map(customer => <tr key={customer.documentId}><td>{customer.name || '—'}</td><td>{customer.contact || '—'}</td><td>{customer.altContact || '—'}</td><td>{customer.email || '—'}</td><td>{customer.gstNo || '—'}</td><td>{money(customer.creditLimit)}</td><td>{customer.dayLimit}</td><td>{money(customer.balance)}</td><td>{customer.allowedCredit ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>}
  </section>;
}
