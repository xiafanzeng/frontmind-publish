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
  const checks=screen.getByRole("region",{name:"发布内容检查"});
  expect(checks.contains(first)).toBe(true);
  expect(checks.contains(second)).toBe(true);
  expect(checks.compareDocumentPosition(fees) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(checks).getAllByRole("button",{name:"一键预检"})).toHaveLength(1);
  expect(screen.getAllByRole("button",{name:"一键预检"})).toHaveLength(1);
  expect(screen.queryByRole("heading",{name:"发布预检与确认"})).toBeNull();
  expect(screen.queryByText("按稿件核对冻结版本、媒体标题与费用，再确认本次发布。")).toBeNull();
});

it("refreshes every active manuscript from the checks toolbar and invalidates confirmation without submitting", async () => {
  let revision=1;
  const preflightDraft=vi.fn<PublisherGateway["preflightDraft"]>(async id=>{
    const value=snapshot(id);
    value.items[0]!.title=`${id} 第 ${revision} 次预检标题`;
    return value;
  });
  const submitDraft=vi.fn<PublisherGateway["submitDraft"]>();
  openReview({preflightDraft,submitDraft} as unknown as PublisherGateway);
  await screen.findByText("b 第 1 次预检标题");
  fireEvent.click(screen.getByRole("checkbox"));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  revision=2;
  fireEvent.click(within(screen.getByRole("region",{name:"发布内容检查"})).getByRole("button",{name:"一键预检"}));
  expect(await screen.findByText("a 第 2 次预检标题")).toBeTruthy();
  expect(await screen.findByText("b 第 2 次预检标题")).toBeTruthy();
  expect(preflightDraft.mock.calls.map(call=>call[0])).toEqual(["a","b","a","b"]);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("button",{name:"模拟发布 2 项"}) as HTMLButtonElement).disabled).toBe(true);
  expect(submitDraft).not.toHaveBeenCalled();
});

it("returns all-single batches to media with three stages instead of reopening title configuration", async () => {
  const gateway={preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>({...snapshot(id),titleMode:"single"}))} as unknown as PublisherGateway;
  openReview(gateway,"&batchArticleVersion=version-a&batchArticleVersion=version-b&enterpriseProjectId=project-1");
  const back=await screen.findByRole("link",{name:"返回选择媒体"});
  const href=new URL(back.getAttribute("href")!,window.location.origin);
  expect(href.pathname).toBe("/publishing/drafts/a/media");
  expect(href.searchParams.getAll("batchDraft")).toEqual(["a","b"]);
  expect(href.searchParams.getAll("batchArticleVersion")).toEqual(["version-a","version-b"]);
  expect(href.searchParams.get("enterpriseProjectId")).toBe("project-1");
  const steps=screen.getByLabelText("发布流程");
  expect(steps.children).toHaveLength(3);
  expect(within(steps).queryByText("配置标题")).toBeNull();
});

it("keeps the complete mixed-mode collection when returning to the existing title editor", async () => {
  const gateway={preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>({...snapshot(id),titleMode:id==="a"?"single":"per_media"}))} as unknown as PublisherGateway;
  openReview(gateway);
  const back=await screen.findByRole("link",{name:"返回修改标题"});
  const href=new URL(back.getAttribute("href")!,window.location.origin);
  expect(href.pathname).toBe("/publishing/drafts/a/titles");
  expect(href.searchParams.getAll("batchDraft")).toEqual(["a","b"]);
  expect(screen.getByLabelText("发布流程").children).toHaveLength(4);
});

it("recovers an omitted preflight title mode from the matching frozen draft", async () => {
  const getDraft=vi.fn<PublisherGateway["getDraft"]>(async id=>({
    ...draft(id),articleVersionId:"version-"+id,revision:1,titleMode:"single",
  }));
  const preflightDraft=vi.fn<PublisherGateway["preflightDraft"]>(async id=>{
    const value=snapshot(id);
    delete value.titleMode;
    return value;
  });
  openReview({getDraft,preflightDraft} as unknown as PublisherGateway);
  expect(await screen.findByRole("link",{name:"返回选择媒体"})).toBeTruthy();
  expect(screen.getByLabelText("发布流程").children).toHaveLength(3);
  expect(getDraft.mock.calls.map(call=>call[0])).toEqual(["a","b"]);
});

it("does not combine a preflight snapshot with a newer draft while recovering its mode", async () => {
  const getDraft=vi.fn<PublisherGateway["getDraft"]>(async id=>({
    ...draft(id),articleVersionId:"version-"+id,revision:2,titleMode:"single",
  }));
  const preflightDraft=vi.fn<PublisherGateway["preflightDraft"]>(async id=>{
    const value=snapshot(id);
    delete value.titleMode;
    return value;
  });
  openReview({getDraft,preflightDraft} as unknown as PublisherGateway);
  expect((await screen.findAllByText("稿件版本或标题已变化，请重新预检后继续。")).length).toBe(2);
  expect((screen.getByRole("button",{name:"模拟发布 0 项"}) as HTMLButtonElement).disabled).toBe(true);
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

it("restores a subset's outstanding request even when an old URL excludes that draft", async () => {
  const request={draftId:"b",preflightRevision:"original-b",quoteFingerprint:"quote-b",acknowledged:true,idempotencyKey:"publisher-submit:b:quote-b"};
  const flow=taskFlow({"publishingBatchReview:a,b":JSON.stringify({requests:{b:request},acceptedBatchIds:{a:"batch-a"}})});
  const gateway={
    getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>({...draft(id),titleMode:"single"})),
    preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>snapshot(id)),
    submitDraft:vi.fn<PublisherGateway["submitDraft"]>(),
  } as unknown as PublisherGateway;
  const path="/publishing/drafts/b/review?excludedDraft=b";
  window.history.replaceState({},"",path);
  const location=memoryLocation({path,record:true});
  render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}><PublishingFlowProvider value={flow}><ReviewPage draftId="b"/></PublishingFlowProvider></PublishingGatewayProvider></Router>);
  expect(await screen.findByText("发布请求待确认")).toBeTruthy();
  const refresh=within(screen.getByRole("region",{name:"发布内容检查"})).getByRole("button",{name:"刷新受理状态"});
  fireEvent.click(refresh);
  await waitFor(()=>expect(gateway.getDraft).toHaveBeenCalledTimes(2));
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  expect(gateway.submitDraft).not.toHaveBeenCalled();
  expect(screen.queryByText("本稿未纳入发布")).toBeNull();
  expect((screen.getByRole("button",{name:"返回选择媒体"}) as HTMLButtonElement).disabled).toBe(true);
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
