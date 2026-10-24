import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import '../src/index.css';

const passed: string[] = [];
const usageTimers = new Map<number, () => void>();
const nativeInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
window.setInterval = ((callback: () => void, delay: number) => {
  if (delay !== 10_000) return nativeInterval(callback, delay);
  const id = nativeInterval(() => undefined, 1_000_000); usageTimers.set(id, callback); return id;
}) as typeof window.setInterval;
window.clearInterval = ((id: number) => { usageTimers.delete(id); nativeClearInterval(id); }) as typeof window.clearInterval;
let now = Date.now(); Date.now = () => now;

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const fixtureCanvas = document.createElement('canvas'); fixtureCanvas.width = fixtureCanvas.height = 16;
fixtureCanvas.getContext('2d')!.fillRect(0, 0, 16, 16);
const imageBytes = Uint8Array.from(atob(fixtureCanvas.toDataURL('image/png').split(',')[1]), value => value.charCodeAt(0));
let product = { documentId: 'p1', fields: { name: 'Tea', code: 1, image: '1000014014.png' as string | null,
  price: 12, mrpPrice: 12, costPrice: 5, category: 'c1', regionalName: '', discount: 0, shortName: '',
  taxIndex: 1, hsnCode: '', unitId: 2, weighable: false, stockable: true, currentStock: 7 } };
