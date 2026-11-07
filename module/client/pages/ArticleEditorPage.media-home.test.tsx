// @vitest-environment jsdom
// Regression source only; execution is deferred to ZCode after the final merge.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ArticleEditorPage from "./ArticleEditorPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import { PublishingFlowProvider, type PublishingFlow } from "../PublishingFlowContext";
import { configurePublishingHost } from "../host";
import type { PublisherGateway } from "../gateway";
import type { ArticleDetail, PublicationDraft, PublisherEditorContent } from "../types";

// The actual editor toolbar and click handler remain under test. The rich-text
// widget is unrelated to navigation and is replaced without changing its value.
vi.mock("../components/TipTapArticleEditor", () => ({ default: ({ value, onChange }: {
  value: PublisherEditorContent; onChange: (value: PublisherEditorContent) => void;
}) => <textarea aria-label="测试正文" value={value.text} onChange={event => onChange({
  text: event.target.value, html: `<p>${event.target.value}</p>`, json: { type: "doc", content: [] },
})} /> }));

afterEach(() => { cleanup(); configurePublishingHost({}); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

it.each(["single", "multi"])("opens the media overview from an already frozen %s manuscript", async mode => {
  const timestamp = "2026-10-24T00:00:00.000Z";
  const article: ArticleDetail = {
    id: "article-1", title: "已确认稿件", status: "frozen", currentVersionId: "version-1",
    currentVersion: 1, wordCount: 4, imageCount: 0, updatedAt: timestamp,
    revision: 1, bodyText: "稿件正文", images: [],
    versions: [{ id: "version-1", version: 1, hash: "hash-1", containsImages: false, frozen: true, createdAt: timestamp, createdBy: "账号" }],
    importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true },
  };
  const getArticle = vi.fn<PublisherGateway["getArticle"]>(async () => article);
  const getArticleVersion = vi.fn<PublisherGateway["getArticleVersion"]>(async () => article.versions[0]!);
  const freezeArticle = vi.fn<PublisherGateway["freezeArticle"]>();
  const createDraft = vi.fn<PublisherGateway["createDraft"]>();
  const gateway = {getArticle, getArticleVersion, freezeArticle, createDraft} as unknown as PublisherGateway;
  configurePublishingHost({ workspaceUrl: path => {
    const target = new URL(path, window.location.origin);
    target.searchParams.set("enterpriseProjectId", "project-1");
    target.searchParams.set("operatorOwnerId", "9");
    return `${target.pathname}${target.search}`;
  } });
  const initialPath = `/publishing/articles/article-1/edit?mode=${mode}`;
  window.history.replaceState({}, "", initialPath);
  const location = memoryLocation({path:initialPath, record:true});
  render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}><ArticleEditorPage articleId="article-1"/></PublishingGatewayProvider></Router>);
  const choose = await screen.findByTitle("进入媒体选择首页");
  await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false));
  // V4/2 反馈：编辑页不再渲染发布步骤文字行，步骤信息由媒体库页面提供。
  fireEvent.click(choose);
  await waitFor(() => expect(new URL(location.history.at(-1)!, window.location.origin).pathname).toBe("/publishing/media"));
  const destination = new URL(location.history.at(-1)!, window.location.origin);
  expect(destination.pathname).toBe("/publishing/media");
  expect(destination.searchParams.get("articleId")).toBe("article-1");
  expect(destination.searchParams.get("articleVersion")).toBe("version-1");
  expect(destination.searchParams.get("mode")).toBe(mode);
  expect(destination.searchParams.get("titleMode")).toBe(mode === "single" ? "single" : "per_media");
  expect(destination.searchParams.get("enterpriseProjectId")).toBe("project-1");
  expect(destination.searchParams.get("operatorOwnerId")).toBe("9");
  expect(freezeArticle).not.toHaveBeenCalled();
  expect(createDraft).not.toHaveBeenCalled();
});

function fixture() {
  const timestamp = "2026-11-08T00:00:00.000Z";
  let current: ArticleDetail = {
    id: "article-b", title: "稿件 B", status: "frozen", revision: 3, currentVersion: 1,
    currentVersionId: "version-b-1", bodyText: "原正文", bodyHtml: "<p>原正文</p>",
    wordCount: 3, imageCount: 0, updatedAt: timestamp, images: [],
    versions: [{ id: "version-b-1", version: 1, hash: "hash-b-1", containsImages: false, frozen: true, createdAt: timestamp, createdBy: "账号" }],
    importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true },
  };
  const api = {
    getArticle: vi.fn<PublisherGateway["getArticle"]>(async () => current),
    getArticleVersion: vi.fn<PublisherGateway["getArticleVersion"]>(async id => current.versions.find(version => version.id === id)!),
    saveArticle: vi.fn<PublisherGateway["saveArticle"]>(async input => {
      current = { ...current, ...input, revision: input.expectedRevision + 1, status: "draft" };
      return current;
    }),
    freezeArticle: vi.fn<PublisherGateway["freezeArticle"]>(async () => {
      const version = current.currentVersion + 1;
      const snapshot = { ...current.versions[0]!, id: `version-b-${version}`, version, hash: `hash-b-${version}` };
      current = { ...current, status: "frozen", currentVersion: version, currentVersionId: snapshot.id, versions: [...current.versions, snapshot] };
      return current;
    }),
    getDraft: vi.fn<PublisherGateway["getDraft"]>(),
    createDraft: vi.fn<PublisherGateway["createDraft"]>(),
  };
  const flow: PublishingFlow = {
    taskId: "work-b", scopeKey: "scope-b", agentId: "articles", resources: [{ kind: "publication_draft", id: "draft-a" }],
    ensureTask: vi.fn(async () => "work-b"), setSummary: vi.fn(),
    record: vi.fn(async () => {}), saveSelections: vi.fn(async () => {}), handoff: vi.fn(async () => {}),
  };
  return { api, flow, current: () => current };
}

