import { expect, it } from "vitest";
import { consumePreparedArticle, prepareArticleEditor } from "./articleEditorHandoff";
import type { PublisherGateway } from "./gateway";
import type { ArticleDetail } from "./types";

it("does not carry a selected detail across gateways or workspaces and consumes it once", () => {
  const first = {} as PublisherGateway;
  const second = {} as PublisherGateway;
  const detail = { id: "a", revision: 7, bodyHtml: "<p>kept</p>" } as ArticleDetail;
  prepareArticleEditor(first, "workspace-a", detail);
  expect(consumePreparedArticle(second, "workspace-a", "a")).toBeUndefined();
  expect(consumePreparedArticle(first, "workspace-a", "a")).toBe(detail);
  expect(consumePreparedArticle(first, "workspace-a", "a")).toBeUndefined();
  prepareArticleEditor(first, "workspace-a", detail);
  expect(consumePreparedArticle(first, "workspace-b", "a")).toBeUndefined();
  prepareArticleEditor(first, "workspace-a", detail);
  expect(consumePreparedArticle(first, "workspace-a", "different-id")).toBeUndefined();
});

