import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTimedNotice } from '../src/utils/useTimedNotice.ts';
import { SuccessPopup } from '../src/pages/SuccessPopup.tsx';
import { ServicePointsPage } from '../src/pages/ServicePointsPage.tsx';
import type { OutletSummary } from '../src/pages/OutletSelectionPage.tsx';
import '../src/index.css';

const checks: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); checks.push(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(check: () => unknown) { for (let n = 0; n < 120; n++) { if (check()) return; await pause(); } throw new Error('Timed out'); }
// Advance only notification timers; API mocks and React continue on their normal clock.
const setTimer = window.setTimeout.bind(window), clearTimer = window.clearTimeout.bind(window);
let now = 0, nextId = -1;
const timers = new Map<number, { at: number; callback: () => void }>();
window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay !== 10_000) return setTimer(callback, delay, ...args);
  const id = nextId--;
  timers.set(id, { at: now + delay, callback: () => { if (typeof callback === 'function') callback(...args); } });
  return id;
}) as typeof window.setTimeout;
window.clearTimeout = id => { if (id !== undefined && timers.has(id)) timers.delete(id); else clearTimer(id); };
async function advance(ms: number) {
  now += ms;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  await pause();
}
function Harness() {
  const [isError, setIsError] = useState(false);
  const [notice, setNotice] = useTimedNotice(!isError);
  const [popup, setPopup] = useState(false), [count, setCount] = useState(0);
  return <><button onClick={() => { setIsError(false); setNotice('Saved successfully'); }}>Save</button>
    <button onClick={() => { setIsError(true); setNotice('Save failed'); }}>Fail</button>
    <button onClick={() => setNotice('')}>Dismiss</button>
    <button onClick={() => setPopup(true)}>Show popup</button>
    <button onClick={() => setCount(count + 1)}>Rerender</button>
    {notice && <p data-notice role={isError ? 'alert' : 'status'}>{notice}</p>}
    {popup && <SuccessPopup message="Completed successfully" onDismiss={() => setPopup(false)} />}</>;
}
const root = createRoot(document.getElementById('root')!);
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
async function click(text: string) { button(text).click(); await pause(); }
void (async () => {
  root.render(<Harness />); await until(() => button('Save'));
  await click('Save'); await advance(9999);
  assert(document.querySelector('[data-notice]'), 'Success stays visible for the full first 9999ms');
  await advance(1);
  assert(!document.querySelector('[data-notice]'), 'Success disappears at ten seconds');
  await click('Save'); await advance(6000); await click('Save'); await advance(4000);
  assert(document.querySelector('[data-notice]'), 'Repeating identical success text restarts its timeout');
  await advance(6000); assert(!document.querySelector('[data-notice]'), 'Repeated notice clears ten seconds after the latest action');
  await click('Save'); await click('Dismiss');
  assert(!document.querySelector('[data-notice]') && timers.size === 0, 'Manual dismissal cancels the notification timer');
  await click('Save'); await advance(5000); await click('Fail'); await advance(15000);
  assert(document.querySelector('[role="alert"]')?.textContent === 'Save failed', 'Success timers never hide subsequent errors');
  await click('Dismiss'); await click('Show popup'); await advance(6000);
  button('Rerender').click(); await pause(); await advance(4000);
  assert(!document.querySelector('dialog'), 'Success dialog closes after ten seconds despite parent rerenders');
  await click('Show popup'); await click('OK');
  assert(!document.querySelector('dialog') && timers.size === 0, 'OK still closes success dialog and cancels timer');

  let row = { documentId: 'point', name: 'Kitchen', paperSize: 2, printerType: 0, header: '', subHeader: '', footer: '', printerIpAddress: '', port: 0, usbPath: null };
  window.fetch = async (_url, init) => {
    if (init?.method === 'PATCH') {
      row = { ...row, ...JSON.parse(String(init.body)) };
      return Response.json({ success: true, data: row });
    }
    return Response.json({ success: true, data: { servicePoints: [row] } });
  };
  root.render(<ServicePointsPage outlet={{ id: 'outlet', name: 'Shop' } as OutletSummary} token="mock-token" onSessionExpired={() => { throw new Error('Unexpected expiry'); }} />);
  await until(() => button('Kitchen')); await click('Kitchen');
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await until(() => document.querySelector('.service-point-notice'));
  assert(document.querySelector('.service-point-notice')?.textContent === 'Service point updated successfully.', 'Actual Service Point update still shows confirmed success');
  await advance(9999); assert(document.querySelector('.service-point-notice'), 'Service Point success remains before timeout');
  await advance(1); assert(!document.querySelector('.service-point-notice'), 'Service Point success disappears after ten seconds');
  root.render(<Harness />); await until(() => button('Save')); await click('Save');
  root.unmount(); await pause();
  assert(timers.size === 0, 'Unmount cleans up all outstanding success timers');
  window.setTimeout = setTimer; window.clearTimeout = clearTimer;
  document.getElementById('test-results')!.textContent = JSON.stringify({ passed: checks });
})().catch(error => { document.getElementById('test-results')!.textContent = JSON.stringify({ failed: String(error), passed: checks }); });