async function mountEditor(state = fixture(), search = "", withFlow = false) {
  const initial = `/publishing/articles/article-b/edit${search}`;
  window.history.replaceState({}, "", initial);
  const location = memoryLocation({ path: initial, record: true });
  const editor = <ArticleEditorPage articleId="article-b" />;
  render(<Router hook={location.hook} searchHook={location.searchHook}>
    <PublishingGatewayProvider gateway={state.api as unknown as PublisherGateway}>
      {withFlow ? <PublishingFlowProvider value={state.flow}>{editor}</PublishingFlowProvider> : editor}
    </PublishingGatewayProvider>
  </Router>);
  await waitFor(() => expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe("原正文"));
  return { ...state, initial, location, choose: screen.getByTitle("进入媒体选择首页") };
}

function existingDraft(articleId = "article-b", versionId = "version-b-1"): PublicationDraft {
  return { id: "old-draft", articleId, articleVersionId: versionId, articleTitle: "原稿", articleVersion: 1,
    articleVersionHash: "hash-b-1", articleContainsImages: false, revision: 1, titleMode: "single", items: [], updatedAt: "2026-11-08T00:00:00Z" };
}

it("saves the current title and body before binding their new real snapshot", async () => {
  const { api, location, choose } = await mountEditor();
  fireEvent.change(screen.getByLabelText("稿件标题"), { target: { value: "B 最新标题" } });
  fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "B 最新正文" } });
  fireEvent.click(choose);
  await waitFor(() => expect(location.history.at(-1)).toContain("/publishing/media?"));
  expect(api.saveArticle).toHaveBeenCalledWith(expect.objectContaining({ articleId: "article-b", title: "B 最新标题", bodyText: "B 最新正文" }));
  expect(api.freezeArticle).toHaveBeenCalledWith("article-b", 4);
  const target = new URL(location.history.at(-1)!, window.location.origin);
  expect(target.searchParams.get("articleId")).toBe("article-b");
  expect(target.searchParams.get("articleVersion")).toBe("version-b-2");
  expect(api.createDraft).not.toHaveBeenCalled();
});

it("keeps unsaved content and the editor route after save failure", async () => {
  const state = fixture();
  state.api.saveArticle.mockRejectedValue(new Error("保存冲突，请重试"));
  const { api, initial, location, choose } = await mountEditor(state);
  fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "不能丢失的修改" } });
  fireEvent.click(choose);
  await screen.findByText("保存冲突，请重试");
  expect(location.history.at(-1)).toBe(initial);
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe("不能丢失的修改");
  expect(api.freezeArticle).not.toHaveBeenCalled();
});

it.each([true, false])("retains a previous draft only for the exact article and version (matching: %s)", async matching => {
  const state = fixture();
  state.api.getDraft.mockResolvedValue(existingDraft(matching ? "article-b" : "article-a"));
  const { location, choose } = await mountEditor(state, "?draftId=old-draft&task=old-matrix&matrixTask=old-matrix&workbenchTask=work-b");
  fireEvent.click(choose);
  await waitFor(() => expect(location.history.at(-1)).toContain("/publishing/media?"));
  const target = new URL(location.history.at(-1)!, window.location.origin);
  expect(target.searchParams.get("draftId")).toBe(matching ? "old-draft" : null);
  expect(target.searchParams.get("workbenchTask")).toBe("work-b");
  expect(target.searchParams.get("task")).toBe(matching ? "old-matrix" : null);
  expect(target.searchParams.get("matrixTask")).toBe(matching ? "old-matrix" : null);
  expect(target.searchParams.get("articleId")).toBe("article-b");
});

it("does not leave if the existing draft association cannot be checked", async () => {
  const state = fixture();
  state.api.getDraft.mockRejectedValue(new Error("草稿读取失败"));
  const { initial, location, choose } = await mountEditor(state, "?draftId=old-draft");
  fireEvent.click(choose);
  await screen.findByText("草稿读取失败");
  expect(location.history.at(-1)).toBe(initial);
});

