import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the dashboard effect with fake HTTP and browser events; no backend is started.
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes('/dashboard?dayId=')) effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect);
const code = ts.transpileModule(`const effect = ${effect};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
}).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const windowEvents = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  let tick;
  let cleared = false;
  let data;
  let error;
  let logout = false;
  const loading = [];
  const requests = [];
  let reply = async () => ({ ok: true, status: 200, json: async () => ({ data: { totalSale: 10 } }) });
  const deps = {
    session: { token: 'token' }, selectedOutlet: { id: 'outlet' }, dashboardDay: '2026-10-17',
    document,
    window: {
      setInterval(callback, ms) { assert.equal(ms, 10_000); tick = callback; return 1; },
      clearInterval() { cleared = true; },
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    },
    setDashboardData(value) { data = value; }, setDashboardError(value) { error = value; },
    setDashboardLoading(value) { loading.push(value); }, handleLogout() { logout = true; },
    fetch: async (url, options) => { requests.push({ url, options }); return reply(); },
  };
  const cleanup = new Function(...Object.keys(deps), `${code}; return effect();`)(...Object.values(deps));
  return {
    document, requests, loading, cleanup, tick: () => tick(),
    event: name => windowEvents.dispatchEvent(new Event(name)),
    setReply: fn => { reply = fn; },
    get data() { return data; }, get error() { return error; },
    get logout() { return logout; }, get cleared() { return cleared; },
  };
}

test('polling updates totals without clearing existing values or showing loading', async () => {
  const f = fixture(); await settle();
  assert.equal(f.data.totalSale, 10);
  f.setReply(async () => ({ ok: true, status: 200, json: async () => ({ data: { totalSale: 25 } }) }));
  f.tick();
  assert.equal(f.data.totalSale, 10);
  await settle();
  assert.equal(f.data.totalSale, 25);
  assert.deepEqual(f.loading, [true, false]);
  assert.ok(f.requests.every(r => r.options.cache === 'no-store' && r.options.headers.Authorization === 'Bearer token'));
  f.cleanup();
});

test('hidden tabs pause polling; returning, focusing and reconnecting refresh immediately', async () => {
  const f = fixture(); await settle();
  f.document.visibilityState = 'hidden'; f.tick(); f.event('focus');
  await settle(); assert.equal(f.requests.length, 1);
  f.document.visibilityState = 'visible';
  f.document.dispatchEvent(new Event('visibilitychange')); await settle();
  f.event('focus'); await settle(); f.event('online'); await settle();
  assert.equal(f.requests.length, 4);
  f.cleanup();
});

test('requests do not overlap and cleanup aborts and ignores late responses', async () => {
  const f = fixture(); await settle();
  let finish;
  f.setReply(() => new Promise(resolve => { finish = resolve; }));
  f.tick(); f.tick(); f.event('focus');
  assert.equal(f.requests.length, 2);
  f.cleanup();
  assert.equal(f.requests[1].options.signal.aborted, true);
  assert.equal(f.cleared, true);
  finish({ ok: true, status: 200, json: async () => ({ data: { totalSale: 999 } }) });
  await settle();
  f.tick(); f.event('online');
  f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.requests.length, 2);
  assert.equal(f.data.totalSale, 10);
});

test('temporary failures retain totals, recover on the next refresh, and expired sessions log out', async () => {
  const f = fixture(); await settle();
  f.setReply(async () => { throw new Error('offline'); });
  f.tick(); await settle();
  assert.equal(f.data.totalSale, 10); assert.match(f.error, /Cannot reach/);
  f.setReply(async () => ({ ok: true, status: 200, json: async () => ({ data: { totalSale: 20 } }) }));
  f.tick(); await settle();
  assert.equal(f.data.totalSale, 20); assert.equal(f.error, '');
  f.setReply(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  f.tick(); await settle(); assert.equal(f.logout, true);
  f.cleanup();
});
