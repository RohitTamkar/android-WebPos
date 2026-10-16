import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateProductImport, checkAuthorizedProductImport, persistProductImport, productIdentity, allocateProductCodes, assertPreviewCodes, numericSearchCode, PRODUCT_IMPORT_WRITES_ENABLED, type ImportValidationDependencies, type ImportWriter, type ImportDocument } from '../src/productImportValidation.js';
import { PRODUCT_COLUMNS } from '../../frontend/src/pages/productCsvPreview.js';
const row = ['PAPAD ROASTED', 'PAPAD ROASTED', '20', '20', '0', '0', 'PAPAD', '1', '0', '0001', 'number', '0', 'no', '1'];
const source = (rows = [row]) => [PRODUCT_COLUMNS.join(','), ...rows.map(c => c.join(','))].join('\n');
const categories = [{ id: 'existing-category', name: 'PAPAD', categoryNo: 1 }];
const taxes = [{ percent: 0, index: 1, type: 0 }];
const deps: ImportValidationDependencies = { readProfile: async () => ({ active: true }), assignedOutlets: () => ['outlet'], readCategories: async () => categories, readTaxes: async () => taxes, readProducts: async () => [] };
const mapped = () => validateProductImport(source(), categories, taxes).documents;
function memoryWriter() {
  const store = new Map<string, Record<string, unknown>>();
  const chunkSizes: number[] = [];
  const writer: ImportWriter = {
    enabled: true,
    readExisting: async () => [...store].map(([id, fields]) => ({ id, fields })),
    createChunk: async (outlet, documents) => {
      assert.equal(outlet, 'outlet'); chunkSizes.push(documents.length);
      const allocated = allocateProductCodes(outlet, documents, [...store].map(([id, fields]) => ({ id, fields })));
      assertPreviewCodes(documents, allocated);
      // Mock an atomic create-only transaction; validate all targets first.
      for (const document of documents) {
        const old = store.get(String(document.fields.id));
        if (old && productIdentity(old) !== productIdentity(document.fields)) throw new Error('Conflict');
      }
      let created = 0, existing = 0;
      for (const document of documents) {
        const id = String(document.fields.id);
        if (store.has(id)) existing++;
        else { store.set(id, { ...document.fields, dateTme: new Date(0) }); created++; }
      }
      return { created, existing };
    },
  };
  return { store, writer, chunkSizes };
}

test('maps all source columns to the supplied existing fields and approved narrow template', () => {
  const result = validateProductImport(source(), categories, taxes);
  assert.equal(result.canUpload, true);
  const f = result.documents[0]!.fields;
  assert.equal(f.name, row[0]); assert.equal(f.regionalName, row[1]);
  assert.equal(f.price, 20); assert.equal(f.priceTable, '{"default price":20}');
  assert.equal(f.mrpPrice, 0); assert.equal(f.costPrice, 0); assert.equal(f.category, 'existing-category');
  assert.equal(f.taxIndex, 1); assert.equal(f.barcode, '0001'); assert.equal(f.unitId, 2);
  assert.equal(f.currentStock, 0); assert.equal(f.weighable, false); assert.equal(f.code, 1);
  assert.equal(f.active, false); assert.equal(f.stockable, false); assert.equal(f.reorderLevel, 0);
  assert.equal(f.onlineSynced, false); assert.equal(f.selected, false);
});

test('different Price 1, unsupported units, nonzero stock and missing numerics block every write', () => {
  for (const [column, value] of [[3, '30'], [10, 'kg'], [11, '5'], [2, '']] as const) {
    const bad = [...row]; bad[column] = value;
    const result = validateProductImport(source([row, bad]), categories, taxes);
    assert.equal(result.canUpload, false); assert.equal(result.documents.length, 0);
    assert.ok(result.rows[1]?.errors.length);
  }
});

test('missing, conflicting or ambiguous category and tax lookups reject the complete file', () => {
  for (const cats of [[], [{ ...categories[0]!, categoryNo: 2 }], [...categories, ...categories]]) {
    const result = validateProductImport(source(), cats, taxes);
    assert.equal(result.canUpload, false); assert.equal(result.documents.length, 0);
  }
  for (const settings of [[], [...taxes, ...taxes], [{ percent: 0, index: 1, type: 1 }]]) {
    assert.equal(validateProductImport(source(), categories, settings).canUpload, false);
  }
});

