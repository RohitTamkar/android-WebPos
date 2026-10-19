import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';
localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'Current User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'shop', name: 'Existing Shop' }));
const checks: string[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + message); }
interface Customer { documentId: string; name: string; contact: string; altContact: string; email: string; gstNo: string; address: string; creditLimit: number; dayLimit: number; balance: number; birthdayDate: string; anniversaryDate: string; allowedCredit: boolean }
let records: Customer[] = [{ documentId: 'existing', name: 'Database Customer', contact: '9876543210', altContact: '', email: 'database@example.com', gstNo: '', address: '', creditLimit: 100, dayLimit: 10, balance: 75.25, birthdayDate: '', anniversaryDate: '', allowedCredit: true }];
const submissions: Record<string, unknown>[] = [];
let getStatus = 200, postStatus = 200;
let releaseGet: (() => void) | undefined, releasePost: (() => void) | undefined;
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes('/dashboard?')) return Response.json({ data: { payments: {} } });
  assert(path === '/api/outlets/shop/customers', 'Customer requests use the selected outlet');
  assert((init?.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'Customer requests include session authentication');
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body)); submissions.push(body);
    await new Promise<void>(resolve => { releasePost = resolve; });
    if (postStatus !== 200) return Response.json({ message: 'Unable to confirm customer save. Retry.' }, { status: postStatus });
    const { requestId: _requestId, ...fields } = body;
    const saved = { ...fields, documentId: 'saved-customer' } as Customer;
    records.push(saved); return Response.json({ success: true, data: saved });
  }
  assert(init?.cache === 'no-store', 'Customer lists fetch fresh data');
  await new Promise<void>(resolve => { releaseGet = resolve; });
  return Response.json(getStatus === 200 ? { success: true, data: { customers: records } } : { message: 'Unable to load customers' }, { status: getStatus });
};
const root = createRoot(document.getElementById('root')!); root.render(<App />);
const nav = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(button => button.textContent === label)!;
const form = () => document.querySelector<HTMLFormElement>('.customer-form-page form');
const field = (id: string) => document.getElementById(`customer-${id}`) as HTMLInputElement;
function edit(id: string, value: string, textarea = false) {
  Object.getOwnPropertyDescriptor(textarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field(id), value);
  field(id).dispatchEvent(new Event('input', { bubbles: true }));
}
const add = () => document.querySelector<HTMLButtonElement>('.category-header-row .btn-primary-add')!;
const save = () => document.querySelector<HTMLButtonElement>('.customer-form-page button[type=submit]')!;
async function openPage() {
  releaseGet = undefined; nav('Customer').click(); await until(() => releaseGet, 'list request');
  assert(document.querySelector('.customers-page [role=status]')?.textContent?.includes('Loading'), 'Shows loading while customers are fetched');
  releaseGet!(); await pause();
}
function checkLayout() {
  const bounds = document.querySelector('.customer-form-page')!.getBoundingClientRect();
  const workspace = document.querySelector('.dashboard-workspace')!.getBoundingClientRect();
  const style = getComputedStyle(document.querySelector('.dashboard-workspace')!);
  assert(Math.abs(bounds.width - (workspace.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))) < 2, 'Customer form fills the main content width');
  assert(bounds.left >= 0 && bounds.right <= innerWidth && !document.querySelector('.modal-scrim'), 'Form stays inside the main area without an overlay');
  if (innerWidth > 820) {
    const sidebar = document.querySelector('.dashboard-sidebar')!.getBoundingClientRect();
    assert(bounds.left >= sidebar.right && document.elementFromPoint(sidebar.left + 20, sidebar.top + 20)?.closest('.dashboard-sidebar'), 'Sidebar remains visible and interactive');
  } else assert(!!document.querySelector('.mobile-menu'), 'Mobile sidebar control remains accessible');
}
void (async () => {
  await until(() => nav('Customer'), 'navigation');
  await openPage(); await until(() => document.querySelector('.customers-table-scroll'), 'existing customers');
  assert(document.querySelector('.customers-table-scroll')?.textContent?.includes('Database Customer') && document.querySelector('.customers-table-scroll')?.textContent?.includes('9876543210'), 'Customer menu displays database customer names and mobiles');
  add().click(); await until(form, 'customer form'); checkLayout();
  const labels = [...document.querySelectorAll('.customer-form-fields > .form-field > label')].map(label => label.textContent);
  assert(JSON.stringify(labels) === JSON.stringify(['Name', 'Mobile Number', 'Alternate Mobile Number', 'Email ID', 'GST Number', 'Address', 'Credit Limit', 'Day Limit', 'Old Balance', 'Birth Date', 'Anniversary Date', 'Credit Only']), 'All twelve fields appear in the requested order');
  const bounds = [...document.querySelectorAll('.customer-form-fields > .form-field')].map(node => node.getBoundingClientRect());
  assert(bounds.every((rect, index) => index === 0 || rect.top >= bounds[index - 1].bottom), 'Fields are arranged vertically');
  assert(!field('name').value && !field('contact').value && !field('name').required && !field('contact').required, 'Initial text values are empty and optional contacts stay optional');
  assert(field('credit-limit').value === '0' && field('day-limit').value === '0' && field('balance').value === '0', 'Numeric inputs use zero defaults');
  const light = getComputedStyle(document.querySelector('.customer-form-page')!).backgroundColor;
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  assert(getComputedStyle(document.querySelector('.customer-form-page')!).backgroundColor !== light, 'Customer form follows the existing dark theme');
  document.querySelector<HTMLButtonElement>('.theme-button')!.click(); await pause();
  edit('name', 'New Customer'); edit('contact', '9876543211'); edit('alt-contact', '9876543212'); edit('email', 'new@example.com'); edit('gst', '27ABCDE1234F1Z5');
  edit('address', 'Line one\nLine two', true); edit('credit-limit', '1500.50'); edit('day-limit', '15'); edit('balance', '-25.75'); await pause();
  field('birth-date').click(); await until(() => document.querySelector('.report-date-calendar'), 'birth calendar');
  assert(document.querySelector('.report-date-calendar')?.getAttribute('aria-label') === 'Birth Date calendar', 'Birth Date opens its calendar');
  const today = document.querySelector<HTMLButtonElement>('.report-date-days button[aria-current=date]')!;
  const birthDate = today.dataset.date!; today.click(); await pause();
  assert(!document.querySelector('.report-date-calendar') && !field('birth-date').textContent?.includes('Choose date'), 'Birth date selection populates the field');
  field('anniversary-date').click(); await until(() => document.querySelector('.report-date-calendar'), 'anniversary calendar');
  assert(document.querySelector('.report-date-calendar')?.getAttribute('aria-label') === 'Anniversary Date calendar', 'Anniversary Date opens its own calendar');
  const another = [...document.querySelectorAll<HTMLButtonElement>('.report-date-days button[data-date]')].find(button => button.dataset.date !== birthDate && !button.disabled)!;
  const anniversaryDate = another.dataset.date!; another.click(); await pause();
  field('credit-only').click(); await pause(); assert(field('credit-only').checked, 'Credit Only checkbox can be selected');
  field('credit-only').click(); await pause(); assert(!field('credit-only').checked, 'Credit Only checkbox can be cleared');
  field('credit-only').click(); await pause();
  edit('email', 'invalid'); await pause(); save().click(); await pause();
  assert(submissions.length === 0 && !field('email').validity.valid, 'Invalid emails are blocked before submission');
  edit('email', 'new@example.com'); edit('day-limit', '-1'); await pause(); save().click(); await pause();
  assert(submissions.length === 0 && !field('day-limit').validity.valid, 'Negative day limits are rejected');
  edit('day-limit', '15'); await pause(); postStatus = 503; releasePost = undefined; save().click(); await until(() => releasePost, 'save request');
  assert(field('name').matches(':disabled') && save().disabled, 'Form controls are disabled during saving');
  assert(!!form() && !document.querySelector('.customer-notice') && records.length === 1, 'No success or new row is shown before database confirmation');
  const expected = { name: 'New Customer', contact: '9876543211', altContact: '9876543212', email: 'new@example.com', gstNo: '27ABCDE1234F1Z5', address: 'Line one\nLine two', creditLimit: 1500.50, dayLimit: 15, balance: -25.75, birthdayDate: birthDate, anniversaryDate, allowedCredit: true };
  const { requestId: _requestId, ...submitted } = submissions[0];
  assert(JSON.stringify(submitted) === JSON.stringify(expected), 'All twelve input values are submitted using the existing field names and numeric types');
  releasePost!(); await until(() => document.querySelector('.customer-save-error'), 'save error');
  assert(!!form() && field('contact').value === '9876543211', 'Failed saves keep the entered data and show an error');
  postStatus = 200; releasePost = undefined; save().click(); await until(() => releasePost, 'retry');
  assert(submissions[1].requestId === submissions[0].requestId, 'Retry uses the same request ID to prevent duplicate customers');
  releasePost!(); await until(() => document.querySelector('.customer-notice'), 'success');
  assert(!form() && records.length === 2 && document.querySelector('.customers-table-scroll')?.textContent?.includes('New Customer'), 'Confirmed save returns to the list with the new customer immediately visible');
  assert(records[0].balance === 75.25 && records[1].balance === -25.75 && records[1].anniversaryDate === anniversaryDate && records[1].birthdayDate === birthDate, 'Existing balances remain unchanged and both new dates stay distinct');
  nav('Dashboard').click(); await pause(); records = []; await openPage(); await until(() => document.querySelector('.customer-state h2'), 'empty state');
  assert(add().textContent?.includes('Add Customer') && document.querySelector('.customer-state')?.textContent?.includes('No customers found'), 'Empty lists clearly offer Add Customer');
  add().click(); await until(form, 'empty add'); document.querySelector<HTMLButtonElement>('[aria-label="Close customer form"]')!.click(); await pause();
  assert(!form(), 'Cancel returns to the customer list');
  nav('Dashboard').click(); await pause(); getStatus = 503; await openPage(); await until(() => document.querySelector('.customer-state [role=alert]'), 'load failure');
  assert(!document.querySelector('.customers-table-scroll') && add().disabled, 'Fetch failure shows an error without stale results');
  getStatus = 200; releaseGet = undefined; document.querySelector<HTMLButtonElement>('.customer-state button')!.click();
  await until(() => releaseGet, 'retry list'); releaseGet!(); await until(() => document.querySelector('.customer-state h2'), 'retry completed');
  assert(submissions.length === 2, 'Fetching and retrying lists never submit customer creates');
  if (location.hash.includes('preview')) { add().click(); await until(form, 'preview form'); } else root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
