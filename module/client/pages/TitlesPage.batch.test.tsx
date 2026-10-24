// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import TitlesPage from "./TitlesPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import { configurePublishingHost } from "../host";
import type { PublisherGateway } from "../gateway";
import type { MediaResource, PublicationDraft, SaveDraftTitlesInput } from "../types";

const media = (id: string): MediaResource => ({
  id, name: `媒体 ${id}`, shortName: id, kind: "news", platform: "网站", taxonomy: "综合",
  mediaType: "新闻", channel: "综合", region: "全国", logoSource: "generated_fallback",
  logoResolutionStatus: "missing", titleLimit: 20, priceTenThousandths: "10000",
  turnaround: "1 天", capability: "text", active: true, catalogRevision: "catalog-1",
});
const draft = (id: string): PublicationDraft => ({
  id, articleId: `article-${id}`, articleVersionId: `version-${id}`, articleTitle: `稿件 ${id}`,
  articleVersion: 1, articleVersionHash: `hash-${id}`, articleContainsImages: false,
  revision: 1, titleMode: "per_media", items: ["shared", "other"].map(id => ({ media: media(id), title: "初始标题" })),
  updatedAt: "2026-10-24T00:00:00.000Z",
});
function setup() {
  const drafts = new Map(["A", "B"].map(id => [id, draft(id)]));
  const getDraft = vi.fn<PublisherGateway["getDraft"]>(async id => drafts.get(id)!);
  const updateDraftMedia = vi.fn<PublisherGateway["updateDraftMedia"]>(async (id, ids, revision) => {
    const current = drafts.get(id)!;
    if (current.revision !== revision) throw new Error("revision conflict");
    const all = draft(id).items;
    const next = { ...current, revision: revision + 1, items: ids.map(mediaId => current.items.find(item => item.media.id === mediaId) ?? all.find(item => item.media.id === mediaId)!) };
    drafts.set(id, next);
    return next;
  });
  const saveDraftTitles = vi.fn<PublisherGateway["saveDraftTitles"]>(async (id, raw) => {
    const input = raw as SaveDraftTitlesInput;
    const current = drafts.get(id)!;
    if (current.revision !== input.expectedRevision) throw new Error("revision conflict");
    const next = { ...current, revision: current.revision + 1, titleMode: input.mode, sharedTitle: input.sharedTitle,
      items: current.items.map(item => ({ ...item, title: input.mode === "single" ? input.sharedTitle! : input.titles[item.media.id] })) };
    drafts.set(id, next);
    return next;
  });
  const gateway = { getDraft, updateDraftMedia, saveDraftTitles } as unknown as PublisherGateway;
  const path = "/publishing/drafts/A/titles?batchDraft=A&batchDraft=B";
  window.history.replaceState({}, "", path);
  const location = memoryLocation({ path, record: true });
  const onSaved = vi.fn();
  const view = () => <Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}><TitlesPage draftId="A" onSaved={onSaved} /></PublishingGatewayProvider></Router>;
  return { ...render(view()), view, gateway, getDraft, updateDraftMedia, saveDraftTitles, onSaved, drafts };
}
afterEach(() => { cleanup(); configurePublishingHost({}); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

it("keeps same-media edits independent and sends wholly excluded drafts to review without saving them", async () => {
  const task = setup();
  const aTitle = await screen.findByRole("textbox", { name: "稿件 A · 媒体 shared独立标题" });
  fireEvent.change(aTitle, { target: { value: "A 独立发布标题" } });
  expect((screen.getByRole("textbox", { name: "稿件 B · 媒体 shared独立标题" }) as HTMLInputElement).value).toBe("初始标题");
  fireEvent.click(screen.getByRole("checkbox", { name: "稿件 A · 媒体 other参与本次发布" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "稿件 B · 媒体 shared参与本次发布" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "稿件 B · 媒体 other参与本次发布" }));
  fireEvent.click(screen.getByRole("button", { name: "预检与发布" }));
  await waitFor(() => expect(task.onSaved).toHaveBeenCalledTimes(1));
  expect(task.updateDraftMedia).toHaveBeenCalledWith("A", ["shared"], 1);
  expect(task.saveDraftTitles).toHaveBeenCalledTimes(1);
  expect(task.saveDraftTitles).toHaveBeenCalledWith("A", { mode: "per_media", titles: { shared: "A 独立发布标题" }, expectedRevision: 2 });
  const review = new URL(task.onSaved.mock.calls[0][0], window.location.origin);
  expect(review.searchParams.getAll("batchDraft")).toEqual(["A", "B"]);
  expect(review.searchParams.getAll("excludedDraft")).toEqual(["B"]);
  expect(task.container.querySelectorAll(".publishing-title-table thead th")).toHaveLength(10);
  expect(task.container.querySelector(".publishing-title-help")).toBeNull();
});

it("blocks an entirely unchecked batch without making mutation calls", async () => {
  const task = setup();
  await screen.findByRole("heading", { name: "稿件 A" });
  for (const id of ["A", "B"]) for (const mediaId of ["shared", "other"])
    fireEvent.click(screen.getByRole("checkbox", { name: `稿件 ${id} · 媒体 ${mediaId}参与本次发布` }));
  fireEvent.click(screen.getByRole("button", { name: "预检与发布" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "请至少保留一个稿件的投放媒体，或返回选择媒体调整。");
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.updateDraftMedia).not.toHaveBeenCalled();
  expect(task.onSaved).not.toHaveBeenCalled();
});

it("retains excluded rows and their titles when returning from review", { timeout: 120000 }, async () => {
  const task = setup();
  const title = await screen.findByRole("textbox", { name: "稿件 A · 媒体 other独立标题" }, { timeout: 5000 });
  fireEvent.change(title, { target: { value: "返回时保留" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "稿件 A · 媒体 other参与本次发布" }));
  fireEvent.click(screen.getByRole("button", { name: "预检与发布" }));
  await waitFor(() => expect(task.onSaved).toHaveBeenCalledTimes(1));
  task.unmount();
  render(task.view());
  // Heavy server-kernel suites run concurrently and can starve this restore
  // render far past the default budget on a loaded host; keep a wide margin.
  const restored = await screen.findByRole("textbox", { name: "稿件 A · 媒体 other独立标题" }, { timeout: 90000 });
  expect((restored as HTMLInputElement).value).toBe("返回时保留");
  expect((screen.getByRole("checkbox", { name: "稿件 A · 媒体 other参与本次发布" }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "稿件 A · 媒体 other参与本次发布" }));
  expect((restored as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "预检与发布" }));
  await waitFor(() => expect(task.onSaved).toHaveBeenCalledTimes(2));
  expect(task.updateDraftMedia).toHaveBeenLastCalledWith("A", ["shared", "other"], 3);
});

it("stops on changed server membership before any writes and displays the latest selection", async () => {
  const task = setup();
  await screen.findByRole("heading", { name: "稿件 A" });
  const current = task.drafts.get("A")!;
  task.drafts.set("A", { ...current, revision: 2, items: current.items.filter(item => item.media.id === "shared") });
  fireEvent.click(screen.getByRole("button", { name: "预检与发布" }));
  await screen.findByText("部分草稿已更新，已同步最新媒体和版本并保留可用标题。请核对后再次进入预检。");
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.updateDraftMedia).not.toHaveBeenCalled();
  expect(screen.queryByRole("checkbox", { name: "稿件 A · 媒体 other参与本次发布" })).toBeNull();
}, 45000);

it("retries after a later draft fails using the latest successful revisions", async () => {
  const task = setup();
  const originalSave = task.saveDraftTitles.getMockImplementation()!;
  let failed = false;
  task.saveDraftTitles.mockImplementation(async (id, input) => {
    if (id === "B" && !failed) { failed = true; throw new Error("暂时无法保存"); }
    return originalSave(id, input);
  });
  await screen.findByRole("heading", { name: "稿件 A" });
  fireEvent.click(screen.getByRole("button", { name: "预检与发布" }));
  await screen.findByText(/稿件 B：暂时无法保存/);
  expect(task.onSaved).not.toHaveBeenCalled();
  expect(task.drafts.get("A")?.revision).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "预检与发布" }));
  await waitFor(() => expect(task.onSaved).toHaveBeenCalledTimes(1));
  const aCalls = task.saveDraftTitles.mock.calls.filter(([id]) => id === "A");
  expect((aCalls.at(-1)![1] as SaveDraftTitlesInput).expectedRevision).toBe(2);
  expect(task.drafts.get("B")?.revision).toBe(2);
});
