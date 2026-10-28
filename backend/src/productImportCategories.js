import { parseProductCsv } from '../../frontend/src/pages/productCsvPreview.js';
import { categoryCreationFields, categoryCreationSchema } from './categoryCreation.js';
import { ProductCreationError, requireProductOutlet } from './productCreation.js';
export const categoryNameKey = (name) => name.trim().toLowerCase();
export function planImportCategories(source, existing, mode = 'standard') {
    const preview = parseProductCsv(source, mode);
    const issues = [];
    const entries = [];
    const byName = new Map();
    const existingNames = new Map();
    let highestNumber = 0;
    for (const category of existing) {
        if (category.categoryNo !== null && Number.isSafeInteger(category.categoryNo)) {
            highestNumber = Math.max(highestNumber, category.categoryNo);
        }
        const name = categoryNameKey(category.name);
        existingNames.set(name, [...(existingNames.get(name) ?? []), category]);
    }
    const addIssue = (rowNumber, message) => issues.push({ rowNumber, column: 'Category Name / Category No', message });
    for (const row of preview.rows) {
        const name = row.cells[6]?.trim() ?? '';
        if (!categoryCreationSchema.safeParse({ name, categoryNo: 1 }).success) {
            addIssue(row.rowNumber, 'Enter a category name of up to 200 characters.');
            continue;
        }
        const key = categoryNameKey(name);
        const previous = byName.get(key);
        if (previous) {
            previous.rows.push(row.rowNumber);
            continue;
        }
        const entry = { name, categoryNo: 0, rows: [row.rowNumber] };
        byName.set(key, entry);
        entries.push(entry);
    }
    for (const entry of entries) {
        const matches = existingNames.get(categoryNameKey(entry.name)) ?? [];
        if (matches.length > 1) {
            entry.rows.forEach(row => addIssue(row, `Category ${JSON.stringify(entry.name)} matches multiple existing documents. Resolve the duplicate category names before importing.`));
        }
        else if (matches.length === 1) {
            entry.id = matches[0].id;
            entry.categoryNo = matches[0].categoryNo ?? 0;
        }
        else {
            // Like Category Master, allocate after the highest stored number. Sheet
            // category numbers do not override existing records or reserve numbers.
            entry.categoryNo = ++highestNumber;
            if (!Number.isSafeInteger(entry.categoryNo)) {
                entry.rows.forEach(row => addIssue(row, 'No safe category number is available.'));
            }
        }
    }
    const missing = entries.filter(entry => !entry.id);
    // Read-only preview references are internal planning values only. Confirmation
    // replaces them with persisted auto-IDs before the product writer is called.
    const previewCategories = [...existing, ...missing.map(entry => ({ id: `pending-category-${entry.categoryNo}`, name: entry.name, categoryNo: entry.categoryNo }))];
    return { entries, issues, missing, previewCategories, reused: entries.length - missing.length };
}
export async function resolveImportCategories(db, outletId, profileId, assigned, source, mode = 'standard') {
    // Validate paths before constructing references. The transaction rechecks access.
    if (!profileId || !outletId || outletId.includes('/') || outletId === '.' || outletId === '..') {
        requireProductOutlet(profileId, outletId, undefined, assigned);
        throw new Error('Invalid outlet.');
    }
    const collection = db.collection('OUTLET').doc(outletId).collection('CATEGORY');
    let created = 0, reused = 0;
    let unresolvedRows = [];
    for (;;) {
        try {
            const result = await db.runTransaction(async (transaction) => {
                const profile = (await transaction.get(db.collection('USER_PROFILE').doc(profileId))).data();
                requireProductOutlet(profileId, outletId, profile, assigned);
                const outlet = (await transaction.get(db.collection('OUTLET').doc(outletId))).data();
                if (outlet?.active !== true)
                    throw new ProductCreationError(403, 'This outlet is inactive or unavailable.');
                const snapshot = await transaction.get(collection);
                const categories = snapshot.docs.map(document => ({ id: document.id,
                    name: typeof document.data().name === 'string' ? document.data().name : '',
                    categoryNo: typeof document.data().categoryNo === 'number' ? document.data().categoryNo : null }));
                const plan = planImportCategories(source, categories, mode);
                unresolvedRows = plan.missing.flatMap(entry => entry.rows);
                reused = Math.max(0, plan.reused - created);
                if (plan.issues.length)
                    return { categories, plan, created: 0 };
                const batch = plan.missing.slice(0, 100);
                for (const entry of batch) {
                    const reference = collection.doc();
                    const fields = categoryCreationFields(reference.id, categoryCreationSchema.parse({ name: entry.name, categoryNo: entry.categoryNo }));
                    transaction.create(reference, fields);
                    categories.push({ id: reference.id, name: fields.name, categoryNo: fields.categoryNo });
                }
                return { categories, plan, created: batch.length };
            });
            created += result.created;
            reused = Math.max(0, result.plan.reused - (created - result.created));
            if (result.plan.issues.length)
                return { success: false, categories: result.categories, created, reused, issues: result.plan.issues };
            if (result.plan.missing.length <= result.created)
                return { success: true, categories: result.categories, created, reused, issues: [] };
        }
        catch (error) {
            const message = error instanceof Error && /access|session|outlet/i.test(error.message) ? error.message
                : 'Category creation could not be confirmed. No products were attempted; retry the same file to reuse categories already created.';
            return { success: false, categories: [], created, reused, issues: parseProductCsv(source, mode).rows
                    .filter(row => !unresolvedRows.length || unresolvedRows.includes(row.rowNumber))
                    .map(row => ({ rowNumber: row.rowNumber, column: 'Category Name / Category No', message })) };
        }
    }
}
//# sourceMappingURL=productImportCategories.js.map