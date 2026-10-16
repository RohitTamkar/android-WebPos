import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileSelectionError, MAX_FILE_BYTES, MAX_PRODUCT_ROWS, parseProductCsv, PRODUCT_COLUMNS } from '../src/pages/productCsvPreview.ts';

const sample = ['AFGHANI_TAND', 'AFGHANI_TAND', '500', '500', '0', '0', 'TANDDOR_STASTER', '1', '0', '0', 'number', '0', 'no', '1'];
const encode = (cells: readonly string[], delimiter = ',') => cells.map(cell => `"${cell.replaceAll('"', '""')}"`).join(delimiter);
const sheet = (rows: string[][] = [sample], delimiter = ',', headers: readonly string[] = PRODUCT_COLUMNS) => [encode(headers, delimiter), ...rows.map(row => encode(row, delimiter))].join('\r\n');

test('valid CSV retains 14 original cells and legitimate zeros', () => {
  const preview = parseProductCsv(sheet());
  assert.deepEqual(preview.headers, [...PRODUCT_COLUMNS]);
  assert.deepEqual(preview.rows[0]?.cells, sample);
  assert.deepEqual(preview.rows[0]?.errors, []);
  assert.deepEqual(preview.rows[0]?.warnings, []);
  assert.equal(preview.rows[0]?.rowNumber, 2);
});

test('detects comma, tab and semicolon separators', () => {
  for (const delimiter of [',', '\t', ';']) {
    const preview = parseProductCsv(sheet([sample], delimiter));
    assert.equal(preview.delimiter, delimiter);
    assert.equal(preview.headerErrors.length, 0);
    assert.deepEqual(preview.rows[0]?.cells, sample);
  }
});

test('preserves escaped quotes, BOM and header whitespace', () => {
  const row = [...sample];
  row[0] = 'Roll"Special"';
  const headers = PRODUCT_COLUMNS.map(header => ` ${header} `);
  const preview = parseProductCsv('\uFEFF' + sheet([row], ',', headers));
  assert.equal(preview.headerErrors.length, 0);
  assert.deepEqual(preview.rows[0]?.cells, row);
});

test('missing, duplicate, extra, unexpected and reordered headers never remap cells', () => {
  const variants = [
    [...PRODUCT_COLUMNS].slice(1),
    PRODUCT_COLUMNS.map((column, index) => index === 1 ? 'Product Name' : column),
    [...PRODUCT_COLUMNS, 'Premises 1'],
    PRODUCT_COLUMNS.map((column, index) => index === 1 ? 'Unknown' : column),
    [...PRODUCT_COLUMNS].reverse(),
  ];
  for (const headers of variants) {
    const preview = parseProductCsv(sheet([sample], ',', headers));
    assert.ok(preview.headerErrors.length);
    assert.deepEqual(preview.rows[0]?.cells, sample);
    assert.equal(preview.rows[0]?.errors[0]?.column, 'Headers');
  }
});

test('missing header row is reported as header errors', () => {
  assert.ok(parseProductCsv(encode(sample)).headerErrors.length);
});

test('empty files and blank-only files are rejected; blank rows are tracked', () => {
  for (const value of ['', '\n\r\n', ',,,,,,,,,,,,,\n']) assert.throws(() => parseProductCsv(value), /empty|blank/i);
  const preview = parseProductCsv('\n' + sheet([sample, Array(14).fill(''), sample]));
  assert.equal(preview.blankRows, 2);
  assert.deepEqual(preview.rows.map(row => row.rowNumber), [3, 5]);
});

test('blank name and invalid finite-number inputs identify row and column', () => {
  for (const value of ['NaN', 'Infinity', '-Infinity', '1e999', 'abc', '0x10', '=1+2']) {
    const row = [...sample];
    row[0] = '';
    row[2] = value;
    const preview = parseProductCsv(sheet([row]));
    assert.equal(preview.rows[0]?.rowNumber, 2);
    assert.ok(preview.rows[0]?.errors.some(issue => issue.column === 'Product Name'));
    assert.ok(preview.rows[0]?.errors.some(issue => issue.column === 'Default Price'));
    assert.equal(preview.rows[0]?.cells[2], value);
  }
});

test('allowed numeric input retains signs, exponent strings, zeros and optional blanks', () => {
  const row = [...sample];
  row[2] = '+50';
  row[3] = '1e2';
  row[4] = '';
  row[9] = '000123';
  row[13] = '001';
  const result = parseProductCsv(sheet([row])).rows[0]!;
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some(issue => issue.column === 'MRP Price'));
  assert.deepEqual(result.cells, row);
});

