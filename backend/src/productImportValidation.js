import { createHash } from 'node:crypto';
import { productFields } from './productDefaults.js';
import { parseProductCsv, namedPremisesHeaders, premisesPriceKey } from '../../frontend/src/pages/productCsvPreview.js';
import { categoryNameKey, planImportCategories } from './productImportCategories.js';
// Approved for user-triggered, create-only imports into the existing PRODUCT collection.
export const PRODUCT_IMPORT_WRITES_ENABLED = true;
// Automatic Search Codes do not distinguish otherwise identical products.
const identityFields = ['name', 'regionalName', 'price', 'priceTable', 'mrpPrice', 'costPrice', 'category', 'taxIndex', 'barcode', 'unitId', 'currentStock', 'weighable'];
export function productIdentity(fields) {
    return JSON.stringify(identityFields.map(key => fields[key]));
}
export function validateProductImport(source, categories, taxes = [], mode = 'standard') {
    const preview = parseProductCsv(source, mode);
    const documents = [];
    const rows = preview.rows.map(row => ({ rowNumber: row.rowNumber, errors: [...row.errors] }));
    if (preview.headerErrors.length || !rows.length || rows.some(row => row.errors.length)) {
        return { canUpload: false, categoryChecked: false, headerErrors: preview.headerErrors, rows, documents };
    }
    const premisesNames = mode === 'premises' ? namedPremisesHeaders(preview.headers) : [];
    if (mode === 'premises' && !premisesNames.length)
        return { canUpload: false, categoryChecked: false, headerErrors: ['Use named premises price columns, such as AC Table and Non AC Table, to upload. Legacy Premises columns remain preview-only.'], rows, documents };
    const identities = new Map();
    preview.rows.forEach((row, index) => {
        const c = row.cells.map(cell => cell.trim());
        const errors = rows[index].errors;
        for (const column of [2, 3, 4, 5, 7, 8, 11]) {
            if (!c[column]?.trim() || !Number.isFinite(Number(c[column])))
                errors.push({ column: preview.headers[column], message: 'A finite numeric value is required to construct the product.' });
        }
        if (Number(c[2]) !== Number(c[3]))
            errors.push({ column: 'Price 1', message: 'Price 1 must equal Default Price for the supplied single-entry priceTable. A separate Price 1 mapping has not been supplied.' });
        if (c[10]?.toLowerCase() !== 'number')
            errors.push({ column: 'Unit Type', message: 'Only number (unitId 2) is supported by the supplied product template.' });
        if (Number(c[11]) !== 0)
            errors.push({ column: 'Stock', message: 'Only zero opening stock is supported until the stock-initialization workflow is specified.' });
        if (!['yes', 'no'].includes(c[12]?.toLowerCase() ?? ''))
            errors.push({ column: 'Weightable', message: 'Weightable must be yes or no.' });
        const matches = categories.filter(category => categoryNameKey(category.name) === categoryNameKey(c[6] ?? ''));
        if (matches.length !== 1) {
            const numbered = categories.filter(category => category.categoryNo === Number(c[7]));
            const message = numbered.length === 1
                ? `Category No ${c[7]} is named ${JSON.stringify(numbered[0].name)}, but the file says ${JSON.stringify(c[6])}. Use the existing category name in the file.`
                : 'Name and number must identify exactly one existing category in this outlet.';
            errors.push({ column: 'Category Name / Category No', message });
        }
        const tax = taxes.filter(tax => tax.type === 0 && tax.percent === Number(c[8]));
        if (tax.length !== 1)
            errors.push({ column: 'Tax', message: 'Tax must identify exactly one GST percentage in the existing TAX_MASTER.' });
        if (errors.length)
            return;
        const fields = productFields({
            name: c[0], regionalName: c[1], price: Number(c[2]), mrpPrice: Number(c[4]),
            costPrice: Number(c[5]), category: matches[0].id, discount: 0, shortName: '',
            taxIndex: tax[0].index, hsnCode: '', unitId: 2,
            weighable: c[12].toLowerCase() === 'yes', stockable: false,
        }, index + 1, c[9]);
        if (premisesNames.length)
            fields.priceTable = JSON.stringify({ ...JSON.parse(fields.priceTable),
                ...Object.fromEntries(premisesNames.map((name, index) => [premisesPriceKey(name), Number(c[14 + index])])) });
        const identity = productIdentity(fields);
        const first = identities.get(identity);
        if (first !== undefined) {
            errors.push({ column: 'Entire row', message: `Repeated product matches spreadsheet row ${first}; duplicate rows must be resolved before upload.` });
            return;
        }
        identities.set(identity, row.rowNumber);
        documents.push({ rowNumber: row.rowNumber, fields, sourceIdentity: JSON.stringify(premisesNames.length ? [premisesNames, c] : c) });
    });
    const canUpload = rows.every(row => !row.errors.length);
    return { canUpload, categoryChecked: true, headerErrors: [], rows, documents: canUpload ? documents : [] };
}
export async function checkAuthorizedProductImport(profileId, outletId, source, deps, acceptAttempt, mode = 'standard') {
    if (!profileId)
        return { status: 401, body: { success: false, message: 'Your session has expired. Please sign in again.' } };
    if (!outletId || outletId.includes('/'))
        return { status: 400, body: { success: false, message: 'A valid outlet is required.' } };
    const profile = await deps.readProfile(profileId);
    if (!profile || profile.active !== true)
        return { status: 403, body: { success: false, message: 'This user account is inactive or unavailable.' } };
    if (!deps.assignedOutlets(profile).includes(outletId))
        return { status: 403, body: { success: false, message: 'You do not have access to this outlet.' } };
    acceptAttempt?.();
    if (typeof source !== 'string')
        return { status: 400, body: { success: false, message: 'The original spreadsheet text is required.' } };
    let local;
    try {
        local = validateProductImport(source, [], [], mode);
    }
    catch (error) {
        return { status: 400, body: { success: false, message: error instanceof Error ? error.message : 'Invalid spreadsheet.' } };
    }
    if (!local.categoryChecked)
        return { status: 422, body: { success: false, data: local } };
    const [categories, taxes] = await Promise.all([deps.readCategories(outletId), deps.readTaxes()]);
    const plan = planImportCategories(source, categories, mode);
    const data = { ...validateProductImport(source, plan.previewCategories, taxes, mode), categorySummary: { reused: plan.reused, toCreate: plan.missing.length } };
    if (plan.issues.length) {
        for (const row of data.rows)
            row.errors.push(...plan.issues.filter(issue => issue.rowNumber === row.rowNumber).map(({ column, message }) => ({ column, message })));
        data.canUpload = false;
        data.documents = [];
    }
    if (data.canUpload) {
        const existing = await deps.readProducts(outletId);
        try {
            data.documents = allocateProductCodes(outletId, data.documents, existing);
        }
        catch (error) {
            return { status: 409, body: { success: false, message: error instanceof Error ? error.message : 'Unable to allocate Search Codes safely.' } };
        }
    }
    return { status: data.canUpload ? 200 : 422, body: { success: data.canUpload, data } };
}
// Search Codes are numeric safe integers; legacy numeric strings are read without rewriting them.
export function numericSearchCode(value) {
    if (typeof value !== 'number' && typeof value !== 'string')
        return null;
    if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))
        return null;
    const code = Number(value);
    if (!Number.isFinite(code) || !Number.isInteger(code))
        return null;
    if (!Number.isSafeInteger(code))
        throw new Error('An existing numeric Search Code exceeds the safe integer range. No products were overwritten.');
    return code;
}
export function nextProductCode(existing) {
    let highest = 0;
    for (const record of existing)
        highest = Math.max(highest, numericSearchCode(record.fields.code) ?? 0);
    if (!Number.isSafeInteger(highest + 1))
        throw new Error('No safe numeric Search Codes remain.');
    return highest + 1;
}
export function allocateProductCodes(outletId, documents, existing) {
    let highest = 0;
    for (const record of existing)
        highest = Math.max(highest, numericSearchCode(record.fields.code) ?? 0);
    const byId = new Map(existing.map(record => [record.id, record]));
    const byIdentity = new Map(existing.map(record => [productIdentity(record.fields), record]));
    return documents.map(document => {
        // Keep the established hash and source-row convention for reconciliation after timeouts.
        const id = typeof document.fields.id === 'string' ? document.fields.id : createHash('sha256').update(`${outletId}\n${document.sourceIdentity ?? JSON.stringify([...JSON.parse(productIdentity(document.fields)), document.fields.code])}`).digest('hex').slice(0, 20);
        const saved = byId.get(id);
        const duplicate = byIdentity.get(productIdentity(document.fields));
        if (duplicate && duplicate.id !== id)
            throw new Error(`Row ${document.rowNumber} already matches an existing product. No products were overwritten.`);
        if (saved) {
            const expected = { ...document.fields, id };
            if (Object.keys(saved.fields).filter(key => key !== 'dateTme').length !== Object.keys(expected).length
                || Object.entries(expected).some(([key, value]) => key !== 'code' && saved.fields[key] !== value)
                || numericSearchCode(saved.fields.code) === null) {
                throw new Error('An existing product differs from the planned import. It will not be overwritten.');
            }
            return { ...document, fields: { ...expected, code: saved.fields.code } };
        }
        if (!Number.isSafeInteger(highest + 1))
            throw new Error('No safe numeric Search Codes remain.');
        return { ...document, fields: { ...document.fields, id, code: ++highest } };
    });
}
export function assertPreviewCodes(expected, actual) {
    if (expected.length !== actual.length || expected.some((document, index) => document.rowNumber !== actual[index]?.rowNumber || document.fields.code !== actual[index]?.fields.code)) {
        throw new Error('Search Codes changed since preview. Review the updated preview before uploading again.');
    }
}
export async function persistProductImport(outletId, documents, writer) {
    if (!writer.enabled)
        return { success: false, created: 0, existing: 0, confirmedRows: [], unconfirmedRows: documents.map(d => d.rowNumber), message: 'Production upload is disabled pending review and approval.' };
    if (!documents.length)
        throw new Error('No fully validated products to import.');
    const planned = allocateProductCodes(outletId, documents, await writer.readExisting(outletId));
    if (documents.every(document => document.fields.id))
        assertPreviewCodes(documents, planned);
    let created = 0, reused = 0;
    const confirmedRows = [];
    for (let index = 0; index < planned.length; index += 100) {
        const chunk = planned.slice(index, index + 100);
        try {
            const result = await writer.createChunk(outletId, chunk);
            created += result.created;
            reused += result.existing;
            confirmedRows.push(...chunk.map(document => document.rowNumber));
        }
        catch {
            return { success: false, created, existing: reused, confirmedRows, unconfirmedRows: planned.slice(index).map(document => document.rowNumber),
                message: 'Import stopped. Later rows have an unconfirmed outcome. Retrying the same file reconciles the same document IDs without overwriting products.' };
        }
    }
    return { success: true, created, existing: reused, confirmedRows, unconfirmedRows: [], message: `${created} products added; ${reused} already confirmed from this import.` };
}
//# sourceMappingURL=productImportValidation.js.map