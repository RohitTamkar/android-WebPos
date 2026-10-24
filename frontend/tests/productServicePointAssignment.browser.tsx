import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';
const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const wait = async (check: () => unknown, message: string) => { for (let i = 0; i < 160; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); };
const products = [
  { documentId: 'tea', fields: { name: 'Tea', code: 1, category: 'drinks', kitchenId: 'old', price: 10, stockable: true } },
  { documentId: 'rice', fields: { name: 'Rice', code: 2, category: 'food', kitchenId: 'old', price: 50, stockable: false } },
  { documentId: 'bread', fields: { name: 'Bread', code: 3, category: 'food', kitchenId: '', price: 20, stockable: true } },
];
const before = structuredClone(products), posts: Record<string, unknown>[] = [];
let release: (() => void) | undefined, fail = true, pointReads = 0;
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Requests retain signed-session authentication');
  if (path === '/api/outlets/outlet/products') return Response.json({ success: true, data: products });
  if (path === '/api/outlets/outlet/categories') return Response.json({ success: true, data: [{ id: 'drinks', name: 'Drinks' }, { id: 'food', name: 'Food' }] });
  if (path === '/api/outlets/outlet/service-points') { pointReads++; return Response.json({ success: true, data: { servicePoints: [{ documentId: 'point', name: 'KOTPRINTER' }] } }); }
  if (path === '/api/outlets/outlet/products/assign-service-point' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)); posts.push(body);
    await new Promise<void>(resolve => { release = resolve; });
    if (fail) return Response.json({ success: false, message: 'Assignment failed. Retry.' }, { status: 503 });
    products.filter(product => product.fields.category === body.categoryId).forEach(product => { product.fields.kitchenId = body.servicePointId; });
    return Response.json({ success: true, data: { ...body, assignedCount: 2, updatedCount: 2 } });
  }
  throw new Error(`Unexpected request: ${path}`);
};
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const click = async (node: HTMLElement) => { node.click(); await pause(); };
const dialog = () => document.querySelector<HTMLDialogElement>('dialog')!;
const value = async (node: HTMLInputElement | HTMLSelectElement, value: string) => {
  const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(node,value);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input',{bubbles:true})); await pause();
};
const open = async () => {
  await click(document.querySelector<HTMLButtonElement>('[aria-label="More options"]')!);
  const items = [...document.querySelectorAll('#products-more-menu [role="menuitem"]')].map(node => node.textContent?.trim());
  assert(items.join('|') === 'Save Excel|Update Stockable & Weighable|Assign Service Point', 'Assign Service Point follows existing menu options');
  await click(button('Assign Service Point')); await wait(()=>dialog()?.open,'assignment dialog');
};
const root = createRoot(document.getElementById('root')!);
root.render(<ProductsPage outlet={{id:'outlet'} as OutletSummary} token="token" onSessionExpired={()=>{}} />);
void(async()=>{
  await wait(()=>document.querySelector('section[aria-busy="false"]'),'products loaded');
  await value(document.querySelector<HTMLSelectElement>('[aria-label="Filter by category"]')!,'drinks');
  await value(document.querySelector<HTMLInputElement>('[aria-label="Search products"]')!,'Tea');
  await open();
  const bounds=dialog().getBoundingClientRect();assert(bounds.left>=0&&bounds.right<=innerWidth,'Assignment dialog fits the viewport');
  assert(button('Food',dialog()) && button('Drinks',dialog()) && pointReads===0,'Category list appears before service points regardless of product filters');
  await click(button('Food',dialog())); await wait(()=>document.querySelector('[name="assignedServicePoint"]'),'service points loaded');
  assert(button('Assign',dialog()).disabled && posts.length===0,'Assignment requires a service point and sends nothing during selection');
  await click(document.querySelector<HTMLInputElement>('[name="assignedServicePoint"]')!);
  await click(button('Assign',dialog()));
  assert(dialog().textContent?.includes('Are you sure') && dialog().textContent?.includes('replaces their current service point'),'Confirmation describes category-wide replacement');
  await click(button('No',dialog())); assert(posts.length===0 && document.querySelector('[name="assignedServicePoint"]'),'No returns to selection without writes');
  await click(button('Assign',dialog())); await click(button('Yes',dialog())); await wait(()=>release,'assignment pending');
  assert(button('Assigning…',dialog()).disabled && button('Cancel',dialog()).disabled && !document.querySelector('.products-notice'),'Pending assignment prevents duplicates and shows no premature success');
  release!(); await wait(()=>dialog().querySelector('[role="alert"]'),'assignment error');
  assert(JSON.stringify(products)===JSON.stringify(before),'Failed assignment leaves product data intact');
  fail=false;release=undefined;await click(button('Yes',dialog()));await wait(()=>release,'retry pending');release!();
  await wait(()=>!dialog(),'assignment success');
  assert(document.querySelector('.products-notice')?.textContent === 'Successfully assigned the service point to 2 products.','Confirmed success notification');
  assert(posts.length===2 && posts.every(body=>JSON.stringify(body)===JSON.stringify({categoryId:'food',servicePointId:'point'})),'Only chosen category and service point IDs are submitted');
  assert(products[0]!.fields.kitchenId==='old' && products[1]!.fields.kitchenId==='point' && products[2]!.fields.kitchenId==='point','All category products, including hidden rows, receive the assignment');
  products.forEach((product,index)=>assert(product.fields.price===before[index]!.fields.price && product.fields.stockable===before[index]!.fields.stockable,'Unrelated product settings are preserved'));
  const count=posts.length;await open();await click(button('Cancel',dialog()));assert(posts.length===count,'Cancel sends no assignment');
  root.unmount();document.getElementById('test-results')!.textContent=JSON.stringify({passed:checks});
})().catch(error=>{document.getElementById('test-results')!.textContent=JSON.stringify({failed:String(error),checks});});
