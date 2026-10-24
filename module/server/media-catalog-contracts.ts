import { z } from "zod";
import {
  idSchema,
  publisherMediaFacetOptionSchema,
  publisherMediaFacetsOutputSchema,
  publisherMediaListInputSchema,
  publisherMediaListOutputSchema,
} from "@frontmind/monitoring-contracts";

/** Module-owned additions; the shared vendor contract remains untouched. */
export const mediaCatalogListInputSchema = publisherMediaListInputSchema.and(
  z.object({
    nameQuery: z.string().trim().max(120).optional(),
    nameBatchQuery: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    recommendationTag: z.string().trim().min(1).max(120).optional(),
    minimumMobileWeight: z.number().int().min(0).max(100).optional(),
    minimumPriceExclusive: z.boolean().optional(),
    // Resource UUIDs, never supplier-local numeric IDs. [] means an empty scope.
    mediaIds: z.array(idSchema).max(500).optional(),
  }),
).superRefine((value, context) => {
  if (value.minimumPriceExclusive && value.minimumPriceTenThousandths === undefined) {
    context.addIssue({ code: "custom", path: ["minimumPriceExclusive"], message: "An exclusive minimum requires a minimum price" });
  }
});

export type MediaCatalogListInput = z.infer<typeof mediaCatalogListInputSchema>;

const catalogSnapshotFields = {
  catalogCounts: z.object({
    all: z.number().int().nonnegative(),
    news: z.number().int().nonnegative(),
    selfMedia: z.number().int().nonnegative(),
  }).refine((counts) => counts.all === counts.news + counts.selfMedia, {
    message: "Inventory total must equal the two supported media kinds",
  }).nullable(),
  catalogCountStatus: z.enum(["available", "unavailable"]),
};

export const mediaCatalogListOutputSchema = publisherMediaListOutputSchema.extend(catalogSnapshotFields);
export const mediaCatalogFacetsInputSchema = mediaCatalogListInputSchema.optional();
export const mediaCatalogFacetsOutputSchema = publisherMediaFacetsOutputSchema.extend({
  ...catalogSnapshotFields,
  recommendationTags: z.array(publisherMediaFacetOptionSchema),
  mobileWeightThresholds: z.array(publisherMediaFacetOptionSchema),
});
