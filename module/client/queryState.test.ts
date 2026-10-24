// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEDIA_FILTERS,
  parseBatchQuery,
  publisherSubmitIdempotencyKey,
  readMediaRouteState,
  readPublicationRouteState,
  unicodeLength,
  writeMediaRouteState,
  writePublicationWorkbenchRouteState,
} from "./queryState";
import { publishingTaskResumePath } from "./PublishingFlowContext";

describe("publishing route state", () => {
  it("round trips normalized and exact legacy constraints without widening aliases", () => {
    const filters = {
      ...DEFAULT_MEDIA_FILTERS, province: "广东", city: "深圳市", aiPlatform: "Kimi",
      recommendationGroup: "周末可发（需预约）", area: "深圳", region: "综合全国",
      recommendationTag: "kimi", channel: "科技", price: "under_100" as const,
    };
    const url = writeMediaRouteState("/publishing/media", filters, "frozen-v2");
    expect(readMediaRouteState(url.split("?")[1] ?? "")).toEqual({ filters, articleVersionId: "frozen-v2" });
  });

  it("restores both filter generations from task values and retains the frozen version", () => {
    const path = publishingTaskResumePath("media", {
      resources: [{ kind: "article_version", id: "frozen-task-v2" }], step: "select",
      values: { mediaFilters: { province: "广东", city: "深圳市", aiPlatform: "Kimi", recommendationGroup: "周末可发", area: "未知旧区域", recommendationTag: "预约旧标签", mediaIds: ["private-id"] } },
    });
    const restored = readMediaRouteState(path.split("?")[1] ?? "");
    expect(restored).toMatchObject({ articleVersionId: "frozen-task-v2", filters: { province: "广东", city: "深圳市", aiPlatform: "Kimi", recommendationGroup: "周末可发", area: "未知旧区域", recommendationTag: "预约旧标签" } });
    expect(path).not.toContain("mediaIds");
  });
  it("preserves old publication filters in the workbench records view", () => {
    const filters = readPublicationRouteState("query=品牌&kind=self_media&status=success&from=2026-09-01&to=2026-09-06&page=3&pageSize=50");
    const route = writePublicationWorkbenchRouteState(filters);
    expect(route).toMatch(/^\/publishing\?tab=records&/);
    expect(readPublicationRouteState(route.split("?")[1])).toEqual(filters);
    expect(writePublicationWorkbenchRouteState(readPublicationRouteState(""))).toBe("/publishing?tab=records");
  });
  it("round trips dual-kind filters and the explicit article version", () => {
    const url = writeMediaRouteState(
      "/publishing/media",
      {
        ...DEFAULT_MEDIA_FILTERS,
        kind: "self_media",
        query: "科技",
        area: "华东",
        priceMin: "100",
        sort: "success_desc",
        page: 3,
        pageSize: 50,
      },
      "article-v3",
    );
    const parsed = readMediaRouteState(url.split("?")[1] ?? "");

    expect(parsed.articleVersionId).toBe("article-v3");
    expect(parsed.filters).toMatchObject({
      kind: "self_media",
      query: "科技",
      area: "华东",
      priceMin: "100",
      sort: "success_desc",
      page: 3,
      pageSize: 50,
    });
  });

  it("normalizes invalid enum and paging values", () => {
    expect(
      readMediaRouteState(
        "kind=other&sort=cost&page=0&pageSize=999&priceMin=NaN&priceMax=-2&pcWeight=999",
      ).filters,
    ).toMatchObject({
      kind: "news",
      sort: "recommended",
      page: 1,
      pageSize: 50,
      priceMin: "",
      priceMax: "",
      pcWeight: "",
    });
    expect(
      readPublicationRouteState("status=unknown&from=2026-02-30&to=today"),
    ).toMatchObject({ status: "", from: "", to: "" });
  });

  it("deduplicates at most fifty bulk terms and counts Unicode characters", () => {
    expect(parseBatchQuery("甲\n乙,甲，丙")).toEqual(["甲", "乙", "丙"]);
    expect(
      parseBatchQuery(
        Array.from({ length: 55 }, (_, index) => `媒体${index}`).join("\n"),
      ),
    ).toHaveLength(50);
    expect(unicodeLength("AI😀搜索")).toBe(5);
  });

  it("derives a deterministic submit idempotency key from draft and quote", () => {
    expect(publisherSubmitIdempotencyKey("draft-20", "quote-abcd1234")).toBe(
      "publisher-submit:draft-20:quote-abcd1234",
    );
    expect(publisherSubmitIdempotencyKey("draft-20", "quote-abcd1234")).toBe(
      publisherSubmitIdempotencyKey("draft-20", "quote-abcd1234"),
    );
    expect(
      publisherSubmitIdempotencyKey("draft-21", "quote-abcd1234"),
    ).not.toBe(publisherSubmitIdempotencyKey("draft-20", "quote-abcd1234"));
  });
});
