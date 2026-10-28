import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

const sourceCategories = [{ id: 'c1', name: 'VEG ROLLS', categoryNo: 1 }, { id: 'c2', name: 'MEALS', categoryNo: 3 }];
const destinationCategories = Array.from({ length: 10 }, (_, index) => ({ id: `d${index}`, name: index === 2 ? 'MEALS' : `Existing ${index + 1}`, categoryNo: index + 1 }));
const sourceProducts = [
  { documentId: 'p1', fields: { name: 'Roll', code: 1, category: 'c1', price: 40, priceTable: '{"default price":40}', taxIndex: 1, unitId: 2, barcode: 'A', stockable: true, weighable: false, discount: 10, currentStock: 500 } },
  { documentId: 'p2', fields: { name: 'Meal', code: 7, category: 'c2', price: 80, taxIndex: 1, unitId: 2, barcode: 'B', currentStock: 700 } },
];
const destinationProducts = [
  { documentId: 'd1', fields: { name: 'Other', code: 1, barcode: 'B', currentStock: 99 } },
  { documentId: 'd2', fields: { name: 'Meal', code: 10, barcode: 'Z', currentStock: 88 } },
];
const fixtures: Record<string, unknown> = {
  '/api/auth/outlets': { outlets: [{ id: 'source', name: 'Outlet A' }, { id: 'destination', name: 'Outlet B' }, { id: 'empty', name: 'Empty Outlet' }] },
  '/api/outlets/source/categories': sourceCategories, '/api/outlets/destination/categories': destinationCategories, '/api/outlets/empty/categories': [],
  '/api/outlets/source/products': sourceProducts, '/api/outlets/destination/products': destinationProducts, '/api/outlets/empty/products': [],
};
function freeze(value: unknown) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } }
freeze(fixtures); const before = JSON.stringify(fixtures);
const checks: string[] = [], requests: string[] = [];
const pending: (() => void)[] = [];
let status = 200;
let transferFailure = false;
const transfers: Record<string, unknown>[] = [];
function assert(ok: unknown, message: string) { if (!ok) throw new Error(message); checks.push(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error('Timeout: ' + label); }
const page = () => document.querySelector('[aria-label="Product transfer"]')!;
const content = () => page()?.textContent || '';
const button = (label: string) => [...page().querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
const checkbox = (label: string) => page().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
function inputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function flush(count: number) { await until(() => pending.length === count, `${count} read requests`); pending.splice(0).forEach(release => release()); await pause(); }
async function verify() {
  await until(() => page().querySelector('dialog[open]'), 'QuickPin dialog');
  inputValue(page().querySelector('#preview-quick-pin')!, '1234'); await pause(); button('Verify').click();
  await until(() => !page().querySelector('dialog'), 'PIN verified');
}
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes('/dashboard?')) return Response.json({ data: { payments: {} } });
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer mock-token', 'Existing authentication is retained');
  if (/\/usage\/(start|heartbeat|stop)$/.test(path)) {
    const body = JSON.parse(String(init?.body || '{}')); const outletId = path.split('/')[3];
    return Response.json({ success: true, data: { outletId, sessionId: 'mock-usage-session', generation: 'mock-generation', sequence: body.sequence ?? 0,
      usedSeconds: 0, remainingSeconds: 1800, date: '2026-10-19', timeZone: 'Asia/Kolkata' } });
  }
  requests.push(path);
  if (path === '/api/outlets/source/transfer-preview/verify-quick-pin') {
    assert(init?.method === 'POST', 'PIN verification uses the existing POST verifier');
    const body = JSON.parse(String(init.body));
    return Response.json({ success: true, data: { verified: true, destinationOutletId: body.destinationOutletId, transferToken: 'scoped-mock-grant' } });
  }
  if (path === '/api/outlets/source/master-transfer') {
    assert(init?.method === 'POST' && new Headers(init.headers).get('X-Transfer-Token') === 'scoped-mock-grant', 'Transfer uses POST and the outlet-scoped QuickPin grant');
    const body = JSON.parse(String(init.body)); transfers.push(body);
    assert(!JSON.stringify(body).includes('currentStock') && !JSON.stringify(body).includes('"code"'), 'Only selections are submitted; stock and source codes are excluded');
    if (transferFailure) return Response.json({ success: false, message: 'Simulated commit failure' }, { status: 503 });
    return Response.json({ success: true, data: { created: 1, skipped: 0, unchanged: 0, items: [{ type: body.mode === 'categories' ? 'category' : 'product', sourceId: 'selected', name: 'Copied item', status: 'created', reason: 'Copied', destinationNumber: 11 }] } });
  }
  assert(Object.hasOwn(fixtures, path) && init?.method === 'GET' && !init.body, 'Only existing outlet/category/product GETs load preview data');
  const responseStatus = status;
  await new Promise<void>(resolve => pending.push(resolve));
  return Response.json(responseStatus === 200 ? { success: true, data: fixtures[path] } : { success: false, message: 'Access unavailable' }, { status: responseStatus });
};
localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'signed', name: 'User', email: 'user@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'source', name: 'Outlet A' }));
const root = createRoot(document.getElementById('root')!); root.render(<App />);
void (async () => {
  await until(() => document.querySelector('.sidebar-nav'), 'navigation');
  [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === 'Product Transfer')!.click();
  await flush(1);
  assert(!page().querySelector('[aria-label="Select outlet Outlet A"]') && page().querySelector('[aria-label="Select outlet Outlet B"]'), 'Authorized destinations exclude the source outlet');
  page().querySelector<HTMLButtonElement>('[aria-label="Select outlet Outlet B"]')!.click(); await verify();
  await flush(4);
  assert(content().includes('Product Transfer') && !content().includes('Category Transfer'), 'Dashboard navigation opens only Product Transfer');
  assert(button('Review & transfer').disabled, 'Transfer requires product selection');
  assert(checkbox('Select Meal').disabled, 'Existing destination products cannot be transferred again');
  checkbox('Select Roll').click(); await pause();
  assert(checkbox('Select Roll').closest('tr')?.textContent?.includes('11'), 'Destination product code is proposed after its existing maximum');
  const callsBeforeReview = requests.length;
  button('Review & transfer').click(); await until(() => page().querySelector('[aria-labelledby="transfer-confirmation-title"][open]'), 'review');
  button('Cancel').click(); await pause();
  assert(requests.length === callsBeforeReview, 'Cancelling review performs no transfer');
  transferFailure = true;
  button('Review & transfer').click(); await pause(); button('Continue Transfer').click();
  await until(() => content().includes('Simulated commit failure'), 'failure');
  assert(!page().querySelector('dialog[open] #transfer-outcome-title'), 'Failure never shows a success dialog');
  transferFailure = false;
  button('Review & transfer').click(); await pause(); button('Continue Transfer').click();
  await until(() => page().querySelector('[aria-labelledby="transfer-outcome-title"][open]'), 'transfer result');
  await flush(4);
  assert(transfers.length === 2 && transfers[1]!.mode === 'products' && JSON.stringify(transfers[1]!.categoryIds) === '["c1"]', 'Product transfer automatically submits its assigned category');
  assert(JSON.stringify(fixtures) === before, 'No source fixture or existing destination record was modified');
  button('OK').click(); await pause();
  assert(!page().querySelector('dialog[open]') && page().querySelector('[aria-label="Select outlet Empty Outlet"]'), 'Confirmed transfer returns to destination selection');
  status = 403;
  page().querySelector<HTMLButtonElement>('[aria-label="Select outlet Empty Outlet"]')!.click(); await verify();
  await flush(4);
  assert(content().includes('Unable to load source products') && !page().querySelector('table'), 'Access errors hide the product selection');
  status = 200;
  page().querySelectorAll<HTMLButtonElement>('.devices-state button').forEach(node => node.click());
  await flush(4);
  assert(checkbox('Select Roll'), 'Authorized data can be reloaded with Retry');
  inputValue(page().querySelector('input[type=search]')!, 'no match'); await pause();
  assert(content().includes('No matching results'), 'Product search retains an empty state');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
