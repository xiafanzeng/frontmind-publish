// @vitest-environment jsdom
import React, { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MediaCatalogueFilters from "./MediaCatalogueFilters";
import { DEFAULT_MEDIA_FILTERS } from "../queryState";
import type { MediaFilters, MediaFacets } from "../types";

vi.mock("../source-matrix/MediaMarket", () => ({
  MediaDialog: ({ open, children, onCancel, onConfirm, confirmLabel }: { open: boolean; children: ReactNode; onCancel: () => void; onConfirm: () => void; confirmLabel: string }) => open ? <div role="dialog">{children}<button onClick={onCancel}>取消</button><button onClick={onConfirm}>{confirmLabel}</button></div> : null,
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const facets = {
  filterSchemaVersion: 2,
  coverageProvinces: ["全国覆盖", "综合全国（待确认）", "广东", "浙江"].map(value => ({ value, label: value, count: 4 })),
  coverageCities: [{ province: "广东", value: "深圳市", label: "深圳市", count: 1 }, { province: "浙江", value: "杭州市", label: "杭州市", count: 1 }],
  aiPlatforms: [{ value: "DeepSeek", label: "DeepSeek", count: 1 }],
  recommendationGroups: [{ value: "带视频", label: "带视频", count: 1 }],
  taxonomies: [{ value: "财经商业", label: "财经商业", count: 4 }],
  platforms: [{ value: "其他门户", label: "其他门户", count: 4 }],
  areas: [{ value: "全国", label: "全国", count: 4 }],
  mediaTypes: [], includeTypes: [], publishSpeeds: [], entryTypes: [], linkTypes: [],
  pcWeightThresholds: [], includeRateThresholds: [], successRateThresholds: [],
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
    fireEvent.change(screen.getByLabelText("省份/地区"), { target: { value: "全国覆盖" } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ taxonomy: "财经商业", province: "全国覆盖", page: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "移除频道：财经商业" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ taxonomy: "", province: "全国覆盖" }));
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
    expect(screen.getByText(/AI 按供应商平台标签筛选/)).toBeTruthy();
  });

  it("clears a dependent city when province changes, while keeping nationwide distinct from no restriction", () => {
    const changed = harness({ province: "广东", city: "深圳市" });
    expect(within(screen.getByLabelText("城市")).queryByRole("option", { name: "杭州市" })).toBeNull();
    fireEvent.change(screen.getByLabelText("省份/地区"), { target: { value: "浙江" } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ province: "浙江", city: "", area: "", region: "" }));
    fireEvent.change(screen.getByLabelText("城市"), { target: { value: "杭州市" } });
    fireEvent.click(screen.getByRole("button", { name: "移除省份/地区：浙江" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ province: "", city: "" }));
    fireEvent.change(screen.getByLabelText("省份/地区"), { target: { value: "全国覆盖" } });
    expect((screen.getByLabelText("城市") as HTMLSelectElement).disabled).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ province: "全国覆盖", city: "" }));
    expect(within(screen.getByLabelText("省份/地区")).getByRole("option", { name: "综合全国（待确认）" })).toBeTruthy();
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

  it("keeps batch input uncommitted until confirmation and reports excessive names", () => {
    const changed = harness();
    fireEvent.click(screen.getByRole("button", { name: "查找多个媒体" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: Array.from({ length: 51 }, (_, i) => `媒体${i}`).join("\n") } });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "查找媒体" }));
    expect(within(dialog).getByRole("alert").textContent).toContain("50");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "媒体甲，媒体乙\n媒体甲" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "查找媒体" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ batchQuery: "媒体甲\n媒体乙" }));
  });
});
