import { describe, expect, it } from "vitest";
import { readPublishingBatch, withPublishingBatch } from "./batchPublishing";
import { businessLeafHref, publishingBreadcrumbs } from "./businessNav";
import { publishingTaskResumePath } from "./PublishingFlowContext";

describe("ordered batch navigation", () => {
  it("deduplicates draft identity without merging same-media items or accepting foreign exclusions", () => {
    expect(readPublishingBatch("draft-a", "batchDraft=draft-a&batchDraft=draft-b&batchDraft=draft-a&excludedDraft=draft-b&excludedDraft=foreign"))
      .toEqual({ draftIds: ["draft-a", "draft-b"], excludedDraftIds: ["draft-b"] });
  });
  it("replaces stale group params and preserves workspace/task context", () => {
    const result = new URL(withPublishingBatch(
      "/publishing/drafts/a/review?workbenchTask=task-1&enterpriseProjectId=p1&batchDraft=old&excludedDraft=old#results",
      ["a", "b"], ["b"],
    ), "https://workspace.invalid");
    expect(result.searchParams.getAll("batchDraft")).toEqual(["a", "b"]);
    expect(result.searchParams.getAll("excludedDraft")).toEqual(["b"]);
    expect(result.searchParams.get("workbenchTask")).toBe("task-1");
    expect(result.searchParams.get("enterpriseProjectId")).toBe("p1");
    expect(result.hash).toBe("#results");
  });
  it("retains every draft/version when returning through the real media navigation", () => {
    const search = "mode=batch&batchArticle=article-a&batchArticle=article-b&batchDraft=a&batchDraft=b&batchArticleVersion=v1&batchArticleVersion=v2&excludedDraft=b";
    const href = businessLeafHref("third-media", "/publishing/drafts/a/review", search)!;
    const result = new URL(href, "https://workspace.invalid");
    expect(result.searchParams.getAll("batchDraft")).toEqual(["a", "b"]);
    expect(result.searchParams.getAll("batchArticle")).toEqual(["article-a", "article-b"]);
    expect(result.searchParams.getAll("batchArticleVersion")).toEqual(["v1", "v2"]);
    expect(result.searchParams.getAll("excludedDraft")).toEqual(["b"]);
    expect(publishingBreadcrumbs("/publishing/drafts/a/review", search).at(-1)?.label).toBe("预检与发布");
    expect(publishingBreadcrumbs("/publishing/drafts/a/titles", search).at(-1)?.label).toBe("配置发布标题");
  });
  it("resumes a partially accepted group at review instead of dropping pending drafts for the first receipt", () => {
    const route = publishingTaskResumePath("publishing", {
      resources: [{kind: "publication_draft", id: "a"}, {kind: "publication_draft", id: "b"}, {kind: "publication_batch", id: "accepted-a"}],
      values: { publishingBatchReviewPending: true, batchDraftIds: ["a", "b"] },
      step: "submitted",
    });
    expect(route).toContain("/publishing/drafts/a/review");
    expect(readPublishingBatch("a", route.split("?")[1]!).draftIds).toEqual(["a", "b"]);
  });
  it("resumes an unresolved single-draft request at review even without a titles record", () => {
    expect(publishingTaskResumePath("publishing", {
      resources: [{ kind: "publication_draft", id: "a" }],
      values: { publishingBatchReviewPending: true, batchDraftIds: ["a"] }, step: "",
    })).toBe("/publishing/drafts/a/review");
  });
  it("restores paired article identity and new frozen versions alongside prior draft mappings", () => {
    const route = publishingTaskResumePath("media", {
      resources: [{ kind: "publication_draft", id: "old-a" }, { kind: "publication_draft", id: "old-b" }],
      values: { batchDraftIds: ["old-a", "old-b"], batchArticleIds: ["a", "b"],
        batchArticleVersionIds: ["new-a", "new-b"], excludedDraftIds: ["old-b"] }, step: "",
    });
    const params = new URL(route, "https://workspace.invalid").searchParams;
    expect(params.getAll("batchArticle")).toEqual(["a", "b"]);
    expect(params.getAll("batchArticleVersion")).toEqual(["new-a", "new-b"]);
    expect(params.getAll("excludedDraft")).toEqual(["old-b"]);
  });
  it("keeps batch mapping recovery after the group is reduced to one article", () => {
    const state = { resources: [{ kind: "article" as const, id: "a" }, { kind: "publication_draft" as const, id: "old-a" }],
      values: { editorMode: "batch", batchDraftIds: ["old-a"], batchArticleIds: ["a"], batchArticleVersionIds: ["new-a"] }, step: "" };
    const media = new URL(publishingTaskResumePath("media", state), "https://workspace.invalid");
    expect(media.pathname).toBe("/publishing/drafts/old-a/media");
    expect(media.searchParams.get("mode")).toBe("batch");
    expect(media.searchParams.getAll("batchArticleVersion")).toEqual(["new-a"]);
    const editor = new URL(publishingTaskResumePath("articles", state), "https://workspace.invalid");
    expect(editor.searchParams.get("draftId")).toBe("old-a");
  });
});
