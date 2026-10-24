// @vitest-environment jsdom
import React from "react";
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { StandalonePublishingFlow } from "./StandalonePublishingFlow";
import PublishingRoutes from "../module/client/PublishingRoutes";
import { usePublishingFlow, type PublishingFlow } from "../module/client/PublishingFlowContext";
import { configurePublishingHost } from "../module/client/host";
import type { PublisherGateway } from "../module/client/gateway";
import type { ArticleDetail, MediaFacets, MediaResource, PublicationDraft } from "../module/client/types";
import type { MediaRules } from "../module/server/providers/kol/media-rules";

// Keep routes, flow, query lifecycle, page, MarketRow and native checkbox real.
// Only the gateway and media-requirements HTTP boundary return fixture data.
const timestamp = "2026-10-24T00:00:00.000Z";
const versionId = "version-1";
const homePath = `/publishing/media?articleVersion=${versionId}&mode=single`;
const storageKey = "frontmind.publishing.flow.v1:media-integration";
const rules: MediaRules = {
  version:1,rawRemark:"测试供应商规则",collectedAt:timestamp,
  source:"/api/news_resource_2/data",unresolved:[],
  rules:[
    {field:"title_chars",state:"unknown",evidence:[]},
    {field:"body_chars",state:"unknown",evidence:[]},
    {field:"images",state:"unknown",evidence:[]},
    {field:"links",state:"unknown",evidence:[]},
  ],
};
function media(id: string): MediaResource {
  return {
    id,name:`测试媒体 ${id}`,shortName:id,kind:"news",platform:"门户",
    taxonomy:"",mediaType:"",channel:"",region:"",titleLimit:100,
    priceTenThousandths:"1000000",turnaround:"",active:true,capability:"image",
    catalogRevision:"catalog-1",logoSource:"generated_fallback",logoResolutionStatus:"missing",
  };
}
function fixture() {
  const items = [media("a"),media("b")];
  const detail: ArticleDetail = {
    id:"article-1",title:"已确认稿件",status:"frozen",currentVersionId:versionId,
    currentVersion:1,wordCount:20,imageCount:0,updatedAt:timestamp,revision:1,
    bodyText:"测试稿件正文",images:[],
    versions:[{id:versionId,version:1,hash:"hash-1",containsImages:false,frozen:true,createdAt:timestamp,createdBy:"测试账号"}],
    importChecks:{docxSafe:true,externalLinkCount:0,structureValid:true},
  };
  const catalog = {activeRevision:"catalog-1",mediaCount:2,newsCount:2,selfMediaCount:0,kindComplete:true,lastSyncedAt:timestamp,stale:false};
  const facets: MediaFacets = {
    kinds:{news:2,self_media:0},platforms:[],taxonomies:[],mediaTypes:[],areas:[],
    includeTypes:[],publishSpeeds:[],entryTypes:[],linkTypes:[],imageSupports:[],
    pcWeightThresholds:[],includeRateThresholds:[],successRateThresholds:[],recommendedOptions:[],
    authenticatedOptions:[],festivalPublishableOptions:[],catalog,
  };
  let saved: PublicationDraft | undefined;
  const createDraft = vi.fn<PublisherGateway["createDraft"]>(async (requestedVersion,ids,_key,titleMode) => {
    if (saved) throw new Error("The integration must not create a replacement draft");
    if (requestedVersion !== versionId) throw new Error("Unexpected frozen version");
    saved = {
      id:"draft-1",articleId:detail.id,articleVersionId:versionId,articleTitle:detail.title,
      articleVersion:1,articleVersionHash:"hash-1",articleContainsImages:false,revision:1,
      titleMode:titleMode ?? "single",sharedTitle:detail.title,updatedAt:timestamp,
      items:items.filter(item=>ids.includes(item.id)).map(item=>({media:item,title:detail.title})),
    };
    return saved;
  });
  const getDraft = vi.fn<PublisherGateway["getDraft"]>(async id => {
    if (!saved || saved.id !== id) throw new Error("Draft does not exist");
    return saved;
  });
  const updateDraftMedia = vi.fn<PublisherGateway["updateDraftMedia"]>(async (id,ids,revision) => {
    if (!saved || saved.id !== id || saved.revision !== revision) throw new Error("Unexpected draft or stale revision");
    saved = {...saved,revision:revision+1,items:items.filter(item=>ids.includes(item.id)).map(item=>({media:item,title:detail.title}))};
    return saved;
  });
  const gateway = {
    listMedia:vi.fn<PublisherGateway["listMedia"]>(async filters=>({items,total:2,page:filters.page,pageSize:filters.pageSize,catalog})),
    getMediaFacets:vi.fn(async()=>facets),listArticles:vi.fn(async()=>[detail]),
    getArticle:vi.fn(async()=>detail),
    getArticleVersion:vi.fn<PublisherGateway["getArticleVersion"]>(async id=>{
      if (id !== versionId) throw new Error("Unexpected frozen version");
      return detail.versions[0]!;
    }),
    createDraft,getDraft,updateDraftMedia,
  } as unknown as PublisherGateway;
  return {gateway,createDraft,getDraft,updateDraftMedia,saved:()=>saved};
}
function mount(gateway: PublisherGateway, path = homePath) {
  window.history.replaceState({},"",path);
  const location = memoryLocation({path,record:true});
  let flow!: PublishingFlow;
  function Probe() {flow=usePublishingFlow()!;return null;}
  const view = render(<Router hook={location.hook} searchHook={location.searchHook}>
    <StandalonePublishingFlow workspaceKey="media-integration">
      <Probe /><PublishingRoutes gateway={gateway} />
    </StandalonePublishingFlow>
  </Router>);
  return {...view,location,flow:()=>flow};
}
const checkbox = (id: string) => screen.getByRole("checkbox",{name:`选择 测试媒体 ${id} 门户`}) as HTMLInputElement;
async function ready(id: string) {
  await waitFor(()=>expect(checkbox(id).disabled).toBe(false));
  return checkbox(id);
}
function homeSummary() {
  const section = screen.getByRole("heading",{name:"共用购物车"}).closest("section");
  if (!section) throw new Error("Shared cart summary is missing");
  return section;
}
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,"close");
beforeEach(()=>{
  localStorage.clear();configurePublishingHost({});vi.stubGlobal("crypto",webcrypto);
  // jsdom has no modal implementation. Preserve the actual dialog component.
  Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute("open","");}});
  Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute("open");}});
  vi.stubGlobal("fetch",vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url,window.location.origin);
    if (url.pathname === "/api/modules/publish/media-requirements/status") return {ok:true,json:async()=>({configured:true})} as Response;
    if (url.pathname === "/api/modules/publish/media-requirements") return {ok:true,json:async()=>({items:(url.searchParams.get("ids")??"").split(",").filter(Boolean).map(id=>({id,rules}))})} as Response;
    throw new Error(`Unexpected network request: ${url.pathname}`);
  }));
});
afterEach(()=>{
  cleanup();configurePublishingHost({});vi.restoreAllMocks();vi.unstubAllGlobals();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype,"showModal",originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype,"showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype,"close",originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype,"close");
  window.history.replaceState({},"","/");
});

