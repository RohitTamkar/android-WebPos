import { z } from 'zod';
export declare const categoryCreationSchema: z.ZodObject<{
    categoryNo: z.ZodNumber;
    name: z.ZodString;
    regionalName: z.ZodDefault<z.ZodString>;
    dayType: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export declare function categoryCreationFields(id: string, input: z.infer<typeof categoryCreationSchema>): {
    categoryNo: number;
    dayType: string;
    id: string;
    name: string;
    onlineSynced: boolean;
    regionalName: string;
    selected: boolean;
};
//# sourceMappingURL=categoryCreation.d.ts.map