import { readMasterSnapshot, masterSnapshotRevision, rememberMasterSnapshot } from '../utils/masterSnapshots.ts';
import { OutletMasterDeleteButton } from './OutletMasterDeleteButton.tsx';
import { DeleteConfirmation } from './DeleteConfirmation.tsx';
import { DeleteAllError, deleteAllRecords } from './deleteAllApi.ts';
import { SuccessPopup } from './SuccessPopup.tsx';
import { useTimedNotice } from '../utils/useTimedNotice.ts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MoreVertical, Plus, RefreshCw, Save, Trash2, UserRoundCog, X } from 'lucide-react';
import type { OutletSummary } from './OutletSelectionPage.tsx';
import { ReportDateInput } from './ReportDateInput.tsx';
import { createRequestId } from '../utils/requestId.ts';
import './CategoryPage.css';
import './MasterForm.css';
import './EmployeesPage.css';

interface Employee {
  documentId: string; name: string; mobile: string; searchCode: number | null;
  shortName: string; balanceAmt: string; dateOfJoining: string; userId: string;
}
interface EmployeeList { employees: Employee[]; nextSearchCode: number; userAccounts: { userId: string; name: string }[] }
interface Draft { requestId: string; name: string; mobile: string; searchCode: string; shortName: string; balanceAmt: string; dateOfJoining: string; userId: string }

