import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebUsageGuard } from '../src/webUsageMiddleware.js';
import { DailyUsageError } from '../src/dailyUsage.js';
async function run(path = '/dashboard', options = {}) {
    const calls = [];
    let next = false;
    const guard = createWebUsageGuard({ readToken: () => options.anonymous ? null : { profileDocId: 'signed' },
        db: () => { calls.push('db'); return {}; }, assigned: () => [],
        operate: async (...args) => { calls.push(args); if (options.error)
            throw options.error; return {}; } });
    const req = { path, params: { outletId: 'outlet' }, method: options.method ?? 'GET', header: (name) => name === 'x-web-usage-outlet' ? options.context : options.missing ? undefined : name === 'x-web-usage-session' ? 'session' : 'generation' };
    const res = { statusCode: 200, setHeader() { }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
    await guard(req, res, () => { next = true; });
    return { calls, next, res };
}
test('protected reports, devices, employees and mutations require the server check before handlers execute', async () => {
    for (const [path, method] of [['/dashboard', 'GET'], ['/reports/gst', 'GET'], ['/devices', 'GET'], ['/employees', 'POST'], ['/master-transfer', 'POST'], ['/products/id', 'DELETE'], ['/product-image-assignments', 'POST']]) {
        const result = await run(path, { method });
        assert.equal(result.next, true);
        assert.equal(result.calls[1][2], 'signed');
        assert.deepEqual(result.calls[1][4], { action: 'check', sessionId: 'session', generation: 'generation' });
    }
});
test('omitting headers or authentication never bypasses enforcement', async () => {
    const missing = await run('/dashboard', { missing: true });
    assert.equal(missing.res.statusCode, 428);
    assert.equal(missing.next, false);
    assert.deepEqual(missing.calls, []);
    const anonymous = await run('/dashboard', { anonymous: true });
    assert.equal(anonymous.res.statusCode, 401);
    assert.equal(anonymous.next, false);
});
test('exhausted and failed accounting never execute protected handlers', async () => {
    for (const error of [new DailyUsageError(403, 'USAGE_LIMIT_REACHED', 'Allowance exhausted'), new Error('SECRET INTERNAL')]) {
        const result = await run('/products', { method: 'POST', error });
        assert.equal(result.next, false);
        assert.equal(result.res.statusCode, error instanceof DailyUsageError ? 403 : 503);
        assert.ok(!JSON.stringify(result.res.body).includes('SECRET'));
    }
});
test('recovery/status/release remain available, cross-outlet writes cannot use another allowance', async () => {
    for (const path of ['/usage/start', '/usage/stop', '/usage/status', '/usage/heartbeat', '/usage/initialize']) {
        const result = await run(path, { missing: true });
        assert.equal(result.next, true);
        assert.deepEqual(result.calls, []);
    }
    assert.equal((await run('/products', { method: 'POST', context: 'other' })).next, false);
    assert.equal((await run('/product-image-assignments', { method: 'POST', context: 'other' })).next, false);
    assert.equal((await run('/employees', { context: 'other' })).next, false);
    const preview = await run('/categories', { context: 'source' });
    assert.equal(preview.next, true);
    assert.equal(preview.calls[1][1], 'source');
});
//# sourceMappingURL=webUsageMiddleware.test.js.map