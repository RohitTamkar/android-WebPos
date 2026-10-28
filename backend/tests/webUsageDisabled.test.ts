import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebUsageGuard } from '../src/webUsageMiddleware.js';
import { DailyUsageError } from '../src/dailyUsage.js';
import { DAILY_WEB_USAGE_ENABLED } from '../../shared/webUsageFeature.js';

async function run(path = '/products', { missing = false, denied = false, anonymous = false, enabled }: {
  missing?: boolean; denied?: boolean; anonymous?: boolean; enabled?: boolean;
} = {}) {
  let admitted = false, accounting = 0;
  const guard = createWebUsageGuard({ ...(enabled === undefined ? {} : { enabled }),
    readToken: () => anonymous ? null : { profileDocId: 'user' }, db: () => ({} as any), assigned: () => ['outlet'],
    operate: async () => { accounting++; if (denied) throw new DailyUsageError(403, 'USAGE_LIMIT_REACHED', 'Exhausted'); return {} as any; } });
  const req: any = { path, method: 'GET', params: { outletId: 'outlet' }, header: (name: string) =>
    name === 'x-web-usage-outlet' || missing ? undefined : name === 'x-web-usage-session' ? 'session' : 'generation' };
  const res: any = { statusCode: 200, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; } };
  await guard(req, res, () => { admitted = true; });
  return { admitted, accounting, res };
}

test('the enabled compatibility indicator and old enabled:false override cannot bypass the guard', async () => {
  assert.equal(DAILY_WEB_USAGE_ENABLED, true);
  for (const enabled of [undefined, false]) {
    const denied = await run('/products', { denied: true, ...(enabled === undefined ? {} : { enabled }) });
    assert.equal(denied.admitted, false); assert.equal(denied.accounting, 1);
    assert.equal(denied.res.statusCode, 403); assert.equal(denied.res.body.code, 'USAGE_LIMIT_REACHED');
    const missing = await run('/products', { missing: true, ...(enabled === undefined ? {} : { enabled }) });
    assert.equal(missing.admitted, false); assert.equal(missing.res.statusCode, 428);
  }
});
test('valid backend admission remains required and authentication cannot be bypassed', async () => {
  assert.equal((await run()).admitted, true);
  const anonymous = await run('/products', { anonymous: true });
  assert.equal(anonymous.res.statusCode, 401); assert.equal(anonymous.accounting, 0);
});
test('authenticated lifecycle routes remain reachable with the enabled compatibility export', async () => {
  for (const action of ['initialize', 'start', 'heartbeat', 'stop', 'status']) {
    const result = await run(`/usage/${action}`, { missing: true });
    assert.equal(result.admitted, true); assert.equal(result.accounting, 0);
  }
});
