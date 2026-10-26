// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ReviewPage from "./ReviewPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import type { PublisherGateway } from "../gateway";
import type { PublicationBatch, PublicationDraft, PublicationPreflight, PublishingDashboard } from "../types";
import { PublishingFlowProvider, type PublishingFlow } from "../PublishingFlowContext";

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });
function snapshot(id: string): PublicationPreflight {
  return {
    revision:"preflight-" + id, draftRevision:1, quoteFingerprint:"quote-" + id,
    mode:"mock", expiresAt:"2027-01-01T00:00:00Z", catalogRevision:"catalog", titleMode:"per_media",
    article:{id, title:"稿件 " + id, version:1, versionId:"version-" + id, hash:"hash-" + id, wordCount:10, imageCount:0, images:[], bodyHtml:"<p>" + id + " 的冻结正文</p>"},
    items:[{media:{id:"shared-media", name:"两稿共同选择的媒体", shortName:"共同", kind:"news", capability:"text", priceTenThousandths:"10000", catalogRevision:"catalog"}, title:"稿件 " + id + " 的独立标题", priceTenThousandths:"10000", blockers:[], warnings:[], checks:[{label:"正文符合要求",passed:true}]}],
    totalTenThousandths:"10000", availableAfterTenThousandths:"90000", wallet:{availableTenThousandths:"100000"}, blockers:[], warnings:[], gates:[],
  } as unknown as PublicationPreflight;
}
function draft(id: string): PublicationDraft {
  const value=snapshot(id);
  return {id,articleId:id,articleTitle:value.article.title,articleVersion:1,articleVersionId:"version-"+id,
    articleVersionHash:"hash-"+id,articleContainsImages:false,revision:1,titleMode:"per_media",
    items:value.items.map(item=>({media:item.media,title:item.title})),updatedAt:"2026-10-25T00:00:00Z"};
}
function dashboard(availableTenThousandths = "100000"): PublishingDashboard {
  return {wallet:{availableTenThousandths,reservedTenThousandths:"0",frozenTenThousandths:"0"},
    catalog:{activeRevision:"catalog",lastSyncedAt:"2026-10-26T00:00:00Z",stale:false},
    articleCount:2,actionableItemCount:0,resumableDraftCount:2,resumableDrafts:[],
    processingBatchCount:0,processingBatches:[],recentBatches:[],resumableArticles:[]};
}
function gatewayWith(overrides: Partial<PublisherGateway> = {}): PublisherGateway {
  return {getDraft:vi.fn<PublisherGateway["getDraft"]>(async (id:string)=>draft(id)),preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async(id:string)=>snapshot(id)),
    getDashboard:vi.fn<PublisherGateway["getDashboard"]>(async()=>dashboard()),
    submitDraft:vi.fn<PublisherGateway["submitDraft"]>(),...overrides} as unknown as PublisherGateway;
}
function feeValue(label: string) {
  return within(screen.getByRole("region",{name:"费用与预算核验"})).getByText(label).nextElementSibling!.textContent;
}
function quotedDraft(id: string, total: string, quantity = 1): PublicationDraft {
  const value=draft(id);
  value.items[0]!.publication={schemaVersion:1,source:"source_matrix_budget_plan",taskId:"task-1",planId:"plan-1",planVersion:"plan-v1",planIndex:0,
    articleId:id,articleVersionId:"version-"+id,articleVersion:"v1",resourceId:"shared-media",offerId:"offer-1",publicationSpec:"article",
    quantity,quantityMeaning:quantity>1?"repeat_same_article":"single",purpose:"standard",unitPriceTenThousandths:"10000",
    totalPriceTenThousandths:total,quoteFingerprint:"a".repeat(64),locked:false};
  return value;
}
function openReview(gateway: PublisherGateway, extra="", flow?:PublishingFlow) {
  const path="/publishing/drafts/a/review?batchDraft=a&batchDraft=b" + extra;
  window.history.replaceState({}, "", path);
  const location=memoryLocation({path, record:true});
  const content=<ReviewPage draftId="a"/>;
  const view=render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}>{flow?<PublishingFlowProvider value={flow}>{content}</PublishingFlowProvider>:content}</PublishingGatewayProvider></Router>);
  return {...view,location};
}
async function startPreflight() {
  const button=await screen.findByRole("button",{name:"一键预检"});
  await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
}
async function finishPreflight() {
  await waitFor(()=>expect((screen.getByRole("button",{name:"一键预检"}) as HTMLButtonElement).disabled).toBe(false));
}
function taskFlow(selections: Record<string, unknown> = {}, pending = false): PublishingFlow {
  return {taskId:"task-batch-review",scopeKey:"project-one",agentId:"publishing",pending,selections,resources:[],
    ensureTask:async()=>"task-batch-review",setSummary:vi.fn(),record:vi.fn(async()=>undefined),
    saveSelections:vi.fn(async()=>undefined),saveValues:vi.fn(async()=>undefined),handoff:vi.fn(async()=>undefined)};
}
function acceptedBatch(unknown = false): PublicationBatch {
  return {id:"batch-a",articleTitle:"稿件 a",status:unknown ? "action_required" : "queued",itemCount:1,unknownCount:unknown ? 1 : 0,
    totalTenThousandths:"10000",items:[]} as unknown as PublicationBatch;
}

