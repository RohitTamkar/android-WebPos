import assert from 'node:assert/strict';
import test from 'node:test';
import { productPremisesPrices } from '../src/pages/productPremisesPrices.ts';

test('Android price keys match configured premises and display each saved price once', () => {
  assert.deepEqual(productPremisesPrices([{ name: 'AC Table' }, { name: 'TABLE' }], {
    'default price': 20, 'AC Table price': 40, 'TABLE price': 20,
  }), [
    { name: 'AC Table', label: 'AC Table Price', price: 40 },
    { name: 'TABLE', label: 'TABLE Price', price: 20 },
  ]);
});

test('case and whitespace differences do not duplicate configured names or saved keys', () => {
  assert.deepEqual(productPremisesPrices([{ name: ' AC  Table ' }, { name: 'ac table' }], {
    ' default PRICE ': 10, ' AC  TABLE  PRICE ': 0,
  }), [{ name: 'AC Table', label: 'AC Table Price', price: 0 }]);
});

test('Android keys take precedence over plain-name aliases without modifying stored data', () => {
  const table = { 'default price': 20, TABLE: 10, 'TABLE price': 40 };
  const before = structuredClone(table);
  for (const entries of [table, Object.fromEntries(Object.entries(table).reverse())]) {
    assert.deepEqual(productPremisesPrices([{ name: 'TABLE' }], entries), [{ name: 'TABLE', label: 'TABLE Price', price: 40 }]);
  }
  assert.deepEqual(table, before);
});

test('unconfigured saved premises remain visible once, with zero and string values preserved', () => {
  assert.deepEqual(productPremisesPrices([], { TABLE: 10, 'TABLE price': '20.00', 'AC Table price': 0 }), [
    { name: 'TABLE', label: 'TABLE Price', price: '20.00' },
    { name: 'AC Table', label: 'AC Table Price', price: 0 },
  ]);
});

test('unsaved prices remain empty and an existing premise ending in Price retains its name', () => {
  assert.deepEqual(productPremisesPrices([{ name: 'TABLE' }, { name: 'Fixed Price' }], { 'Fixed Price': 30 }), [
    { name: 'TABLE', label: 'TABLE Price', price: undefined },
    { name: 'Fixed Price', label: 'Fixed Price', price: 30 },
  ]);
});
