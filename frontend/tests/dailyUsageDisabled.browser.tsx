import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

void (async () => {
  const checks: string[] = [];
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const wait = async (check: () => unknown, label: string) => { for (let i = 0; i < 180; i++) { if (check()) return; await pause(); } throw new Error(`Timeout ${label}: ${document.body.textContent}`); };
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
  let usageCalls = 0, uploads = 0, updates = 0;
  const backgroundTimers = new Map<number, () => void>();
  let now = Date.now(); Date.now = () => now;
  const interval = window.setInterval.bind(window);
  window.setInterval = ((callback: TimerHandler, delay: number, ...args: unknown[]) => {
    const id = interval(callback, delay, ...args);
    if (delay === 10_000) backgroundTimers.set(id, callback as () => void);
    return id;
  }) as typeof window.setInterval;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
  const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
  const product = { documentId: 'p', fields: { name: 'Tea', code: 1, image: 'old.png', category: 'c',
    price: 12, mrpPrice: 12, costPrice: 5, regionalName: '', shortName: '', discount: 0,
    taxIndex: 1, hsnCode: '', unitId: 2, weighable: false, stockable: true, currentStock: 7 } };
  const categories = [{ id: 'c', name: 'Drinks' }];
  window.fetch = async (url, init) => {
    const path = String(url), headers = new Headers(init?.headers);
    assert(headers.get('Authorization') === 'Bearer test-session', 'Requests retain login authentication');
    if (path.includes('/usage/')) { usageCalls++; throw new Error('Disabled usage API must never be called'); }
    assert(!headers.has('X-Web-Usage-Session'), 'Requests do not depend on daily usage leases');
    if (path.includes('/dashboard?')) return Response.json({ success: true, data: { payments: {}, shifts: [] } });
    if (path.endsWith('/products/p/edit-options')) return Response.json({ success: true, data: { product, code: 1, categories,
      taxes: [{ percent: 0, index: 1, type: 0 }], units: [{ id: 2, name: 'number' }] } });
    if (path.endsWith('/products/p') && init?.method === 'PATCH') { updates++; return Response.json({ success: true, data: product }); }
    if (path.endsWith('/products/p/image')) {
      if (init?.method === 'PUT') {
        uploads++; assert(init.body instanceof File && init.body.size <= 30720, 'Existing processed-image size limit is retained');
        product.fields.image = 'uploaded.png'; return Response.json({ success: true, data: { image: 'uploaded.png' } });
      }
      return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    }
    if (path.endsWith('/products')) return Response.json({ success: true, data: [product] });
    if (path.endsWith('/categories')) return Response.json({ success: true, data: categories });
    if (path === '/api/auth/account') return Response.json({ success: true, data: { name: 'User', email: 'user@example.com', hasLoginPin: false, loginPin: null } });
    throw new Error(`Unexpected route: ${path}`);
  };
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('pos_user_session', JSON.stringify({ id: 'u', name: 'User', email: 'user@example.com', token: 'test-session', role: 'Admin', terminal: 'POS' }));
  localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'o', name: 'Outlet' }));
  const root = createRoot(document.getElementById('root')!);
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    root.render(<App />);
    await wait(() => document.querySelector('.dashboard-columns'), 'dashboard without usage admission');
    assert(!document.querySelector('[data-outlet-access-notice]') && !document.querySelector('.outlet-selection-page'), 'No checking-access card or usage screen appears, even on background startup');
    assert(!document.querySelector('.sidebar-nav')?.textContent?.includes('Daily Web Usage'), 'Daily Web Usage has no menu entry');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'));
    [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === 'Products')!.click();
    await wait(() => document.querySelector('[aria-label="Edit product"]'), 'products load without a usage session');
    document.querySelector<HTMLButtonElement>('[aria-label="Edit product"]')!.click();
    await wait(() => document.getElementById('product-name') && document.querySelector('input[type="file"]'), 'edit product');
    const form = document.getElementById('product-name');
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const selection = new DataTransfer(); selection.items.add(new File([png], 'tea.png', { type: 'image/png' }));
    picker.files = selection.files; picker.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => button('Save') && !button('Save').disabled, 'crop ready');
    const crop = document.querySelector('canvas');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    now += 61_000; [...backgroundTimers.values()].forEach(callback => callback()); await pause();
    assert(document.getElementById('product-name') === form && document.querySelector('canvas') === crop, 'Picker visibility changes preserve the exact form and cropper');
    assert(usageCalls === 0, 'Startup, elapsed idle time, heartbeat intervals, visibility and pagehide make no usage calls');
    button('Save').click(); await wait(() => button('Clear Selection') && !button('Update').disabled, 'compressed preview');
    assert(uploads === 0 && document.querySelector('img[alt="Selected image preview"]'), 'Cropping and preview retain the existing upload-on-save behavior');
    button('Update').click(); await wait(() => !document.getElementById('product-name') && uploads === 1, 'uploaded image returns to products');
    assert(updates === 1 && product.fields.image === 'uploaded.png', 'Product editing and image upload finish without daily usage');
    assert(!document.querySelector('[data-outlet-access-notice]') && usageCalls === 0, 'Daily usage stays completely inactive throughout the image workflow');
    root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks, usageCalls });
  } catch (error) { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); }
})();
