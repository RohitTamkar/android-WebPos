import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMasterSnapshot, rememberMasterSnapshot, masterSnapshotRevision, invalidateMasterSnapshots, clearMasterSnapshots } from '../src/utils/masterSnapshots.ts';
const url = '/api/outlets/a/products';
function save(path: string, value: unknown, token = 'user') {
  readMasterSnapshot(path, token);
  rememberMasterSnapshot(path, token, value, masterSnapshotRevision());
}
test('recent snapshots remain visible on return visits and expire after five minutes', t => {
  clearMasterSnapshots(); let now = 1000; t.mock.method(Date, 'now', () => now);
  save(url, [{ id: 'product' }]); assert.deepEqual(readMasterSnapshot(url, 'user'), [{ id: 'product' }]);
  now += 30_000; assert.deepEqual(readMasterSnapshot(url, 'user'), [{ id: 'product' }]);
  now += 270_000; assert.equal(readMasterSnapshot(url, 'user'), undefined);
});
test('tokens, outlet IDs, list shapes and logo variants never share cached data', () => {
  clearMasterSnapshots(); save(url, 'a'); save('/api/outlets/b/products', 'b');
  assert.equal(readMasterSnapshot(url, 'user'), 'a'); assert.equal(readMasterSnapshot('/api/outlets/b/products', 'user'), 'b');
  save('/api/outlets/a/categories#metadata', 'metadata'); assert.equal(readMasterSnapshot('/api/outlets/a/categories', 'user'), undefined);
  save('/api/outlets/a/logo?variant=header', 'header'); save('/api/outlets/a/logo?variant=footer', 'footer');
  assert.equal(readMasterSnapshot('/api/outlets/a/logo?variant=header', 'user'), 'header');
  assert.equal(readMasterSnapshot(url, 'another-user'), undefined);
  rememberMasterSnapshot(url, 'user', 'late old login', masterSnapshotRevision());
  assert.equal(readMasterSnapshot(url, 'another-user'), undefined);
});
test('outlet mutations invalidate all dependent snapshots and reject pre-mutation responses', () => {
  clearMasterSnapshots(); save(url, 'product'); save('/api/outlets/a/categories', 'categories'); save('/api/outlets/b/products', 'other');
  const before = masterSnapshotRevision(); invalidateMasterSnapshots('/api/outlets/a/products/item');
  rememberMasterSnapshot(url, 'user', 'late stale products', before);
  assert.equal(readMasterSnapshot(url, 'user'), undefined); assert.equal(readMasterSnapshot('/api/outlets/a/categories', 'user'), undefined);
  assert.equal(readMasterSnapshot('/api/outlets/b/products', 'user'), 'other');
});
test('logout cleanup rejects responses from the previous session and memory is bounded', () => {
  clearMasterSnapshots(); save(url, 'old'); const before = masterSnapshotRevision(); clearMasterSnapshots();
  rememberMasterSnapshot(url, 'user', 'late old session', before); assert.equal(readMasterSnapshot(url, 'user'), undefined);
  for (let index = 0; index < 33; index++) save(`/api/outlets/a/list${index}`, index);
  assert.equal(readMasterSnapshot('/api/outlets/a/list0', 'user'), undefined); assert.equal(readMasterSnapshot('/api/outlets/a/list32', 'user'), 32);
});

test('the usage fetch wrapper invalidates snapshots before and after real mutations, including failed requests', async () => {
  const { WebUsageClient } = await import('../src/utils/webUsage.ts');
  const previous = (globalThis as any).window;
  let fails = false, calls = 0;
  const browser: any = { location: { origin: 'http://localhost' }, fetch: async () => {
    calls++; assert.equal(readMasterSnapshot(url, 'user'), undefined, 'cache is cleared before sending the mutation');
    if (fails) throw new Error('Uncertain network outcome');
    return Response.json({ success: true });
  } };
  (globalThis as any).window = browser;
  const client = new WebUsageClient(() => {});
  client.session = { outletId: 'a', sessionId: 'session', generation: 'generation', sequence: 1, usedSeconds: 0, remainingSeconds: 1800, date: '2026-10-28', timeZone: 'Asia/Kolkata' };
  const uninstall = client.install();
  try {
    clearMasterSnapshots(); save(url, 'old');
    await browser.fetch('/api/outlets/a/products/item', { method: 'PATCH' });
    assert.equal(readMasterSnapshot(url, 'user'), undefined);
    save(url, 'old'); fails = true;
    await assert.rejects(browser.fetch('/api/outlets/a/products/item', { method: 'DELETE' }));
    assert.equal(readMasterSnapshot(url, 'user'), undefined); assert.equal(calls, 2, 'mutations are never automatically retried');
  } finally { uninstall(); (globalThis as any).window = previous; clearMasterSnapshots(); }
});
