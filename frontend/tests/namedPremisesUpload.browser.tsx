import { createRoot } from 'react-dom/client';
import { CsvUploadPreview } from '../src/pages/CsvUploadPreview.tsx';
import { PRODUCT_COLUMNS, parseProductCsv } from '../src/pages/productCsvPreview.ts';
import '../src/index.css';
const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
async function until(check: () => unknown) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out'); }
let writes = 0, validations = 0;
const row = ['Chicken', 'Local', '20', '20', '0', '0', 'Food', '1', '0', '0', 'number', '0', 'no', '', '25.50', '0'];
const source = [[...PRODUCT_COLUMNS, 'AC Table', 'Non AC Table'], row].map(cells => cells.join(',')).join('\n');
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith('/quota')) return Response.json({ remainingAttempts: 2 });
  const body = JSON.parse(String(init?.body));
  assert(body.source === source, 'original named columns and prices reach the server without stripping');
  if (url.endsWith('/validate')) {
    assert(body.mode === 'premises', 'validation requests the premises format'); validations++;
    return Response.json({ success: true, data: { canUpload: true, headerErrors: [], rows: [{ rowNumber: 2, errors: [] }], documents: [{ rowNumber: 2, fields: { code: 7 } }] } });
  }
  assert(url === '/api/outlets/outlet/products/import/premises', 'confirmation uses the premises endpoint');
  assert(body.codes[0] === 7, 'confirmation uses the reviewed Search Codes'); writes++;
  return Response.json({ success: true, data: { success: true, created: 1, existing: 0, confirmedRows: [2], unconfirmedRows: [], message: 'Saved' } });
};
window.Worker = class {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  async postMessage(file: File) { const source = await file.text(); this.onmessage?.({ data: { source, preview: parseProductCsv(source, 'premises') } }); }
  terminate() {}
} as unknown as typeof Worker;
const NativeURL = URL;
window.URL = class extends NativeURL { constructor(input: string | URL, base: string | URL = location.href) { super(input, base); } };
const root = createRoot(document.getElementById('root')!);
root.render(<CsvUploadPreview mode="premises" outletId="outlet" token="mock" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} onSuccessAcknowledged={() => {}} />);
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label)!;
void (async () => {
  await until(() => document.querySelector('input[type=file]'));
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  const transfer = new DataTransfer(); transfer.items.add(new File([source], 'named.csv')); input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => document.querySelector('tbody'));
  assert(writes === 0 && validations === 0, 'selecting and previewing a file creates nothing');
  assert(!button('Preview Search Codes') && !button('Next') && !button('Previous'), 'upload has a single step');
  assert(!button('Upload').disabled, 'named premises enable upload');
  button('Upload').click(); await until(() => document.querySelector('.csv-upload-success-dialog[open]'));
  assert(validations === 1 && writes === 1, 'one Upload click validates once and makes one import request');
  assert(button('Upload').disabled, 'success prevents duplicate submissions');
  root.unmount(); document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
