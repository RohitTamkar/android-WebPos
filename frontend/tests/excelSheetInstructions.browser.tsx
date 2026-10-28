import { createRoot } from 'react-dom/client';
import { UploadExcelPage } from '../src/pages/UploadExcelPage.tsx';
import { PRODUCT_COLUMNS, parseProductCsv } from '../src/pages/productCsvPreview.ts';
import '../src/index.css';
import '../src/App.css';
let requests = 0;
window.fetch = async input => {
  requests++;
  if (String(input).endsWith('/products/import/quota')) return Response.json({ success: true, remainingAttempts: 2, maxAttempts: 2 });
  throw new Error('Only the existing upload quota GET is permitted');
};
const results: string[] = [];
const root = createRoot(document.getElementById('root')!);
root.render(<div className="retail-dashboard-shell"><div className="dashboard-stage"><main className="dashboard-workspace"><UploadExcelPage outletId="illustration-only" token="mock-token" onSessionExpired={() => { throw new Error('Unexpected session access'); }} /></main></div></div>);
document.getElementById('test-results')!.style.display = 'none';
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function waitFor(check: () => unknown, message: string) { for (let i = 0; i < 120; i++) { if (check()) return; await pause(); } throw new Error(`Timed out: ${message}`); }
function option() { return [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-option')].find(button => button.textContent?.includes('Excel Sheet Instructions'))!; }
function dialog() { return document.querySelector<HTMLDialogElement>('.upload-excel-instruction-dialog')!; }
async function open() { option().click(); await waitFor(() => dialog()?.open && document.querySelector('.sheet-grid'), 'instructions open'); }
void (async () => {
  await waitFor(() => option(), 'option ready'); await open();
  assert(document.querySelector('dialog[open] .excel-sheet-instructions')?.textContent?.includes('Download Standard Template') && document.querySelector('dialog[open] .excel-sheet-instructions')?.textContent?.includes('Download Premises-Wise Template'), 'Both demo template downloads are inside the instructions');
  assert(document.querySelectorAll('dialog').length === 1, 'uses only the existing modal');
  const headers = [...document.querySelectorAll('.sheet-column-headers th[scope="col"]')].map(cell => cell.textContent);
  assert(JSON.stringify(headers) === JSON.stringify(PRODUCT_COLUMNS), 'all 14 mandatory headers in parser order');
  const letters = [...document.querySelectorAll('.sheet-column-letters td')].slice(1).map(cell => cell.textContent).join('');
  assert(letters === 'ABCDEFGHIJKLMN', 'column letters A to N');
  const rows = [...document.querySelectorAll('.sheet-grid tbody tr')];
  assert(rows.length === 20, '20 illustrative product rows');
  assert(getComputedStyle(rows[0]!.querySelector('td')!).color === 'rgb(51, 65, 85)', 'sample cells have readable dark text');
  const values = rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent ?? ''));
  assert(values.every(row => row.length === 14 && row[10] === 'number' && row[11] === '0'), 'sample rows match current unit and zero-stock rules');
  assert(rows[0]?.querySelector('th')?.textContent === '2' && rows.at(-1)?.querySelector('th')?.textContent === '21', 'spreadsheet row numbers');
  const parsed = parseProductCsv([PRODUCT_COLUMNS.join(','), ...values.map(row => row.join(','))].join('\n'));
  assert(!parsed.headerErrors.length && parsed.rows.length === 20 && parsed.rows.every(row => !row.errors.length), 'illustration passes existing local parser without parser changes');
  assert(document.querySelector('.sheet-formula-bar')?.textContent?.includes('A2') && document.querySelector('.sheet-formula-bar')?.textContent?.includes('Basmati Rice'), 'name and formula bar');
  assert(document.querySelector('.sheet-tab')?.textContent === 'Products', 'Products sheet tab');
  assert(document.querySelector('.sheet-sample-note')?.textContent?.includes('illustrative'), 'sample disclaimer');
  results.push('Same modal renders 20 illustrative rows, exact 14 headers, A–N, row numbers, formula bar and Products tab; samples pass the unchanged parser');

  const pane = document.querySelector<HTMLElement>('.sheet-grid-scroll')!;
  assert(pane.scrollWidth > pane.clientWidth, 'spreadsheet has horizontal scrolling');
  pane.scrollLeft = pane.scrollWidth; await pause();
  const lastHeader = document.querySelector('.sheet-column-headers th:last-child')!.getBoundingClientRect();
  const bounds = pane.getBoundingClientRect();
  assert(lastHeader.left >= bounds.left && lastHeader.right <= bounds.right + 2, 'last column is reachable through scrolling');
  pane.scrollTop = 100; await pause();
  const header = document.querySelector('.sheet-column-headers')!.querySelector('th[scope="col"]')!.getBoundingClientRect();
  assert(Math.abs(header.top - pane.getBoundingClientRect().top - 27) < 3, 'sticky header survives vertical scrolling');
  pane.scrollLeft = 0; pane.scrollTop = 0;
  results.push('Horizontal scrolling reaches Search Code; header remains fixed during vertical scrolling');

  assert(document.querySelectorAll('.sheet-rules-list > li').length === 11, 'numbered instruction panel');
  assert(document.querySelector('.sheet-rules-list')?.textContent?.includes('Premises cannot currently be verified or saved'), 'premises are not falsely advertised as supported');
  const pills = [...document.querySelectorAll('.sheet-required-columns li')];
  assert(pills.length === 14 && pills.every((pill, index) => pill.textContent?.includes(PRODUCT_COLUMNS[index]!)), '14 required-column pills in order');
  assert(dialog().scrollWidth <= dialog().clientWidth + 2, 'overall modal has no horizontal overflow');
  const strip = document.querySelector<HTMLElement>('.sheet-required-columns')!;
  assert(strip.scrollWidth <= strip.clientWidth + 2, 'required-column pills do not overflow');
  const workbook = document.querySelector('.sheet-workbook')!.getBoundingClientRect();
  const rules = document.querySelector('.sheet-instruction-panel')!.getBoundingClientRect();
  if (window.innerWidth > 1100) assert(rules.left >= workbook.right, 'desktop uses left/right panels');
  else assert(rules.top >= workbook.bottom, 'small screen stacks panels');
  if (window.location.hash === '#preview') {
    assert(requests === 0, 'no API access');
    results.push(`Layout snapshot at ${window.innerWidth}px; required pills contained; no API requests`);
    document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results }); return;
  }
  dialog().scrollTop = dialog().scrollHeight; await pause();
  const close = [...dialog().querySelectorAll('button')].find(button => button.textContent === 'Close')!;
  assert(close.getBoundingClientRect().bottom <= window.innerHeight, 'Close button remains accessible');
  close.click(); await waitFor(() => !document.querySelector('dialog[open]'), 'Close button');
  await new Promise(resolve => setTimeout(resolve, 150));
  await open(); (document.querySelector('[aria-label="Close information"]') as HTMLButtonElement).click();
  await waitFor(() => !document.querySelector('dialog[open]'), 'close icon');
  await new Promise(resolve => setTimeout(resolve, 150));
  await open(); dialog().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
  await waitFor(() => !document.querySelector('dialog[open]'), 'outside click');
  results.push(`Instructions, required pills and ${window.innerWidth}px responsive layout are readable, contained and close correctly`);
  assert(requests === 0, 'no API, upload or database calls');
  results.push('Instruction preview makes zero API requests');
  const uploadOption = [...document.querySelectorAll<HTMLButtonElement>('.upload-excel-option')].find(button => button.textContent?.startsWith('Upload Excel'))!;
  uploadOption.click(); await waitFor(() => document.querySelector('.csv-upload-preview'), 'existing upload preview opens');
  assert(document.querySelector<HTMLInputElement>('input[type="file"]')?.accept === '.csv,.tsv', 'existing file selection preserved');
  assert(!document.querySelector('.excel-sheet-instructions'), 'instruction content stays isolated from upload content');
  assert(requests === 1, 'Opening upload reads quota once; instructions and templates make no API requests');
  results.push('Existing Upload Excel preview and CSV/TSV selection remain unchanged');
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: results });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: results }); });
