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
const page = () => document.querySelector('[aria-label="Category and product transfer"]')!;
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
async function changeDestination(id: string) {
  const select = [...page().querySelectorAll('label')].find(node => node.textContent?.startsWith('Destination outlet'))!.querySelector('select')!;
  select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); await verify();
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
  [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === 'Category & Product Transfer')!.click();
  await flush(1);
  assert(!page().querySelector('[aria-label="Select outlet Outlet A"]') && page().querySelector('[aria-label="Select outlet Outlet B"]'), 'Only authorized destination outlets appear; source is excluded');
  page().querySelector<HTMLButtonElement>('[aria-label="Select outlet Outlet B"]')!.click(); await verify();
  await until(() => pending.length === 2, 'category reads');
  assert(content().includes('Loading source categories') && content().includes('Loading destination categories'), 'Proposal reads retain loading states');
  await flush(2);
  assert(content().includes('Category & Product Transfer') && button('Review & transfer').disabled, 'Transfer page opens with the action disabled until records are selected');
  checkbox('Select VEG ROLLS').click(); await pause();
  assert(content().includes('VEG ROLLS · Source #1 → New category #11 (estimated)'), 'Source #1 colliding with destination 1–10 gets proposal #11 instead of being skipped');
  assert(!content().includes('will be skipped') && !content().includes('Use existing'), 'Number conflicts do not skip or automatically merge records');
  checkbox('Select MEALS').click(); await pause();
  assert(content().includes('MEALS · Source #3 → New category #12') && content().includes('Category name matches MEALS'), 'Multiple proposals are unique and genuine category-name conflicts remain visible');
  const callsBeforeReview = requests.length;
  button('Review & transfer').click(); await until(() => page().querySelector('[aria-labelledby="transfer-confirmation-title"][open]'), 'review');
  assert(page().querySelector('[aria-labelledby="transfer-confirmation-title"][open]') && button('Confirm transfer'), 'Review opens confirmation with the transfer action');
  button('Cancel').click(); await pause(); assert(requests.length === callsBeforeReview, 'Opening and cancelling confirmation performs no transfer');
  button('Review & transfer').click(); await pause(); button('Confirm transfer').click();
  await until(() => page().querySelector('[aria-labelledby="transfer-outcome-title"][open]'), 'success confirmation before refresh');
  assert(page().querySelector('#transfer-outcome-title')?.textContent === 'Transfer successful', 'Successful transfer displays a visible confirmation while data refreshes');
  await flush(2);
  assert(transfers.length === 1 && content().includes('1 copied') && content().includes('Destination #11'), 'Confirmed category transfer displays only committed API results and final numbers');
  assert(page().querySelector('[aria-labelledby="transfer-outcome-title"][open]'), 'Success confirmation remains open after data refresh');
  button('OK').click(); await pause();
  assert(!page().querySelector('[aria-labelledby="transfer-outcome-title"][open]') && content().includes('1 copied'), 'OK dismisses the dialog while preserving the transfer result');
  inputValue(page().querySelector('input[type=search]')!, 'no match'); await pause();
  assert(content().includes('No matching results'), 'Search supports an empty result state');
  button('Product Transfer').click(); await flush(4);
  checkbox('Select Roll').click(); await pause(); checkbox('Select Meal').click(); await pause();
  assert(content().includes('Roll · Source code 1 → Destination code 11') && content().includes('Meal · Source code 7 → Destination code 12'), 'Conflicting source codes produce unique destination code proposals');
  assert(content().includes('Product name matches Meal') && content().includes('Barcode matches Other'), 'Name and barcode conflicts are separate warnings, never automatic identity matches');
  assert(content().includes('New-product stock: 0') && content().includes('Source stock is excluded') && !page().querySelector('input[aria-label*="currentStock"]'), 'New-product stock is proposed as zero and source stock cannot be selected');
  assert(!checkbox('Discount (%) for Roll').checked, 'Discount remains excluded by default');
  checkbox('Stockable for Roll').click(); await pause();
  assert(checkbox('Stockable for Roll').checked && !checkbox('Weighable for Roll').checked, 'Stockable and Weighable remain independent temporary selections');
  window.scrollTo(0, 0); await pause();
  const bounds = button('Review & transfer').getBoundingClientRect();
  assert(bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.right <= innerWidth, 'Proposal review action remains visible on this viewport');
  await changeDestination('empty'); await flush(4);
  assert(content().includes('0 products selected'), 'Changing destinations resets temporary selections');
  checkbox('Select Roll').click(); await pause();
  assert(content().includes('Roll · Source code 1 → Destination code 1'), 'Empty destination starts product code proposals at 1');
  button('Review & transfer').click(); await pause(); button('Confirm transfer').click(); await flush(4);
  assert(page().querySelector('[aria-labelledby="transfer-outcome-title"][open]'), 'Product transfer also displays a success confirmation');
  button('OK').click(); await pause();
  assert(transfers.length === 2 && (transfers[1].products as { sourceProductId: string }[])[0].sourceProductId === 'p1', 'Confirmed product transfer submits only selected product IDs and fields');
  transferFailure = true;
  button('Review & transfer').click(); await pause(); button('Confirm transfer').click(); await pause();
  assert(content().includes('Simulated commit failure') && !page().querySelector('[aria-label="Transfer result"]'), 'Failed transfer shows an error without reporting success');
  status = 403; await changeDestination('destination'); await flush(4);
  assert(page().querySelector('[role=alert]') && !page().querySelector('table'), 'Denied reads show errors and hide stale data');
  assert(transfers.length === 3, 'Exactly the explicitly confirmed transfers reached the mock service');
  assert(JSON.stringify(fixtures) === before, 'Source/destination records, stock and selected field values remain unchanged');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: 1, error: String(error), checks }); });
