export declare function isStockTransfer(data: Record<string, unknown>): boolean;
export declare function stockTransferRecord(documentId: string, data: Record<string, unknown>): {
    documentId: string;
    dayId: string;
    createdDate: number;
    type: string;
    supplier: string;
    remark: string;
    source: string;
    state: string;
    quantity: number;
    total: number;
    roundOff: number;
    finalTotal: number;
    items: {
        productId: string;
        name: string;
        quantity: number;
        price: number;
        cost: number;
        total: number;
        remark: string;
    }[];
    transferNo: string;
    references: {
        field: string;
        value: string;
    }[];
};
//# sourceMappingURL=stockTransferReport.d.ts.map