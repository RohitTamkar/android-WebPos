import assert from 'node:assert/strict';
import test from 'node:test';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { initializeOutletDailyUsage, operateOutletDailyUsage, resolveUsageTimeZone } from '../src/dailyUsage.js';

const instant = (value: string) => Timestamp.fromDate(new Date(value));
const start = instant('2026-10-19T10:00:00Z');
const usagePath = 'OUTLET/actual-document/SESSION/dailyUsage';
const assigned = (profile: Record<string, unknown>) => Array.isArray(profile.outlets) ? profile.outlets as string[] : [];
const state = (date = '2026-10-19') => ({ date, timeZone: 'Asia/Kolkata', limitSeconds: 1800,
  usedSeconds: 450.125, settledAt: instant(`${date}T09:00:00Z`), updatedAt: instant(`${date}T09:00:00Z`),
  generation: 'existing-period', version: 1, sessions: { existing: { expiresAt: start, lastSequence: 3 } } });
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['actual-document'] }],
    ['OUTLET/actual-document', { id: 'different-stored-id', active: true, name: 'Outlet', country: { timezone: 'Asia/Kolkata', currency: 'INR' },
      branch: 'Pune', businessId: null, createdDate: 1777473132607, demo: false, eraseOutlet: false, multiCounter: false,
      renewalDate: 1841035157000, restaurant_id: 0, stability: 0, subscriptionView: false, userId: '' }],
  ]);
  const writes: unknown[] = [], reads: string[] = [];
  let now = start, fail = false;
  let retry: (() => void) | undefined;
  let queue = Promise.resolve();
  const reference = (path: string): any => ({ path, collection: (name: string) => {
    assert.equal(`${path}/${name}`, 'OUTLET/actual-document/SESSION');
    return { doc: (id: string) => reference(`${path}/${name}/${id}`) };
  } });
  const db = { collection: (collection: string) => {
    assert.ok(['OUTLET', 'USER_PROFILE'].includes(collection), 'No unrelated root collection');
    return { doc: (id: string) => reference(`${collection}/${id}`) };
  }, runTransaction: (callback: any) => {
    const operation = queue.then(async () => {
      let pending: { path: string; patch: Record<string, any> }[] = [];
      const transaction = { get: async (ref: { path: string }) => {
        assert.equal(pending.length, 0); reads.push(ref.path);
        return { data: () => records.get(ref.path) };
      }, set: (ref: { path: string }, patch: Record<string, any>) => {
        assert.equal(ref.path, usagePath, 'Every usage write targets only the stable SESSION document');
        pending.push({ path: ref.path, patch });
      } };
      let result = await callback(transaction);
      if (retry) { const conflict = retry; retry = undefined; pending = []; conflict(); result = await callback(transaction); }
      if (fail) throw new Error('SIMULATED COMMIT FAILURE');
      for (const { path, patch } of pending) {
        assert.equal(path, usagePath);
        assert.ok(FieldValue.serverTimestamp().isEqual(patch.updatedAt));
        const saved = { ...patch, updatedAt: now };
        records.set(path, saved); writes.push(saved);
      }
      return result;
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  } } as unknown as Firestore;
  return { records, writes, reads, outlet: () => records.get('OUTLET/actual-document')!,
    usage: () => records.get(usagePath)!, setUsage: (value: unknown) => records.set(usagePath, value as Record<string, unknown>),
    initialize: (raw: unknown = {}, user: string | null = 'user', id = 'actual-document') =>
      initializeOutletDailyUsage(db, id, user, assigned, raw, () => now),
    operate: (raw: unknown, user: string | null = 'user') => operateOutletDailyUsage(db, 'actual-document', user, assigned, raw, () => now),
    time: (value: string) => { now = instant(value); }, fail: () => { fail = true; }, conflict: (fn: () => void) => { retry = fn; } };
}

test('creates SESSION/dailyUsage using the actual outlet document ID and preserves the entire outlet', async () => {
  const f = fixture(); const before = { ...f.outlet() }; const result = await f.initialize();
  assert.deepEqual(result, { outletId: 'actual-document', initialized: true, reset: false, date: '2026-10-19', timeZone: 'Asia/Kolkata', limitSeconds: 1800, usedSeconds: 0 });
  assert.deepEqual(f.outlet(), before);
  assert.ok(!('dailyUsage' in f.outlet()));
  const usage = f.usage() as ReturnType<typeof state>;
  assert.equal(usage.usedSeconds, 0); assert.equal(usage.version, 1); assert.ok(usage.generation); assert.deepEqual(usage.sessions, {});
  assert.ok(usage.settledAt.isEqual(start)); assert.ok(usage.updatedAt.isEqual(start)); assert.equal(f.writes.length, 1);
});
test('same-day initialization, refresh and relogin preserve counters, timestamps, generation and sessions without writing', async () => {
  const f = fixture(); const existing = state(); f.setUsage(existing);
  for (let i = 0; i < 3; i++) assert.equal((await f.initialize()).usedSeconds, 450.125);
  assert.equal(f.usage(), existing); assert.deepEqual(f.writes, []);
});
test('new local day resets the map, rotates generation, clears sessions and retains no history', async () => {
  const f = fixture(); f.setUsage(state('2026-10-18'));
  const result = await f.initialize(); const usage = f.usage() as ReturnType<typeof state>;
  assert.equal(result.reset, true); assert.equal(usage.usedSeconds, 0); assert.notEqual(usage.generation, 'existing-period');
  assert.deepEqual(usage.sessions, {}); assert.ok(!JSON.stringify(usage).includes('2026-10-18'));
});
test('midnight follows each outlet timezone rather than UTC or browser time', async () => {
  for (const [zone, time, expected] of [['Asia/Kolkata', '2026-10-18T18:30:00Z', '2026-10-19'],
    ['America/New_York', '2026-10-19T02:00:00Z', '2026-10-18']]) {
    const f = fixture(); f.outlet().country = { timezone: zone }; f.time(time!);
    assert.equal((await f.initialize()).date, expected);
  }
});
test('an explicitly invalid outlet timezone fails without touching outlet data', async () => {
  for (const country of [{ timezone: 'invalid/zone' }, { timezone: '+05:30' }, { timezone: 123 }]) {
    const f = fixture(); f.outlet().country = country; const before = { ...f.outlet() };
    await assert.rejects(f.initialize(), { status: 422 }); assert.deepEqual(f.outlet(), before); assert.deepEqual(f.writes, []);
  }
});
test('missing country/timezone uses the actual server timezone and preserves existing country fields', async () => {
  for (const country of [undefined, null, 'India', {}, { timezone: '' }, { timezone: null }]) {
    const f = fixture(); f.outlet().country = country; const before = { ...f.outlet() };
    const result = await f.initialize();
    assert.equal(result.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.deepEqual(f.outlet(), before);
    assert.equal(f.usage().usedSeconds, 0);
  }
});
test('timezone resolution prefers the outlet, supports server fallback, and fails closed for a broken server zone', () => {
  assert.equal(resolveUsageTimeZone({ timezone: 'America/New_York' }, () => 'Asia/Kolkata'), 'America/New_York');
  assert.equal(resolveUsageTimeZone(undefined, () => 'Asia/Kolkata'), 'Asia/Kolkata');
  assert.equal(resolveUsageTimeZone({}, () => 'UTC'), 'UTC');
  assert.throws(() => resolveUsageTimeZone({}, () => 'bad/zone'), { status: 503 });
  assert.throws(() => resolveUsageTimeZone({ timezone: 'bad/zone' }, () => 'UTC'), { status: 422 });
});
test('exhausted current-day allowance is never reset; initialization does not grant a login', async () => {
  const f = fixture(); f.setUsage({ ...state(), usedSeconds: 1800 });
  assert.equal((await f.initialize()).usedSeconds, 1800); assert.deepEqual(f.writes, []);
});
test('malformed, future, unsupported and timezone-changed periods are preserved for review', async () => {
  for (const existing of [null, {}, { ...state(), usedSeconds: -1 }, { ...state(), version: 2 }, state('2026-10-20'),
    { ...state(), date: '2026-02-30' }, { ...state(), timeZone: 'America/New_York' },
    { ...state(), sessions: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, {}])) }]) {
    const f = fixture(); f.setUsage(existing);
    await assert.rejects(f.initialize(), { status: 409 }); assert.equal(f.usage(), existing); assert.deepEqual(f.writes, []);
  }
});
test('concurrent initializers commit one period, and retries preserve newly recorded usage', async () => {
  const f = fixture(); const results = await Promise.all([f.initialize(), f.initialize()]);
  assert.equal(results.filter(result => result.initialized).length, 1); assert.equal(f.writes.length, 1);
  const g = fixture(); g.conflict(() => { g.setUsage(state()); });
  assert.equal((await g.initialize()).usedSeconds, 450.125); assert.deepEqual(g.writes, []);
});
test('transaction retries crossing midnight recalculate the accounting date', async () => {
  const f = fixture(); f.time('2026-10-18T18:29:59Z');
  f.conflict(() => f.time('2026-10-18T18:30:01Z'));
  assert.equal((await f.initialize()).date, '2026-10-19'); assert.equal(f.writes.length, 1);
});
test('commit failures return no success and leave records untouched', async () => {
  const f = fixture(); const before = { ...f.outlet() }; f.fail();
  await assert.rejects(f.initialize(), /SIMULATED COMMIT FAILURE/); assert.deepEqual(f.outlet(), before); assert.deepEqual(f.writes, []);
});
test('rejects forged input, unauthorized users, missing outlets and inactive profiles/outlets', async () => {
  for (const raw of [{ usedSeconds: 0 }, { date: '2026-10-01' }, { profileDocId: 'other' }, { timeZone: 'UTC' }]) {
    const f = fixture(); await assert.rejects(f.initialize(raw), { status: 422 }); assert.deepEqual(f.reads, []);
  }
  const f = fixture(); await assert.rejects(f.initialize({}, null), { status: 401 });
  await assert.rejects(f.initialize({}, 'user', '../bad'), { status: 400 }); assert.deepEqual(f.reads, []);
  for (const profile of [{ active: false, outlets: ['actual-document'] }, { active: true, outlets: ['other'] }]) {
    const g = fixture(); g.records.set('USER_PROFILE/user', profile);
    await assert.rejects(g.initialize(), { status: 403 }); assert.deepEqual(g.writes, []);
  }
  const missing = fixture(); missing.records.delete('OUTLET/actual-document'); await assert.rejects(missing.initialize(), { status: 404 });
  const inactive = fixture(); inactive.outlet().active = false; await assert.rejects(inactive.initialize(), { status: 403 });
});

