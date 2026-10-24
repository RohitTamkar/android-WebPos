import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const results: string[] = [];
const products = [
  { documentId: 'p1', fields: { code: '10', name: 'Banana', regionalName: 'Kela', dateTme: { _seconds: 200 } } },
  { documentId: 'p2', fields: { code: '2', name: 'Apple', regionalName: 'Seb', dateTme: { _seconds: 300 } } },
  { documentId: 'p3', fields: { code: '1', name: 'Carrot', regionalName: 'Gajar', dateTme: { _seconds: 100 } } },
];
try { localStorage.removeItem('products-sort:outlet'); } catch { /* storage unavailable */ }
window.fetch = async url => {
  const path = String(url);
  if (path === '/api/outlets/outlet/products') return Response.json({ success: true, data: products });
  if (path === '/api/outlets/outlet/categories') return Response.json({ success: true, data: [] });
  throw new Error(`Unexpected request blocked: ${path}`);
};
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
const names = () => [...document.querySelectorAll('.products-table tbody .products-name')].map(cell => cell.textContent?.trim()).join(',');
const click = async (element: Element | null | undefined) => { (element as HTMLElement).click(); await pause(); };
const sortToggle = () => document.querySelector('.products-sort-toggle');
async function choose(label: string) {
  await click(document.querySelector('[aria-label="More options"]'));
  await click(sortToggle());
  assert(sortToggle()?.getAttribute('aria-expanded') === 'true', 'sort dropdown expands');
  await click(button(label));
  assert(!document.getElementById('products-more-menu'), 'menu closes after choosing');
}
const mount = () => { const root = createRoot(document.getElementById('root')!); root.render(<ProductsPage outlet={{ id: 'outlet' } as OutletSummary} token="mock-token" onSessionExpired={() => {}} />); return root; };
void (async () => {
  let root = mount();
  await waitFor(() => names() === 'Carrot,Apple,Banana', 'default Search Code order');
  await click(document.querySelector('[aria-label="More options"]'));
  assert(sortToggle()?.textContent?.includes('Search Code'), 'current sort shown');
  await click(sortToggle());
  const options = [...document.querySelectorAll('#products-sort-menu [role="menuitemradio"]')];
  assert(JSON.stringify(options.map(option => option.textContent)) === '["Search Code","Sort A-Z","Sort By Date","Regional Wise"]', 'four options');
  assert(options[0]!.getAttribute('aria-checked') === 'true', 'active option checked');
  await click(document.querySelector('[aria-label="More options"]'));
  results.push('Sort dropdown lists the four options with Search Code active by default');

  await choose('Sort A-Z'); assert(names() === 'Apple,Banana,Carrot', `A-Z ${names()}`);
  await choose('Sort By Date'); assert(names() === 'Apple,Banana,Carrot', `date ${names()}`);
  await choose('Regional Wise'); assert(names() === 'Carrot,Banana,Apple', `regional ${names()}`);
  await choose('Search Code'); assert(names() === 'Carrot,Apple,Banana', `code ${names()}`);
  results.push('Each option reorders the product table');

  await choose('Sort By Date'); root.unmount(); root = mount();
  await waitFor(() => names() === 'Apple,Banana,Carrot', 'remembered sort after remount');
  results.push('Chosen sort is remembered for the outlet');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
