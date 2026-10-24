// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ReviewPage from "./ReviewPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import type { PublisherGateway } from "../gateway";
import type { PublicationBatch, PublicationDraft, PublicationPreflight } from "../types";
import { PublishingFlowProvider, type PublishingFlow } from "../PublishingFlowContext";

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });
function snapshot(id: string): PublicationPreflight {
  return {
    revision:"preflight-" + id, draftRevision:1, quoteFingerprint:"quote-" + id,
    mode:"mock", expiresAt:"2027-01-01T00:00:00Z", catalogRevision:"catalog", titleMode:"per_media",
    article:{id, title:"稿件 " + id, version:1, versionId:"version-" + id, hash:"hash-" + id, wordCount:10, imageCount:0, images:[], bodyHtml:"<p>正文</p>"},
    items:[{media:{id:"shared-media", name:"两稿共同选择的媒体", shortName:"共同", kind:"news", capability:"text"}, title:"稿件 " + id + " 的独立标题", priceTenThousandths:"10000", blockers:[], warnings:[], checks:[]}],
    totalTenThousandths:"10000", availableAfterTenThousandths:"90000", wallet:{availableTenThousandths:"100000"}, blockers:[], warnings:[], gates:[],
  } as unknown as PublicationPreflight;
}
function openReview(gateway: PublisherGateway, extra="") {
  const path="/publishing/drafts/a/review?batchDraft=a&batchDraft=b" + extra;
  window.history.replaceState({}, "", path);
  const location=memoryLocation({path, record:true});
  return render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}><ReviewPage draftId="a" /></PublishingGatewayProvider></Router>);
}

it("shows both manuscript groups with independent titles for the same media", async () => {
  const preflightDraft=vi.fn<PublisherGateway["preflightDraft"]>(async id => snapshot(id));
  const gateway={preflightDraft} as unknown as PublisherGateway;
  openReview(gateway);
  const first=await screen.findByRole("region", {name:"稿件 1：稿件 a"});
  const second=await screen.findByRole("region", {name:"稿件 2：稿件 b"});
  expect(within(first).getByText("稿件 a 的独立标题")).toBeTruthy();
  expect(within(second).getByText("稿件 b 的独立标题")).toBeTruthy();
  expect(within(second).queryByText("稿件 a 的独立标题")).toBeNull();
  const fees=screen.getByRole("region",{name:"费用与预算核验"});
  expect(within(fees).getByText("2 项 · ¥2.00")).toBeTruthy();
  expect(within(fees).getByText("¥10.00")).toBeTruthy();
  expect(preflightDraft.mock.calls.map(call => call[0])).toEqual(["a","b"]);
});

it("keeps a wholly unchecked manuscript visible without preflight or fees", async () => {
  const preflightDraft=vi.fn<PublisherGateway["preflightDraft"]>(async id => snapshot(id));
  const getDraft=vi.fn<PublisherGateway["getDraft"]>(async id => ({id, articleTitle:"稿件 " + id, articleVersion:1, articleVersionHash:"hash", items:[]} as unknown as PublicationDraft));
  openReview({preflightDraft,getDraft} as unknown as PublisherGateway,"&excludedDraft=b");
  const excluded=await screen.findByRole("region",{name:"稿件 2：稿件 b"});
  expect(within(excluded).getByText("本稿未纳入发布")).toBeTruthy();
  expect(preflightDraft.mock.calls.map(call=>call[0])).toEqual(["a"]);
  expect(getDraft.mock.calls.map(call=>call[0])).toEqual(["b"]);
  expect(within(screen.getByRole("region",{name:"费用与预算核验"})).getByText("1 项 · ¥1.00")).toBeTruthy();
});

it("retains the other manuscript result when one preflight fails and disables publish", async () => {
  const preflightDraft=vi.fn<PublisherGateway["preflightDraft"]>(async id => {
    if(id==="b") throw new Error("第二稿预检暂不可用");
    return snapshot(id);
  });
  openReview({preflightDraft} as unknown as PublisherGateway);
  expect(await screen.findByText("稿件 a 的独立标题")).toBeTruthy();
  expect(screen.getByText("第二稿预检暂不可用")).toBeTruthy();
  expect((screen.getByRole("button",{name:"模拟发布 1 项"}) as HTMLButtonElement).disabled).toBe(true);
});

function taskFlow(selections: Record<string, unknown> = {}, pending = false): PublishingFlow {
  return {taskId:"task-batch-review",scopeKey:"project-one",agentId:"publishing",pending,selections,resources:[],
    ensureTask:async()=>"task-batch-review",setSummary:vi.fn(),record:vi.fn(async()=>undefined),
    saveSelections:vi.fn(async()=>undefined),saveValues:vi.fn(async()=>undefined),handoff:vi.fn(async()=>undefined)};
}
function draft(id: string): PublicationDraft {
  return {id, articleId:id, articleTitle:"稿件 " + id, articleVersion:1, articleVersionHash:"hash-" + id, items:[]} as unknown as PublicationDraft;
}
function acceptedBatch(unknown = false): PublicationBatch {
  return {id:"batch-a",articleTitle:"稿件 a",status:unknown ? "action_required" : "queued",itemCount:1,unknownCount:unknown ? 1 : 0,
    totalTenThousandths:"10000",items:[]} as unknown as PublicationBatch;
}

