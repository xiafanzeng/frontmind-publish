import { describe, expect, it } from "vitest";
import { aiPlatformRawValues, coverageRawValues, normalizeAiPlatform, normalizeCoverage, normalizeRecommendation,
  normalizedCoverageFacets, normalizedTagFacets, recommendationRawValues } from "./media-catalog-filters.js";

describe("reviewed supplier coverage mapping", () => {
  it("distinguishes explicit national, unconfirmed broad, dirty and unknown values", () => {
    expect(coverageRawValues("全国覆盖")).toEqual(["全国"]);
    expect(normalizeCoverage("综合全国")).toEqual({ province: "综合全国（待确认）" });
    for (const raw of ["不限", "0", "不带", "广东省 未知市", "深圳财经网"]) expect(normalizeCoverage(raw)).toBeUndefined();
    expect(coverageRawValues("未知区域")).toEqual([]);
  });

  it("includes city-only reviewed assignments in province selection but never expands city to province/national", () => {
    expect(normalizeCoverage("深圳")).toEqual({ province: "广东", city: "深圳市" });
    // No supplied qualified counterpart or bundled authoritative dictionary for these two.
    expect(normalizeCoverage("淮北")).toBeUndefined();
    expect(normalizeCoverage("赤峰市")).toBeUndefined();
    expect(coverageRawValues("广东")).toEqual(expect.arrayContaining(["广东", "广东省", "广东省 深圳市", "深圳"]));
    expect(coverageRawValues("广东", "深圳市")).toEqual(["广东省 深圳市", "广东省  深圳市", "深圳"]);
    expect(coverageRawValues("广东", "深圳市")).not.toContain("全国");
    expect(coverageRawValues("广东", "深圳市")).not.toContain("广东省");
    expect(coverageRawValues("四川", "深圳市")).toEqual([]);
  });

  it("keeps municipalities and special coverage groups at a single level", () => {
    expect(normalizeCoverage("北京市")).toEqual({ province: "北京" });
    expect(coverageRawValues("北京", "北京市")).toEqual([]);
    expect(normalizeCoverage("香港")).toEqual({ province: "香港" });
    expect(coverageRawValues("港澳台")).toEqual(["港澳台"]);
    expect(coverageRawValues("海外")).toEqual(["海外"]);
  });

  it("sums mutually exclusive scalar coverage aliases in stable reviewed order", () => {
    expect(normalizedCoverageFacets([
      { value: "广东", count: 3 }, { value: "广东省 深圳市", count: 2 }, { value: "深圳", count: 1 },
      { value: "全国", count: 8 }, { value: "0", count: 4 },
    ])).toEqual({ coverageProvinces: [{ value: "全国覆盖", count: 8 }, { value: "广东", count: 6 }],
      coverageCities: [{ province: "广东", value: "深圳市", count: 3 }] });
  });
});

describe("exact supplier AI and recommendation groups", () => {
  it("exposes six observed platforms and preserves generic/conditional/composite distinctions", () => {
    expect(normalizeAiPlatform("kimi")).toBe("Kimi");
    expect(aiPlatformRawValues("Kimi")).toEqual(["kimi"]);
    for (const raw of ["AI", "可发GEO", "不支持DeepSeek", "DeepSeek（需预约）", "DeepSeek,kimi"]) expect(normalizeAiPlatform(raw)).toBeUndefined();
    expect(normalizeRecommendation("AI")).toBe("AI");
    for (const raw of ["周末可发，高收录", "周末可发（需预约）", "周末部分时段可发", '["周末可发"', "推荐媒体"]) expect(normalizeRecommendation(raw)).toBeUndefined();
    expect(recommendationRawValues("周末可发")).toEqual(["周末可发"]);
    expect(recommendationRawValues("节假日可发")).toEqual(["节假日可发"]);
  });

  it("counts each media once when both equivalent labels or repeated labels appear", () => {
    const facets = normalizedTagFacets([
      { tags: ["无免责申明", "无免责声明", "kimi", "kimi", "周末可发，高收录"], count: 4 },
      { tags: ["无免责声明", "DeepSeek", "周末可发"], count: 2 },
    ]);
    expect(facets.recommendationGroups).toEqual([{ value: "周末可发", count: 2 }, { value: "无免责声明", count: 6 }]);
    expect(facets.aiPlatforms).toEqual([{ value: "DeepSeek", count: 2 }, { value: "Kimi", count: 4 }]);
    expect(recommendationRawValues("无免责声明")).toEqual(["无免责申明", "无免责声明"]);
  });
});
