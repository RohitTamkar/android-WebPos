import { createRoot } from 'react-dom/client';
import { CategoryPage } from '../src/pages/CategoryPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const passed: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
const category = { id: 'c1', name: 'Starters', regionalName: '', dayType: '', categoryNo: 1, createdAt: '', active: true };
let releaseCounts!: () => void;
const counts = new Promise<void>(resolve => { releaseCounts = resolve; });
window.fetch = async (url, init) => {
  assert(!init?.method || init.method === 'GET', 'Loading categories never writes');
  assert(String(url) === '/api/outlets/outlet/categories', `Unexpected request: ${String(url)}`);
  // Names-only requests answer at once; the counted list waits for the test.
  if (new Headers(init?.headers).get('X-Category-Counts') === 'omit') return Response.json({ success: true, data: [category] });
  await counts;
  return Response.json({ success: true, data: [{ ...category, productCount: 7 }] });
};
const root = createRoot(document.getElementById('root')!);
root.render(<CategoryPage outlet={{ id: 'outlet', name: 'Outlet' } as OutletSummary} token="token" onSessionExpired={() => { throw new Error('Unexpected session expiration'); }} />);
void (async () => {
  await until(() => document.querySelector('tbody')?.textContent?.includes('Starters'), 'category names show before counts');
  assert(document.querySelector('.product-count-chip')?.textContent?.includes('… items'), 'pending counts show a placeholder, not zero');
  passed.push('Category names display before product counts finish loading');
  releaseCounts();
  await until(() => document.querySelector('.product-count-chip')?.textContent?.includes('7 items'), 'counts fill in');
  assert(document.querySelectorAll('tbody tr').length === 1, 'counts fill the existing rows without duplicates');
  passed.push('Product counts fill into the listed categories when they arrive');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
