import { createRoot } from 'react-dom/client';
import { CategoryPage } from '../src/pages/CategoryPage.tsx';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/Theme.css';

const passed: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, label: string) {
  for (let index = 0; index < 150; index++) { if (check()) return; await pause(); }
  throw new Error(`Timed out: ${label}`);
}
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === name)!;
async function value(id: string, next: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true })); await pause();
}
const category = { id: 'c1', name: 'Food', regionalName: '', dayType: '', categoryNo: 15, productCount: 0, createdAt: '', active: true };
const mutations: { url: string; body: Record<string, unknown> }[] = [];
let mode: 'category' | 'product' = 'category';
let resolveCategory!: (response: Response) => void;
const categoryLoad = new Promise<Response>(resolve => { resolveCategory = resolve; });
let resolveProducts!: (response: Response) => void;
const productLoad = new Promise<Response>(resolve => { resolveProducts = resolve; });
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Authenticated requests');
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body)); mutations.push({ url: path, body });
    return Response.json({ success: true, data: path.endsWith('/categories')
      ? { ...category, id: 'c2', ...body }
      : { documentId: 'new-product', fields: { ...body, id: 'new-product' } } });
  }
  if (init?.method === 'DELETE' && path === '/api/outlets/outlet/categories') {
    mutations.push({ url: path, body: JSON.parse(String(init.body)) });
    return Response.json({ success: true, data: { deleted: 2 } });
  }
  assert(!init?.method || init.method === 'GET', 'Only confirmed actions write to the database');
  // The page reads names and counts separately, so each request needs its own body.
  if (path.endsWith('/categories')) return mode === 'category' ? categoryLoad.then(response => response.clone()) : Response.json({ success: true, data: [category] });
  if (path.endsWith('/products/create-options')) return Response.json({ success: true, data: {
    code: 1, categories: [category], taxes: [{ percent: 5, index: 1, type: 0 }], units: [{ id: 2, name: 'NUMBER' }],
    premises: [{ id: 'table', name: 'TABLE' }, { id: 'ac', name: 'AC Table' }],
  } });
  if (path.endsWith('/products')) return productLoad;
  throw new Error(`Unexpected request: ${path}`);
};
const outlet = { id: 'outlet', name: 'Test Outlet' } as OutletSummary;
const expired = () => { throw new Error('Unexpected session expiration'); };
let root = createRoot(document.getElementById('root')!);
root.render(<CategoryPage outlet={outlet} token="token" onSessionExpired={expired} />);
void (async () => {
  await until(() => button('Add New Category'), 'Category header');
  assert(!button('Add New Category').disabled, 'Add Category remains available during loading');
  button('Add New Category').click(); await until(() => document.getElementById('new-category-name'), 'Category form');
  await value('new-category-name', 'New Category');
  assert(button('Add Category').disabled, 'Save waits for safe category number');
  resolveCategory(Response.json({ success: true, data: [category] }));
  await until(() => !button('Add Category').disabled, 'Category data loaded');
  assert((document.getElementById('new-category-number') as HTMLInputElement).value === '16', 'Category number uses loaded data');
  assert((document.getElementById('new-category-name') as HTMLInputElement).value === 'New Category', 'Typing during loading preserved');
  button('Add Category').click(); await until(() => !document.getElementById('new-category-name'), 'Category saved');
  assert(mutations.length === 1 && mutations[0]!.body.categoryNo === 16, 'Category submitted as number');
  passed.push('Add Category opens during loading and retains typed names until the category number is ready');
  document.querySelector<HTMLButtonElement>('[aria-label="Category options"]')!.click(); await pause();
  assert(button('Delete All'), 'Small category menu reveals Delete All'); button('Delete All').click();
  await until(() => document.querySelector('dialog[open]'), 'Delete all confirmation');
  assert(document.querySelector('dialog[open]')!.textContent!.includes('Are you sure you want to delete all categories?'), 'Delete all question');
  button('No').click(); await until(() => !document.querySelector('dialog[open]'), 'No closes');
  assert(mutations.length === 1 && document.querySelectorAll('tbody .category-code-badge').length === 2, 'No keeps categories');
  document.querySelector<HTMLButtonElement>('[aria-label="Category options"]')!.click(); await pause(); button('Delete All').click();
  await until(() => button('Yes'), 'Confirmation reopened'); button('Yes').click();
  await until(() => document.querySelector('dialog[open]')?.textContent?.includes('Categories deleted successfully'), 'Success message');
  assert(mutations.length === 2 && mutations[1]!.url === '/api/outlets/outlet/categories' && mutations[1]!.body.confirm === 'DELETE_ALL_CATEGORIES', 'Confirmed delete-all request');
  assert(!document.querySelector('tbody .category-code-badge'), 'Categories removed from the list');
  button('OK').click(); await until(() => !document.querySelector('dialog[open]'), 'Success dismissed');
  passed.push('Delete All asks Yes/No; No keeps categories; Yes deletes them all and shows a success message');
  root.unmount(); mode = 'product'; root = createRoot(document.getElementById('root')!);
  root.render(<ProductsPage outlet={outlet} token="token" onSessionExpired={expired} />);
  await until(() => button('Add New Product'), 'Product header');
  assert(!button('Add New Product').disabled, 'Add Product available before list completes');
  button('Add New Product').click(); await until(() => document.getElementById('product-code')?.getAttribute('value') === '1', 'Product options');
  assert(document.querySelector('.modal-body')?.lastElementChild?.classList.contains('local-image-picker'), 'Image upload is last');
  for (const id of ['wholeSaleAmount', 'onlinePrice', 'barcode', 'kitchenId', 'variant', 'addon', 'recipeId', 'discountAmount']) {
    assert(document.getElementById(`product-${id}`), `Form contains ${id}`);
  }
  assert(document.querySelector('[aria-label="TABLE Price"]') && document.querySelector('[aria-label="AC Table Price"]'), 'Existing premises have price displays');
  await value('product-name', 'New Product'); await value('product-price', '80');
  await value('product-wholeSaleAmount', '70'); await value('product-onlinePrice', '90'); await value('product-discount', '10');
  assert((document.getElementById('product-discountAmount') as HTMLInputElement).value === '8', 'Discount amount calculated for display');
  const select = document.getElementById('product-category') as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'c1');
  select.dispatchEvent(new Event('change', { bubbles: true })); await pause();
  button('Save Product').click(); await until(() => mutations.length === 3, 'Product POST');
  const payload = mutations[2]!.body;
  assert(payload.wholeSaleAmount === 70 && payload.onlinePrice === 90, 'Existing numeric price fields submitted');
  for (const key of ['rent', 'variant', 'addon', 'discountAmount', 'kitchenId', 'recipeId', 'barcode', 'priceTable']) assert(!(key in payload), `Display-only ${key} not submitted`);
  resolveProducts(Response.json({ success: true, data: [] }));
  await until(() => document.querySelector('tbody')?.textContent?.includes('New Product'), 'Saved product survives late list response');
  passed.push('Add Product can save while list loads; new row survives a late list response');
  passed.push('All requested fields display, image upload is last, calculated/unsupported fields are not persisted');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
