import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInMemoryProductImportQuota, MAX_PRODUCT_UPLOAD_ATTEMPTS, PRODUCT_UPLOAD_WINDOW_MS, ProductImportQuotaError } from '../src/productImportQuota.js';
test('each acceptance consumes a slot and third returns the oldest expiry', () => {
    let time = 1000;
    const quota = createInMemoryProductImportQuota(() => time);
    quota.accept('outlet');
    time += 1000;
    quota.accept('outlet');
    assert.throws(() => quota.accept('outlet'), error => {
        assert.ok(error instanceof ProductImportQuotaError);
        assert.equal(error.nextAvailableAt, new Date(1000 + PRODUCT_UPLOAD_WINDOW_MS).toISOString());
        assert.equal(error.retryAfterSeconds, (PRODUCT_UPLOAD_WINDOW_MS - 1000) / 1000);
        return true;
    });
});
test('outlets are independent and counter does not depend on file identity or products', () => {
    const quota = createInMemoryProductImportQuota();
    quota.accept('a');
    quota.accept('a');
    assert.throws(() => quota.accept('a'), ProductImportQuotaError);
    quota.accept('b');
    quota.accept('b');
    assert.throws(() => quota.accept('b'), ProductImportQuotaError);
});
test('a slot expires at exactly 24 hours, not at midnight or one millisecond earlier', () => {
    const first = Date.parse('2026-10-16T23:59:59+05:30');
    let time = first;
    const quota = createInMemoryProductImportQuota(() => time);
    quota.accept('outlet');
    time += 1000;
    quota.accept('outlet');
    time = first + PRODUCT_UPLOAD_WINDOW_MS - 1;
    assert.throws(() => quota.accept('outlet'), ProductImportQuotaError);
    time++;
    quota.accept('outlet');
    assert.throws(() => quota.accept('outlet'), ProductImportQuotaError);
});
test('concurrent attempts reserve capacity synchronously', async () => {
    const quota = createInMemoryProductImportQuota();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => Promise.resolve().then(() => quota.accept('outlet'))));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, MAX_PRODUCT_UPLOAD_ATTEMPTS);
    assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason instanceof ProductImportQuotaError));
});
test('another process or restart has an independent in-memory counter', () => {
    const quota = createInMemoryProductImportQuota();
    quota.accept('outlet');
    quota.accept('outlet');
    assert.throws(() => quota.accept('outlet'), ProductImportQuotaError);
    createInMemoryProductImportQuota().accept('outlet');
});
test('invalid quota time fails closed', () => {
    assert.throws(() => createInMemoryProductImportQuota(() => NaN).accept('outlet'), /Unable to verify/);
});
test('read-only checks share outlet state without consuming slots and unlock at expiry', () => {
    let time = 1000;
    const quota = createInMemoryProductImportQuota(() => time);
    for (let i = 0; i < 10; i++)
        quota.check('outlet');
    quota.accept('outlet');
    quota.check('outlet');
    quota.accept('outlet');
    assert.throws(() => quota.check('outlet'), ProductImportQuotaError);
    quota.check('other-outlet');
    time += PRODUCT_UPLOAD_WINDOW_MS;
    quota.check('outlet');
    quota.accept('outlet');
});
//# sourceMappingURL=productImportQuota.test.js.map