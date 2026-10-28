import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { premisesPriceKey } from '../../frontend/src/pages/productCsvPreview.js';
const nameKey = (name) => name.trim().replace(/\s+/gu, ' ').toLowerCase();
// Pure plan, used only inside the product transaction after authorization and all reads.
// Header names do not specify table counts: new premises use the existing Bill type.
export function planImportPremises(outletId, profileId, names, existing, documents) {
    const records = [...existing];
    const creates = [];
    const codes = existing.map(record => record.fields.code).filter((code) => typeof code === 'number' && Number.isSafeInteger(code));
    let code = Math.max(0, ...codes);
    for (const name of names) {
        const matches = records.filter(record => typeof record.fields.name === 'string' && nameKey(record.fields.name) === nameKey(name));
        if (matches.length > 1)
            throw new Error(`Multiple premises match ${JSON.stringify(name)}. Resolve duplicate premises names before importing.`);
        if (matches.length === 1)
            continue;
        if (!Number.isSafeInteger(++code))
            throw new Error('No safe premises code is available.');
        const id = createHash('sha256').update(`premises-import:${outletId}:${nameKey(name)}`).digest('hex').slice(0, 20);
        if (records.some(record => record.id === id))
            throw new Error('An existing premises conflicts with the import. Reload and review it.');
        const fields = { code, createdTime: Timestamp.now(), extraPriceFlag: false, id: null, name, price: 0,
            range: 1, tables: 1, taxIndex: 1, type: 'Bill', userId: profileId };
        const record = { id, fields };
        records.push(record);
        creates.push(record);
    }
    for (const document of documents) {
        const table = JSON.parse(String(document.fields.priceTable));
        for (const name of names) {
            const price = table[premisesPriceKey(name)];
            if (typeof price !== 'number' || !Number.isFinite(price) || price < 0)
                throw new Error('A premises price is invalid. No products were saved.');
        }
    }
    return creates;
}
//# sourceMappingURL=productImportPremises.js.map