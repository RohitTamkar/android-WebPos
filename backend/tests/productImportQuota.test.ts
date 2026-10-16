import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInMemoryProductImportQuota, MAX_PRODUCT_EXCEL_UPLOADS, UPLOAD_WINDOW_MS, ProductImportQuotaError } from '../src/productImportQuota.js';

const success = async () => ({ success: true, created: 1 });

test('first two accepted files share an outlet limit; third returns the oldest expiry', async () => {
  let time = Date.parse('2026-10-16T10:00:00Z');
  const first = time;
  const quota = createInMemoryProductImportQuota(() => time);
  await quota.run('outlet', 'file-a', success);
  time += 1000;
  await quota.run('outlet', 'file-b', success);
  assert.throws(() => quota.run('outlet', 'file-c', success), error => {
    assert.ok(error instanceof ProductImportQuotaError);
    assert.equal(error.nextAvailableAt, new Date(first + UPLOAD_WINDOW_MS).toISOString());
    assert.equal(error.retryAfterSeconds, (UPLOAD_WINDOW_MS - 1000) / 1000);
    return true;
  });
});

test('outlets are independent; different users and devices share the authorized outlet key', async () => {
  const quota = createInMemoryProductImportQuota();
  await quota.run('outlet-a', 'user-1-file', success);
  await quota.run('outlet-a', 'user-2-file', success);
  assert.throws(() => quota.run('outlet-a', 'device-3-file', success), ProductImportQuotaError);
  await quota.run('outlet-b', 'user-1-file', success);
  await quota.run('outlet-b', 'user-2-file', success);
});

test('a slot expires at exactly 24 hours, not one millisecond earlier', async () => {
  let time = 1000;
  const quota = createInMemoryProductImportQuota(() => time);
  await quota.run('outlet', 'one', success);
  time += 1000;
  await quota.run('outlet', 'two', success);
  time = 1000 + UPLOAD_WINDOW_MS - 1;
  assert.throws(() => quota.run('outlet', 'three', success), ProductImportQuotaError);
  time++;
  await quota.run('outlet', 'three', success);
  assert.throws(() => quota.run('outlet', 'four', success), ProductImportQuotaError);
});

test('IST midnight does not reset the rolling window', async () => {
  let time = Date.parse('2026-10-16T23:59:59+05:30');
  const quota = createInMemoryProductImportQuota(() => time);
  await quota.run('outlet', 'one', success);
  await quota.run('outlet', 'two', success);
  time += 2000;
  assert.throws(() => quota.run('outlet', 'three', success), ProductImportQuotaError);
});

test('simultaneous distinct requests reserve capacity before any writer completes', async () => {
  const quota = createInMemoryProductImportQuota();
  let finish!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  let writes = 0;
  const work = async () => { writes++; await blocked; return { success: true }; };
  const requests = Array.from({ length: 20 }, (_, index) => Promise.resolve().then(() => quota.run('outlet', `file-${index}`, work)));
  const settled = Promise.allSettled(requests);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(writes, MAX_PRODUCT_EXCEL_UPLOADS);
  finish();
  const outcomes = await settled;
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, MAX_PRODUCT_EXCEL_UPLOADS);
  assert.ok(outcomes.filter(result => result.status === 'rejected').every(result => result.reason instanceof ProductImportQuotaError));
});

test('simultaneous duplicate requests share one writer and one acceptance', async () => {
  const quota = createInMemoryProductImportQuota();
  let calls = 0;
  const work = async () => { calls++; return { success: true, created: 4 }; };
  const results = await Promise.all(Array.from({ length: 10 }, () => quota.run('outlet', 'same-file', work)));
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.created === 4));
  await quota.run('outlet', 'other-file', success);
  assert.throws(() => quota.run('outlet', 'third-file', success), ProductImportQuotaError);
});

test('completed retries neither create products nor extend the window', async () => {
  let time = 1000;
  const quota = createInMemoryProductImportQuota(() => time);
  await quota.run('outlet', 'same-file', success);
  await quota.run('outlet', 'other-file', success);
  time += 2000;
  const result = await quota.run('outlet', 'same-file', async () => { throw new Error('Completed retries must not write'); });
  assert.deepEqual(result, { success: true, created: 1 });
  assert.throws(() => quota.run('outlet', 'third-file', success), error => {
    assert.ok(error instanceof ProductImportQuotaError);
    assert.equal(error.nextAvailableAt, new Date(1000 + UPLOAD_WINDOW_MS).toISOString());
    return true;
  });
});

test('accepted exceptions retain their slot; the same source may reconcile', async () => {
  const quota = createInMemoryProductImportQuota();
  await assert.rejects(quota.run('outlet', 'failed-file', async () => { throw new Error('writer failed'); }), /writer failed/);
  await quota.run('outlet', 'second-file', success);
  assert.throws(() => quota.run('outlet', 'third-file', success), ProductImportQuotaError);
  await quota.run('outlet', 'failed-file', success);
  assert.throws(() => quota.run('outlet', 'third-file', success), ProductImportQuotaError);
});

test('partial imports retain their slot and retry through the existing writer callback', async () => {
  const quota = createInMemoryProductImportQuota();
  const partial = await quota.run('outlet', 'file', async () => ({ success: false, created: 100, unconfirmedRows: [101] }));
  assert.equal(partial.success, false);
  await quota.run('outlet', 'second', success);
  assert.throws(() => quota.run('outlet', 'third', success), ProductImportQuotaError);
  const reconciled = await quota.run('outlet', 'file', async () => ({ success: true, created: 1, existing: 100 }));
  assert.equal(reconciled.existing, 100);
});

test('product deletion does not remove quota timestamps or cause a completed replay to recreate products', async () => {
  const quota = createInMemoryProductImportQuota();
  const products = new Set<string>();
  await quota.run('outlet', 'one', async () => { products.add('one'); return { success: true }; });
  await quota.run('outlet', 'two', async () => { products.add('two'); return { success: true }; });
  products.clear();
  assert.throws(() => quota.run('outlet', 'three', success), ProductImportQuotaError);
  await quota.run('outlet', 'one', async () => { products.add('one'); return { success: true }; });
  assert.equal(products.size, 0);
});

test('restart or another backend instance resets/isolates state: prototype limitation', async () => {
  const firstInstance = createInMemoryProductImportQuota();
  await firstInstance.run('outlet', 'one', success);
  await firstInstance.run('outlet', 'two', success);
  assert.throws(() => firstInstance.run('outlet', 'three', success), ProductImportQuotaError);
  await createInMemoryProductImportQuota().run('outlet', 'three', success);
});

test('invalid quota time fails closed before running the writer', () => {
  const quota = createInMemoryProductImportQuota(() => Number.NaN);
  assert.throws(() => quota.run('outlet', 'one', async () => { throw new Error('must not run'); }), /Unable to verify/);
});
