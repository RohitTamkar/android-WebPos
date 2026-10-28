import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { Timestamp } from 'firebase-admin/firestore';
import { createOutletLogoHandler } from '../src/outletLogo.js';
import { readAuthorizedOutletLogoName } from '../src/dailyUsage.js';
import { readOutletLogo } from '../src/imageStorage.js';
const sessionId = 'a'.repeat(64), generation = '22222222-2222-4222-8222-222222222222';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=', 'base64');
const assigned = (profile) => profile.outlets;
function fixture() {
    const now = Timestamp.now(), date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now.toDate());
    const records = new Map([
        ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }],
        ['OUTLET/outlet', { active: true, name: '90 DEGREES ULTIMATE FOOD STUDIO', eraseOutlet: false, country: { timezone: 'Asia/Kolkata' } }],
        ['OUTLET/outlet/SESSION/dailyUsage', { date, timeZone: 'Asia/Kolkata', limitSeconds: 1800, usedSeconds: 100,
                settledAt: now, updatedAt: now, generation, version: 1,
                sessions: { [sessionId]: { profileDocId: 'user', expiresAt: Timestamp.fromMillis(now.toMillis() + 30_000), lastSequence: 2 } } }],
    ]);
    const reads = [], objects = [];
    const mutation = () => { throw new Error('NO DATABASE OR STORAGE MUTATIONS PERMITTED'); };
    const reference = (path) => ({ path, doc: (id) => reference(`${path}/${id}`), collection: (name) => reference(`${path}/${name}`) });
    const db = { collection: (name) => reference(name), runTransaction: async (work, options) => {
            assert.deepEqual(options, { readOnly: true });
            return work({ get: async (ref) => { reads.push(ref.path); return { data: () => records.get(ref.path) }; },
                set: mutation, update: mutation, create: mutation, delete: mutation });
        }, set: mutation, batch: mutation };
    let storageError = false, invalidImage = false, nextGeneration = 3;
    const headerPath = 'images/90 DEGREES ULTIMATE FOOD STUDIO/outlet';
    const footerPath = 'images/90 DEGREES ULTIMATE FOOD STUDIO/footer/outlet';
    const store = new Map([[headerPath, { bytes: png, generation: '1' }], [footerPath, { bytes: png, generation: '2' }]]);
    const changes = [];
    const storageFailure = (code) => Object.assign(new Error('Mock Storage failure'), { code });
    const bucket = { file: (path, options) => {
            if (!objects.includes(path))
                objects.push(path);
            return { getMetadata: async () => {
                    const current = store.get(path);
                    if (storageError || !current)
                        throw storageFailure(404);
                    return [{ generation: current.generation, size: current.bytes.length }];
                }, createReadStream: (config) => {
                    assert.equal(config.validation, 'crc32c');
                    const current = store.get(path);
                    if (!current || options?.generation !== current.generation)
                        return Readable.from((async function* () { throw storageFailure(404); })());
                    return Readable.from([invalidImage ? Buffer.from('<html>invalid</html>') : current.bytes]);
                }, getSignedUrl: async (config) => {
                    assert.equal(config.action, 'read');
                    const current = store.get(path);
                    if (storageError || !current || options?.generation !== current.generation)
                        throw storageFailure(404);
                    return [`data:${invalidImage ? 'text/html' : 'image/png'};base64,${(invalidImage ? Buffer.from('<html>invalid</html>') : current.bytes).toString('base64')}`];
                }, save: async (bytes, config) => {
                    const current = store.get(path), expected = String(config.preconditionOpts.ifGenerationMatch);
                    assert.equal(config.validation, 'crc32c');
                    assert.equal(config.resumable, false);
                    if (expected !== (current?.generation ?? '0'))
                        throw storageFailure(412);
                    store.set(path, { bytes, generation: String(nextGeneration++) });
                    changes.push(`save:${path}`);
                }, delete: async (config) => {
                    assert.equal(config.ignoreNotFound, true);
                    const current = store.get(path);
                    if (!current)
                        return;
                    if (String(options?.preconditionOpts?.ifGenerationMatch) !== current.generation)
                        throw storageFailure(412);
                    store.delete(path);
                    changes.push(`delete:${path}`);
                }, copy: mutation, move: mutation, setMetadata: mutation, makePublic: mutation };
        } };
    const dependencies = { db: () => db, bucket: () => bucket, readToken: (req) => req.header('authorization') ? { profileDocId: 'user' } : null, assigned };
    const request = async (headers = {}, outletId = 'outlet', options = {}) => {
        const handler = createOutletLogoHandler(dependencies, options.action ?? 'read');
        let status = 200, body;
        const responseHeaders = {};
        const before = JSON.stringify([...records]);
        const response = { setHeader: (name, value) => { responseHeaders[name] = value; }, status: (value) => { status = value; return response; },
            send: (value) => { body = value; }, json: (value) => { body = value; } };
        await handler({ params: { outletId }, query: { name: 'ATTACKER', path: 'arbitrary/path', ...(options.variant === undefined ? {} : { variant: options.variant }) }, body: options.bytes ?? png,
            header: (name) => ({ authorization: 'Bearer mock', 'content-type': 'image/png', 'x-web-usage-outlet': 'outlet', 'x-web-usage-session': sessionId, 'x-web-usage-generation': generation, ...headers })[name] }, response, () => { throw new Error('Must never fall through into accounting middleware'); });
        assert.equal(JSON.stringify([...records]), before, 'all records remain unchanged');
        return { status, body, headers: responseHeaders };
    };
    return { db, bucket, records, reads, objects, request, now, store, changes, headerPath, footerPath, setStorageError: () => { storageError = true; }, setInvalid: () => { invalidImage = true; } };
}
test('valid existing main logo uses only the exact authorized path and has safe response headers', async () => {
    const f = fixture();
    const response = await f.request();
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, png);
    assert.deepEqual(f.objects, ['images/90 DEGREES ULTIMATE FOOD STUDIO/outlet']);
    assert.equal(response.headers['Content-Type'], 'image/png');
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(response.headers['X-Logo-Generation'], '1');
    assert.deepEqual(f.changes, []);
});
test('exact spaces are preserved and no extension or footer path is tried', async () => {
    const f = fixture();
    f.records.get('OUTLET/outlet').name = '  AC  Outlet  ';
    f.store.set('images/  AC  Outlet  /outlet', { bytes: png, generation: '1' });
    await f.request();
    assert.deepEqual(f.objects, ['images/  AC  Outlet  /outlet']);
});
test('missing/unreadable objects and invalid images never return success or mutate anything', async () => {
    for (const invalid of [false, true]) {
        const f = fixture();
        if (invalid)
            f.setInvalid();
        else
            f.setStorageError();
        const result = await f.request();
        assert.equal(result.status, invalid ? 415 : 404);
    }
});
test('authentication, foreign outlet, inactive account and mismatched usage context deny Storage access', async () => {
    for (const kind of ['auth', 'foreign', 'inactive', 'context']) {
        const f = fixture();
        if (kind === 'foreign')
            f.records.get('USER_PROFILE/user').outlets = [];
        if (kind === 'inactive')
            f.records.get('USER_PROFILE/user').active = false;
        const result = await f.request(kind === 'auth' ? { authorization: '' } : kind === 'context' ? { 'x-web-usage-outlet': 'another' } : {});
        assert.equal(result.status, kind === 'auth' ? 401 : 403);
        assert.equal(f.objects.length, 0);
    }
});
test('missing, expired and foreign sessions cannot load logos or initialize/renew accounting', async () => {
    for (const kind of ['missing', 'expired', 'owner', 'generation', 'no-record']) {
        const f = fixture(), usage = f.records.get('OUTLET/outlet/SESSION/dailyUsage');
        if (kind === 'expired')
            usage.sessions[sessionId].expiresAt = f.now;
        if (kind === 'owner')
            usage.sessions[sessionId].profileDocId = 'other';
        if (kind === 'no-record')
            f.records.delete('OUTLET/outlet/SESSION/dailyUsage');
        const result = await f.request(kind === 'missing' ? { 'x-web-usage-session': '' } : kind === 'generation' ? { 'x-web-usage-generation': '33333333-3333-4333-8333-333333333333' } : {});
        assert.equal(result.status, 428);
        assert.equal(f.objects.length, 0);
    }
});
test('read-only checks enforce elapsed exhaustion and preserve exempt leases at the cap', async () => {
    for (const exempt of [false, true]) {
        const f = fixture();
        f.records.get('OUTLET/outlet').eraseOutlet = exempt;
        f.records.get('OUTLET/outlet/SESSION/dailyUsage').usedSeconds = 1799;
        const before = JSON.stringify([...f.records]);
        const operation = readAuthorizedOutletLogoName(f.db, 'outlet', 'user', assigned, sessionId, generation, () => Timestamp.fromMillis(f.now.toMillis() + 2000));
        if (exempt)
            assert.equal(await operation, '90 DEGREES ULTIMATE FOOD STUDIO');
        else
            await assert.rejects(operation, (error) => error.code === 'USAGE_LIMIT_REACHED');
        assert.equal(JSON.stringify([...f.records]), before);
    }
});
test('read-only checks never roll over or repair existing usage records', async () => {
    const f = fixture();
    const before = JSON.stringify([...f.records]);
    await assert.rejects(readAuthorizedOutletLogoName(f.db, 'outlet', 'user', assigned, sessionId, generation, () => Timestamp.fromMillis(f.now.toMillis() + 86_400_000)));
    assert.equal(JSON.stringify([...f.records]), before);
});
test('invalid outlet names and paths cannot select arbitrary Storage objects', async () => {
    const f = fixture();
    for (const name of ['', '..', 'other/footer', 'bad\\name', 'bad\u0000name'])
        await assert.rejects(readOutletLogo(f.bucket, name, 'outlet'));
    assert.equal(f.objects.length, 0);
});
test('logo actions are mounted before accounting and cannot trigger Firestore writes', () => {
    const source = readFileSync('backend/src/server.ts', 'utf8');
    const route = source.indexOf("app.get('/api/outlets/:outletId/logo'");
    const guard = source.indexOf("app.use('/api/outlets/:outletId', createWebUsageGuard");
    assert.ok(route > 0 && route < guard);
    assert.equal(source.match(/createOutletLogoHandler\(/g)?.length, 3);
    assert.ok(source.indexOf("app.put('/api/outlets/:outletId/logo'") < guard);
    assert.ok(source.indexOf("app.delete('/api/outlets/:outletId/logo'") < guard);
});
test('footer reads use the existing footer path and its independent version', async () => {
    const f = fixture(), result = await f.request({}, 'outlet', { variant: 'footer' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['X-Logo-Generation'], '2');
    assert.deepEqual(f.objects, [f.footerPath]);
    assert.deepEqual(f.changes, []);
});
test('upload and removal change only the selected Storage object, leaving Firestore and the other logo untouched', async () => {
    for (const variant of ['header', 'footer']) {
        const f = fixture(), path = variant === 'header' ? f.headerPath : f.footerPath, other = variant === 'header' ? f.footerPath : f.headerPath;
        const previousOther = f.store.get(other), expected = f.store.get(path).generation;
        assert.equal((await f.request({ 'x-logo-expected-generation': expected }, 'outlet', { action: 'upload', variant })).status, 200);
        assert.equal(f.store.get(other), previousOther);
        const saved = f.store.get(path);
        assert.notEqual(saved.generation, expected);
        assert.equal((await f.request({ 'x-logo-expected-generation': saved.generation }, 'outlet', { action: 'remove', variant })).status, 200);
        assert.ok(!f.store.has(path));
        assert.equal(f.store.get(other), previousOther);
        assert.deepEqual(f.changes, [`save:${path}`, `delete:${path}`]);
    }
});
test('missing logos can be uploaded with generation zero; repeated or stale writes never overwrite newer images', async () => {
    const f = fixture();
    f.store.delete(f.headerPath);
    assert.equal((await f.request()).status, 404);
    assert.equal((await f.request({ 'x-logo-expected-generation': '0' }, 'outlet', { action: 'upload' })).status, 200);
    assert.equal((await f.request({ 'x-logo-expected-generation': '0' }, 'outlet', { action: 'upload' })).status, 409);
    assert.equal((await f.request({ 'x-logo-expected-generation': '1' }, 'outlet', { action: 'remove' })).status, 409);
    assert.equal(f.changes.length, 1);
});
test('concurrent uploads of the same reviewed logo allow only one mutation', async () => {
    const f = fixture();
    const results = await Promise.all([f.request({ 'x-logo-expected-generation': '1' }, 'outlet', { action: 'upload' }), f.request({ 'x-logo-expected-generation': '1' }, 'outlet', { action: 'upload' })]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(f.changes.length, 1);
});
test('missing versions, invalid bytes, oversized images, unknown variants and unsupported MIME types cannot mutate Storage', async () => {
    const f = fixture();
    assert.equal((await f.request({}, 'outlet', { action: 'upload' })).status, 422);
    for (const variant of ['other', ['header'], '../../footer'])
        assert.equal((await f.request({}, 'outlet', { action: 'upload', variant })).status, 400);
    for (const bytes of [Buffer.alloc(0), Buffer.from('not an image'), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
        assert.ok((await f.request({ 'x-logo-expected-generation': '1' }, 'outlet', { action: 'upload', bytes })).status >= 400);
    }
    assert.equal((await f.request({ 'content-type': 'image/jpeg', 'x-logo-expected-generation': '1' }, 'outlet', { action: 'upload' })).status, 415);
    assert.deepEqual(f.changes, []);
});
test('unauthorized or expired sessions cannot upload or remove either logo', async () => {
    for (const action of ['upload', 'remove'])
        for (const variant of ['header', 'footer']) {
            for (const kind of ['auth', 'foreign', 'expired', 'inactive']) {
                const f = fixture();
                if (kind === 'foreign')
                    f.records.get('USER_PROFILE/user').outlets = [];
                if (kind === 'expired')
                    f.records.get('OUTLET/outlet/SESSION/dailyUsage').sessions[sessionId].expiresAt = f.now;
                if (kind === 'inactive')
                    f.records.get('OUTLET/outlet').active = false;
                const result = await f.request({ 'x-logo-expected-generation': variant === 'header' ? '1' : '2', ...(kind === 'auth' ? { authorization: '' } : {}) }, 'outlet', { action, variant });
                assert.ok(result.status >= 400);
                assert.deepEqual(f.changes, []);
                assert.deepEqual(f.objects, []);
            }
        }
});
test('repeating an already completed removal is harmless and cannot delete the other logo', async () => {
    const f = fixture();
    for (let attempt = 0; attempt < 2; attempt++)
        assert.equal((await f.request({ 'x-logo-expected-generation': '1' }, 'outlet', { action: 'remove' })).status, 200);
    assert.ok(f.store.has(f.footerPath));
    assert.equal(f.changes.length, 1);
});
//# sourceMappingURL=outletLogo.test.js.map