const requestId = '00000000-0000-4000-8000-000000000001';
const startSession = (f: ReturnType<typeof fixture>, id = requestId, user = 'user') => f.operate({ action: 'start', requestId: id }, user) as Promise<any>;
const lifecycle = (session: any, action: 'heartbeat' | 'stop' | 'check', sequence = session.sequence + (action === 'heartbeat' ? 1 : 0)) =>
  ({ action, sessionId: session.sessionId, generation: session.generation, ...(action === 'check' ? {} : { sequence }) });

test('entry starts a bounded lease; heartbeat settles elapsed time; checks do not renew leases', async () => {
  const f = fixture(); const s = await startSession(f);
  assert.equal(s.usedSeconds, 0); assert.equal(s.expiresAt, start.toMillis() + 30_000);
  f.time('2026-10-19T10:00:10Z'); const hb: any = await f.operate(lifecycle(s, 'heartbeat'));
  assert.equal(hb.usedSeconds, 10); assert.equal(hb.expiresAt, start.toMillis() + 40_000);
  f.time('2026-10-19T10:00:20Z'); await f.operate(lifecycle(hb, 'check'));
  const saved: any = f.usage(); assert.equal(saved.usedSeconds, 20);
  assert.equal(saved.sessions[s.sessionId].expiresAt.toMillis(), start.toMillis() + 40_000);
});
test('logout pauses accounting; subsequent entry resumes accumulated usage', async () => {
  const f = fixture(); const s = await startSession(f); f.time('2026-10-19T10:00:12Z');
  await f.operate(lifecycle(s, 'stop')); f.time('2026-10-19T11:00:00Z');
  const resumed = await startSession(f); assert.equal(resumed.usedSeconds, 12);
  assert.equal(Object.keys((f.usage() as any).sessions).length, 1);
});
test('refresh uses the same session; delayed pre-refresh stop cannot delete its renewed lease', async () => {
  const f = fixture(); const first = await startSession(f); f.time('2026-10-19T10:00:05Z');
  const restored = await startSession(f); assert.equal(first.sessionId, restored.sessionId); assert.equal(restored.usedSeconds, 5);
  assert.equal(Object.keys((f.usage() as any).sessions).length, 1);
  await assert.rejects(f.operate(lifecycle(first, 'stop')), { code: 'USAGE_STALE_HEARTBEAT' });
  await f.operate(lifecycle(restored, 'check'));
});
test('concurrent employees consume the union of active intervals, never their sum', async () => {
  const f = fixture(); f.records.set('USER_PROFILE/second', { active: true, outlets: ['actual-document'] });
  const a = await startSession(f); f.time('2026-10-19T10:00:05Z');
  const b = await startSession(f, '00000000-0000-4000-8000-000000000002', 'second');
  f.time('2026-10-19T10:00:15Z');
  await Promise.all([f.operate(lifecycle(a, 'heartbeat')), f.operate(lifecycle(b, 'heartbeat'), 'second')]);
  assert.equal((f.usage() as any).usedSeconds, 15);
});
test('closed browsers/network loss stop consuming at lease expiry; stale heartbeats cannot reactivate', async () => {
  const f = fixture(); const s = await startSession(f); f.time('2026-10-19T11:00:00Z');
  await assert.rejects(f.operate(lifecycle(s, 'heartbeat')), { code: 'USAGE_SESSION_EXPIRED' });
  assert.equal((f.usage() as any).usedSeconds, 30);
  assert.deepEqual((f.usage() as any).sessions, {});
});
test('exhaustion is persisted and blocks both new entries and existing protected operations', async () => {
  const f = fixture(); const s = await startSession(f);
  (f.usage() as any).usedSeconds = 1790;
  f.time('2026-10-19T10:00:10Z');
  await assert.rejects(f.operate(lifecycle(s, 'check')), { status: 403, code: 'USAGE_LIMIT_REACHED' });
  assert.equal((f.usage() as any).usedSeconds, 1800);
  await assert.rejects(startSession(f), { status: 403, code: 'USAGE_LIMIT_REACHED' });
  await f.operate(lifecycle(s, 'stop'));
});
test('new-day entry resets usage and rejects old-day heartbeat credentials', async () => {
  const f = fixture(); f.time('2026-10-19T18:29:50Z'); const yesterday = await startSession(f);
  f.time('2026-10-19T18:30:01Z');
  await assert.rejects(f.operate(lifecycle(yesterday, 'heartbeat')), { code: 'USAGE_SESSION_REQUIRED' });
  const today = await startSession(f); assert.equal(today.date, '2026-10-20'); assert.equal(today.usedSeconds, 0);
  assert.notEqual(today.generation, yesterday.generation);
});
test('duplicate heartbeat, foreign session and client counters never renew or forge usage', async () => {
  const f = fixture(); const s = await startSession(f);
  await f.operate(lifecycle(s, 'heartbeat'));
  await assert.rejects(f.operate(lifecycle(s, 'heartbeat')), { code: 'USAGE_STALE_HEARTBEAT' });
  await assert.rejects(f.operate({ action: 'start', requestId, usedSeconds: 0 }), { status: 422 });
  f.records.set('USER_PROFILE/second', { active: true, outlets: ['actual-document'] });
  await assert.rejects(f.operate(lifecycle(s, 'check'), 'second'), { code: 'USAGE_SESSION_REQUIRED' });
});
test('accounting commit failure cannot grant access or modify the outlet', async () => {
  const f = fixture(); const before = { ...f.outlet() }; f.fail(); await assert.rejects(startSession(f));
  assert.deepEqual(f.outlet(), before); assert.deepEqual(f.writes, []);
});

