import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const results: string[] = [];
const posts: Record<string, unknown>[] = [];
let expired = 0;
let stale = true;
let unauthorized = false;
const categories = [{ id: 'cat', name: 'Drinks' }, { id: 'cat2', name: 'Food' }];
const products = [{ documentId: 'old', fields: { name: 'Tea', code: 50, category: 'cat', price: 20 } }];
window.fetch = async (url, init) => {
  const path = String(url);
  if (!path.startsWith('/api/outlets/outlet/')) throw new Error(`Unexpected request blocked: ${path}`);
  if (path.endsWith('/create-options')) return Response.json(unauthorized ? { message: 'Session expired' } : {
    data: { code: posts.length ? 53 : 51, categories, taxes: [{ percent: 5, index: 7, type: 0 }], units: [{ id: 2, name: 'number' }] },
  }, { status: unauthorized ? 401 : 200 });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: categories });
  if (path.endsWith('/products') && init?.method !== 'POST') return Response.json({ success: true, data: products });
  if (path.endsWith('/products') && init?.method === 'POST') {
    const fields = JSON.parse(String(init.body)); posts.push(fields);
    await new Promise(resolve => setTimeout(resolve, 80));
    if (stale) { stale = false; return Response.json({ message: 'The next Code changed. Review the updated Code and save again.', nextCode: 52 }, { status: 409 }); }
    return Response.json({ success: true, data: { documentId: 'new-product', fields: { ...fields, id: 'new-product' } } }, { status: 201 });
  }
  throw new Error(`Unexpected request blocked: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { expired++; }} />);
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
function button(label: string) { const el = [...document.querySelectorAll('button')].find(button => button.textContent === label); assert(el, `button ${label}`); return el!; }
function input(id: string) { return document.getElementById(id) as HTMLInputElement; }
async function value(el: HTMLInputElement | HTMLSelectElement, text: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  await pause();
}
async function run() {
  await waitFor(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Add New Product' && !button.disabled), 'page ready');
  button('Add New Product').click();
  await waitFor(() => input('product-code')?.value === '51', 'next code');
  assert(document.querySelector('.add-product-modal') && !document.querySelector('.products-table-card'), 'full-width form replaces the list');
  assert(input('product-code').readOnly, 'code is read-only');
  assert(document.querySelector('.add-product-modal')!.getBoundingClientRect().width >= document.getElementById('root')!.getBoundingClientRect().width - 2, 'form fills content width');
  assert(getComputedStyle(document.querySelector('.add-product-modal .modal-body')!).gridTemplateColumns.split(' ').length === 3, 'desktop fields use three columns');
  assert(getComputedStyle(input('product-code')).color === 'rgb(51, 65, 85)', 'code is visible against white background');
  button('Cancel').click(); await pause();
  assert(!document.querySelector('.add-product-modal'), 'cancel closes form'); assert(posts.length === 0, 'cancel never saves');
  button('Add New Product').click(); await waitFor(() => input('product-code')?.value === '51', 'escape test form');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await pause();
  assert(!document.querySelector('.add-product-modal') && posts.length === 0, 'Escape cancellation never saves');
  results.push('Opening, next code visibility, Cancel and Escape without writes');

  button('Add New Product').click(); await waitFor(() => input('product-code')?.value === '51', 'reopen code');
  button('Save Product').click(); await pause();
  assert(input('product-name').getAttribute('aria-invalid') === 'true', 'name validation');
  assert(input('product-price').getAttribute('aria-invalid') === 'true', 'price validation');
  assert(input('product-category').getAttribute('aria-invalid') === 'true', 'category validation');
  await value(input('product-price'), '-1'); button('Save Product').click(); await pause();
  assert(input('product-price').getAttribute('aria-invalid') === 'true', 'negative prices rejected');
  assert(posts.length === 0, 'invalid data never posts');
  results.push('Required and numeric field validation');
  button('Cancel').click(); await pause();

  await value(document.querySelector('select[aria-label="Filter by category"]') as HTMLSelectElement, 'cat');
  await value(document.querySelector('input[aria-label="Search products"]') as HTMLInputElement, 'Tea');
  button('Add New Product').click(); await waitFor(() => input('product-code')?.value === '51', 'configured form');
  assert(input('product-category').value === 'cat', 'existing category selected by document ID');
  assert(input('product-taxIndex').value === '7', 'actual configured tax index');
  assert(input('product-unitId').value === '2', 'verified number unit ID');
  await value(input('product-name'), 'Tea Two'); await value(input('product-price'), '25.5');
  await value(input('product-discount'), '101'); button('Save Product').click(); await pause();
  assert(input('product-discount').getAttribute('aria-invalid') === 'true', 'discount upper limit');
  await value(input('product-discount'), '10');
  assert(!document.querySelector('details'), 'all fields are in one form without a toggle');
  for (const id of ['product-taxIndex', 'product-hsnCode', 'product-unitId']) assert(input(id).getClientRects().length > 0, `${id} is always visible`);
  const checks = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  assert(checks.length === 2 && checks.every(check => !check.checked), 'checkboxes initially deselected');
  checks[0]!.click(); checks[1]!.click(); await pause();
  assert(checks.every(check => check.checked), 'both can select');
  checks[0]!.click(); checks[1]!.click(); await pause();
  assert(checks.every(check => !check.checked), 'both can deselect');
  checks[0]!.click(); await pause();
  results.push('Category/tax/unit options, always visible fields and independent checkbox states');

  const save = button('Save Product'); save.click(); save.click();
  await waitFor(() => input('product-code')?.value === '52', 'stale code refresh');
  assert(posts.length === 1, 'duplicate clicks issue one request');
  assert(input('product-name').value === 'Tea Two', 'stale-code rejection preserves draft');
  await waitFor(() => !button('Save Product').disabled, 'save reenabled');
  button('Save Product').click();
  await waitFor(() => !document.querySelector('.add-product-modal'), 'save closes form');
  assert(posts.length === 2 && posts[0]!.requestId === posts[1]!.requestId, 'same request identity used for retry');
  assert(posts[1]!.code === 52 && posts[1]!.weighable === true && posts[1]!.stockable === false, 'correct code and boolean payload');
  assert(document.querySelector('input[aria-label="Search products"]')?.getAttribute('value') === 'Tea', 'search retained');
  assert((document.querySelector('select[aria-label="Filter by category"]') as HTMLSelectElement).value === 'cat', 'category filter retained');
  assert(document.querySelector('table')?.textContent?.includes('Tea Two'), 'created product displayed');
  assert(document.querySelector('[role="status"]')?.textContent?.includes('saved successfully'), 'success message');
  results.push('Stale code, duplicate submissions, save success, list update and unchanged filters');

  unauthorized = true; button('Add New Product').click();
  await waitFor(() => expired === 1, 'session expiry');
  assert(posts.length === 2, 'expired session never saves');
  results.push('Expired configuration session handled without writes');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
}
void run().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
