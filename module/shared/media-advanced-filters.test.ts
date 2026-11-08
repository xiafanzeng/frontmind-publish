import { describe, expect, it } from "vitest";
import { normalizePublishTime, publishTimeMatches, normalizeEntry, normalizeLink,
  normalizedPublishTimeFacets, normalizedEntryFacets, normalizedLinkFacets } from "./media-advanced-filters.js";

describe("reviewed advanced catalogue normalization", () => {
  it.each([
    ["1小时", 1], ["一小时", 1], ["0.5小时", 0.5], ["半小时", 0.5], ["30分钟", 0.5],
    ["零点五小时", 0.5], ["两天", 48], ["二十四小时", 24], ["1–2天", 48],
    ["2小时至3小时", 3], ["1自然日", 24], ["1-2周", 336], ["05小时", 5], ["0小时", 0],
    ["56小时", 56], ["64小时", 64], ["72小时", 72], ["73小时", 73], ["9分钟以内", 0.15],
  ])("uses the literal finite upper bound of %s", (raw, hours) => {
    expect(normalizePublishTime(String(raw)).upperHours).toBe(hours);
  });

  it.each([null, "", "  ", "当天", "半天", "1工作日", "1天（节假日顺延）", "审核后1小时",
    "截稿时间后1小时", "1月", "一个月内", "两天以上", "3天以上", "12", "1小时保证发布",
    "约1小时", "3-1天", "1小时/2小时", "1小时内工作日", "未注明", "下周", "Infinity小时", "1 2小时", "12时"])
  ("does not infer a continuous-hour promise for %s", (raw) => {
    expect(normalizePublishTime(raw)).toMatchObject({ upperHours: null, band: "unconfirmed" });
  });

  it("uses cumulative inclusive thresholds without duplicating membership", () => {
    for (const raw of ["0小时", "半小时", "1小时", "2小时", "3小时"])
      expect(publishTimeMatches(raw, "within_3h")).toBe(true);
    expect(publishTimeMatches("4小时", "within_3h")).toBe(false);
    expect(publishTimeMatches("05小时", "within_3h")).toBe(false);
    for (const raw of ["56小时", "64小时", "72小时"])
      expect(publishTimeMatches(raw, "within_3d")).toBe(true);
    expect(publishTimeMatches("72小时", "over_3d")).toBe(false);
    expect(publishTimeMatches("77小时", "over_3d")).toBe(true);
    expect(publishTimeMatches(null, "unconfirmed")).toBe(true);
  });

  it("keeps absent fields separate from explicit restrictions and preserves new exact categories", () => {
    expect(normalizeEntry("没有入口")).toEqual(normalizeEntry("无入口"));
    expect(normalizeEntry("首页入口")).toEqual({ value: "home", label: "网站首页" });
    expect(normalizeEntry(null).value).toBe("unspecified");
    expect(normalizeEntry("新入口")).toEqual({ value: "raw:新入口", label: "新入口" });
    expect(normalizeLink("电话")).toEqual(normalizeLink("可带电话"));
    expect(normalizeLink("可带").label).toBe("可带（内容类型待确认）");
    expect(normalizeLink("不带").label).toBe("不带（限制范围待确认）");
    expect(normalizeLink(null).value).toBe("unspecified");
    expect(normalizeLink("新能力").value).toBe("raw:新能力");
    for (const raw of ["未注明", "未提供", "未知", "—", "-", "  "]) {
      expect(normalizeEntry(raw).value).toBe("unspecified");
      expect(normalizeLink(raw).value).toBe("unspecified");
    }
    expect(normalizedEntryFacets([{ value: "未注明", count: 2 }, { value: null, count: 3 }])
      .filter(({ value }) => value === "unspecified")).toEqual([{ value: "unspecified", count: 5 }]);
    expect(normalizedLinkFacets([{ value: "未注明", count: 2 }, { value: null, count: 3 }])
      .filter(({ value }) => value === "unspecified")).toEqual([{ value: "unspecified", count: 5 }]);
  });

  it("counts every grouped resource once per cumulative choice, preserving missing and zero", () => {
    const facets = normalizedPublishTimeFacets([
      { value: "1小时", count: 2 }, { value: "一小时", count: 3 }, { value: "3小时", count: 1 },
      { value: "0小时", count: 1 }, { value: "未知新值", count: 4 }, { value: null, count: 5 },
    ]);
    expect(facets.find(({ value }) => value === "within_1h")?.count).toBe(6);
    expect(facets.find(({ value }) => value === "within_3h")?.count).toBe(7);
    expect(facets.find(({ value }) => value === "unconfirmed")?.count).toBe(9);
    expect(normalizedEntryFacets([{ value: "没有入口", count: 2 }, { value: "无入口", count: 3 },
      { value: null, count: 5 }]).find(({ value }) => value === "none")?.count).toBe(5);
    expect(normalizedLinkFacets([{ value: "电话", count: 2 }, { value: "可带电话", count: 3 }])
      .find(({ value }) => value === "phone")?.count).toBe(5);
  });
});
