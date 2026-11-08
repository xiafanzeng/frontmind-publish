import { describe, expect, it } from "vitest";
import { mediaCatalogFacetsOutputSchema, mediaCatalogListInputSchema, mediaCatalogListOutputSchema } from "./media-catalog-contracts.js";

describe("module media catalog contracts", () => {
  it("validates normalized advanced inputs without silently ANDing legacy raw conditions", () => {
    expect(mediaCatalogListInputSchema.parse({ publishTimeBand: "within_3h", entryCategory: "none",
      linkCategory: "phone", festivalStatus: "unspecified" })).toMatchObject({ publishTimeBand: "within_3h" });
    for (const input of [
      { publishTimeBand: "within_3h", publishSpeed: "3小时" },
      { entryCategory: "none", entryType: "无入口" }, { entryCategory: "none", entryLevel: "没有入口" },
      { linkCategory: "phone", linkType: "电话" }, { festivalStatus: "publishable", festivalPublishable: true },
      { publishTimeBand: "3小时" }, { entryCategory: "unknown" }, { linkCategory: "raw:" },
    ]) expect(mediaCatalogListInputSchema.safeParse(input).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ entryCategory: "raw:新入口", linkCategory: "raw:新能力" }).success).toBe(true);
    expect(mediaCatalogListInputSchema.parse({ publishSpeed: "3小时", entryType: "没有入口", linkType: "电话" }))
      .toMatchObject({ publishSpeed: "3小时", entryType: "没有入口", linkType: "电话" });
  });
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

  it("keeps normalized dimensions independent from legacy exact constraints", () => {
    const input = mediaCatalogListInputSchema.parse({
      coverageProvince: "广东", coverageCity: "深圳市", area: "广东省 深圳市",
      aiPlatform: "Kimi", recommendationGroup: "无免责声明", recommendationTag: "无免责申明",
    });
    expect(input).toMatchObject({ coverageProvince: "广东", coverageCity: "深圳市", area: "广东省 深圳市",
      aiPlatform: "Kimi", recommendationGroup: "无免责声明", recommendationTag: "无免责申明" });
    for (const invalid of [
      { coverageCity: "深圳市" }, { coverageProvince: "四川", coverageCity: "深圳市" },
      { coverageProvince: "全国覆盖", coverageCity: "深圳市" }, { coverageProvince: "未审查区域" },
      { aiPlatform: "不存在的平台" }, { recommendationGroup: "周末可发，高收录" },
    ]) expect(mediaCatalogListInputSchema.safeParse(invalid).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ area: "未审查原值", recommendationTag: "周末可发，高收录" }).success).toBe(true);
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
    expect(mediaCatalogListInputSchema.parse({ exactExternalResourceIds: [] }).exactExternalResourceIds).toEqual([]);
    expect(mediaCatalogListInputSchema.parse({ exactExternalResourceIds: [" 24247 "] }).exactExternalResourceIds).toEqual(["24247"]);
    expect(mediaCatalogListInputSchema.safeParse({ exactExternalResourceIds: Array(101).fill("24247") }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ exactExternalResourceIds: [" "] }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ exactExternalResourceIds: ["x".repeat(129)] }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ nameBatchQuery: Array(51).fill("媒体") }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ mediaIds: Array(501).fill("00000000-0000-4000-8000-000000000000") }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ minimumMobileWeight: -1 }).success).toBe(false);
    expect(mediaCatalogListInputSchema.safeParse({ minimumIncludeRate: 101 }).success).toBe(false);
  });

  it("keeps filtered total independent and rejects inconsistent inventory", () => {
    const result = {
      filterSchemaVersion: 2, advancedFilterVersion: 1,
      items: [], nextCursor: null, total: 0, page: 1, pageSize: 20,
      catalogRevision: "fixture-revision", catalogSyncedAt: new Date("2026-01-01T00:00:00Z"),
      catalogStale: false, kindComplete: true,
      catalogCountStatus: "available", catalogCounts: { all: 7, news: 2, selfMedia: 5 },
    };
    expect(mediaCatalogListOutputSchema.parse(result).catalogCounts?.all).toBe(7);
    expect(mediaCatalogListOutputSchema.safeParse({ ...result, filterSchemaVersion: 1 }).success).toBe(false);
    expect(mediaCatalogListOutputSchema.safeParse({ ...result, catalogCounts: { all: 5, news: 2, selfMedia: 5 } }).success).toBe(false);
    expect(mediaCatalogListOutputSchema.parse({ ...result, kindComplete: false, catalogCounts: null, catalogCountStatus: "unavailable" }).catalogCounts).toBeNull();
  });

  it("retains versioned normalized facets and rejects incomplete metadata", () => {
    const result = {
      filterSchemaVersion: 2, advancedFilterVersion: 1, kindCounts: { news: 2, selfMedia: 5 },
      catalogRevision: "fixture-revision", catalogSyncedAt: new Date("2026-01-01T00:00:00Z"), kindComplete: true,
      catalogCountStatus: "available", catalogCounts: { all: 7, news: 2, selfMedia: 5 },
      platforms: [], taxonomies: [], mediaTypes: [], areas: [], includeTypes: [], publishSpeeds: [],
      entryTypes: [], entryLevels: [], linkTypes: [], imageSupports: [], pcWeightThresholds: [], mobileWeightThresholds: [],
      includeRateThresholds: [], successRateThresholds: [], recommendedOptions: [], authenticatedOptions: [], festivalPublishableOptions: [],
      recommendationTags: [], minimumPriceTenThousandths: null, maximumPriceTenThousandths: null,
      coverageProvinces: [{ value: "广东", count: 2 }], coverageCities: [{ province: "广东", value: "深圳市", count: 1 }],
      aiPlatforms: [{ value: "Kimi", count: 1 }], recommendationGroups: [{ value: "无免责声明", count: 1 }],
      publishTimeBands: [], entryCategories: [], linkCategories: [], festivalStatuses: [],
    };
    expect(mediaCatalogFacetsOutputSchema.parse(result)).toMatchObject({ filterSchemaVersion: 2,
      coverageCities: result.coverageCities, aiPlatforms: result.aiPlatforms, recommendationGroups: result.recommendationGroups });
    expect(mediaCatalogFacetsOutputSchema.safeParse({ ...result, coverageCities: [{ value: "深圳市", count: 1 }] }).success).toBe(false);
    expect(mediaCatalogFacetsOutputSchema.safeParse({ ...result, filterSchemaVersion: undefined }).success).toBe(false);
  });
});
