// @vitest-environment jsdom
// Authored for the handoff verification stage. No provider/network calls are made by these fixtures.
import { describe, expect, it, vi } from "vitest";
import { createServerBackedPublisherGateway, type PublisherTrpcClient } from "./ProductionPublishingEntry";
import { publishingTaskResumePath } from "./PublishingFlowContext";
import { DEFAULT_MEDIA_FILTERS, readMediaRouteState, writeMediaRouteState } from "./queryState";
import type { MediaFilters } from "./types";

vi.mock("./PublishingRoutes", () => ({ default: () => null }));

const snapshot = {
  catalogRevision: "catalog-snapshot-a",
  catalogSyncedAt: "2026-10-24T00:00:00.000Z",
  catalogStale: false,
  kindComplete: true,
  catalogCountStatus: "available",
  catalogCounts: { all: 23, news: 7, selfMedia: 16 },
};
const blankPage = { ...snapshot, items: [], total: 0, page: 1, pageSize: 50 };
const blankFacets = {
  ...snapshot,
  kindCounts: { news: 1, selfMedia: 0 }, // Filtered facets must never replace inventory.
  platforms: [], taxonomies: [], mediaTypes: [], areas: [], includeTypes: [],
  publishSpeeds: [], entryTypes: [], linkTypes: [], imageSupports: [],
  pcWeightThresholds: [], mobileWeightThresholds: [{ value: "2", count: 5 }],
  includeRateThresholds: [], successRateThresholds: [], recommendedOptions: [],
  recommendationTags: [{ value: "可带表格", count: 3 }],
  authenticatedOptions: [], festivalPublishableOptions: [],
};

function setup(page: Record<string, unknown> = blankPage) {
  const list = vi.fn(async (_input: Record<string, unknown>, _options?: { signal?: AbortSignal }) => page);
  const facets = vi.fn(async (_input: Record<string, unknown>, _options?: { signal?: AbortSignal }) => blankFacets);
  const client = { publisher: { media: { list: { query: list }, facets: { query: facets } } } } as unknown as PublisherTrpcClient;
  const fetch = vi.fn(async () => { throw new Error("Network must not be used by a catalogue adapter test"); });
  return { gateway: createServerBackedPublisherGateway(client, { fetch }), list, facets };
}

