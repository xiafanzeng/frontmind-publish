// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import MediaLibraryPage from "./MediaLibraryPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import { PublishingFlowProvider, type PublishingFlow } from "../PublishingFlowContext";
import { configurePublishingHost } from "../host";
import type { PublisherGateway } from "../gateway";
import type { ArticleDetail, CatalogFreshness, MediaFacets, MediaResource, PublicationDraft } from "../types";

// Keep the real page, route state, query lifecycle and flow context. Only replace
// presentation and the separate media-rules API; these tests never use a network.
const marketRuleStatus = vi.hoisted(() => ({ ready: true, error: "", loading: false }));
vi.mock("../source-matrix/MediaMarket", () => ({
  useMarketRules: () => ({ key: "rules", rules: {}, ...marketRuleStatus, reload: () => {} }),
  rulesRequest: vi.fn(async () => ({ items: [] })),
  exportRows: vi.fn(),
  RowHead: () => null,
  MarketRemark: () => null,
  MediaDetails: () => null,
  MediaShell: ({ title, steps, taskbar, children }: { title: string; steps?: ReactNode; taskbar?: ReactNode; children: ReactNode }) => (
    <main><h1>{title}</h1>{steps}{taskbar}{children}</main>
  ),
  MediaTaskbar: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  MediaCartFooter: ({ count, total, nextDisabled, nextLabel, onNext, selectionPending }: { count: number; total?: string; nextDisabled?: boolean; nextLabel?: string; onNext?: () => void; selectionPending?: boolean }) => (
    <footer><output data-testid="cart-count">{selectionPending ? "待确认" : count}</output><output data-testid="cart-total">{selectionPending ? "待确认" : total}</output><button disabled={nextDisabled} onClick={onNext}>{nextLabel}</button></footer>
  ),
  MarketRow: ({ media, checked, disabled, onToggle, selectionDisabledReason }: { media: MediaResource; checked?: boolean; disabled?: boolean; onToggle?: () => void; selectionDisabledReason?: string }) => (
    <label><input type="checkbox" aria-label={`选择 ${media.name}`} checked={checked} disabled={disabled} onChange={onToggle} />{media.name}{selectionDisabledReason && <span>{selectionDisabledReason}</span>}</label>
  ),
  MediaDialog: ({ open, title, children, onCancel, onConfirm, confirmLabel, footer }: { open: boolean; title: string; children?: ReactNode; onCancel?: () => void; onConfirm?: () => void; confirmLabel?: string; footer?: ReactNode }) => open ? (
    <div role="dialog" aria-label={title}>{children}{footer ?? <><button onClick={onCancel}>取消</button><button onClick={onConfirm}>{confirmLabel}</button></>}</div>
  ) : null,
}));

