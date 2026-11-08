import { z } from "zod";
import {
  idSchema,
  publisherMediaFacetOptionSchema,
  publisherMediaFacetsOutputSchema,
  publisherMediaListInputSchema,
  publisherMediaListOutputSchema,
} from "@frontmind/monitoring-contracts";
import { aiPlatformRawValues, coverageRawValues, recommendationRawValues } from "../shared/media-catalog-filters.js";
import { ENTRY_OPTIONS, LINK_OPTIONS } from "../shared/media-advanced-filters.js";

const categoryInput = (options: readonly { value: string }[]) => z.string().min(1).max(512).refine(
  (value) => options.some((option) => option.value === value) || (value.startsWith("raw:") && value.length > 4 && value.slice(4).trim().length > 0),
  { message: "Unknown normalized category" },
);

/** Module-owned additions; the shared vendor contract remains untouched. */
export const mediaCatalogListInputSchema = publisherMediaListInputSchema.and(
  z.object({
    nameQuery: z.string().trim().max(120).optional(),
    nameBatchQuery: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    recommendationTag: z.string().trim().min(1).max(120).optional(),
    coverageProvince: z.string().trim().min(1).max(120).optional(),
    coverageCity: z.string().trim().min(1).max(120).optional(),
    aiPlatform: z.string().trim().min(1).max(120).optional(),
    recommendationGroup: z.string().trim().min(1).max(120).optional(),
    minimumMobileWeight: z.number().int().min(0).max(100).optional(),
    minimumPriceExclusive: z.boolean().optional(),
    publishTimeBand: z.enum(["within_1h", "within_3h", "within_6h", "within_12h", "within_1d", "within_2d", "within_3d", "over_3d", "unconfirmed"]).optional(),
    entryCategory: categoryInput(ENTRY_OPTIONS).optional(),
    linkCategory: categoryInput(LINK_OPTIONS).optional(),
    festivalStatus: z.enum(["publishable", "not_publishable", "unspecified"]).optional(),
    // Resource UUIDs, never supplier-local numeric IDs. [] means an empty scope.
    mediaIds: z.array(idSchema).max(500).optional(),
  }),
).superRefine((value, context) => {
  for (const [normalized, legacy] of [
    ["publishTimeBand", ["publishSpeed"]], ["entryCategory", ["entryType", "entryLevel"]],
    ["linkCategory", ["linkType"]], ["festivalStatus", ["festivalPublishable"]],
  ] as const) {
    if (value[normalized] !== undefined && legacy.some((key) => value[key] !== undefined)) {
      context.addIssue({ code: "custom", path: [normalized], message: "Choose either the normalized filter or its legacy exact value" });
    }
  }
  if (value.coverageCity && !value.coverageProvince) {
    context.addIssue({ code: "custom", path: ["coverageCity"], message: "A city requires its coverage province" });
  }
  if (value.coverageProvince && coverageRawValues(value.coverageProvince, value.coverageCity).length === 0) {
    context.addIssue({ code: "custom", path: ["coverageProvince"], message: "Unknown or incompatible coverage selection" });
  }
  if (value.aiPlatform && aiPlatformRawValues(value.aiPlatform).length === 0) {
    context.addIssue({ code: "custom", path: ["aiPlatform"], message: "Unknown supplier AI platform" });
  }
  if (value.recommendationGroup && recommendationRawValues(value.recommendationGroup).length === 0) {
    context.addIssue({ code: "custom", path: ["recommendationGroup"], message: "Unknown recommendation group" });
  }
  if (value.minimumPriceExclusive && value.minimumPriceTenThousandths === undefined) {
    context.addIssue({ code: "custom", path: ["minimumPriceExclusive"], message: "An exclusive minimum requires a minimum price" });
  }
});

export type MediaCatalogListInput = z.infer<typeof mediaCatalogListInputSchema>;

const catalogSnapshotFields = {
  filterSchemaVersion: z.literal(2),
  advancedFilterVersion: z.literal(1),
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
  coverageProvinces: z.array(publisherMediaFacetOptionSchema),
  coverageCities: z.array(publisherMediaFacetOptionSchema.extend({ province: z.string().min(1) })),
  aiPlatforms: z.array(publisherMediaFacetOptionSchema),
  recommendationGroups: z.array(publisherMediaFacetOptionSchema),
  mobileWeightThresholds: z.array(publisherMediaFacetOptionSchema),
  publishTimeBands: z.array(publisherMediaFacetOptionSchema),
  entryCategories: z.array(publisherMediaFacetOptionSchema),
  linkCategories: z.array(publisherMediaFacetOptionSchema),
  festivalStatuses: z.array(publisherMediaFacetOptionSchema),
});
