export function productFields(input, code, barcode = '') {
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
//# sourceMappingURL=productDefaults.js.map