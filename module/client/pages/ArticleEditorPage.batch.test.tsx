// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ArticleEditorPage from "./ArticleEditorPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import { configurePublishingHost } from "../host";
import type { PublisherGateway } from "../gateway";
import type { ArticleDetail, PublisherEditorContent } from "../types";

vi.mock("../components/TipTapArticleEditor", () => ({ default: ({ value, onChange }: {
  value: PublisherEditorContent; onChange: (value: PublisherEditorContent) => void;
}) => <textarea aria-label="批量正文" value={value.text} onChange={event => onChange({ text: event.target.value,
  html: `<p>${event.target.value}</p>`, json: { type: "doc", content: [] } })} /> }));

afterEach(() => { cleanup(); configurePublishingHost({}); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

it("freezes every actual batch article and resumes a partial failure without replacing the first article", async () => {
  const makeArticle = (id: string, title: string): ArticleDetail => ({ id, title, revision: 1, status: "draft",
    currentVersion: 0, bodyText: `${title}正文`, bodyHtml: `<p>${title}正文</p>`, images: [], versions: [],
    wordCount: 4, imageCount: 0, updatedAt: "2026-10-24T00:00:00Z",
    importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true } });
  const articles = new Map([["a", makeArticle("a", "文章甲")]]);
  const getArticle = vi.fn<PublisherGateway["getArticle"]>(async id => articles.get(id)!);
  const importDocx = vi.fn<PublisherGateway["importDocx"]>(async () => {
    articles.set("b", makeArticle("b", "文章乙"));
    return { articleId: "b" } as Awaited<ReturnType<PublisherGateway["importDocx"]>>;
  });
  const saveArticle = vi.fn<PublisherGateway["saveArticle"]>(async input => {
    const result = { ...articles.get(input.articleId)!, ...input, id: input.articleId, revision: input.expectedRevision + 1 };
    articles.set(result.id, result); return result;
  });
  let failSecond = true;
  const freezeArticle = vi.fn<PublisherGateway["freezeArticle"]>(async id => {
    if (id === "b" && failSecond) { failSecond = false; throw new Error("第二篇暂未完成"); }
    const result = { ...articles.get(id)!, status: "frozen" as const, currentVersionId: `version-${id}`, currentVersion: 1 };
    articles.set(id, result); return result;
  });
  const gateway = { getArticle, importDocx, saveArticle, freezeArticle } as unknown as PublisherGateway;
  const initial = "/publishing/articles/a/edit?mode=batch&workbenchTask=t";
  window.history.replaceState({}, "", initial);
  const location = memoryLocation({ path: initial, record: true });
  render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}>
    <ArticleEditorPage articleId="a" />
  </PublishingGatewayProvider></Router>);
  await waitFor(() => expect((screen.getByLabelText("文章 1 标题") as HTMLInputElement).value).toBe("文章甲"));
  fireEvent.click(screen.getByText("＋ 继续添加一篇文章"));
  fireEvent.change(screen.getByLabelText("文章 2 标题"), { target: { value: "文章乙" } });
  const bodies = await screen.findAllByLabelText("批量正文");
  fireEvent.change(bodies[1], { target: { value: "文章乙正文" } });
  fireEvent.click(screen.getByText("确认全部稿件并选择媒体"));
  await screen.findByText("第二篇暂未完成");
  fireEvent.click(screen.getByText("确认全部稿件并选择媒体"));
  await waitFor(() => expect(location.history.at(-1)).toContain("/publishing/media?"));
  const url = new URL(location.history.at(-1)!, window.location.origin);
  expect(url.searchParams.getAll("batchArticleVersion")).toEqual(["version-a", "version-b"]);
  expect(url.searchParams.get("articleVersion")).toBe("version-a");
  expect(url.searchParams.get("mode")).toBe("batch");
  expect(url.searchParams.get("workbenchTask")).toBe("t");
  expect(importDocx).toHaveBeenCalledTimes(1);
  expect(freezeArticle.mock.calls.filter(call => call[0] === "a")).toHaveLength(1);
});

it.each(["a", "b"])("restores explicit batch order when the return link opens article %s", async primary => {
  const article = (id: string): ArticleDetail => ({ id, title: `恢复稿件 ${id}`, revision: 1, status: "frozen",
    currentVersion: 1, currentVersionId: `version-${id}`, bodyText: `${id}正文`, images: [], versions: [],
    wordCount: 3, imageCount: 0, updatedAt: "2026-10-24T00:00:00Z",
    importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true } });
  const gateway = { getArticle: vi.fn(async (id: string) => article(id)) } as unknown as PublisherGateway;
  const initial = `/publishing/articles/${primary}/edit?mode=batch&batchArticle=a&batchArticle=b`;
  window.history.replaceState({}, "", initial);
  const location = memoryLocation({ path: initial, record: true });
  render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}>
    <ArticleEditorPage articleId={primary} />
  </PublishingGatewayProvider></Router>);
  await waitFor(() => expect((screen.getByLabelText("文章 2 标题") as HTMLInputElement).value).toBe("恢复稿件 b"));
  expect((screen.getByLabelText("文章 1 标题") as HTMLInputElement).value).toBe("恢复稿件 a");
  expect((screen.getByText("确认全部稿件并选择媒体") as HTMLButtonElement).disabled).toBe(false);
});

it.each(["bodyHtml", "images", "editorJson"])("requires re-confirmation when another session freezes changed %s with the same plain text", async field => {
  const original: ArticleDetail = { id: "a", title: "已阅稿件", revision: 1, status: "draft",
    currentVersion: 0, bodyText: "相同正文", bodyHtml: "<p>相同正文</p>", editorJson: { type: "doc", content: [] }, images: [], versions: [],
    wordCount: 4, imageCount: 0, updatedAt: "2026-10-24T00:00:00Z",
    importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true } };
  const changed: ArticleDetail = { ...original, revision: 2, status: "frozen", currentVersion: 1, currentVersionId: "unreviewed-version",
    ...(field === "bodyHtml" ? { bodyHtml: "<p><strong>相同正文</strong></p>" } :
      field === "images" ? { images: [{ id: "new-image", fileName: "new.png", altText: "新增图片", width: 10, height: 10 }] } :
      { editorJson: { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "center" } }] } }) };
  const getArticle = vi.fn<PublisherGateway["getArticle"]>().mockResolvedValueOnce(original).mockResolvedValue(changed);
  const freezeArticle = vi.fn<PublisherGateway["freezeArticle"]>();
  const gateway = { getArticle, freezeArticle } as unknown as PublisherGateway;
  const initial = "/publishing/articles/a/edit?mode=batch";
  window.history.replaceState({}, "", initial);
  const location = memoryLocation({ path: initial, record: true });
  render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}>
    <ArticleEditorPage articleId="a" />
  </PublishingGatewayProvider></Router>);
  await screen.findByLabelText("文章 1 标题");
  fireEvent.click(screen.getByText("确认全部稿件并选择媒体"));
  await screen.findByText("稿件已在其他位置修改，请重新载入后确认版本。");
  expect(freezeArticle).not.toHaveBeenCalled();
  expect(location.history.at(-1)).toBe(initial);
});
