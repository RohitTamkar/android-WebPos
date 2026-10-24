import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createProductExport, PRODUCT_EXCEL_COLUMNS, type ProductExportDependencies } from '../src/productExcel.js';
import { sendProductExportEmail } from '../src/productExportMail.js';
import { productExportRouter } from '../src/productExportRoutes.js';
import { ProductCreationError } from '../src/productCreation.js';
import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import jwt from 'jsonwebtoken';

function fixture() {
  const products = [{ id: 'p1', fields: { name: '=Apple', regionalName: 'Local', code: '0007', price: 12.5,
    priceTable: JSON.stringify({ 'default price': 10, 'TABLE price': 14, TABLE: 13, 'Legacy price': 16 }),
    mrpPrice: 20, costPrice: 6, category: 'c1', taxIndex: 2, barcode: '000123', unitId: 2,
    currentStock: 5, weighable: false, hsnCode: '0012' } }];
  let reads = 0;
  const deps: ProductExportDependencies = {
    readProfile: async () => ({ active: true, outlets: ['outlet'] }), assignedOutlets: p => p.outlets as string[],
    readProducts: async id => { assert.equal(id, 'outlet'); reads++; return products; },
    readCategories: async () => [{ id: 'c1', name: 'Fruit', categoryNo: 3 }],
    readPremises: async () => [{ id: 'table-id', name: 'TABLE' }, { id: 'not-assigned', name: 'Room' }],
  };
  return { deps, products, reads: () => reads };
}
async function workbook(buffer: Buffer) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer as never); return book;
}
test('real XLSX preserves exact columns, numeric values, text codes, all premises keys and input data', async () => {
  const f = fixture(), before = structuredClone(f.products);
  const output = await createProductExport(f.deps, 'outlet', 'user');
  assert.equal(output.buffer.subarray(0, 2).toString(), 'PK');
  const book = await workbook(output.buffer), sheet = book.getWorksheet('Products')!;
  assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), PRODUCT_EXCEL_COLUMNS);
  assert.deepEqual((sheet.getRow(2).values as unknown[]).slice(1), [
    '=Apple', 'Local', 10, 12.5, 20, 6, 'Fruit', 3, 5, '000123', 'number', 5, 'NO', '0007', '0012',
  ]);
  assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.String, 'product text is never a formula');
  assert.equal(sheet.getCell('J2').numFmt, '@');
  const premises = book.getWorksheet('Premises')!;
  assert.equal(premises.rowCount, 4, 'only assigned price keys, including aliases and legacy names');
  assert.deepEqual((premises.getRow(2).values as unknown[]).slice(1), [2, '=Apple', '0007', 'TABLE', 'TABLE price', 14]);
  assert.deepEqual((premises.getRow(3).values as unknown[]).slice(1), [2, '=Apple', '0007', 'TABLE', 'TABLE', 13]);
  assert.equal(premises.getCell('D4').value, 'Legacy');
  assert.equal(premises.getCell('E4').value, 'Legacy price');
  assert.deepEqual(f.products, before);
});
test('complete lists exceed a UI page, deduplicate by document ID, retain same-name products and missing fields', async () => {
  const f = fixture();
  f.deps.readProducts = async () => [...Array.from({ length: 1501 }, (_, i) => ({ id: `p${i}`, fields: { name: 'Same name', code: String(i).padStart(6, '0') } })),
    { id: 'p0', fields: { name: 'Same name', code: '000000' } }];
  const result = await createProductExport(f.deps, 'outlet', 'user');
  const book = await workbook(result.buffer), sheet = book.getWorksheet('Products')!;
  assert.equal(result.count, 1501); assert.equal(sheet.rowCount, 1502);
  assert.equal(sheet.getCell('N1502').value, '001500');
  for (const column of ['C', 'D', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'O']) assert.equal(sheet.getCell(`${column}2`).value, '');
  assert.equal(book.getWorksheet('Premises'), undefined);
});
test('unknown mappings are recorded, invalid premises data fails visibly, and empty outlet exports a header', async () => {
  const f = fixture();
  f.deps.readProducts = async () => [{ id: 'p', fields: { name: 'Unknown', code: '001', category: 'missing', taxIndex: 99, unitId: 99 } }];
  const result = await createProductExport(f.deps, 'outlet', 'user');
  assert.equal(result.warnings, 3); assert.equal((await workbook(result.buffer)).getWorksheet('Export Notes')!.rowCount, 4);
  f.deps.readProducts = async () => [{ id: 'p', fields: { priceTable: '{broken' } }];
  await assert.rejects(createProductExport(f.deps, 'outlet', 'user'), /invalid price table/);
  f.deps.readProducts = async () => [];
  assert.equal((await workbook((await createProductExport(f.deps, 'outlet', 'user')).buffer)).getWorksheet('Products')!.rowCount, 1);
});
test('missing sessions, inactive profiles, foreign outlets and invalid paths never read product data', async () => {
  const f = fixture();
  for (const [outlet, profile] of [['outlet', null], ['foreign', 'user'], ['../other', 'user'], ['..', 'user']] as const) {
    await assert.rejects(createProductExport(f.deps, outlet, profile), ProductCreationError);
  }
  f.deps.readProfile = async () => ({ active: false, outlets: ['outlet'] });
  await assert.rejects(createProductExport(f.deps, 'outlet', 'user'), /access/);
  assert.equal(f.reads(), 0);
});
test('mail sends a valid XLSX attachment and requires confirmed provider acceptance', async () => {
  const result = await createProductExport(fixture().deps, 'outlet', 'user');
  let calls = 0;
  const send: typeof fetch = async (url, init) => {
    calls++; assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.to, ['person@example.com']);
    assert.equal(body.attachments[0].filename, 'Products.xlsx');
    const bytes = Buffer.from(body.attachments[0].content, 'base64');
    assert.deepEqual(bytes, result.buffer);
    assert.equal((await workbook(bytes)).getWorksheet('Products')!.rowCount, 2);
    return Response.json({ id: 'provider-id' });
  };
  assert.equal(await sendProductExportEmail('person@example.com', result, { apiKey: 'test-secret', from: 'pos@example.com' }, send), 'provider-id');
  await assert.rejects(sendProductExportEmail('person@example.com', result, { apiKey: '', from: '' }, send), /not configured/);
  assert.equal(calls, 1);
  for (const response of [Response.json({ error: 'no' }, { status: 422 }), Response.json({ success: true }), new Response('not json')]) {
    await assert.rejects(sendProductExportEmail('person@example.com', result, { apiKey: 'key', from: 'pos@example.com' }, async () => response), /did not accept/);
  }
  await assert.rejects(sendProductExportEmail('person@example.com', result, { apiKey: 'key', from: 'pos@example.com' }, async () => { throw new Error('network'); }), /did not confirm/);
});

