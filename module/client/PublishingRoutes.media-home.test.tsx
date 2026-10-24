// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import PublishingRoutes from "./PublishingRoutes";
import type { PublisherGateway } from "./gateway";

// Test real route dispatch, with page bodies replaced so no business APIs run.
vi.mock("./pages/MediaLibraryPage", () => ({ default: ({ view = "third", draftId }: {view?: string; draftId?: string}) => <output data-testid="media-route">{view}:{draftId ?? "none"}</output> }));
vi.mock("./pages/ArticlesPage", () => ({ default: () => <h1>稿件管理入口</h1> }));
vi.mock("./pages/ArticleEditorPage", () => ({ default: ({ articleId }: {articleId: string}) => <h1>稿件编辑 {articleId}</h1> }));
vi.mock("./source-matrix/SourceMatrixPage", () => ({ default: () => <h1>信源矩阵入口</h1> }));

afterEach(cleanup);

function open(path: string) {
  const location = memoryLocation({ path, record: true });
  render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingRoutes gateway={{} as PublisherGateway}/></Router>);
  return location;
}

it.each([
  ["/publishing/media", "home:none"],
  ["/publishing/media/home", "home:none"],
  ["/publishing/drafts/d1/media", "home:d1"],
  ["/publishing/drafts/d1/media/home", "home:d1"],
  ["/publishing/media/third", "third:none"],
  ["/publishing/drafts/d1/media/third", "third:d1"],
  ["/publishing/media/cart", "cart:none"],
  ["/publishing/drafts/d1/media/cart", "cart:d1"],
])("dispatches %s without redirecting child routes", async (path, expected) => {
  const location = open(`${path}?articleVersion=v1&mode=multi&workbenchTask=f1`);
  expect((await screen.findByTestId("media-route")).textContent).toBe(expected);
  expect(location.history.at(-1)).toBe(`${path}?articleVersion=v1&mode=multi&workbenchTask=f1`);
});

it("keeps the articles menu at manuscript management", async () => {
  open("/publishing/articles");
  expect(await screen.findByRole("heading", {name:"稿件管理入口"})).toBeTruthy();
});

it("keeps manuscript editing and matrix direct links reachable", async () => {
  const location = open("/publishing/articles/a1/edit");
  expect(await screen.findByRole("heading", {name:"稿件编辑 a1"})).toBeTruthy();
  cleanup();
  open("/publishing/source-matrix?task=m1");
  expect(await screen.findByRole("heading", {name:"信源矩阵入口"})).toBeTruthy();
  expect(location.history.at(-1)).toBe("/publishing/articles/a1/edit");
});

it.each([
  ["matrixTask=m1", "m1"],
  ["task=current-matrix&matrixTask=old-alias", "current-matrix"],
])("normalizes a draft matrix deep link with %s and retains its other context", async (taskQuery, expectedTask) => {
  const location = open(`/publishing/drafts/d1/media/matrix?${taskQuery}&draftId=old-draft&articleVersion=v1&mode=multi&workbenchTask=flow-1&enterpriseProjectId=project-1&operatorOwnerId=9`);
  expect(await screen.findByRole("heading", {name:"信源矩阵入口"})).toBeTruthy();
  const destination = new URL(location.history.at(-1)!, "https://workspace.invalid");
  expect(destination.pathname).toBe("/publishing/source-matrix");
  expect(destination.searchParams.get("draftId")).toBe("d1");
  expect(destination.searchParams.get("task")).toBe(expectedTask);
  expect(destination.searchParams.has("matrixTask")).toBe(false);
  for (const [key, value] of Object.entries({ articleVersion:"v1", mode:"multi", workbenchTask:"flow-1", enterpriseProjectId:"project-1", operatorOwnerId:"9" })) {
    expect(destination.searchParams.get(key)).toBe(value);
  }
});
