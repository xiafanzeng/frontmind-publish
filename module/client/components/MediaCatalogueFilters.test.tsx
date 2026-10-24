// @vitest-environment jsdom
import React, { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MediaCatalogueFilters from "./MediaCatalogueFilters";
import { DEFAULT_MEDIA_FILTERS } from "../queryState";
import type { MediaFilters, MediaFacets } from "../types";

vi.mock("../source-matrix/MediaMarket", () => ({
  MediaDialog: ({ open, children, onCancel, onConfirm }: { open: boolean; children: ReactNode; onCancel: () => void; onConfirm: () => void }) => open ? <div role="dialog">{children}<button onClick={onCancel}>取消</button><button onClick={onConfirm}>查找匹配</button></div> : null,
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const facets = {
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
    fireEvent.click(screen.getByRole("button", { name: "财经商业", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "全国", exact: true }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ taxonomy: "财经商业", area: "全国", page: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "移除频道：财经商业" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ taxonomy: "", area: "全国" }));
  });

  it("leaves unsupported capabilities disabled while applying exact recommendation tags", () => {
    const changed = harness();
    expect((screen.getByRole("button", { name: "DeepSeek" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "包收录", exact: true }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "带视频", exact: true }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ recommendationTag: "带视频", recommended: "" }));
  });

  it("keeps batch input uncommitted until confirmation and reports excessive names", () => {
    const changed = harness();
    fireEvent.click(screen.getByRole("button", { name: "批量搜索" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: Array.from({ length: 51 }, (_, i) => `媒体${i}`).join("\n") } });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "查找匹配" }));
    expect(within(dialog).getByRole("alert").textContent).toContain("50");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "媒体甲，媒体乙\n媒体甲" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "查找匹配" }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ batchQuery: "媒体甲\n媒体乙" }));
  });
});
