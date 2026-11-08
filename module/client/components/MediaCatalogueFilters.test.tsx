// @vitest-environment jsdom
import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MediaCatalogueFilters from "./MediaCatalogueFilters";
import { DEFAULT_MEDIA_FILTERS } from "../queryState";
import type { MediaFilters, MediaFacets } from "../types";
import { ADVANCED_FILTER_VERSION, PUBLISH_TIME_OPTIONS, ENTRY_OPTIONS, LINK_OPTIONS, FESTIVAL_OPTIONS } from "../../shared/media-advanced-filters";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const facets = {
  filterSchemaVersion: 2,
  advancedFilterVersion: ADVANCED_FILTER_VERSION,
  publishTimeBands: PUBLISH_TIME_OPTIONS.filter(option => option.value).map(option => ({ ...option, count: 2 })),
  entryCategories: ENTRY_OPTIONS.filter(option => option.value).map(option => ({ ...option, count: 2 })),
  linkCategories: LINK_OPTIONS.filter(option => option.value).map(option => ({ ...option, count: 2 })),
  festivalStatuses: FESTIVAL_OPTIONS.filter(option => option.value).map(option => ({ ...option, count: option.value === "unspecified" ? 0 : 2 })),
  coverageProvinces: ["全国覆盖", "综合全国（待确认）", "广东", "浙江"].map(value => ({ value, label: value, count: 4 })),
  coverageCities: [{ province: "广东", value: "深圳市", label: "深圳市", count: 1 }, { province: "浙江", value: "杭州市", label: "杭州市", count: 1 }],
  aiPlatforms: [{ value: "DeepSeek", label: "DeepSeek", count: 1 }],
  recommendationGroups: [{ value: "带视频", label: "带视频", count: 1 }],
  taxonomies: [{ value: "财经商业", label: "财经商业", count: 4 }],
  platforms: [{ value: "其他门户", label: "其他门户", count: 4 }],
  areas: [{ value: "全国", label: "全国", count: 4 }],
  mediaTypes: [], includeTypes: [], publishSpeeds: [], entryTypes: [], linkTypes: [],
  pcWeightThresholds: [], mobileWeightThresholds: [], includeRateThresholds: [], successRateThresholds: [],
  recommendedOptions: [{ value: "true", label: "推荐媒体", count: 1 }],
  recommendationTags: [{ value: "带视频", label: "带视频", count: 1 }],
  authenticatedOptions: [], festivalPublishableOptions: [],
} as unknown as MediaFacets;

function harness(initial: Partial<MediaFilters> = {}) {
  const changed = vi.fn();
  function Harness() {
    const [filters, setFilters] = useState<MediaFilters>({ ...DEFAULT_MEDIA_FILTERS, kind: undefined, searchScope: "name", ...initial });
    return <MediaCatalogueFilters filters={filters} facets={facets} facetsLoading={false} onRetry={() => {}} onChange={next => { changed(next); setFilters(next); }} onReset={() => { const next = { ...DEFAULT_MEDIA_FILTERS, kind: undefined }; changed(next); setFilters(next); }} />;
  }
  render(<Harness />);
  return changed;
}

