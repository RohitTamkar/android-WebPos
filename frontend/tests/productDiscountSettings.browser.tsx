import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, label: string) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${label}`); }
const products = new Map<string, Record<string, unknown>>([
  ['p1', { name: 'Papad Roasted', code: 1, category: 'food', discount: 10, currentStock: 45, price: 50, taxIndex: 2 }],
  ['p2', { name: 'Masala Papad', code: 2, category: 'food', discount: 0, stockable: true, priceTable: '{"default price":60}', price: 60 }],
  ['p3', { name: 'Veg Burger', code: 3, category: 'burger', discount: 5, custom: { keep: true }, image: 'saved.png' }],
]);
const original = structuredClone(products);
const patches: { id: string; discount: number }[] = [];
let release!: () => void;
const ready = new Promise<void>(resolve => { release = resolve; });
let loadFailure = true, failId = 'p2', expired = 0, expire = false;
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Requests retain authorization');
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [{ id: 'food', name: 'Food' }, { id: 'burger', name: 'Burger' }, { id: 'empty', name: 'Empty' }] });
  if (path.endsWith('/products')) {
    await ready;
    if (loadFailure) return Response.json({ message: 'List unavailable' }, { status: 503 });
    return Response.json({ success: true, data: [...products].map(([documentId, fields]) => ({ documentId, fields })) });
  }
  const match = path.match(/^\/api\/outlets\/outlet\/products\/(p[123])$/);
  if (match && init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body));
    assert(Object.keys(body).join() === 'discount' && typeof body.discount === 'number', 'Only numeric discount is patched');
    const id = match[1]!; patches.push({ id, discount: body.discount });
    await new Promise(resolve => setTimeout(resolve, 80));
    if (expire) return Response.json({ message: 'Session expired' }, { status: 401 });
    if (id === failId) return Response.json({ message: 'Save failed' }, { status: 503 });
    products.set(id, { ...products.get(id), ...body });
    return Response.json({ success: true, data: { documentId: id, fields: products.get(id) } });
  }
  throw new Error(`Unexpected request: ${path}`);
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)!;
const box = (label: string) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const selectAll = () => box('Select all displayed products');
const input = () => document.getElementById('bulk-product-discount') as HTMLInputElement;
async function click(element: HTMLElement) { element.click(); await pause(); }
async function value(next: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), next);
  input().dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
async function open() {
  await click(document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!);
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent?.trim());
  assert(items[items.indexOf('Tax') + 1] === 'Update Discount', 'Update Discount follows Tax in product menu');
  await click(button('Update Discount'));
}
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'outlet', name: 'Test Outlet' } as OutletSummary} token="token" onSessionExpired={() => { expired++; }} />);
void (async () => {
  await until(() => document.querySelector('[aria-label="More options"]'), 'menu while loading');
  await open();
  assert(document.querySelector('h1')?.textContent === 'Update Discount' && !input(), 'Loading guard opens the requested screen without empty product initialization');
  release(); await until(() => document.querySelector('[role="alert"]'), 'list error');
  loadFailure = false; await click(button('Retry')); await until(() => input(), 'discount screen after retry');
  assert(button('Cancel') && button('Update') && button('Update').disabled, 'Top actions exist and updates require input and selection');
  assert([...document.querySelectorAll('thead th')].map(th => th.textContent?.trim()).join('|') === 'Sr. no|Product Name|Discount (%)|Select All', 'All requested table fields display');
  assert(document.querySelector('tbody tr')?.textContent?.includes('10'), 'Stored discounts display');
  await click(button('Food')); await click(box('Select Papad Roasted'));
  assert(selectAll().indeterminate, 'Header shows partial category selection');
  await click(button('Burger')); await click(selectAll()); await click(button('Food'));
  assert(box('Select Papad Roasted').checked && !box('Select Masala Papad').checked, 'Selections survive category changes');
  await click(selectAll()); await click(button('All'));
  assert(selectAll().checked, 'Select All operates on displayed products while retaining other category selections');
  await click(button('Empty'));
  assert(selectAll().disabled && document.querySelector('tbody')?.textContent?.includes('No products'), 'Empty category is handled');
  await click(button('Cancel')); assert(patches.length === 0, 'Cancel performs no writes');
  await open(); await until(() => input(), 'reopen');
  await click(box('Select Papad Roasted'));
  for (const invalid of ['-1', '101']) { await value(invalid); await click(button('Update')); assert(document.querySelector('[role="status"]')?.textContent?.includes('between 0 and 100'), 'Out-of-range discount rejected'); }
  assert(patches.length === 0, 'Invalid discounts never reach the API');
  await value('10'); await click(button('Update'));
  assert(patches.length === 0 && document.querySelector('[role="status"]')?.textContent?.includes('already use'), 'Unchanged discounts do not generate writes');
  if (location.hash === '#preview') {
    await value('12.5'); await click(selectAll());
    document.documentElement.dataset.theme = 'light';
    const target = document.getElementById('root')!; target.style.padding = '24px'; target.style.background = 'var(--workspace)';
    document.getElementById('test-results')!.style.display = 'none';
    document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks }); return;
  }
  await value('0'); await click(button('Update'));
  await until(() => document.querySelector('[aria-label="More options"]'), 'zero discount saved');
  assert(products.get('p1')!.discount === 0 && patches.length === 1, 'Zero removes the selected discount');
  await open(); await until(() => input(), 'reopen after zero');
  await click(selectAll()); await value('12.5');
  button('Update').click(); button('Update').click(); await pause();
  assert(button('Updating…').disabled && button('Cancel').disabled && input().disabled, 'Duplicate saves and edits blocked during update');
  await until(() => document.querySelector('[aria-label="Failed products"]'), 'partial failure');
  assert(patches.length === 4 && box('Select Masala Papad').checked && !box('Select Papad Roasted').checked && !box('Select Veg Burger').checked, 'Only failed products remain selected for retry');
  failId = ''; await click(button('Update'));
  await until(() => document.querySelector('[aria-label="More options"]'), 'retry completed');
  assert(patches.length === 5 && patches.at(-1)!.id === 'p2', 'Retry saves only the failed product');
  assert(!document.querySelector('.products-notice'), 'Completed discount updates leave no success banner');
  for (const [id, fields] of original) assert(JSON.stringify(products.get(id)) === JSON.stringify({ ...fields, discount: 12.5 }), `Stock, prices and other fields preserved for ${id}`);
  await open(); await until(() => input(), 'saved discount values');
  assert([...document.querySelectorAll('tbody tr')].every(row => row.textContent?.includes('12.5')), 'Saved discounts display when reopened');
  await click(box('Select Papad Roasted')); await value('20'); expire = true; await click(button('Update'));
  await until(() => expired === 1, 'session callback');
  assert(products.get('p1')!.discount === 12.5, 'Expired session does not report a false save');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: checks }); });
