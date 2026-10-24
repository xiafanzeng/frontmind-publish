// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createServerBackedPublisherGateway, type PublisherTrpcClient } from "./ProductionPublishingEntry";
import { DEFAULT_MEDIA_FILTERS } from "./queryState";

vi.mock("./PublishingRoutes", () => ({ default: () => null }));

function fixture(filterSchemaVersion?: number) {
  const inventory = {
    ...(filterSchemaVersion !== undefined ? { filterSchemaVersion } : {}),
    catalogCounts: { all: 10, news: 4, selfMedia: 6 },
    catalogCountStatus: "available", kindComplete: true,
    catalogRevision: "catalog-a", catalogSyncedAt: "2026-10-24T10:24:49Z",
  };
  const list = vi.fn(async (_input: unknown, _options?: { signal?: AbortSignal }) => ({
    ...inventory, catalogStale: false, items: [], total: 0, page: 1, pageSize: 50,
  }));
  const facets = vi.fn(async (_input: unknown, _options?: { signal?: AbortSignal }) => ({
    ...inventory, kindCounts: { news: 4, selfMedia: 6 },
    platforms: [], taxonomies: [], mediaTypes: [], areas: [{ value: "全国", count: 2 }],
    includeTypes: [], publishSpeeds: [], entryTypes: [], linkTypes: [], imageSupports: [],
    pcWeightThresholds: [], includeRateThresholds: [], successRateThresholds: [],
    recommendedOptions: [], recommendationTags: [{ value: "kimi", count: 3 }],
    authenticatedOptions: [], festivalPublishableOptions: [],
    coverageProvinces: [{ value: "广东", count: 4 }],
    coverageCities: [{ province: "广东", value: "深圳市", count: 2 }],
    aiPlatforms: [{ value: "Kimi", count: 3 }],
    recommendationGroups: [{ value: "周末可发（需预约）", count: 1 }],
  }));
  const client = { publisher: { media: { list: { query: list }, facets: { query: facets } } } } as unknown as PublisherTrpcClient;
  return { gateway: createServerBackedPublisherGateway(client), list, facets };
}

describe("normalized catalogue gateway contract", () => {
  it("passes independent dimensions and retains exact legacy constraints", async () => {
    const { gateway, list } = fixture(2);
    const result = await gateway.listMedia({
      ...DEFAULT_MEDIA_FILTERS, province: "广东", city: "深圳市", aiPlatform: "Kimi",
      recommendationGroup: "周末可发（需预约）", recommended: "true",
      area: "深圳", recommendationTag: "旧标签（限定）",
    });
    expect(list.mock.calls[0]?.[0]).toMatchObject({
      coverageProvince: "广东", coverageCity: "深圳市", aiPlatform: "Kimi",
      recommendationGroup: "周末可发（需预约）", recommended: true,
      area: "深圳", recommendationTag: "旧标签（限定）",
    });
    expect(result.filterSchemaVersion).toBe(2);
    expect(result.total).toBe(0);
    expect(result.catalog).toMatchObject({ mediaCount: 10, newsCount: 4, selfMediaCount: 6 });
  });

  it.each([undefined, 1])("rejects normalized list filters if service schema is %s", async (version) => {
    const { gateway } = fixture(version);
    await expect(gateway.listMedia({ ...DEFAULT_MEDIA_FILTERS, aiPlatform: "Kimi" }))
      .rejects.toMatchObject({ code: "unavailable" });
  });

  it("also fails closed for normalized facets while preserving old exact requests", async () => {
    const { gateway, list } = fixture();
    await expect(gateway.getMediaFacets({ ...DEFAULT_MEDIA_FILTERS, province: "广东" }))
      .rejects.toMatchObject({ code: "unavailable" });
    await gateway.listMedia({ ...DEFAULT_MEDIA_FILTERS, region: "综合全国", recommendationTag: "kimi" });
    expect(list.mock.calls[0]?.[0]).toMatchObject({ area: "综合全国", recommendationTag: "kimi" });
    const facets = await gateway.getMediaFacets();
    expect(facets.coverageProvinces).toBeUndefined();
    expect(facets.aiPlatforms).toBeUndefined();
    expect(facets.recommendationTags).toEqual([{ value: "kimi", label: "kimi", count: 3 }]);
  });

  it("maps version 2 facets with province identity and supplier restrictions intact", async () => {
    const facets = await fixture(2).gateway.getMediaFacets();
    expect(facets.filterSchemaVersion).toBe(2);
    expect(facets.coverageCities).toEqual([{ province: "广东", value: "深圳市", label: "深圳市", count: 2 }]);
    expect(facets.aiPlatforms).toEqual([{ value: "Kimi", label: "Kimi", count: 3 }]);
    expect(facets.recommendationGroups?.[0]?.label).toBe("周末可发（需预约）");
    expect(facets.areas).toEqual([{ value: "全国", label: "全国", count: 2 }]);
  });
});