// Invoke the actual Express handlers with request/response doubles; no external service or port required.
function routes(send = async (_email: string, _attachment: { buffer: Buffer; filename: string }) => 'provider-id',
  authenticate: (req: Request) => string | null = req => req.header('authorization') === 'Bearer signed-session' ? 'user' : null) {
  const f = fixture();
  const router = productExportRouter(() => f.deps, authenticate, send);
  const request = async (path: string, body?: unknown, outletId = 'outlet', auth = 'Bearer signed-session') => {
    const req = { params: { outletId }, body, header: () => auth } as unknown as Request;
    const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>,
      status(code: number) { this.statusCode = code; return this; }, setHeader(key: string, value: string) { this.headers[key] = value; },
      send(value: unknown) { this.body = value; }, json(value: unknown) { this.body = value; } };
    const layer = router.stack.find(layer => layer.route?.path === path)!;
    await layer.route!.stack[0]!.handle(req, res as unknown as Response, () => {});
    return res;
  };
  return { ...f, request };
}
test('download and email handlers use the same workbook, reject foreign outlets and validate destination', async () => {
  let attachment: Buffer | undefined, sent = 0;
  const f = routes(async (email, data) => { assert.equal(email, 'person@example.com'); attachment = data.buffer; sent++; return 'ok'; });
  const download = await f.request('/download');
  assert.equal(download.statusCode, 200); assert.ok(Buffer.isBuffer(download.body));
  assert.match(download.headers['Content-Disposition']!, /Products.xlsx/);
  const email = await f.request('/email', { email: ' person@example.com ' });
  assert.equal(email.statusCode, 200); assert.equal((email.body as { success: boolean }).success, true);
  const downloaded = await workbook(download.body as Buffer), emailed = await workbook(attachment!);
  assert.deepEqual(emailed.worksheets.map(sheet => sheet.getSheetValues()), downloaded.worksheets.map(sheet => sheet.getSheetValues()));
  for (const invalid of ['', 'bad', 'a@example.com,b@example.com', 'a@example.com\r\nBcc:x@example.com']) {
    assert.equal((await f.request('/email', { email: invalid })).statusCode, 422);
  }
  assert.equal((await f.request('/email', { email: 'person@example.com', buffer: 'untrusted' })).statusCode, 422);
  for (const path of ['/download', '/email']) {
    assert.equal((await f.request(path, { email: 'person@example.com' }, 'foreign')).statusCode, 403);
    assert.equal((await f.request(path, { email: 'person@example.com' }, 'outlet', 'forged')).statusCode, 401);
  }
  assert.equal(sent, 1);
});
test('email handlers wait for provider confirmation, prevent concurrent sends, and return provider failures', async () => {
  let release!: () => void, started = false;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const f = routes(async () => { started = true; await waiting; return 'provider-id'; });
  let complete = false;
  const pending = f.request('/email', { email: 'person@example.com' }).then(result => { complete = true; return result; });
  while (!started) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(complete, false);
  assert.equal((await f.request('/email', { email: 'person@example.com' })).statusCode, 409);
  release(); assert.equal((await pending).statusCode, 200);
  const failed = routes(async () => { throw new ProductCreationError(502, 'Provider rejected sending'); });
  const response = await failed.request('/email', { email: 'person@example.com' });
  assert.equal(response.statusCode, 502); assert.equal((response.body as { success: boolean }).success, false);
});