test('row 5 EGG ROLL mismatch identifies the exact stored name without fuzzy matching', () => {
  const existing = [{ id: 'veg', name: 'VEG ROLLS', categoryNo: 1 }, { id: 'egg', name: 'EGG ROLLS', categoryNo: 2 }];
  const rows = Array.from({ length: 4 }, (_, index) => {
    const cells = [...row]; cells[0] = ['PAPAD ROASTED', 'MASALA PAPAD', 'FRY PAPAD', 'ONION SALAD'][index]!;
    cells[6] = index === 3 ? 'EGG ROLL' : 'VEG ROLLS'; cells[7] = index === 3 ? '2' : '1'; cells[13] = String(index + 1);
    return cells;
  });
  const result = validateProductImport(source(rows), existing, taxes);
  assert.equal(result.canUpload, false); assert.equal(result.documents.length, 0);
  assert.equal(result.rows.filter(row => !row.errors.length).length, 3);
  assert.equal(result.rows[3]?.rowNumber, 5);
  assert.match(result.rows[3]?.errors[0]?.message ?? '', /Category No 2 is named "EGG ROLLS", but the file says "EGG ROLL"/);
  rows[3]![6] = 'EGG ROLLS';
  const corrected = validateProductImport(source(rows), existing, taxes);
  assert.equal(corrected.canUpload, true); assert.equal(corrected.documents[3]?.fields.category, 'egg');
});

test('invalid last row and prohibited characters stop before reference reads', async () => {
  let reads = 0;
  const spies = { ...deps, readCategories: async () => { reads++; return categories; } };
  for (const value of ['NaN', 'bad!']) {
    const bad = [...row]; bad[2] = value;
    const checked = await checkAuthorizedProductImport('user', 'outlet', source([row, bad]), spies);
    assert.ok([400, 422].includes(checked.status)); assert.equal(reads, 0);
  }
});

test('authentication, active profile and outlet authorization reject unsafe requests', async () => {
  let reads = 0;
  const spy = { ...deps, readCategories: async () => { reads++; return categories; } };
  assert.equal((await checkAuthorizedProductImport(null, 'outlet', source(), spy)).status, 401);
  assert.equal((await checkAuthorizedProductImport('user', 'other-outlet', source(), spy)).status, 403);
  assert.equal((await checkAuthorizedProductImport('user', 'outlet', source(), { ...spy, readProfile: async () => ({ active: false }) })).status, 403);
  assert.equal(reads, 0);
  assert.equal((await checkAuthorizedProductImport('user', 'outlet', source(), deps)).status, 200);
});

test('repetitions are rejected even when Excel Search Codes differ', () => {
  assert.equal(validateProductImport(source([row, row]), categories, taxes).canUpload, false);
  const other = [...row]; other[13] = '2';
  assert.equal(validateProductImport(source([row, other]), categories, taxes).canUpload, false);
});

test('approved import is enabled; a disabled writer still performs no read or write calls', async () => {
  assert.equal(PRODUCT_IMPORT_WRITES_ENABLED, true);
  const result = await persistProductImport('outlet', mapped(), { enabled: false, readExisting: async () => { throw new Error('must not read'); }, createChunk: async () => { throw new Error('must not write'); } });
  assert.equal(result.success, false); assert.equal(result.created, 0);
});

test('authorized four-product upload adds the correct categories and preserves existing products', async () => {
  const existingCategories = [{ id: 'veg', name: 'VEG ROLLS', categoryNo: 1 }, { id: 'egg', name: 'EGG ROLLS', categoryNo: 2 }];
  const names = ['PAPAD ROASTED', 'MASALA PAPAD', 'FRY PAPAD', 'ONION SALAD'];
  const prices = ['20', '80', '30', '50'];
  const rows = names.map((name, index) => {
    const cells = [...row];
    cells[0] = name; cells[1] = name; cells[2] = prices[index]!; cells[3] = prices[index]!;
    cells[6] = index === 3 ? 'EGG ROLLS' : 'VEG ROLLS'; cells[7] = index === 3 ? '2' : '1';
    cells[13] = String(index + 1);
    return cells;
  });
  const checked = await checkAuthorizedProductImport('user', 'outlet', source(rows), {
    ...deps, readCategories: async () => existingCategories,
  });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.data?.canUpload, true);
  const { writer, store } = memoryWriter();
  const original = { name: 'Existing product', code: 53, price: 80, category: 'veg' };
  store.set('existing-product', original);
  const refreshed = allocateProductCodes('outlet', checked.body.data!.documents, await writer.readExisting('outlet'));
  const result = await persistProductImport('outlet', refreshed, { ...writer, enabled: PRODUCT_IMPORT_WRITES_ENABLED });
  assert.equal(result.success, true); assert.equal(result.created, 4); assert.equal(store.size, 5);
  assert.deepEqual(store.get('existing-product'), original);
  for (const [index, name] of names.entries()) {
    const saved = [...store.values()].find(product => product.name === name)!;
    assert.equal(saved.category, index === 3 ? 'egg' : 'veg');
    assert.equal(saved.price, Number(prices[index]));
  }
  const retry = await persistProductImport('outlet', refreshed, writer);
  assert.equal(retry.created, 0); assert.equal(retry.existing, 4); assert.equal(store.size, 5);
});

