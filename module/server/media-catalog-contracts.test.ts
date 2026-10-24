import { describe, expect, it } from "vitest";
import { mediaCatalogListInputSchema, mediaCatalogListOutputSchema } from "./media-catalog-contracts.js";

describe("module media catalog contracts", () => {
  it("preserves the name-only and exact recommendation inputs at the route boundary", () => {
    const input = mediaCatalogListInputSchema.parse({
      nameQuery: "  财经  ", nameBatchQuery: ["新闻", "科技"],
      recommendationTag: "可带表格", minimumMobileWeight: 3,
      minimumPriceTenThousandths: "500000", minimumPriceExclusive: true,
      maximumPriceTenThousandths: "1000000", mediaIds: [],
    });
    expect(input.nameQuery).toBe("财经");
    expect(input.nameBatchQuery).toEqual(["新闻", "科技"]);
    expect(input.query).toBeUndefined();
    expect(input.recommendationTag).toBe("可带表格");
    expect(input.minimumMobileWeight).toBe(3);
    expect(input.minimumPriceExclusive).toBe(true);
    expect(input.mediaIds).toEqual([]);
  });

  it("accepts zero and one-sided prices, and rejects invalid bounds", () => {
    expect(mediaCatalogListInputSchema.safeParse({ minimumPriceTenThousandths: "0" }).success).toBe(true);
    expect(mediaCatalogListInputSchema.safeParse({ maximumPriceTenThousandths: "1005000" }).success).toBe(true);
    expect(mediaCatalogListInputSchema.safeParse({ minimumPriceTenThousandths: "-1" }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ minimumPriceTenThousandths: "invalid" }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ minimumPriceTenThousandths: "2", maximumPriceTenThousandths: "1" }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ minimumPriceExclusive: true }).success).toBe(false);
  });

  it("limits batch names and resource scope without converting an empty scope to all", () => {
    expect(mediaCatalogListInputSchema.parse({ mediaIds: [] }).mediaIds).toEqual([]);
    expect(mediaCatalogListInputSchema.safeParse({ nameBatchQuery: Array(51).fill("媒体") }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ mediaIds: Array(501).fill("00000000-0000-4000-8000-000000000000") }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ minimumMobileWeight: -1 }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ minimumIncludeRate: 101 }).success).toBe(false);
  });

  it("keeps filtered total independent and rejects inconsistent inventory", () => {
    const result = {
      items: [], nextCursor: null, total: 0, page: 1, pageSize: 20,
      catalogRevision: "fixture-revision", catalogSyncedAt: new Date("2026-01-01T00:00:00Z"),
      catalogStale: false, kindComplete: true,
      catalogCountStatus: "available", catalogCounts: { all: 7, news: 2, selfMedia: 5 },
    };
    expect(mediaCatalogListOutputSchema.parse(result).catalogCounts?.all).toBe(7);
    expect(mediaCatalogListOutputSchema.safeParse({ ...result, catalogCounts: { all: 5, news: 2, selfMedia: 5 } }).success).toBe(false);
    expect(mediaCatalogListOutputSchema.parse({ ...result, kindComplete: false, catalogCounts: null, catalogCountStatus: "unavailable" }).catalogCounts).toBeNull();
  });
});
