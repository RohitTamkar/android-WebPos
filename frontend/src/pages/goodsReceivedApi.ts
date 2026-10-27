export type ReceiptSupplier = { id: string; name: string; mobile: string; address: string; alternateNumber: null; email: string; gstin: string };
export type SavedGoodsReceipt = { documentId: string; fields: { supplier?: ReceiptSupplier; goodsReceivedNo?: string; createDate?: number; goodsReceivedItemBeanList?: { name: string; quantity: number; cost: number; price: number }[] } };
export type GoodsReceiptOptions = { documentId: string; supplierDraftId: string; suppliers: ReceiptSupplier[]; receipts: SavedGoodsReceipt[] };
export type GoodsReceiptPayload = { documentId: string; goodsReceivedNo: string; supplier: ReceiptSupplier; items: { productId: string; quantity: number; cost: number; price: number }[] };
export type SupplierCreatePayload = { documentId: string; fields: { name: string; mobile: string; address: string; alternateNumber: string; email: string; gstin: string } };
export type SupplierCreateResult = { documentId: string; fields: SupplierCreatePayload['fields'] & { id: null }; nextDocumentId: string };
export class GoodsReceiptError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function goodsReceiptRequest<T>(url: string, token: string, signal?: AbortSignal, payload?: GoodsReceiptPayload | SupplierCreatePayload): Promise<T> {
  const response = await fetch(url, { method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}), signal: signal ?? AbortSignal.timeout(45000), cache: 'no-store' });
  let result: { success?: boolean; data?: T; message?: string };
  try { result = await response.json(); } catch { throw new GoodsReceiptError('The server response could not be confirmed. Please retry.', response.status); }
  if (!response.ok || result.success !== true || !result.data) throw new GoodsReceiptError(result.message || 'Unable to confirm the goods receipt request.', response.status);
  return result.data;
}