test('mock creation preserves types and IDs and repeat imports reconcile without duplicates', async () => {
  const { writer, store } = memoryWriter();
  const first = await persistProductImport('outlet', mapped(), writer);
  assert.equal(first.success, true); assert.equal(first.created, 1);
  const second = await persistProductImport('outlet', mapped(), writer);
  assert.equal(second.created, 0); assert.equal(second.existing, 1); assert.equal(store.size, 1);
  for (const [id, value] of store) { assert.equal(value.id, id); assert.equal(id.length, 20); assert.equal(typeof value.code, 'number'); assert.equal(typeof value.barcode, 'string'); assert.ok(value.dateTme instanceof Date); }
});

test('existing arbitrary-ID products are not duplicated or overwritten', async () => {
  const { writer, store } = memoryWriter();
  store.set('existing-product', { ...mapped()[0]!.fields, id: 'existing-product' });
  await assert.rejects(() => persistProductImport('outlet', mapped(), writer), /already matches/);
  assert.equal(store.size, 1);
});

test('reference configuration changing between retries cannot create a second product', async () => {
  const { writer, store } = memoryWriter();
  await persistProductImport('outlet', mapped(), writer);
  const changed = validateProductImport(source(), categories, [{ percent: 0, index: 9, type: 0 }]).documents;
  await assert.rejects(() => persistProductImport('outlet', changed, writer), /differs/);
  assert.equal(store.size, 1);
  assert.equal([...store.values()][0]?.taxIndex, 1);
});

test('large files use bounded chunks; partial failure retries reuse successful rows', async () => {
  const { writer, store, chunkSizes } = memoryWriter();
  const documents: ImportDocument[] = Array.from({ length: 205 }, (_, index) => ({ rowNumber: index + 2, fields: { ...mapped()[0]!.fields, name: `Product ${index}`, code: index + 1 } }));
  const original = writer.createChunk;
  let call = 0;
  writer.createChunk = async (outlet, chunk) => { if (++call === 2) throw new Error('network failure'); return original(outlet, chunk); };
  const partial = await persistProductImport('outlet', documents, writer);
  assert.equal(partial.success, false); assert.equal(partial.created, 100); assert.equal(partial.confirmedRows.length, 100); assert.equal(partial.unconfirmedRows.length, 105);
  writer.createChunk = original;
  const retry = await persistProductImport('outlet', documents, writer);
  assert.equal(retry.success, true); assert.equal(retry.existing, 100); assert.equal(retry.created, 105); assert.equal(store.size, 205);
  assert.ok(chunkSizes.every(size => size <= 100));
});

test('ambiguous timeout after commit is reconciled by the same IDs', async () => {
  const { writer, store } = memoryWriter();
  const original = writer.createChunk;
  writer.createChunk = async (outlet, chunk) => { await original(outlet, chunk); throw new Error('lost response'); };
  const unknown = await persistProductImport('outlet', mapped(), writer);
  assert.equal(unknown.success, false); assert.equal(unknown.confirmedRows.length, 0); assert.equal(store.size, 1);
  writer.createChunk = original;
  const retry = await persistProductImport('outlet', mapped(), writer);
  assert.equal(retry.created, 0); assert.equal(retry.existing, 1); assert.equal(store.size, 1);
});

const products = (codes: unknown[]) => codes.map((code, index) => ({ id: `old${index}`, fields: { name: `Old ${index}`, code } }));
const five = () => validateProductImport(source(Array.from({ length: 5 }, (_, i) => {
  const cells = [...row]; cells[0] = `NEW ${i}`; cells[13] = '1'; return cells;
})), categories, taxes).documents;

