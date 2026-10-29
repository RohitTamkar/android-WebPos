import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';

const errors: string[] = [], checks: string[] = [];
window.addEventListener('unhandledrejection', event => { errors.push(String(event.reason)); event.preventDefault(); });
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check: () => unknown) { for (let i = 0; i < 180; i++) { if (check()) return; await pause(); } throw new Error('Timed out'); }
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
let mode: 'success' | 'category-error' | 'pending' = 'success';
let aborted = 0, requests = 0;
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes('/master-sync')) return new Response('', { status: 404 });
  requests++;
  if (mode === 'category-error' && path.endsWith('/categories')) return Response.json({ success: false, message: 'Category access denied' }, { status: 403 });
  return new Promise<Response>((resolve, reject) => {
    const signal = init?.signal;
    const abort = () => { aborted++; reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (mode !== 'success') return;
    setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return;
      resolve(Response.json({ success: true, data: path.endsWith('/categories') ? [{ id: 'cat', name: 'Category' }]
        : [{ documentId: 'p', fields: { name: 'Existing product', code: 1, category: 'cat' } }] }));
    }, 80);
  });
};
const root = createRoot(document.getElementById('root')!);
const outlet = { id: 'outlet', name: 'Outlet', active: true };
const onSessionExpired = () => { throw new Error('Unexpected session expiry'); };
const render = (key: string) => flushSync(() => root.render(<StrictMode><ProductsPage key={key} outlet={outlet} token="token" onSessionExpired={onSessionExpired} /></StrictMode>));
void (async () => {
  render('strict');
  await until(() => !!document.querySelector('tbody')?.textContent?.includes('Existing product'));
  await pause();
  assert(aborted >= 2, 'development Strict Mode cancels both initial requests before remounting');
  assert(errors.length === 0, 'Strict Mode cancellation produces no unhandled promise rejection');
  mode = 'category-error'; render('category-error');
  await until(() => document.querySelector('[role=alert]')?.textContent?.includes('Category access denied'));
  await pause();
  assert(errors.length === 0, 'a category failure is handled while the product request is still pending');
  mode = 'pending'; const before = requests; render('pending');
  await until(() => requests >= before + 4);
  root.unmount(); await pause(); await pause();
  assert(errors.length === 0, 'navigating away while both lists load produces no unhandled cancellation');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), errors, checks }); });