test('active session metadata remains bounded in the single SESSION document', async () => {
  const f = fixture();
  f.setUsage({ ...state(), usedSeconds: 0, settledAt: start, generation: '00000000-0000-4000-8000-000000000002',
    sessions: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i.toString(16).padStart(64, '0'),
      { profileDocId: 'user', expiresAt: Timestamp.fromMillis(start.toMillis() + 30000), lastSequence: 0 }])) });
  await assert.rejects(startSession(f), { status: 429, code: 'USAGE_SESSION_CAPACITY' });
  assert.equal(Object.keys((f.usage() as any).sessions).length, 100);
});

test('server timezone fallback preserves the current allowance on repeated initialization', async () => {
  const f = fixture(); delete f.outlet().country;
  await f.initialize(); const usage = f.usage() as any; usage.usedSeconds = 120;
  const generation = usage.generation, writes = f.writes.length;
  const resumed = await f.initialize(); assert.equal(resumed.usedSeconds, 120); assert.equal(resumed.initialized, false);
  assert.equal((f.usage() as any).generation, generation); assert.equal(f.writes.length, writes);
  assert.ok(!('country' in f.outlet()));
});

test('first start creates a complete accounting document and lease, without outlet or unrelated writes', async () => {
  const f = fixture();
  f.records.set('OUTLET/actual-document/PRODUCT/p', { name: 'Preserve product' });
  f.records.set('OUTLET/actual-document/SESSION/unrelated', { keep: true });
  const before = new Map(f.records);
  const session = await startSession(f);
  assert.equal(f.records.size, before.size + 1);
  for (const [path, record] of before) assert.deepEqual(f.records.get(path), record);
  const usage = f.usage();
  assert.deepEqual(Object.keys(usage).sort(), ['date', 'timeZone', 'limitSeconds', 'usedSeconds', 'settledAt', 'updatedAt', 'generation', 'version', 'sessions'].sort());
  assert.deepEqual(Object.keys(usage.sessions as object), [session.sessionId]);
  assert.equal(usage.limitSeconds, 1800);
  assert.equal(session.expiresAt - start.toMillis(), 30_000);
});

