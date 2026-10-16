export declare function goodsTransactionRecord(documentId: string, data: Record<string, unknown>): {
    documentId: string;
    transactionNo: string;
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
};
//# sourceMappingURL=goodsTransaction.d.ts.map