test('possible duplicate warnings preserve both original rows', () => {
  const preview = parseProductCsv(sheet([sample, [...sample]]));
  assert.equal(preview.rows.length, 2);
  for (const row of preview.rows) {
    assert.equal(row.errors.length, 0);
    assert.ok(row.warnings.some(issue => issue.message.startsWith('Possible duplicate in uploaded file')));
  }
});

test('same product name with different Search Codes is not flagged as duplicate', () => {
  const other = [...sample];
  other[13] = '2';
  const result = parseProductCsv(sheet([sample, other]));
  assert.ok(result.rows.every(row => !row.errors.length && !row.warnings.length));
});

test('category values are preserved without guessing a category match or ID', () => {
  const row = [...sample];
  row[6] = 'Different_category';
  row[7] = '99';
  const preview = parseProductCsv(sheet([row]));
  assert.equal(preview.rows[0]?.cells[6], 'Different_category');
  assert.equal(preview.rows[0]?.cells[7], '99');
  assert.equal(preview.rows[0]?.errors.length, 0);
});

test('wrong cell count retains missing and extra values for review', () => {
  for (const row of [sample.slice(0, 13), [...sample, 'extra']]) {
    const result = parseProductCsv(sheet([row])).rows[0]!;
    assert.ok(result.errors.some(issue => issue.column === 'Row structure'));
    assert.deepEqual(result.cells, row);
  }
});

test('weightable accepts source yes/no and rejects other nonempty values', () => {
  const row = [...sample];
  row[12] = 'maybe';
  assert.ok(parseProductCsv(sheet([row])).rows[0]?.errors.some(issue => issue.column === 'Weightable'));
});

test('allowed formula-like values are preserved as text without evaluation', () => {
  const row = [...sample];
  row[0] = '=A1+1';
  row[1] = '<tag>';
  const result = parseProductCsv(sheet([row])).rows[0]!;
  assert.deepEqual(result.cells, row);
  assert.ok(result.warnings.some(issue => issue.column === 'Product Name'));
});

test('unsupported, empty, oversized, binary and malformed files are rejected', () => {
  for (const name of ['products.xlsx', 'products.xls', 'products.pdf']) assert.ok(fileSelectionError(name, 100));
  assert.equal(fileSelectionError('products.CSV', 100), null);
  assert.equal(fileSelectionError('products.tsv', 100), null);
  assert.ok(fileSelectionError('products.csv', 0));
  assert.ok(fileSelectionError('products.csv', MAX_FILE_BYTES + 1));
  assert.throws(() => parseProductCsv('a'.repeat(MAX_FILE_BYTES + 1)), /5 MB/);
  assert.throws(() => parseProductCsv('\u0000binary'), /binary/);
  assert.throws(() => parseProductCsv('"unterminated'), /not closed/);
  assert.throws(() => parseProductCsv('abc"def'), /unexpected quote/);
  assert.throws(() => parseProductCsv('"abc"def'), /unexpected text/);
  assert.throws(() => parseProductCsv('"' + 'a'.repeat(20001) + '"'), /cell exceeds/);
});

test('product-row limit enforced and repeated-row diagnostics stay bounded', () => {
  assert.throws(() => parseProductCsv(sheet(Array.from({ length: MAX_PRODUCT_ROWS + 1 }, () => sample))), /10,000/);
  const preview = parseProductCsv(sheet(Array.from({ length: 100 }, () => sample)));
  assert.ok(preview.rows[0]?.warnings[0]?.message.includes('90 more'));
  assert.ok((preview.rows[0]?.warnings[0]?.message.length ?? 0) < 300);
});

test('every prohibited character in a later row blocks the entire result', () => {
  for (const character of "!@#$%^&*()/]'.,") {
    const later = [...sample];
    later[1] = `bad${character}value`;
    assert.throws(() => parseProductCsv(sheet([sample, sample, later])), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /preview blocked/);
      assert.match(error.message, /row 4, column 2 \(Regional Name\)/);
      assert.ok(error.message.includes(JSON.stringify(character)));
      return true;
    });
  }
});

test('edge spaces and non-space whitespace still block the entire preview', () => {
  for (const value of [' name', 'name ', '\tname', 'name\t', 'line\nbreak', 'line\r\nbreak', 'non\u00a0breaking', 'wide\u2003space']) {
    const later = [...sample];
    later[0] = value;
    assert.throws(() => parseProductCsv(sheet([sample, later])), /row 3, column 1 \(Product Name\).*whitespace/);
  }
  assert.throws(() => parseProductCsv(sheet([sample, Array(14).fill(' ')])), /row 3.*whitespace/);
  assert.throws(() => parseProductCsv('   '), /row 1, column 1.*whitespace/);
});