test('server wiring retains the usage guard and rejects missing, forged and expired signed sessions', async () => {
  const source = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
  const tokenReader = source.match(/^function readAccessToken\b[\s\S]*?^\}/m)?.[0];
  const mount = source.match(/^app\.use\('\/api\/outlets\/:outletId\/products\/export', productExportRouter\(productImportDependencies, (.*)\)\);$/m);
  assert.ok(tokenReader && mount, 'export router uses the existing session reader and data dependencies');
  assert.ok(source.indexOf("app.use('/api/outlets/:outletId', createWebUsageGuard(") < source.indexOf(mount[0]));
  const compiled = stripTypeScriptTypes(`${tokenReader}\nconst resolveIdentity = ${mount[1]};`);
  const key = 'export-test-signing-key';
  const authenticate = new Function('jwt', 'JWT_SECRET', `${compiled}; return resolveIdentity;`)(jwt, key) as (request: Request) => string | null;
  const f = routes(undefined, authenticate);
  for (const token of ['', 'forged', jwt.sign({ profileDocId: 'user' }, key, { expiresIn: -1 }), jwt.sign({ profileDocId: 'user' }, 'wrong-key')]) {
    for (const path of ['/download', '/email']) {
      assert.equal((await f.request(path, { email: 'person@example.com' }, 'outlet', token ? `Bearer ${token}` : '')).statusCode, 401);
    }
  }
  assert.equal(f.reads(), 0);
  assert.equal((await f.request('/download', undefined, 'outlet', `Bearer ${jwt.sign({ profileDocId: 'user' }, key)}`)).statusCode, 200);
});
