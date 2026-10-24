import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeCategoryNumbers, proposeProductCodes } from '../src/pages/transferNumberProposals.ts';
// These existing helpers are pure. Importing this module does not initialize Firebase or run persistence.
import { nextProductCode } from '../../backend/src/productImportValidation.js';
const category = (id, categoryNo, name = id) => ({ id, categoryNo, name });
const product = (id, code, name = id, barcode = '') => ({ documentId: id, fields: { code, name, barcode, currentStock: 123 } });
const deepFreeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; };

test('destination 1–10 proposes 11 even when the source number is already used', () => {
  const proposal = proposeCategoryNumbers([category('rolls', 1, 'VEG ROLLS')], Array.from({ length: 10 }, (_, i) => category(`dest-${i}`, i + 1)))[0];
  assert.equal(proposal.proposed, 11); assert.deepEqual(proposal.conflicts, []); assert.equal(proposal.error, '');
});
test('multiple category proposals are unique and follow highest-plus-one, not gap filling', () => {
  const selected = [category('a', 1), category('b', 1), category('c', 500)];
  assert.deepEqual(proposeCategoryNumbers(selected, [category('d1', 1), category('d2', 10)]).map(p => p.proposed), [11, 12, 13]);
  assert.deepEqual(proposeCategoryNumbers(selected, [category('custom', 250)]).map(p => p.proposed), [251, 252, 253]);
});
test('category name matches stay visible without merging or suppressing the number proposal', () => {
  const proposal = proposeCategoryNumbers([category('source', 1, ' Meals ')], [category('different-id', 99, 'MEALS')])[0];
  assert.equal(proposal.proposed, 100); assert.match(proposal.conflicts[0], /already present in the destination/);
  assert.ok(!Object.hasOwn(proposal, 'destinationId'));
});
test('product source-code collisions do not create identity conflicts or block proposals', () => {
  const proposals = proposeProductCodes([product('a', 1), product('b', 10)], [product('dest-1', 1), product('dest-2', 10)]);
  assert.deepEqual(proposals.map(p => p.proposed), [11, 12]); assert.ok(proposals.every(p => !p.conflicts.length));
});
test('product codes match the existing backend nextProductCode algorithm, including numeric strings and custom codes', () => {
  for (const codes of [[], [1, 10], ['1', '0030'], ['2e2', '100'], [1, 'legacy', -1, null, 4.5], [9999]]) {
    const destination = codes.map((code, index) => product(`dest-${index}`, code));
    const expected = nextProductCode(destination.map(p => ({ id: p.documentId, fields: p.fields })));
    assert.deepEqual(proposeProductCodes([product('a', 1), product('b', 2)], destination).map(p => p.proposed), [expected, expected + 1]);
  }
});
test('product names and barcodes are separate warnings, not automatic identity matches', () => {
  const proposal = proposeProductCodes([product('source', 1, 'Coffee', 'BAR')], [product('dest', 10, 'Coffee', 'BAR')])[0];
  assert.equal(proposal.proposed, 11); assert.equal(proposal.conflicts.length, 2);
  assert.match(proposal.conflicts[0], /^Product .* is already present/); assert.match(proposal.conflicts[1], /barcode .* is already present/);
});
test('blank and known placeholder barcodes do not create false identity warnings', () => {
  for (const code of ['', '0', ' 0 ']) assert.deepEqual(proposeProductCodes([product('a', 1, 'A', code)], [product('b', 5, 'B', code)])[0].conflicts, []);
});
test('category numbers and product codes use their own destination datasets', () => {
  assert.equal(proposeCategoryNumbers([category('a', 1)], [category('d', 10)])[0].proposed, 11);
  assert.equal(proposeProductCodes([product('a', 1)], [product('d', 500)])[0].proposed, 501);
});
test('safe integer exhaustion is reported instead of creating invalid or duplicate proposals', () => {
  const categoryProposals = proposeCategoryNumbers([category('a', 1), category('b', 2)], [category('d', Number.MAX_SAFE_INTEGER - 1)]);
  assert.equal(categoryProposals[0].proposed, Number.MAX_SAFE_INTEGER); assert.equal(categoryProposals[1].proposed, null); assert.ok(categoryProposals[1].error);
  assert.equal(proposeProductCodes([product('a', 1)], [product('d', Number.MAX_SAFE_INTEGER)])[0].proposed, null);
  assert.equal(proposeProductCodes([product('a', 1)], [product('d', Number.MAX_SAFE_INTEGER + 1)])[0].proposed, null);
});
test('empty destinations, repeated selections and deselection remain deterministic', () => {
  assert.deepEqual(proposeCategoryNumbers([category('a', 5), category('a', 5)], []).map(p => p.proposed), [1]);
  assert.deepEqual(proposeProductCodes([product('a', 88), product('b', 4)], []).map(p => p.proposed), [1, 2]);
  assert.deepEqual(proposeProductCodes([], []), []);
});
test('proposals do not copy stock or change any source/destination records', () => {
  const source = deepFreeze([product('a', 1)]), destination = deepFreeze([product('d', 1)]);
  const before = JSON.stringify({ source, destination }); const proposals = proposeProductCodes(source, destination);
  assert.equal(JSON.stringify({ source, destination }), before);
  assert.ok(proposals.every(p => !('currentStock' in p) && !('fields' in p)));
});