const localFetch = window.fetch.bind(window);
let lastUpload: File | undefined;
let savedImage: Blob = new Blob([imageBytes], { type: 'image/png' });
let imageReads = 0, deletes = 0, failRemoval = true;
let uploads = 0, failUpload = true, creations = 0;
let holdUpload = false;
let releaseUpload: (() => void) | undefined;
const uploadedPath = '04eedb7f-e5a7-4b2e-b44e-9ffaa72d6fcd.png';
let holdResume = false; let releaseResume: (() => void) | undefined;
let usageStarts = 0, usageStops = 0;
const categories = [{ id: 'c1', name: 'Drinks' }];
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Every API request is authenticated');
  if (/\/usage\/(start|heartbeat|stop)$/.test(path)) {
    const body = JSON.parse(String(init?.body || '{}'));
    if (path.endsWith('/start')) { usageStarts++; if (holdResume) await new Promise<void>(resolve => { releaseResume = resolve; }); }
    if (path.endsWith('/stop')) usageStops++;
    return Response.json({ success: true, data: { outletId: 'outlet', sessionId: 'authorized-session', generation: 'period',
      sequence: body.sequence ?? 0, usedSeconds: 0, remainingSeconds: 1800, date: '2026-10-23', timeZone: 'Asia/Kolkata' } });
  }
  assert(new Headers(init?.headers).get('X-Web-Usage-Session') === 'authorized-session', 'Outlet APIs still require the server-authorized usage session');
  if (path.includes('/dashboard?')) return Response.json({ success: true, data: { payments: {}, shifts: [] } });
  if (/\/products\/p[12]\/image$/.test(path)) {
    if (init?.method === 'PUT') {
      uploads++;
      lastUpload = init.body as File;
      if (holdUpload) await new Promise<void>(resolve => { releaseUpload = resolve; });
      assert(init.body instanceof File && init.body.size <= 30 * 1024, 'Only processed bytes within 30 KB are uploaded');
      if (failUpload) return Response.json({ success: false, message: 'Retry upload' }, { status: 503 });
      savedImage = init.body as File;
      product = { ...product, fields: { ...product.fields, image: uploadedPath } };
      return Response.json({ success: true, data: { image: uploadedPath } });
    }
    if (init?.method === 'DELETE') {
      deletes++;
      if (failRemoval) return Response.json({ success: false, message: 'Retry removal' }, { status: 503 });
      product = { ...product, fields: { ...product.fields, image: null } };
      return Response.json({ success: true, data: { removed: true } });
    }
    imageReads++;
    return new Response(savedImage, { headers: { 'Content-Type': savedImage.type } });
  }
  if (path.endsWith('/products/create-options')) return Response.json({ success: true, data: {
    code: 2, categories, taxes: [], units: [{ id: 2, name: 'number' }],
  } });
  if (path.endsWith('/products') && init?.method === 'POST') {
    creations++;
    product = { documentId: 'p2', fields: { ...product.fields, ...JSON.parse(String(init.body)), image: null } };
    return Response.json({ success: true, data: product });
  }
  if (path.endsWith('/products/p1/edit-options')) return Response.json({ success: true, data: {
    product, code: 1, categories, taxes: [{ percent: 0, index: 1, type: 0 }], units: [{ id: 2, name: 'number' }],
  } });
  if (path.endsWith('/products/p1') && init?.method === 'PATCH') {
    assert(String(init.body) === '{}', 'Image-only edits do not patch unrelated fields');
    return Response.json({ success: true, data: product });
  }
  if (path.endsWith('/products')) return Response.json({ success: true, data: [product] });
  if (path.endsWith('/categories')) return Response.json({ success: true, data: categories });
  throw new Error(`Unexpected request: ${path}`);
};
const root = createRoot(document.getElementById('root')!);
localStorage.clear(); sessionStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'user', email: 'test@example.com', name: 'User', role: 'Admin', terminal: 'POS', token: 'token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'outlet', name: 'Test outlet' }));
root.render(<App />);
async function waitFor(check: () => unknown, message: string) {
  for (let i = 0; i < 120; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error(`Timed out: ${message}: ${document.querySelector('[role="alert"]')?.textContent}`);
}
const decoded = (selector: string) => { const img = document.querySelector<HTMLImageElement>(selector); return img?.complete && img.naturalWidth > 0; };
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
void (async () => {
  await waitFor(() => document.querySelector('.sidebar-nav'), 'authorized application');
  assert(!document.querySelector('.sidebar-nav')!.textContent?.includes('Daily Web Usage'), 'Daily Web Usage is absent from normal navigation');
  [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === 'Products')!.click();
  await waitFor(() => decoded('tbody img'), 'filename-only product thumbnail');
  const thumbnail = document.querySelector<HTMLImageElement>('tbody img')!;
  assert(thumbnail.getBoundingClientRect().width >= 80 && thumbnail.getBoundingClientRect().height >= 60, 'Table thumbnail is large enough to see the image');
  assert(imageReads > 0, 'Filename triggers the authenticated endpoint');
  passed.push('Filename-only product displays a Web POS thumbnail');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit product"]')!.click();
  await waitFor(() => decoded('img[alt="Existing image preview"]'), 'filename-only edit preview');
  const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const selection = new DataTransfer(); selection.items.add(new File([imageBytes], 'selected.png', { type: 'image/png' }));
  picker.files = selection.files; picker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => button('Save') && !button('Save').disabled, 'crop image loaded');
  assert(uploads === 0, 'Selecting an image does not upload the original');
  const cropEditor = document.querySelector('canvas');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(() => usageStops > 0, 'picker pauses usage');
  assert(document.querySelector('canvas') === cropEditor && document.getElementById('product-name'), 'Native picker suspension keeps the product editor and crop mounted');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(() => usageStarts === 2, 'picker resumes authorization');
  assert(!document.body.textContent?.includes('Web POS access paused'), 'Picker return does not open the usage screen');
  button('Save').click();
  await waitFor(() => button('Clear Selection') && !button('Update')?.disabled && decoded('img[alt="Selected image preview"]'), 'replacement selected');
  const processedPreview = document.querySelector<HTMLImageElement>('img[alt="Selected image preview"]');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(() => usageStops === 2, 'preview suspension');
  holdResume = true;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange'));
  await waitFor(() => releaseResume, 'pending authorization');
  assert(document.querySelector('img[alt="Selected image preview"]') === processedPreview, 'Processed image selection survives usage suspension');
  button('Update').click(); await new Promise(resolve => setTimeout(resolve, 30));
  assert(uploads === 0, 'Image upload waits for fresh server authorization');
  holdResume = false; releaseResume!();
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent?.includes('Retry upload'), 'upload failure');
  assert(product.fields.image === '1000014014.png', 'Failed upload retains previous image');
  const previewBytes = new Uint8Array(await (await localFetch(document.querySelector<HTMLImageElement>('img[alt="Selected image preview"]')!.src)).arrayBuffer());
  const uploadBytes = new Uint8Array(await lastUpload!.arrayBuffer());
  assert(previewBytes.length === uploadBytes.length && previewBytes.every((value, index) => value === uploadBytes[index]), 'Processed preview bytes exactly match the uploaded File');
  failUpload = false; button('Update').click();
  await waitFor(() => !document.getElementById('product-name'), 'successful replacement');
  await waitFor(() => decoded('tbody img'), 'uploaded image decodes in product thumbnail');
  const downloadedBytes = new Uint8Array(await (await localFetch(document.querySelector<HTMLImageElement>('tbody img')!.src)).arrayBuffer());
  assert(downloadedBytes.length === uploadBytes.length && downloadedBytes.every((value, index) => value === uploadBytes[index]), 'Authenticated retrieval displays exactly the processed upload bytes');
  assert(uploads === 2 && product.fields.image === uploadedPath, 'Replacement uses returned image string');
  assert(document.querySelector('.products-notice')?.textContent?.includes('Image uploaded successfully.'), 'Edit form confirms the image upload after saving');
  assert(!('imagePath' in product.fields), 'Replacement does not add imagePath');
  passed.push('Replacement failure preserves image; retry saves a filename in image and displays the uploaded bytes');
  document.querySelector<HTMLButtonElement>('[aria-label="Edit product"]')!.click();
  await waitFor(() => decoded('img[alt="Existing image preview"]'), 'migrated path edit preview');
  button('Remove Image').click();
  await waitFor(() => button('Undo Remove') && !button('Update')?.disabled, 'removal selection');
  button('Update').click();
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent?.includes('Retry removal'), 'removal failure');
  assert(product.fields.image === uploadedPath, 'Failed removal retains previous reference');
  passed.push('Editor displays existing filename; failed removal retains reference and allows retry');
  failRemoval = false; button('Update').click();
  await waitFor(() => !document.getElementById('product-name'), 'successful removal');
  await waitFor(() => !document.querySelector('tbody img'), 'removed thumbnail');
  assert(deletes === 2 && product.fields.image === null, 'Successful retry clears the filename');
  assert(product.fields.currentStock === 7 && product.fields.price === 12, 'Unrelated product values survive');
  passed.push('Successful removal clears the filename and thumbnail without changing product values');
  const tablePicker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  let pickerOpened = false;
  tablePicker.click = () => { pickerOpened = true; };
  document.querySelector<HTMLButtonElement>('[aria-label="Upload image for Tea"]')!.click();
  assert(pickerOpened, 'Clicking table image opens device picker');
  const tableSelection = new DataTransfer(); tableSelection.items.add(new File([imageBytes], 'table.png', { type: 'image/png' }));
  tablePicker.files = tableSelection.files; tablePicker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => button('Save'), 'table crop editor');
  button('Cancel').click();
  await waitFor(() => !button('Save'), 'cancel table crop');
  assert(uploads === 2 && product.fields.image === null, 'Cancel performs no upload and preserves product');
  passed.push('Table image button offers a device picker; cancel does not upload');
  const secondSelection = new DataTransfer(); secondSelection.items.add(new File([imageBytes], 'table.png', { type: 'image/png' }));
  tablePicker.files = secondSelection.files; tablePicker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => button('Save') && !button('Save').disabled, 'table crop loaded');
  failUpload = true; button('Save').click();
  await waitFor(() => button('Upload processed image') && decoded('tbody img'), 'processed review before upload');
  assert(uploads === 2, 'Table crop displays the actual processed preview before approval');
  assert(document.body.textContent?.includes('bytes'), 'Actual encoded byte size is displayed');
  button('Upload processed image').click();
  await waitFor(() => button('Retry upload') && decoded('tbody img'), 'failed upload with immediate local preview');
  assert(product.fields.image === null, 'Failed table upload preserves stored reference');
  assert(!document.querySelector('[aria-labelledby="product-crop-title"]'), 'Save closes crop popup on upload failure');
  failUpload = false; holdUpload = true; button('Retry upload').click();
  await waitFor(() => document.querySelector('.product-image-upload-status .product-image-spinner'), 'upload spinner while request is pending');
  assert(!document.querySelector('[aria-labelledby="product-crop-title"]'), 'Crop popup stays closed while uploading');
  assert(!document.querySelector('.products-notice')?.textContent?.includes('Image uploaded successfully'), 'No success message before upload finishes');
  holdUpload = false; releaseUpload!();
  await waitFor(() => uploads === 4 && decoded('tbody img'), 'table immediate preview and upload');
  assert(product.fields.image === uploadedPath, 'Table uploads filename without opening product form');
  await waitFor(() => document.querySelector('.products-notice')?.textContent === 'Image uploaded successfully.', 'upload confirmation');
  assert(document.querySelector('.product-image-upload [role="status"]')?.textContent === 'Product image uploaded successfully.', 'Successful upload has a visible confirmation beside the product image');
  assert(!document.querySelector('.product-image-upload-status'), 'Upload spinner clears after success');
  passed.push('Table upload immediately displays processed thumbnail and saves filename');
  const encode = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback, type) { callback(new Blob([new Uint8Array(30721)], { type })); };
  const invalidSelection = new DataTransfer(); invalidSelection.items.add(new File([imageBytes], 'oversized-crop.png', { type: 'image/png' }));
  tablePicker.files = invalidSelection.files; tablePicker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => button('Save') && !button('Save').disabled, 'processing failure crop');
  button('Save').click();
  await waitFor(() => document.querySelector('[aria-labelledby="product-crop-title"]') && document.querySelector('[role="alert"]')?.textContent?.includes('Adjust the crop'), 'processing failure keeps crop available and reports error');
  HTMLCanvasElement.prototype.toBlob = encode;
  button('Cancel').click();
  await waitFor(() => !document.querySelector('[aria-labelledby="product-crop-title"]'), 'close failed crop');
  assert(!button('Cancel replacement'), 'Removed replacement control is not displayed');
  assert(uploads === 4 && product.fields.image === uploadedPath, 'Processing failure does not upload or change saved reference');
  passed.push('Save closes popup, shows upload spinner and verified success; processing errors allow crop adjustment and preserve saved image');
  button('Add New Product').click();
  await waitFor(() => button('Save Product') && !button('Save Product').disabled, 'new product form');
  for (const [id, value] of [['product-name', 'New Tea'], ['product-price', '20']]) {
    const element = document.getElementById(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const category = document.getElementById('product-category') as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(category, 'c1');
  category.dispatchEvent(new Event('change', { bubbles: true }));
  const newPicker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const newSelection = new DataTransfer(); newSelection.items.add(new File([imageBytes], 'new.png', { type: 'image/png' }));
  newPicker.files = newSelection.files; newPicker.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => button('Save') && !button('Save').disabled, 'new image crop');
  const retainedCrop = document.querySelector('canvas');
  const retainedForm = document.getElementById('product-name');
  const stopsBeforeIdle = usageStops;
  now += 61_000; [...usageTimers.values()].forEach(callback => callback());
  await waitFor(() => usageStops > stopsBeforeIdle && document.querySelector('[data-outlet-access-notice]'), 'idle while cropping');
  assert(document.querySelector('canvas') === retainedCrop && document.getElementById('product-name') === retainedForm,
    'Idle usage suspension preserves the exact product form and cropper');
  assert(!document.querySelector('.outlet-selection-page'), 'Idle image workflow cannot open the disabled Daily Web Usage screen');
  assert((retainedForm as HTMLInputElement).value === 'New Tea', 'Product draft survives idle suspension');
  button('Continue / Retry').click();
  await waitFor(() => !document.querySelector('[data-outlet-access-notice]'), 'inline recovery obtains fresh server authorization');
  assert(document.querySelector('canvas') === retainedCrop && document.getElementById('product-name') === retainedForm,
    'Fresh authorization resumes the same form and cropper');
  passed.push('Disabled usage screen never replaces the image editor during idle suspension and inline recovery');
  button('Save').click(); await waitFor(() => button('Clear Selection'), 'new processed selection');
  assert(uploads === 4, 'Applying a crop in the form does not upload before save');
  failUpload = true; button('Save Product').click();
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent?.includes('Retry upload'), 'new product image failure');
  assert(creations === 1 && product.fields.image === null, 'New product has no premature image reference');
  failUpload = false; button('Retry Image Save').click();
  await waitFor(() => !document.getElementById('product-name') && uploads === 6, 'new product retry saved');
  assert(creations === 1 && product.fields.image === uploadedPath, 'Image retry never creates a duplicate product');
  passed.push('New product saves processed image only after save; image retry preserves the created ID');
  [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === 'Dashboard')!.click();
  await waitFor(() => !document.querySelector('.products-table'), 'navigate away');
  [...document.querySelectorAll<HTMLButtonElement>('.nav-group-items button')].find(node => node.textContent === 'Products')!.click();
  await waitFor(() => decoded('tbody img'), 'return to Products');
  passed.push('App navigation, native picker suspension, crop, processed preview, upload and replacement retain Products while server usage authorization remains enforced');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed }); });