it("starts a fresh selection after editing the same article beyond its old draft snapshot", async () => {
  const state = fixture();
  state.api.getDraft.mockResolvedValue(existingDraft());
  const { location, choose } = await mountEditor(state, "?draftId=old-draft&articleVersion=version-b-1&matrixTask=old-matrix");
  fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "新正文" } });
  fireEvent.click(choose);
  await waitFor(() => expect(location.history.at(-1)).toContain("/publishing/media?"));
  const target = new URL(location.history.at(-1)!, window.location.origin);
  expect(target.searchParams.get("articleVersion")).toBe("version-b-2");
  expect(target.searchParams.has("draftId")).toBe(false);
  expect(target.searchParams.has("matrixTask")).toBe(false);
  expect(state.current().versions.map(version => version.id)).toEqual(["version-b-1", "version-b-2"]);
});

it("automatically records and hands the latest article to the media flow once", async () => {
  const { api, flow, choose } = await mountEditor(fixture(), "?workbenchTask=work-b", true);
  fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "最新正文" } });
  fireEvent.click(choose);
  fireEvent.click(choose);
  await waitFor(() => expect(flow.handoff).toHaveBeenCalledTimes(1));
  expect(api.saveArticle).toHaveBeenCalledTimes(1);
  expect(flow.record).toHaveBeenCalledTimes(1);
  const input = vi.mocked(flow.handoff).mock.calls[0]![0];
  expect(input.resources).toEqual([{ kind: "article", id: "article-b" }, { kind: "article_version", id: "version-b-2" }]);
  const target = new URL(input.route, window.location.origin);
  expect(target.searchParams.get("articleId")).toBe("article-b");
  expect(target.searchParams.get("articleVersion")).toBe("version-b-2");
  expect(target.searchParams.has("draftId")).toBe(false);
});

it("reports flow recording failures without handing off", async () => {
  const state = fixture();
  vi.mocked(state.flow.record).mockRejectedValue(new Error("任务关联失败"));
  const { flow, initial, location, choose } = await mountEditor(state, "?workbenchTask=work-b", true);
  fireEvent.click(choose);
  await screen.findByText("任务关联失败");
  expect(flow.handoff).not.toHaveBeenCalled();
  expect(location.history.at(-1)).toBe(initial);
});

it("keeps the explicit freeze action separate from automatic media entry", async () => {
  const { flow } = await mountEditor(fixture(), "?workbenchTask=work-b", true);
  fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "只确认新版本" } });
  fireEvent.click(screen.getByRole("button", { name: "冻结当前版本" }));
  await screen.findByRole("button", { name: "交给媒体助手" });
  expect(flow.record).toHaveBeenCalledTimes(1);
  expect(flow.handoff).not.toHaveBeenCalled();
});

it("locks the editing region only for final host navigation and restores it after failure", async () => {
  const state = fixture();
  let rejectHandoff!: (reason: Error) => void;
  vi.mocked(state.flow.handoff).mockImplementation(() => new Promise((_resolve, reject) => { rejectHandoff = reject; }));
  const { choose, initial, location } = await mountEditor(state, "?workbenchTask=work-b", true);
  const region = screen.getByLabelText("测试正文").closest(".publishing-editor-layout")!;
  expect(region.hasAttribute("inert")).toBe(false);
  fireEvent.click(choose);
  await screen.findByText("正在进入媒体选择，请稍候…");
  expect(region.hasAttribute("inert")).toBe(true);
  await act(async () => rejectHandoff(new Error("交接暂时失败")));
  await screen.findByText("交接暂时失败");
  expect(region.hasAttribute("inert")).toBe(false);
  expect(location.history.at(-1)).toBe(initial);
});

it("does not navigate a saved snapshot if the user continues typing during that save", async () => {
  const state = fixture();
  let finishSave!: (article: ArticleDetail) => void;
  state.api.saveArticle.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
  const { api, initial, location, choose } = await mountEditor(state);
  fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "提交保存的正文" } });
  fireEvent.click(choose);
  await waitFor(() => expect(api.saveArticle).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "保存期间继续输入" } });
  await act(async () => finishSave({ ...state.current(), status: "draft", revision: 4, bodyText: "提交保存的正文", bodyHtml: "<p>提交保存的正文</p>" }));
  await screen.findByText("稿件在准备期间有新修改，请再次点击选择媒体。");
  expect(location.history.at(-1)).toBe(initial);
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe("保存期间继续输入");
  expect(api.freezeArticle).not.toHaveBeenCalled();
});

it("ignores a late version read after the current editor content changes", async () => {
  const state = fixture();
  let finishRead!: (version: ArticleDetail["versions"][number]) => void;
  state.api.getArticleVersion.mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
  const { api, initial, location, choose } = await mountEditor(state);
  fireEvent.click(choose);
  await waitFor(() => expect(api.getArticleVersion).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "读取期间的新修改" } });
  await act(async () => finishRead(state.current().versions[0]!));
  await screen.findByText("稿件在准备期间有新修改，请再次点击选择媒体。");
  expect(location.history.at(-1)).toBe(initial);
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe("读取期间的新修改");
  expect(api.createDraft).not.toHaveBeenCalled();
});
