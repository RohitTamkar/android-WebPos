import { goodsTransactionRecord } from './goodsTransaction.js';
export function stockDirection(data) {
    const type = typeof data.type === 'string' ? data.type.trim().toUpperCase().replace(/[\s_]+/g, '-') : '';
    if (type === 'STOCK-IN')
        return 'in';
    if (type === 'STOCK-OUT')
        return 'out';
    return null;
}
export function stockMovementRecord(documentId, data) {
    // Normalize the existing GOODS_RECEIVED transaction fields.
    const goods = goodsTransactionRecord(documentId, data);
    return { ...goods, direction: stockDirection(data) };
}
//# sourceMappingURL=stockMovementReport.js.map