describe("media inventory and filter adapter contracts", () => {
  it("keeps one full inventory snapshot across all category results and empty filtered results", async () => {
    const { gateway } = setup({ ...blankPage, total: 2 });
    for (const kind of [undefined, "news", "self_media"] as const) {
      const result = await gateway.listMedia({ ...DEFAULT_MEDIA_FILTERS, kind, query: "媒体" });
      expect(result.total).toBe(2);
      expect(result.catalog).toMatchObject({ mediaCount: 23, newsCount: 7, selfMediaCount: 16, countStatus: "available" });
    }
    const empty = await setup().gateway.listMedia(DEFAULT_MEDIA_FILTERS);
    expect(empty.total).toBe(0);
    expect(empty.catalog.mediaCount).toBe(23);
  });

  it("preserves unavailable or malformed inventory as unknown, including legacy responses", async () => {
    for (const catalog of [
      { catalogCounts: null, catalogCountStatus: "unavailable" },
      { catalogCounts: undefined, catalogCountStatus: undefined },
      { catalogCounts: { all: 99, news: 7, selfMedia: 16 }, catalogCountStatus: "available" },
    ]) {
      const result = await setup({ ...blankPage, total: 4, ...catalog }).gateway.listMedia(DEFAULT_MEDIA_FILTERS);
      expect(result.catalog.countStatus).toBe("unavailable");
      expect(result.catalog.mediaCount).toBeUndefined();
      expect(result.catalog.newsCount).toBeUndefined();
      expect(result.catalog.selfMediaCount).toBeUndefined();
    }
  });

  it("maps current name search and bounds without widening to inactive media or adding a news default", async () => {
    const { gateway, list } = setup();
    await gateway.listMedia({
      ...DEFAULT_MEDIA_FILTERS, kind: undefined, searchScope: "name", query: "  科技  ",
      batchQuery: "甲\n乙,甲，丙", recommendationTag: "可带表格", mobileWeight: "2",
      priceMin: "100", priceMax: "150.5", priceMinExclusive: true, mediaIds: [],
    });
    const input = list.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      nameQuery: "科技", nameBatchQuery: ["甲", "乙", "丙"], recommendationTag: "可带表格",
      minimumMobileWeight: 2, minimumPriceTenThousandths: "1000000",
      maximumPriceTenThousandths: "1505000", minimumPriceExclusive: true, mediaIds: [],
    });
    expect(input).not.toHaveProperty("kind");
    expect(input).not.toHaveProperty("query");
    expect(input).not.toHaveProperty("batchQuery");
    expect(input).not.toHaveProperty("includeInactive");
  });

  it("preserves legacy search behavior for other callers", async () => {
    const { gateway, list } = setup();
    await gateway.listMedia({ ...DEFAULT_MEDIA_FILTERS, query: "resource-id", batchQuery: "another-id" });
    expect(list.mock.calls[0]?.[0]).toMatchObject({ kind: "news", query: "resource-id", batchQuery: ["another-id"], includeInactive: true });
  });

  it("rejects unsupported extended filters from an old server rather than showing unfiltered results", async () => {
    const { gateway } = setup({ ...blankPage, catalogCounts: undefined, catalogCountStatus: undefined });
    await expect(gateway.listMedia({ ...DEFAULT_MEDIA_FILTERS, searchScope: "name", query: "甲" }))
      .rejects.toMatchObject({ code: "unavailable" });
  });

  it("keeps valid zero and exact decimal price input and rejects invalid ranges before a request", async () => {
    const { gateway, list } = setup();
    await gateway.listMedia({ ...DEFAULT_MEDIA_FILTERS, priceMin: "0", priceMax: "100.0001" });
    expect(list.mock.calls[0]?.[0]).toMatchObject({ minimumPriceTenThousandths: "0", maximumPriceTenThousandths: "1000001" });
    for (const priceFilter of [
      { priceMin: "-1" }, { priceMax: "NaN" }, { priceMin: "100.5", priceMax: "100" },
    ]) {
      await expect(gateway.listMedia({ ...DEFAULT_MEDIA_FILTERS, ...priceFilter })).rejects.toMatchObject({ code: "validation" });
    }
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("rejects over-limit name batches without silently truncating", async () => {
    const { gateway, list } = setup();
    await expect(gateway.listMedia({
      ...DEFAULT_MEDIA_FILTERS, searchScope: "name",
      batchQuery: Array.from({ length: 51 }, (_, index) => `媒体${index}`).join("\n"),
    })).rejects.toMatchObject({ code: "validation" });
    expect(list).not.toHaveBeenCalled();
  });

  it("maps exact recommendation tags and mobile weights while keeping inventory independent of facet counts", async () => {
    const result = await setup().gateway.getMediaFacets(DEFAULT_MEDIA_FILTERS);
    expect(result.catalog).toMatchObject({ mediaCount: 23, newsCount: 7, selfMediaCount: 16 });
    expect(result.recommendationTags).toEqual([{ value: "可带表格", label: "可带表格", count: 3 }]);
    expect(result.mobileWeightThresholds).toEqual([{ value: "2", label: "2 以上", count: 5 }]);
  });

  it("keeps rates on the 0–100 scale without rounding across filter thresholds", async () => {
    const media = {
      id: "test-media", name: "测试媒体", kind: "news", priceTenThousandths: "0",
      successRateBasisPoints: 8999, includeRateBasisPoints: null, pcWeight: null, mobileWeight: 2,
      fanCount: null, likeCount: null, publishCount: null,
      isActive: true, catalogRevision: snapshot.catalogRevision,
    };
    const result = await setup({ ...blankPage, items: [media], total: 1 }).gateway.listMedia(DEFAULT_MEDIA_FILTERS);
    expect(result.items[0]).toMatchObject({ successRate: 89.99, mobileWeight: 2 });
    expect(result.items[0]?.includeRate).toBeUndefined();
    expect(result.items[0]?.pcWeight).toBeUndefined();
  });

  it("does not deliver a response after cancellation", async () => {
    let resolve!: (value: Record<string, unknown>) => void;
    const response = new Promise<Record<string, unknown>>((yes) => { resolve = yes; });
    const { gateway, list } = setup();
    list.mockImplementationOnce(async () => response);
    const controller = new AbortController();
    const request = gateway.listMedia(DEFAULT_MEDIA_FILTERS, controller.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    resolve(blankPage);
    await rejection;
  });
});

describe("media catalogue route and task persistence", () => {
  it("round trips all-media and new filters without changing the absent-kind news default", () => {
    const filters: MediaFilters = {
      ...DEFAULT_MEDIA_FILTERS, kind: undefined, searchScope: "name", priceMin: "100",
      priceMax: "150", priceMinExclusive: true, recommendationTag: "可带表格", mobileWeight: "2",
      mediaIds: ["account-private-resource"],
    };
    const url = writeMediaRouteState("/publishing/media", filters, "article-v3");
    const state = readMediaRouteState(url.split("?")[1] ?? "");
    expect(state.filters).toMatchObject({ kind: undefined, priceMinExclusive: true, recommendationTag: "可带表格", mobileWeight: "2", searchScope: "name" });
    expect(state.articleVersionId).toBe("article-v3");
    expect(url).not.toContain("mediaIds");
    expect(url).not.toContain("account-private-resource");
    expect(readMediaRouteState("").filters.kind).toBe("news");
    expect(writeMediaRouteState("/publishing/media", DEFAULT_MEDIA_FILTERS)).toContain("kind=news");
  });

  it("restores explicit all-media and exclusive bounds from saved task filters without persisting request IDs", () => {
    const path = publishingTaskResumePath("media", {
      resources: [{ kind: "article_version", id: "article-v3" }], step: "media",
      values: { mediaFilters: {
        ...DEFAULT_MEDIA_FILTERS, kind: "all", priceMin: "100", priceMinExclusive: true,
        searchScope: "name", mediaIds: ["account-private-resource"],
      } },
    });
    const state = readMediaRouteState(path.split("?")[1] ?? "");
    expect(state.filters).toMatchObject({ kind: undefined, priceMin: "100", priceMinExclusive: true, searchScope: "name" });
    expect(state.articleVersionId).toBe("article-v3");
    expect(path).not.toContain("mediaIds");
  });
});