test('legacy-only usage blocks initialization and lifecycle writes without copying or resetting data', async () => {
  for (const legacy of [state(), { ...state(), usedSeconds: 1800 }, state('2026-10-18'), null, {}]) {
    const f = fixture(); f.outlet().dailyUsage = legacy;
    const before = new Map(f.records);
    await assert.rejects(f.initialize(), { status: 409, code: 'USAGE_LEGACY_REVIEW_REQUIRED' });
    await assert.rejects(startSession(f), { status: 409, code: 'USAGE_LEGACY_REVIEW_REQUIRED' });
    await assert.rejects(f.operate({ action: 'status' }), { status: 409, code: 'USAGE_LEGACY_REVIEW_REQUIRED' });
    assert.deepEqual(f.records, before);
    assert.equal(f.outlet().dailyUsage, legacy);
    assert.ok(!f.records.has(usagePath));
    assert.deepEqual(f.writes, []);
  }
});

test('an existing SESSION document stays authoritative while stale legacy usage is left untouched', async () => {
  const f = fixture(); const first = await startSession(f);
  const legacy = { ...state(), usedSeconds: 1800 }; f.outlet().dailyUsage = legacy;
  const outletBefore = { ...f.outlet() };
  f.time('2026-10-19T10:00:10Z');
  const renewed: any = await f.operate(lifecycle(first, 'heartbeat'));
  assert.equal(renewed.usedSeconds, 10);
  assert.equal(renewed.generation, first.generation);
  assert.deepEqual(f.outlet(), outletBefore);
  assert.equal(f.outlet().dailyUsage, legacy);
  const writes = f.writes.length;
  assert.equal((await f.initialize()).usedSeconds, 10);
  assert.equal(f.writes.length, writes);
});

test('a concurrent legacy write prevents creating a fresh SESSION allowance on transaction retry', async () => {
  const f = fixture(); const legacy = state();
  f.conflict(() => { f.outlet().dailyUsage = legacy; });
  await assert.rejects(startSession(f), { status: 409, code: 'USAGE_LEGACY_REVIEW_REQUIRED' });
  assert.equal(f.outlet().dailyUsage, legacy);
  assert.ok(!f.records.has(usagePath)); assert.deepEqual(f.writes, []);
});