describe("real media page, routes and standalone task integration",()=>{
  it("selects and removes media, returns to the version overview and restores the same draft after refresh",async()=>{
    const data=fixture();
    const session=mount(data.gateway);
    await screen.findByRole("heading",{name:"媒体库",level:1});
    const owner=session.flow().taskId;
    fireEvent.click(screen.getByRole("link",{name:"进入媒体选择 →"}));
    await screen.findByRole("heading",{name:"第三方媒体选择",level:1});
    fireEvent.click(await ready("a"));
    await waitFor(()=>expect(data.createDraft).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(session.location.history.at(-1)).toContain("/publishing/drafts/draft-1/media/third?"));
    await waitFor(()=>expect(checkbox("a").checked).toBe(true));
    expect(session.flow().taskId).toBe(owner);
    expect(session.flow().resources).toContainEqual({kind:"publication_draft",id:"draft-1"});
    expect(data.createDraft).toHaveBeenCalledWith(versionId,["a"],expect.any(String),"single");

    fireEvent.click(await ready("b"));
    await waitFor(()=>expect(data.updateDraftMedia).toHaveBeenLastCalledWith("draft-1",["a","b"],1));
    await waitFor(()=>expect(checkbox("b").checked).toBe(true));
    fireEvent.click(await ready("a"));
    await waitFor(()=>expect(data.updateDraftMedia).toHaveBeenLastCalledWith("draft-1",["b"],2));
    await waitFor(()=>expect(checkbox("a").checked).toBe(false));
    expect(checkbox("b").checked).toBe(true);

    await act(async()=>{session.location.navigate(homePath);});
    await screen.findByRole("heading",{name:"媒体库",level:1});
    await waitFor(()=>expect(homeSummary().textContent).toMatch(/1 家/));
    expect(homeSummary().textContent).toContain("100.00");
    expect(session.flow().taskId).toBe(owner);
    const cartLink=within(homeSummary()).getByRole("link",{name:"查看购物车 →"});
    expect(cartLink.getAttribute("href")).toContain("/publishing/drafts/draft-1/media/cart");
    fireEvent.click(cartLink);
    await screen.findByRole("heading",{name:"第三方购物车",level:1});
    await waitFor(()=>expect(document.querySelectorAll(".y-cart-table tbody tr")).toHaveLength(1));
    expect(document.querySelector(".y-cart-table tbody")?.textContent).toContain("测试媒体 b");
    expect(data.createDraft).toHaveBeenCalledTimes(1);

    const savedPath=session.location.history.at(-1)!;
    session.unmount();
    const refreshed=mount(data.gateway,savedPath);
    await screen.findByRole("heading",{name:"第三方购物车",level:1});
    await waitFor(()=>expect(document.querySelectorAll(".y-cart-table tbody tr")).toHaveLength(1));
    expect(document.querySelector(".y-cart-table tbody")?.textContent).toContain("测试媒体 b");
    expect(refreshed.flow().taskId).toBe(owner);
    expect(refreshed.flow().resources).toContainEqual({kind:"publication_draft",id:"draft-1"});
    expect(data.saved()?.items.map(item=>item.media.id)).toEqual(["b"]);
    expect(data.saved()?.revision).toBe(3);
    expect(data.createDraft).toHaveBeenCalledTimes(1);
    expect(data.getDraft).toHaveBeenLastCalledWith("draft-1",expect.any(AbortSignal));
  });

  it("retains the exact server draft if registering its task reference fails",async()=>{
    const data=fixture();
    let session=mount(data.gateway);
    await screen.findByRole("heading",{name:"媒体库",level:1});
    fireEvent.click(screen.getByRole("link",{name:"进入媒体选择 →"}));
    await ready("a");
    const nativeSetItem=Storage.prototype.setItem;
    let rejected=false;
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){
      if (!rejected && key===storageKey && value.includes('"publication_draft"')) {
        rejected=true;throw new Error("测试存储写入失败");
      }
      nativeSetItem.call(this,key,value);
    });
    fireEvent.click(checkbox("a"));
    await waitFor(()=>expect(rejected).toBe(true));
    await waitFor(()=>expect(session.location.history.at(-1)).toContain("/publishing/drafts/draft-1/media/third?"));
    await waitFor(()=>expect(checkbox("a").checked).toBe(true));
    const recoverablePath=session.location.history.at(-1)!;
    session.unmount();
    session=mount(data.gateway,recoverablePath);
    await waitFor(()=>expect(checkbox("a").checked).toBe(true));
    // Recovery must remain reachable even when real routing remounts the page.
    fireEvent.click(await screen.findByRole("button",{name:"重试关联任务"}));
    await waitFor(()=>expect(screen.queryByRole("button",{name:"重试关联任务"})).toBeNull());
    expect(session.flow().resources).toContainEqual({kind:"publication_draft",id:"draft-1"});
    expect(session.flow().resources).toContainEqual({kind:"article_version",id:versionId});
    fireEvent.click(await ready("b"));
    await waitFor(()=>expect(data.updateDraftMedia).toHaveBeenLastCalledWith("draft-1",["a","b"],1));
    expect(data.createDraft).toHaveBeenCalledTimes(1);
    expect(data.saved()?.id).toBe("draft-1");
    await act(async()=>{session.location.navigate(homePath);});
    await screen.findByRole("heading",{name:"媒体库",level:1});
    await waitFor(()=>expect(homeSummary().textContent).toMatch(/2 家/));
    expect(homeSummary().textContent).toContain("200.00");
    expect(within(homeSummary()).getByRole("link",{name:"查看购物车 →"}).getAttribute("href")).toContain("/publishing/drafts/draft-1/media/cart");
    expect(data.createDraft).toHaveBeenCalledTimes(1);
  });
});
