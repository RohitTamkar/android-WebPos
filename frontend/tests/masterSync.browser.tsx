import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import { CategoryPage } from '../src/pages/CategoryPage.tsx';
import { CustomersPage } from '../src/pages/CustomersPage.tsx';
import '../src/index.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown) { for (let i = 0; i < 250; i++) { if (check()) return; await pause(); } throw new Error('Timed out'); }
const feeds = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
const encoder = new TextEncoder();
const notify = (kind: string) => feeds.get(kind)!.enqueue(encoder.encode('{"type":"changed"}\n'));
let products = [{ documentId: 'p1', fields: { name: 'Original product', code: 1, price: 5, category: 'cat' } }];
let categories = [{ id: 'cat', name: 'Original category', categoryNo: 1, regionalName: '', dayType: '', active: true, productCount: 1, createdAt: '' }];
let customers = [{ documentId: 'c1', name: 'Original customer', contact: '', altContact: '', email: '', gstNo: '', address: '', creditLimit: 0, dayLimit: 0, balance: 0, birthdayDate: '', anniversaryDate: '', allowedCredit: false }];
let reads = 0, holdProducts: Promise<void> | null = null;
window.fetch = async (input, init) => {
  assert(!init?.method || init.method === 'GET', 'live sync sends no writes');
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'live sync preserves authentication');
  const url = new URL(String(input), location.href);
  if (url.pathname.endsWith('/master-sync')) {
    const kind = url.searchParams.get('kind')!;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        feeds.set(kind, controller);
        controller.enqueue(encoder.encode('{"type":"changed"}\n'));
        init?.signal?.addEventListener('abort', () => { if (feeds.get(kind) === controller) feeds.delete(kind); try { controller.close(); } catch { /* already closed */ } }, { once: true });
      },
      cancel() { feeds.delete(kind); },
    }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  if (url.pathname.endsWith('/products')) { reads++; if (holdProducts) await holdProducts; return Response.json({ success: true, data: products }); }
  if (url.pathname.endsWith('/categories')) return Response.json({ success: true, data: categories });
  if (url.pathname.endsWith('/customers')) return Response.json({ success: true, data: { customers } });
  throw new Error(`Unexpected request: ${url.pathname}`);
};
const root = createRoot(document.getElementById('root')!);
const outlet = { id: 'outlet', name: 'Outlet', active: true };
const onSessionExpired = () => { throw new Error('Unexpected session expiry'); };
const rows = () => document.querySelector('tbody')?.textContent ?? '';
const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === label)!;
void (async () => {
  flushSync(() => root.render(<ProductsPage outlet={outlet} token="token" onSessionExpired={onSessionExpired} />));
  await until(() => feeds.has('products') && rows().includes('Original product')); await pause(450);
  let release!: () => void;
  holdProducts = new Promise<void>(resolve => { release = resolve; });
  products = [{ ...products[0]!, fields: { ...products[0]!.fields, name: 'Updated product' } }];
  const before = reads; notify('products'); notify('products'); notify('products');
  await until(() => reads > before);
  assert(rows().includes('Original product'), 'existing product rows stay visible during a slow background update');
  assert(reads === before + 1, 'bursts of notifications are coalesced into one list refresh');
  holdProducts = null; release(); await until(() => rows().includes('Updated product'));
  assert(rows().includes('Updated product'), 'changes from another device appear without clicking Refresh');
  products = []; notify('products'); await until(() => !rows().includes('Updated product'));
  assert(!rows().includes('Updated product'), 'remote product deletion removes the row');

  flushSync(() => root.render(<CategoryPage outlet={outlet} token="token" onSessionExpired={onSessionExpired} />));
  await until(() => feeds.has('categories') && rows().includes('Original category'));
  categories = [{ ...categories[0]!, name: 'Updated category', productCount: 3 }]; notify('categories');
  await until(() => rows().includes('Updated category') && rows().includes('3 items'));
  assert(rows().includes('3 items'), 'category names and product counts update automatically');
  assert(!feeds.has('products'), 'navigation closes the previous list subscription');

  flushSync(() => root.render(<CustomersPage outlet={outlet} token="token" onSessionExpired={onSessionExpired} />));
  await until(() => feeds.has('customers') && rows().includes('Original customer'));
  customers = [{ ...customers[0]!, name: 'Updated customer' }]; notify('customers');
  await until(() => rows().includes('Updated customer'));
  assert(rows().includes('Updated customer'), 'customer changes update automatically');
  button('Add Customer').click(); await until(() => !!document.querySelector('#customer-name'));
  const input = document.querySelector<HTMLInputElement>('#customer-name')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Unsaved customer');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  customers = [{ ...customers[0]!, name: 'Customer changed while editing' }];
  await pause(450);
  assert(input.value === 'Unsaved customer' && !feeds.has('customers'), 'live updates preserve unsaved forms and pause their subscription');
  button('Cancel').click(); await until(() => rows().includes('Customer changed while editing'));
  assert(rows().includes('Customer changed while editing'), 'closing a form resumes updates and reconciles missed changes');
  feeds.get('customers')!.close(); feeds.delete('customers');
  customers = [];
  await until(() => feeds.has('customers') && !rows().includes('Customer changed while editing'));
  assert(!rows().includes('Customer changed while editing'), 'a disconnected feed reconnects and reconciles remote deletions');
  root.unmount(); await pause(); assert(feeds.size === 0, 'unmount closes all subscriptions');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
