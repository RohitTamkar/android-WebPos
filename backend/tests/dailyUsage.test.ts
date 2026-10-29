import assert from 'node:assert/strict';
import test from 'node:test';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { initializeOutletDailyUsage, operateOutletDailyUsage, resolveUsageTimeZone } from '../src/dailyUsage.js';
import { createWebUsageGuard } from '../src/webUsageMiddleware.js';
import { DAILY_WEB_USAGE_ENABLED } from '../../shared/webUsageFeature.js';

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
      const get = async (ref: { path: string }) => {
        assert.equal(pending.length, 0); reads.push(ref.path);
        return { data: () => records.get(ref.path) };
      };
      const transaction = { get, getAll: (...refs: { path: string }[]) => Promise.all(refs.map(get)), set: (ref: { path: string }, patch: Record<string, any>) => {
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
  return { db, records, writes, reads, outlet: () => records.get('OUTLET/actual-document')!,
    usage: () => records.get(usagePath)!, setUsage: (value: unknown) => records.set(usagePath, value as Record<string, unknown>),
    initialize: (raw: unknown = {}, user: string | null = 'user', id = 'actual-document') =>
      initializeOutletDailyUsage(db, id, user, assigned, raw, () => now),
    operate: (raw: unknown, user: string | null = 'user', options: { readOnly?: boolean } = {}) => operateOutletDailyUsage(db, 'actual-document', user, assigned, raw, () => now, options),
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

test('authoritative policy is response metadata only, with unchanged accounting fields and write counts', async () => {
  for (const eraseOutlet of [true, false]) {
    const f = fixture(); f.outlet().eraseOutlet = eraseOutlet;
    const before = { ...f.outlet() };
    let session = await startSession(f);
    assert.equal(session.dailyLimitApplies, !eraseOutlet);
    assert.equal(f.writes.length, 1);
    f.time('2026-10-19T10:00:10Z'); session = await f.operate(lifecycle(session, 'heartbeat'));
    assert.equal(session.dailyLimitApplies, !eraseOutlet);
    assert.equal(f.writes.length, 2);
    await f.operate(lifecycle(session, 'stop'));
    assert.equal(f.writes.length, 3);
    assert.deepEqual(f.outlet(), before);
    assert.deepEqual(Object.keys(f.usage()).sort(), ['date', 'timeZone', 'limitSeconds', 'usedSeconds', 'settledAt', 'updatedAt', 'generation', 'version', 'sessions'].sort());
    assert.ok(!JSON.stringify(f.usage()).includes('dailyLimitApplies'));
    f.usage().usedSeconds = 1800;
    if (eraseOutlet) assert.equal((await startSession(f)).dailyLimitApplies, false);
    else await assert.rejects(startSession(f), { status: 403, code: 'USAGE_LIMIT_REACHED', dailyLimitApplies: true });
  }
});

test('ten active minutes, logout and relogin retain twenty minutes; final exhaustion and repeated cleanup never reset or double count', async () => {
  const f = fixture(); let session = await startSession(f);
  const generation = session.generation;
  const at = (seconds: number) => f.time(new Date(start.toMillis() + seconds * 1000).toISOString());
  await f.operate(lifecycle(session, 'stop'));
  assert.equal(f.usage().usedSeconds, 0, 'Immediate logout consumes no time');
  session = await startSession(f);
  for (let seconds = 20; seconds < 600; seconds += 20) {
    at(seconds); session = await f.operate(lifecycle(session, 'heartbeat'));
  }
  at(600);
  const stopped = await f.operate(lifecycle(session, 'stop'));
  assert.equal(stopped.usedSeconds, 600, 'Stop commits the final elapsed interval');
  assert.deepEqual(f.usage().sessions, {});
  await assert.rejects(f.operate(lifecycle(session, 'stop')), { code: 'USAGE_SESSION_REQUIRED' });
  assert.equal(f.usage().usedSeconds, 600, 'Duplicate stop cannot count the interval again');
  at(3600); session = await startSession(f);
  assert.equal(session.remainingSeconds, 1200, 'Logged-out time is not consumed');
  session = await startSession(f);
  assert.equal(session.remainingSeconds, 1200, 'Refresh and repeated admission preserve the balance');
  assert.equal(session.generation, generation);
  for (let seconds = 3620; seconds < 4800; seconds += 20) {
    at(seconds); session = await f.operate(lifecycle(session, 'heartbeat'));
  }
  at(4800);
  await assert.rejects(f.operate(lifecycle(session, 'heartbeat')), { code: 'USAGE_LIMIT_REACHED' });
  await assert.rejects(f.operate(lifecycle(session, 'check')), { code: 'USAGE_LIMIT_REACHED' });
  await assert.rejects(startSession(f), { code: 'USAGE_LIMIT_REACHED' });
  // Exhaustion prunes expired leases; a delayed stop safely reports it gone.
  await assert.rejects(f.operate(lifecycle(session, 'stop')), { code: 'USAGE_SESSION_REQUIRED' });
  assert.equal(f.usage().usedSeconds, 1800);
  assert.deepEqual(f.usage().sessions, {});
});

test('eraseOutlet true starts and renews valid leases below and at the cap, and permits more than 30 minutes', async () => {
  for (const initialUsage of [0, 1790, 1800]) {
    const f = fixture(); f.outlet().eraseOutlet = true;
    f.setUsage({ ...state(), usedSeconds: initialUsage, settledAt: start, updatedAt: start, generation: requestId, sessions: {} });
    const before = { ...f.outlet() };
    let session = await startSession(f);
    assert.equal(session.usedSeconds, initialUsage);
    assert.equal(session.expiresAt, start.toMillis() + 30_000);
    for (let elapsed = 20; elapsed <= 1840; elapsed += 20) {
      f.time(new Date(start.toMillis() + elapsed * 1000).toISOString());
      session = await f.operate(lifecycle(session, 'heartbeat'));
      assert.equal(session.usedSeconds, Math.min(1800, initialUsage + elapsed));
      assert.equal(session.expiresAt, start.toMillis() + (elapsed + 30) * 1000);
      await f.operate(lifecycle(session, 'check'));
    }
    const restarted = await startSession(f, '00000000-0000-4000-8000-000000000002');
    assert.equal(restarted.usedSeconds, 1800);
    assert.equal(restarted.expiresAt, start.toMillis() + 1870_000);
    assert.deepEqual(f.outlet(), before);
    assert.deepEqual(Object.keys(f.usage()).sort(), ['date', 'timeZone', 'limitSeconds', 'usedSeconds', 'settledAt', 'updatedAt', 'generation', 'version', 'sessions'].sort());
  }
});

test('eraseOutlet false retains short near-limit leases and denies checks, starts and renewals at exhaustion', async () => {
  const f = fixture();
  f.setUsage({ ...state(), usedSeconds: 1790, settledAt: start, updatedAt: start, generation: requestId, sessions: {} });
  const session = await startSession(f);
  assert.equal(f.outlet().eraseOutlet, false);
  assert.equal(session.expiresAt, start.toMillis() + 10_000);
  f.time(new Date(start.toMillis() + 9999).toISOString());
  await f.operate(lifecycle(session, 'check'));
  assert.equal(f.usage().usedSeconds, 1799.999);
  f.time(new Date(start.toMillis() + 10_000).toISOString());
  for (const action of ['check', 'heartbeat'] as const) {
    await assert.rejects(f.operate(lifecycle(session, action)), { status: 403, code: 'USAGE_LIMIT_REACHED' });
  }
  await assert.rejects(startSession(f), { status: 403, code: 'USAGE_LIMIT_REACHED' });
  assert.equal(f.usage().usedSeconds, 1800);
});

test('Boolean flag changes preserve counters, period and leases without resetting the allowance', async () => {
  const f = fixture(); let session = await startSession(f);
  const generation = session.generation;
  f.time(new Date(start.toMillis() + 10_000).toISOString());
  await f.operate(lifecycle(session, 'check'));
  assert.equal(f.usage().usedSeconds, 10);
  for (const eraseOutlet of [true, false, true]) {
    f.outlet().eraseOutlet = eraseOutlet;
    const initialized = await f.initialize();
    assert.equal(initialized.reset, false); assert.equal(initialized.usedSeconds, 10);
    await f.operate(lifecycle(session, 'check'));
    assert.equal(f.usage().generation, generation);
    assert.equal(f.usage().usedSeconds, 10);
    assert.ok((f.usage().sessions as any)[session.sessionId]);
  }
  f.usage().usedSeconds = 1800;
  f.outlet().eraseOutlet = false;
  await assert.rejects(f.operate(lifecycle(session, 'check')), { code: 'USAGE_LIMIT_REACHED' });
  f.outlet().eraseOutlet = true;
  session = await startSession(f);
  await f.operate(lifecycle(session, 'check'));
  assert.equal(f.usage().usedSeconds, 1800); assert.equal(f.usage().generation, generation);
  assert.equal(session.expiresAt, start.toMillis() + 40_000);
});

test('exempt sessions retain authentication, ownership, expiry, concurrency and commit-failure checks', async () => {
  const f = fixture(); f.outlet().eraseOutlet = true;
  f.records.set('USER_PROFILE/second', { active: true, outlets: ['actual-document'] });
  const a = await startSession(f);
  f.time(new Date(start.toMillis() + 5000).toISOString());
  const b = await startSession(f, '00000000-0000-4000-8000-000000000002', 'second');
  f.time(new Date(start.toMillis() + 15_000).toISOString());
  await Promise.all([f.operate(lifecycle(a, 'heartbeat')), f.operate(lifecycle(b, 'heartbeat'), 'second')]);
  assert.equal(f.usage().usedSeconds, 15);
  await assert.rejects(f.operate(lifecycle(a, 'check'), 'second'), { code: 'USAGE_SESSION_REQUIRED' });
  await assert.rejects(startSession(f, requestId, null as any), { status: 401 });
  f.records.set('USER_PROFILE/foreign', { active: true, outlets: ['other'] });
  await assert.rejects(startSession(f, requestId, 'foreign'), { status: 403 });
  f.time(new Date(start.toMillis() + 46_000).toISOString());
  await assert.rejects(f.operate(lifecycle(a, 'check')), { code: 'USAGE_SESSION_EXPIRED' });
  const failed = fixture(); failed.outlet().eraseOutlet = true; failed.fail();
  await assert.rejects(startSession(failed), /SIMULATED COMMIT FAILURE/);
  assert.deepEqual(failed.writes, []);
});

test('a transaction retry observes the authoritative Boolean flag change', async () => {
  const f = fixture(); f.outlet().eraseOutlet = true;
  f.setUsage({ ...state(), usedSeconds: 1800, settledAt: start, updatedAt: start, generation: requestId, sessions: {} });
  f.conflict(() => { f.outlet().eraseOutlet = false; });
  await assert.rejects(startSession(f), { code: 'USAGE_LIMIT_REACHED' });
  assert.equal(f.usage().usedSeconds, 1800);
});

test('the existing guard enforces both Boolean policies in isolation while the compatibility indicator is enabled', async () => {
  assert.equal(DAILY_WEB_USAGE_ENABLED, true);
  for (const eraseOutlet of [true, false]) {
    const f = fixture(); f.outlet().eraseOutlet = eraseOutlet;
    const session = await startSession(f); f.usage().usedSeconds = 1800;
    const guard = createWebUsageGuard({ enabled: true, db: () => f.db, assigned, readToken: () => ({ profileDocId: 'user' }),
      operate: (db, outletId, profileId, assignments, raw) => operateOutletDailyUsage(db, outletId, profileId, assignments, raw, () => start) });
    let admitted = false;
    const req: any = { path: '/products', method: 'GET', params: { outletId: 'actual-document' }, header: (name: string) =>
      name === 'x-web-usage-session' ? session.sessionId : name === 'x-web-usage-generation' ? session.generation : undefined };
    const res: any = { statusCode: 200, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; } };
    await guard(req, res, () => { admitted = true; });
    assert.equal(admitted, eraseOutlet);
    assert.equal(res.statusCode, eraseOutlet ? 200 : 403);
    assert.equal(f.usage().usedSeconds, 1800);
  }
  assert.equal(DAILY_WEB_USAGE_ENABLED, true);
});

test('entry starts a bounded lease; heartbeat settles elapsed time; checks do not renew leases', async () => {
  const f = fixture(); const s = await startSession(f);
  assert.equal(s.usedSeconds, 0); assert.equal(s.expiresAt, start.toMillis() + 30_000);
  f.time('2026-10-19T10:00:10Z'); const hb: any = await f.operate(lifecycle(s, 'heartbeat'));
  assert.equal(hb.usedSeconds, 10); assert.equal(hb.expiresAt, start.toMillis() + 40_000);
  f.time('2026-10-19T10:00:20Z'); await f.operate(lifecycle(hb, 'check'));
  const saved: any = f.usage(); assert.equal(saved.usedSeconds, 20);
  assert.equal(saved.sessions[s.sessionId].expiresAt.toMillis(), start.toMillis() + 40_000);
});
test('read-only checks deny exactly what read-write checks deny, write nothing, and leave the settled total unchanged', async () => {
  const outcome = (operation: Promise<unknown>) => operation.then(() => 'allowed', (error: any) => [error.status, error.code]);
  const run = async (readOnly: boolean) => {
    const f = fixture(); const s = await startSession(f);
    f.time('2026-10-19T10:00:10Z'); const hb: any = await f.operate(lifecycle(s, 'heartbeat'));
    const writes = f.writes.length, before = JSON.stringify(f.usage());
    f.time('2026-10-19T10:00:15Z');
    const results = [await outcome(f.operate(lifecycle(hb, 'check'), 'user', { readOnly })),
      await outcome(f.operate({ ...lifecycle(hb, 'check'), generation: crypto.randomUUID() }, 'user', { readOnly })),
      await outcome(f.operate({ ...lifecycle(hb, 'check'), sessionId: 'f'.repeat(64) }, 'user', { readOnly })),
      await outcome(f.operate(lifecycle(hb, 'check'), 'stranger', { readOnly }))];
    if (readOnly) { assert.equal(f.writes.length, writes, 'read-only checks never write'); assert.equal(JSON.stringify(f.usage()), before); }
    f.time('2026-10-19T10:00:20Z'); const settled: any = await f.operate(lifecycle(hb, 'heartbeat'));
    f.time('2026-10-19T10:01:00Z'); results.push(await outcome(f.operate(lifecycle(settled, 'check'), 'user', { readOnly })));
    const exhausted = fixture(); const e = await startSession(exhausted);
    (exhausted.usage() as any).usedSeconds = 1799.5; exhausted.time('2026-10-19T10:00:01Z');
    results.push(await outcome(exhausted.operate(lifecycle(e, 'check'), 'user', { readOnly })));
    return { results, used: settled.usedSeconds };
  };
  const [readWrite, readOnly] = [await run(false), await run(true)];
  assert.deepEqual(readOnly, readWrite);
  assert.equal(readOnly.used, 20);
  assert.equal(readOnly.results[0], 'allowed');
  assert.ok(readOnly.results.slice(1).every(result => result !== 'allowed'), 'forged, foreign, expired and exhausted checks are denied');
  assert.deepEqual(readOnly.results.at(-1), [403, 'USAGE_LIMIT_REACHED']);
  assert.deepEqual(readOnly.results.at(-2), [428, 'USAGE_SESSION_EXPIRED']);
});
test('only check actions can skip the write; lifecycle actions always persist', async () => {
  const f = fixture(); const s = await startSession(f); const writes = f.writes.length;
  f.time('2026-10-19T10:00:10Z'); await f.operate(lifecycle(s, 'heartbeat'), 'user', { readOnly: true });
  assert.equal(f.writes.length, writes + 1); assert.equal((f.usage() as any).usedSeconds, 10);
});
test('read-only and read-write checks agree on profile, outlet, lease, generation, period and limit boundaries', async () => {
  const cases: [string, (f: ReturnType<typeof fixture>, s: any) => unknown][] = [
    ['valid lease', () => {}],
    ['inactive profile', f => { f.records.set('USER_PROFILE/user', { active: false, outlets: ['actual-document'] }); }],
    ['unassigned outlet', f => { f.records.set('USER_PROFILE/user', { active: true, outlets: [] }); }],
    ['deleted profile', f => { f.records.delete('USER_PROFILE/user'); }],
    ['inactive outlet', f => { f.outlet().active = false; }],
    ['deleted outlet', f => { f.records.delete('OUTLET/actual-document'); }],
    ['1 ms before lease expiry', f => { f.time('2026-10-19T10:00:29.999Z'); }],
    ['exactly at lease expiry', f => { f.time('2026-10-19T10:00:30Z'); }],
    ['outlet midnight rollover', f => { f.time('2026-10-19T18:30:01Z'); }],
    ['just below the limit', f => { f.usage().usedSeconds = 1799.998; f.time('2026-10-19T10:00:00.001Z'); }],
    ['exactly at the limit', f => { f.usage().usedSeconds = 1799.999; f.time('2026-10-19T10:00:00.001Z'); }],
    ['exempt outlet past the limit', f => { f.outlet().eraseOutlet = true; f.usage().usedSeconds = 1800; f.time('2026-10-19T10:00:10Z'); }],
    ['damaged accounting', f => { f.usage().usedSeconds = -1; }],
    ['timezone changed', f => { f.outlet().country = { timezone: 'UTC' }; }],
    ['another employee lease', async (f, s) => {
      f.records.set('USER_PROFILE/other', { active: true, outlets: ['actual-document'] });
      await startSession(f, '00000000-0000-4000-8000-000000000009', 'other'); return { user: 'other', session: s };
    }],
    ['released lease', async (f, s) => { await f.operate(lifecycle(s, 'stop')); }],
  ];
  for (const [name, arrange] of cases) {
    const outcomes: unknown[] = [];
    for (const readOnly of [false, true]) {
      const f = fixture(); const s = await startSession(f);
      const custom = await arrange(f, s) as { user: string } | undefined;
      const writes = f.writes.length, stored = JSON.stringify(f.usage());
      outcomes.push(await f.operate(lifecycle(s, 'check'), custom?.user ?? 'user', { readOnly })
        .then(() => 'allowed', (error: any) => [error.status, error.code ?? null]));
      if (readOnly) { assert.equal(f.writes.length, writes, `${name}: no write`); assert.equal(JSON.stringify(f.usage()), stored, `${name}: stored usage unchanged`); }
    }
    assert.deepEqual(outcomes[1], outcomes[0], `${name}: same outcome in both modes`);
    assert.equal(outcomes[0] === 'allowed', ['valid lease', '1 ms before lease expiry', 'just below the limit', 'exempt outlet past the limit'].includes(name), `${name}: expected access decision`);
  }
});
test('reads cannot keep a lease alive or avoid charges: only heartbeats renew, and charged time is identical', async () => {
  const charged: number[] = [];
  for (const readOnly of [false, true]) {
    const f = fixture(); const s = await startSession(f);
    for (const at of ['10:00:05', '10:00:15', '10:00:29']) { f.time(`2026-10-19T${at}Z`); await f.operate(lifecycle(s, 'check'), 'user', { readOnly }); }
    f.time('2026-10-19T10:00:31Z');
    await assert.rejects(f.operate(lifecycle(s, 'check'), 'user', { readOnly }), { code: 'USAGE_SESSION_EXPIRED' });
    f.time('2026-10-19T10:05:00Z'); charged.push((await startSession(f)).usedSeconds);
  }
  assert.deepEqual(charged, [30, 30], 'the expired lease is charged in full, never more, in both modes');
});
test('concurrent read-only checks never lose or duplicate heartbeat and stop accounting', async () => {
  const final: unknown[] = [];
  for (const readOnly of [false, true]) {
    const f = fixture(); const s = await startSession(f);
    f.time('2026-10-19T10:00:10Z');
    const check = () => f.operate(lifecycle(s, 'check'), 'user', { readOnly });
    const [, hb] = await Promise.all([check(), f.operate(lifecycle(s, 'heartbeat')), check(), check()]) as any[];
    f.time('2026-10-19T10:00:25Z');
    const [stopped] = await Promise.all([f.operate(lifecycle(hb, 'stop')), check().catch(() => 'denied')]) as any[];
    await assert.rejects(check(), { code: 'USAGE_SESSION_REQUIRED' }, 'a stopped lease cannot be used by later reads');
    final.push([hb.sequence, stopped.usedSeconds, (f.usage() as any).usedSeconds, Object.keys((f.usage() as any).sessions).length]);
  }
  assert.deepEqual(final[1], final[0]); assert.deepEqual(final[0], [1, 25, 25, 0]);
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
