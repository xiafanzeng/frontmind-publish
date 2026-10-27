import { expect, it } from "vitest";
import { articleEditorHref } from "./articleEditorRoute";

it("keeps workspace and explicit multi-title intent without copying the previous publication/task", () => {
  const href = articleEditorHref("other/id", "?mode=multi&enterpriseProjectId=p&operatorOwnerId=9&workbenchTask=t&draftId=d&articleVersion=v&batchArticle=old&matrixTask=m");
  const url = new URL(href, "https://example.invalid");
  expect(url.pathname).toBe("/publishing/articles/other%2Fid/edit");
  expect([...url.searchParams]).toEqual([["operatorOwnerId", "9"], ["enterpriseProjectId", "p"], ["mode", "multi"]]);
});
it("does not turn a manager row into an unverified batch", () => {
  expect(articleEditorHref("a", "?mode=batch&batchArticle=b")).toBe("/publishing/articles/a/edit");
});
it("retains bindings only when the caller has established same-article identity", () => {
  const url = new URL(articleEditorHref("a", "?mode=batch&batchArticle=a&batchArticle=b&draftId=d&workbenchTask=t",
    { retainArticleContext: true }), "https://example.invalid");
  expect(url.searchParams.getAll("batchArticle")).toEqual(["a", "b"]);
  expect(url.searchParams.get("draftId")).toBe("d");
  expect(url.searchParams.get("workbenchTask")).toBe("t");
});

