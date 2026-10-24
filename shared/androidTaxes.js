// Android TaxTable IDs are the numeric taxIndex stored on products and premises.
// This catalog supplies form choices only; it never seeds or updates TAX_MASTER.
export const ANDROID_TAX_OPTIONS = [
    { index: 1, name: 'GST 0', percent: 0, type: 0 },
    { index: 2, name: 'GST 5', percent: 5, type: 1 },
    { index: 3, name: 'GST 12', percent: 12, type: 1 },
    { index: 4, name: 'GST 18', percent: 18, type: 1 },
    { index: 5, name: 'GST 28', percent: 28, type: 1 },
    { index: 6, name: 'VAT 22', percent: 22, type: 2 },
    { index: 7, name: 'VAT 10', percent: 10, type: 2 },
    { index: 8, name: 'GST 3', percent: 3, type: 1 },
    { index: 9, name: 'GST 2', percent: 2, type: 1 },
    { index: 10, name: 'GST 40', percent: 40, type: 1 },
    { index: 11, name: 'GST 8', percent: 8, type: 1 },
    { index: 12, name: 'GST 1', percent: 1, type: 1 },
];
//# sourceMappingURL=androidTaxes.js.map