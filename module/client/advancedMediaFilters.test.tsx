// @vitest-environment jsdom
// Source-only handoff: these cases must be executed by the receiving integrator.
import { describe, expect, it, vi } from "vitest";
import { createServerBackedPublisherGateway, type PublisherTrpcClient } from "./ProductionPublishingEntry";
import { DEFAULT_MEDIA_FILTERS, readMediaRouteState, writeMediaRouteState } from "./queryState";
import { publishingTaskResumePath } from "./PublishingFlowContext";
import type { MediaFilters } from "./types";

vi.mock("./PublishingRoutes", () => ({ default: () => null }));

function fixture(advancedFilterVersion?: number) {
  const inventory = {
    filterSchemaVersion: 2, advancedFilterVersion,
    catalogCounts: { all: 100, news: 40, selfMedia: 60 }, catalogCountStatus: "available",
    kindComplete: true, catalogRevision: "revision-a", catalogSyncedAt: "2026-11-08T02:23:52Z",
  };
  const list = vi.fn(async (_input: unknown) => ({ ...inventory, items: [], total: 0, page: 1, pageSize: 50 }));
  const facets = vi.fn(async (_input: unknown) => ({
    ...inventory, kindCounts: { news: 40, selfMedia: 60 },
    platforms: [], taxonomies: [], mediaTypes: [], areas: [], includeTypes: [],
    publishSpeeds: [], entryTypes: [], linkTypes: [], imageSupports: [],
    pcWeightThresholds: [], mobileWeightThresholds: [], includeRateThresholds: [],
    successRateThresholds: [], recommendedOptions: [], authenticatedOptions: [], festivalPublishableOptions: [],
    coverageProvinces: [], coverageCities: [], aiPlatforms: [], recommendationGroups: [], recommendationTags: [],
    publishTimeBands: [{ value: "within_3h", count: 7 }],
    entryCategories: [{ value: "none", count: 9 }], linkCategories: [{ value: "phone", count: 2 }],
    festivalStatuses: [{ value: "publishable", count: 3 }, { value: "not_publishable", count: 97 }, { value: "unspecified", count: 0 }],
  }));
  const client = { publisher: { media: { list: { query: list }, facets: { query: facets } } } } as unknown as PublisherTrpcClient;
  return { gateway: createServerBackedPublisherGateway(client), list, facets };
}

describe("advanced media filters: gateway and saved state", () => {
  const normalized: MediaFilters = { ...DEFAULT_MEDIA_FILTERS, publishTimeBand: "within_3h", entryCategory: "none", linkCategory: "phone", festivalStatus: "not_publishable" };

  it("passes canonical dimensions and keeps zero holiday membership meaningful", async () => {
    const { gateway, list } = fixture(1);
    const result = await gateway.listMedia(normalized);
    expect(list.mock.calls[0]?.[0]).toMatchObject({ publishTimeBand: "within_3h", entryCategory: "none", linkCategory: "phone", festivalStatus: "not_publishable" });
    expect(list.mock.calls[0]?.[0]).not.toHaveProperty("festivalPublishable");
    expect(result.advancedFilterVersion).toBe(1);
    const facets = await gateway.getMediaFacets();
    expect(facets.publishTimeBands).toEqual([{ value: "within_3h", label: "3小时内", count: 7 }]);
    expect(facets.entryCategories?.[0]?.label).toBe("无入口");
    expect(facets.linkCategories?.[0]?.label).toBe("可带电话");
    expect(facets.festivalStatuses?.[2]).toEqual({ value: "unspecified", label: "未注明", count: 0 });
  });

  it("rejects old-service list and facets responses instead of widening new constraints", async () => {
    const { gateway } = fixture();
    await expect(gateway.listMedia(normalized)).rejects.toMatchObject({ code: "unavailable" });
    await expect(gateway.getMediaFacets(normalized)).rejects.toMatchObject({ code: "unavailable" });
    expect((await gateway.getMediaFacets()).publishTimeBands).toBeUndefined();
  });

  it("keeps original time, entry, link and certification constraints exact", async () => {
    const { gateway, list } = fixture();
    await gateway.listMedia({ ...DEFAULT_MEDIA_FILTERS, publishSpeed: "一小时", entryType: "没有入口", linkType: "电话", authenticated: "true", festival: "true" });
    expect(list.mock.calls[0]?.[0]).toMatchObject({ publishSpeed: "一小时", entryType: "没有入口", linkType: "电话", authenticated: true, festivalPublishable: true });
    expect(list.mock.calls[0]?.[0]).not.toHaveProperty("publishTimeBand");
  });

  it("rejects a conflicting exact and normalized dimension before requesting", async () => {
    const { gateway, list } = fixture(1);
    for (const extra of [{ publishSpeed: "1小时" }, { entryType: "无入口" }, { linkType: "电话" }, { festival: "true" as const }]) {
      await expect(gateway.listMedia({ ...normalized, ...extra })).rejects.toMatchObject({ code: "validation" });
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("round trips canonical values and exact legacy values without hidden widening", () => {
    const url = writeMediaRouteState("/publishing/media", normalized, "version-1");
    expect(readMediaRouteState(url.split("?")[1] ?? "")).toMatchObject({ articleVersionId: "version-1", filters: normalized });
    const legacy = readMediaRouteState("publishSpeed=当天&entryType=没有入口&linkType=电话&authenticated=true&festival=true");
    expect(legacy.filters).toMatchObject({ publishSpeed: "当天", entryType: "没有入口", linkType: "电话", authenticated: "true", festivalStatus: "publishable", festival: "" });
    const taskUrl = publishingTaskResumePath("media", { resources: [{ kind: "article_version", id: "version-1" }], step: "media", values: { mediaFilters: normalized } });
    expect(readMediaRouteState(taskUrl.split("?")[1] ?? "").filters).toMatchObject(normalized);
  });
});
