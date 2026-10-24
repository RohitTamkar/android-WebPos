import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createFileProductImportQuota } from '../src/productImportQuotaFile.js';
import { ProductImportQuotaError, PRODUCT_UPLOAD_WINDOW_MS } from '../src/productImportQuota.js';
function fixture(run) {
    const directory = mkdtempSync(join(tmpdir(), 'pos-quota-test-'));
    try {
        run(join(directory, 'quota.json'));
    }
    finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
test('fresh backend instances share two attempts and preserve the rolling expiry', () => fixture(filename => {
    let time = 1000;
    const restart = () => createFileProductImportQuota(filename, () => time);
    assert.equal(restart().check('outlet').remainingAttempts, 2);
    restart().accept('outlet');
    time += 1000;
    assert.equal(restart().check('outlet').remainingAttempts, 1);
    restart().accept('outlet');
    for (let i = 0; i < 5; i++) {
        assert.throws(() => restart().check('outlet'), ProductImportQuotaError);
        assert.throws(() => restart().accept('outlet'), ProductImportQuotaError);
    }
    restart().accept('another-outlet');
    time = 1000 + PRODUCT_UPLOAD_WINDOW_MS - 1;
    assert.throws(() => restart().accept('outlet'), ProductImportQuotaError);
    time++;
    restart().accept('outlet');
    assert.throws(() => restart().accept('outlet'), ProductImportQuotaError);
}));
test('status, preview and cancellation checks do not write or consume attempts', () => fixture(filename => {
    for (let i = 0; i < 5; i++)
        assert.equal(createFileProductImportQuota(filename).check('outlet').remainingAttempts, 2);
    assert.throws(() => readFileSync(filename), { code: 'ENOENT' });
    const quota = createFileProductImportQuota(filename);
    quota.accept('outlet');
    const before = readFileSync(filename, 'utf8');
    for (let i = 0; i < 5; i++)
        assert.equal(createFileProductImportQuota(filename).check('outlet').remainingAttempts, 1);
    assert.equal(readFileSync(filename, 'utf8'), before);
}));
test('real child-process restarts cannot reset or bypass accepted attempts', () => fixture(filename => {
    const moduleUrl = new URL('../src/productImportQuotaFile.js', import.meta.url).href;
    const script = `import { createFileProductImportQuota } from ${JSON.stringify(moduleUrl)};
    try { createFileProductImportQuota(process.argv[1]).accept('same-outlet'); }
    catch (error) { process.exit(error.name === 'ProductImportQuotaError' ? 29 : 30); }`;
    const attempt = () => spawnSync(process.execPath, ['--input-type=module', '-e', script, filename], { encoding: 'utf8' });
    assert.equal(attempt().status, 0);
    assert.equal(attempt().status, 0);
    assert.equal(attempt().status, 29);
    assert.equal(attempt().status, 29);
}));
test('malformed quota history is never treated as an empty counter', () => fixture(filename => {
    for (const contents of ['{broken', '{}', '{"version":1,"outlets":[["outlet",["bad"]]]}', '{"version":1,"outlets":[["a",[]],["a",[]]]}']) {
        writeFileSync(filename, contents);
        const quota = createFileProductImportQuota(filename);
        assert.throws(() => quota.check('outlet'));
        assert.throws(() => quota.accept('outlet'));
        assert.equal(readFileSync(filename, 'utf8'), contents);
    }
}));
test('an existing reservation lock blocks processing rather than bypassing quota', () => fixture(filename => {
    writeFileSync(`${filename}.lock`, '');
    assert.throws(() => createFileProductImportQuota(filename).accept('outlet'), { code: 'EEXIST' });
    assert.throws(() => readFileSync(filename), { code: 'ENOENT' });
}));
test('history contains only outlet IDs and timestamps', () => fixture(filename => {
    const quota = createFileProductImportQuota(filename, () => 1234);
    quota.accept('outlet');
    assert.deepEqual(JSON.parse(readFileSync(filename, 'utf8')), { version: 1, outlets: [['outlet', [1234]]] });
}));
test('reopening on another client after 10 or 15 minutes does not restore slots', () => fixture(filename => {
    const first = Date.parse('2026-10-17T23:55:00+05:30');
    let time = first;
    const reopen = () => createFileProductImportQuota(filename, () => time);
    reopen().accept('outlet');
    time += 1000;
    reopen().accept('outlet');
    for (const minutes of [10, 15, 60]) {
        time = first + minutes * 60 * 1000;
        for (let client = 0; client < 3; client++) {
            assert.throws(() => reopen().check('outlet'), ProductImportQuotaError);
            assert.throws(() => reopen().accept('outlet'), ProductImportQuotaError);
        }
    }
}));
test('separate backend disks cannot coordinate: each quota file has independent history', () => fixture(filename => {
    const firstHost = createFileProductImportQuota(filename);
    firstHost.accept('outlet');
    firstHost.accept('outlet');
    assert.throws(() => firstHost.accept('outlet'), ProductImportQuotaError);
    // This is a documented scope limitation, not cross-host enforcement.
    const separateHost = createFileProductImportQuota(`${filename}.another-host`);
    assert.equal(separateHost.check('outlet').remainingAttempts, 2);
}));
test('simultaneous backend processes sharing the file cannot exceed two acceptances', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pos-quota-concurrent-'));
    const filename = join(directory, 'quota.json');
    const moduleUrl = new URL('../src/productImportQuotaFile.js', import.meta.url).href;
    const script = `import { createFileProductImportQuota } from ${JSON.stringify(moduleUrl)};
    try { createFileProductImportQuota(process.argv[1]).accept('outlet'); }
    catch (error) { process.exit(error.name === 'ProductImportQuotaError' ? 29 : error.code === 'EEXIST' ? 30 : 31); }`;
    try {
        const results = await Promise.all(Array.from({ length: 12 }, () => new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['--input-type=module', '-e', script, filename], { stdio: 'ignore' });
            child.on('error', reject);
            child.on('exit', resolve);
        })));
        const accepted = results.filter(code => code === 0).length;
        assert.ok(accepted >= 1 && accepted <= 2);
        assert.ok(results.every(code => code === 0 || code === 29 || code === 30));
        const history = JSON.parse(readFileSync(filename, 'utf8'));
        assert.equal(history.outlets[0][1].length, accepted);
        const quota = createFileProductImportQuota(filename);
        for (let i = accepted; i < 2; i++)
            quota.accept('outlet');
        assert.throws(() => quota.accept('outlet'), ProductImportQuotaError);
    }
    finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
//# sourceMappingURL=productImportQuotaFile.test.js.map