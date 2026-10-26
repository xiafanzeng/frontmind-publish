import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import TitlesPage from "./TitlesPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import { PublishingFlowProvider, type PublishingFlow } from "../PublishingFlowContext";
import type { PublisherGateway } from "../gateway";
import { publicationLineTotal } from "../publicationAmounts";
import type { MediaResource, PublicationBatch, PublicationDraft, PublicationPreflight, PublishingDashboard, SaveDraftTitlesInput } from "../types";

export const media = (id: string): MediaResource => ({
  id, name: `媒体 ${id}`, shortName: id, kind: "news", platform: "网站", taxonomy: "综合",
  mediaType: "新闻", channel: "综合", region: "全国", logoSource: "generated_fallback",
  logoResolutionStatus: "missing", titleLimit: 40, priceTenThousandths: "10000",
  turnaround: "1 天", capability: "text", active: true, catalogRevision: "catalog-1",
});
export const draft = (id: string, mode: "single" | "per_media" = "per_media"): PublicationDraft => ({
  id, articleId: `article-${id}`, articleVersionId: `version-${id}`, articleTitle: `稿件 ${id}`,
  articleVersion: 1, articleVersionHash: `hash-${id}`, articleContainsImages: false,
  revision: 1, titleMode: mode, ...(mode === "single" ? {sharedTitle: `${id} 的上游确认标题`} : {}),
  items: ["shared", "other"].map(id => ({media: media(id), title: "初始标题"})),
  updatedAt: "2026-10-26T00:00:00.000Z",
});
export function snapshot(value: PublicationDraft, available = "100000"): PublicationPreflight {
  const items = value.items.map(item => ({...item, priceTenThousandths: publicationLineTotal(item)!,
    blockers: [], warnings: [], checks: [{label: "正文符合要求", passed: true}]}));
  const total = items.reduce((sum, item) => sum + BigInt(item.priceTenThousandths), 0n);
  return {
    revision: `preflight-${value.id}-${value.revision}`, draftRevision: value.revision,
    quoteFingerprint: `quote-${value.id}-${value.revision}`, mode: "mock", titleMode: value.titleMode,
    expiresAt: "2027-01-01T00:00:00Z", catalogRevision: "catalog-1",
    article: {id: value.articleId, title: value.articleTitle, version: value.articleVersion,
      versionId: value.articleVersionId, hash: value.articleVersionHash, wordCount: 10,
      imageCount: 0, images: [], bodyHtml: `<p>${value.id} 的冻结正文</p>`},
    items, totalTenThousandths: total.toString(), availableAfterTenThousandths: (BigInt(available) - total).toString(),
    wallet: {availableTenThousandths: available}, blockers: [], warnings: [], gates: [],
  } as unknown as PublicationPreflight;
}
export function dashboard(availableTenThousandths = "100000"): PublishingDashboard {
  return {wallet: {availableTenThousandths, reservedTenThousandths: "0", frozenTenThousandths: "0"},
    catalog: {activeRevision: "catalog-1", lastSyncedAt: "2026-10-26T00:00:00Z", stale: false},
    articleCount: 2, actionableItemCount: 0, resumableDraftCount: 2, resumableDrafts: [],
    processingBatchCount: 0, processingBatches: [], recentBatches: [], resumableArticles: []};
}
export function acceptedBatch(id: string, unknown = false, total = "20000"): PublicationBatch {
  return {id: "batch-" + id, articleTitle: "稿件 " + id, status: unknown ? "action_required" : "queued",
    itemCount: 2, failedCount: 0, unknownCount: unknown ? 1 : 0, totalTenThousandths: total, items: []} as unknown as PublicationBatch;
}
export function taskFlow(selections: Record<string, unknown> = {}, pending = false): PublishingFlow {
  return {taskId: "task-batch-confirmation", scopeKey: "project-one", agentId: "publishing", pending, selections, resources: [],
    ensureTask: async () => "task-batch-confirmation", setSummary: vi.fn(), record: vi.fn(async () => undefined),
    saveSelections: vi.fn(async () => undefined), saveValues: vi.fn(async () => undefined), handoff: vi.fn(async () => undefined)};
}
interface SetupResult {
  container: HTMLElement;
  unmount: () => void;
  rerender: (ui: React.ReactElement) => void;
  view: (currentFlow?: PublishingFlow) => React.ReactElement;
  gateway: PublisherGateway;
  drafts: Map<string, PublicationDraft>;
  events: string[];
  location: ReturnType<typeof memoryLocation>;
  getDraft: Mock<PublisherGateway["getDraft"]>;
  updateDraftMedia: Mock<PublisherGateway["updateDraftMedia"]>;
  saveDraftTitles: Mock<PublisherGateway["saveDraftTitles"]>;
  preflightDraft: Mock<PublisherGateway["preflightDraft"]>;
  submitDraft: Mock<PublisherGateway["submitDraft"]>;
  getDashboard: Mock<PublisherGateway["getDashboard"]>;
  getBatch: Mock<PublisherGateway["getBatch"]>;
}
export function setup(initial = [draft("A"), draft("B")], extraQuery = "", flow?: PublishingFlow, overrides: Partial<PublisherGateway> = {}): SetupResult {
  const drafts = new Map(initial.map(value => [value.id, value]));
  const originalItems = new Map(initial.map(value => [value.id, value.items]));
  const events: string[] = [];
  const getDraft = vi.fn<PublisherGateway["getDraft"]>(async id => drafts.get(id)!);
  const updateDraftMedia = vi.fn<PublisherGateway["updateDraftMedia"]>(async (id, ids, revision) => {
    const current = drafts.get(id)!;
    if (current.revision !== revision) throw new Error("revision conflict");
    events.push("media:" + id);
    const next = {...current, revision: revision + 1, items: ids.map(mediaId =>
      current.items.find(item => item.media.id === mediaId) ?? originalItems.get(id)!.find(item => item.media.id === mediaId)!)};
    drafts.set(id, next);
    return next;
  });
  const saveDraftTitles = vi.fn<PublisherGateway["saveDraftTitles"]>(async (id, raw) => {
    const input = raw as SaveDraftTitlesInput;
    const current = drafts.get(id)!;
    if (current.revision !== input.expectedRevision) throw new Error("revision conflict");
    events.push("save:" + id);
    const next = {...current, revision: current.revision + 1, titleMode: input.mode,
      ...(input.mode === "single" && input.sharedTitle !== undefined ? {sharedTitle: input.sharedTitle} : {}),
      items: current.items.map(item => ({...item, title: (input.mode === "single" ? input.sharedTitle : input.titles[item.media.id]) ?? item.title}))};
    drafts.set(id, next);
    return next;
  });
  const preflightDraft = vi.fn<PublisherGateway["preflightDraft"]>(async id => {events.push("preflight:" + id); return snapshot(drafts.get(id)!);});
  const submitDraft = vi.fn<PublisherGateway["submitDraft"]>(async input => {
    events.push("submit:" + input.draftId);
    return acceptedBatch(input.draftId, false, snapshot(drafts.get(input.draftId)!).totalTenThousandths);
  });
  const getDashboard = vi.fn<PublisherGateway["getDashboard"]>(async () => dashboard());
  const getBatch = vi.fn<PublisherGateway["getBatch"]>(async id => acceptedBatch(id.replace(/^batch-/, "")));
  const gateway = {getDraft, updateDraftMedia, saveDraftTitles, preflightDraft, submitDraft, getDashboard, getBatch, ...overrides} as unknown as PublisherGateway;
  const firstId = initial[0]!.id;
  const path = `/publishing/drafts/${firstId}/titles?` + initial.map(item => `batchDraft=${item.id}`).join("&") + extraQuery;
  window.history.replaceState({}, "", path);
  const location = memoryLocation({path, record: true});
  const view = (currentFlow = flow) => {
    const content = <TitlesPage draftId={firstId} />;
    return <Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}>
      {currentFlow ? <PublishingFlowProvider value={currentFlow}>{content}</PublishingFlowProvider> : content}
    </PublishingGatewayProvider></Router>;
  };
  return {...render(view()), view, gateway, drafts, events, location, getDraft, updateDraftMedia, saveDraftTitles,
    preflightDraft, submitDraft, getDashboard, getBatch};
}
export async function readyToConfirm() {
  const button = await screen.findByRole("button", {name: "确认发布"});
  await waitFor(() => {if ((button as HTMLButtonElement).disabled) throw new Error("confirmation is not ready");});
  return button;
}
export async function beginConfirmation() {fireEvent.click(await readyToConfirm());}
export async function confirmFinal() {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", {name: /^(确认模拟发布|提交并预占|核实原请求)/}));
}
export function feeValue(label: string) {
  return within(screen.getByRole("region", {name: "费用与预算核验"})).getByText(label).nextElementSibling!.textContent;
}
