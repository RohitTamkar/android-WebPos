import { createRoot } from 'react-dom/client';
import { TransferPreviewPage } from '../src/pages/TransferPreviewPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const passed: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const transfers: { mode: string; categoryIds: string[]; options: Record<string, boolean>; products: { sourceProductId: string; fields: string[] }[]; categoryMappings: Record<string, string> }[] = [];
let fail = false, hold = false, release: (() => void) | undefined;
const fixtures: Record<string, unknown> = {
  '/api/auth/outlets': { outlets: [{ id: 'source', name: 'Outlet A' }, { id: 'destination', name: 'Outlet B' }] },
  '/api/outlets/source/categories': [{ id: 'c1', name: 'ROLLS', categoryNo: 1 }, { id: 'c2', name: 'WRAPS', categoryNo: 2 }],
  '/api/outlets/destination/categories': [{ id: 'd9', name: ' wraps ', categoryNo: 4 }],
  '/api/outlets/source/products': [
    { documentId: 'p1', fields: { name: 'Roll', code: 1, category: 'c1', taxIndex: 1, unitId: 2, currentStock: 5 } },
    { documentId: 'p2', fields: { name: 'Samosa', code: 2, category: 'c1', taxIndex: 1, unitId: 2 } },
    { documentId: 'p3', fields: { name: 'Wrap', code: 3, category: 'c2', taxIndex: 1, unitId: 2 } },
    { documentId: 'p4', fields: { name: 'No category', code: 4, taxIndex: 1, unitId: 2 } },
    { documentId: 'p5', fields: { name: 'Deleted category', code: 5, category: 'deleted', taxIndex: 1, unitId: 2 } },
  ],
  '/api/outlets/destination/products': [{ documentId: 'x1', fields: { name: 'SAMOSA', code: 9 } }],
};
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer mock-token', 'Requests retain authentication');
  if (path.endsWith('/transfer-preview/verify-quick-pin')) return Response.json({ success: true, data: { verified: true, destinationOutletId: 'destination', transferToken: 'grant' } });
  if (path.endsWith('/master-transfer')) {
    assert(new Headers(init?.headers).get('X-Transfer-Token') === 'grant', 'Transfer retains QuickPin authorization');
    const body = JSON.parse(String(init?.body)); transfers.push(body);
    await new Promise(resolve => setTimeout(resolve, 60));
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    if (fail) return Response.json({ success: false, message: 'Transfer failed; retry.' }, { status: 503 });
    const items = body.products.map((product: { sourceProductId: string }) => ({ type: 'product', sourceId: product.sourceProductId, name: product.sourceProductId, status: 'created', reason: 'Product copied.' }));
    return Response.json({ success: true, data: { created: items.length, skipped: 0, unchanged: 0, items } });
  }
  if (Object.hasOwn(fixtures, path)) return Response.json({ success: true, data: fixtures[path] });
  throw new Error(`Unexpected request: ${path}`);
};
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const select = (name: string) => document.querySelector<HTMLInputElement>(`[aria-label="Select ${name}"]`)!;
const click = async (element: HTMLElement) => { element.click(); await pause(); };
const option = (name: string) => [...document.querySelectorAll<HTMLLabelElement>('.transfer-option')].find(label => label.querySelector('strong')?.textContent === name)!.querySelector('input')!;
const root = createRoot(document.getElementById('root')!);
root.render(<div className="retail-dashboard-shell"><main className="dashboard-workspace" style={{ width: '100%' }}><TransferPreviewPage outlet={{ id: 'source', name: 'Outlet A' } as OutletSummary} token="mock-token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} /></main></div>);
void (async () => {
  await until(() => document.querySelector('[aria-label="Select outlet Outlet B"]'), 'destination outlets');
  await click(document.querySelector<HTMLButtonElement>('[aria-label="Select outlet Outlet B"]')!);
  const pin = document.querySelector<HTMLInputElement>('#preview-quick-pin')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(pin, '1234'); pin.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  await click(button('Verify'));
  await until(() => select('Roll'), 'product list');
  assert(!document.body.textContent?.includes('Category Transfer') && !document.querySelector('[aria-label="Transfer type"]'), 'Only Product Transfer is offered');
  assert(!document.querySelector('[aria-label="Select outlet Outlet A"]'), 'Source outlet is excluded');
  assert(select('Samosa').disabled, 'Products already in the destination cannot be selected again');
  assert(select('No category').closest('tr')?.textContent?.includes('All') && select('Deleted category').closest('tr')?.textContent?.includes('All'), 'Missing and deleted categories appear under All');
  const destination = document.querySelector<HTMLSelectElement>('.transfer-destination-field select')!.getBoundingClientRect();
  assert(destination.width <= 401 && destination.right <= innerWidth, 'Destination selector stays compact and fits the screen');
  if (location.hash === '#preview') { document.documentElement.dataset.theme = 'light'; document.getElementById('test-results')!.textContent = JSON.stringify({ passed: ['Product Transfer layout'] }); return; }
  await click(select('Roll')); await click(select('Wrap')); await click(select('No category')); await click(select('Deleted category'));
  assert(button('Review & transfer') && !button('Review & transfer').disabled, 'Selected products can be reviewed');
  await click(button('Review & transfer'));
  assert(option('Images').checked && !option('Stock').checked && !option('Prices').checked, 'Existing transfer defaults retained');
  await click(option('Prices')); await click(option('Barcode')); await click(button('Cancel'));
  assert(transfers.length === 0, 'Review and cancel make no transfer requests');
  await click(button('Review & transfer'));
  assert(option('Prices').checked && option('Barcode').checked, 'Options survive cancelling review');
  fail = true; hold = true;
  button('Continue Transfer').click(); button('Continue Transfer').click();
  await until(() => document.querySelector('.transfer-progress[open]') && release, 'transfer progress');
  assert(document.querySelector('#transfer-progress-title')?.textContent === 'Transferring products…', 'Progress explains the current action');
  const cancel = new Event('cancel', { cancelable: true }); document.querySelector('.transfer-progress')!.dispatchEvent(cancel);
  assert(cancel.defaultPrevented, 'Pending transfer cannot be dismissed with Escape');
  release!(); hold = false;
  await until(() => document.body.textContent?.includes('Transfer failed; retry.'), 'failed transfer');
  assert(transfers.length === 1 && !document.querySelector('.transfer-progress'), 'Duplicate clicks are guarded and failure clears progress');
  assert(transfers[0]!.mode === 'products', 'Only product mode is submitted');
  assert(JSON.stringify(transfers[0]!.categoryIds) === '["c1","c2"]', 'Assigned categories accompany selected products automatically');
  assert(JSON.stringify(transfers[0]!.categoryMappings) === '{"c2":"d9"}', 'Matching destination categories are reused');
  assert(transfers[0]!.products.length === 4 && !transfers[0]!.products.find(product => product.sourceProductId === 'p4')!.fields.includes('category'), 'Uncategorized products are included without a made-up category');
  passed.push('One product flow, compact destination selector, automatic category inclusion, existing-category reuse and All fallback');
  fail = false;
  await click(button('Review & transfer')); await click(button('Continue Transfer'));
  await until(() => document.querySelector('#transfer-outcome-title')?.textContent === 'Transfer successful', 'successful retry');
  assert(transfers.length === 2 && JSON.stringify(transfers[0]) === JSON.stringify(transfers[1]), 'Retry retains the selected products, category mappings and options');
  await click(button('OK'));
  await until(() => document.querySelector('[aria-label="Select outlet Outlet B"]'), 'return to destinations');
  passed.push('QuickPin verification, review cancellation, independent options, transfer progress, error recovery and successful confirmation');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
