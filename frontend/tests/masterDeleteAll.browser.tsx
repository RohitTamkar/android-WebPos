import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { EmployeesPage } from '../src/pages/EmployeesPage.tsx';
import { CustomersPage } from '../src/pages/CustomersPage.tsx';
import { PremisesPage } from '../src/pages/PremisesPage.tsx';
import { ServicePointsPage } from '../src/pages/ServicePointsPage.tsx';
import '../src/index.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 250; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${label}`); }
const employee = (id: string, name: string) => ({ documentId: id, name, mobile: '99', searchCode: 1, shortName: 'E', balanceAmt: '0', dateOfJoining: '', userId: '' });
const customer = (id: string, name: string) => ({ documentId: id, name, contact: '', altContact: '', email: '', gstNo: '', address: '', creditLimit: 0, dayLimit: 0, balance: 0, birthdayDate: '', anniversaryDate: '', allowedCredit: false });
let employees = [employee('e1', 'Ravi'), employee('e2', 'Asha')];
let customers = [customer('c1', 'Mehta'), customer('c2', 'Shah')];
const premise = (id: string, name: string, code: number) => ({ documentId: id, fields: { name, code, type: 'Table', tables: 10, range: 1 } });
let premises = [premise('p1', 'AC Table', 1), premise('p2', 'GARDEN', 2)];
const servicePoint = (id: string, name: string) => ({ documentId: id, name, paperSize: 3, printerType: 0, header: '', subHeader: '', footer: '', printerIpAddress: '', port: null, usbPath: null });
let servicePoints = [servicePoint('k1', 'Kitchen'), servicePoint('k2', 'Bar Counter')];
const deletes: { path: string; confirm: unknown }[] = [];
let failNext = false;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.pathname.endsWith('/master-sync')) return new Response('', { status: 404 });
  if (init?.method === 'DELETE') {
    deletes.push({ path: url.pathname, confirm: JSON.parse(String(init.body)).confirm });
    if (failNext) { failNext = false; return Response.json({ success: false, message: '1 of 2 deleted before an error. Retry Delete All to remove the rest.' }, { status: 503 }); }
    const count = url.pathname.endsWith('/employees') ? employees.length : url.pathname.endsWith('/premises') ? premises.length
      : url.pathname.endsWith('/service-points') ? servicePoints.length : customers.length;
    if (url.pathname.endsWith('/employees')) employees = []; else if (url.pathname.endsWith('/premises')) premises = [];
    else if (url.pathname.endsWith('/service-points')) servicePoints = []; else customers = [];
    return Response.json({ success: true, data: { deleted: count } });
  }
  if (url.pathname.endsWith('/employees')) return Response.json({ data: { employees, nextSearchCode: 3, userAccounts: [] } });
  if (url.pathname.endsWith('/customers')) return Response.json({ success: true, data: { customers } });
  if (url.pathname.endsWith('/service-points')) return Response.json({ success: true, data: { servicePoints } });
  if (url.pathname.endsWith('/premises')) return Response.json({ success: true, data: { premises, nextCode: 3, taxes: [], userAccounts: [] } });
  throw new Error(`Unexpected request: ${url.pathname}`);
};
const root = createRoot(document.getElementById('root')!);
const outlet = { id: 'outlet', name: 'Outlet', active: true } as never;
const onSessionExpired = () => { throw new Error('Unexpected session expiry'); };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label || node.getAttribute('aria-label') === label);
const rows = () => (document.querySelector('tbody') ?? document.querySelector('.premises-list'))?.textContent ?? '';
const dialogText = () => document.querySelector('dialog[open]')?.textContent ?? '';

async function deleteAll(menu: string, names: string[], route: string, confirm: string, success: string) {
  await until(() => names.every(name => rows().includes(name)), `${route} list`);
  button(menu)!.click(); await until(() => button('Delete All'), `${route} menu`);
  assert(!button('Delete All')!.disabled, `${route}: Delete All is available in the three-dot menu`);
  button('Delete All')!.click(); await until(() => dialogText().includes('Are you sure'), `${route} confirmation`);
  button('No')!.click(); await until(() => !dialogText(), `${route} cancel`);
  assert(!deletes.length && names.every(name => rows().includes(name)), `${route}: No deletes nothing`);

  failNext = true;
  button(menu)!.click(); await until(() => button('Delete All'), 'menu again'); button('Delete All')!.click();
  await until(() => button('Yes'), 'confirm'); button('Yes')!.click();
  await until(() => dialogText().includes('Retry Delete All'), `${route} failure`);
  assert(!dialogText().includes('deleted successfully'), `${route}: a failure never shows success`);
  button('Yes')!.click();
  await until(() => dialogText().includes(success), `${route} success`);
  assert(deletes.length === 2 && deletes.every(call => call.path === `/api/outlets/outlet/${route}` && call.confirm === confirm), `${route}: sends the confirmed delete-all request`);
  button('OK')!.click(); await until(() => !dialogText(), 'close success');
  assert(names.every(name => !rows().includes(name)), `${route}: the list is cleared`);
  await until(() => button(menu), 'menu after delete');
  button(menu)!.click(); await until(() => button('Delete All'), 'empty menu');
  assert(button('Delete All')!.disabled, `${route}: Delete All is disabled when the list is empty`);
  deletes.length = 0;
}

void (async () => {
  flushSync(() => root.render(<EmployeesPage outlet={outlet} token="token" onSessionExpired={onSessionExpired} />));
  await deleteAll('Employee options', ['Ravi', 'Asha'], 'employees', 'DELETE_ALL_EMPLOYEES', 'Employees deleted successfully');
  flushSync(() => root.render(<CustomersPage outlet={outlet} token="token" onSessionExpired={onSessionExpired} />));
  await deleteAll('Customer options', ['Mehta', 'Shah'], 'customers', 'DELETE_ALL_CUSTOMERS', 'Customers deleted successfully');
  flushSync(() => root.render(<PremisesPage outlet={outlet} token="token" onSessionExpired={onSessionExpired} />));
  await deleteAll('Premises options', ['AC Table', 'GARDEN'], 'premises', 'DELETE_ALL_PREMISES', 'Premises deleted successfully');
  assert(document.querySelector('.premises-empty')?.textContent?.includes('No premises created yet'), 'premises: the empty state is shown after Delete All');
  flushSync(() => root.render(<ServicePointsPage outlet={outlet} token="token" onSessionExpired={onSessionExpired} />));
  await deleteAll('Service point options', ['Kitchen', 'Bar Counter'], 'service-points', 'DELETE_ALL_SERVICE_POINTS', 'Service points deleted successfully');
  assert(document.body.textContent?.includes('No service points yet'), 'service points: the empty state is shown after Delete All');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
