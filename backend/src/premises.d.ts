import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
type Assignments = (profile: Record<string, unknown>) => string[];
declare const schema: z.ZodObject<{
    requestId: z.ZodUUID;
    name: z.ZodString;
    code: z.ZodNumber;
    type: z.ZodEnum<{
        Bill: "Bill";
        Room: "Room";
        Table: "Table";
    }>;
    tables: z.ZodNumber;
    range: z.ZodNumber;
    taxIndex: z.ZodNumber;
    userId: z.ZodString;
    extraPriceFlag: z.ZodBoolean;
    price: z.ZodNumber;
}, z.core.$strict>;
export interface PremisesRecord {
    documentId: string;
    fields: Record<string, unknown>;
}
export type FirestoreValue = {
    integerValue: string;
} | {
    doubleValue: number;
} | {
    stringValue: string;
} | {
    booleanValue: boolean;
} | {
    nullValue: null;
} | {
    timestampValue: string;
} | {
    mapValue: {
        fields: Record<string, FirestoreValue>;
    };
} | {
    arrayValue: {
        values: FirestoreValue[];
    };
};
export type TypedFields = Record<string, FirestoreValue>;
export interface PremisesTransaction {
    read(path: string): Promise<Record<string, unknown> | undefined>;
    list(path: string): Promise<PremisesRecord[]>;
    create(path: string, fields: TypedFields): void;
    update(path: string, fields: TypedFields): void;
}
export type PremisesTransactionRunner = <T>(work: (transaction: PremisesTransaction) => Promise<T>) => Promise<T>;
export declare function premiseFields(input: Omit<z.infer<typeof schema>, 'requestId'>, now: Date): TypedFields;
export declare function listOutletPremises(db: Firestore, outletId: string, profileId: string | null, assigned: Assignments): Promise<{
    premises: {
        documentId: string;
        fields: FirebaseFirestore.DocumentData;
    }[];
    nextCode: number;
    taxes: {
        index: number;
        name: string;
        percent: number;
        type: number;
    }[];
    userAccounts: {
        userId: string;
        name: string;
    }[];
}>;
export declare function createOutletPremise(run: PremisesTransactionRunner, outletId: string, profileId: string | null, assigned: Assignments, raw: unknown): Promise<PremisesRecord>;
export declare function updateOutletPremise(run: PremisesTransactionRunner, outletId: string, id: string, profileId: string | null, assigned: Assignments, raw: unknown): Promise<{
    documentId: string;
    fields: {
        [x: string]: unknown;
    };
}>;
export {};
//# sourceMappingURL=premises.d.ts.map