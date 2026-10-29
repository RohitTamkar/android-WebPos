import { createRoot } from 'react-dom/client';
import { UploadExcelPage } from '../src/pages/UploadExcelPage.tsx';
import { PREMISES_PRODUCT_COLUMNS, PREMISES_TEMPLATE_COLUMNS, PRODUCT_COLUMNS, parseProductCsv } from '../src/pages/productCsvPreview.ts';
import '../src/index.css';

const checks: string[] = [];
let apiCalls = 0;
let closed = false;
let quotaBlocked = false;
const downloadBlobs = new Map<string, Blob>();
const downloads: { filename: string; blob: Blob }[] = [];

const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${message}`);
}
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.endsWith('/products/import/quota') && !init?.method) return quotaBlocked
    ? Response.json({ success: false, message: 'Upload limit reached. This outlet allows only 2 upload attempts within 24 hours. Please try again when a 24-hour slot becomes available.' }, { status: 429 })
    : Response.json({ success: true, remainingAttempts: 1, maxAttempts: 2 });
  apiCalls++;
  throw new Error(`Import must not run in premises preview: ${path}`);
};
// The harness bundles to IIFE; supply the browser URL base for import.meta worker URLs.
const NativeURL = URL;
window.URL = class extends NativeURL { constructor(input: string | URL, base: string | URL = location.href) { super(input, base); } };
URL.createObjectURL = value => {
  const url = `blob:template-${downloadBlobs.size}`;
  downloadBlobs.set(url, value as Blob);
  return url;
};
URL.revokeObjectURL = () => {};
HTMLAnchorElement.prototype.click = function () {
  const blob = downloadBlobs.get(this.href);
  if (!blob) throw new Error('Missing generated download blob');
  downloads.push({ filename: this.download, blob });
};
window.Worker = class {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  stopped = false;
  async postMessage(file: File) {
    try {
      const source = await file.text();
      if (!this.stopped) this.onmessage?.({ data: { preview: parseProductCsv(source, 'premises'), source } });
    } catch (error) { if (!this.stopped) this.onmessage?.({ data: { error: (error as Error).message } }); }
  }
  terminate() { this.stopped = true; }
} as unknown as typeof Worker;
const root = createRoot(document.getElementById('root')!);
root.render(<UploadExcelPage outletId="outlet" token="mock-token" onSessionExpired={() => { throw new Error('Unexpected session expiry'); }} />);
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!;
const select = (headers: readonly string[], blank = false) => {
  const rows = Array.from({ length: 12 }, (_, i) => {
    const extra = headers.length > 15 ? headers.slice(14).map((_, index) => ['20', '25.50', '30'][index] ?? '40') : [blank && i === 1 ? '' : `Premises ${i % 5}`];
    return [`Product ${i}`, 'Local', '20', '20', '0', '0', 'Food', '1', '0', '0', 'number', '0', 'no', '', ...extra];
  });
  const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  const transfer = new DataTransfer(); transfer.items.add(new File([csv], 'premises.csv'));
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
};
void (async () => {
  await until(() => document.querySelector('.upload-excel-options'), 'page');
  assert(!button('Download Standard Template'), 'Templates are not on the upload option screen');
  [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-option')].find(button => button.textContent?.includes('Excel Sheet Instructions'))!.click();
  await until(() => document.querySelector('.excel-sheet-instructions'), 'instruction templates');
  assert(!!document.querySelector('dialog[open] summary')?.textContent?.includes('Demo Excel Sheet'), 'Demo Excel Sheet appears inside instructions');
  assert(!!button('Download Standard Template') && !!button('Download Premises-Wise Template'), 'both template download options exist');
  document.querySelector('details')!.open = true;
  for (const [index, label] of ['Download Standard Template', 'Download Premises-Wise Template'].entries()) {
    button(label).click();
    await until(() => downloads.length === index + 1 && !button(label).disabled, 'template download');
    const bytes = new Uint8Array(await downloads[index]!.blob.arrayBuffer());
    assert(bytes[0] === 80 && bytes[1] === 75, `${label} generates XLSX ZIP bytes`);
  }
  assert(downloads.map(download => download.filename).join(',') === 'Product_Upload_Demo.xlsx,Premises_Wise_Product_Upload_Demo.xlsx', 'download filenames match the requested names');
  assert(apiCalls === 0, 'template downloads do not call the import API or consume attempts');

  document.querySelector<HTMLButtonElement>('[aria-label="Close information"]')!.click();
  await until(() => !document.querySelector('dialog[open]'), 'instructions closed');
  [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-option')].find(button => button.textContent?.includes('Upload with Premises'))!.click();
  await until(() => document.querySelector('input[type=file]'), 'quota check');
  assert(document.querySelector('.upload-excel-dialog .csv-upload-preview')?.textContent?.includes('Upload attempts remaining for this outlet: 1'), 'remaining attempts come from the backend on opening');
  select(PREMISES_PRODUCT_COLUMNS);
  await until(() => document.querySelectorAll('tbody tr').length === 12, 'all-row preview');
  assert(document.querySelectorAll('thead th').length === 17, 'preview displays all 15 data columns plus row and validation');
  assert(document.querySelector('thead th:last-child')?.textContent === 'Premises', 'Premises is immediately after Search Code');
  assert(document.querySelector('tbody tr td:last-child')?.textContent === 'Premises 0', 'premises value is preserved');
  assert(document.querySelector('dd')?.textContent === '12', 'total row count includes all products');
  const modal = document.querySelector<HTMLDialogElement>('.upload-excel-preview-dialog')!;
  const scroll = document.querySelector<HTMLElement>('.csv-upload-table-scroll')!;
  assert(modal.getBoundingClientRect().left >= 0 && modal.getBoundingClientRect().right <= window.innerWidth + 1, 'preview modal fits the viewport');
  assert(scroll.clientWidth <= modal.clientWidth && scroll.scrollWidth > scroll.clientWidth, 'all columns remain readable inside a bounded horizontal scroller');

  assert(button('Confirm Upload').disabled, 'confirmation remains disabled without verified premises persistence');
  assert(document.querySelector('.upload-excel-preview-dialog')?.textContent?.includes('Saving premises requires a supported premises mapping'), 'existing premises limitation is disclosed');
  assert(!button('Next') && !button('Previous'), 'no pagination buttons');
  assert(document.querySelectorAll('tbody tr').length === 12, 'all rows are listed in one scrolling table');
  button('Remove File').click(); select(PREMISES_TEMPLATE_COLUMNS);
  await until(() => document.querySelectorAll('thead th').length === 19, 'three price columns');
  assert([...document.querySelectorAll('thead th')].slice(-3).map(cell => cell.textContent).join(',') === 'Premises 1,Premises 2,Premises 3', 'all three numbered premises-price headers appear');
  assert([...document.querySelectorAll('tbody tr:first-child td')].slice(-3).map(cell => cell.textContent).join(',') === '20,25.50,30', 'separate premises prices including decimals are preserved in the preview');

  button('Remove File').click(); select(PREMISES_PRODUCT_COLUMNS, true);
  await until(() => document.querySelector('tbody')?.textContent?.includes('Premises must not be blank'), 'blank premises validation');
  assert(document.querySelector('tbody')?.textContent?.includes('Row 3'), 'blank premises error identifies spreadsheet row');
  button('Remove File').click(); select(PRODUCT_COLUMNS);
  await until(() => document.querySelector('[role=alert]')?.textContent?.includes('Missing headers: Premises'), '14-column file rejected');
  assert(button('Confirm Upload').disabled, '14-column file cannot confirm in premises mode');
  button('Cancel').click(); await pause();
  closed = !document.querySelector<HTMLDialogElement>('dialog')?.open;
  assert(closed && apiCalls === 0, 'cancel closes preview without import or accepted quota attempts');
  quotaBlocked = true;
  for (const title of ['Upload Excel', 'Upload with Premises']) {
    [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-option')].find(button => button.querySelector('strong')?.textContent === title)!.click();
    await until(() => document.querySelector('.upload-excel-dialog [role=alert]')?.textContent?.includes('Upload limit reached'), `${title} quota message`);
    assert(!document.querySelector('input[type=file]') && !document.querySelector('.csv-upload-table-scroll'), `${title} hides file controls and preview at the shared outlet limit`);
    [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-dialog-actions > button')].find(button => button.textContent === 'Close')!.click(); await pause();
  }
  assert(apiCalls === 0, 'checking either blocked upload option consumes no attempts');
  for (const token of ['refreshed-session', 'another-user-same-outlet']) {
    root.render(<UploadExcelPage key={token} outletId="outlet" token={token} onSessionExpired={() => { throw new Error('Unexpected expiration'); }} />);
    await pause();
    [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-option')].find(button => button.querySelector('strong')?.textContent === 'Upload Excel')!.click();
    await until(() => document.querySelector('[role=alert]')?.textContent?.includes('Upload limit reached'), 'reopened session quota check');
    assert(!document.querySelector('input[type=file]') && !document.querySelector('table'), `${token} stays blocked after the upload page remounts`);
  }

  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