it("waits for host hydration before reading or saving accepted receipts and exact outstanding requests", async () => {
  const request={draftId:"b",preflightRevision:"original-b",quoteFingerprint:"quote-b",acknowledged:true,idempotencyKey:"publisher-submit:b:quote-b"};
  const saved=JSON.stringify({acceptedBatchIds:{a:"batch-a"},requests:{b:request}});
  const pendingFlow=taskFlow({},true);
  const gateway={
    getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>draft(id)),
    getBatch:vi.fn<PublisherGateway["getBatch"]>(async()=>acceptedBatch()),
    preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>snapshot(id)),
  } as unknown as PublisherGateway;
  const path="/publishing/drafts/a/review?batchDraft=a&batchDraft=b";
  window.history.replaceState({},"",path);
  const location=memoryLocation({path,record:true});
  const tree=(flow:PublishingFlow)=><Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}><PublishingFlowProvider value={flow}><ReviewPage draftId="a" /></PublishingFlowProvider></PublishingGatewayProvider></Router>;
  const view=render(tree(pendingFlow));
  expect(screen.getByText("正在恢复稿件与已受理批次…")).toBeTruthy();
  expect(pendingFlow.saveValues).not.toHaveBeenCalled();
  expect(gateway.getDraft).not.toHaveBeenCalled();
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  const restored=taskFlow({"publishingBatchReview:a,b":saved});
  view.rerender(tree(restored));
  expect(await screen.findByRole("link",{name:"查看本稿发布结果"})).toBeTruthy();
  expect(await screen.findByText("发布请求待确认")).toBeTruthy();
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  await waitFor(()=>expect(restored.saveValues).toHaveBeenCalled());
  for (const [values] of vi.mocked(restored.saveValues!).mock.calls) {
    expect(JSON.parse(String(values["publishingBatchReview:a,b"]))).toEqual({acceptedBatchIds:{a:"batch-a"},requests:{b:request}});
    expect(values.publishingBatchReviewPending).toBe(true);
  }
});

it("blocks later drafts until an accepted attention batch is actually refreshed and resolved", async () => {
  let unresolved=true;
  const gateway={
    getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>draft(id)),
    getBatch:vi.fn<PublisherGateway["getBatch"]>(async()=>acceptedBatch(unresolved)),
    preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>snapshot(id)),
    submitDraft:vi.fn<PublisherGateway["submitDraft"]>(),
  } as unknown as PublisherGateway;
  const flow=taskFlow({"publishingBatchReview:a,b":JSON.stringify({acceptedBatchIds:{a:"batch-a"},requests:{}})});
  const path="/publishing/drafts/a/review?batchDraft=a&batchDraft=b";
  window.history.replaceState({},"",path);
  const location=memoryLocation({path,record:true});
  render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}><PublishingFlowProvider value={flow}><ReviewPage draftId="a" /></PublishingFlowProvider></PublishingGatewayProvider></Router>);
  expect(await screen.findByText(/已受理批次有待核实结果/)).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  expect((screen.getByRole("button",{name:"模拟发布 1 项"}) as HTMLButtonElement).disabled).toBe(true);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
  unresolved=false;
  fireEvent.click(screen.getByRole("button",{name:"一键预检"}));
  await waitFor(()=>expect(screen.queryByText(/已受理批次有待核实结果/)).toBeNull());
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(()=>expect((screen.getByRole("button",{name:"模拟发布 1 项"}) as HTMLButtonElement).disabled).toBe(false));
  expect(gateway.getBatch).toHaveBeenCalledTimes(2);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("preserves all manuscript IDs and original route context when returning to titles or editing a body", async () => {
  const gateway={preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>{
    const value=snapshot(id);
    if(id==="a") value.items[0]!.blockers=["正文需要修改"];
    return value;
  })} as unknown as PublisherGateway;
  openReview(gateway,"&search=科技&batchArticleVersion=version-a&batchArticleVersion=version-b&enterpriseProjectId=project-1&operatorOwnerId=9");
  const edit=await screen.findByRole("link",{name:"修改本稿正文"});
  const editUrl=new URL(edit.getAttribute("href")!,window.location.origin);
  expect(editUrl.pathname).toBe("/publishing/articles/a/edit");
  expect(editUrl.searchParams.getAll("batchArticle")).toEqual(["a","b"]);
  expect(editUrl.searchParams.getAll("batchDraft")).toEqual(["a","b"]);
  expect(editUrl.searchParams.getAll("batchArticleVersion")).toEqual(["version-a","version-b"]);
  expect(editUrl.searchParams.get("search")).toBe("科技");
  expect(editUrl.searchParams.get("enterpriseProjectId")).toBe("project-1");
  expect(editUrl.searchParams.get("operatorOwnerId")).toBe("9");
  const reviseUrl=new URL(screen.getByRole("link",{name:"返回修改标题"}).getAttribute("href")!,window.location.origin);
  expect(reviseUrl.searchParams.getAll("batchArticleVersion")).toEqual(["version-a","version-b"]);
  expect(reviseUrl.searchParams.get("search")).toBe("科技");
  expect(reviseUrl.searchParams.get("enterpriseProjectId")).toBe("project-1");
});