it("restores both manuscripts as pending without calling preflight or showing duplicate manuscript cards", async () => {
  const gateway=gatewayWith();
  const view=openReview(gateway);
  const first=await screen.findByRole("region", {name:"稿件 1：稿件 a"});
  const second=await screen.findByRole("region", {name:"稿件 2：稿件 b"});
  expect(within(first).getByText("稿件 a 的独立标题")).toBeTruthy();
  expect(within(second).getByText("稿件 b 的独立标题")).toBeTruthy();
  expect(within(first).getByText("待预检")).toBeTruthy();
  expect(within(second).getByText("待预检")).toBeTruthy();
  expect(within(first).getByText("—")).toBeTruthy();
  expect(screen.queryByText("通过")).toBeNull();
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  expect(gateway.submitDraft).not.toHaveBeenCalled();
  expect((screen.getByRole("button",{name:"确认发布"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  expect(view.container.querySelector(".publishing-frozen-article")).toBeNull();
  expect(screen.queryByText(/FrontMind 媒体号/)).toBeNull();
  const checks=screen.getByRole("region",{name:"发布内容检查"});
  const fees=screen.getByRole("region",{name:"费用与预算核验"});
  expect(checks.contains(first)).toBe(true);
  expect(checks.contains(second)).toBe(true);
  expect(checks.compareDocumentPosition(fees) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(checks).getAllByRole("button",{name:"一键预检"})).toHaveLength(1);
  expect(screen.getByRole("button",{name:"一键预检"}).classList.contains("publishing-button-primary")).toBe(true);
  expect(within(fees).getByText("2 项 · ¥2.00")).toBeTruthy();
  expect(feeValue("预计总价")).toBe("¥2.00");
  expect(feeValue("本次待预占")).toBe("待预检后确定");
  await waitFor(()=>expect(feeValue("可用余额")).toBe("¥10.00"));
  expect(feeValue("按预估扣除后余额")).toBe("¥8.00");
  expect(gateway.getDashboard).toHaveBeenCalledTimes(1);
  expect(within(fees).getByText("请先点击一键预检，完成当前稿件与媒体的检查后再确认发布。")).toBeTruthy();
  expect(within(fees).queryByText("尚未完成本次预检，不能确认发布。请点击上方“一键预检”。")).toBeNull();
  expect((within(first).getByRole("button",{name:"查看冻结正文"}) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps the fees panel visible while metadata and the independent balance are loading", async () => {
  const drafts:Array<()=>void>=[];
  let resolveBalance:(value:PublishingDashboard)=>void=()=>{throw new Error("余额读取尚未开始");};
  const gateway=gatewayWith({
    getDraft:vi.fn<PublisherGateway["getDraft"]>(id=>new Promise(resolve=>drafts.push(()=>resolve(draft(id))))),
    getDashboard:vi.fn<PublisherGateway["getDashboard"]>(()=>new Promise(resolve=>{resolveBalance=resolve;})),
  });
  openReview(gateway);
  expect(screen.getByRole("region",{name:"费用与预算核验"})).toBeTruthy();
  expect(feeValue("预计总价")).toBe("正在读取…");
  expect(feeValue("可用余额")).toBe("正在读取…");
  await waitFor(()=>expect(drafts).toHaveLength(2));
  await act(async()=>{drafts.forEach(resolve=>resolve());});
  await waitFor(()=>expect(gateway.getDashboard).toHaveBeenCalledTimes(1));
  expect(feeValue("预计总价")).toBe("¥2.00");
  expect(feeValue("可用余额")).toBe("正在读取…");
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  await act(async()=>resolveBalance(dashboard()));
  expect(feeValue("可用余额")).toBe("¥10.00");
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it.each(["request failure","invalid amount"])("retries only the independent balance after %s without pretending an unknown balance is zero", async failure => {
  let attempts=0;
  const gateway=gatewayWith({getDashboard:vi.fn<PublisherGateway["getDashboard"]>(async()=>{
    if(++attempts===1) {if(failure==="request failure") throw new Error("余额服务暂不可用");return dashboard("");}
    return dashboard("0");
  })});
  openReview(gateway);
  const fees=screen.getByRole("region",{name:"费用与预算核验"});
  await within(fees).findByRole("alert");
  expect(feeValue("预计总价")).toBe("¥2.00");
  expect(feeValue("可用余额")).toBe("读取失败");
  expect(feeValue("按预估扣除后余额")).toBe("读取失败");
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(within(fees).getByRole("button",{name:"重试"}));
  await waitFor(()=>expect(feeValue("可用余额")).toBe("¥0.00"));
  expect(within(fees).queryByRole("alert")).toBeNull();
  expect(gateway.getDashboard).toHaveBeenCalledTimes(2);
  expect(gateway.getDraft).toHaveBeenCalledTimes(2);
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  expect(gateway.submitDraft).not.toHaveBeenCalled();
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("button",{name:"确认发布"}) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps the checked wallet authoritative when the initial balance arrives late without clearing confirmation", async () => {
  let resolveBalance:(value:PublishingDashboard)=>void=()=>{throw new Error("余额读取尚未开始");};
  const gateway=gatewayWith({getDashboard:vi.fn<PublisherGateway["getDashboard"]>(()=>new Promise(resolve=>{resolveBalance=resolve;}))});
  openReview(gateway);
  await waitFor(()=>expect(gateway.getDashboard).toHaveBeenCalledTimes(1));
  await startPreflight();await finishPreflight();
  expect(feeValue("可用余额")).toBe("¥10.00");
  expect(feeValue("本次待预占")).toBe("¥2.00");
  expect(feeValue("预占后预计可用")).toBe("¥8.00");
  fireEvent.click(screen.getByRole("checkbox"));
  await act(async()=>resolveBalance(dashboard("0")));
  expect(feeValue("可用余额")).toBe("¥10.00");
  expect(feeValue("预占后预计可用")).toBe("¥8.00");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("button",{name:"模拟发布 2 项"}) as HTMLButtonElement).disabled).toBe(false);
  expect(gateway.preflightDraft).toHaveBeenCalledTimes(2);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("keeps the server's insufficient balance blocking after a higher entry estimate", async () => {
  const gateway=gatewayWith({
    getDashboard:vi.fn<PublisherGateway["getDashboard"]>(async()=>dashboard("10000000")),
    preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>{const value=snapshot(id);value.wallet.availableTenThousandths="10000";return value;}),
  });
  openReview(gateway);
  await waitFor(()=>expect(feeValue("可用余额")).toBe("¥1,000.00"));
  await startPreflight();await finishPreflight();
  expect(feeValue("可用余额")).toBe("¥1.00");
  expect(feeValue("预计总价")).toBe("¥2.00");
  expect(screen.getByText("可用余额不足以覆盖本次全部待提交组合，请调整媒体后重新预检。")).toBeTruthy();
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button",{name:"模拟发布 2 项"}) as HTMLButtonElement).disabled).toBe(true);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("ignores an old balance after route changes and a later metadata restore", async () => {
  const balances:Array<(value:PublishingDashboard)=>void>=[];
  const gateway=gatewayWith({getDashboard:vi.fn<PublisherGateway["getDashboard"]>(()=>new Promise(resolve=>balances.push(resolve)))});
  const view=openReview(gateway);
  await waitFor(()=>expect(balances).toHaveLength(1));
  act(()=>view.location.navigate("/publishing/drafts/a/review?batchDraft=a&batchDraft=b&batchArticleVersion=new-selection"));
  await waitFor(()=>expect(balances).toHaveLength(2));
  await act(async()=>balances[1]!(dashboard("200000")));
  expect(feeValue("可用余额")).toBe("¥20.00");
  act(()=>{
    const event=new Event("pageshow");Object.defineProperty(event,"persisted",{value:true});
    window.dispatchEvent(event);
  });
  await waitFor(()=>expect(balances).toHaveLength(3));
  await act(async()=>balances[0]!(dashboard("900000")));
  expect(feeValue("可用余额")).toBe("正在读取…");
  await act(async()=>balances[2]!(dashboard("300000")));
  expect(feeValue("可用余额")).toBe("¥30.00");
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it.each([
  {name:"confirmed repeated total and a zero-price sibling",total:"31000",quantity:3,missing:false,expected:"¥3.10"},
  {name:"a genuinely quoted zero total",total:"0",quantity:1,missing:false,expected:"¥0.00"},
  {name:"an unverified legacy catalogue price",total:"0",quantity:1,missing:true,expected:"报价待核验"},
])("estimates $name once for each manuscript-media item", async scenario => {
  const gateway=gatewayWith({getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>{
    const value=quotedDraft(id,id==="a"?scenario.total:"0",id==="a"?scenario.quantity:1);
    if(scenario.missing && id==="a") {delete value.items[0]!.publication;value.items[0]!.media.priceTenThousandths="0";}
    return value;
  })});
  openReview(gateway);
  await screen.findByRole("region",{name:"稿件 2：稿件 b"});
  expect(feeValue("预计总价")).toBe(scenario.expected);
  expect(feeValue("软文媒体小计")).toBe("2 项 · "+scenario.expected);
  expect(feeValue("本次待预占")).toBe("待预检后确定");
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("checks only on click, renders actual reasons, and invalidates confirmation on a later run", async () => {
  let blocked=false;
  const gateway=gatewayWith({preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>{
    const value=snapshot(id);
    if(blocked && id==="b") {value.items[0]!.blockers=["正文不符合要求"];value.items[0]!.checks=[{label:"正文能力匹配",passed:false}];}
    return value;
  })});
  openReview(gateway);
  await startPreflight();
  await finishPreflight();
  expect(screen.getAllByText("通过")).toHaveLength(2);
  expect(screen.getAllByText("✓ 正文符合要求")).toHaveLength(2);
  fireEvent.click(screen.getByRole("checkbox"));
  expect((screen.getByRole("button",{name:"模拟发布 2 项"}) as HTMLButtonElement).disabled).toBe(false);
  blocked=true;
  await startPreflight();
  await finishPreflight();
  expect(screen.getByText("正文不符合要求")).toBeTruthy();
  expect(screen.getByText("× 正文能力匹配")).toBeTruthy();
  expect(screen.getByText("不通过")).toBeTruthy();
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(gateway.preflightDraft).toHaveBeenCalledTimes(4);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("keeps successful results separate from request failures and retries without approving a partial request run", async () => {
  let fail=true;
  const gateway=gatewayWith({preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>{if(id==="b" && fail) throw new Error("第二稿服务暂不可用");return snapshot(id);})});
  openReview(gateway);
  await startPreflight();
  await finishPreflight();
  expect(screen.getByText("通过")).toBeTruthy();
  expect(screen.getByText(/第二稿服务暂不可用/)).toBeTruthy();
  expect(screen.getAllByText("预检失败").length).toBeGreaterThan(0);
  expect((screen.getByRole("button",{name:"确认发布"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(feeValue("预计总价")).toBe("¥2.00");
  expect(feeValue("本次待预占")).toBe("待预检后确定");
  expect(screen.queryByText("不通过")).toBeNull();
  fail=false;
  await startPreflight();
  await finishPreflight();
  expect(screen.getAllByText("通过")).toHaveLength(2);
  expect(screen.queryByText(/第二稿服务暂不可用/)).toBeNull();
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("requires manual checking and confirmation while retaining each draft's fresh submit-time preflight", async () => {
  const events:string[]=[];
  const gateway=gatewayWith({
    preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>{events.push("preflight:"+id);return snapshot(id);}),
    submitDraft:vi.fn<PublisherGateway["submitDraft"]>(async input=>{
      events.push("submit:"+input.draftId);
      return {...acceptedBatch(),id:"batch-"+input.draftId,articleTitle:"稿件 "+input.draftId};
    }),
    getBatch:vi.fn<PublisherGateway["getBatch"]>(async id=>({...acceptedBatch(),id})),
  });
  openReview(gateway);
  await screen.findByRole("region",{name:"稿件 2：稿件 b"});
  fireEvent.click(screen.getByRole("button",{name:"确认发布"}));
  expect(gateway.submitDraft).not.toHaveBeenCalled();
  await startPreflight();await finishPreflight();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button",{name:"模拟发布 2 项"}));
  fireEvent.click(await screen.findByRole("button",{name:"确认模拟发布 ¥2.00"}));
  await waitFor(()=>expect(gateway.submitDraft).toHaveBeenCalledTimes(2));
  expect(events).toEqual(["preflight:a","preflight:b","preflight:a","submit:a","preflight:b","submit:b"]);
  expect(gateway.submitDraft).toHaveBeenNthCalledWith(1,expect.objectContaining({draftId:"a",preflightRevision:"preflight-a",quoteFingerprint:"quote-a",acknowledged:true,idempotencyKey:"publisher-submit:a:quote-a"}));
  expect(gateway.submitDraft).toHaveBeenNthCalledWith(2,expect.objectContaining({draftId:"b",preflightRevision:"preflight-b",quoteFingerprint:"quote-b",acknowledged:true,idempotencyKey:"publisher-submit:b:quote-b"}));
  expect(await screen.findByText(/全部 2 篇稿件的发布请求已受理/)).toBeTruthy();
});

it("shows checking while in flight and does not start duplicate requests", async () => {
  const resolvers: Array<()=>void>=[];
  const gateway=gatewayWith({preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(id=>new Promise(resolve=>resolvers.push(()=>resolve(snapshot(id))))) });
  openReview(gateway);
  await startPreflight();
  await waitFor(()=>expect(resolvers).toHaveLength(2));
  const button=screen.getByRole("button",{name:"预检中…"});
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(screen.getAllByText("—")).toHaveLength(2);
  expect(screen.queryByText("通过")).toBeNull();
  await act(async()=>{resolvers.forEach(resolve=>resolve());});
  await finishPreflight();
  expect(gateway.preflightDraft).toHaveBeenCalledTimes(2);
});

it("retains the adjusted wallet while a later manuscript's submitted request is unresolved", async () => {
  let resolveSecond:(value:PublicationBatch)=>void=()=>{throw new Error("第二稿尚未提交");};
  let checks=0;
  const gateway=gatewayWith({
    getDashboard:vi.fn<PublisherGateway["getDashboard"]>(async()=>dashboard("100000")),
    preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>{
      const value=snapshot(id);
      if(++checks>2 && id==="b") value.wallet.availableTenThousandths="90000";
      return value;
    }),
    submitDraft:vi.fn<PublisherGateway["submitDraft"]>(input=>input.draftId==="a"
      ? Promise.resolve({...acceptedBatch(),id:"batch-a"})
      : new Promise(resolve=>{resolveSecond=resolve;})),
    getBatch:vi.fn<PublisherGateway["getBatch"]>(async id=>({...acceptedBatch(),id})),
  });
  openReview(gateway);
  await waitFor(()=>expect(feeValue("可用余额")).toBe("¥10.00"));
  await startPreflight();await finishPreflight();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button",{name:"模拟发布 2 项"}));
  fireEvent.click(await screen.findByRole("button",{name:"确认模拟发布 ¥2.00"}));
  await waitFor(()=>expect(gateway.submitDraft).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(feeValue("预计可用余额")).toBe("¥9.00"));
  expect(feeValue("预计总价")).toBe("受理结果待确认");
  expect(gateway.submitDraft).toHaveBeenNthCalledWith(2,expect.objectContaining({draftId:"b",idempotencyKey:"publisher-submit:b:quote-b"}));
  await act(async()=>resolveSecond({...acceptedBatch(),id:"batch-b",articleTitle:"稿件 b"}));
  await screen.findByText(/全部 2 篇稿件的发布请求已受理/);
});

it("rejects a late result when the frozen draft changes during preflight", async () => {
  let changed=false;
  const gateway=gatewayWith({getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>{const value=draft(id);if(changed && id==="a") {value.revision=2;value.items[0]!.title="修改后的标题";}return value;}),
    preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>{changed=true;return snapshot(id);})});
  openReview(gateway);
  await startPreflight();
  expect(await screen.findByText("修改后的标题")).toBeTruthy();
  await waitFor(()=>expect(screen.queryByText("通过")).toBeNull());
  expect(within(screen.getByRole("region",{name:"稿件 1：稿件 a"})).getByText("待预检")).toBeTruthy();
  expect(within(screen.getByRole("region",{name:"稿件 2：稿件 b"})).getByText("待预检")).toBeTruthy();
  expect((screen.getByRole("button",{name:"确认发布"}) as HTMLButtonElement).disabled).toBe(true);
});

it("discards previous approvals on re-entry and a browser back-forward cache restore", async () => {
  const gateway=gatewayWith();
  const view=openReview(gateway);
  await startPreflight();await finishPreflight();
  expect(screen.getAllByText("通过")).toHaveLength(2);
  fireEvent.click(screen.getByRole("checkbox"));
  const event=new Event("pageshow");Object.defineProperty(event,"persisted",{value:true});
  fireEvent(window,event);
  await waitFor(()=>expect(screen.queryByText("通过")).toBeNull());
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(gateway.preflightDraft).toHaveBeenCalledTimes(2);
  view.unmount();
  openReview(gateway);
  await screen.findByRole("region",{name:"稿件 1：稿件 a"});
  expect(screen.queryByText("通过")).toBeNull();
  expect(gateway.preflightDraft).toHaveBeenCalledTimes(2);
});

it("ignores an old request after the route's frozen selection changes", async () => {
  const resolvers:Array<()=>void>=[];
  const gateway=gatewayWith({preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(id=>new Promise(resolve=>resolvers.push(()=>resolve(snapshot(id))))) });
  const view=openReview(gateway);
  await startPreflight();
  await waitFor(()=>expect(resolvers).toHaveLength(2));
  act(()=>view.location.navigate("/publishing/drafts/a/review?batchDraft=a&batchDraft=b&batchArticleVersion=new-selection"));
  await screen.findByRole("button",{name:"一键预检"});
  await act(async()=>{resolvers.forEach(resolve=>resolve());});
  expect(screen.queryByText("通过")).toBeNull();
  expect((screen.getByRole("button",{name:"确认发布"}) as HTMLButtonElement).disabled).toBe(true);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("shows a single manuscript group and opens its checked frozen body in a dialog without rechecking", async () => {
  const gateway=gatewayWith();
  const path="/publishing/drafts/a/review";
  const location=memoryLocation({path,record:true});
  render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}><ReviewPage draftId="a"/></PublishingGatewayProvider></Router>);
  const group=await screen.findByRole("region",{name:"稿件 1：稿件 a"});
  expect(within(group).getByText("版本 v1")).toBeTruthy();
  await startPreflight();await finishPreflight();
  const trigger=within(group).getByRole("button",{name:"查看冻结正文"});
  trigger.focus();
  fireEvent.click(trigger);
  const dialog=await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading",{name:"稿件 a"})).toBeTruthy();
  expect(within(dialog).getByText("a 的冻结正文")).toBeTruthy();
  expect(within(group).queryByText("a 的冻结正文")).toBeNull();
  expect(group.querySelector(".publishing-frozen-preview")).toBeNull();
  expect(screen.queryByRole("button",{name:"收起冻结正文"})).toBeNull();
  fireEvent.click(within(dialog).getByRole("button",{name:"关闭冻结正文"}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(()=>expect(document.activeElement).toBe(trigger));
  expect(gateway.preflightDraft).toHaveBeenCalledTimes(1);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("keeps five separate fields with the true media kind and no logo or media ID", async () => {
  const gateway=gatewayWith({getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>{
    const value=draft(id);
    value.items[0]!.media.kind=id==="a"?"self_media":"unknown";
    return value;
  })});
  const view=openReview(gateway);
  const first=await screen.findByRole("region",{name:"稿件 1：稿件 a"});
  const second=await screen.findByRole("region",{name:"稿件 2：稿件 b"});
  const labels=["媒体名称","媒体类型","发布标题","内容检查","状态"];
  expect(Array.from(view.container.querySelector(".publishing-review-head")!.children,cell=>cell.textContent)).toEqual(labels);
  for(const [group,type] of [[first,"自媒体"],[second,"媒体类型待核验"]] as const) {
    const row=group.querySelector(".publishing-review-row")!;
    expect(Array.from(row.children,cell=>cell.getAttribute("data-label"))).toEqual(labels);
    expect(row.children[1]!.textContent).toBe(type);
    expect(row.children[0]!.textContent).toBe("两稿共同选择的媒体");
    expect(row.querySelector('img, [role="img"], .publishing-media-mark')).toBeNull();
    expect(row.textContent).not.toContain("shared-media");
    expect(row.textContent).not.toContain("FrontMind 媒体号");
  }
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
});

it("keeps same-title manuscripts and frozen versions separate in the dialog while retaining confirmation", async () => {
  const checked=(id:string)=>{
    const value=snapshot(id);value.article.title="同名稿件";
    if(id==="b") {value.article.version=2;value.article.versionId="version-b-2";value.article.hash="hash-b-2";}
    return value;
  };
  const gateway=gatewayWith({
    getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>{
      const value=draft(id),article=checked(id).article;
      return {...value,articleTitle:article.title,articleVersion:article.version,articleVersionId:article.versionId,articleVersionHash:article.hash};
    }),
    preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>checked(id)),
  });
  openReview(gateway, "", taskFlow());
  const first=await screen.findByRole("region",{name:"稿件 1：同名稿件"});
  const second=await screen.findByRole("region",{name:"稿件 2：同名稿件"});
  await startPreflight();await finishPreflight();
  fireEvent.click(screen.getByRole("checkbox"));
  for(const [group,id,hash] of [[first,"a","hash-a"],[second,"b","hash-b-2"]] as const) {
    fireEvent.click(within(group).getByRole("button",{name:"查看冻结正文"}));
    const dialog=await screen.findByRole("dialog");
    expect(within(dialog).getByText(id+" 的冻结正文")).toBeTruthy();
    expect(dialog.textContent).toContain(hash);
    expect(dialog.textContent).not.toContain(id==="a"?"b 的冻结正文":"a 的冻结正文");
    fireEvent.click(within(dialog).getByRole("button",{name:"关闭冻结正文"}));
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  }
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("button",{name:"模拟发布 2 项"}) as HTMLButtonElement).disabled).toBe(false);
  expect(gateway.preflightDraft).toHaveBeenCalledTimes(2);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("closes a frozen preview when restored context invalidates the manual results", async () => {
  const gateway=gatewayWith();
  openReview(gateway);
  const group=await screen.findByRole("region",{name:"稿件 1：稿件 a"});
  await startPreflight();await finishPreflight();
  fireEvent.click(within(group).getByRole("button",{name:"查看冻结正文"}));
  await screen.findByRole("dialog");
  act(()=>{
    const event=new Event("pageshow");
    Object.defineProperty(event,"persisted",{value:true});
    window.dispatchEvent(event);
  });
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(()=>expect((within(screen.getByRole("region",{name:"稿件 1：稿件 a"})).getByRole("button",{name:"查看冻结正文"}) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.queryByText("a 的冻结正文")).toBeNull();
  expect(gateway.preflightDraft).toHaveBeenCalledTimes(2);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});

it("gets single and mixed mode return paths from actual drafts without preflight", async () => {
  const gateway=gatewayWith({getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>({...draft(id),titleMode:"single"}))});
  const view=openReview(gateway,"&batchArticleVersion=version-a&batchArticleVersion=version-b&enterpriseProjectId=project-1");
  const back=await screen.findByRole("link",{name:"返回选择媒体"});
  const href=new URL(back.getAttribute("href")!,window.location.origin);
  expect(href.pathname).toBe("/publishing/drafts/a/media");
  expect(href.searchParams.getAll("batchDraft")).toEqual(["a","b"]);
  expect(href.searchParams.getAll("batchArticleVersion")).toEqual(["version-a","version-b"]);
  expect(href.searchParams.get("enterpriseProjectId")).toBe("project-1");
  expect(screen.getByLabelText("发布流程").children).toHaveLength(3);
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  view.unmount();
  openReview(gatewayWith({getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>({...draft(id),titleMode:id==="a"?"single":"per_media"}))}));
  const mixed=await screen.findByRole("link",{name:"返回修改标题"});
  expect(new URL(mixed.getAttribute("href")!,window.location.origin).searchParams.getAll("batchDraft")).toEqual(["a","b"]);
  expect(screen.getByLabelText("发布流程").children).toHaveLength(4);
});

it("keeps optional preflight mode absent in the original approval snapshot", async () => {
  const results=[snapshot("a"),snapshot("b")];results.forEach(value=>{delete value.titleMode;});
  const gateway=gatewayWith({getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>({...draft(id),titleMode:"single"})),preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>results[id==="a"?0:1]!)});
  openReview(gateway);
  await startPreflight();await finishPreflight();
  expect(screen.getAllByText("通过")).toHaveLength(2);
  expect(results.every(value=>value.titleMode===undefined)).toBe(true);
  expect(screen.getByRole("link",{name:"返回选择媒体"})).toBeTruthy();
});

it("keeps an excluded manuscript visible and outside preflight and fees", async () => {
  const gateway=gatewayWith();
  openReview(gateway,"&excludedDraft=b");
  const excluded=await screen.findByRole("region",{name:"稿件 2：稿件 b"});
  expect(within(excluded).getByText("本稿未纳入发布")).toBeTruthy();
  await startPreflight();await finishPreflight();
  expect(vi.mocked(gateway.preflightDraft).mock.calls.map(call=>call[0])).toEqual(["a"]);
  expect(within(screen.getByRole("region",{name:"费用与预算核验"})).getByText("1 项 · ¥1.00")).toBeTruthy();
});

it("explains why an entirely excluded selection cannot continue", async () => {
  const gateway=gatewayWith();
  openReview(gateway,"&excludedDraft=a&excludedDraft=b");
  await screen.findByRole("region",{name:"稿件 2：稿件 b"});
  expect(screen.getByText("未选择投放媒体，无法继续。请返回修改。")).toBeTruthy();
  expect((screen.getByRole("button",{name:"一键预检"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button",{name:"确认发布"}) as HTMLButtonElement).disabled).toBe(true);
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
});

it("preserves route context when returning to titles or fixing a checked body", async () => {
  const gateway=gatewayWith({preflightDraft:vi.fn<PublisherGateway["preflightDraft"]>(async id=>{const value=snapshot(id);if(id==="a") value.items[0]!.blockers=["正文需要修改"];return value;})});
  openReview(gateway,"&search=科技&batchArticleVersion=version-a&batchArticleVersion=version-b&enterpriseProjectId=project-1&operatorOwnerId=9");
  await startPreflight();await finishPreflight();
  const editUrl=new URL(screen.getByRole("link",{name:"修改本稿正文"}).getAttribute("href")!,window.location.origin);
  expect(editUrl.pathname).toBe("/publishing/articles/a/edit");
  expect(editUrl.searchParams.getAll("batchArticle")).toEqual(["a","b"]);
  expect(editUrl.searchParams.getAll("batchDraft")).toEqual(["a","b"]);
  expect(editUrl.searchParams.getAll("batchArticleVersion")).toEqual(["version-a","version-b"]);
  expect(editUrl.searchParams.get("enterpriseProjectId")).toBe("project-1");
  expect(editUrl.searchParams.get("operatorOwnerId")).toBe("9");
  expect(new URL(screen.getByRole("link",{name:"返回修改标题"}).getAttribute("href")!,window.location.origin).searchParams.get("search")).toBe("科技");
});

it("waits for task hydration and preserves accepted receipts and exact outstanding requests", async () => {
  const request={draftId:"b",preflightRevision:"original-b",quoteFingerprint:"quote-b",acknowledged:true,idempotencyKey:"publisher-submit:b:quote-b"};
  const saved=JSON.stringify({acceptedBatchIds:{a:"batch-a"},requests:{b:request}});
  const pendingFlow=taskFlow({},true);
  const gateway=gatewayWith({getBatch:vi.fn<PublisherGateway["getBatch"]>(async()=>acceptedBatch())});
  const path="/publishing/drafts/a/review?batchDraft=a&batchDraft=b";
  const location=memoryLocation({path,record:true});
  const tree=(flow:PublishingFlow)=><Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}><PublishingFlowProvider value={flow}><ReviewPage draftId="a" /></PublishingFlowProvider></PublishingGatewayProvider></Router>;
  const view=render(tree(pendingFlow));
  expect(screen.getByText("正在恢复稿件与已受理批次…")).toBeTruthy();
  expect(pendingFlow.saveValues).not.toHaveBeenCalled();
  expect(gateway.getDraft).not.toHaveBeenCalled();
  expect(gateway.getDashboard).not.toHaveBeenCalled();
  const restored=taskFlow({"publishingBatchReview:a,b":saved});
  view.rerender(tree(restored));
  expect(await screen.findByRole("link",{name:"查看本稿发布结果"})).toBeTruthy();
  expect(screen.getByText("发布请求待确认")).toBeTruthy();
  expect(feeValue("预计总价")).toBe("受理结果待确认");
  expect(feeValue("本次待预占")).toBe("受理结果待确认");
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  expect(gateway.submitDraft).not.toHaveBeenCalled();
  await waitFor(()=>expect(restored.saveValues).toHaveBeenCalled());
  for(const [values] of vi.mocked(restored.saveValues!).mock.calls) {
    expect(JSON.parse(String(values["publishingBatchReview:a,b"]))).toEqual({acceptedBatchIds:{a:"batch-a"},requests:{b:request}});
  }
});

it("refreshes unknown acceptance read-only despite URL exclusion and keeps the exact request", async () => {
  const request={draftId:"b",preflightRevision:"original-b",quoteFingerprint:"quote-b",acknowledged:true,idempotencyKey:"publisher-submit:b:quote-b"};
  const flow=taskFlow({"publishingBatchReview:a,b":JSON.stringify({requests:{b:request},acceptedBatchIds:{a:"batch-a"}})});
  const gateway=gatewayWith({getDraft:vi.fn<PublisherGateway["getDraft"]>(async id=>({...draft(id),titleMode:"single"}))});
  const path="/publishing/drafts/b/review?excludedDraft=b";
  const location=memoryLocation({path,record:true});
  render(<Router hook={location.hook} searchHook={location.searchHook}><PublishingGatewayProvider gateway={gateway}><PublishingFlowProvider value={flow}><ReviewPage draftId="b"/></PublishingFlowProvider></PublishingGatewayProvider></Router>);
  expect(await screen.findByText("发布请求待确认")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"刷新受理状态"}));
  await waitFor(()=>expect(gateway.getDraft).toHaveBeenCalledTimes(2));
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  expect(gateway.submitDraft).not.toHaveBeenCalled();
  expect(screen.queryByText("本稿未纳入发布")).toBeNull();
  expect((screen.getByRole("button",{name:"返回选择媒体"}) as HTMLButtonElement).disabled).toBe(true);
  expect(feeValue("预计总价")).toBe("受理结果待确认");
  await waitFor(()=>expect(flow.saveValues).toHaveBeenCalled());
  for(const [values] of vi.mocked(flow.saveValues!).mock.calls) {
    expect(JSON.parse(String(values["publishingBatchReview:b"])).requests.b).toEqual(request);
  }
});

it("refreshes an accepted attention batch before explicitly checking remaining drafts", async () => {
  let unresolved=true;
  const gateway=gatewayWith({getBatch:vi.fn<PublisherGateway["getBatch"]>(async()=>acceptedBatch(unresolved))});
  const flow=taskFlow({"publishingBatchReview:a,b":JSON.stringify({acceptedBatchIds:{a:"batch-a"},requests:{}})});
  openReview(gateway,"",flow);
  expect(await screen.findByText(/已受理批次有待核实结果/)).toBeTruthy();
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  unresolved=false;
  fireEvent.click(screen.getByRole("button",{name:"刷新受理状态"}));
  await waitFor(()=>expect(screen.queryByText(/已受理批次有待核实结果/)).toBeNull());
  expect(gateway.preflightDraft).not.toHaveBeenCalled();
  await startPreflight();await finishPreflight();
  fireEvent.click(screen.getByRole("checkbox"));
  expect((screen.getByRole("button",{name:"模拟发布 1 项"}) as HTMLButtonElement).disabled).toBe(false);
  expect(gateway.getBatch).toHaveBeenCalledTimes(2);
  expect(gateway.submitDraft).not.toHaveBeenCalled();
});
