import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReportDateInput } from '../src/pages/ReportDateInput.tsx';
import '../src/index.css';
import '../src/App.css';
import '../src/pages/BillWiseReportPage.css';

const checks: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 100; i++) { if (check()) return; await pause(); }
  throw new Error(`Timeout: ${message}`);
}
function Demo() {
  const [from, setFrom] = useState('2026-10-18');
  const [to, setTo] = useState('');
  const [dashboard, setDashboard] = useState('2026-10-18');
  return <>
    <div className="hero-actions" style={{ background: '#193f57', padding: 20 }}><label className="dashboard-date-picker" htmlFor="dashboard-date"><ReportDateInput id="dashboard-date" aria-label="Dashboard date" value={dashboard} onChange={setDashboard} /><span>14:35:39</span></label></div>
    <div className="bill-report-filters">
      <label><span>From date</span><ReportDateInput id="from-date" aria-label="From date" value={from} onChange={setFrom} /></label>
      <label><span>To date</span><ReportDateInput id="to-date" aria-label="To date" value={to} onChange={setTo} min="2026-10-10" max="2026-11-10" /></label>
      <label><span>Disabled</span><ReportDateInput id="disabled-date" aria-label="Disabled date" value="" onChange={() => { throw new Error('Disabled changed'); }} disabled /></label>
    </div>
    <output id="selected-values">{JSON.stringify({ from, to, dashboard })}</output>
  </>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Demo />);
const trigger = (id: string) => document.getElementById(id) as HTMLButtonElement;
const calendar = () => document.querySelector<HTMLElement>('.report-date-calendar');
const day = (id: string) => document.querySelector<HTMLButtonElement>(`[data-date="${id}"]`)!;
const values = () => JSON.parse(document.getElementById('selected-values')!.textContent!);
const action = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
void (async () => {
  await until(() => trigger('from-date'), 'render');
  assert(trigger('from-date').textContent?.includes('18 Oct 2026'), 'date has an unambiguous day-month-year display');
  assert(trigger('to-date').textContent?.includes('Choose date'), 'empty dates have a clear placeholder');
  assert(!document.querySelector('input[type=date]'), 'native segmented input and duplicate calendar controls are removed');
  trigger('from-date').click(); await until(calendar, 'open');
  assert(calendar()!.parentElement === document.body, 'calendar portal avoids filter and dashboard clipping');
  assert(calendar()!.getAttribute('role') === 'dialog', 'calendar has an accessible dialog role');
  assert(document.querySelector('.report-date-weekdays')?.textContent === 'MonTueWedThuFriSatSun', 'weekday labels follow Monday-first order');
  assert(day('2026-10-18').getAttribute('aria-pressed') === 'true', 'selected day is marked clearly');
  assert(document.activeElement === day('2026-10-18'), 'opening focuses the selected day');
  const bounds = calendar()!.getBoundingClientRect();
  assert(bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1, 'calendar fits the viewport');
  day('2026-10-20').click(); await pause();
  assert(values().from === '2026-10-20' && !calendar(), 'selection emits the existing ISO date and closes');
  assert(document.activeElement === trigger('from-date'), 'selection restores trigger focus');
  trigger('from-date').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await until(calendar, 'keyboard open');
  day('2026-10-20').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await pause();
  assert(document.activeElement === day('2026-10-19') && values().from === '2026-10-20', 'arrow navigation moves focus without prematurely changing the date');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause();
  assert(!calendar() && document.activeElement === trigger('from-date'), 'Escape closes and restores focus');
  trigger('from-date').click(); await until(calendar, 'reopen');
  action('Next month').click(); await pause();
  assert(document.querySelector<HTMLSelectElement>('[aria-label=Month]')!.value === '10', 'next-month control advances the month');
  action('Previous month').click(); await pause();
  const year = document.querySelector<HTMLSelectElement>('[aria-label=Year]')!;
  year.value = '2025'; year.dispatchEvent(new Event('change', { bubbles: true })); await pause();
  assert(!!day('2025-10-20'), 'year selection updates calendar days');
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await pause();
  assert(!calendar(), 'outside interaction closes the calendar');
  trigger('from-date').click(); await until(calendar, 'clear open');
  [...calendar()!.querySelectorAll('button')].find(button => button.textContent === 'Clear')!.click(); await pause();
  assert(values().from === '' && trigger('from-date').textContent?.includes('Choose date'), 'Clear resets the date');
  trigger('from-date').click(); await until(calendar, 'today open');
  [...calendar()!.querySelectorAll('button')].find(button => button.textContent === 'Today')!.click(); await pause();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert(values().from === today, 'Today chooses the local calendar date');
  trigger('to-date').click(); await until(calendar, 'bounded open');
  const month = document.querySelector<HTMLSelectElement>('[aria-label=Month]')!;
  month.value = '9'; month.dispatchEvent(new Event('change', { bubbles: true })); await pause();
  const boundedYear = document.querySelector<HTMLSelectElement>('[aria-label=Year]')!;
  boundedYear.value = '2026'; boundedYear.dispatchEvent(new Event('change', { bubbles: true })); await pause();
  assert(day('2026-10-09').disabled && !day('2026-10-10').disabled, 'minimum date disables earlier days');
  day('2026-10-10').click(); await pause();
  assert(values().to === '2026-10-10', 'date fields update independently');
  trigger('dashboard-date').click(); await until(calendar, 'dashboard open');
  assert(getComputedStyle(trigger('dashboard-date')).color !== 'rgb(255, 255, 255)', 'dashboard date remains readable on its white control');
  day('2026-10-21').click(); await pause();
  assert(values().dashboard === '2026-10-21', 'dashboard uses the same calendar and ISO value');
  trigger('disabled-date').click(); await pause();
  assert(!calendar(), 'disabled date cannot open the picker');
  if (location.hash === '#preview') { trigger('dashboard-date').click(); await until(calendar, 'screenshot'); }
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks.length, checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), checks }); });
