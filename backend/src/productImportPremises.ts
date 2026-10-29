import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { premisesPriceKey } from '../../frontend/src/pages/productCsvPreview.js';
import type { ImportDocument } from './productImportValidation.js';

const nameKey = (name: string) => name.trim().replace(/\s+/gu, ' ').toLowerCase();

// Pure plan, used only inside the product transaction after authorization and all reads.
// Header names do not specify table counts: new premises use the existing Bill type.
export function planImportPremises(outletId: string, profileId: string, names: string[],
  existing: { id: string; fields: Record<string, unknown> }[], documents: ImportDocument[]) {
  const records = [...existing];
  const creates: { id: string; fields: Record<string, unknown> }[] = [];
  const codes = existing.map(record => record.fields.code).filter((code): code is number => typeof code === 'number' && Number.isSafeInteger(code));
  let code = Math.max(0, ...codes);
  const priceKeys: string[] = [];
  for (const name of names) {
    const matches = records.filter(record => typeof record.fields.name === 'string' && nameKey(record.fields.name) === nameKey(name));
    if (matches.length > 1) throw new Error(`Multiple premises match ${JSON.stringify(name)}. Resolve duplicate premises names before importing.`);
    if (matches.length === 1) { priceKeys.push(premisesPriceKey(String(matches[0]!.fields.name).trim().replace(/\s+/gu, ' '))); continue; }
    priceKeys.push(premisesPriceKey(name));
    if (!Number.isSafeInteger(++code)) throw new Error('No safe premises code is available.');
    const id = createHash('sha256').update(`premises-import:${outletId}:${nameKey(name)}`).digest('hex').slice(0, 20);
    if (records.some(record => record.id === id)) throw new Error('An existing premises conflicts with the import. Reload and review it.');
    const fields = { code, createdTime: Timestamp.now(), extraPriceFlag: false, id: null, name, price: 0,
      range: 1, tables: 1, taxIndex: 1, type: 'Bill', userId: profileId };
    const record = { id, fields };
    records.push(record); creates.push(record);
  }
  for (const document of documents) {
    const table = JSON.parse(String(document.fields.priceTable)) as Record<string, unknown>;
    for (const key of priceKeys) {
      const price = table[key];
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) throw new Error('A premises price is invalid. No products were saved.');
    }
  }
  return creates;
}

// Headers match premises in any letter case, but Android reads prices by the exact
// "<premises name> price" key. Copies use each existing premise's stored spelling;
// inputs are never mutated, so a retried transaction sees the original documents.
export function withStoredPremisesNames(names: string[], existing: { fields: Record<string, unknown> }[], documents: ImportDocument[]) {
  const renames = names.flatMap(name => {
    const match = existing.find(record => typeof record.fields.name === 'string' && nameKey(record.fields.name) === nameKey(name));
    const stored = match ? String(match.fields.name).trim().replace(/\s+/gu, ' ') : undefined;
    return stored && premisesPriceKey(stored) !== premisesPriceKey(name) ? [[premisesPriceKey(name), premisesPriceKey(stored)] as const] : [];
  });
  if (!renames.length) return documents;
  return documents.map(document => {
    const table = JSON.parse(String(document.fields.priceTable)) as Record<string, unknown>;
    for (const [from, to] of renames) if (from in table) { const price = table[from]; delete table[from]; table[to] = price; }
    return { ...document, fields: { ...document.fields, priceTable: JSON.stringify(table) } };
  });
}
