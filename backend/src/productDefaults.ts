// Existing POS import serializer: retain its field names, defaults and price-table format.
export interface NewProductFields {
  name: string; price: number; mrpPrice: number; costPrice: number; category: string;
  regionalName: string; discount: number; shortName: string; taxIndex: number;
  hsnCode: string; unitId: number; weighable: boolean; stockable: boolean;
  wholeSaleAmount?: number | undefined; onlinePrice?: number | undefined;
}
export function productFields(input: NewProductFields, code: number, barcode = '') {
  return {
    active: false, barcode, category: input.category, cess: 0, code,
    costPrice: input.costPrice, currentStock: 0, discount: input.discount, hsnCode: input.hsnCode,
    keyCount: 0, kitchenId: '', mrpPrice: input.mrpPrice, name: input.name,
    onlinePrice: input.onlinePrice ?? 0, onlineSynced: false, price: input.price,
    priceTable: JSON.stringify({ 'default price': input.price }), recipeId: '',
    regionalName: input.regionalName, reorderLevel: 0, selected: false, shortName: input.shortName,
    stockable: input.stockable, taxIndex: input.taxIndex, type: 0, unitId: input.unitId,
    weighable: input.weighable, wholeSaleAmount: input.wholeSaleAmount ?? 0,
  };
}
