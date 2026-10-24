import { createRoot } from 'react-dom/client';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

void (async () => {
  const passed: string[] = [];
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
  const wait = async (check: () => unknown, label: string) => {
    for (let i = 0; i < 180; i++) { if (check()) return; await pause(); }
    throw new Error(`Timeout ${label}: ${document.body.textContent}`);
  };
  const products: { documentId: string; fields: Record<string, unknown> }[] = [
    { documentId: 'a', fields: { name: 'Tea A', code: 1, image: 'shared.png', price: 12, currentStock: 5 } },
    { documentId: 'b', fields: { name: 'Tea B', code: 2, image: 'shared.png', price: 13, currentStock: 6 } },
    { documentId: 'c', fields: { name: 'Tea C', code: 3, imagePath: 'legacy/path', price: 14, currentStock: 7 } },
    { documentId: 'd', fields: { name: 'Tea D', code: 4, price: 15, currentStock: 8 } },
  ];
  const before = JSON.stringify(products.map(product => [product.documentId, product.fields.name, product.fields.price, product.fields.currentStock]));
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
  const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
  let failB = true, changeC = true, productReads = 0;
  const removals: string[] = [];
  window.fetch = async (url, init) => {
    assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Existing JWT retained');
    const path = String(url);
    if (path.endsWith('/product-images/verify-quick-pin')) {
      const body = JSON.parse(String(init?.body));
      assert(body.quickPin === '1234', 'Quick PIN verified before entry');
      return Response.json({ success: true, data: { verified: true, action: body.action, imageToken: 'image-grant' } });
    }
    if (path === '/api/outlets/o/products') { productReads++; return Response.json({ success: true, data: structuredClone(products) }); }
    if (path === '/api/outlets/o/categories') return Response.json({ success: true, data: [] });
    const match = path.match(/^\/api\/outlets\/o\/(?:products\/([abc])\/image|product-image-removals\/([abc]))$/);
    if (!match) throw new Error(`Unexpected mutation or route: ${path}`);
    const id = (match[1] || match[2])!, product = products.find(value => value.documentId === id)!;
    if (init?.method === 'PUT') {
      assert(id === 'a', 'Only explicitly selected product uploaded'); product.fields.image = 'uploaded.png';
      return Response.json({ success: true, data: { image: 'uploaded.png' } });
    }
    if (init?.method !== 'DELETE') return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    assert(new Headers(init?.headers).get('X-Image-Token') === 'image-grant', 'Backend removal grant supplied');
    removals.push(id);
    if (id === 'b' && failB) return Response.json({ success: false, message: 'Retry removal' }, { status: 503 });
    if (id === 'c' && changeC) { product.fields.image = 'new-concurrent.png'; changeC = false; }
    const reviewed = JSON.parse(String(init.body));
    if ((product.fields.image || null) !== reviewed.image || (product.fields.imagePath || null) !== reviewed.imagePath) {
      return Response.json({ success: false, message: 'The product image changed after confirmation. Reload and review again.' }, { status: 409 });
    }
    if (typeof product.fields.image === 'string') product.fields.image = null;
    delete product.fields.imagePath;
    return Response.json({ success: true, data: { removed: true } });
  };

async function openImageAction(label: string) {
  if (!button(label)) {
    document.querySelector<HTMLButtonElement>('[aria-label="Product image options"]')!.click();
    await wait(() => button(label), 'image menu');
  }
  button(label).click();
  await wait(() => document.querySelector('#image-quick-pin'), 'Quick PIN dialog');
  const input = document.querySelector<HTMLInputElement>('#image-quick-pin')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1234');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(() => button('Verify') && !button('Verify').disabled, 'PIN input');
  button('Verify').click();
  await wait(() => !document.querySelector('#image-quick-pin'), 'verified entry');
}
  const root = createRoot(document.getElementById('root')!);
  root.render(<ProductsPage outlet={{ id: 'o', name: 'Outlet A' } as OutletSummary} token="token" onSessionExpired={() => { throw new Error('Unexpected logout'); }} />);
  try {
    await wait(() => document.querySelector('section[aria-busy="false"] [aria-label="Product image options"]'), 'Products ready');
  document.querySelector<HTMLButtonElement>('[aria-label="Product image options"]')!.click();
    await wait(() => button('Remove all product images') && !button('Remove all product images').disabled, 'Products loaded');
    const picker = document.querySelector<HTMLInputElement>('input[aria-label="Choose image for Tea A"]')!;
    const transfer = new DataTransfer(); transfer.items.add(new File([png], 'tea.png', { type: 'image/png' })); picker.files = transfer.files;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => button('Save') && !button('Save').disabled, 'crop loaded'); button('Save').click();
    await wait(() => button('Upload processed image'), 'processed review'); button('Upload processed image').click();
    await wait(() => document.querySelector('.product-image-upload [role="status"]')?.textContent === 'Product image uploaded successfully.', 'inline success confirmation');
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search products"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Tea A'); search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => document.querySelectorAll('tbody tr').length === 1, 'filtered Products');
    await openImageAction('Remove all product images');
    await wait(() => document.querySelector('dialog[open]'), 'removal confirmation');
    assert(document.querySelector('dialog')!.textContent?.includes('3 products') && document.querySelector('dialog')!.textContent?.includes('Outlet A'), 'Confirmation identifies outlet and includes images hidden by search');
    assert(removals.length === 0, 'Opening confirmation performs no removals');
    button('Cancel').click(); await wait(() => !document.querySelector('dialog'), 'cancel');
    assert(removals.length === 0, 'Cancel preserves every image');
    await openImageAction('Remove all product images'); await wait(() => button('Confirm remove all images'), 'confirm again');
    button('Confirm remove all images').click(); button('Confirm remove all images')?.click();
    await wait(() => button('Retry failed removals') && !button('Retry failed removals').disabled, 'partial results');
    assert(document.querySelector('dialog')!.textContent?.includes('1 removed; 2 failed'), 'Partial failures are reported accurately');
    assert(!document.querySelector('tbody img') && !document.querySelector('.product-image-upload [role="status"]'), 'Removal clears the locally uploaded preview and its old success message');
    failB = false; button('Retry failed removals').click();
    await wait(() => document.querySelector('dialog')!.textContent?.includes('2 removed; 1 failed') && !button('Done').disabled, 'retry failed removals');
    assert(removals.slice(3).sort().join() === 'b,c', 'Retry does not repeat completed removals');
    assert(products[2]!.fields.image === 'new-concurrent.png', 'A concurrently replaced image remains intact until fresh review');
    button('Done').click(); await wait(() => !document.querySelector('dialog'), 'close results');
    const readsBeforeRefresh = productReads;
    button('Refresh').click(); await wait(() => productReads > readsBeforeRefresh && !document.querySelector('[aria-busy="true"]'), 'refresh current references');
    await openImageAction('Remove all product images'); await wait(() => document.querySelector('dialog')?.textContent?.includes('1 products'), 'fresh review');
    button('Confirm remove all images').click(); button('Confirm remove all images')?.click();
    await wait(() => document.querySelector('dialog')?.textContent?.includes('Product images removed successfully.') && !button('Done').disabled, 'removal success');
    button('Done').click(); await wait(() => !document.querySelector('dialog'), 'done');
    document.querySelector<HTMLButtonElement>('[aria-label="Product image options"]')!.click();
    await wait(() => button('Remove all product images'), 'menu after removal');
    assert(button('Remove all product images').disabled, 'Remove-all action is disabled when no images remain');
    assert(document.querySelector('.products-notice')?.textContent?.includes('Product images removed successfully'), 'Final confirmation remains visible on Products');
    assert(products.every(product => !product.fields.image && !product.fields.imagePath), 'Filename and legacy references are cleared');
    assert(before === JSON.stringify(products.map(product => [product.documentId, product.fields.name, product.fields.price, product.fields.currentStock])), 'All products and unrelated values are preserved');
    passed.push('Upload confirmation; outlet-wide removal confirmation and cancellation; partial results; failed-only retry; concurrent-image protection; cleared previews; preserved product data');
    root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed, removals: removals.length });
  } catch (error) { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); }
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error) }); });
