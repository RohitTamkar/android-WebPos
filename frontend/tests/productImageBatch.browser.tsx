import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { ProductsPage } from '../src/pages/ProductsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

void (async () => {
const passed: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
async function wait(check: () => unknown, label: string) {
  for (let i = 0; i < 250; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout ${label}: ${document.body.textContent}`);
}
const products = [
  { documentId: 'a', fields: { name: 'Masala Dosa', code: 1, image: 'old.png', price: 12, currentStock: 5 } },
  { documentId: 'b', fields: { name: 'Masala Uttapam', code: 2, imagePath: 'legacy/path', price: 13, currentStock: 6 } },
  { documentId: 'c', fields: { name: 'Masala Sandwich', code: 3, price: 14, currentStock: 7 } },
  { documentId: 'd', fields: { name: 'Tea', code: 4, price: 15, currentStock: 8 } },
  { documentId: 'e', fields: { name: 'TEA', code: 5, price: 16, currentStock: 9 } },
  { documentId: 'f', fields: { name: 'Coffee', code: 6, price: 17, currentStock: 10 } },
] as { documentId: string; fields: Record<string, unknown> }[];
const before = JSON.stringify(products.map(product => ({ id: product.documentId, name: product.fields.name, code: product.fields.code, price: product.fields.price, stock: product.fields.currentStock })));
const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
const context = canvas.getContext('2d')!; context.fillStyle = '#f00'; context.fillRect(0, 0, 32, 48);
const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
const bytes = new Uint8Array(await png.arrayBuffer());
const objects = new Map<string, string>(), requests: { requestId: string; targets: { documentId: string; expectedImage: string | null; expectedImagePath: string | null; replaceExisting: boolean }[] }[] = [];
let failProduct = 'b';
let previewReads = 0;
window.fetch = async (url, init) => {
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'JWT retained');
  const path = String(url);
    if (path.endsWith('/product-images/verify-quick-pin')) {
      const body = JSON.parse(String(init?.body));
      assert(body.quickPin === '1234', 'Quick PIN verified before entry');
      return Response.json({ success: true, data: { verified: true, action: body.action, imageToken: 'image-grant' } });
    }
  if (path.endsWith('/product-image-assignments')) {
    assert(new Headers(init?.headers).get('X-Image-Token') === 'image-grant', 'Backend grant supplied');
    const body = JSON.parse(String(init?.body)); requests.push(body);
    const encoded = Uint8Array.from(atob(body.base64), value => value.charCodeAt(0));
    assert(encoded.length > 0 && encoded.length <= 30720, 'Actual processed bytes fit the limit');
    const decoded = await createImageBitmap(new Blob([encoded], { type: body.contentType })); decoded.close();
    if (!objects.has(body.requestId)) objects.set(body.requestId, `${objects.size + 1}`.padStart(64, '0') + '.png');
    const image = objects.get(body.requestId)!;
    const results = body.targets.map((target: typeof requests[number]['targets'][number]) => {
      const product = products.find(value => value.documentId === target.documentId)!;
      if (product.fields.image === image) return { documentId: target.documentId, status: 'unchanged', message: 'Already saved' };
      if (target.documentId === failProduct) return { documentId: target.documentId, status: 'failed', message: 'Simulated update failure' };
      assert((product.fields.image || null) === target.expectedImage && (product.fields.imagePath || null) === target.expectedImagePath, 'Reviewed references supplied');
      assert(!(product.fields.image || product.fields.imagePath) || target.replaceExisting, 'Existing-image replacement explicitly approved');
      product.fields = { ...product.fields, image };
      return { documentId: target.documentId, status: 'saved', message: 'Image saved' };
    });
    return Response.json({ success: true, data: { image, results } });
  }
  if (path.endsWith('/products') && (!init?.method || init.method === 'GET')) return Response.json({ success: true, data: structuredClone(products) });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: [] });
  if (path.endsWith('/image')) { previewReads++; return new Response(png, { headers: { 'Content-Type': 'image/png' } }); }
  throw new Error(`Unexpected route or product creation: ${path}`);
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
root.render(<ProductsPage outlet={{ id: 'o' } as OutletSummary} token="token" onSessionExpired={() => { throw new Error('Unexpected logout'); }} />);
function selectFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('.product-image-batch input[type="file"]')!;
  const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
const reviewRow = (filename: string) => [...document.querySelectorAll<HTMLDivElement>('.batch-assignment-item')].find(row => row.dataset.filename === filename)!;
function chooseProduct(id: string) {
  const input = [...document.querySelectorAll<HTMLInputElement>('.batch-product-choices input')].find(node => node.value === id)!;
  input.click();
}
function confirmReplacements() {
  for (const label of document.querySelectorAll<HTMLLabelElement>('.batch-replacement-approvals label')) {
    const input = label.querySelector<HTMLInputElement>('input')!; if (!input.checked) input.click();
  }
}
void (async () => {
  await wait(() => document.querySelector('section[aria-busy="false"] [aria-label="Product image options"]'), 'Products ready');
  document.querySelector<HTMLButtonElement>('[aria-label="Product image options"]')!.click();
  await wait(() => button('One Image for Multiple Products') && !button('One Image for Multiple Products').disabled, 'Products loaded');
  await openImageAction('One Image for Multiple Products'); await pause();
  assert(document.querySelector('.batch-header h1')?.textContent === 'Product Images', 'Header uses the simplified page title');
  const initialPicker = document.querySelector<HTMLInputElement>('.product-image-batch input[type="file"]')!;
  let pickerOpened = false; const originalClick = initialPicker.click;
  initialPicker.click = () => { pickerOpened = true; }; button('Upload Images').click(); initialPicker.click = originalClick;
  assert(pickerOpened, 'Compact header Upload Images button opens image selection');
  selectFile(new File([bytes], 'Masala.png', { type: 'image/png' }));
  await wait(() => document.querySelector('.batch-image-preview') && !document.body.textContent?.includes('Reading and preparing'), 'shared processed preview');
  const preview = document.querySelector<HTMLImageElement>('.batch-image-preview')!;
  await wait(() => preview.complete && preview.naturalWidth, 'decoded preview');
  assert(preview.naturalWidth === 64 && preview.naturalHeight === 48, 'Uncropped source preserves aspect ratio without upscaling');
  assert(!document.querySelector('.batch-image-table select, .batch-image-table input'), 'Matching and approval controls are outside the clean image rows');
  assert(!document.querySelector('.batch-image-table')?.textContent?.includes('Masala.png') && !document.body.textContent?.includes('bytes ·'), 'Main rows omit filenames');
  assert(document.querySelector('.batch-image-table')?.textContent?.includes('30 KB target achieved'), 'Processed size target is shown beside the exact preview');
  assert(!document.body.textContent?.includes('product image(s) saved;'), 'Redundant bottom progress counters are removed');
  button('Crop / Adjust').click();
  await wait(() => button('Save') && !button('Save').disabled, 'crop available from the row');
  button('Square crop').click();
  await pause();
  button('Save').click();
  await wait(() => !document.querySelector('.product-crop-dialog') && document.querySelector<HTMLImageElement>('.batch-image-preview')?.naturalWidth === document.querySelector<HTMLImageElement>('.batch-image-preview')?.naturalHeight, 'processed crop applied');
  assert(requests.length === 0, 'Cropping never starts the upload');
  assert(button('Upload Images').disabled, 'No-match image requires manual product selection');
  chooseProduct('c'); await pause();
  assert(document.querySelector<HTMLDetailsElement>('.batch-assignment-review')?.open, 'Shared selection stays open when the first selected product needs no replacement approval');
  chooseProduct('c'); await pause();
  for (const id of ['a', 'b', 'c']) { chooseProduct(id); await pause(); }
  assert(document.querySelectorAll('.batch-image-table tbody tr').length === 3, 'Each selected product appears once');
  assert(document.querySelector('.batch-image-count')?.textContent === '3 images', 'Header count matches displayed product images');
  [...document.querySelectorAll<HTMLButtonElement>('.batch-image-table tbody tr:first-child button')].find(node => node.textContent === 'Remove')!.click(); await pause();
  assert(document.querySelectorAll('.batch-image-table tbody tr').length === 2, 'Individual product can be removed from review');
  assert(document.querySelector('.batch-image-count')?.textContent === '2 images', 'Removing an assignment updates the image count');
  chooseProduct('a'); await pause();
  assert(button('Upload Images').disabled, 'Shared replacements require approval');
  confirmReplacements(); await pause(); button('Upload Images').click(); button('Upload Images')?.click();
  await wait(() => button('Retry failed assignments for Masala.png') && !button('Retry failed assignments for Masala.png').disabled, 'partial shared result');
  assert(document.body.textContent?.includes('Some images could not be uploaded.') && !document.body.textContent?.includes('Product images uploaded successfully for'), 'Partial failures display an accurate completion message');
  assert(objects.size === 1 && products[0]!.fields.image === products[2]!.fields.image, 'Shared image uploads once and uses the same filename');
  assert(products[1]!.fields.imagePath === 'legacy/path' && !products[1]!.fields.image, 'Failed product retains legacy image reference');
  failProduct = ''; button('Retry Masala Uttapam').click();
  await wait(() => document.querySelectorAll('.batch-image-table .batch-status.complete, .batch-image-table .batch-status.saved, .batch-image-table .batch-status.unchanged').length === 3, 'shared retry result');
  await wait(() => document.body.textContent?.includes('Product images uploaded successfully for 3 product(s).'), 'shared upload success confirmation');
  assert(objects.size === 1 && requests.length === 2 && requests[1]!.targets.map(target => target.documentId).join() === 'b', 'Retry reuses upload and sends only failed targets');
  assert(products.slice(0, 3).every(product => product.fields.image === products[0]!.fields.image), 'All three distinct products share one filename');
  passed.push('Shared review, selection, replacement confirmation, one upload, partial failure and individual retry');
  await wait(() => document.querySelector('dialog[open]') && button('OK'), 'shared success popup');
  const readsBeforeSharedOK = previewReads;
  button('OK').click(); await wait(() => document.querySelector('section[aria-label="Products"]'), 'OK returns to Products');
  await pause(); assert(previewReads === readsBeforeSharedOK, 'Shared upload previews reuse processed bytes without refetching images');
  await openImageAction('Bulk Upload Images'); await pause();
  selectFile(new File(['not a zip'], 'bad.zip'));
  await wait(() => document.querySelector('[role="alert"]'), 'malformed ZIP error');
  const zip = new JSZip();
  for (const name of [' MASALA  DOSA.png', 'Tea.png', 'missing.png', 'nested/Coffee.png', 'Coffee.png']) zip.file(name, bytes);
  zip.file('invalid.png', 'not an image');
  selectFile(new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], 'images.zip'));
  await wait(() => document.querySelectorAll('.batch-assignment-item').length === 6 && !document.body.textContent?.includes('Reading and preparing'), 'bulk prepared');
  assert(reviewRow(' MASALA  DOSA.png').querySelector('select')!.value === 'a', 'Normalized exact name auto-matches');
  assert(reviewRow('Tea.png').querySelector('select')!.value === '', 'Ambiguous duplicate product names require manual selection');
  assert(reviewRow('Coffee.png').querySelector('select')!.value === '' && document.body.textContent?.includes('Duplicate filename'), 'Duplicate filenames do not auto-assign');
  assert(reviewRow('invalid.png').textContent?.includes('Failed'), 'Invalid image is reported per image');
  const rows = [...document.querySelectorAll<HTMLDivElement>('.batch-assignment-item')];
  for (const index of [2, 3, 5]) { rows[index]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); await pause(); }
  const select = (row: HTMLDivElement, value: string) => { const input = row.querySelector('select')!; input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); };
  select(rows[1]!, 'd'); await pause(); select(rows[4]!, 'a'); await pause();
  assert(document.body.textContent?.includes('Multiple images target this product') && button('Upload Images').disabled, 'Conflicting image targets block upload');
  select(rows[4]!, 'f'); await pause();
  confirmReplacements(); await pause();
  if (location.hash === '#preview') {
    document.querySelector<HTMLDetailsElement>('.batch-assignment-review')!.open = false;
    document.body.style.background = '#f5f7fb';
    document.getElementById('root')!.style.padding = '24px';
    window.scrollTo(0, 0);
    await pause();
    const shell = document.querySelector<HTMLElement>('.product-image-batch')!;
    assert(shell.scrollWidth <= shell.clientWidth + 2, 'Ready image layout fits the viewport');
    assert(document.querySelector('.batch-image-count')?.textContent === '3 images', 'Single header count reflects included images');
    document.getElementById('test-results')!.textContent = JSON.stringify({ passed: [...passed, 'Ready layout snapshot'], width: window.innerWidth });
    document.getElementById('test-results')!.style.display = 'none';
    return;
  }
  failProduct = 'd'; button('Upload Images').click(); button('Upload Images')?.click();
  await wait(() => button('Retry failed assignments for Tea.png') && !button('Retry failed assignments for Tea.png').disabled, 'bulk partial failure');
  assert(!document.querySelector('dialog[open]'), 'Partial failure does not show a success popup');
  const requestCount = requests.length, objectCount = objects.size;
  failProduct = ''; button('Retry failed assignments for Tea.png').click();
  await wait(() => document.querySelectorAll('.batch-image-table .batch-status.complete, .batch-image-table .batch-status.saved, .batch-image-table .batch-status.unchanged').length === 3, 'bulk retry');
  await wait(() => document.body.textContent?.includes('Product images uploaded successfully for 3 product(s).'), 'bulk upload success confirmation');
  assert(requests.length === requestCount + 1 && objects.size === objectCount, 'Bulk retry does not repeat completed uploads');
  assert(products[4]!.fields.image === undefined, 'Ambiguous candidate not selected remains unchanged');
  assert(before === JSON.stringify(products.map(product => ({ id: product.documentId, name: product.fields.name, code: product.fields.code, price: product.fields.price, stock: product.fields.currentStock }))), 'Unrelated fields and product count remain intact');
  passed.push('ZIP validation, exact matching, ambiguity, duplicate filenames, invalid images, exclusion, target conflicts, confirmation, partial upload and retry');
  const shell = document.querySelector<HTMLElement>('.product-image-batch')!;
  assert(shell.scrollWidth <= shell.clientWidth + 2, 'Image layout fits the viewport without horizontal overflow');
  passed.push('Clean rows, header upload/count, crop, removal, separate assignment review, no bottom counters, responsive layout');
  await wait(() => document.querySelector('dialog[open]') && button('OK'), 'bulk success popup');
  const readsBeforeBulkOK = previewReads;
  button('OK').click(); await wait(() => document.querySelector('section[aria-label="Products"]'), 'bulk OK returns to Products');
  await pause(); assert(previewReads === readsBeforeBulkOK, 'Bulk upload previews reuse processed bytes without refetching images');
  assert(!document.querySelector('.product-image-batch'), 'Upload screen closes only after OK');
  if (location.hash !== '#preview') root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed, requests: requests.length, storedImages: objects.size });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });

})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error) }); });
