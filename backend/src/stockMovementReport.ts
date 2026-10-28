import { goodsTransactionRecord } from './goodsTransaction.js';

export interface ProductRate { price: number; cost: number }

export function stockDirection(data: Record<string, unknown>): 'in' | 'out' | null {
  const type = typeof data.type === 'string' ? data.type.trim().toUpperCase().replace(/[\s_]+/g, '-') : '';
  if (type === 'STOCK-IN') return 'in';
  if (type === 'STOCK-OUT') return 'out';
  return null;
}

const round = (value: number) => Math.round(value * 100) / 100;

// Stock adjustments store only quantities, and receipts store zero totals, so the
// report derives line and transaction amounts. Lines without a saved rate use the
// product's current price (or cost price when no selling price is set).
export function stockMovementRecord(documentId: string, data: Record<string, unknown>, rates: ReadonlyMap<string, ProductRate> = new Map()) {
  // Normalize the existing GOODS_RECEIVED transaction fields.
  const goods = goodsTransactionRecord(documentId, data);
  const items = goods.items.map(item => {
    const rate = rates.get(item.productId);
    const price = item.price || (!item.cost && rate ? rate.price : 0);
    const cost = item.cost || (!item.price && rate ? rate.cost : 0);
    const total = item.total || round(item.quantity * (price || cost));
    return { ...item, price, cost, total };
  });
  const remark = goods.remark || [...new Set(items.map(item => item.remark).filter(Boolean))].join(', ');
  const quantity = goods.quantity || items.reduce((sum, item) => sum + item.quantity, 0);
  const total = goods.total || round(items.reduce((sum, item) => sum + item.total, 0));
  const finalTotal = goods.finalTotal || round(total + goods.roundOff);
  return { ...goods, items, remark, quantity, total, finalTotal, direction: stockDirection(data) };
}

// Product IDs whose lines have no saved rate and need a PRODUCT lookup.
export function unpricedProductIds(data: Record<string, unknown>): string[] {
  return goodsTransactionRecord('', data).items.filter(item => !item.price && !item.cost && item.productId && !item.productId.includes('/')).map(item => item.productId);
}

export function productRate(data: Record<string, unknown> | undefined): ProductRate {
  const value = (field: unknown) => typeof field === 'number' && Number.isFinite(field) ? field : 0;
  return { price: value(data?.price), cost: value(data?.costPrice) };
}
