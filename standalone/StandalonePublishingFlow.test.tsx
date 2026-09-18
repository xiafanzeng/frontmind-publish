// @vitest-environment jsdom
import React from "react";
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { StandalonePublishingFlow } from "./StandalonePublishingFlow";
import { usePublishingFlow, publishingDraftRequestKey, type PublishingFlow } from "../module/client/PublishingFlowContext";
import PublishingRoutes from "../module/client/PublishingRoutes";
import type { PublisherGateway } from "../module/client/gateway";

beforeEach(() => {localStorage.clear();vi.stubGlobal("crypto",webcrypto);});
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function harness(path = "/publishing?flow=1", workspace = "test-workspace") {
  const location = memoryLocation({path,record:true});
  let current!: PublishingFlow;
  function Probe() {current = usePublishingFlow()!;return <span>{current.agentId}</span>;}
  const tree = () => <Router hook={location.hook} searchHook={location.searchHook}><StandalonePublishingFlow workspaceKey={workspace}><Probe/></StandalonePublishingFlow></Router>;
  const view = render(tree());
  return {location,view,current:()=>current,tree};
}

it("opens the original guided entry from the standalone 新建投放 route and hands a frozen article to media", async () => {
  const gateway = {
    listArticles: async () => [{id:"article-1",title:"合成稿件",currentVersionId:"version-1",currentVersion:1,wordCount:20}],
    getDashboard: async () => ({resumableDrafts:[]}),
    getMediaFacets: async () => ({}), listMedia: async () => ({items:[],total:0}),
  } as unknown as PublisherGateway;
  const location = memoryLocation({path:"/publishing?flow=1",record:true});
  const {container} = render(<Router hook={location.hook} searchHook={location.searchHook}><StandalonePublishingFlow workspaceKey="entry"><PublishingRoutes gateway={gateway}/></StandalonePublishingFlow></Router>);
  await screen.findByRole("heading",{name:"接下来要处理哪次投放？"});
  expect(container.querySelector(".operator-action-list")).not.toBeNull();
  expect(location.history.at(-1)).toBe("/publishing?flow=1");
  fireEvent.click(screen.getByRole("button",{name:/从已冻结稿件开始/}));
  const choice = await screen.findByRole("radio");
  fireEvent.click(choice);
  fireEvent.click(screen.getByRole("button",{name:"确认稿件，交给媒体助手"}));
  await waitFor(() => expect(location.history.at(-1)).toContain("/publishing/media?articleVersion="));
  expect(location.history.at(-1)).toContain("workbenchTask=");
});

it("restores choices and the same draft idempotency key after a page refresh", async () => {
  const first = harness("/publishing/media?articleVersion=version-1");
  await act(async () => {await first.current().saveSelections({mediaSelection:[{id:"media-1"}],mediaFilters:{query:"科技"}});});
  const id = await first.current().ensureTask();
  const requestKey = await publishingDraftRequestKey(id,"version-1",["media-1"]);
  first.view.unmount();
  const second = harness("/publishing/media?articleVersion=version-1");
  expect(second.current().taskId).toBe(id);
  expect(second.current().selections).toEqual({mediaSelection:[{id:"media-1"}],mediaFilters:{query:"科技"}});
  expect(await publishingDraftRequestKey(await second.current().ensureTask(),"version-1",["media-1"])).toBe(requestKey);
});

it("reuses a handoff receipt on retry and restores the existing server draft reference", async () => {
  const session = harness();
  const source = session.current();
  const input = {targetAgentId:"publishing" as const,title:"恢复投放",resources:[{kind:"publication_draft" as const,id:"draft-1"}],idempotencyKey:"resume-draft-1",route:"/publishing/drafts/draft-1/titles"};
  await act(async () => {await source.handoff(input);});
  const target = session.current().taskId;
  await act(async () => {await source.handoff(input);});
  expect(session.current().taskId).toBe(target);
  expect(session.current().resources).toEqual([{kind:"publication_draft",id:"draft-1"}]);
  const persisted = JSON.parse(localStorage.getItem("frontmind.publishing.flow.v1:test-workspace")!);
  expect(Object.keys(persisted.entries)).toHaveLength(2);
  expect(persisted.entries[source.taskId!].records).toHaveLength(1);
  session.view.unmount();
  const refreshed = harness(session.location.history.at(-1));
  expect(refreshed.current().taskId).toBe(target);
  expect(refreshed.current().resources?.[0]?.id).toBe("draft-1");
});

it("keeps selections isolated across business resources and reports failed persistence", async () => {
  const session = harness("/publishing/drafts/draft-1/media");
  await act(async () => {await session.current().saveValues?.({mediaStep:"article"});});
  await act(async () => {session.location.navigate("/publishing/drafts/draft-2/media");});
  expect(session.current().selections).toEqual({});
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(() => {throw new Error("quota");});
  await expect(session.current().saveSelections({mediaStep:"article"})).rejects.toThrow("引导选择尚未保存");
  expect(session.current().selections).toEqual({});
});


it("does not restore a different draft's task when a copied deep link contains a stale task id", async () => {
  const session = harness("/publishing/drafts/draft-1/titles");
  await act(async () => {await session.current().saveValues?.({titleStage:"confirmed"});});
  const previous = session.current().taskId;
  await act(async () => {session.location.navigate(`/publishing/drafts/draft-2/titles?workbenchTask=${previous}`);});
  expect(session.current().taskId).not.toBe(previous);
  expect(session.current().selections).toEqual({});
  expect(session.current().resources).toEqual([{kind:"publication_draft",id:"draft-2"}]);
});
