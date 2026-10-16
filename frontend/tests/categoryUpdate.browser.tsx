import { createRoot } from 'react-dom/client';
import { CategoryPage } from '../src/pages/CategoryPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
const patches: { path: string; body: Record<string, unknown> }[] = [];
let mode: 'failure' | 'success' | 'expired' = 'failure';
let expired = 0;
const categories = [
  { id: 'cat', categoryNo: 13, name: 'Food', regionalName: '', dayType: 'Lunch', active: true, productCount: 5, createdAt: '' },
  { id: 'other', categoryNo: 14, name: 'Drinks', regionalName: 'Drink Regional', dayType: '', active: true, productCount: 2, createdAt: '' },
];
window.fetch = async (url, init) => {
  const path = String(url);
  if (path === '/api/outlets/outlet/categories' && init?.method !== 'PATCH') return Response.json({ success: true, data: categories });
  if (path.startsWith('/api/outlets/outlet/categories/') && init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body)); patches.push({ path, body });
    await new Promise(resolve => setTimeout(resolve, 80));
    if (mode === 'failure') return Response.json({ success: false, message: 'Update failed. Retry.' }, { status: 503 });
    if (mode === 'expired') return Response.json({ success: false }, { status: 401 });
    return Response.json({ success: true, data: { id: path.split('/').at(-1), ...body } });
  }
  throw new Error(`Unexpected request blocked: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
root.render(<CategoryPage outlet={{ id: 'outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { expired++; }} />);
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
function input(id: string) { return document.getElementById(id) as HTMLInputElement; }
function button(text: string) { return [...document.querySelectorAll('button')].find(button => button.textContent === text)!; }
function edit() { return document.querySelector<HTMLButtonElement>('[aria-label="Edit category"]')!; }
async function value(el: HTMLInputElement | HTMLSelectElement, text: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
void (async () => {
  await waitFor(() => edit(), 'category load');
  const search = document.querySelector<HTMLInputElement>('.search-input')!;
  await value(search, 'Food');
  await value(document.querySelector<HTMLSelectElement>('.filter-select')!, 'Active');
  edit().click(); await waitFor(() => input('edit-category-number'), 'edit opens');
  assert(input('edit-category-number').readOnly && input('edit-category-number').value === '13', 'existing number read-only');
  assert(input('edit-category-name').value === 'Food', 'name prefilled');
  assert(input('edit-category-regional').value === '', 'actual regional name shown, not dayType fallback');
  await value(input('edit-category-name'), 'Uncommitted');
  button('Cancel').click(); await pause();
  assert(patches.length === 0 && !input('edit-category-name'), 'Cancel leaves data unchanged');
  edit().click(); await waitFor(() => input('edit-category-name'), 'edit reopens');
  assert(input('edit-category-name').value === 'Food', 'cancelled draft discarded');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await pause();
  assert(!input('edit-category-name') && patches.length === 0, 'Escape cancels');
  results.push('Edit opens with existing number and names; number is read-only; Cancel and Escape do not save');

  edit().click(); await waitFor(() => input('edit-category-name'), 'edit ready');
  await value(input('edit-category-name'), ''); button('Update').click(); await pause();
  assert(document.querySelector('[role="alert"]')?.textContent?.includes('required'), 'required name error');
  assert(patches.length === 0, 'invalid name never posts');
  await value(input('edit-category-name'), 'Food Updated'); await value(input('edit-category-regional'), 'Regional Updated');
  const update = button('Update'); update.click(); update.click(); await pause();
  assert(patches.length === 1, 'duplicate submission prevented');
  assert(button('Cancel').disabled, 'cannot close while saving');
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent?.includes('Update failed'), 'failure displayed');
  assert(input('edit-category-name').value === 'Food Updated', 'failed update preserves draft');
  assert(!document.querySelector('.category-updated-popup'), 'failure does not show success');
  assert(patches[0]!.path.endsWith('/cat'), 'original document ID used');
  assert(JSON.stringify(Object.keys(patches[0]!.body).sort()) === '["name","regionalName"]', 'only two names submitted');
  results.push('Required validation, duplicate clicks, exact two-field payload and failure recovery');

  mode = 'success'; button('Update').click();
  await waitFor(() => document.querySelector<HTMLDialogElement>('.category-updated-popup')?.open, 'success popup');
  assert(document.querySelector('.category-updated-popup')?.textContent?.includes('Category updated successfully'), 'success message');
  button('OK').click(); await pause();
  assert(!document.querySelector('.category-updated-popup') && !input('edit-category-name'), 'OK returns to list');
  assert(document.querySelector('tbody')?.textContent?.includes('Food Updated'), 'updated name shown');
  assert(document.querySelector('tbody')?.textContent?.includes('Regional Updated'), 'updated regional shown');
  assert(document.querySelector('tbody')?.textContent?.includes('13'), 'number unchanged');
  assert(document.querySelector<HTMLInputElement>('.search-input')!.value === 'Food', 'search preserved');
  assert(document.querySelector<HTMLSelectElement>('.filter-select')!.value === 'Active', 'filter preserved');
  results.push('Successful update refreshes names, preserves number/filters and shows dismissible success popup');

  edit().click(); await waitFor(() => input('edit-category-name'), 'edit updated category');
  assert(input('edit-category-regional').value === 'Regional Updated', 'subsequent edit uses updated regional');
  mode = 'expired'; button('Update').click(); await waitFor(() => expired === 1, 'expired session');
  assert(!document.querySelector('.category-updated-popup'), '401 never shows success');
  results.push('Updated values retained on reopen and expired session handled');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
