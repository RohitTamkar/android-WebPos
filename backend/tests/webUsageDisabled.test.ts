import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { createWebUsageGuard } from '../src/webUsageMiddleware.js';

function fixture({ anonymous = false, active = true, foreign = false, outletActive = true, missing = false, failed = false } = {}) {
  const reads: string[] = []; let next = false, accounting = 0;
  const records: Record<string, unknown> = {
    'USER_PROFILE/user': { active, outlets: foreign ? ['other'] : ['outlet'] },
    'OUTLET/outlet': { active: outletActive, dailyUsage: { usedSeconds: 1800, limitSeconds: 1800 } },
  };
  const db = { collection: (collection: string) => ({ doc: (id: string) => ({ get: async () => {
    const key = `${collection}/${id}`; reads.push(key);
    if (failed) throw new Error('PRIVATE DATABASE DETAIL');
    return { exists: !(missing && collection === 'OUTLET'), data: () => structuredClone(records[key]) };
  } }) }) } as unknown as Firestore;
  const guard = createWebUsageGuard({ readToken: () => anonymous ? null : { profileDocId: 'user' }, db: () => db,
    assigned: profile => profile.outlets as string[], operate: async () => { accounting++; throw new Error('Accounting must stay disabled'); } });
  return { reads, async run(path = '/products', method = 'GET') {
    const req: any = { path, method, params: { outletId: 'outlet' }, header: () => undefined };
    const res: any = { statusCode: 200, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; } };
    await guard(req, res, () => { next = true; }); return { next, accounting, res };
  } };
}
test('disabled default ignores usage totals and requires no usage headers, while retaining account and outlet checks', async () => {
  for (const [path, method] of [['/dashboard', 'GET'], ['/products', 'GET'], ['/products/p/image', 'PUT'], ['/product-image-assignments', 'POST']] as const) {
    const f = fixture(); const result = await f.run(path, method);
    assert.equal(result.next, true); assert.equal(result.accounting, 0);
    assert.deepEqual(f.reads, ['USER_PROFILE/user', 'OUTLET/outlet']);
  }
});
test('disabled accounting does not disable authentication, account activity or outlet authorization', async () => {
  for (const [options, status] of [[{ anonymous: true }, 401], [{ active: false }, 403], [{ foreign: true }, 403],
    [{ outletActive: false }, 403], [{ missing: true }, 404], [{ failed: true }, 503]] as const) {
    const result = await fixture(options).run();
    assert.equal(result.next, false); assert.equal(result.res.statusCode, status); assert.equal(result.accounting, 0);
    assert.ok(!JSON.stringify(result.res.body).includes('PRIVATE'));
  }
});
test('direct lifecycle calls cannot initialize, renew, stop or update counters while disabled', async () => {
  for (const action of ['initialize', 'start', 'heartbeat', 'stop', 'status', 'unknown']) {
    const f = fixture(); const result = await f.run(`/usage/${action}`, 'POST');
    assert.equal(result.next, false); assert.equal(result.res.statusCode, 503);
    assert.equal(result.res.body.code, 'USAGE_DISABLED'); assert.equal(result.accounting, 0); assert.deepEqual(f.reads, []);
  }
});
