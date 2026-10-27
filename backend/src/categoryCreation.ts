import { z } from 'zod';

export const categoryCreationSchema = z.object({
  categoryNo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: z.string().trim().min(1).max(200),
  regionalName: z.string().trim().max(200).default(''),
  dayType: z.string().trim().max(100).default(''),
});

// Shared by Category Master and spreadsheet imports: the existing seven fields.
export function categoryCreationFields(id: string, input: z.infer<typeof categoryCreationSchema>) {
  return { categoryNo: input.categoryNo, dayType: input.dayType, id, name: input.name,
    onlineSynced: false, regionalName: input.regionalName, selected: false };
}
