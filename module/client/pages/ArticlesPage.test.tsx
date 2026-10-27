// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ArticlesPage from "./ArticlesPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import { configurePublishingHost } from "../host";
import type { PublisherGateway } from "../gateway";
import type { ArticleSummary } from "../types";

// This suite exercises manager links and filters; editor loading is covered by
// the editor integration suite and must not run as a side effect of a row.
vi.mock("./ArticleEditorPage", () => ({ default: () => null }));
vi.mock("./ImportPage", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  configurePublishingHost({});
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

const articles: ArticleSummary[] = [
  { id: "article/one", title: "同名稿件", status: "draft", currentVersion: 0,
    wordCount: 27, imageCount: 2, updatedAt: "2026-10-25T04:00:00Z" },
  { id: "article-two", title: "同名稿件", status: "frozen", currentVersion: 3,
    currentVersionId: "version-two", wordCount: 91, imageCount: 1, updatedAt: "2026-10-26T05:00:00Z" },
];

function renderManager(search = "") {
  const gateway = {
    listArticles: vi.fn<PublisherGateway["listArticles"]>(async () => articles),
    getArticle: vi.fn<PublisherGateway["getArticle"]>(),
    saveArticle: vi.fn<PublisherGateway["saveArticle"]>(),
    freezeArticle: vi.fn<PublisherGateway["freezeArticle"]>(),
    importDocx: vi.fn<PublisherGateway["importDocx"]>(),
    createDraft: vi.fn<PublisherGateway["createDraft"]>(),
  };
  const initial = "/publishing/articles" + (search ? `?${search}` : "");
  window.history.replaceState({}, "", initial);
  const location = memoryLocation({ path: initial, record: true });
  render(<Router hook={location.hook} searchHook={location.searchHook}>
    <PublishingGatewayProvider gateway={gateway as unknown as PublisherGateway}>
      <ArticlesPage />
    </PublishingGatewayProvider>
  </Router>);
  return { gateway, location };
}

it("makes each Continue editing action a single named, keyboard reachable link to the real article", async () => {
  const { gateway, location } = renderManager();
  const list = await screen.findByRole("region", { name: "稿件列表" });
  const links = within(list).getAllByRole("link");
  expect(links).toHaveLength(2);
  expect(within(list).getAllByText("继续编辑")).toHaveLength(2);
  const first = within(list).getByRole("link", { name: "继续编辑：同名稿件（ID：article/one）" });
  const second = within(list).getByRole("link", { name: "继续编辑：同名稿件（ID：article-two）" });
  expect(first.getAttribute("href")).toBe("/publishing/articles/article%2Fone/edit");
  expect(second.getAttribute("href")).toBe("/publishing/articles/article-two/edit");
  expect(first.querySelector("a, button, input, select, textarea, [tabindex]")).toBeNull();
  expect(second.querySelector("a, button, input, select, textarea, [tabindex]")).toBeNull();
  first.focus();
  expect(document.activeElement).toBe(first);
  const previousLength = location.history.length;
  fireEvent.click(first);
  await waitFor(() => expect(location.history.at(-1)).toBe("/publishing/articles/article%2Fone/edit"));
  expect(location.history).toHaveLength(previousLength + 1);
  expect(gateway.getArticle).not.toHaveBeenCalled();
  expect(gateway.saveArticle).not.toHaveBeenCalled();
  expect(gateway.freezeArticle).not.toHaveBeenCalled();
  expect(gateway.importDocx).not.toHaveBeenCalled();
  expect(gateway.createDraft).not.toHaveBeenCalled();
});

it("retains workspace identity and an explicit single-article mode without reusing another article's task or media", async () => {
  configurePublishingHost({ workspaceUrl: path => {
    const target = new URL(path, window.location.origin);
    target.searchParams.set("enterpriseProjectId", "project-current");
    return `${target.pathname}${target.search}`;
  } });
  renderManager("mode=multi&operatorOwnerId=9&workbenchTask=old-task&task=old-matrix&matrixTask=old-matrix&draftId=old-draft&articleVersion=old-version&batchArticle=old-article&batchDraft=old-draft&batchArticleVersion=old-version&excludedDraft=old-excluded&query=同名");
  const link = await screen.findByRole("link", { name: "继续编辑：同名稿件（ID：article-two）" });
  const target = new URL(link.getAttribute("href")!, window.location.origin);
  expect(target.pathname).toBe("/publishing/articles/article-two/edit");
  expect(Object.fromEntries(target.searchParams)).toEqual({
    operatorOwnerId: "9", enterpriseProjectId: "project-current", mode: "multi",
  });
});

it("does not attach an unverified batch or force a single mode when opening a manager row", async () => {
  renderManager("mode=batch&batchArticle=previous&workbenchTask=previous-task&draftId=previous-draft");
  const link = await screen.findByRole("link", { name: "继续编辑：同名稿件（ID：article-two）" });
  const target = new URL(link.getAttribute("href")!, window.location.origin);
  expect(target.pathname).toBe("/publishing/articles/article-two/edit");
  expect(target.search).toBe("");
});

it("keeps title/ID search, status filtering, content statistics, version and import access", async () => {
  renderManager("query=article-two");
  await screen.findByRole("link", { name: "继续编辑：同名稿件（ID：article-two）" });
  expect(screen.queryByRole("link", { name: "继续编辑：同名稿件（ID：article/one）" })).toBeNull();
  expect((screen.getByRole("searchbox", { name: "搜索稿件标题或 ID" }) as HTMLInputElement).value).toBe("article-two");
  expect(screen.getByText("v3 · 已冻结")).toBeTruthy();
  expect(screen.getByText("91 字 · 1 张图片")).toBeTruthy();
  expect(screen.getByRole("link", { name: "导入稿件" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "同名" } });
  expect(screen.getAllByRole("link", { name: /^继续编辑：/ })).toHaveLength(2);
  fireEvent.change(screen.getByRole("combobox", { name: "按稿件状态筛选" }), { target: { value: "draft" } });
  expect(screen.getByRole("link", { name: "继续编辑：同名稿件（ID：article/one）" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "继续编辑：同名稿件（ID：article-two）" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不存在的标题" } });
  expect(screen.getByText("没有匹配的稿件")).toBeTruthy();
});
