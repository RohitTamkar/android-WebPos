import { createRoot } from 'react-dom/client';
import ExcelJS from 'exceljs';
import App from '../src/App.tsx';
import '../src/index.css';

localStorage.clear();
localStorage.setItem('pos_user_session', JSON.stringify({ id: 'user', name: 'Test Cashier', email: 'test@example.com', role: 'Admin', terminal: 'POS', token: 'mock-token' }));
localStorage.setItem('pos_selected_outlet', JSON.stringify({ id: 'outlet', name: 'Rohit Testing', branch: 'Pune' }));
const checks: string[] = [];
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${message}`);
}
let unavailable = false;
let requests = 0;
window.fetch = async (input, options) => {
  requests++;
  assert(options?.headers && (options.headers as Record<string, string>).Authorization === 'Bearer mock-token', 'dashboard request remains authenticated');
  const url = new URL(String(input), location.href);
  if (!url.pathname.endsWith('/dashboard')) throw new Error(`Unexpected API blocked: ${url.pathname}`);
  if (unavailable) return Response.json({ message: 'No shift data' }, { status: 404 });
  const dayId = url.searchParams.get('dayId');
  return Response.json({ data: { id: 'shift', dayId, shiftNo: 1, inActive: false, startBillNo: '001', lastBillNo: '005',
    totalSale: 500, cashSale: 400, digitalSale: 100, creditSale: 0, openingAmt: 50, expCash: 20,
    billCount: 5, tax: 25, expensesAmtTotal: 20, customerReceiveAmtTotal: 10,
    payments: { cash: 400, googlepay: 100 } } });
};
const blobs = new Map<string, Blob>();
const downloads: { name: string; blob: Blob }[] = [];
URL.createObjectURL = blob => { const id = `blob:dashboard-${blobs.size}`; blobs.set(id, blob as Blob); return id; };
URL.revokeObjectURL = () => {};
HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: blobs.get(this.href)! }); };
const root = createRoot(document.getElementById('root')!); root.render(<App />);
const exportButton = () => [...document.querySelectorAll<HTMLButtonElement>('.hero-actions button')].find(button => /Export/.test(button.textContent || ''))!;
const dataValues = (sheet: ExcelJS.Worksheet) => {
  const values = new Map(); sheet.eachRow(row => values.set(row.getCell(1).value, row.getCell(2).value)); return values;
};
void (async () => {
  await until(() => exportButton() && !exportButton().disabled, 'dashboard ready');
  const before = requests;
  exportButton().click(); exportButton().click();
  await until(() => downloads.length === 1 && !exportButton().disabled, 'download');
  assert(requests === before && downloads.length === 1, 'Export downloads one workbook without extra API requests or duplicate clicks');
  const first = new ExcelJS.Workbook(); await first.xlsx.load(await downloads[0]!.blob.arrayBuffer());
  const sheet = first.worksheets[0]!; const values = dataValues(sheet);
  assert(sheet.getCell('A1').value === 'Rohit Testing', 'selected outlet name is the main heading');
  assert(values.get('Total Sale') === 500 && values.get('Cash In Hand') === 430 && values.get('No. of Bills') === 5, 'workbook totals match the displayed dashboard');
  assert(values.get('Branch') === 'Pune' && values.get('Cashier') === 'Test Cashier', 'export contains outlet and cashier context');
  assert(values.get('Google Pay') === 100 && values.get('Total Tax') === 25 && values.get('Total Expenses') === 20, 'payment, tax and expense details are included');
  const today = new Date(); today.setDate(today.getDate() - 1);
  const picked = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  document.querySelector<HTMLButtonElement>('.report-date-trigger')!.click();
  await until(() => document.querySelector(`[data-date="${picked}"]`), 'calendar');
  document.querySelector<HTMLButtonElement>(`[data-date="${picked}"]`)!.click();
  await pause();
  await until(() => !exportButton().disabled, 'selected date loaded');
  exportButton().click(); await until(() => downloads.length === 2 && !exportButton().disabled, 'dated download');
  const second = new ExcelJS.Workbook(); await second.xlsx.load(await downloads[1]!.blob.arrayBuffer());
  assert(dataValues(second.worksheets[0]!).get('Report Date') === picked, 'changing the dashboard date updates the exported report date');
  assert(downloads[1]!.name === `Rohit_Testing_Dashboard_${picked}.xlsx`, 'filename includes the outlet and selected date');
  unavailable = true;
  window.dispatchEvent(new Event('focus'));
  await until(() => document.querySelector('.dashboard-data-notice.error'), 'missing shift');
  assert(exportButton().disabled && downloads.length === 2, 'unavailable dashboard data cannot produce an empty workbook');
  root.unmount();
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
