export declare function stockDirection(data: Record<string, unknown>): 'in' | 'out' | null;
export declare function stockMovementRecord(documentId: string, data: Record<string, unknown>): {
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
    direction: "in" | "out" | null;
};
//# sourceMappingURL=stockMovementReport.d.ts.map