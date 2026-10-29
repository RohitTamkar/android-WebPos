import { createRoot } from 'react-dom/client';
import { UploadExcelPage } from '../src/pages/UploadExcelPage.tsx';
import { PRODUCT_COLUMNS, parseProductCsv } from '../src/pages/productCsvPreview.ts';
import '../src/index.css';

const passed: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
let confirmations = 0, previews = 0, mode: 'success' | 'partial' = 'success';
window.fetch = async (url, init) => {
  const path = String(url);
  assert(new Headers(init?.headers).get('Authorization') === 'Bearer token', 'Authorized import requests');
  if (path.endsWith('/quota')) return Response.json({ success: true, remainingAttempts: 2 });
  if (path.endsWith('/validate')) {
    previews++; return Response.json({ success: true, data: { canUpload: true, headerErrors: [], categorySummary: { reused: 0, toCreate: 1 },
      documents: [{ rowNumber: 2, fields: { code: 1 } }, { rowNumber: 3, fields: { code: 2 } }], rows: [{ rowNumber: 2, errors: [] }, { rowNumber: 3, errors: [] }] } });
  }
  assert(path.endsWith('/products/import'), 'Only the existing import endpoint is used'); confirmations++;
  assert(JSON.stringify(JSON.parse(String(init?.body)).codes) === '[1,2]', 'Previewed codes retained');
  const partial = mode === 'partial';
  return Response.json({ success: !partial, data: { success: !partial, categoriesCreated: 1, categoriesReused: 0,
    created: partial ? 1 : 2, existing: 0, failedRows: partial ? 1 : 0, confirmedRows: partial ? [2] : [2,3], unconfirmedRows: partial ? [3] : [],
    message: `0 categories reused; 1 categories created. ${partial ? '1 products imported; 1 failed or unconfirmed product rows.' : '2 products imported; 0 failed or unconfirmed product rows.'}` } }, { status: partial ? 503 : 200 });
};
const NativeURL = URL;
window.URL = class extends NativeURL { constructor(input: string | URL, base: string | URL = location.href) { super(input, base); } };
window.Worker = class {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  stopped = false;
  async postMessage(file: File) { const source = await file.text(); if (!this.stopped) this.onmessage?.({ data: { source, preview: parseProductCsv(source) } }); }
  terminate() { this.stopped = true; }
} as unknown as typeof Worker;
const root = createRoot(document.getElementById('root')!);
root.render(<UploadExcelPage outletId="outlet" token="token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} />);
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) { for (let i = 0; i < 150; i++) { if (check()) return; await pause(); } throw new Error(`Timeout: ${message}`); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const select = () => {
  const source = [PRODUCT_COLUMNS.join(','), ...['Tea','Coffee'].map(name => [name,name,'20','20','0','0','Food','1','0','0001','Number','0','no',''].join(','))].join('\n');
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!, transfer = new DataTransfer(); transfer.items.add(new File([source], 'products.csv'));
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
};
async function open() {
  [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-option')].find(node => node.querySelector('strong')?.textContent === 'Upload Excel')!.click();
  await until(() => document.querySelector('input[type=file]'), 'upload dialog'); select(); await until(() => document.querySelectorAll('tbody tr').length === 2, 'local preview');
}
void (async () => {
  await until(() => document.querySelector('.upload-excel-options'), 'page'); await open();
  assert(confirmations === 0 && previews === 0, 'Local preview makes no import calls');
  assert(!button('Preview Search Codes'), 'Upload is a single step');
  button('Upload').click(); await until(() => document.querySelector('.csv-upload-success-dialog[open]'), 'confirmed import');
  assert(previews === 1, 'One Upload click validates once before importing');
  assert(confirmations === 1 && document.querySelector('#csv-upload-success-description')?.textContent === 'You can view the uploaded products on the Products page.', 'Success shows a concise confirmation');
  assert(!document.body.textContent?.includes('1 categories created'), 'Detailed success result text is removed');
  button('OK').click();
  await until(() => !document.querySelector('.upload-excel-preview-dialog[open]') && !document.querySelector('dialog .csv-upload-preview'), 'OK closes the preview and returns to Upload Excel');
  assert(document.querySelector('#upload-excel-title')?.textContent === 'Upload Excel', 'Upload Excel page remains visible');
  mode = 'partial'; await open();
  button('Upload').click();
  await until(() => document.querySelector('.csv-upload-error'), 'partial result');
  assert(!document.querySelector('.csv-upload-success-dialog[open]'), 'Partial failure never shows success');
  assert(document.querySelector('.csv-upload-error')?.textContent?.includes('1 failed or unconfirmed') && document.querySelector('.csv-upload-error')?.textContent?.includes('Unconfirmed rows: 3'), 'Partial failure keeps category counts and original row numbers');
  passed.push('existing upload UI, read-only preview, category summary, confirmed upload and truthful partial-failure reporting');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ passed, failed: String(error) }); });
