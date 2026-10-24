// @vitest-environment jsdom
import React from "react";
import { webcrypto } from "node:crypto";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { StandalonePublishingFlow, publishingFlowScope } from "./StandalonePublishingFlow";
import { usePublishingFlow, type PublishingFlow } from "../module/client/PublishingFlowContext";

// Exercise the actual local flow provider, persistence and resource matching;
// no fixed flow mock can hide an unexpected task replacement after record().
function harness(path: string, workspaceKey = "media-context") {
  const location = memoryLocation({path,record:true});
  let flow!: PublishingFlow;
  function Probe() {flow = usePublishingFlow()!;return <output>{flow.taskId}</output>;}
  const view = render(<Router hook={location.hook} searchHook={location.searchHook}>
    <StandalonePublishingFlow workspaceKey={workspaceKey}><Probe /></StandalonePublishingFlow>
  </Router>);
  return {location,view,current:()=>flow};
}

async function recordDraft(flow: PublishingFlow, draftId = "draft-1", versionId = "version-1") {
  await flow.record({
    id:`media-draft:${draftId}`,label:"已保存媒体选择",
    resources:[{kind:"article_version",id:versionId},{kind:"publication_draft",id:draftId}],
  });
}

beforeEach(() => {localStorage.clear();vi.stubGlobal("crypto",webcrypto);});
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("media task identity across home, matrix and saved drafts", () => {
  it("keeps the seeded task stable through ensureTask and UI-only values", async () => {
    const session = harness("/publishing/media?articleVersion=version-1");
    const seeded = session.current().taskId;
    await act(async () => {
      expect(await session.current().ensureTask()).toBe(seeded);
      await session.current().saveSelections({mediaFilters:{query:"科技"}});
    });
    expect(session.current().taskId).toBe(seeded);
    expect(session.current().resources).toEqual([{kind:"article_version",id:"version-1"}]);
  });

  it("reuses the version task on the server draft route and restores its draft on return and refresh", async () => {
    const session = harness("/publishing/media/third?articleVersion=version-1&mode=multi");
    const owner = session.current().taskId;
    await act(async () => {
      await session.current().ensureTask();
      await session.current().saveSelections({mediaFilters:{query:"科技"}});
      await recordDraft(session.current());
    });
    expect(session.current().taskId).toBe(owner);
    await act(async () => {session.location.navigate("/publishing/drafts/draft-1/media/third?articleVersion=version-1&mode=multi");});
    expect(session.current().taskId).toBe(owner);
    expect(session.current().selections?.mediaFilters).toEqual({query:"科技"});
    await act(async () => {session.location.navigate("/publishing/media?articleVersion=version-1&mode=multi");});
    expect(session.current().taskId).toBe(owner);
    expect(session.current().resources).toContainEqual({kind:"publication_draft",id:"draft-1"});
    session.view.unmount();
    const refreshed = harness("/publishing/media?articleVersion=version-1&mode=multi");
    expect(refreshed.current().taskId).toBe(owner);
    expect(refreshed.current().resources).toContainEqual({kind:"publication_draft",id:"draft-1"});
  });

  it.each(["/publishing/media", "/publishing/source-matrix", "/publishing/source-analysis", "/publishing/source-report", "/publishing/source-industry"])("keeps the same task and draft through %s query context", async (path) => {
    const session = harness("/publishing/media?articleVersion=version-1");
    const owner = session.current().taskId;
    await act(async () => {await recordDraft(session.current());});
    await act(async () => {session.location.navigate(`${path}?draftId=draft-1&articleVersion=version-1&workbenchTask=${owner}&task=matrix-1&mode=single`);});
    expect(session.current().agentId).toBe("media");
    expect(session.current().taskId).toBe(owner);
    expect(session.current().resources).toContainEqual({kind:"publication_draft",id:"draft-1"});
    expect(session.current().resources).not.toContainEqual({kind:"publication_draft",id:"matrix-1"});
  });

  it("rejects an old workbench task when the requested article version changes", async () => {
    const session = harness("/publishing/media?articleVersion=version-1");
    const owner = session.current().taskId;
    await act(async () => {await recordDraft(session.current());});
    await act(async () => {session.location.navigate(`/publishing/media?articleVersion=version-2&workbenchTask=${owner}`);});
    expect(session.current().taskId).not.toBe(owner);
    expect(session.current().resources).toEqual([{kind:"article_version",id:"version-2"}]);
    expect(session.current().selections).toEqual({});
  });

  it("checks both draft and version before restoring either a requested or an active task", async () => {
    const session = harness("/publishing/media?articleVersion=version-1");
    const owner = session.current().taskId;
    await act(async () => {await recordDraft(session.current());});
    await act(async () => {session.location.navigate(`/publishing/source-matrix?draftId=draft-1&articleVersion=version-2&workbenchTask=${owner}`);});
    expect(session.current().taskId).not.toBe(owner);
    // These are URL references only. The gateway must still reject a draft /
    // version mismatch; the provider never claims it read a server draft.
    expect(session.current().resources).toEqual([
      {kind:"publication_draft",id:"draft-1"},{kind:"article_version",id:"version-2"},
    ]);
  });

  it("does not reuse stale resource aliases after a task explicitly records another version and draft", async () => {
    const session = harness("/publishing/media?articleVersion=version-1");
    const owner = session.current();
    await act(async () => {await recordDraft(owner);});
    await act(async () => {await recordDraft(owner,"draft-2","version-2");});
    expect(session.current().taskId).not.toBe(owner.taskId);
    expect(session.current().resources).toEqual([{kind:"article_version",id:"version-1"}]);
    await act(async () => {session.location.navigate("/publishing/media?articleVersion=version-2");});
    expect(session.current().taskId).toBe(owner.taskId);
    expect(session.current().resources).toContainEqual({kind:"publication_draft",id:"draft-2"});
  });

  it("retains an independently started media task while it records a confirmed draft", async () => {
    const session = harness("/publishing/media/third");
    const owner = session.current().taskId;
    await act(async () => {await session.current().ensureTask();await recordDraft(session.current());});
    expect(session.current().taskId).toBe(owner);
    expect(session.current().resources).toContainEqual({kind:"publication_draft",id:"draft-1"});
  });

  it("keeps matrix task identifiers separate from draft and workbench references", () => {
    const scope = publishingFlowScope("/publishing/source-matrix","task=matrix-1");
    expect(scope.agentId).toBe("media");
    expect(scope.resources).toEqual([]);
    expect(scope.key).toBe("media:entry");
  });
});
