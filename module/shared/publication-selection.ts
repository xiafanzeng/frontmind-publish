import { z } from 'zod';

/** Module-owned extension of the host's one-row-per-media draft contract. */
export const publicationSelectionSchema=z.object({
  schemaVersion:z.literal(1),source:z.literal('source_matrix_budget_plan'),
  taskId:z.string().min(1),planId:z.string().min(1),planVersion:z.string().min(1),planIndex:z.number().int().nonnegative(),
  articleId:z.string().min(1),articleVersionId:z.string().min(1),articleVersion:z.string().min(1),
  resourceId:z.string().min(1),offerId:z.string().min(1),publicationSpec:z.union([z.string().min(1),z.record(z.unknown())]),
  quantity:z.number().int().min(1).max(100),quantityMeaning:z.enum(['single','repeat_same_article']),purpose:z.enum(['standard','exploration']),
  unitPriceTenThousandths:z.string().regex(/^\d+$/),totalPriceTenThousandths:z.string().regex(/^\d+$/),
  quoteFingerprint:z.string().regex(/^[a-f0-9]{64}$/),locked:z.boolean(),
});
export type PublicationSelection=z.infer<typeof publicationSelectionSchema>;
export function publicationSelection(snapshot:Record<string,unknown>|null|undefined):PublicationSelection|undefined {
  const parsed=publicationSelectionSchema.safeParse(snapshot?.publication);
  return parsed.success?parsed.data:undefined;
}
export function publicationCount(snapshot:Record<string,unknown>|null|undefined):number {return publicationSelection(snapshot)?.quantity??1;}
