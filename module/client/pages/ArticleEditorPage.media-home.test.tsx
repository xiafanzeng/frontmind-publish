// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ArticleEditorPage from "./ArticleEditorPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import { configurePublishingHost } from "../host";
import type { PublisherGateway } from "../gateway";
import type { ArticleDetail } from "../types";

// The actual editor toolbar and click handler remain under test. The rich-text
// widget is unrelated to navigation and is replaced without changing its value.
vi.mock("../components/TipTapArticleEditor", () => ({ default: () => <div>正文编辑区</div> }));

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
  const freezeArticle = vi.fn<PublisherGateway["freezeArticle"]>();
  const createDraft = vi.fn<PublisherGateway["createDraft"]>();
  const gateway = {getArticle, freezeArticle, createDraft} as unknown as PublisherGateway;
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
  expect(destination.searchParams.get("articleVersion")).toBe("version-1");
  expect(destination.searchParams.get("mode")).toBe(mode);
  expect(destination.searchParams.get("titleMode")).toBe(mode === "single" ? "single" : "per_media");
  expect(destination.searchParams.get("enterpriseProjectId")).toBe("project-1");
  expect(destination.searchParams.get("operatorOwnerId")).toBe("9");
  expect(freezeArticle).not.toHaveBeenCalled();
  expect(createDraft).not.toHaveBeenCalled();
});
