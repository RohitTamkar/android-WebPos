import { createRoot } from 'react-dom/client';
import { CustomersPage } from '../src/pages/CustomersPage.tsx';
import { EmployeesPage } from '../src/pages/EmployeesPage.tsx';
import { PremisesPage } from '../src/pages/PremisesPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';
const passed: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const outlet = { id: 'outlet', name: 'Test Outlet' } as OutletSummary;
const onSessionExpired = () => { throw new Error('Unexpected session expiry'); };
const customer = { documentId: 'c', name: 'Customer', contact: '12345', altContact: '', email: '', gstNo: '', address: 'Address', creditLimit: 100, dayLimit: 5, balance: 75, birthdayDate: '', anniversaryDate: '', allowedCredit: true };
let customers = [customer];
let employees = [{ documentId: 'e', name: 'Employee', mobile: '98765', searchCode: 1, shortName: 'E', balanceAmt: '0', dateOfJoining: '', userId: '' }];
let premises = [{ documentId: 'p', fields: { name: 'TABLE', code: 1, type: 'Table', tables: 10, range: 1, taxIndex: 1, userId: 'user', price: 0 } }];
const patches: Record<string, unknown>[] = [], deletes: string[] = [];
let failPatch = true, loseDelete = true;
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Requests remain authenticated');
  if (init?.method === 'PATCH') {
    assert(path === '/api/outlets/outlet/customers/c', 'Edits target the original customer document');
    const body = JSON.parse(String(init.body)); patches.push(body);
    await new Promise(resolve => setTimeout(resolve, 60));
    if (failPatch) { failPatch = false; return Response.json({ message: 'Customer update failed; retry.' }, { status: 503 }); }
    Object.assign(customer, body); return Response.json({ success: true, data: customer });
  }
  if (init?.method === 'DELETE') {
    deletes.push(path); await new Promise(resolve => setTimeout(resolve, 60));
    if (path.endsWith('/employees/e')) {
      employees = [];
      if (loseDelete) { loseDelete = false; throw new Error('Response lost after deleting'); }
    } else if (path.endsWith('/premises/p')) premises = [];
    else if (path.endsWith('/customers/c')) customers = [];
    else throw new Error(`Unexpected delete ${path}`);
    return Response.json({ success: true, data: { documentId: path.split('/').at(-1) } });
  }
  if (path.endsWith('/customers')) return Response.json({ success: true, data: { customers } });
  if (path.endsWith('/employees')) return Response.json({ success: true, data: { employees, nextSearchCode: 2, userAccounts: [] } });
  if (path.endsWith('/premises')) return Response.json({ success: true, data: { premises, nextCode: 2, taxes: [], userAccounts: [{ userId: 'user', name: 'User' }] } });
  throw new Error(`Unexpected request ${path}`);
};
const root = createRoot(document.getElementById('root')!);
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const confirm = () => document.querySelector<HTMLButtonElement>('.delete-confirmation-confirm')!;
const cancel = () => document.querySelector<HTMLButtonElement>('.delete-confirmation-cancel')!;
async function setValue(id: string, value: string) { const input = document.getElementById(id) as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }
void (async () => {
  root.render(<CustomersPage key="customers" outlet={outlet} token="token" onSessionExpired={onSessionExpired} />);
  await until(() => document.querySelector('.customers-table-scroll tbody tr'), 'customers');
  document.querySelector<HTMLTableRowElement>('.customers-table-scroll tbody tr')!.click(); await pause();
  assert(document.querySelector('#customer-form-title')?.textContent === 'Edit Customer' && (document.getElementById('customer-contact') as HTMLInputElement).value === '12345', 'Clicking a customer opens a prefilled editor');
  await setValue('customer-name', 'Discard'); button('Cancel').click(); await pause();
  assert(patches.length === 0, 'Cancelling edits does not write');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit customer Customer"]')!.click(); await pause();
  await setValue('customer-name', 'Updated'); await setValue('customer-email', 'updated@example.com');
  customer.balance = 200;
  button('Update Customer').click(); button('Update Customer').click();
  await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('Customer update failed'), 'failed edit');
  assert(patches.length === 1 && (document.getElementById('customer-name') as HTMLInputElement).value === 'Updated', 'Duplicate saves are guarded and failures retain the draft');
  button('Update Customer').click(); await until(() => document.querySelector('[aria-label="Edit customer Updated"]'), 'saved edit');
  assert(JSON.stringify(patches[1]) === '{"name":"Updated","email":"updated@example.com"}' && customer.balance === 200, 'Only changed customer fields are sent; concurrent balance is retained');
  document.querySelector<HTMLButtonElement>('[aria-label="Delete customer Updated"]')!.click(); await pause();
  assert(!document.querySelector('#customer-form-title'), 'Delete does not also open the row editor');
  cancel().click(); await pause(); assert(deletes.length === 0, 'Delete cancellation makes no request');
  document.querySelector<HTMLButtonElement>('[aria-label="Delete customer Updated"]')!.click(); await pause(); confirm().click();
  await until(() => document.body.textContent?.includes('No customers found'), 'customer deleted');
  passed.push('Customer row editing, prefilled fields, changed-only updates, cancellation, failure retry, concurrency preservation and confirmed deletion');

  root.render(<EmployeesPage key="employees" outlet={outlet} token="token" onSessionExpired={onSessionExpired} />);
  await until(() => document.querySelector('[aria-label="Select Employee"]'), 'employees');
  assert([...document.querySelectorAll('#employee-selection-kind option')].map(node => node.textContent).join(',') === 'Employee,Salesman' && !document.body.textContent?.includes('Captain'), 'Only Employee and Salesman remain');
  document.querySelector<HTMLInputElement>('[aria-label="Select Employee"]')!.click();
  document.querySelector<HTMLButtonElement>('[aria-label="Delete employee Employee"]')!.click(); await pause(); confirm().click(); confirm().click();
  await until(() => document.querySelector('.delete-confirmation [role="alert"]'), 'lost delete response');
  assert(document.querySelector('[aria-label="Select Employee"]') && deletes.filter(path => path.endsWith('/employees/e')).length === 1, 'Unconfirmed deletion retains the row and prevents duplicate clicks');
  confirm().click(); await until(() => document.body.textContent?.includes('No employees found'), 'deletion retry');
  assert(!document.body.textContent?.includes('Selected employee:'), 'Deleting the employee clears the selection');
  passed.push('Employee/Salesman choices, selected employee deletion and idempotent retry after a lost response');

  root.render(<PremisesPage key="premises" outlet={outlet} token="token" onSessionExpired={onSessionExpired} />);
  await until(() => document.querySelector('[aria-label="Edit premise TABLE"]'), 'premises');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit premise TABLE"]')!.click(); await pause();
  assert(document.getElementById('premise-name'), 'Existing premises editing remains available'); button('Cancel').click(); await pause();
  document.querySelector<HTMLButtonElement>('[aria-label="Delete premises TABLE"]')!.click(); await pause();
  assert(!document.getElementById('premise-name'), 'Premises delete stays separate from edit');
  confirm().click(); await until(() => document.body.textContent?.includes('No premises created yet.'), 'premises deletion');
  assert(document.querySelector('.premises-total strong')?.textContent === '0', 'Premises count updates after deletion');
  passed.push('Premises keeps its editor and adds a separate confirmed delete action with an updated count');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
