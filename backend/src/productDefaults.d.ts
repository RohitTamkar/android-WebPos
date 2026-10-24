export interface NewProductFields {
    name: string;
    price: number;
    mrpPrice: number;
    costPrice: number;
    category: string;
    regionalName: string;
    discount: number;
    shortName: string;
    taxIndex: number;
    hsnCode: string;
    unitId: number;
    weighable: boolean;
    stockable: boolean;
    wholeSaleAmount?: number | undefined;
    onlinePrice?: number | undefined;
}
export declare function productFields(input: NewProductFields, code: number, barcode?: string): {
    active: boolean;
    barcode: string;
    category: string;
    cess: number;
    code: number;
    costPrice: number;
    currentStock: number;
    discount: number;
    hsnCode: string;
    keyCount: number;
    kitchenId: string;
    mrpPrice: number;
    name: string;
    onlinePrice: number;
    onlineSynced: boolean;
    price: number;
    priceTable: string;
    recipeId: string;
    regionalName: string;
    reorderLevel: number;
    selected: boolean;
    shortName: string;
    stockable: boolean;
    taxIndex: number;
    type: number;
    unitId: number;
    weighable: boolean;
    wholeSaleAmount: number;
};
//# sourceMappingURL=productDefaults.d.ts.map