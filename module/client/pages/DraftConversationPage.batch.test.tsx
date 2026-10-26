// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router, useSearch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import DraftConversationPage from "./DraftConversationPage";

vi.mock("./TitlesPage", () => ({ default: ({ draftId, onSaved }: { draftId: string; onSaved?: unknown }) => {
  const search = useSearch();
  return <output data-testid="combined-titles">{JSON.stringify({ draftId, search, hasNavigationCallback: Boolean(onSaved) })}</output>;
} }));
vi.mock("./ReviewPage", () => ({ default: () => <output data-testid="separate-review" /> }));
afterEach(cleanup);

it.each(["titles", "review"] as const)("renders the combined page for the embedded %s stage with the full batch context", stage => {
  const query = "batchDraft=a&batchDraft=b&excludedDraft=b&batchArticleVersion=v1&batchArticleVersion=v2&workbenchTask=task-1&mode=batch";
  const path = `/publishing/drafts/a/${stage}?${query}`;
  const location = memoryLocation({ path, record: true });
  render(<Router hook={location.hook} searchHook={location.searchHook}><DraftConversationPage draftId="a" initialStage={stage} /></Router>);
  const rendered = JSON.parse(screen.getByTestId("combined-titles").textContent!);
  expect(rendered).toEqual({ draftId: "a", search: query, hasNavigationCallback: false });
  expect(screen.queryByTestId("separate-review")).toBeNull();
  expect(screen.queryByLabelText("发布流程")).toBeNull();
  expect(screen.queryByText(/稿件与媒体已准备好/)).toBeNull();
  expect(location.history.at(-1)).toBe(path);
});
