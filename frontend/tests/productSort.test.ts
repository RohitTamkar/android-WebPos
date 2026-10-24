import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productDate, sortProducts } from '../src/pages/productSort.ts';

const products = [
  { id: 'a', fields: { code: '10', name: 'banana', regionalName: 'ಬಾಳೆ', dateTme: { _seconds: 200 } } },
  { id: 'b', fields: { code: '2', name: 'Apple', regionalName: '', dateTme: { seconds: 300 } } },
  { id: 'c', fields: { code: 1, name: '', regionalName: 'Aam', dateTme: null } },
  { id: 'd', fields: { code: '3', name: 'apple', regionalName: 'Aam', dateTme: 250 } },
];
const order = (sort: Parameters<typeof sortProducts>[1]) => sortProducts(products, sort).map(product => product.id).join('');

test('Search Code sorts codes numerically regardless of string or number storage', () => assert.equal(order('code'), 'cbda'));
test('Sort A-Z ignores case, ties fall back to code, blank names last', () => assert.equal(order('name'), 'bdac'));
test('Sort By Date is newest first with undated products last', () => assert.equal(order('date'), 'bdac'));
test('Regional Wise sorts regional names with blanks last', () => assert.equal(order('regional'), 'cdab'));
test('sorting does not mutate the input', () => { sortProducts(products, 'name'); assert.deepEqual(products.map(product => product.id), ['a', 'b', 'c', 'd']); });
test('dates parse Firestore JSON, seconds, millis and ISO text', () => {
  assert.equal(productDate({ _seconds: 5, _nanoseconds: 1 }), 5000);
  assert.equal(productDate(1_700_000_000), 1_700_000_000_000);
  assert.equal(productDate(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(productDate('2026-01-01T00:00:00Z'), Date.UTC(2026, 0, 1));
  for (const value of [undefined, null, '', 'nope', {}, { seconds: 'x' }]) assert.equal(productDate(value), null);
});