describe("media catalogue filter interaction contract", () => {
  it("shows a retryable unavailable state instead of empty options after a failed read", () => {
    const retry = vi.fn(), changed = vi.fn();
    render(<MediaCatalogueFilters filters={{ ...DEFAULT_MEDIA_FILTERS, province: "广东", taxonomy: "财经商业" }}
      facetsLoading={false} facetsError="Failed query: select entry_level from publisher_media_resources params: news"
      onRetry={retry} onChange={changed} onReset={() => {}} />);
    expect(screen.queryByText("暂无可用选项")).toBeNull();
    expect(screen.queryByText("暂无可筛选城市")).toBeNull();
    expect(document.body.textContent).not.toContain("publisher_media_resources");
    expect(screen.getAllByText("选项尚未读取，请重试").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "移除频道：财经商业" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it("keeps same-version cached options usable while showing their refresh state", () => {
    render(<MediaCatalogueFilters filters={{ ...DEFAULT_MEDIA_FILTERS, kind: undefined }}
      facets={facets} facetsLoading={false} facetsRefreshing onRetry={() => {}}
      onChange={() => {}} onReset={() => {}} />);
    expect(screen.getByText(/正在更新筛选选项；当前显示上次读取的真实选项/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "展开频道类型选项" }));
    expect((screen.getByRole("button", { name: "财经商业" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not search during IME composition and clears immediately without a stale timer", () => {
    vi.useFakeTimers();
    const changed = harness();
    const input = screen.getByLabelText("媒体搜索");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "媒体甲" } });
    act(() => vi.advanceTimersByTime(500));
    expect(changed).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { data: "媒体甲" });
    act(() => vi.advanceTimersByTime(300));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ query: "媒体甲", searchScope: "name", page: 1 }));
    fireEvent.change(input, { target: { value: "媒体乙" } });
    fireEvent.click(screen.getByRole("button", { name: "清空媒体搜索" }));
    act(() => vi.advanceTimersByTime(500));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ query: "" }));
  });

  it("combines real dimensions and removes only the selected dimension", () => {
    const changed = harness({ page: 3 });
    fireEvent.click(screen.getByRole("button", { name: "展开频道类型选项" }));
    fireEvent.click(screen.getByRole("button", { name: "财经商业" }));
    fireEvent.change(screen.getByLabelText("省份/地区"), { target: { value: "广东" } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ taxonomy: "财经商业", province: "广东", page: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "移除频道：财经商业" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ taxonomy: "", province: "广东" }));
  });

  it("keeps supplier AI and recommendation dimensions independent without inventing choices", () => {
    const changed = harness();
    fireEvent.click(screen.getByRole("button", { name: "展开AI 类型选项" }));
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek" }));
    fireEvent.click(screen.getByRole("button", { name: "展开媒体推荐选项" }));
    fireEvent.click(screen.getByRole("button", { name: "带视频" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ aiPlatform: "DeepSeek", recommendationGroup: "带视频", recommendationTag: "", recommended: "" }));
    expect(screen.queryByRole("button", { name: "包收录" })).toBeNull();
    expect(within(screen.getByRole("group", { name: "媒体推荐" })).queryByRole("button", { name: "DeepSeek" })).toBeNull();
    expect(screen.queryByText(/AI 按供应商平台标签筛选/)).toBeNull();
  });

  it("clears dependent cities and exposes only one unrestricted coverage option", () => {
    const changed = harness({ province: "广东", city: "深圳市" });
    expect(within(screen.getByLabelText("城市")).queryByRole("option", { name: "杭州市" })).toBeNull();
    fireEvent.change(screen.getByLabelText("省份/地区"), { target: { value: "浙江" } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ province: "浙江", city: "", area: "", region: "" }));
    fireEvent.change(screen.getByLabelText("城市"), { target: { value: "杭州市" } });
    fireEvent.click(screen.getByRole("button", { name: "移除省份/地区：浙江" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ province: "", city: "" }));
    fireEvent.change(screen.getByLabelText("省份/地区"), { target: { value: "广东" } });
    fireEvent.change(screen.getByLabelText("城市"), { target: { value: "深圳市" } });
    fireEvent.change(screen.getByLabelText("省份/地区"), { target: { value: "" } });
    expect((screen.getByLabelText("城市") as HTMLSelectElement).disabled).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ province: "", city: "", area: "", region: "" }));
    expect(within(screen.getByLabelText("省份/地区")).getAllByRole("option").map(option => option.textContent)).toEqual(["不限地区", "广东", "浙江"]);
  });

  it.each(["province", "area", "region"] as const)("shows legacy unrestricted %s without stale city or active coverage chips", key => {
    const changed = harness({ [key]: "综合全国（待确认）", city: "深圳市" });
    expect((screen.getByLabelText("省份/地区") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("城市") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("城市") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText("未设置筛选条件")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("省份/地区"), { target: { value: "广东" } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ province: "广东", city: "", area: "", region: "" }));
  });

  it("retains old exact constraints visibly until the user explicitly replaces or removes them", () => {
    const changed = harness({ area: "不带", recommendationTag: "周末可发，高收录" });
    expect(screen.getByRole("button", { name: "移除原地区条件：不带" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "移除原推荐条件：周末可发，高收录" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "媒体推荐" })).getByRole("button", { name: "不限" }).getAttribute("aria-pressed")).toBe("false");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("省份/地区"), { target: { value: "广东" } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ province: "广东", area: "", recommendationTag: "周末可发，高收录" }));
  });

  it("removes bulk search and sorting controls while allowing old bulk conditions to be cleared", () => {
    const changed = harness({ batchQuery: "媒体甲\n媒体乙", sort: "price_desc" });
    expect(screen.queryByRole("button", { name: "查找多个媒体" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("媒体排序")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "移除多个名称：2 个" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ batchQuery: "", sort: "price_desc" }));
  });

  it("offers the ten ordered cumulative time choices and four holiday states in the same grid", () => {
    harness();
    fireEvent.click(screen.getByRole("button", { name: /展开高级选项/ }));
    const speed = screen.getByLabelText("预计发布时效");
    expect(within(speed).getAllByRole("option").map(option => option.textContent)).toEqual([
      "不限", "1小时内", "3小时内", "6小时内", "12小时内", "1天内", "2天内", "3天内", "3天以上", "时效待确认",
    ]);
    const festival = screen.getByLabelText("节假日发布");
    expect(within(festival).getAllByRole("option").map(option => option.textContent)).toEqual(["不限", "可发布", "不可发布", "未注明"]);
    expect((festival as HTMLSelectElement).disabled).toBe(false);
    expect(speed.closest(".mc-advanced-grid")).toBe(festival.closest(".mc-advanced-grid"));
    expect(document.querySelector(".mc-extra-options")).toBeNull();
    expect(document.querySelector(".mc-advanced .mc-note")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it.each([
    ["预计发布时效", "publishTimeBand", "within_3h", "publishSpeed", "一小时", "3小时内"],
    ["文章展示入口", "entryCategory", "none", "entryType", "没有入口", "无入口"],
    ["链接与联系方式", "linkCategory", "phone", "linkType", "电话", "可带电话"],
    ["节假日发布", "festivalStatus", "not_publishable", "festival", "true", "不可发布"],
  ] as const)("replaces only the corresponding exact legacy condition when changing %s", (label, key, value, legacyKey, legacy, display) => {
    const changed = harness({ [legacyKey]: legacy, province: "广东", page: 9 });
    fireEvent.click(screen.getByRole("button", { name: /展开高级选项/ }));
    const control = screen.getByLabelText(label) as HTMLSelectElement;
    expect(control.selectedOptions[0].textContent).toContain("原条件：");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(control, { target: { value } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ [key]: value, [legacyKey]: "", province: "广东", page: 1 }));
    expect(screen.getByRole("button", { name: `移除${label}：${display}` })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `移除${label}：${display}` }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ [key]: "", [legacyKey]: "", province: "广东", page: 1 }));
  });

  it("keeps exact authentication visibly removable without offering an unsupported certification control", () => {
    const changed = harness({ authenticated: "true", publishSpeed: "当天" });
    fireEvent.click(screen.getByRole("button", { name: /展开高级选项/ }));
    expect(screen.queryByLabelText("认证状态")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "移除原条件 · 发布速度：当天" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "移除原条件 · 已认证（目录未提供认证数据，可移除原条件）" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ authenticated: "", publishSpeed: "当天" }));
  });

  it("keeps help buttons separate from select labels and uses the established shared explanation owner", () => {
    harness();
    fireEvent.click(screen.getByRole("button", { name: /展开高级选项/ }));
    for (const label of ["预计发布时效", "文章展示入口", "链接与联系方式", "百度电脑端权重", "百度移动端权重", "收录率", "发布成功率", "节假日发布"]) {
      const trigger = screen.getByRole("button", { name: `${label}说明` });
      expect(trigger.closest("label")).toBeNull();
      expect(trigger.getAttribute("type")).toBe("button");
      const select = screen.getByLabelText(label);
      expect(trigger.closest(".mc-advanced-field")).toBe(select.closest(".mc-advanced-field"));
    }
  });

  it("does not offer new semantics for an older backend or silently broaden a restored exact value", () => {
    const changed = vi.fn();
    render(<MediaCatalogueFilters filters={{ ...DEFAULT_MEDIA_FILTERS, publishSpeed: "当天" }}
      facets={{ ...facets, advancedFilterVersion: undefined }} facetsLoading={false} onRetry={() => {}} onChange={changed} onReset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /展开高级选项/ }));
    const speed = screen.getByLabelText("预计发布时效") as HTMLSelectElement;
    expect(speed.disabled).toBe(true);
    expect(speed.selectedOptions[0].textContent).toBe("原条件：当天");
    expect(within(speed).queryByRole("option", { name: "3小时内" })).toBeNull();
    expect(screen.getByText(/当前媒体服务尚未支持新版高级筛选/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "移除原条件 · 发布速度：当天" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ publishSpeed: "" }));
  });

  it.each([
    ["loading", { facetsLoading: true }, "正在读取选项…"],
    ["error", { facetsLoading: false, facetsError: "network timeout" }, "选项读取失败，请重试"],
    ["version", { facetsLoading: false, facetsVersionMismatch: true }, "目录版本已变化，请重新读取"],
  ] as const)("distinguishes %s from successful empty facets", (_name, state, label) => {
    render(<MediaCatalogueFilters filters={{ ...DEFAULT_MEDIA_FILTERS }} {...state} onRetry={() => {}} onChange={() => {}} onReset={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /展开高级选项/ }));
    const speed = screen.getByLabelText("预计发布时效") as HTMLSelectElement;
    expect(speed.disabled).toBe(true);
    expect(speed.selectedOptions[0].textContent).toBe(label);
    expect(within(speed).queryByRole("option", { name: /暂无可用数据/ })).toBeNull();
  });
});
