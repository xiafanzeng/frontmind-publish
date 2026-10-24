// @vitest-environment jsdom
import React from "react";
import { webcrypto } from "node:crypto";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { StandalonePublishingFlow } from "./StandalonePublishingFlow";
import { usePublishingFlow, type PublishingFlow } from "../module/client/PublishingFlowContext";

beforeEach(() => { localStorage.clear(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps the same persisted task for a full group and isolates a later single-draft route", async () => {
  const location = memoryLocation({path: "/publishing/drafts/a/titles?batchDraft=a&batchDraft=b&mode=batch"});
  let current!: PublishingFlow;
  function Probe() { current = usePublishingFlow()!; return null; }
  const view = render(<Router hook={location.hook} searchHook={location.searchHook}>
    <StandalonePublishingFlow workspaceKey="batch-scope"><Probe/></StandalonePublishingFlow>
  </Router>);
  const owner = current.taskId;
  await act(async () => { await current.ensureTask(); await current.saveValues?.({"titles:example":"preserved"}); });
  expect(current.resources).toEqual([{kind:"publication_draft",id:"a"},{kind:"publication_draft",id:"b"}]);
  await act(async () => { location.navigate(`/publishing/drafts/a/review?batchDraft=a&batchDraft=b&mode=batch&workbenchTask=${owner}`); });
  expect(current.taskId).toBe(owner);
  expect(current.selections?.["titles:example"]).toBe("preserved");
  await act(async () => { location.navigate(`/publishing/drafts/a/titles?workbenchTask=${owner}`); });
  expect(current.taskId).not.toBe(owner);
  expect(current.resources).toEqual([{kind:"publication_draft",id:"a"}]);
  view.unmount();
});
