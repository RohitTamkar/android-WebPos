import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import { CategoryPage } from '../src/pages/CategoryPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
const calls: string[] = [];
let mode: 'success' | 'failure' | 'expired' = 'failure';
let expired = 0;
const products = [
  { documentId: 'p1', fields: { id: 'different-stored-id', name: 'Alpha', code: 1, category: 'c1', price: 20 } },
  { documentId: 'p2', fields: { name: 'Other Product', code: 2, category: 'c2', price: 30 } },
];
const categories = [
  { id: 'c1', name: 'First Category', categoryNo: 1, regionalName: '', dayType: '', active: true, productCount: 1, createdAt: '' },
  { id: 'c2', name: 'Other Category', categoryNo: 2, regionalName: '', dayType: '', active: true, productCount: 1, createdAt: '' },
];
window.fetch = async (url, init) => {
  const path = String(url);
  if (!path.startsWith('/api/outlets/outlet/')) throw new Error(`Unexpected request blocked: ${path}`);
  if (init?.method === 'DELETE') {
    calls.push(path);
    if ((init.headers as Record<string, string>).Authorization !== 'Bearer mock-token') throw new Error('Missing auth');
    await new Promise(resolve => setTimeout(resolve, 80));
    if (mode === 'failure') return Response.json({ success: false, message: 'Delete failed. Retry.' }, { status: 503 });
    if (mode === 'expired') return Response.json({ success: false }, { status: 401 });
    const id = decodeURIComponent(path.split('/').at(-1)!);
    if (path.includes('/products/')) { const index = products.findIndex(p => p.documentId === id); if (index >= 0) products.splice(index, 1); }
    else { const index = categories.findIndex(c => c.id === id); if (index >= 0) categories.splice(index, 1); }
    return Response.json({ success: true });
  }
  if (path.endsWith('/products')) return Response.json({ success: true, data: products });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: categories });
  throw new Error(`Unexpected request blocked: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
const outlet = { id: 'outlet' } as OutletSummary;
const onExpired = () => { expired++; };
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
function remove(label: string) { return document.querySelector<HTMLButtonElement>(`button[aria-label="Delete ${label}"]`)!; }
async function value(el: HTMLInputElement | HTMLSelectElement, text: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
async function exercise(kind: 'product' | 'category') {
  const isProduct = kind === 'product';
  root.render(isProduct ? <ProductsPage outlet={outlet} token="mock-token" onSessionExpired={onExpired} />
    : <CategoryPage outlet={outlet} token="mock-token" onSessionExpired={onExpired} />);
  await waitFor(() => remove(kind), `${kind} rows loaded`);
  const search = document.querySelector<HTMLInputElement>(isProduct ? 'input[aria-label="Search products"]' : '.search-input')!;
  const filter = document.querySelector<HTMLSelectElement>(isProduct ? 'select[aria-label="Filter by category"]' : '.filter-select')!;
  await value(search, isProduct ? 'Alpha' : 'First Category');
  await value(filter, isProduct ? 'c1' : 'Active');
  assert(document.querySelectorAll(`button[aria-label="Delete ${kind}"]`).length === 1, 'one matching row');
  const start = calls.length; mode = 'failure';
  remove(kind).click(); await pause();
  const popup = document.querySelector<HTMLDialogElement>('[role="alertdialog"]');
  assert(popup?.open, 'styled confirmation popup opens');
  assert(calls.length === start, 'opening confirmation never sends DELETE');
  assert(popup?.textContent?.includes(isProduct ? 'Alpha' : 'First Category'), 'popup names selected record');
  assert(popup?.textContent?.includes(kind), 'popup identifies record type');
  (document.querySelector('.delete-confirmation-cancel') as HTMLButtonElement).click(); await pause();
  assert(!document.querySelector('[role="alertdialog"]') && calls.length === start, 'Cancel closes popup without deletion');
  remove(kind).click(); await pause();
  document.querySelector('[role="alertdialog"]')!.dispatchEvent(new Event('cancel', { cancelable: true })); await pause();
  assert(!document.querySelector('[role="alertdialog"]') && calls.length === start, 'Escape cancels without deletion');
  remove(kind).click(); await pause();
  const confirm = document.querySelector<HTMLButtonElement>('.delete-confirmation-confirm')!;
  confirm.click(); confirm.click(); await pause();
  assert(calls.length === start + 1, 'duplicate confirmation clicks issue one request');
  assert(document.querySelectorAll('[role="alertdialog"]').length === 1, 'only one confirmation while deleting');
  assert((document.querySelector('.delete-confirmation-cancel') as HTMLButtonElement).disabled, 'cannot cancel an in-flight deletion');
  assert(remove(kind)?.disabled, 'delete disabled while pending');
  assert(document.querySelector('tbody')?.textContent?.includes(isProduct ? 'Alpha' : 'First Category'), 'row retained while pending');
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent?.includes('Delete failed'), 'failure displayed');
  assert(remove(kind) && !remove(kind).disabled, 'failed deletion retains row and allows retry');
  const expectedPath = `/api/outlets/outlet/${isProduct ? 'products/p1' : 'categories/c1'}`;
  assert(calls.at(-1) === expectedPath, 'actual document ID and outlet used');
  mode = 'success'; remove(kind).click(); await pause();
  (document.querySelector('.delete-confirmation-confirm') as HTMLButtonElement).click();
  await waitFor(() => !remove(kind), 'successful deletion removes row');
  assert(search.value === (isProduct ? 'Alpha' : 'First Category'), 'search unchanged');
  assert(filter.value === (isProduct ? 'c1' : 'Active'), 'filter unchanged');
  assert(document.querySelector('[role="status"]')?.textContent?.includes('deleted successfully'), 'success message shown');
  await value(search, ''); if (isProduct) await value(filter, '');
  await waitFor(() => remove(kind), 'other record preserved');
  assert(document.querySelector('tbody')?.textContent?.includes(isProduct ? 'Other Product' : 'Other Category'), 'unrelated row retained');
  const previousExpired = expired; mode = 'expired'; remove(kind).click(); await pause();
  (document.querySelector('.delete-confirmation-confirm') as HTMLButtonElement).click();
  await waitFor(() => expired === previousExpired + 1, 'expired session handled');
  assert(remove(kind), '401 does not remove row');
  results.push(`${kind}: confirmation/Cancel, authorized DELETE, duplicate clicks, pending/failure retention, retry success, unchanged filters and 401`);
}
void (async () => {
  await exercise('product'); await exercise('category');
  assert(products.length === 1 && products[0]?.documentId === 'p2', 'only selected product deleted');
  assert(categories.length === 1 && categories[0]?.id === 'c2', 'only selected category deleted');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