test('highest 50 and duplicate Excel codes allocate 51–55 in row order; next upload starts at 56', () => {
  const existing = products([50]);
  const planned = allocateProductCodes('outlet', five(), existing);
  assert.deepEqual(planned.map(d => d.fields.code), [51, 52, 53, 54, 55]);
  const next = allocateProductCodes('outlet', mapped(), [...existing, ...planned.map(d => ({ id: String(d.fields.id), fields: d.fields }))]);
  assert.equal(next[0]?.fields.code, 56);
});

test('empty outlets, gaps, mixed numeric strings, conflicting representations and invalid codes', () => {
  for (const [codes, expected] of [
    [[], 1], [[1, 7, 50], 51], [['001', ' 50 ', 10], 51],
    [[50, '050', '5e1', 'invalid', '', null, false, {}, 1.5], 51],
    [['invalid', '', null, false, '0xFF', 'Infinity', '1.5'], 1],
  ] as [unknown[], number][]) {
    const existing = products(codes);
    const original = structuredClone(existing);
    assert.equal(allocateProductCodes('outlet', mapped(), existing)[0]?.fields.code, expected);
    assert.deepEqual(existing, original);
  }
  assert.throws(() => allocateProductCodes('outlet', mapped(), products([Number.MAX_SAFE_INTEGER])), /safe numeric/);
  assert.throws(() => numericSearchCode('9007199254740993'), /safe integer/);
});

test('Excel Search Code is ignored even when blank or nonnumeric', () => {
  for (const value of ['', 'arbitrary', '1e-1', '999']) {
    const cells = [...row]; cells[13] = value;
    const data = validateProductImport(source([cells]), categories, taxes);
    assert.equal(data.canUpload, true);
    assert.equal(allocateProductCodes('outlet', data.documents, products([50]))[0]?.fields.code, 51);
  }
});

test('preview uses only authorized outlet products and shows final assigned fields', async () => {
  const readOutlets: string[] = [];
  const readers = { ...deps, readProducts: async (id: string) => { readOutlets.push(id); return products([50]); } };
  assert.equal((await checkAuthorizedProductImport(null, 'outlet', source(), readers)).status, 401);
  assert.equal((await checkAuthorizedProductImport('user', 'other', source(), readers)).status, 403);
  assert.deepEqual(readOutlets, []);
  const checked = await checkAuthorizedProductImport('user', 'outlet', source(), readers);
  assert.equal(checked.body.data?.documents[0]?.fields.code, 51);
  assert.deepEqual(readOutlets, ['outlet']);
});

test('a stale preview is rejected without writing and can be refreshed', async () => {
  const { store, writer } = memoryWriter();
  const preview = allocateProductCodes('outlet', five(), []);
  store.set('other', { name: 'Concurrent product', code: 50 });
  await assert.rejects(() => persistProductImport('outlet', preview, writer), /changed since preview/);
  assert.equal(store.size, 1);
  const fresh = allocateProductCodes('outlet', five(), await writer.readExisting('outlet'));
  const result = await persistProductImport('outlet', fresh, writer);
  assert.equal(result.created, 5);
  assert.deepEqual([...store.values()].slice(1).map(d => d.code), [51, 52, 53, 54, 55]);
});


test('changing only the Excel code cannot duplicate a previously imported product', async () => {
  const { store, writer } = memoryWriter();
  await persistProductImport('outlet', mapped(), writer);
  const cells = [...row]; cells[13] = '99';
  const checked = await checkAuthorizedProductImport('user', 'outlet', source([cells]), {
    ...deps, readProducts: writer.readExisting,
  });
  assert.equal(checked.status, 409);
  assert.match(checked.body.message ?? '', /already matches/);
  assert.equal(store.size, 1);
});

test('reconciliation preserves a legacy stored numeric string without modifying the record', async () => {
  const { store, writer } = memoryWriter();
  await persistProductImport('outlet', mapped(), writer);
  const [id, saved] = [...store][0]!;
  store.set(id, { ...saved, code: '050' });
  const before = structuredClone(store.get(id));
  const planned = allocateProductCodes('outlet', mapped(), await writer.readExisting('outlet'));
  assert.equal(planned[0]?.fields.code, '050');
  const result = await persistProductImport('outlet', planned, writer);
  assert.equal(result.created, 0); assert.equal(result.existing, 1);
  assert.deepEqual(store.get(id), before);
});
