function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function label(value: unknown): string {
  if (!value || typeof value !== 'object') return text(value);
  return Object.entries(record(value)).map(([key, entry]) => `${key}: ${text(entry)}`).filter(entry => !entry.endsWith(': ')).join(' · ');
}

export function goodsTransactionRecord(documentId: string, data: Record<string, unknown>) {
  const items = (Array.isArray(data.goodsReceivedItemBeanList) ? data.goodsReceivedItemBeanList : [])
    .map(rawItem => {
      const item = record(rawItem);
      return {
        productId: text(item.productid),
        name: text(item.name) || text(item.productid) || 'Unnamed product',
        quantity: number(item.quantity),
        price: number(item.price),
        cost: number(item.cost),
        total: number(item.total),
        remark: label(item.remark),
      };
    });
  return {
    documentId,
    transactionNo: text(data.goodsReceivedNo) || documentId,
    dayId: text(data.dayID),
    createdDate: number(data.createDate),
    type: text(data.type),
    supplier: label(data.supplier),
    remark: label(data.remark),
    source: text(data.addType),
    state: text(data.state),
    quantity: typeof data.quantity === 'number' ? number(data.quantity) : items.reduce((sum, item) => sum + item.quantity, 0),
    total: number(data.total),
    roundOff: number(data.roundOff),
    finalTotal: typeof data.finalTotal === 'number' ? number(data.finalTotal) : number(data.total),
    items,
  };
}
