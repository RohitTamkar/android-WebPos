import { goodsTransactionRecord } from './goodsTransaction.js';
// Require an explicit transfer marker in the existing goods transaction.
// Stock-in, stock-out, and return records alone do not establish a transfer.
export function isStockTransfer(data) {
    return [data.type, data.addType].some(value => typeof value === 'string'
        && /(?:^|[\s_-])transfers?(?:$|[\s_-])/i.test(value.trim()));
}
export function stockTransferRecord(documentId, data) {
    const { transactionNo, ...goods } = goodsTransactionRecord(documentId, data);
    // Preserve any recorded transfer references without assuming outlet field names.
    const references = Object.entries(data)
        .filter(([key]) => /^(from|to|source|destination|outlet|transfer)/i.test(key)
        && !['total', 'source', 'type'].includes(key))
        .map(([field, value]) => ({
        field,
        value: value === null || value === undefined ? ''
            : typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
    return { ...goods, transferNo: transactionNo, references };
}
//# sourceMappingURL=stockTransferReport.js.map