export function EmployeesPage({ outlet, token, onSessionExpired }: {
  outlet: OutletSummary; token: string; onSessionExpired: () => void;
}) {
  const [data, setData] = useState<EmployeeList | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState('Employee');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useTimedNotice();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const requests = useRef<AbortController | null>(null);
  const shortNameEdited = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllDone, setDeleteAllDone] = useState(false);

  useEffect(() => {
    const controller = new AbortController(); requests.current = controller;
    const url = `/api/outlets/${encodeURIComponent(outlet.id)}/employees`;
    const cached = readMasterSnapshot<EmployeeList>(url, token);
    const revision = masterSnapshotRevision();
    setData(cached ?? null); setError(''); setDraft(null); setNotice(''); setSelectedId(''); setSaving(false); busy.current = false;
    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        const result = await response.json() as { data?: EmployeeList; message?: string };
        if (controller.signal.aborted) return;
        if (response.status === 401) { onSessionExpired(); return; }
        if (!response.ok || !result.data) throw new Error(result.message || 'Unable to load employees.');
        if (revision !== masterSnapshotRevision()) { setReload(value => value + 1); return; }
        rememberMasterSnapshot(url, token, result.data, revision);
        setData(result.data);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    })();
    return () => controller.abort();
  }, [outlet.id, token, onSessionExpired, reload]);

  useEffect(() => {
    if (!draft) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy.current) setDraft(null); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [draft]);

  const openAdd = () => {
    if (!data) return;
    shortNameEdited.current = false; setSaveError(''); setNotice('');
    setDraft({ requestId: createRequestId(), name: '', mobile: '', searchCode: String(data.nextSearchCode),
      shortName: '', balanceAmt: '0', dateOfJoining: '', userId: '' });
  };
  const change = (key: keyof Draft, value: string) => {
    setSaveError(''); setDraft(current => current ? { ...current, [key]: value } : current);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !data || busy.current) return;
    setSaveError('');
    const searchCode = Number(draft.searchCode);
    if (!draft.name.trim() || !draft.mobile.trim() || !draft.shortName.trim()) { setSaveError('Name, mobile and short name are required.'); return; }
    if (!Number.isSafeInteger(searchCode) || searchCode < 1) { setSaveError('Enter a positive whole search code.'); return; }
    if (!/^\+?(?=.*\d)[\d ()-]+$/.test(draft.mobile.trim())) { setSaveError('Enter a valid mobile number.'); return; }
    const controller = requests.current;
    if (!controller || controller.signal.aborted) return;
    busy.current = true; setSaving(true);
    try {
      const response = await fetch(`/api/outlets/${encodeURIComponent(outlet.id)}/employees`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, name: draft.name.trim(), mobile: draft.mobile.trim(), shortName: draft.shortName.trim(), searchCode }), signal: controller.signal,
      });
      const result = await response.json() as { data?: Employee; message?: string };
      if (controller.signal.aborted) return;
      if (response.status === 401) { onSessionExpired(); return; }
      if (!response.ok || !result.data) throw new Error(result.message || 'Unable to save employee.');
      const saved = result.data;
      setData(current => current ? { ...current,
        employees: [...current.employees.filter(row => row.documentId !== saved.documentId), saved]
          .sort((a, b) => (a.searchCode ?? Infinity) - (b.searchCode ?? Infinity)),
        nextSearchCode: Math.max(current.nextSearchCode, (saved.searchCode ?? 0) + 1),
      } : current);
      setSelectedId(saved.documentId); setDraft(null); setNotice(`${kind} added successfully.`);
    } catch (failure) { if (!controller.signal.aborted) setSaveError((failure as Error).message); }
    finally { if (!controller.signal.aborted) { busy.current = false; setSaving(false); } }
  };
  const selected = data?.employees.find(row => row.documentId === selectedId);
  // Removes only this outlet's employee masters; bills and user accounts are kept.
  const deleteAllEmployees = async () => {
    if (busy.current) return;
    busy.current = true; setDeletingAll(true); setDeleteAllError(''); setNotice('');
    try {
      await deleteAllRecords(outlet.id, token, 'employees');
      setData(current => current ? { ...current, employees: [] } : current);
      setSelectedId(''); setDeleteAllOpen(false); setDeleteAllDone(true);
    } catch (failure) {
      if (failure instanceof DeleteAllError && failure.status === 401) { setDeleteAllOpen(false); onSessionExpired(); return; }
      setDeleteAllError((failure as Error).message);
      setReload(value => value + 1);
    } finally { busy.current = false; setDeletingAll(false); }
  };

  if (draft) return <section className="category-modal employee-form-page master-form-page" aria-labelledby="employee-form-title"><form onSubmit={save}>
        <div className="modal-header master-form-header"><div className="master-form-title"><span className="master-form-icon" aria-hidden="true"><UserRoundCog size={24} /></span><div><h3 id="employee-form-title">Add {kind}</h3><p>{outlet.name} · Personal and work details</p></div></div><button type="button" className="modal-close-btn" aria-label="Close employee form" disabled={saving} onClick={() => setDraft(null)}><X size={18} /></button></div>
        <fieldset className="employees-form-fields" disabled={saving}>
          <div className="master-form-section-heading"><span>01</span><h4>Personal information</h4></div>
          <div className="form-field"><label htmlFor="employee-name">Employee Name*</label><input id="employee-name" placeholder="Full name" value={draft.name} required maxLength={200} autoFocus onChange={event => { const value = event.target.value; setSaveError(''); setDraft(current => current ? { ...current, name: value, shortName: shortNameEdited.current ? current.shortName : Array.from(value.trim())[0] ?? '' } : current); }} /></div>
          <div className="form-field"><label htmlFor="employee-mobile">Mobile*</label><input id="employee-mobile" placeholder="Enter mobile number" type="tel" value={draft.mobile} required maxLength={30} pattern="\+?[0-9 \(\)\-]+" onChange={event => change('mobile', event.target.value)} /></div>
          <div className="master-form-section-heading"><span>02</span><h4>Work details</h4></div>
          <div className="form-field"><label htmlFor="employee-code">Search code</label><input id="employee-code" type="number" min={1} step={1} required value={draft.searchCode} onChange={event => change('searchCode', event.target.value)} /></div>
          <div className="form-field"><label htmlFor="employee-short-name">Short name</label><input id="employee-short-name" placeholder="Initials or short name" required maxLength={200} value={draft.shortName} onChange={event => { shortNameEdited.current = true; change('shortName', event.target.value); }} /></div>
          <div className="master-form-section-heading"><span>03</span><h4>Balance & joining date</h4></div>
          <div className="form-field"><label htmlFor="employee-balance">Balance</label><input id="employee-balance" type="number" step="0.01" required value={draft.balanceAmt} onChange={event => change('balanceAmt', event.target.value)} /></div>
          <div className="form-field"><label>Joining Date</label><ReportDateInput aria-label="Joining Date" value={draft.dateOfJoining} onChange={value => change('dateOfJoining', value)} disabled={saving} /></div>
          <div className="master-form-section-heading"><span>04</span><h4>Account assignment</h4></div>
          <div className="form-field"><label htmlFor="employee-user">Assign To User Account</label><select id="employee-user" value={draft.userId} onChange={event => change('userId', event.target.value)}><option value="">Not assigned</option>{data?.userAccounts.map(user => <option key={user.userId} value={user.userId}>{user.name || 'User account'}</option>)}</select></div>
        </fieldset>
        {saveError && <p className="employees-save-error" role="alert">{saveError}</p>}
        <div className="modal-footer"><button type="button" className="btn-secondary" disabled={saving} onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="btn-primary-add" disabled={saving}>{saving ? <RefreshCw size={16} /> : <Save size={16} />}{saving ? 'Saving…' : 'Save'}</button></div>
      </form></section>;

  return <section className="employees-page category-page-shell">
    {deleteAllOpen && <DeleteConfirmation kind="employee" name="all employees" busy={deletingAll} error={deleteAllError}
      title="Delete all employees?" description={`Are you sure you want to delete all employees? This will permanently remove all ${data?.employees.length ?? 0} employees and salesmen of this outlet.`}
      confirmLabel="Yes" cancelLabel="No" onCancel={() => { if (!busy.current) setDeleteAllOpen(false); }} onConfirm={() => void deleteAllEmployees()} />}
    {deleteAllDone && <SuccessPopup message="Employees deleted successfully" onDismiss={() => setDeleteAllDone(false)} />}
    <div className="category-header-row"><div className="category-title-group"><h1><UserRoundCog size={22} /> Employees / Salesman</h1><p>{outlet.name} · Select a person from your outlet’s employee list.</p></div>
      <div className="category-header-actions category-master-actions">
        <button type="button" className="btn-primary-add" disabled={!data || !!error} onClick={openAdd}><Plus size={16} /> Add {kind}</button>
        <div className="category-more-actions">
          <button type="button" className="category-menu-toggle" aria-label="Employee options" aria-expanded={menuOpen}
            aria-controls="employee-options-menu" onClick={() => setMenuOpen(value => !value)}><MoreVertical size={17} /></button>
          {menuOpen && <div id="employee-options-menu" className="category-options-menu">
            <button type="button" disabled={!data || !!error || deletingAll || !data.employees.length} onClick={() => { setMenuOpen(false); setDeleteAllError(''); setDeleteAllOpen(true); }}><Trash2 size={14} />Delete All</button>
          </div>}
        </div>
      </div></div>
    <div className="employees-selection"><label htmlFor="employee-selection-kind">Select as</label><select id="employee-selection-kind" value={kind} disabled={!!draft} onChange={event => { setKind(event.target.value); setNotice(''); }}><option>Employee</option><option>Salesman</option></select>
      {selected && <p role="status">Selected {kind.toLowerCase()}: <strong>{selected.name}</strong> · {selected.mobile}</p>}</div>
    {notice && <p className="employees-notice" role="status">{notice}</p>}
    {error ? <div className="employees-state"><p role="alert">{error}</p><button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Retry</button></div> : !data ? <p className="employees-state" role="status">Loading employees…</p> : !data.employees.length ?
      <div className="employees-state"><UserRoundCog size={28} /><h2>No employees found</h2><p>Add a {kind.toLowerCase()} to get started.</p><button type="button" className="btn-primary-add" onClick={openAdd}><Plus size={16} /> Add {kind}</button></div> :
      <div className="employees-table-scroll"><table><thead><tr><th>Select</th><th>Name</th><th>Mobile</th><th>Search code</th><th>Balance</th><th>Joining date</th><th>User account</th><th>Actions</th></tr></thead><tbody>{data.employees.map(employee => <tr key={employee.documentId} className={selectedId === employee.documentId ? 'selected' : ''}>
        <td><input id={`employee-${employee.documentId}`} type="radio" name="selected-employee" aria-label={`Select ${employee.name}`} checked={selectedId === employee.documentId} onChange={() => setSelectedId(employee.documentId)} /></td>
        <td><label htmlFor={`employee-${employee.documentId}`}>{employee.name}</label></td><td>{employee.mobile || '—'}</td><td>{employee.searchCode ?? '—'}</td><td>{employee.balanceAmt || '0'}</td><td>{employee.dateOfJoining || '—'}</td>
        <td>{employee.userId ? data.userAccounts.find(user => user.userId === employee.userId)?.name || 'Assigned account' : 'Not assigned'}</td>
        <td><OutletMasterDeleteButton outletId={outlet.id} token={token} collection="employees" documentId={employee.documentId} name={employee.name || 'Unnamed employee'} onSessionExpired={onSessionExpired} onDeleted={() => { setData(current => current ? { ...current, employees: current.employees.filter(row => row.documentId !== employee.documentId) } : current); if (selectedId === employee.documentId) setSelectedId(''); setNotice('Employee deleted successfully.'); }} /></td>
      </tr>)}</tbody></table></div>}

  </section>;
}