test('structural delimiters, CSV quotation and CR/LF line endings remain valid', () => {
  for (const delimiter of [',', '\t', ';']) {
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = [encode(PRODUCT_COLUMNS, delimiter), encode(sample, delimiter), '', encode(sample, delimiter)].join(ending);
      const preview = parseProductCsv(source);
      assert.equal(preview.rows.length, 2);
      assert.equal(preview.blankRows, 1);
      assert.deepEqual(preview.rows[0]?.cells, sample);
      assert.equal(preview.headerErrors.length, 0);
    }
  }
  assert.equal(fileSelectionError('products.csv', 100), null);
  assert.equal(fileSelectionError('products.tsv', 100), null);
});

test('prohibited content in extra cells or behind header errors is not discarded', () => {
  assert.throws(() => parseProductCsv(sheet([[...sample, 'bad!']])), /column 15.*prohibited character/);
  const headers = [...PRODUCT_COLUMNS].reverse();
  const later = [...sample];
  later[0] = 'bad!value';
  assert.throws(() => parseProductCsv(sheet([sample, later], ',', headers)), /preview blocked.*row 3/);
});

test('decimal points are blocked by the content rule while valid zero values remain accepted', () => {
  const decimal = [...sample];
  decimal[2] = '0.50';
  assert.throws(() => parseProductCsv(sheet([decimal])), /Default Price.*prohibited character "\."/);
  assert.deepEqual(parseProductCsv(sheet()).rows[0]?.cells, sample);
});

test('the four supplied product names pass with original spaces, zero values, no and number', () => {
  const names = ['PAPAD ROASTED', 'MASALA PAPAD', 'FRY PAPAD', 'ONION SALAD'];
  const prices = ['20', '80', '30', '50'];
  const rows = names.map((name, index) => {
    const row = [...sample];
    row[0] = name;
    row[1] = name;
    row[2] = prices[index]!;
    row[3] = prices[index]!;
    row[6] = 'VEG STARTER';
    row[13] = String(index + 1);
    return row;
  });
  for (const delimiter of [',', '\t']) {
    const preview = parseProductCsv(sheet(rows, delimiter));
    assert.equal(preview.headerErrors.length, 0);
    assert.equal(preview.rows.length, 4);
    preview.rows.forEach((row, index) => {
      assert.deepEqual(row.cells, rows[index]);
      assert.deepEqual(row.errors, []);
      assert.deepEqual(row.warnings, []);
      assert.equal(row.cells[10], 'number');
      assert.equal(row.cells[12], 'no');
      assert.equal(row.cells[11], '0');
    });
  }
});

test('name spaces are preserved while spaces in numeric or identifier columns remain rejected', () => {
  const row = [...sample]; row[0] = 'PAPAD  ROASTED';
  assert.equal(parseProductCsv(sheet([row])).rows[0]?.cells[0], 'PAPAD  ROASTED');
  for (const index of [2, 7, 9, 10, 11, 12, 13]) {
    const bad = [...sample]; bad[index] = 'two values';
    assert.throws(() => parseProductCsv(sheet([bad])), /whitespace/);
  }
});

test('completely empty trailing rows are skipped but partial rows remain visible and invalid', () => {
  const truncated = ['PAPAD ROASTED', 'PAPAD ROASTED', '20'];
  const missingName = [...sample]; missingName[0] = '';
  const preview = parseProductCsv(sheet([sample, truncated, missingName, Array(14).fill(''), []]) + '\r\n\r\n');
  assert.equal(preview.rows.length, 3);
  assert.ok(preview.blankRows >= 2);
  assert.equal(preview.rows[1]?.rowNumber, 3);
  assert.ok(preview.rows[1]?.errors.some(issue => issue.column === 'Row structure'));
  assert.ok(preview.rows[2]?.errors.some(issue => issue.column === 'Product Name'));
});

test('worker returns only an error, never partial preview data, for a later-row violation', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'self');
  let result: { preview?: unknown; error?: string } = {};
  const scope = {
    onmessage: null as null | ((event: { data: File }) => Promise<void>),
    postMessage(message: typeof result) { result = message; },
  };
  Object.defineProperty(globalThis, 'self', { value: scope, configurable: true });
  try {
    await import('../src/pages/productCsvPreview.worker.ts');
    assert.ok(scope.onmessage);
    await scope.onmessage({ data: new File([sheet()], 'products.csv') });
    assert.ok(result.preview);
    const later = [...sample];
    later[13] = 'bad#code';
    await scope.onmessage({ data: new File([sheet([sample, later])], 'products.csv') });
    assert.equal('preview' in result, false);
    assert.match(result.error ?? '', /row 3, column 14 \(Search Code\).*prohibited character/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'self', original);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