const timestamp = "2026-10-23T00:00:00.000Z";
function media(id: string, overrides: Partial<MediaResource> = {}): MediaResource {
  return {
    id, name: `媒体 ${id}`, shortName: id, kind: "news", platform: "门户",
    taxonomy: "", mediaType: "", channel: "", region: "", titleLimit: 100,
    priceTenThousandths: "1000000", turnaround: "", active: true,
    capability: "image", catalogRevision: "catalog-1",
    logoSource: "generated_fallback", logoResolutionStatus: "missing", ...overrides,
  };
}
function article(overrides: Partial<ArticleDetail> = {}): ArticleDetail {
  return {
    id: "article-1", title: "已确认稿件", status: "frozen", currentVersionId: "version-1",
    currentVersion: 1, wordCount: 20, imageCount: 0, updatedAt: timestamp,
    revision: 1, bodyText: "稿件正文", images: [],
    versions: [{ id: "version-1", version: 1, hash: "hash-1", containsImages: false, frozen: true, createdAt: timestamp, createdBy: "账号" }],
    importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true }, ...overrides,
  };
}
function draft(items: MediaResource[], revision = 1): PublicationDraft {
  return {
    id: "draft-1", articleId: "article-1", articleVersionId: "version-1", articleTitle: "已确认稿件",
    articleVersion: 1, articleVersionHash: "hash-1", articleContainsImages: false,
    revision, titleMode: "single", sharedTitle: "已确认稿件", updatedAt: timestamp,
    items: items.map((item) => ({ media: item, title: "已确认稿件" })),
  };
}
function flow(overrides: Partial<PublishingFlow> = {}): PublishingFlow {
  const taskId = overrides.taskId ?? "task-1";
  return {
    taskId, scopeKey: "workspace-1", agentId: "media", selections: {}, resources: [], records: [],
    ensureTask: vi.fn(async () => taskId), setSummary: vi.fn(), record: vi.fn(async () => {}),
    saveSelections: vi.fn(async () => {}), saveValues: vi.fn(async () => {}), handoff: vi.fn(async () => {}),
    ...overrides,
  };
}
function gatewayFixture(items = [media("a"), media("b")], detail = article(), initialDraft?: PublicationDraft) {
  let saved = initialDraft;
  const catalog = { activeRevision: "catalog-1", mediaCount: items.length, newsCount: items.length, selfMediaCount: 0, kindComplete: true, lastSyncedAt: timestamp, stale: false };
  const facets: MediaFacets = {
    kinds: { news: items.length, self_media: 0 }, platforms: [], taxonomies: [], mediaTypes: [], areas: [],
    includeTypes: [], publishSpeeds: [], entryTypes: [], linkTypes: [], imageSupports: [],
    pcWeightThresholds: [], includeRateThresholds: [], successRateThresholds: [], recommendedOptions: [],
    authenticatedOptions: [], festivalPublishableOptions: [], catalog,
  };
  const getDraft = vi.fn<PublisherGateway["getDraft"]>(async () => {
    if (!saved) throw new Error("投放草稿不存在");
    return saved;
  });
  const createDraft = vi.fn<PublisherGateway["createDraft"]>(async (versionId, ids, _key, titleMode) => {
    saved = { ...draft(items.filter((item) => ids.includes(item.id))), articleVersionId: versionId, articleContainsImages: detail.versions.find((version) => version.id === versionId)?.containsImages ?? false, titleMode: titleMode ?? "single" };
    return saved;
  });
  const updateDraftMedia = vi.fn<PublisherGateway["updateDraftMedia"]>(async (_id, ids, revision) => {
    saved = { ...draft(items.filter((item) => ids.includes(item.id)), revision + 1), articleVersionId: saved?.articleVersionId ?? "version-1", articleContainsImages: saved?.articleContainsImages ?? false, titleMode: saved?.titleMode ?? "single" };
    return saved;
  });
  const saveDraftTitles = vi.fn<PublisherGateway["saveDraftTitles"]>(async (_id, input) => {
    if (!saved || !("expectedRevision" in input) || typeof input.expectedRevision !== "number") throw new Error("未读取当前投放草稿");
    const update = input as import("../types").SaveDraftTitlesInput;
    if (saved.revision !== update.expectedRevision) throw new Error("版本已变化");
    saved = { ...saved, revision: saved.revision + 1, titleMode: update.mode, sharedTitle: update.sharedTitle,
      items: saved.items.map(item => ({ ...item, title: update.titles[item.media.id] })) };
    return saved;
  });
  const getArticle = vi.fn<PublisherGateway["getArticle"]>(async () => detail);
  const getArticleVersion = vi.fn<PublisherGateway["getArticleVersion"]>(async (versionId) => {
    const version = detail.versions.find((candidate) => candidate.id === versionId);
    if (!version) throw new Error("冻结稿件版本不存在");
    return version;
  });
  const gateway = {
    listMedia: vi.fn<PublisherGateway["listMedia"]>(async (filters) => ({ items, total: items.length, page: filters.page, pageSize: filters.pageSize, catalog })),
    getMediaFacets: vi.fn(async () => facets), listArticles: vi.fn(async () => [detail]), getArticle, getArticleVersion,
    getDraft, createDraft, updateDraftMedia, saveDraftTitles,
  } as unknown as PublisherGateway;
  return { gateway, getArticle, getArticleVersion, getDraft, createDraft, updateDraftMedia, saveDraftTitles };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function harness(gateway: PublisherGateway, initialPath: string, initialFlow = flow()) {
  window.history.replaceState({}, "", initialPath);
  const location = memoryLocation({ path: initialPath, record: true });
  let currentGateway = gateway;
  let currentFlow = initialFlow;
  function RoutedPage() {
    const [path] = useLocation();
    const draftId = /^\/publishing\/drafts\/([^/]+)\/media/.exec(path)?.[1];
    const view = path.endsWith("/cart") ? "cart" : path.endsWith("/third") ? "third" : "home";
    return <MediaLibraryPage draftId={draftId} view={view} />;
  }
  const tree = () => (
    <Router hook={location.hook} searchHook={location.searchHook}>
      <PublishingGatewayProvider gateway={currentGateway}><PublishingFlowProvider value={currentFlow}><RoutedPage /></PublishingFlowProvider></PublishingGatewayProvider>
    </Router>
  );
  const view = render(tree());
  const rerenderContext = (nextGateway: PublisherGateway, nextFlow: PublishingFlow) => {
    currentGateway = nextGateway;
    currentFlow = nextFlow;
    view.rerender(tree());
  };
  return { ...view, location, rerenderContext, rerenderFlow: (next: PublishingFlow) => rerenderContext(currentGateway, next) };
}
const choice = (id: string) => screen.getByRole("checkbox", { name: `选择 媒体 ${id}` }) as HTMLInputElement;
const pageSelection = () => screen.getByRole("checkbox", { name: "本页全选" }) as HTMLInputElement;
const count = () => screen.getByTestId("cart-count").textContent;

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  Object.assign(marketRuleStatus, { ready: true, error: "", loading: false });
});
afterEach(() => {
  cleanup();
  configurePublishingHost({});
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("media selection context and persistence", () => {
  it("keeps catalogue requests stable across context-only URL changes", async () => {
    const fixture = gatewayFixture();
    const view = harness(fixture.gateway, "/publishing/media/third");
    await waitFor(() => expect(choice("a")).not.toBeNull());
    expect(fixture.gateway.listMedia).toHaveBeenCalledTimes(1);
    await act(async () => { view.location.navigate("/publishing/media/third?kind=all&workbenchTask=other-task"); });
    expect(fixture.gateway.listMedia).toHaveBeenCalledTimes(1);
    expect(fixture.gateway.getMediaFacets).toHaveBeenCalledTimes(1);
  });

  it("uses a bound draft's metadata without downloading all article choices", async () => {
    const fixture = gatewayFixture(undefined, article(), draft([media("a")]));
    harness(fixture.gateway, "/publishing/drafts/draft-1/media/third");
    await waitFor(() => expect(count()).toBe("1"));
    expect(fixture.gateway.listArticles).not.toHaveBeenCalled();
    expect(screen.getByText("已确认稿件 · v1")).not.toBeNull();
  });

  it("keeps directory browsing independent from draft and facet failures without a false empty cart", async () => {
    const fixture = gatewayFixture();
    let draftUnavailable = true;
    fixture.gateway.getDraft = vi.fn(async () => {
      if (draftUnavailable) throw new Error("Failed query: select id from publisher_runtime_state params: kol,1");
      return draft([media("a")]);
    });
    fixture.gateway.getMediaFacets = vi.fn(async () => { throw new Error("Failed query: select entry_level from publisher_media_resources"); });
    harness(fixture.gateway, "/publishing/drafts/draft-1/media/third");
    await waitFor(() => expect(screen.getAllByText(/暂时无法读取当前草稿/).length).toBeGreaterThan(0));
    expect(choice("a").disabled).toBe(true);
    expect(screen.queryByText("没有匹配的媒体")).toBeNull();
    expect(screen.queryByText("暂无可用选项")).toBeNull();
    expect(document.body.textContent).not.toContain("publisher_runtime_state");
    expect(document.body.textContent).not.toContain("publisher_media_resources");
    expect(count()).toBe("待确认");
    expect(screen.getByTestId("cart-total").textContent).toBe("待确认");
    draftUnavailable = false;
    fireEvent.click(screen.getByRole("button", { name: "重试读取草稿" }));
    await waitFor(() => expect(count()).toBe("1"));
    expect(choice("a").checked).toBe(true);
    expect(fixture.gateway.getMediaFacets).toHaveBeenCalledTimes(1);
  });

  it("leaves article summaries off the unbound library cold path and loads them for a bound article", async () => {
    const fixture = gatewayFixture(undefined, article({ title: "按需加载专用稿件" }));
    const browsing = harness(fixture.gateway, "/publishing/media/third");
    await waitFor(() => expect(choice("a")).not.toBeNull());
    expect(fixture.gateway.listArticles).not.toHaveBeenCalled();
    expect(fixture.gateway.listMedia).toHaveBeenCalled();
    expect(fixture.gateway.getMediaFacets).toHaveBeenCalled();
    browsing.unmount();

    harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1");
    await waitFor(() => expect(screen.getByText("按需加载专用稿件 · v1")).not.toBeNull());
    expect(fixture.gateway.listArticles).toHaveBeenCalledTimes(1);
  });

  it("does not present facet options from another catalogue revision as current", async () => {
    const fixture = gatewayFixture();
    const readFacets = fixture.gateway.getMediaFacets;
    let facetRevision = "catalog-previous";
    fixture.gateway.getMediaFacets = vi.fn<PublisherGateway["getMediaFacets"]>(async (filters, signal) => {
      const result = await readFacets(filters, signal);
      return {
        ...result,
        taxonomies: [{ value: "财经商业", label: "财经商业", count: 1 }],
        catalog: { ...result.catalog, activeRevision: facetRevision },
      };
    });
    harness(fixture.gateway, "/publishing/media/third");
    await waitFor(() => expect(screen.getByText(/旧版筛选选项暂不展示/)).not.toBeNull());
    expect(choice("a")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "财经商业" })).toBeNull();

    facetRevision = "catalog-1";
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(screen.queryByText(/旧版筛选选项暂不展示/)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "展开频道类型选项" }));
    expect(screen.getByRole("button", { name: "财经商业" })).not.toBeNull();
  });

  it("shows loaded rows before rules arrive while keeping new selections blocked", async () => {
    Object.assign(marketRuleStatus, { ready: false, loading: true });
    const fixture = gatewayFixture();
    const view = harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1");
    await waitFor(() => expect(choice("a").disabled).toBe(true));
    expect(screen.getByText(/媒体已载入，正在读取投稿要求/)).not.toBeNull();
    expect(screen.queryByText("没有匹配的媒体")).toBeNull();
    expect(pageSelection().disabled).toBe(true);
    fireEvent.click(choice("a"));
    expect(fixture.createDraft).not.toHaveBeenCalled();

    Object.assign(marketRuleStatus, { ready: true, loading: false });
    view.rerenderFlow(flow());
    await waitFor(() => expect(choice("a").disabled).toBe(false));
    expect(screen.queryByText(/媒体已载入，正在读取投稿要求/)).toBeNull();
  });

  it("keeps rows visible with a rules retry when rule loading fails", async () => {
    Object.assign(marketRuleStatus, { ready: false, error: "读取超时" });
    const fixture = gatewayFixture();
    harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1");
    await waitFor(() => expect(choice("a").disabled).toBe(true));
    expect(screen.getByRole("button", { name: "重试读取投稿要求" })).not.toBeNull();
    expect(screen.queryByText("没有匹配的媒体")).toBeNull();
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it.each(["news", "self_media"] as const)("saves and restores unknown image requirements for an image article in %s", async (kind) => {
    const pending = media("pending", { kind, capability: "image_pending", priceTenThousandths: "3850000" });
    const detail = article();
    detail.versions[0]!.containsImages = true;
    const fixture = gatewayFixture([pending, media("text", { kind, capability: "text" })], detail);
    const view = harness(fixture.gateway, `/publishing/media?articleVersion=version-1&kind=${kind}`);
    fireEvent.click(screen.getByRole("link", { name: "进入媒体库 →" }));
    await waitFor(() => expect(choice("pending").disabled).toBe(false));
    expect(choice("text").disabled).toBe(true);
    fireEvent.click(choice("pending"));
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalledWith("version-1", ["pending"], expect.any(String), "single"));
    await waitFor(() => expect(choice("pending").checked && !choice("pending").disabled).toBe(true));
    expect(count()).toBe("1");
    expect(screen.getByTestId("cart-total").textContent).toBe("3850000");
    expect(pending.capability).toBe("image_pending");
    view.unmount();

    // A fresh mount reads the saved draft rather than a local checkbox state.
    harness(fixture.gateway, `/publishing/drafts/draft-1/media/third?articleVersion=version-1&kind=${kind}`);
    await waitFor(() => expect(choice("pending").checked && !choice("pending").disabled).toBe(true));
    expect(choice("text").disabled).toBe(true);
    expect(count()).toBe("1");
    expect(screen.getByTestId("cart-total").textContent).toBe("3850000");
    expect((screen.getByRole("button", { name: "配置标题" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(choice("pending"));
    await waitFor(() => expect(fixture.updateDraftMedia).toHaveBeenCalledWith("draft-1", [], 1));
    await waitFor(() => expect(count()).toBe("0"));
    expect(screen.getByTestId("cart-total").textContent).toBe("0");
    expect(fixture.createDraft).toHaveBeenCalledTimes(1);
  });

  it("bulk-selects unknown and supported image media while keeping explicit bans and other restrictions", async () => {
    const detail = article();
    detail.versions[0]!.containsImages = true;
    const fixture = gatewayFixture([
      media("pending", { capability: "image_pending", priceTenThousandths: "3850000" }),
      media("image"),
      media("text", { capability: "text" }),
      media("remark-ban", { capability: "image_pending", remark: "仅限纯文字" }),
      media("inactive", { capability: "image_pending", active: false }),
      media("unpriced", { capability: "image_pending", priceTenThousandths: "0" }),
    ], detail);
    harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1");
    await waitFor(() => expect(choice("pending").disabled).toBe(false));
    fireEvent.click(pageSelection());
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalledWith("version-1", ["pending", "image"], expect.any(String), "single"));
    await waitFor(() => expect(pageSelection().checked && !pageSelection().disabled).toBe(true));
    expect(count()).toBe("2");
    expect(screen.getByTestId("cart-total").textContent).toBe("4850000");
    for (const id of ["text", "remark-ban", "inactive", "unpriced"]) {
      expect(choice(id).checked).toBe(false);
      expect(choice(id).disabled).toBe(true);
    }
    fireEvent.click(pageSelection());
    await waitFor(() => expect(fixture.updateDraftMedia).toHaveBeenCalledWith("draft-1", [], 1));
    await waitFor(() => expect(count()).toBe("0"));
  });

  it("carries every business reference from the home to matrix without treating matrix task as workbench task", async () => {
    const fixture = gatewayFixture();
    harness(fixture.gateway, "/publishing/media?articleVersion=version-1&mode=multi&workbenchTask=task-1&matrixTask=matrix-1&enterpriseProjectId=project-1&operatorOwnerId=9");
    const target = new URL(screen.getByRole('link', { name: '进入信源矩阵 →' }).getAttribute('href')!, window.location.origin);
    expect(target.pathname).toBe('/publishing/source-matrix');
    for (const [key, value] of Object.entries({ articleVersion: 'version-1', mode: 'multi', workbenchTask: 'task-1', task: 'matrix-1', enterpriseProjectId: 'project-1', operatorOwnerId: '9' }))
      expect(target.searchParams.get(key)).toBe(value);
    expect(target.searchParams.has('matrixTask')).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', { name: /当前稿件/ }).textContent).toContain('已确认稿件'));
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("registers the exact newly saved draft and keeps the list open for the next choice", async () => {
    const fixture = gatewayFixture();
    const currentFlow = flow();
    const view = harness(fixture.gateway, '/publishing/media/third?articleVersion=version-1', currentFlow);
    await waitFor(() => expect(choice('a').disabled).toBe(false));
    fireEvent.click(choice('a'));
    await waitFor(() => expect(currentFlow.record).toHaveBeenCalledWith({
      id: 'media-draft:draft-1', label: '已保存媒体选择', resources: [
        { kind: 'article_version', id: 'version-1' }, { kind: 'publication_draft', id: 'draft-1' },
      ],
    }));
    await waitFor(() => expect(view.location.history.at(-1)).toContain('/publishing/drafts/draft-1/media/third?'));
    await waitFor(() => expect(choice('b').disabled).toBe(false));
    fireEvent.click(choice('b'));
    await waitFor(() => expect(fixture.updateDraftMedia).toHaveBeenCalledWith('draft-1', ['a', 'b'], 1));
    expect(fixture.createDraft).toHaveBeenCalledTimes(1);
  });

  it("continues the first click when the host assigns exactly the task returned by ensureTask", async () => {
    const fixture = gatewayFixture(), pendingTask = deferred<string>();
    const ensureTask = vi.fn(() => pendingTask.promise);
    const original = flow({ taskId: undefined, ensureTask });
    const view = harness(fixture.gateway, '/publishing/media/third?articleVersion=version-1', original);
    await waitFor(() => expect(choice('a').disabled).toBe(false));
    fireEvent.click(choice('a'));
    await waitFor(() => expect(ensureTask).toHaveBeenCalledTimes(1));
    view.rerenderFlow({ ...original, taskId: 'created-task' });
    await act(async () => { pendingTask.resolve('created-task'); });
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalledWith('version-1', ['a'], expect.any(String), 'single'));
    await waitFor(() => expect(choice('a').checked).toBe(true));
    expect(new URL(view.location.history.at(-1)!, window.location.origin).searchParams.get('workbenchTask')).toBe('created-task');
    expect(fixture.createDraft).toHaveBeenCalledTimes(1);
  });

  it.each(['multi', 'per_media'])('keeps the %s mode when creating the first selection draft', async mode => {
    const fixture = gatewayFixture();
    harness(fixture.gateway, `/publishing/media/third?articleVersion=version-1&mode=${mode}`);
    await waitFor(() => expect(choice('a').disabled).toBe(false));
    fireEvent.click(choice('a'));
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalledWith('version-1', ['a'], expect.any(String), 'per_media'));
  });

  // Batch entries hold one common selection for the whole group; per-media drafts are
  // only created when the batch is confirmed. Existing per-draft modes are retained.
  it('holds the batch selection instead of creating the first draft immediately', async () => {
    const fixture = gatewayFixture();
    harness(fixture.gateway, '/publishing/media/third?articleVersion=version-1&mode=batch');
    await waitFor(() => expect(choice('a').disabled).toBe(false));
    fireEvent.click(choice('a'));
    await waitFor(() => expect(choice('a').checked).toBe(true));
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("does not save a first click to a different task assigned while ensureTask is pending", async () => {
    const fixture = gatewayFixture(), pendingTask = deferred<string>();
    const ensureTask = vi.fn(() => pendingTask.promise);
    const original = flow({ taskId: undefined, ensureTask });
    const view = harness(fixture.gateway, '/publishing/media/third?articleVersion=version-1', original);
    await waitFor(() => expect(choice('a').disabled).toBe(false));
    fireEvent.click(choice('a'));
    await waitFor(() => expect(ensureTask).toHaveBeenCalledTimes(1));
    view.rerenderFlow({ ...original, taskId: 'another-task' });
    await act(async () => { pendingTask.resolve('created-task'); });
    expect(fixture.createDraft).not.toHaveBeenCalled();
    expect(choice('a').checked).toBe(false);
    expect(count()).toBe('0');
  });

  it("retains the server draft and exposes registration retry when task registration fails", async () => {
    const fixture = gatewayFixture();
    const record = vi.fn<PublishingFlow['record']>().mockRejectedValueOnce(new Error('任务写入失败')).mockResolvedValue(undefined);
    const view = harness(fixture.gateway, '/publishing/media/third?articleVersion=version-1', flow({ record }));
    await waitFor(() => expect(choice('a').disabled).toBe(false));
    fireEvent.click(choice('a'));
    await waitFor(() => expect(view.location.history.at(-1)).toContain('/publishing/drafts/draft-1/media/third?'));
    await waitFor(() => expect(choice('a').checked).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: '重试关联任务' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试关联任务' })).toBeNull());
    expect(record).toHaveBeenCalledTimes(2);
    expect(fixture.createDraft).toHaveBeenCalledTimes(1);
  });

  it("does not present a failed home cart read as a confirmed empty cart", async () => {
    const fixture = gatewayFixture();
    fixture.getDraft.mockRejectedValue(new Error('读取失败'));
    harness(fixture.gateway, '/publishing/drafts/draft-1/media');
    expect(await screen.findByText(/投放草稿读取失败/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试读取草稿' })).toBeTruthy();
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("totals only known prices on the shared home cart", async () => {
    const fixture = gatewayFixture();
    harness(fixture.gateway, '/publishing/media', flow({ selections: { mediaSelection: [media('a'), media('unknown', { priceTenThousandths: '' })] } }));
    await waitFor(() => expect(count()).toBe('2'));
    expect(screen.getByTestId('cart-total').textContent).toBe('1000000');
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("explains the server title restriction without bypassing the failed save", async () => {
    const fixture = gatewayFixture();
    fixture.createDraft.mockRejectedValueOnce(new Error('Media title is invalid'));
    harness(fixture.gateway, '/publishing/media/third?articleVersion=version-1');
    await waitFor(() => expect(choice('a').disabled).toBe(false));
    fireEvent.click(choice('a'));
    expect(await screen.findByText(/所选媒体的提交标题不符合要求/)).toBeTruthy();
    expect(choice('a').checked).toBe(false);
    expect(count()).toBe('0');
    expect(fixture.updateDraftMedia).not.toHaveBeenCalled();
  });

  it("carries the frozen article, mode, task and workspace from home into media selection", async () => {
    configurePublishingHost({ workspaceUrl: (path) => {
      const url = new URL(path, window.location.origin);
      url.searchParams.set("enterpriseProjectId", "project-1");
      url.searchParams.set("operatorOwnerId", "9");
      return `${url.pathname}${url.search}`;
    } });
    const fixture = gatewayFixture();
    harness(fixture.gateway, "/publishing/media?articleVersion=version-1&mode=multi&workbenchTask=task-1&matrixTask=matrix-1&enterpriseProjectId=project-1&operatorOwnerId=9");
    const link = screen.getByRole("link", { name: "进入媒体库 →" });
    const target = new URL(link.getAttribute("href")!, window.location.origin);
    expect(target.pathname).toBe("/publishing/media/third");
    for (const [key, value] of Object.entries({ articleVersion: "version-1", mode: "multi", workbenchTask: "task-1", matrixTask: "matrix-1", enterpriseProjectId: "project-1", operatorOwnerId: "9" })) {
      expect(target.searchParams.get(key)).toBe(value);
    }
    fireEvent.click(link);
    await waitFor(() => expect(choice("a").disabled).toBe(false));
    fireEvent.click(choice("a"));
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalledWith("version-1", ["a"], expect.any(String), "per_media"));
  });

  it.each([
    { workingImageCount: 1, frozenHasImages: false },
    { workingImageCount: 0, frozenHasImages: true },
  ])("uses the exact frozen version when working image count is $workingImageCount and frozen images are $frozenHasImages", async ({ workingImageCount, frozenHasImages }) => {
    const detail = article({ imageCount: workingImageCount });
    detail.versions = [
      { ...detail.versions[0]!, id: "older-version", containsImages: !frozenHasImages },
      { ...detail.versions[0]!, containsImages: frozenHasImages },
    ];
    const fixture = gatewayFixture([media("text", { capability: "text" }), media("image")], detail);
    harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1");
    await waitFor(() => expect(fixture.getArticleVersion).toHaveBeenCalledWith("version-1", expect.any(AbortSignal)));
    // The verified image media becomes usable only after article context resolves.
    await waitFor(() => expect(choice("image").disabled).toBe(false));
    expect(choice("text").disabled).toBe(frozenHasImages);
    expect(fixture.getArticle).not.toHaveBeenCalled();
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("selects a historical frozen version even when the article summary points to a newer version", async () => {
    const detail = article({ currentVersionId: "version-2", currentVersion: 2, imageCount: 1 });
    detail.versions = [
      { ...detail.versions[0]!, id: "version-2", version: 2, hash: "hash-2", containsImages: true },
      { ...detail.versions[0]!, containsImages: false },
    ];
    const fixture = gatewayFixture([media("text", { capability: "text" }), media("image")], detail);
    // The URL is sufficient; neither flow resources nor a currentVersionId match identifies V1.
    harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1");
    await waitFor(() => expect(choice("text").disabled).toBe(false));
    expect(fixture.getArticleVersion).toHaveBeenCalledWith("version-1", expect.any(AbortSignal));
    expect(fixture.getArticle).not.toHaveBeenCalled();
    fireEvent.click(choice("text"));
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalledWith("version-1", ["text"], expect.any(String), "single"));
  });

  it("keeps a failed draft binding locked and retries reading it instead of creating a replacement", async () => {
    const items = [media("a"), media("b")];
    const fixture = gatewayFixture(items, article(), draft([items[0]!]));
    fixture.getDraft.mockRejectedValueOnce(new Error("草稿读取暂时失败"));
    harness(fixture.gateway, "/publishing/drafts/draft-1/media/third?articleVersion=version-1");
    const retry = await screen.findByRole("button", { name: "重试读取草稿" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(retry.disabled).toBe(false);
      expect(screen.getAllByText(/投放草稿读取失败：草稿读取暂时失败/).length).toBeGreaterThan(0);
      expect(choice("a").disabled).toBe(true);
    });
    expect(choice("b").disabled).toBe(true);
    expect(pageSelection().disabled).toBe(true);
    fireEvent.click(choice("b"));
    expect(fixture.createDraft).not.toHaveBeenCalled();
    expect(fixture.updateDraftMedia).not.toHaveBeenCalled();
    fireEvent.click(retry);
    await waitFor(() => expect(choice("a").checked).toBe(true));
    await waitFor(() => expect(choice("b").disabled).toBe(false));
    expect(fixture.getDraft).toHaveBeenCalledTimes(2);
    fireEvent.click(choice("b"));
    await waitFor(() => expect(fixture.updateDraftMedia).toHaveBeenCalledWith("draft-1", ["a", "b"], 1));
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("locks media selection when the requested frozen version is absent instead of treating it as text-only", async () => {
    const detail = article();
    detail.versions = [{ ...detail.versions[0]!, id: "another-version" }];
    const fixture = gatewayFixture([media("text", { capability: "text" }), media("image")], detail);
    const currentFlow = flow();
    harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1", currentFlow);
    const retry = await screen.findByRole("button", { name: "重试读取稿件" }) as HTMLButtonElement;
    await waitFor(() => {
      expect(retry.disabled).toBe(false);
      expect(screen.getAllByText(/冻结稿件版本不存在/).length).toBeGreaterThan(0);
      expect(choice("text").disabled).toBe(true);
      expect(choice("image").disabled).toBe(true);
    });
    expect(pageSelection().disabled).toBe(true);
    fireEvent.click(choice("text"));
    fireEvent.click(pageSelection());
    // The bound selection is still unread; the cart must not claim 0 selected
    // items (which would read as an empty, free cart) while a retry is offered.
    expect(count()).toBe("待确认");
    expect(fixture.createDraft).not.toHaveBeenCalled();
    expect(fixture.getArticle).not.toHaveBeenCalled();
    expect(currentFlow.ensureTask).not.toHaveBeenCalled();
  });

  it("ignores a late draft creation after the article version and task have changed", async () => {
    const items = [media("a"), media("b")];
    const detail = article();
    detail.versions.push({ ...detail.versions[0]!, id: "version-2", version: 2, hash: "hash-2" });
    const fixture = gatewayFixture(items, detail);
    const pending = deferred<PublicationDraft>();
    fixture.createDraft.mockImplementationOnce(() => pending.promise);
    const originalFlow = flow();
    const view = harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1&workbenchTask=task-1", originalFlow);
    await waitFor(() => expect(choice("a").disabled).toBe(false));
    fireEvent.click(choice("a"));
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalledTimes(1));

    const nextFlow = flow({ taskId: "task-2", resources: [{ kind: "article_version", id: "version-2" }] });
    const nextPath = "/publishing/media/third?articleVersion=version-2&workbenchTask=task-2";
    await act(async () => {
      window.history.replaceState({}, "", nextPath);
      view.location.navigate(nextPath);
      view.rerenderContext(fixture.gateway, nextFlow);
    });
    await waitFor(() => expect(choice("b").disabled).toBe(false));
    expect(fixture.getArticleVersion).toHaveBeenCalledWith("version-2", expect.any(AbortSignal));
    expect(fixture.getArticle).not.toHaveBeenCalled();
    expect(count()).toBe("0");
    const destination = view.location.history.at(-1);
    await act(async () => { pending.resolve({ ...draft([items[0]!]), id: "old-draft" }); });
    expect(choice("a").checked).toBe(false);
    expect(choice("b").checked).toBe(false);
    expect(count()).toBe("0");
    expect(view.location.history.at(-1)).toBe(destination);
    expect(fixture.getDraft).not.toHaveBeenCalled();
    expect(fixture.createDraft).toHaveBeenCalledTimes(1);
    expect(nextFlow.ensureTask).not.toHaveBeenCalled();
    expect(nextFlow.saveSelections).not.toHaveBeenCalled();
    fireEvent.click(choice("b"));
    await waitFor(() => expect(fixture.createDraft).toHaveBeenLastCalledWith("version-2", ["b"], expect.any(String), "single"));
  });

  it("keeps the destination workspace draft intact when a previous gateway finishes saving", async () => {
    const oldItems = [media("old-a"), media("old-b")];
    const oldGateway = gatewayFixture(oldItems, article(), draft([oldItems[0]!]));
    const pending = deferred<PublicationDraft>();
    oldGateway.updateDraftMedia.mockImplementationOnce(() => pending.promise);
    const view = harness(oldGateway.gateway, "/publishing/drafts/draft-1/media/third?enterpriseProjectId=old-project", flow({ scopeKey: "old-workspace" }));
    await waitFor(() => expect(choice("old-a").checked).toBe(true));
    await waitFor(() => expect(choice("old-b").disabled).toBe(false));
    fireEvent.click(choice("old-b"));
    await waitFor(() => expect(oldGateway.updateDraftMedia).toHaveBeenCalledTimes(1));

    // Reuse a draft ID deliberately: gateway/workspace scope must still isolate it.
    const newItems = [media("new-a"), media("new-b")];
    const newGateway = gatewayFixture(newItems, article(), draft([newItems[0]!], 7));
    const newFlow = flow({ taskId: "new-task", scopeKey: "new-workspace" });
    const nextPath = "/publishing/drafts/draft-1/media/third?enterpriseProjectId=new-project&workbenchTask=new-task";
    await act(async () => {
      window.history.replaceState({}, "", nextPath);
      view.location.navigate(nextPath);
      view.rerenderContext(newGateway.gateway, newFlow);
    });
    await waitFor(() => expect(choice("new-a").checked).toBe(true));
    await waitFor(() => expect(choice("new-b").disabled).toBe(false));
    const destination = view.location.history.at(-1);
    await act(async () => { pending.resolve(draft(oldItems, 2)); });
    expect(screen.queryByRole("checkbox", { name: "选择 媒体 old-b" })).toBeNull();
    expect(choice("new-a").checked).toBe(true);
    expect(choice("new-b").checked).toBe(false);
    expect(count()).toBe("1");
    expect(screen.getByTestId("cart-total").textContent).toBe("1000000");
    expect(view.location.history.at(-1)).toBe(destination);
    expect(oldGateway.updateDraftMedia).toHaveBeenCalledTimes(1);
    expect(newGateway.updateDraftMedia).not.toHaveBeenCalled();
    expect(newGateway.createDraft).not.toHaveBeenCalled();
    expect(newFlow.saveSelections).not.toHaveBeenCalled();
    fireEvent.click(choice("new-b"));
    await waitFor(() => expect(newGateway.updateDraftMedia).toHaveBeenCalledWith("draft-1", ["new-a", "new-b"], 7));
  });

  it("does not replay the initial draft when the flow object changes after a successful save", async () => {
    const items = [media("a"), media("b")];
    const fixture = gatewayFixture(items, article(), draft([items[0]!]));
    const currentFlow = flow();
    const view = harness(fixture.gateway, "/publishing/drafts/draft-1/media/third", currentFlow);
    await waitFor(() => expect(choice("a").checked).toBe(true));
    fireEvent.click(choice("b"));
    await waitFor(() => expect(count()).toBe("2"));
    await waitFor(() => expect(choice("b").disabled).toBe(false));
    view.rerenderFlow({ ...currentFlow, selections: { mediaFilters: { query: "门户" } } });
    expect(choice("a").checked).toBe(true);
    expect(choice("b").checked).toBe(true);
    expect(count()).toBe("2");
    fireEvent.click(choice("a"));
    await waitFor(() => expect(fixture.updateDraftMedia).toHaveBeenLastCalledWith("draft-1", ["b"], 2));
    await waitFor(() => expect(count()).toBe("1"));
  });

  it("waits for the draft refresh before allowing writes against a cached revision", async () => {
    const items = [media("a"), media("b")];
    const initialDraft = draft([items[0]!]);
    const fixture = gatewayFixture(items, article(), initialDraft);
    const seed = harness(fixture.gateway, "/publishing/drafts/draft-1/media/third");
    await waitFor(() => expect(choice("a").checked).toBe(true));
    seed.unmount();
    const pending = deferred<PublicationDraft>();
    fixture.getDraft.mockImplementationOnce(() => pending.promise);
    harness(fixture.gateway, "/publishing/drafts/draft-1/media/third");
    await waitFor(() => expect(choice("a").checked).toBe(true));
    await waitFor(() => expect(fixture.getDraft).toHaveBeenCalledTimes(2));
    expect(choice("a").disabled).toBe(true);
    expect(choice("b").disabled).toBe(true);
    fireEvent.click(choice("b"));
    expect(fixture.updateDraftMedia).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ ...initialDraft }); });
    await waitFor(() => expect(choice("b").disabled).toBe(false));
    fireEvent.click(choice("b"));
    await waitFor(() => expect(fixture.updateDraftMedia).toHaveBeenLastCalledWith("draft-1", ["a", "b"], 1));
    await waitFor(() => expect(count()).toBe("2"));
  });

  it("restores the empty selection and total when the first draft creation fails", async () => {
    const items = [media("a"), media("b")];
    const fixture = gatewayFixture(items);
    fixture.createDraft.mockRejectedValueOnce(new Error("目录暂时不可用"));
    harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1");
    await waitFor(() => expect(choice("b").disabled).toBe(false));
    expect(count()).toBe("0");
    fireEvent.click(choice("b"));
    await screen.findByText(/目录暂时不可用/);
    expect(choice("a").checked).toBe(false);
    expect(choice("b").checked).toBe(false);
    expect(count()).toBe("0");
    expect(screen.getByTestId("cart-total").textContent).toBe("0");
    expect(fixture.getDraft).not.toHaveBeenCalled();
  });

  it("restores the saved media and amount when updating an existing draft fails", async () => {
    const items = [media("a"), media("b")];
    const fixture = gatewayFixture(items, article(), draft([items[0]!]));
    fixture.updateDraftMedia.mockRejectedValueOnce(new Error("媒体选择保存失败"));
    harness(fixture.gateway, "/publishing/drafts/draft-1/media/third");
    await waitFor(() => expect(choice("a").checked).toBe(true));
    await waitFor(() => expect(choice("b").disabled).toBe(false));
    fireEvent.click(choice("b"));
    await screen.findByText(/媒体选择保存失败/);
    expect(choice("a").checked).toBe(true);
    expect(choice("b").checked).toBe(false);
    expect(count()).toBe("1");
    expect(screen.getByTestId("cart-total").textContent).toBe("1000000");
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("selects and clears only eligible page rows while unavailable rows do not prevent the all-selected state", async () => {
    const fixture = gatewayFixture([media("a"), media("b"), media("inactive", { active: false }), media("unpriced", { priceTenThousandths: "0" })]);
    const currentFlow = flow();
    harness(fixture.gateway, "/publishing/media/third", currentFlow);
    await waitFor(() => expect(pageSelection().disabled).toBe(false));
    fireEvent.click(pageSelection());
    await waitFor(() => expect(count()).toBe("2"));
    expect(pageSelection().checked).toBe(true);
    expect(choice("inactive").checked).toBe(false);
    expect(choice("inactive").disabled).toBe(true);
    expect(choice("unpriced").checked).toBe(false);
    expect(choice("unpriced").disabled).toBe(true);
    fireEvent.click(pageSelection());
    await waitFor(() => expect(count()).toBe("0"));
    expect(currentFlow.saveSelections).toHaveBeenLastCalledWith(expect.objectContaining({ mediaSelection: [] }));
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("keeps the twenty-media limit while allowing bulk and individual deselection at the limit", async () => {
    const fixture = gatewayFixture(Array.from({ length: 21 }, (_, index) => media(String(index + 1))));
    harness(fixture.gateway, "/publishing/media/third");
    await waitFor(() => expect(pageSelection().disabled).toBe(false));
    fireEvent.click(pageSelection());
    await waitFor(() => expect(count()).toBe("20"));
    expect(choice("21").checked).toBe(false);
    expect(choice("21").disabled).toBe(true);
    expect(choice("1").disabled).toBe(false);
    expect(pageSelection().checked).toBe(true);
    fireEvent.click(pageSelection());
    await waitFor(() => expect(count()).toBe("0"));
    expect(pageSelection().checked).toBe(false);
    expect(choice("1").checked).toBe(false);
    expect(choice("20").checked).toBe(false);
    expect(choice("21").disabled).toBe(false);
    fireEvent.click(pageSelection());
    await waitFor(() => expect(count()).toBe("20"));
    fireEvent.click(choice("1"));
    await waitFor(() => expect(count()).toBe("19"));
    expect(choice("21").disabled).toBe(false);
  });
});

// These are synthetic gateway fixtures for source-only handoff regression coverage.
// They exercise the real page/query/route lifecycle; they are not live supplier evidence.
function catalogueFixture(options: { catalog?: CatalogFreshness; withDraft?: boolean } = {}) {
  const inventory: CatalogFreshness = {
    activeRevision: "catalog-1", mediaCount: 30, newsCount: 10, selfMediaCount: 20,
    countStatus: "available", kindComplete: true, lastSyncedAt: timestamp, stale: false,
  };
  const news = Array.from({ length: 10 }, (_, index) => media(`news-${index}`, { taxonomy: "IT科技" }));
  const selfMedia = Array.from({ length: 20 }, (_, index) => media(`self-${index}`, { kind: "self_media", taxonomy: "生活消费" }));
  const items = [...news, ...selfMedia];
  const fixture = gatewayFixture(items, article(), options.withDraft ? draft([news[0]!, selfMedia[0]!]) : undefined);
  const listMedia = vi.fn<PublisherGateway["listMedia"]>(async (filters) => {
    const matches = items.filter(item =>
      (!filters.kind || item.kind === filters.kind) &&
      (!filters.query || item.name.includes(filters.query)) &&
      (!filters.taxonomy || item.taxonomy === filters.taxonomy) &&
      (filters.mediaIds === undefined || filters.mediaIds.includes(item.id)),
    );
    const start = (filters.page - 1) * filters.pageSize;
    return { items: matches.slice(start, start + filters.pageSize), total: matches.length,
      page: filters.page, pageSize: filters.pageSize, catalog: options.catalog ?? inventory };
  });
  const getMediaFacets = vi.fn<PublisherGateway["getMediaFacets"]>(async () => ({
    // Deliberately different from inventory: facet buckets must not become tab totals.
    kinds: { news: 1, self_media: 2 },
    platforms: [], taxonomies: [{ value: "IT科技", label: "IT科技", count: 10 }, { value: "生活消费", label: "生活消费", count: 20 }],
    mediaTypes: [], areas: [], includeTypes: [], publishSpeeds: [], entryTypes: [], linkTypes: [], imageSupports: [],
    pcWeightThresholds: [], mobileWeightThresholds: [], includeRateThresholds: [], successRateThresholds: [],
    recommendedOptions: [], recommendationTags: [], authenticatedOptions: [], festivalPublishableOptions: [], catalog: inventory,
  }));
  fixture.gateway.listMedia = listMedia;
  fixture.gateway.getMediaFacets = getMediaFacets;
  return { ...fixture, listMedia, getMediaFacets, inventory };
}

function categoryButton(label: string) {
  return within(screen.getByRole("group", { name: "媒体分类" })).getByRole("button", { name: new RegExp(`^${label}`) });
}
function expectInventoryThirty() {
  expect(categoryButton("全部媒体").textContent).toContain("（30）");
  expect(categoryButton("门户媒体").textContent).toContain("（10）");
  expect(categoryButton("第三方自媒体").textContent).toContain("（20）");
  expect(screen.getByRole("button", { name: /^全部\s*30$/ }).textContent).toContain("30");
}
function expectResultCount(total: number) {
  expect(document.getElementById("y-result-count")?.textContent).toContain(`为您找到 ${total} 条媒体资源`);
}

describe("media catalogue inventory, filters and cart integration", () => {
  it("labels same-session cached rows as previous results while their refresh is pending", async () => {
    const fixture = catalogueFixture();
    const first = harness(fixture.gateway, "/publishing/media/third");
    await waitFor(() => expectResultCount(30));
    first.unmount();

    const pending = deferred<Awaited<ReturnType<PublisherGateway["listMedia"]>>>();
    fixture.gateway.listMedia = vi.fn<PublisherGateway["listMedia"]>(() => pending.promise);
    harness(fixture.gateway, "/publishing/media/third");
    expect(choice("news-0")).not.toBeNull();
    expect(screen.getByText("上次匹配 30 条媒体资源")).not.toBeNull();
    expect(document.getElementById("y-result-count")?.textContent).toContain("上次为您找到 30 条媒体资源");
    expect(screen.getByText(/正在更新结果；库存保留最近一次确认的数量/)).not.toBeNull();
  });

  it("does not report zero matching resources before the first complete catalogue sync", async () => {
    const fixture = catalogueFixture({ catalog: {
      activeRevision: "", lastSyncedAt: "", kindComplete: false, stale: true, countStatus: "unavailable",
    } });
    harness(fixture.gateway, "/publishing/media/third?query=no-such-media");
    await waitFor(() => expect(screen.getByText("媒体目录尚未完整同步")).not.toBeNull());
    expect(screen.queryByText("没有匹配的媒体")).toBeNull();
    expect(document.getElementById("y-result-count")?.textContent).toContain("待确认");
    expect(screen.getByRole("button", { name: "重试读取媒体目录" })).not.toBeNull();
  });

  it("keeps 10 + 20 = 30 inventory across kind switches and name search while current totals change", async () => {
    const fixture = catalogueFixture();
    const currentFlow = flow();
    const view = harness(fixture.gateway, "/publishing/media/third?articleVersion=version-1&mode=multi&workbenchTask=task-1&matrixTask=matrix-1&enterpriseProjectId=project-1&operatorOwnerId=9", currentFlow);
    await waitFor(() => { expectInventoryThirty(); expectResultCount(30); });

    fireEvent.click(categoryButton("门户媒体"));
    await waitFor(() => { expectInventoryThirty(); expectResultCount(10); });
    expect(categoryButton("门户媒体").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(categoryButton("第三方自媒体"));
    await waitFor(() => { expectInventoryThirty(); expectResultCount(20); });
    expect(categoryButton("第三方自媒体").getAttribute("aria-pressed")).toBe("true");

    fireEvent.change(screen.getByRole("searchbox", { name: "媒体搜索" }), { target: { value: "  媒体 self-3  " } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitFor(() => { expectInventoryThirty(); expectResultCount(1); });
    expect(fixture.listMedia).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: "self_media", query: "媒体 self-3", searchScope: "name", page: 1,
    }), expect.any(AbortSignal));
    await waitFor(() => expect(choice("self-3").disabled).toBe(false));

    // Filtering preserves the exact frozen version, mode, both tasks and owner/project context.
    const target = new URL(view.location.history.at(-1)!, window.location.origin);
    for (const [key, value] of Object.entries({ articleVersion: "version-1", mode: "multi", workbenchTask: "task-1", matrixTask: "matrix-1", enterpriseProjectId: "project-1", operatorOwnerId: "9" })) {
      expect(target.searchParams.get(key)).toBe(value);
    }
    fireEvent.click(choice("self-3"));
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalledWith("version-1", ["self-3"], expect.any(String), "per_media"));
    expect(fixture.getArticle).not.toHaveBeenCalled();
  });

  it.each([
    { label: "unavailable", counts: { mediaCount: undefined, newsCount: undefined, selfMediaCount: undefined, countStatus: "unavailable" as const } },
    { label: "mismatched", counts: { mediaCount: 999, newsCount: 10, selfMediaCount: 20, countStatus: "available" as const } },
  ])("does not substitute result totals or another response's counts for $label inventory", async ({ counts }) => {
    const fixture = catalogueFixture({ catalog: {
      activeRevision: "catalog-1", kindComplete: true, lastSyncedAt: timestamp, stale: false, ...counts,
    } });
    harness(fixture.gateway, "/publishing/media/third?query=self-3");
    await waitFor(() => {
      expectResultCount(1);
      for (const label of ["全部媒体", "门户媒体", "第三方自媒体"]) {
        expect(categoryButton(label).textContent).toContain("（待确认）");
      }
    });
    expect(screen.getByRole("button", { name: /^全部\s*待确认$/ }).textContent).toContain("待确认");
    expect(screen.getByText("媒体库存统计尚未确认，分类数量暂不展示。")).not.toBeNull();
    expect(fixture.getMediaFacets).toHaveBeenCalled();
  });

  it("queries only selected IDs in cart scope and keeps facets global across filter changes", async () => {
    const fixture = catalogueFixture({ withDraft: true });
    harness(fixture.gateway, "/publishing/drafts/draft-1/media/third?articleVersion=version-1");
    await waitFor(() => { expect(choice("news-0").checked).toBe(true); expect(choice("self-0").checked).toBe(true); expectInventoryThirty(); });
    fireEvent.click(screen.getByRole("button", { name: /^购物车\s*2$/ }));
    await waitFor(() => {
      expectResultCount(2);
      expect(fixture.listMedia).toHaveBeenLastCalledWith(expect.objectContaining({ mediaIds: ["news-0", "self-0"], page: 1 }), expect.any(AbortSignal));
    });
    const facetCalls = fixture.getMediaFacets.mock.calls.length;
    expect(fixture.getMediaFacets).toHaveBeenLastCalledWith(expect.objectContaining({ kind: undefined, query: "", taxonomy: "", searchScope: "name" }), expect.any(AbortSignal));

    fireEvent.click(screen.getByRole("button", { name: "展开频道类型选项" }));
    fireEvent.click(within(screen.getByRole("group", { name: "频道类型" })).getByRole("button", { name: "IT科技" }));
    await waitFor(() => {
      expectResultCount(1);
      expect(fixture.listMedia).toHaveBeenLastCalledWith(expect.objectContaining({ taxonomy: "IT科技", mediaIds: ["news-0", "self-0"], page: 1 }), expect.any(AbortSignal));
      expectInventoryThirty();
    });
    expect(fixture.getMediaFacets).toHaveBeenCalledTimes(facetCalls);
    expect(count()).toBe("2");
    expect(fixture.createDraft).not.toHaveBeenCalled();
    expect(fixture.updateDraftMedia).not.toHaveBeenCalled();
    expect(fixture.listMedia.mock.calls.every(([filters]) => filters.pageSize <= 100)).toBe(true);
  });

  it("sends an explicit empty ID scope for an empty cart instead of querying the whole catalogue", async () => {
    const fixture = catalogueFixture();
    harness(fixture.gateway, "/publishing/media/third");
    await waitFor(() => { expectInventoryThirty(); expectResultCount(30); });
    fireEvent.click(screen.getByRole("button", { name: /^购物车\s*0$/ }));
    await waitFor(() => {
      expectResultCount(0);
      expect(fixture.listMedia).toHaveBeenLastCalledWith(expect.objectContaining({ mediaIds: [] }), expect.any(AbortSignal));
      expectInventoryThirty();
    });
    expect(screen.queryByRole("checkbox", { name: "选择 媒体 news-0" })).toBeNull();
    expect(count()).toBe("0");
  });
});

describe("upstream title-mode handoff", () => {
  it("enters titles on the first footer click after editing a bound draft's media", async () => {
    const fixture = gatewayFixture([media("a"), media("b")], article(), draft([media("a")]));
    const currentFlow = flow();
    harness(fixture.gateway, "/publishing/drafts/draft-1/media/third?articleVersion=version-1", currentFlow);
    await waitFor(() => expect(choice("b").disabled).toBe(false));
    fireEvent.click(choice("b"));
    await waitFor(() => expect(fixture.updateDraftMedia).toHaveBeenCalled());
    const next = screen.getByRole("button", { name: "配置标题" });
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByLabelText("发布流程")).toBeNull();
    fireEvent.click(next);
    await waitFor(() => expect(currentFlow.handoff).toHaveBeenCalledTimes(1));
    expect(currentFlow.handoff).toHaveBeenCalledWith(expect.objectContaining({ route: expect.stringContaining("/drafts/draft-1/titles?") }));
  });

  it("saves a newer upstream single-title decision before entering titles from an older per-media draft", async () => {
    const original = { ...draft([media("a")]), titleMode: "per_media" as const, sharedTitle: undefined };
    original.items[0].title = "旧媒体独立标题";
    const fixture = gatewayFixture([media("a")], article({ title: "上游确认的正式标题" }), original);
    const currentFlow = flow();
    harness(fixture.gateway, "/publishing/drafts/draft-1/media/third?mode=multi&titleMode=single&articleVersion=version-1", currentFlow);
    const next = await screen.findByRole("button", { name: "配置标题" });
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(next);
    await waitFor(() => expect(currentFlow.handoff).toHaveBeenCalled());
    expect(fixture.saveDraftTitles).toHaveBeenCalledWith("draft-1", expect.objectContaining({
      mode: "single", sharedTitle: "上游确认的正式标题", titles: { a: "上游确认的正式标题" }, expectedRevision: 1,
    }));
    expect(currentFlow.handoff).toHaveBeenCalledWith(expect.objectContaining({ route: expect.stringContaining("/drafts/draft-1/titles?") }));
    expect(vi.mocked(currentFlow.handoff).mock.calls[0][0].route).not.toContain("titleMode=");
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("keeps media and stays in selection when the required title save fails", async () => {
    const original = { ...draft([media("a")]), titleMode: "per_media" as const };
    const fixture = gatewayFixture([media("a")], article(), original);
    fixture.saveDraftTitles.mockRejectedValueOnce(new Error("标题尚未写入"));
    const currentFlow = flow();
    harness(fixture.gateway, "/publishing/drafts/draft-1/media/third?titleMode=single&articleVersion=version-1", currentFlow);
    const next = await screen.findByRole("button", { name: "配置标题" });
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(next);
    await screen.findByText("标题尚未写入");
    expect(currentFlow.handoff).not.toHaveBeenCalled();
    expect(choice("a").checked).toBe(true);
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });

  it("routes two existing single-title manuscripts to the combined grouped titles page", async () => {
    const rows = ["a", "b"].map(id => ({ ...draft([media("shared")]), id: `draft-${id}`, articleId: `article-${id}`,
      articleVersionId: `version-${id}`, sharedTitle: `标题${id}`, items: [{ media: media("shared"), title: `标题${id}` }] }));
    const fixture = gatewayFixture([media("shared")]);
    fixture.gateway.getDraft = vi.fn<PublisherGateway["getDraft"]>(async id => rows.find(item => item.id === id)!);
    fixture.gateway.getArticleVersion = vi.fn<PublisherGateway["getArticleVersion"]>(async id => ({ id, version: 1, hash: id, containsImages: false, frozen: true, createdAt: timestamp, createdBy: "账号" }));
    const currentFlow = flow();
    harness(fixture.gateway, "/publishing/drafts/draft-a/media/third?mode=batch&batchDraft=draft-a&batchDraft=draft-b", currentFlow);
    const next = await screen.findByRole("button", { name: "配置标题" });
    await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(next);
    await waitFor(() => expect(currentFlow.handoff).toHaveBeenCalled());
    const route = new URL(vi.mocked(currentFlow.handoff).mock.calls[0][0].route, window.location.origin);
    expect(route.pathname).toBe("/publishing/drafts/draft-a/titles");
    expect(route.searchParams.getAll("batchDraft")).toEqual(["draft-a", "draft-b"]);
    expect(fixture.saveDraftTitles).not.toHaveBeenCalled();
    expect(fixture.createDraft).not.toHaveBeenCalled();
  });
});
