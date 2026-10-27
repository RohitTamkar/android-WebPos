import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import { ANDROID_TAX_OPTIONS } from '../../shared/androidTaxes.ts';
import '../src/index.css';

const checks: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const records = new Map<string, Record<string, unknown>>([
  ['p1', { name: 'Apple', code: 1, category: 'food', taxIndex: 1, price: 50, kitchenId: 'kitchen', stockable: true }],
  ['p2', { name: 'Banana', code: 2, category: 'food', taxIndex: 7, price: 20, currentStock: 15 }],
  ['p3', { name: 'Cola', code: 3, category: 'drinks', taxIndex: 4, price: 10, custom: { keep: true } }],
]);
const before = structuredClone(records);
const categories = [{ id: 'food', name: 'Food' }, { id: 'drinks', name: 'Drinks' }, { id: 'empty', name: 'Empty' }];
const patches: { id: string; body: Record<string, unknown> }[] = [];
let failedId = 'p2', expired = 0, expireNext = false;
let releaseLoading: (() => void) | undefined;
const initialLoad = new Promise<void>(resolve => { releaseLoading = resolve; });
let loadStatus = 503;
window.fetch = async (url, init) => {
  const path = String(url);
  if (path === '/api/outlets/outlet/products') {
    await initialLoad;
    if (loadStatus !== 200) return Response.json({ success: false, message: 'List unavailable.' }, { status: loadStatus });
    return Response.json({ success: true, data: [...records].map(([documentId, fields]) => ({ documentId, fields })) });
  }
  if (path === '/api/outlets/outlet/categories') return Response.json({ success: true, data: categories });
  const match = path.match(/^\/api\/outlets\/outlet\/products\/(p[123])$/);
  if (match && init?.method === 'PATCH') {
    const id = match[1]!, body = JSON.parse(String(init.body)); patches.push({ id, body });
    assert(new Headers(init.headers).get('Authorization') === 'Bearer mock-token', 'Tax update retains authorization');
    assert(Object.keys(body).join(',') === 'taxIndex' && typeof body.taxIndex === 'number', 'Only numeric taxIndex is submitted');
    await new Promise(resolve => setTimeout(resolve, 70));
    if (expireNext) return Response.json({ success: false }, { status: 401 });
    if (id === failedId) return Response.json({ success: false, message: 'Product save failed.' }, { status: 503 });
    records.set(id, { ...records.get(id), ...body });
    return Response.json({ success: true, data: { documentId: id, fields: records.get(id) } });
  }
  throw new Error(`Unexpected request: ${path}`);
};
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const box = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const all = () => box('Select all displayed products');
const click = async (node: HTMLElement) => { node.click(); await pause(); };
const taxSelect = () => document.getElementById('bulk-product-tax') as HTMLSelectElement;
async function chooseTax(tax: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(taxSelect(), tax);
  taxSelect().dispatchEvent(new Event('change', { bubbles: true })); await pause();
}
async function open() {
  await until(() => document.querySelector('section[aria-busy="false"] [aria-label="More options"]'), 'product list ready');
  await click(document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!);
  await click(button('Tax'));
  await until(() => all(), 'tax screen');
}
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{ id: 'outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => { expired++; }} />);
void (async () => {
  await until(() => document.querySelector('[aria-label="More options"]'), 'menu available during loading');
  const search = document.querySelector<HTMLInputElement>('[aria-label="Search products"]')!;
  search.focus();
  assert(parseFloat(getComputedStyle(search).minHeight) >= 40 && getComputedStyle(search).outlineStyle === 'none', 'Search has a comfortable height and no nested input outline');
  for (const item of ['Save Excel', 'Update Stockable & Weighable', 'Assign Service Point']) {
    await click(document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!);
    assert([...document.querySelectorAll<HTMLButtonElement>('#products-more-menu [role="menuitem"]')].filter(node => node.textContent?.trim() !== 'Delete All').every(node => !node.disabled), 'Non-destructive menu actions are available during loading');
    assert(button('Delete All').disabled, 'Delete All stays disabled until products load');
    await click(button(item));
    assert(item === 'Save Excel' ? document.querySelector('dialog[open]') : document.querySelector('[role="status"]')?.textContent?.includes('Loading products'), `${item} opens before products finish loading`);
    await click(button('Cancel'));
  }
  await click(document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!);
  await click(button('Tax'));
  assert(document.querySelector('h1')?.textContent === 'Tax Settings' && !all(), 'Tax opens in a loading state without initializing empty selections');
  releaseLoading!();
  await until(() => document.querySelector('[role="alert"]'), 'list failure in opened screen');
  loadStatus = 200; await click(button('Retry'));
  await until(() => all(), 'tax screen resumes when retry completes');
  assert(document.querySelector('h1')?.textContent === 'Tax Settings', 'Products menu opens Tax Settings');
  assert([...taxSelect().options].slice(1).map(option => option.text).join('|') === ANDROID_TAX_OPTIONS.map(option => option.name).join('|'), 'Dropdown contains all existing GST and VAT options');
  assert(document.querySelector('tbody')?.textContent?.includes('VAT 10'), 'Current product tax names display');
  assert(button('Update').disabled && !all().checked, 'Products begin unselected and Update is disabled');
  await click(button('Food')); await click(box('Select Apple'));
  assert(all().indeterminate && !all().checked, 'Individual selection sets indeterminate header');
  await click(button('Drinks')); await click(all());
  await click(button('Food'));
  assert(box('Select Apple').checked && !box('Select Banana').checked, 'Selections survive category changes');
  await click(all()); await click(button('All'));
  assert(all().checked && box('Select Cola').checked, 'Select All selects visible category while preserving other selections');
  await click(button('Food')); await click(all()); await click(button('All'));
  assert(!box('Select Apple').checked && !box('Select Banana').checked && box('Select Cola').checked, 'Category deselection preserves selections in other categories');
  await click(button('Empty'));
  assert(all().disabled && document.querySelector('tbody')?.textContent?.includes('No products'), 'Empty categories display an empty state');
  await click(button('Cancel')); await open();
  assert(!all().checked && patches.length === 0 && JSON.stringify([...records]) === JSON.stringify([...before]), 'Cancel discards selection without writes');
  await click(box('Select Apple')); await chooseTax('1'); await click(button('Update'));
  assert(patches.length === 0 && document.querySelector('[role="status"]')?.textContent?.includes('already use'), 'Already assigned tax is not written again');
  await click(all()); await chooseTax('2');
  button('Update').click(); button('Update').click(); await pause();
  assert(button('Updating…').disabled && button('Cancel').disabled && taxSelect().disabled && all().disabled, 'Pending update prevents duplicate requests and edits');
  assert(!document.querySelector('.product-tax-success'), 'No success popup before update confirmation');
  await until(() => document.querySelector('[role="alert"]'), 'partial failure');
  assert(patches.length === 3 && box('Select Banana').checked && !box('Select Apple').checked && !box('Select Cola').checked, 'Partial failure retains only failed selections');
  assert(document.querySelector('[aria-label="Failed products"]')?.textContent?.includes('Banana'), 'Failed product is identified');
  const bounds = document.querySelector('.product-tax-settings')!.getBoundingClientRect();
  assert(bounds.left >= 0 && bounds.right <= innerWidth && document.querySelector('.tax-settings-table')!.getBoundingClientRect().width <= bounds.width, 'Tax Settings fits the desktop or mobile viewport');
  failedId = ''; await click(button('Update'));
  await until(() => document.querySelector('[aria-label="More options"]'), 'successful return');
  assert(patches.length === 4 && patches[3]!.id === 'p2', 'Retry updates only the failed product');
  const success = document.querySelector<HTMLDialogElement>('.product-tax-success[role="alertdialog"]');
  assert(success?.open && success.textContent?.includes('Tax updated successfully.'), 'Confirmed bulk update opens success confirmation dialog');
  assert(document.activeElement?.textContent === 'OK', 'Success confirmation focuses the OK button');
  const successBounds = success!.getBoundingClientRect();
  assert(Math.abs(successBounds.left + successBounds.width / 2 - document.documentElement.clientWidth / 2) < 2 && successBounds.width <= innerWidth - 32, 'Success dialog is centered and fits the viewport');
  await click(document.querySelector<HTMLButtonElement>('[aria-label="Dismiss tax success message"]')!);
  assert(!document.querySelector('.product-tax-success'), 'Success popup can be dismissed');
  for (const [id, fields] of before) assert(JSON.stringify(records.get(id)) === JSON.stringify({ ...fields, taxIndex: 2 }), `Other product data preserved for ${id}`);
  await open();
  assert([...document.querySelectorAll('tbody tr')].every(row => row.textContent?.includes('GST 5')), 'Reopened screen shows saved tax names');
  await click(box('Select Apple')); await chooseTax('3'); expireNext = true; await click(button('Update'));
  await until(() => expired === 1, 'expired session callback');
  assert(records.get('p1')!.taxIndex === 2, 'Expired session does not change product data');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: checks }); });
