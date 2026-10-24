// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router, useLocation, useSearch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import DraftConversationPage from "./DraftConversationPage";

vi.mock("../PublishingFlowContext", () => ({
  usePublishingFlow: () => ({ taskId: "task-1", selections: { "publishingStage:a": "review" } }),
  publishingTaskUrl: (path: string) => path,
}));
vi.mock("../host", () => ({
  requestWorkspaceNavigation: (action: () => void) => action(),
  WorkflowCompleted: ({summary, onRevise}: {summary:string;onRevise?:()=>void}) => <div>{summary}{onRevise && <button onClick={onRevise}>修改标题</button>}</div>,
  WorkflowSection: ({children}: {children:React.ReactNode}) => <section>{children}</section>,
}));
vi.mock("./TitlesPage", () => ({default: ({onSaved}: {onSaved:(path:string)=>void}) =>
  <button onClick={() => onSaved("/publishing/drafts/a/review?batchDraft=a&batchDraft=b&excludedDraft=b&mode=batch")}>保存全部标题</button>,
}));
vi.mock("./ReviewPage", () => ({default: ({onRevise}: {onRevise:()=>void}) => <div>两稿预检<button onClick={onRevise}>修改标题</button></div>}));
afterEach(cleanup);

it("navigates to the saved review route and returns with the complete group, ignoring stale stage choices", () => {
  const location = memoryLocation({path: "/publishing/drafts/a/titles?batchDraft=a&batchDraft=b&mode=batch", record: true});
  function Harness() {
    const [path] = useLocation();
    const search = useSearch();
    return <><output data-testid="route">{path}?{search}</output><DraftConversationPage draftId="a" initialStage={path.endsWith("review") ? "review" : "titles"}/></>;
  }
  render(<Router hook={location.hook} searchHook={location.searchHook}><Harness/></Router>);
  fireEvent.click(screen.getByText("保存全部标题"));
  expect(screen.getByTestId("route").textContent).toContain("/review?batchDraft=a&batchDraft=b&excludedDraft=b");
  expect(screen.getByText("两稿预检")).toBeTruthy();
  fireEvent.click(screen.getByText("修改标题"));
  expect(screen.getByTestId("route").textContent).toContain("/titles?");
  expect(screen.getByTestId("route").textContent).toContain("batchDraft=b");
  expect(screen.getByTestId("route").textContent).toContain("excludedDraft=b");
  expect(screen.getByText("保存全部标题")).toBeTruthy();
});
