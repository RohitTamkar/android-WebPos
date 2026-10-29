import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { operateOutletDailyUsage, checkOutletDailyUsageAllowance } from '../src/dailyUsage.js';
import { createWebUsageGuard } from '../src/webUsageMiddleware.js';
import { DAILY_WEB_USAGE_ENABLED } from '../../shared/webUsageFeature.js';
const now = Timestamp.fromDate(new Date('2026-10-28T10:00:00Z'));
const generation = '00000000-0000-4000-8000-000000000001';
const sessionId = 'a'.repeat(64);
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
function fixture(sourceExempt: boolean, targetExempt: boolean) {
  const records = new Map<string, any>([
    ['USER_PROFILE/user', { active: true, outlets: ['source', 'target'] }],
    ['OUTLET/source', { active: true, eraseOutlet: sourceExempt, country: { timezone: 'Asia/Kolkata' } }],
    ['OUTLET/target', { active: true, eraseOutlet: targetExempt, country: { timezone: 'Asia/Kolkata' } }],
  ]);
  for (const outlet of ['source', 'target']) records.set(`OUTLET/${outlet}/SESSION/dailyUsage`, {
    date: '2026-10-28', timeZone: 'Asia/Kolkata', limitSeconds: 1800, usedSeconds: 1800,
    settledAt: now, updatedAt: now, version: 1, generation,
    sessions: { [sessionId]: { profileDocId: 'user', lastSequence: 0, expiresAt: Timestamp.fromMillis(now.toMillis() + 30000) } },
  });
  const ref = (path: string): any => ({ path, collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`) });
  const db = { collection: (name: string) => ref(name), runTransaction: async (work: any) => {
    const writes: [string, any][] = [];
    const get = async (reference: any) => { assert.equal(writes.length, 0); return { data: () => records.get(reference.path) }; };
    const result = await work({ get, getAll: (...references: any[]) => Promise.all(references.map(get)),
      set: (reference: any, value: any) => writes.push([reference.path, value]) });
    for (const [path, value] of writes) records.set(path, { ...value, updatedAt: now });
    return result;
  } } as unknown as Firestore;
  const guard = createWebUsageGuard({ enabled: false, db: () => db, assigned, readToken: () => ({ profileDocId: 'user' }),
    operate: (database, outletId, user, assignments, body) => operateOutletDailyUsage(database, outletId, user, assignments, body, () => now),
    checkAllowance: (database, outletId, user, assignments) => checkOutletDailyUsageAllowance(database, outletId, user, assignments, () => now) });
  return { records, db, async request(target: string, context: string, path = '/products', method = 'GET', omitSession = false) {
    let next = false;
    const req: any = { path, method, params: { outletId: target }, header: (name: string) => name === 'x-web-usage-outlet' ? context
      : omitSession ? undefined : name === 'x-web-usage-session' ? sessionId : name === 'x-web-usage-generation' ? generation : undefined };
    const res: any = { statusCode: 200, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; } };
    await guard(req, res, () => { next = true; }); return { next, res };
  } };
}

test('with the compatibility flag enabled, each outlet applies its own authoritative Boolean policy', async () => {
  assert.equal(DAILY_WEB_USAGE_ENABLED, true);
  const f = fixture(true, false);
  assert.equal((await f.request('source', 'source')).next, true);
  const limited = await f.request('target', 'target');
  assert.equal(limited.next, false); assert.equal(limited.res.body.code, 'USAGE_LIMIT_REACHED');
  assert.equal(f.records.get('OUTLET/target/SESSION/dailyUsage').usedSeconds, 1800);
});
test('an exempt source cannot bypass the exhausted destination through preview headers or direct requests', async () => {
  const f = fixture(true, false);
  for (const path of ['/products', '/categories']) {
    const result = await f.request('target', 'source', path);
    assert.equal(result.next, false); assert.equal(result.res.statusCode, 403); assert.equal(result.res.body.code, 'USAGE_LIMIT_REACHED');
  }
  assert.equal((await f.request('target', 'source', '/products', 'POST')).res.body.code, 'USAGE_OUTLET_MISMATCH');
  assert.equal((await f.request('target', 'target', '/products', 'GET', true)).res.statusCode, 428);
  f.records.get('OUTLET/target').eraseOutlet = true;
  assert.equal((await f.request('target', 'source')).next, true);
  assert.equal(f.records.get('OUTLET/target/SESSION/dailyUsage').usedSeconds, 1800);
});
test('preview reads preserve source accounting and destination authorization without opening another lease', async () => {
  const f = fixture(true, false);
  f.records.get('OUTLET/target/SESSION/dailyUsage').usedSeconds = 120;
  const leases = Object.keys(f.records.get('OUTLET/target/SESSION/dailyUsage').sessions);
  assert.equal((await f.request('target', 'source')).next, true);
  assert.deepEqual(Object.keys(f.records.get('OUTLET/target/SESSION/dailyUsage').sessions), leases);
  f.records.get('USER_PROFILE/user').outlets = ['source'];
  assert.equal((await f.request('target', 'source')).res.statusCode, 403);
  f.records.get('USER_PROFILE/user').outlets = ['source', 'target'];
  f.records.get('OUTLET/target').active = false;
  assert.equal((await f.request('target', 'source')).res.statusCode, 403);
});
