// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { useState } from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import SourceMatrixPage from './SourceMatrixPage';
import {downloadUrl} from './api';
import { PublishingFlowProvider,type PublishingFlow } from '../PublishingFlowContext';
import type { MediaResource,PublicationDraft } from '../types';
import type { ContentPlan,MatrixResult,Json } from './types';
import {matrixDemo} from './demo';
import type { IndustryCatalogResponse } from '../../shared/industry-catalog';
// jsdom does not implement <dialog>; the confirmation dialog needs these stubs.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

// Complete canonical contract. Dataset availability is expressed separately from
// selectable categories so generation fixtures still exercise real eligibility.
function canonicalCatalog(rows: Array<{id:string;name:string}> = [], brandBatches: IndustryCatalogResponse['brand_data_batches'] = []): IndustryCatalogResponse {
 const industries=rows.map(({id,name})=>({id,scopeId:id,name,label:name,path:[name],depth:0}));
 return {status:'configured',industries,catalogVersion:'page-fixture-catalog-1',filters:{models:[{value:'all',label:'全部模型'}],minDate:'2026-10-01',maxDate:'2026-10-31',industryTree:rows.map(({id,name})=>({id:'node-'+id,label:name,scopeType:'CATEGORY' as const,scopeId:id,children:[]})),sourceTypes:['新闻资讯']},legacyMappings:rows.map(({id,name})=>({localId:'legacy-'+id,localName:name,canonicalId:id,status:'mapped' as const,via:'explicit' as const})),brand_data_batches:brandBatches};
}

const mediaGateway=vi.hoisted(()=>({listMedia:vi.fn(),getDraft:vi.fn(),getArticleVersion:vi.fn(),createDraft:vi.fn(),updateDraftMedia:vi.fn()}));
const gatewayIdentity=vi.hoisted(()=>({current:null as object|null}));
vi.mock('../PublishingContext',()=>({usePublisherGateway:()=>gatewayIdentity.current??mediaGateway}));
vi.mock('./industry/IndustryDistribution',()=>({LiveIndustryDistribution:()=> <div>真实行业分布</div>}));
beforeEach(()=>{Object.values(mediaGateway).forEach(mock=>mock.mockReset());gatewayIdentity.current={...mediaGateway};sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();window.history.replaceState({},'', '/');});
it('defaults to real industry distribution and exposes only the two canonical tabs',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?draftId=draft-1&articleVersion=version-1#range');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>canonicalCatalog()})));
 mediaGateway.getDraft.mockResolvedValue(draft());
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByText('真实行业分布');
 const matrixLink=screen.getByRole('link',{name:'信源矩阵推荐'}) as HTMLAnchorElement;
 expect(matrixLink.search).toContain('tab=matrix');expect(matrixLink.search).toContain('draftId=draft-1');expect(matrixLink.hash).toBe('#range');
 expect(screen.queryByRole('link',{name:'媒体库首页'})).toBeNull();expect(screen.queryByRole('link',{name:'第三方媒体列表'})).toBeNull();expect(screen.queryByText('输入信源数据')).toBeNull();
});
it('keeps configuration details out of permanent layout and offers a local industry retry',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>String(url).includes('/matrix/connection')?{connection:null,mode:'none',available:false}:{...canonicalCatalog(),status:'configuration_required',filters:null,catalogVersion:null,message:'信源规划存储尚未配置，请联系管理员完成模块迁移'}})));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('button',{name:'重试读取行业'});expect(screen.queryByText(/请联系管理员完成模块迁移/)).toBeNull();
 expect(screen.getByLabelText('目标行业 *')).toBeTruthy();expect(screen.getByLabelText('期望发布时效')).toBeTruthy();expect(screen.getByLabelText('素材能力要求')).toBeTruthy();expect(screen.getByLabelText('目标平台')).toBeTruthy();expect(screen.getAllByRole('button',{name:'导入数据'})).toHaveLength(1);expect(screen.queryByLabelText('品牌引用数据')).toBeNull();expect(screen.queryByLabelText('引用样本平台')).toBeNull();
});
it('keeps available platform status silent without personal API settings or the removed top shortcuts',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>({ok:true,json:async()=>String(input).includes('/matrix/connection')?{connection:null,mode:'environment',available:true,message:'当前使用平台配置的模型'}:canonicalCatalog()})));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await waitFor(()=>expect(screen.queryByText('正在读取推荐服务状态…')).toBeNull());
 expect(screen.queryByText('当前使用平台配置的模型')).toBeNull();
 expect(document.querySelector('.sm-input-status')).toBeNull();
 expect(screen.queryByRole('button',{name:'连接 API'})).toBeNull();
 expect(screen.queryByLabelText('当前投放任务')).toBeNull();
 expect(screen.queryByRole('link',{name:/^购物车 \d/})).toBeNull();
 expect(screen.getByRole('link',{name:'进入媒体库自选'})).toBeTruthy();
 expect(screen.getByRole('button',{name:/配置标题/})).toBeTruthy();
});
it('shows pending platform status and recovers an unavailable status through its own retry',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 let finish!:(value:unknown)=>void,reads=0;const pending=new Promise(resolve=>{finish=resolve;});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>({ok:true,json:async()=>String(input).includes('/matrix/connection')?(++reads===1?pending:{connection:null,mode:'environment',available:true}):canonicalCatalog()})));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 expect(await screen.findByText('正在读取推荐服务状态…')).toBeTruthy();
 await act(async()=>finish({connection:null,mode:'none',available:false}));
 expect(await screen.findByText('推荐服务暂不可用，请稍后重试或联系运营。')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'重试读取服务状态'}));
 await waitFor(()=>expect(screen.queryByText('正在读取推荐服务状态…')).toBeNull());
 expect(screen.queryByText('当前使用平台配置的模型')).toBeNull();
 expect(screen.queryByText(/打开连接设置|尚未连接 AI|已保存连接/)).toBeNull();
});
it('renders structured stale results without replacing or reading nonexistent matrix fields',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?task=task&tab=matrix');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('/industries')?canonicalCatalog():{task_id:'task',state:'complete',result:{status:'stale_matrix',errors:[{code:'stale_matrix',message:'任务已变化，请重新生成'}]}}})));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByText('任务已变化，请重新生成');expect(screen.getByText('等待生成矩阵')).toBeTruthy();
});

const media:MediaResource={id:'media-1',externalResourceId:'external-1',name:'可投媒体',shortName:'可投',kind:'news',platform:'新闻',taxonomy:'',mediaType:'',channel:'',region:'',titleLimit:200,priceTenThousandths:'1000000',turnaround:'',active:true,capability:'image',catalogRevision:'catalog-1',logoSource:'generated_fallback',logoResolutionStatus:'missing'};
function draft(id='draft-1',revision=1,items:MediaResource[]=[]):PublicationDraft{return {id,revision,articleId:'article-1',articleVersionId:'version-1',articleTitle:'当前稿件',articleVersion:1,articleVersionHash:'hash-1',articleContainsImages:false,titleMode:'per_media',items:items.map(media=>({media,title:'当前稿件'})),updatedAt:'2026-10-24T00:00:00Z'};}
const matrix:MatrixResult={status:'complete',plan_id:'plan-1',plan_version:'plan-version-1',matrix_version:'matrix-version-1',as_of:'2026-10-24T00:00:00Z',scope:{task:{model_source:'environment',industry_context:{status:'ok',message:'Synthetic verified industry context',limitations:[]},binding:{draft_id:'draft-1',article_id:'article-1',article_version_id:'version-1',version_number:1,content_hash:'hash-1',article_title:'当前稿件',fingerprint:'fixture-binding-1'}},evidence_scope:{}},matrix:{status:'complete',candidates:[{candidate_id:'candidate-1',resource_id:'external-1',attributes:{source_name:'可投媒体'},offers:[],primary_role:'industry',auxiliary_roles:[],selection:'recommended',matched_questions:[],reason_summary:'已核验行业相关',channel_status:'eligible',manuscript_status:'compatible',hard_failures:[],pending_conditions:[],evidence_relation:'',evidence_ids:[],aggregate_ids:[]}],layers:[{role:'industry',display_name:'行业核心',status:'populated',candidate_ids:['candidate-1'],auxiliary_candidate_ids:[]}],fit_order:['candidate-1']},source_analysis:{status:'complete',known_detail_count:0,total_citations:0,groups:[],actual_sources:[],domain_rollups:[],detail_citations:[],external_aggregates:[],supplier_claims:[],unknown_records:[],content_age:null},budget_plans:[],limitations:[],warnings:[],errors:[],minimum_known_cost:null};
function liveDirectory(){
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
  const url=String(input);
  if(url.endsWith('/matrix/form-scope'))return {ok:true,json:async()=>({scopeKey:'a'.repeat(64)})};
  if(url.includes('/matrix/identify/context')){const versionId=new URL(url,window.location.origin).searchParams.get('article_version_id')??'version-1';return {ok:true,json:async()=>({status:'not_configured',context:{scopeKey:'authorized-test-project',articleId:'article-1',articleVersionId:versionId,versionNumber:1,title:'当前稿件',contentDigest:'digest-'+versionId,connection:{available:false,mode:'environment',revision:'fixture-identification-unavailable'}},fields:{product:{value:null,source:'unidentified'},industry:{value:null,source:'unidentified'},audience:{value:null,source:'unidentified'},questions:{value:null,source:'unidentified'}}})};}
  return {ok:true,json:async()=>url.includes('/industries')?canonicalCatalog():url.includes('/matrix/connection')?{connection:null,mode:'environment',available:true}:url.includes('/matrix/imports')?{datasets:[]}:url.includes('/classify/')?{task_id:'matrix-1',state:'complete',result:matrix}:url.endsWith('/status')?{configured:true}:{items:[{id:media.id,externalResourceId:media.externalResourceId,rules:{rules:[],rawRemark:'',unresolved:[]}}]}};
 }));
 mediaGateway.listMedia.mockResolvedValue({items:[media],total:1,page:1,pageSize:100,exactResourceLookupVersion:1,catalog:{activeRevision:'catalog-1'}});
 mediaGateway.getArticleVersion.mockResolvedValue({id:'version-1',version:1,hash:'hash-1',containsImages:false,frozen:true,createdAt:'2026-10-24T00:00:00Z',createdBy:'当前账号'});
 mediaGateway.getDraft.mockResolvedValue(draft());
}
function flow():PublishingFlow{return {taskId:'workbench-1',scopeKey:'workspace-1',agentId:'media',resources:[{kind:'article_version',id:'version-1'}],ensureTask:vi.fn(async()=> 'workbench-1'),record:vi.fn(async()=>{}),saveSelections:vi.fn(async()=>{}),setSummary:vi.fn(),handoff:vi.fn(async()=>{})};}
function openMatrix(query:string,owner?:PublishingFlow){
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&task=matrix-1&'+query);
 const page=<div className="monitoring-module"><SourceMatrixPage view="matrix"/></div>;
 return render(owner?<PublishingFlowProvider value={owner}>{page}</PublishingFlowProvider>:page);
}

it('creates the exact frozen-version draft only after an eligible matrix selection, then cancels through that same draft',async()=>{
 liveDirectory();const owner=flow();
 mediaGateway.createDraft.mockImplementation(async()=>{const saved=draft('draft-1',1,[media]);mediaGateway.getDraft.mockResolvedValue(saved);return saved;});
 mediaGateway.updateDraftMedia.mockResolvedValue(draft('draft-1',2,[]));
 openMatrix('articleVersion=version-1&mode=multi&workbenchTask=workbench-1&enterpriseProjectId=project-1&operatorOwnerId=owner-1',owner);
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));
 expect(mediaGateway.createDraft).not.toHaveBeenCalled();
 fireEvent.click(checkbox);
 await waitFor(()=>expect(mediaGateway.createDraft).toHaveBeenCalledWith('version-1',[media.id],expect.stringMatching(/^publisher:draft:/),'per_media'));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('draftId')).toBe('draft-1'));
 expect(owner.record).toHaveBeenCalledWith(expect.objectContaining({id:'media-draft:draft-1',resources:[{kind:'article_version',id:'version-1'},{kind:'publication_draft',id:'draft-1'}]}));
 expect(window.location.pathname).toBe('/publishing/source-matrix');
 const cartLink=new URL((screen.getByText('完整购物车 →',{selector:'a'}) as HTMLAnchorElement).href);
 expect(cartLink.pathname).toBe('/publishing/drafts/draft-1/media/cart');
 expect(Object.fromEntries(cartLink.searchParams)).toMatchObject({articleVersion:'version-1',mode:'multi',workbenchTask:'workbench-1',matrixTask:'matrix-1',enterpriseProjectId:'project-1',operatorOwnerId:'owner-1'});
 expect(cartLink.searchParams.has('task')).toBe(false);
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(true));
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}));
 await waitFor(()=>expect(mediaGateway.updateDraftMedia).toHaveBeenCalledWith('draft-1',[],1));
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(false));
 expect(mediaGateway.createDraft).toHaveBeenCalledTimes(1);
});

it('opens the layer multi-select with every layer media checked and only adds kept checks',async()=>{
 liveDirectory();const owner=flow();
 mediaGateway.createDraft.mockImplementation(async()=>{const saved=draft('draft-1',1,[media]);mediaGateway.getDraft.mockResolvedValue(saved);return saved;});
 openMatrix('articleVersion=version-1&mode=multi',owner);
 fireEvent.click(await screen.findByRole('button',{name:'多选本层可投媒体'}));
 const check=await screen.findByRole('checkbox',{name:'加入 可投媒体'});
 expect((check as HTMLInputElement).checked).toBe(true); // 默认全部勾选
 expect(screen.getByText(/已勾选 1 项/)).toBeTruthy();
 fireEvent.click(check); // 可以取消勾选
 await waitFor(()=>expect((check as HTMLInputElement).checked).toBe(false));
 expect((screen.getByRole('button',{name:'确认应用差异'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(check); // 重新勾选后确认
 await waitFor(()=>expect((check as HTMLInputElement).checked).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:'确认应用差异'}));
 await waitFor(()=>expect(mediaGateway.createDraft).toHaveBeenCalledWith('version-1',[media.id],expect.stringMatching(/^publisher:draft:/),'per_media'));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('draftId')).toBe('draft-1'));
});

it('treats a freshly loaded task with saved combinations as current instead of demanding regeneration',async()=>{
 liveDirectory();
 const loaded:ContentPlan={schema_version:'recommendation/1.0',recommendation_id:'recommendation-loaded',kind:'recommendation',strategy:'行业组合',reason_summary:'按当前要求生成',explanation:null,items:[{candidate_id:'candidate-1',resource_id:'external-1',offer_id:'quote-1',publication_spec:'text',quantity:2,quantity_mode:'new_articles',content_tasks:['补充事实依据'],purpose:'standard',unit_price:'100.00',base_cost:'200.00',cost:'200.00',known_cost:'200.00',pricing_status:'priced'}],total_articles:2,currency:'CNY',known_total_cost:'200.00',total_cost:'200.00',total_remaining:'800.00',total_cap:'1000.00',budget_feasible:true,ready_to_publish:false,execution_recommended:false,unknown_items:[],errors:[]};
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);if(url.includes('/classify/matrix-1'))return Promise.resolve({ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,plan_version:'plan-loaded',recommendations:[loaded],content_plans:[]}})});return base(input,init);});
 openMatrix('draftId=draft-1&articleVersion=version-1');
 // 载入即登记当前输入为组合基线：输入稳定后篇数可直接编辑，不再误报“请更新组合”。
 const quantity=await screen.findByLabelText('可投媒体建议篇数');
 await waitFor(()=>expect((quantity as HTMLInputElement).disabled).toBe(false),{timeout:5000});
 expect(screen.queryByText('投放要求、预算或资源选择已变化，请更新组合。')).toBeNull();
},10000);

it('lists generation history and opens an archived task',async()=>{
 liveDirectory();
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);if(url.includes('/classify/history'))return Promise.resolve({ok:true,json:async()=>({items:[{task_id:'history-2',created_at:'2026-11-10T08:00:00.000Z',state:'complete',industry:'净水器',product:'测试产品',matrix_status:'complete',candidate_count:26,recommendation_count:3}]})});return base(input,init);});
 openMatrix('draftId=draft-1&articleVersion=version-1');
 fireEvent.click(await screen.findByRole('button',{name:'历史记录'}));
 (screen.getByRole('button',{name:'历史记录'}) as HTMLButtonElement).click();
 await screen.findByText('净水器',{selector:'strong'});
 expect(screen.getByText(/26 候选 · 3 组组合/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'查看'}));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('task')).toBe('history-2'));
});
it('keeps the first matrix selection when the host assigns its task ID during ensureTask',async()=>{
 liveDirectory();const owner=flow();
 mediaGateway.createDraft.mockImplementation(async()=>{const saved=draft('draft-1',1,[media]);mediaGateway.getDraft.mockResolvedValue(saved);return saved;});
 function AssigningHost(){
  const [taskId,setTaskId]=useState<string>();
  const current:PublishingFlow={...owner,taskId,ensureTask:async()=>{setTaskId('created-task');await Promise.resolve();return 'created-task';}};
  return <PublishingFlowProvider value={current}><div className="monitoring-module"><SourceMatrixPage view="matrix"/></div></PublishingFlowProvider>;
 }
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&task=matrix-1&articleVersion=version-1&mode=multi');
 render(<AssigningHost/>);
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));fireEvent.click(checkbox);
 await waitFor(()=>expect(mediaGateway.createDraft).toHaveBeenCalledWith('version-1',[media.id],expect.stringMatching(/^publisher:draft:/),'per_media'));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('draftId')).toBe('draft-1'));
 expect(new URLSearchParams(window.location.search).get('workbenchTask')).toBe('created-task');
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(true));
 expect(mediaGateway.createDraft).toHaveBeenCalledTimes(1);
});

it('preserves a failed draft binding, exposes retry, and never creates a replacement draft',async()=>{
 liveDirectory();mediaGateway.getDraft.mockRejectedValueOnce(new Error('原草稿暂不可用')).mockResolvedValue(draft());
 openMatrix('draftId=draft-1&articleVersion=version-1&mode=multi');
 await screen.findByRole('button',{name:'重试读取稿件上下文'});
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 expect((checkbox as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(checkbox);expect(mediaGateway.createDraft).not.toHaveBeenCalled();expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'重试读取稿件上下文'}));
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).disabled).toBe(false));
 expect(mediaGateway.getDraft).toHaveBeenCalledTimes(2);
 expect(mediaGateway.getArticleVersion).not.toHaveBeenCalled();
});

it('blocks unknown frozen versions and legitimate image restrictions without creating drafts',async()=>{
 liveDirectory();mediaGateway.getArticleVersion.mockRejectedValueOnce(new Error('冻结版本读取失败')).mockResolvedValue({id:'version-1',version:1,frozen:true,containsImages:true});
 mediaGateway.listMedia.mockResolvedValue({items:[{...media,capability:'text'}],total:1,page:1,pageSize:100,exactResourceLookupVersion:1,catalog:{activeRevision:'catalog-1'}});
 openMatrix('articleVersion=version-1');
 await screen.findByRole('button',{name:'重试读取稿件上下文'});
 expect((await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'重试读取稿件上下文'}));
 await screen.findByText('当前稿件含图片，此媒体明确不支持图片');
 expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).disabled).toBe(true);
 expect(mediaGateway.createDraft).not.toHaveBeenCalled();
});

it('selects unknown image capability for an image version and removes it from the same saved matrix cart',async()=>{
 liveDirectory();const owner=flow();const pending={...media,capability:'image_pending' as const};
 mediaGateway.getArticleVersion.mockResolvedValue({id:'version-1',version:1,hash:'hash-1',frozen:true,containsImages:true});
 mediaGateway.listMedia.mockResolvedValue({items:[pending],total:1,page:1,pageSize:100,exactResourceLookupVersion:1,catalog:{activeRevision:'catalog-1'}});
 mediaGateway.createDraft.mockImplementation(async()=>{const saved={...draft('draft-1',1,[pending]),articleContainsImages:true};mediaGateway.getDraft.mockResolvedValue(saved);return saved;});
 mediaGateway.updateDraftMedia.mockResolvedValue({...draft('draft-1',2,[]),articleContainsImages:true});
 openMatrix('articleVersion=version-1&mode=multi',owner);
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));
 fireEvent.click(checkbox);
 await waitFor(()=>expect(mediaGateway.createDraft).toHaveBeenCalledWith('version-1',[pending.id],expect.stringMatching(/^publisher:draft:/),'per_media'));
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(true));
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).disabled).toBe(false));
 expect(pending.capability).toBe('image_pending');
 fireEvent.click(screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}));
 await waitFor(()=>expect(mediaGateway.updateDraftMedia).toHaveBeenCalledWith('draft-1',[],1));
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(false));
});

it('ignores an old draft update after changing the bound draft',async()=>{
 liveDirectory();let resolveUpdate!:(value:PublicationDraft)=>void;
 mediaGateway.updateDraftMedia.mockImplementation(()=>new Promise<PublicationDraft>(resolve=>{resolveUpdate=resolve;}));
 mediaGateway.getDraft.mockImplementation(async(id:string)=>draft(id));
 openMatrix('draftId=draft-1&articleVersion=version-1');
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));fireEvent.click(checkbox);
 await waitFor(()=>expect(mediaGateway.updateDraftMedia).toHaveBeenCalledWith('draft-1',[media.id],1));
 await act(async()=>{window.history.pushState({},'', '/publishing/source-matrix?tab=matrix&task=matrix-1&draftId=draft-2&articleVersion=version-1');window.dispatchEvent(new PopStateEvent('popstate'));});
 await waitFor(()=>expect(mediaGateway.getDraft).toHaveBeenCalledWith('draft-2',expect.any(AbortSignal)));
 await act(async()=>resolveUpdate(draft('draft-1',2,[media])));
 // 同一冻结稿件版本换绑投放草稿不算需求变化：媒体保持可选；过期响应不得写入勾选。
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).disabled).toBe(false));
 expect(screen.queryByText('需求已变化，请更新矩阵。')).toBeNull();
 expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(false);
 expect((screen.getByText('完整购物车 →',{selector:'a'}) as HTMLAnchorElement).pathname).toBe('/publishing/drafts/draft-2/media/cart');
});

it('keeps a rejected first selection unchecked and permits a real retry',async()=>{
 liveDirectory();mediaGateway.createDraft.mockRejectedValueOnce(new Error('Media title is invalid')).mockImplementation(async()=>{const saved=draft('draft-1',1,[media]);mediaGateway.getDraft.mockResolvedValue(saved);return saved;});
 openMatrix('articleVersion=version-1&mode=multi');
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));fireEvent.click(checkbox);
 await screen.findByText(/稿件标题超过所选媒体的字数上限/);
 expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(false);
 expect(new URLSearchParams(window.location.search).has('draftId')).toBe(false);
 fireEvent.click(screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('draftId')).toBe('draft-1'));
 expect(mediaGateway.createDraft).toHaveBeenCalledTimes(2);
});

it('retains the saved draft when task association fails and retries the association without creating another draft',async()=>{
 liveDirectory();const owner=flow();owner.record=vi.fn().mockRejectedValueOnce(new Error('任务暂不可用')).mockResolvedValue(undefined);
 mediaGateway.createDraft.mockImplementation(async()=>{const saved=draft('draft-1',1,[media]);mediaGateway.getDraft.mockResolvedValue(saved);return saved;});
 openMatrix('articleVersion=version-1&workbenchTask=workbench-1',owner);
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));fireEvent.click(checkbox);
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('draftId')).toBe('draft-1'));
 const retry=await screen.findByRole('button',{name:'重试关联当前投放草稿'});fireEvent.click(retry);
 await screen.findByText('投放草稿已重新关联到当前任务。');
 expect(owner.record).toHaveBeenCalledTimes(2);expect(mediaGateway.createDraft).toHaveBeenCalledTimes(1);
 expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(true);
});

it('reconstructs the association retry from the verified draft after refreshing the matrix page',async()=>{
 liveDirectory();const owner=flow();owner.record=vi.fn().mockRejectedValueOnce(new Error('任务暂不可用')).mockResolvedValue(undefined);
 mediaGateway.createDraft.mockImplementation(async()=>{const saved=draft('draft-1',1,[media]);mediaGateway.getDraft.mockResolvedValue(saved);return saved;});
 const first=openMatrix('articleVersion=version-1&workbenchTask=workbench-1',owner);
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));fireEvent.click(checkbox);
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('draftId')).toBe('draft-1'));
 first.unmount();
 openMatrix('draftId=draft-1&articleVersion=version-1&workbenchTask=workbench-1',owner);
 const retry=await screen.findByRole('button',{name:'重试关联当前投放草稿'});
 fireEvent.click(retry);
 await screen.findByText('投放草稿已重新关联到当前任务。');
 expect(owner.record).toHaveBeenLastCalledWith({id:'media-draft:draft-1',label:'已保存媒体选择',resources:[{kind:'article_version',id:'version-1'},{kind:'publication_draft',id:'draft-1'}]});
 expect(mediaGateway.createDraft).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('button',{name:'重试关联当前投放草稿'})).toBeNull();
});

it('does not navigate back to the saved draft if the user leaves while task association is pending',async()=>{
 liveDirectory();const owner=flow();let resolveRecord!:()=>void;
 owner.record=vi.fn(()=>new Promise<void>(resolve=>{resolveRecord=resolve;}));
 mediaGateway.createDraft.mockResolvedValue(draft('draft-1',1,[media]));
 const view=openMatrix('articleVersion=version-1&workbenchTask=workbench-1',owner);
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));fireEvent.click(checkbox);
 await waitFor(()=>expect(owner.record).toHaveBeenCalledTimes(1));
 view.unmount();window.history.replaceState({},'', '/publishing/articles');
 await act(async()=>resolveRecord());
 expect(window.location.pathname).toBe('/publishing/articles');expect(window.location.search).toBe('');
 expect(mediaGateway.createDraft).toHaveBeenCalledTimes(1);
});

it('allows removal of a selected media at the selection cap',async()=>{
 liveDirectory();const extras=Array.from({length:19},(_,i)=>({...media,id:'extra-'+i}));
 mediaGateway.getDraft.mockResolvedValue(draft('draft-1',1,[media,...extras]));
 mediaGateway.updateDraftMedia.mockResolvedValue(draft('draft-1',2,extras));
 openMatrix('draftId=draft-1&articleVersion=version-1');
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).checked).toBe(true));expect((checkbox as HTMLInputElement).disabled).toBe(false);
 fireEvent.click(checkbox);
 await waitFor(()=>expect(mediaGateway.updateDraftMedia).toHaveBeenCalledWith('draft-1',extras.map(item=>item.id),1));
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(false));
});

it('blocks additions at twenty media without disabling legitimate removal elsewhere',async()=>{
 liveDirectory();const extras=Array.from({length:20},(_,i)=>({...media,id:'extra-'+i}));
 mediaGateway.getDraft.mockResolvedValue(draft('draft-1',1,extras));
 openMatrix('draftId=draft-1&articleVersion=version-1');
 await screen.findByText('一次最多选择 20 家媒体');
 const checkbox=screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'});
 expect((checkbox as HTMLInputElement).disabled).toBe(true);fireEvent.click(checkbox);
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();expect(mediaGateway.createDraft).not.toHaveBeenCalled();
});

it('retries the same failed media mapping without discarding the draft context',async()=>{
 liveDirectory();mediaGateway.listMedia.mockRejectedValueOnce(new Error('媒体映射暂不可用')).mockResolvedValue({items:[media],total:1,page:1,pageSize:100,exactResourceLookupVersion:1,catalog:{activeRevision:'catalog-1'}});
 openMatrix('draftId=draft-1&articleVersion=version-1&mode=multi');
 fireEvent.click(await screen.findByRole('button',{name:'重试读取媒体映射'}));
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));
 expect(mediaGateway.listMedia).toHaveBeenCalledTimes(2);expect(mediaGateway.createDraft).not.toHaveBeenCalled();
 expect((screen.getByText('完整购物车 →',{selector:'a'}) as HTMLAnchorElement).pathname).toBe('/publishing/drafts/draft-1/media/cart');
});

it('does not replace a draft belonging to a different frozen version',async()=>{
 liveDirectory();mediaGateway.getDraft.mockResolvedValue({...draft(),articleVersionId:'different-version'});
 openMatrix('draftId=draft-1&articleVersion=version-1');
 await screen.findByRole('button',{name:'重试读取稿件上下文'});
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 expect((checkbox as HTMLInputElement).disabled).toBe(true);expect(mediaGateway.createDraft).not.toHaveBeenCalled();
 expect(mediaGateway.getArticleVersion).not.toHaveBeenCalled();
});

it('shows the current independent research cart read-only and links back to its shared cart',async()=>{
 liveDirectory();const owner=flow();owner.resources=[];owner.selections={mediaSelection:[media,{...media,id:'media-2',priceTenThousandths:'2000000'},null,{id:'invalid',priceTenThousandths:7}]};
 openMatrix('workbenchTask=workbench-1',owner);
 await screen.findByText(/购物车 2 家/);
 const cartLink=screen.getByText('完整购物车 →',{selector:'a'});
 const url=new URL((cartLink as HTMLAnchorElement).href);
 expect(url.pathname).toBe('/publishing/media/cart');expect(url.searchParams.get('workbenchTask')).toBe('workbench-1');expect(url.searchParams.get('matrixTask')).toBe('matrix-1');
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 expect((checkbox as HTMLInputElement).checked).toBe(true);expect((checkbox as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(checkbox);
 expect(mediaGateway.getDraft).not.toHaveBeenCalled();expect(mediaGateway.getArticleVersion).not.toHaveBeenCalled();expect(mediaGateway.createDraft).not.toHaveBeenCalled();expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
});

// These regressions are delivered as source and have not been executed in this task.
it('retains the complete matrix across budget-only responses and invalidates plans after a budget edit',async()=>{
 liveDirectory();
 const offerPlan={strategy:'保守覆盖',reason_summary:'费用与适配分别判断',status:'complete',currency:'CNY',total_cost:'100.00',exploration_cost:'0.00',known_total_cost:'100.00',total_cap:'200.00',total_remaining:'100.00',exploration_remaining:'0.00',budget_feasible:true,manuscript_status:'needs_manuscript_check',ready_to_publish:false,execution_recommended:false,is_estimate:false,unknown_items:[],items:[{candidate_id:'candidate-1',resource_id:'external-1',article_id:'article-1',version:'1',quantity:1,purpose:'standard',offer_id:'quote-1'}],errors:[],semantic_pending:[]};
 // 生成请求会把表单值回显进任务（真实服务行为），水合后输入与任务一致，链式预算才会自动触发
 const echoedTask={...matrix,scope:{...matrix.scope,task:{...matrix.scope.task,industry:'软件测试',questions:[{question_id:'question-0',text:'软件测试公司怎么选'}]}}};
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/budget'))return {ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,matrix:{...matrix.matrix,candidates:[{...matrix.matrix.candidates[0],reason_summary:'不得覆盖原矩阵的预算理由'}]},budget_plans:[offerPlan]}})};
  return base(input,init);
 });
 openMatrix('draftId=draft-1&articleVersion=version-1');
 await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((screen.getByRole('button',{name:/生成组合|更新组合/}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'200'}});
 fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 await screen.findByRole('heading',{name:/保守覆盖/});
 expect(screen.queryByText('不得覆盖原矩阵的预算理由')).toBeNull();
 expect(screen.getByRole('heading',{name:'权威参考层'})).toBeTruthy();expect(screen.getByRole('heading',{name:'探索验证层'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'150'}});
 expect(screen.queryByText('投放要求、预算或资源选择已变化，请更新组合。')).toBeNull();
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
});

it('discards obsolete combinations but reuses the saved revision after a budget edit during generation',async()=>{
 liveDirectory();let finish!:(response:unknown)=>void;const bodies:Array<{plan_version:string;budget:{total_cap:string}}>=[];
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{if(!String(input).endsWith('/budget'))return base(input,init);bodies.push(JSON.parse(String(init?.body)));return bodies.length===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,plan_version:'saved-current-budget'}})});});
 openMatrix('draftId=draft-1&articleVersion=version-1');
 await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((screen.getByRole('button',{name:/生成组合|更新组合/}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'200'}});fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'300'}});
 await act(async()=>finish({ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,plan_version:'saved-obsolete-budget',matrix:{...matrix.matrix,candidates:[{...matrix.matrix.candidates[0],attributes:{source_name:'过期响应媒体'}}]},budget_plans:[{strategy:'过期正式组合'}],content_plans:[{strategy:'过期内容组合'}]}})}));
 await screen.findByText('预算、需求或媒体选择已变化，先前组合未应用。请重新生成组合。');
 expect(screen.queryByText('过期响应媒体')).toBeNull();expect((screen.getByLabelText('总预算（CNY）') as HTMLInputElement).value).toBe('300');
 expect(screen.queryByText('过期正式组合')).toBeNull();expect(screen.queryByText('过期内容组合')).toBeNull();
 expect(screen.queryByRole('link',{name:'导出当前版本'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 await waitFor(()=>expect(bodies[1]).toMatchObject({plan_version:'saved-obsolete-budget',budget:{total_cap:'300'}}));
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
});

it('keeps the cart footer on the distribution tab without discarding selected media',async()=>{
 liveDirectory();mediaGateway.getDraft.mockResolvedValue(draft('draft-1',1,[media]));
 window.history.replaceState({},'', '/publishing/source-matrix?tab=analysis&task=matrix-1&draftId=draft-1&articleVersion=version-1');
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByText(/购物车 1 家/);expect(screen.getByText('真实行业分布')).toBeTruthy();
 expect(screen.getByRole('button',{name:/配置标题/})).toBeTruthy();expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
});

it.each([
 ['analysis','single'],['analysis','per_media'],['matrix','single'],['matrix','per_media'],
] as const)('opens titles from the %s cart for %s mode without writing or submitting',async(tab,titleMode)=>{
 liveDirectory();mediaGateway.getDraft.mockResolvedValue({...draft('draft-1',1,[media]),titleMode,sharedTitle:'当前稿件'});
 window.history.replaceState({},'',`/publishing/source-matrix?tab=${tab}&task=matrix-1&draftId=draft-1&articleVersion=version-1&workbenchTask=workbench-1&enterpriseProjectId=project-1#selection`);
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 const next=await screen.findByRole('button',{name:/配置标题/});
 await waitFor(()=>expect((next as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(next);
 await waitFor(()=>expect(window.location.pathname).toBe('/publishing/drafts/draft-1/titles'));
 const params=new URLSearchParams(window.location.search);
 expect(params.get('articleVersion')).toBe('version-1');expect(params.get('workbenchTask')).toBe('workbench-1');
 expect(params.get('matrixTask')).toBe('matrix-1');expect(params.get('enterpriseProjectId')).toBe('project-1');
 expect(window.location.hash).toBe('#selection');expect(params.has('task')).toBe(false);
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();expect(mediaGateway.createDraft).not.toHaveBeenCalled();
});

it('hands off the complete matrix batch and exclusions to titles without adding stale task resources',async()=>{
 liveDirectory();const owner=flow();
 const first=draft('draft-1',1,[media]),second={...draft('draft-2',1,[media]),articleId:'article-2',articleVersionId:'version-2'};
 owner.resources=[{kind:'article_version',id:'version-1'},{kind:'article_version',id:'version-2'},{kind:'publication_draft',id:'draft-1'},{kind:'publication_draft',id:'draft-2'},{kind:'publication_draft',id:'stale-draft'}];
 owner.records=[{id:'media-draft:draft-1',label:'已保存',status:'completed',timestamp:1}];
 mediaGateway.getDraft.mockImplementation(async(id:string)=>id==='draft-1'?first:id==='draft-2'?second:Promise.reject(new Error('不应恢复旧稿')));
 openMatrix('draftId=draft-1&articleVersion=version-1&mode=batch&batchDraft=draft-1&batchDraft=draft-2&batchArticleVersion=version-1&batchArticleVersion=version-2&excludedDraft=draft-2&workbenchTask=workbench-1',owner);
 const next=await screen.findByRole('button',{name:/配置标题/});await waitFor(()=>expect((next as HTMLButtonElement).disabled).toBe(false));fireEvent.click(next);
 await waitFor(()=>expect(owner.handoff).toHaveBeenCalledTimes(1));
 const handoff=vi.mocked(owner.handoff).mock.calls[0]![0];const route=new URL(handoff.route,window.location.origin);
 expect(route.pathname).toBe('/publishing/drafts/draft-1/titles');
 expect(route.searchParams.getAll('batchDraft')).toEqual(['draft-1','draft-2']);expect(route.searchParams.getAll('excludedDraft')).toEqual(['draft-2']);
 expect(route.searchParams.getAll('batchArticleVersion')).toEqual(['version-1','version-2']);
 expect(handoff.resources.filter(resource=>resource.kind==='publication_draft').map(resource=>resource.id)).toEqual(['draft-1','draft-2']);
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();expect(mediaGateway.createDraft).not.toHaveBeenCalled();
});

it('stays in the matrix after a failed title handoff and allows an explicit retry',async()=>{
 liveDirectory();mediaGateway.getDraft.mockResolvedValue(draft('draft-1',1,[media]));
 openMatrix('draftId=draft-1&articleVersion=version-1');
 const next=await screen.findByRole('button',{name:/配置标题/});await waitFor(()=>expect((next as HTMLButtonElement).disabled).toBe(false));
 mediaGateway.getDraft.mockRejectedValueOnce(new Error('草稿暂不可读取'));
 fireEvent.click(next);await screen.findByText('草稿暂不可读取');
 expect(window.location.pathname).toBe('/publishing/source-matrix');
 await waitFor(()=>expect((next as HTMLButtonElement).disabled).toBe(false));fireEvent.click(next);
 await waitFor(()=>expect(window.location.pathname).toBe('/publishing/drafts/draft-1/titles'));
});

it('ignores an unpersisted running ACK but adopts its later authoritative revision even after a budget edit',async()=>{
 liveDirectory();let started=false,requests=0,finish!:(response:unknown)=>void;const sentVersions:string[]=[];
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/budget')){requests++;sentVersions.push(JSON.parse(String(init?.body)).plan_version);if(requests===1){started=true;return Promise.resolve({ok:true,json:async()=>({task_id:'matrix-1',state:'running',result:{...matrix,plan_version:'unpersisted-ack-version'}})});}return Promise.resolve({ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:matrix})});}
  if(started&&String(input).includes('/classify/matrix-1'))return new Promise(resolve=>{finish=resolve;});
  return base(input,init);
 });
 openMatrix('draftId=draft-1&articleVersion=version-1');await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((screen.getByRole('button',{name:/生成组合|更新组合/}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'200'}});fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 await waitFor(()=>expect(typeof finish).toBe('function'));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'300'}});
 await act(async()=>finish({ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,plan_version:'saved-new-budget-version'}})}));
 await screen.findByText('预算、需求或媒体选择已变化，先前组合未应用。请重新生成组合。');
 fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 await waitFor(()=>expect(sentVersions).toEqual(['plan-version-1','saved-new-budget-version']));
});

it('retains semantic edits and blocks budget generation when an old budget terminal response arrives',async()=>{
 liveDirectory();let finish!:(response:unknown)=>void;
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>String(input).endsWith('/budget')?new Promise(resolve=>{finish=resolve;}):base(input,init));
 openMatrix('draftId=draft-1&articleVersion=version-1');await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((screen.getByRole('button',{name:/生成组合|更新组合/}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'200'}});fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 fireEvent.change(screen.getByLabelText('目标问题 / 内容需求 *'),{target:{value:'改变后的业务问题'}});
 await act(async()=>finish({ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,plan_version:'saved-before-semantic-edit'}})}));
 await screen.findByText('预算、需求或媒体选择已变化，先前组合未应用。请重新生成组合。');
 expect((screen.getByLabelText('目标问题 / 内容需求 *') as HTMLTextAreaElement).value).toBe('改变后的业务问题');
 expect((screen.getByRole('button',{name:/生成组合|更新组合/}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText('内容已更新，请重新生成。')).toBeTruthy();
});

it('shows a retryable budget failure and retries using its saved revision without regenerating the matrix',async()=>{
 liveDirectory();const versions:string[]=[];
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{
  if(!String(input).endsWith('/budget'))return base(input,init);
  versions.push(JSON.parse(String(init?.body)).plan_version);
  const result=versions.length===1?{...matrix,status:'invalid_decisions',retryable_budget:true,plan_version:'saved-retryable-budget',errors:[{code:'invalid_content_quantity',path:'content_plans',message:'篇数建议未通过核验'}]}:{...matrix,plan_version:'successful-retry'};
  return Promise.resolve({ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result})});
 });
 openMatrix('draftId=draft-1&articleVersion=version-1');await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((screen.getByRole('button',{name:/生成组合|更新组合/}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'200'}});fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 await screen.findByText('组合生成未通过复核，请调整条件后重试：篇数建议未通过核验');
 expect(screen.queryByRole('link',{name:'导出当前版本'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 await waitFor(()=>expect(versions).toEqual(['plan-version-1','saved-retryable-budget']));
 expect(fetcher.mock.calls.some(call=>String(call[0]).endsWith('/matrix/generate'))).toBe(false);
});

it('does not let an old cancellation clear a newly opened matrix task',async()=>{
 liveDirectory();let finish!:(response:unknown)=>void;
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/cancel'))return new Promise(resolve=>{finish=resolve;});
  if(url.includes('/classify/matrix-1'))return Promise.resolve({ok:true,json:async()=>({task_id:'matrix-1',state:'running',result:matrix})});
  if(url.includes('/classify/matrix-2'))return Promise.resolve({ok:true,json:async()=>({task_id:'matrix-2',state:'complete',result:{...matrix,matrix_version:'matrix-task-two',matrix:{...matrix.matrix,candidates:[{...matrix.matrix.candidates[0],resource_id:null,attributes:{source_name:'任务二研究媒体'}}]}}})});
  return base(input,init);
 });
 openMatrix('draftId=draft-1&articleVersion=version-1');fireEvent.click(await screen.findByRole('button',{name:'取消生成'}));
 await waitFor(()=>expect(typeof finish).toBe('function'));
 await act(async()=>{window.history.pushState({},'', '/publishing/source-matrix?tab=matrix&task=matrix-2&draftId=draft-1&articleVersion=version-1');window.dispatchEvent(new PopStateEvent('popstate'));});
 await screen.findByRole('heading',{name:'任务二研究媒体'});
 await act(async()=>finish({ok:true,json:async()=>({task_id:'matrix-1',state:'cancelled'})}));
 expect(screen.getByRole('heading',{name:'任务二研究媒体'})).toBeTruthy();expect(screen.queryByText('等待生成矩阵')).toBeNull();
});

it('removes the heading export entry while the download helper still pins the displayed plan',async()=>{
 liveDirectory();openMatrix('draftId=draft-1&articleVersion=version-1');
 await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 expect(screen.queryByRole('link',{name:'导出当前版本'})).toBeNull();
 expect(screen.getByRole('button',{name:'查看报告'})).toBeTruthy();
 expect(downloadUrl('matrix-1',matrix.plan_id,matrix.plan_version)).toBe(`/api/modules/publish/classify/matrix-1/download?plan_id=${matrix.plan_id}&plan_version=${matrix.plan_version}`);
 expect(downloadUrl('legacy-task')).toBe('/api/modules/publish/classify/legacy-task/download');
});

it('applies a server-verified budget plan into the shared cart with preview, refresh and no mediaIds overwrite',async()=>{
 liveDirectory();
 const offerPlan={strategy:'保守覆盖',reason_summary:'费用与适配分别判断',status:'complete',currency:'CNY',total_cost:'100.00',exploration_cost:'0.00',known_total_cost:'100.00',total_cap:'200.00',total_remaining:'100.00',exploration_remaining:'0.00',budget_feasible:true,manuscript_status:'needs_manuscript_check',ready_to_publish:false,execution_recommended:false,is_estimate:false,unknown_items:[],items:[{candidate_id:'candidate-1',resource_id:'external-1',article_id:'article-1',version:'1',quantity:1,purpose:'standard',offer_id:'quote-1'}],errors:[],semantic_pending:[]};
 const applyDiff={status:'ok',task_id:'matrix-1',plan_index:0,draft:{id:'draft-1',revision:2},additions:[{mediaResourceId:'media-1',name:'可投媒体',externalResourceId:'external-1',priceTenThousandths:'1000000',totalPriceTenThousandths:'1000000',quantity:1,offerId:'quote-1',publicationSpec:null,purpose:'standard',reason:'命中目标问题'}],alreadySelected:[],skipped:[],overLimit:false,mergedCount:1,knownTotalTenThousandths:'1000000',pendingPriced:0};
 const applyBodies:unknown[]=[];
 // 生成请求会把表单值回显进任务（真实服务行为），水合后输入与任务一致，链式预算才会自动触发
 const echoedTask={...matrix,scope:{...matrix.scope,task:{...matrix.scope.task,industry:'软件测试',questions:[{question_id:'question-0',text:'软件测试公司怎么选'}]}}};
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/budget'))return {ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,budget_plans:[offerPlan]}})};
  if(url.endsWith('/apply-plan')){applyBodies.push(JSON.parse(String(init?.body)));return {ok:true,json:async()=>applyDiff};}
  return base(input,init);
 });
 mediaGateway.getDraft.mockResolvedValue(draft('draft-1',1));
 mediaGateway.getDraft.mockResolvedValueOnce(draft('draft-1',1)).mockResolvedValueOnce(draft('draft-1',2,[media]));
 openMatrix('draftId=draft-1&articleVersion=version-1');
 await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect(mediaGateway.getDraft).toHaveBeenCalled(), { timeout: 30000 });
 await waitFor(()=>expect(screen.queryByText(/正在读取稿件上下文/)).toBeNull(), { timeout: 30000 });
 await waitFor(()=>expect((screen.getByRole('button',{name:/生成组合|更新组合/}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'200'}});
 fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 const apply=await screen.findByRole('button',{name:'加入本组合'},{timeout:45000});
 await waitFor(()=>expect((apply as HTMLButtonElement).disabled).toBe(false), { timeout: 45000 });
 fireEvent.click(apply);
 await screen.findByText((_, element) => element?.tagName === 'STRONG' && element.textContent === '新增 · 1 篇 · ¥100.00', undefined, { timeout: 45000 });
 fireEvent.click(screen.getByRole('button',{name:'确认应用差异'}));
 await screen.findByText(/已加入组合：新增 1 项/);
 expect(applyBodies).toHaveLength(2);
 expect(applyBodies[0]).toMatchObject({plan_index:0,draft_id:'draft-1',article_version_id:'version-1',expected_revision:1,preview:true});
 expect(applyBodies[1]).toMatchObject({preview:false});
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
 expect(mediaGateway.getDraft).toHaveBeenLastCalledWith('draft-1');
}, 60000);

it('keeps the cart untouched and surfaces guidance when the server reports a stale binding during apply',async()=>{
 liveDirectory();
 const offerPlan={strategy:'保守覆盖',reason_summary:'费用与适配分别判断',status:'complete',currency:'CNY',total_cost:'100.00',exploration_cost:'0.00',known_total_cost:'100.00',total_cap:'200.00',total_remaining:'100.00',exploration_remaining:'0.00',budget_feasible:true,manuscript_status:'needs_manuscript_check',ready_to_publish:false,execution_recommended:false,is_estimate:false,unknown_items:[],items:[{candidate_id:'candidate-1',resource_id:'external-1',article_id:'article-1',version:'1',quantity:1,purpose:'standard',offer_id:'quote-1'}],errors:[],semantic_pending:[]};
 // 生成请求会把表单值回显进任务（真实服务行为），水合后输入与任务一致，链式预算才会自动触发
 const echoedTask={...matrix,scope:{...matrix.scope,task:{...matrix.scope.task,industry:'软件测试',questions:[{question_id:'question-0',text:'软件测试公司怎么选'}]}}};
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/budget'))return {ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,budget_plans:[offerPlan]}})};
  if(url.endsWith('/apply-plan'))return {ok:false,json:async()=>({status:'stale_binding',message:'绑定稿件、冻结版本或已选媒体已变化，请重新生成矩阵和组合'})};
  return base(input,init);
 });
 openMatrix('draftId=draft-1&articleVersion=version-1');
 await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((screen.getByRole('button',{name:/生成组合|更新组合/}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'200'}});
 fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 await waitFor(()=>expect(mediaGateway.getDraft).toHaveBeenCalled(), { timeout: 30000 });
 await waitFor(()=>expect(screen.queryByText(/正在读取稿件上下文/)).toBeNull(), { timeout: 30000 });
 const staleButton=await screen.findByRole('button',{name:'加入本组合'},{timeout:45000});
 await waitFor(()=>expect((staleButton as HTMLButtonElement).disabled).toBe(false), { timeout: 45000 });
 fireEvent.click(staleButton); await screen.findByText('绑定稿件、冻结版本或已选媒体已变化，请重新生成矩阵和组合', {}, { timeout: 30000 });
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
 expect(mediaGateway.getDraft).toHaveBeenCalledTimes(2);
}, 60000);

it('one click generates an independent target platform task and automatically computes its explicit budget',async()=>{
 liveDirectory();
 const budgetBodies:unknown[]=[];
 const offerPlan={strategy:'保守覆盖',reason_summary:'费用与适配分别判断',status:'complete',currency:'CNY',total_cost:'100.00',exploration_cost:'0.00',known_total_cost:'100.00',total_cap:'3000.00',total_remaining:'2900.00',exploration_remaining:'0.00',budget_feasible:true,manuscript_status:'needs_manuscript_check',ready_to_publish:false,execution_recommended:false,is_estimate:false,unknown_items:[],items:[{candidate_id:'candidate-1',resource_id:'external-1',article_id:'article-1',version:'1',quantity:1,purpose:'standard',offer_id:'quote-1'}],errors:[],semantic_pending:[]};
 // 生成请求会把表单值回显进任务（真实服务行为），水合后输入与任务一致，链式预算才会自动触发
 const echoedTask={...matrix,scope:{...matrix.scope,task:{...matrix.scope.task,industry:'软件测试',target_platforms:['DeepSeek'],questions:[{question_id:'question-0',text:'软件测试公司怎么选'}]}}};
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/industries'))return {ok:true,json:async()=>canonicalCatalog([{id:'901',name:'软件测试'}],[{id:'sha256:639e43735887ff20852f99aa4bc643853259dbd7f44aba163598064720a60e0d',label:'一航软件样本',version:'v1',sourceFile:'一航软件-信源分析-20260913-214944.xlsx',recordCount:502,period:{start:'2026-09-07',end:'2026-09-13'},models:['百度文心-手机版']}])};
  if(url.endsWith('/matrix/generate')){const body=JSON.parse(String(init?.body));expect(body.target_platforms).toEqual(['DeepSeek']);expect(body.brand_data).toBeUndefined();expect(body.sample_platforms).toBeUndefined();return {ok:true,json:async()=>({task_id:'matrix-1',state:'running',result:echoedTask})};}
  if(url.endsWith('/budget')){budgetBodies.push(JSON.parse(String(init?.body)));return {ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...echoedTask,budget_plans:[offerPlan]}})};}
  if(url.includes('/classify/matrix-1'))return {ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:echoedTask})};
  return base(input,init);
 });
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&articleVersion=version-1');
 render(<div className="monitoring-module"><SourceMatrixPage view="matrix"/></div>);
 await screen.findByText('AI 识别暂未配置，可先手动填写。');
 await screen.findByRole('option',{name:'软件测试'});
 fireEvent.change(await screen.findByLabelText('目标行业 *'),{target:{value:'901'}});
 fireEvent.change(await screen.findByLabelText('目标问题 / 内容需求 *'),{target:{value:'软件测试公司怎么选'}});
 fireEvent.change(screen.getByLabelText('目标平台'),{target:{value:'DeepSeek'}});
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'3000'}});
 fireEvent.click(screen.getByRole('button',{name:'生成媒体渠道推荐'}));
 // 一次点击后自动串联：预算请求以同一矩阵快照和用户明确填写的预算 3000 发出。
 // 任务轮询要等稿件授权状态就绪（2 秒周期），断言需覆盖至少一个轮询周期。
 await waitFor(()=>expect(budgetBodies.length).toBeGreaterThanOrEqual(1),{timeout:30000});
 expect(budgetBodies[0]).toMatchObject({plan_id:'plan-1',plan_version:'plan-version-1',budget:{total_cap:'3000',currency:'CNY'}});
 await screen.findByRole('heading',{name:/保守覆盖/},{timeout:30000});
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
},60000);

it('shows the actual saved sample without configured services and never writes a sample into the cart',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{throw new Error('service unavailable');});vi.stubGlobal('fetch',fetcher);
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('button',{name:'重试读取行业'});
 expect(screen.getByRole('button',{name:'查看样本报告'})).toBeTruthy();
 expect((screen.getByLabelText('品牌 / 产品') as HTMLInputElement).value).toBe(matrixDemo.form.product);
 expect((screen.getByLabelText('期望发布时效') as HTMLSelectElement).value).toBe('');expect(screen.getByRole('button',{name:'覆盖地区'}).textContent).toContain('不限地区');expect((screen.getByLabelText('目标平台') as HTMLSelectElement).value).toBe('');
 expect((screen.getByLabelText('目标问题 / 内容需求 *') as HTMLTextAreaElement).value).toBe(matrixDemo.form.questions.join('\n'));
 expect(screen.getAllByRole('heading',{level:3}).filter(node=>/层$/.test(node.textContent??''))).toHaveLength(5);
 expect(document.querySelectorAll('[data-source-id]')).toHaveLength(matrixDemo.result.matrix.layers.reduce((sum,layer)=>sum+Math.min(3,layer.candidate_ids.length),0));
 for(const button of screen.queryAllByRole('button',{name:/更多候选/}))fireEvent.click(button);
 expect(document.querySelectorAll('[data-source-id]')).toHaveLength(matrixDemo.result.matrix.candidates.length);
 expect(screen.getAllByRole('button',{name:/^组合 [123]/})).toHaveLength(3);
 expect(screen.queryByRole('button',{name:'加入本组合'})).toBeNull();
 expect(screen.queryByRole('checkbox',{name:/^选择 /})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/^组合 2/}));
 // 用户反馈：组合成员不再有「当前组合」视觉标记（蓝色仅表示已加入购物车；demo 不可加入购物车）
 expect(document.querySelectorAll('.sm-candidate .sm-member')).toHaveLength(0);
 expect(document.querySelectorAll('.sm-candidate.is-highlighted')).toHaveLength(0);
 expect(mediaGateway.createDraft).not.toHaveBeenCalled();expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
 expect(fetcher.mock.calls.some(call=>String(call[0]).includes('/matrix/generate'))).toBe(false);
});

it('keeps the saved matrix unchanged on budget-only edits and distinguishes semantic edits',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>canonicalCatalog()})));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('button',{name:'重试读取行业'});
 const original=[...document.querySelectorAll('[data-source-id]')].map(node=>node.getAttribute('data-source-id'));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'5000'}});
 expect([...document.querySelectorAll('[data-source-id]')].map(node=>node.getAttribute('data-source-id'))).toEqual(original);
 expect(screen.getByText(/当前要求或预算与保存样本不同/)).toBeTruthy();
 expect(screen.queryByText(/投放要求已修改，下方保存矩阵/)).toBeNull();
 expect(screen.getByRole('button',{name:'按当前要求在线生成'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'更新组合'})).toBeNull();
 fireEvent.change(screen.getByLabelText('目标问题 / 内容需求 *'),{target:{value:'新的采购场景'}});
 expect(screen.getByText(/当前要求或预算与保存样本不同/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'查看样本报告'}));
 expect(screen.getByRole('heading',{name:'一航软件信源矩阵与研究组合'})).toBeTruthy();
 expect(screen.getByText(/保存条件下的历史对照/)).toBeTruthy();
 expect(screen.queryByRole('link',{name:'导出当前版本'})).toBeNull();
});

it('starts a new genuine task after editing the sample budget and never falls back to the sample on model failure',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 const bodies:Array<{url:string;body:Record<string,unknown>}>=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('/matrix/connection'))return {ok:true,json:async()=>({connection:null,mode:'environment',available:true})};
  if(url.endsWith('/industries'))return {ok:true,json:async()=>canonicalCatalog([{id:'901',name:matrixDemo.form.industry}],[{id:matrixDemo.form.brandDataBatchId,label:'一航软件样本',version:'verified-source',sourceFile:matrixDemo.source.file,recordCount:502,period:matrixDemo.source.period,models:matrixDemo.source.models}])};
  if(init?.method==='POST'){bodies.push({url,body:JSON.parse(String(init.body))});return {ok:false,json:async()=>({message:'模型尚未配置，请稍后重试'})};}
  return {ok:true,json:async()=>({})};
 }));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('option',{name:matrixDemo.form.industry});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'901'}});
 expect(screen.queryByText(/投放要求已修改，下方保存矩阵/)).toBeNull();
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'5000'}});
 fireEvent.click(screen.getByRole('button',{name:'按当前要求在线生成'}));
 await screen.findByText('模型尚未配置，请稍后重试');
 expect(bodies).toHaveLength(1);expect(bodies[0]!.url).toContain('/matrix/generate');
 expect(bodies[0]!.body).toMatchObject({industry_id:'901'});expect(bodies[0]!.body).not.toHaveProperty('brand_data');expect(bodies[0]!.body).not.toHaveProperty('sample_platforms');expect(bodies[0]!.body).not.toHaveProperty('target_platforms');
 expect(bodies[0]!.body).not.toHaveProperty('connection_mode');expect(bodies[0]!.body).not.toHaveProperty('connection_revision');
 expect(bodies[0]!.body).not.toHaveProperty('budget');expect(bodies[0]!.body).not.toHaveProperty('plan_id');
 expect(screen.queryByText('一航软件 · 已保存样本')).toBeNull();expect(screen.getByText('等待生成矩阵')).toBeTruthy();
 expect(mediaGateway.createDraft).not.toHaveBeenCalled();expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
});

it('hydrates a different task instead of mixing its result with the prefilled demo or previous task',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 const resultFor=(id:string):MatrixResult=>({...matrix,scope:{...matrix.scope,task:{...matrix.scope.task,industry:'已接入行业',product:'产品 '+id,audience:'受众 '+id,regions:['上海市'],hours:'48',target_platforms:id==='A'?['Kimi']:[],requirements:{links:true},brand:{batch_id:matrixDemo.form.brandDataBatchId,platforms:['百度文心-手机版']},questions:[{question_id:'q-'+id,text:'问题 '+id}]}}});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const url=String(input),id=url.endsWith('/task-B')?'B':'A';return {ok:true,json:async()=>url.endsWith('/industries')?canonicalCatalog([{id:'configured-industry',name:'已接入行业'}]):url.includes('/classify/')?{task_id:'task-'+id,state:'complete',result:resultFor(id)}:{items:[]}};}));
 mediaGateway.listMedia.mockResolvedValue({items:[],total:0,page:1,pageSize:100,exactResourceLookupVersion:1,catalog:{activeRevision:'catalog-1'}});
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('button',{name:'查看样本报告'});
 fireEvent.click(screen.getByRole('button',{name:'查看样本报告'}));
 for(const id of ['A','B','A']){
  await act(async()=>{window.history.pushState({},'', '/publishing/source-matrix?tab=matrix&task=task-'+id);window.dispatchEvent(new PopStateEvent('popstate'));});
  await waitFor(()=>expect((screen.getByLabelText('品牌 / 产品') as HTMLInputElement).value).toBe('产品 '+id));
  expect((screen.getByLabelText('目标问题 / 内容需求 *') as HTMLTextAreaElement).value).toBe('问题 '+id);
  expect((screen.getByLabelText('期望发布时效') as HTMLSelectElement).value).toBe('48');expect(screen.getByRole('option',{name:'原设置：48 小时'})).toBeTruthy();expect(screen.getByRole('button',{name:'覆盖地区'}).textContent).toContain('上海');
  expect((screen.getByLabelText('目标平台') as HTMLSelectElement).value).toBe(id==='A'?'Kimi':'');expect(screen.queryByLabelText('引用样本平台')).toBeNull();
  expect(screen.queryByRole('heading',{name:'一航软件信源矩阵与研究组合'})).toBeNull();
 }
 expect(screen.getByRole('button',{name:'取消选用历史样本'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'取消选用历史样本'}));
 expect(screen.queryByRole('button',{name:'取消选用历史样本'})).toBeNull();
 expect((screen.getByLabelText('目标平台') as HTMLSelectElement).value).toBe('Kimi');
 fireEvent.change(screen.getByLabelText('品牌 / 产品'),{target:{value:'未提交编辑'}});
 fireEvent.click(screen.getByRole('button',{name:'刷新结果'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'刷新结果'}) as HTMLButtonElement).disabled).toBe(false));
 expect((screen.getByLabelText('品牌 / 产品') as HTMLInputElement).value).toBe('未提交编辑');
});

it('does not send the automatic budget stage to another task after leaving a running generation',async()=>{
 liveDirectory();window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 const posts:string[]=[],taskResult=(name:string):MatrixResult=>({...matrix,scope:{...matrix.scope,task:{...matrix.scope.task,industry:matrixDemo.form.industry,product:name,questions:[{question_id:'q1',text:'当前问题'}]}}});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);if(init?.method==='POST')posts.push(url);
  if(url.includes('/matrix/connection'))return {ok:true,json:async()=>({connection:null,mode:'environment',available:true})};
  if(url.endsWith('/industries'))return {ok:true,json:async()=>canonicalCatalog([{id:'901',name:matrixDemo.form.industry}],[{id:matrixDemo.form.brandDataBatchId,label:'一航软件样本',version:'v1',recordCount:502,sourceFile:matrixDemo.source.file,period:matrixDemo.source.period,models:matrixDemo.source.models}])};
  if(url.endsWith('/matrix/generate')||url.endsWith('/task-A'))return {ok:true,json:async()=>({task_id:'task-A',state:'running',result:taskResult('正在生成的A')})};
  if(url.endsWith('/task-B'))return {ok:true,json:async()=>({task_id:'task-B',state:'complete',result:taskResult('已有任务B')})};
  return {ok:true,json:async()=>({items:[]})};
 }));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('option',{name:matrixDemo.form.industry});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'901'}});
 fireEvent.click(screen.getByRole('button',{name:'生成媒体渠道推荐'}));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('task')).toBe('task-A'));
 await act(async()=>{window.history.pushState({},'', '/publishing/source-matrix?tab=matrix&task=task-B');window.dispatchEvent(new PopStateEvent('popstate'));});
 await waitFor(()=>expect((screen.getByLabelText('品牌 / 产品') as HTMLInputElement).value).toBe('已有任务B'));
 expect(posts.filter(url=>url.endsWith('/budget'))).toEqual([]);
 expect(posts.filter(url=>url.endsWith('/matrix/generate'))).toHaveLength(1);
});

// Source-only platform/industry regressions; do not execute in this handoff workspace.
function platformFixture(task:MatrixResult=matrix,onGenerate?:(body:Record<string,unknown>)=>unknown|Promise<unknown>,rows=[{id:'industry-live',name:'真实行业'}]){
 mediaGateway.listMedia.mockResolvedValue({items:[],total:0,page:1,pageSize:100,exactResourceLookupVersion:1,catalog:{activeRevision:'catalog-1'}});
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/matrix/form-scope'))return {ok:true,json:async()=>({scopeKey:'a'.repeat(64)})};
  if(url.endsWith('/industries'))return {ok:true,json:async()=>canonicalCatalog(rows)};
  if(url.endsWith('/matrix/connection'))return {ok:true,json:async()=>({connection:null,mode:'environment',available:true})};
  if(url.endsWith('/matrix/generate')){const generated=await onGenerate?.(JSON.parse(String(init?.body)));return {ok:true,json:async()=>generated??{state:'complete',task_id:'new-task',result:task}};}
  if(url.includes('/classify/'))return {ok:true,json:async()=>({state:'complete',task_id:'matrix-1',result:task})};
  return {ok:true,json:async()=>({items:[]})};
 });vi.stubGlobal('fetch',fetcher);return fetcher;
}
function platformTask(extra:Record<string,Json>={}):MatrixResult{return {...matrix,scope:{...matrix.scope,task:{...matrix.scope.task,industry:'真实行业',questions:[{text:'真实问题'}],...extra}}};}
it('sends the selected CATEGORY range with lossless scope identity and no personal connection fields',async()=>{
 const bodies:Record<string,unknown>[]=[];
 platformFixture(platformTask(),body=>{bodies.push(body);return {state:'complete',result:{status:'needs_ai_decisions',errors:[{message:'Synthetic generation stopped'}]}};},[{id:'9007199254740993',name:'真实行业'}]);
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&siScope=9007199254740993&siPeriod=MONTH&siDate=2026-10-01&siModel=public-model');
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('option',{name:'真实行业'});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'9007199254740993'}});
 expect((screen.getByLabelText('目标平台') as HTMLSelectElement).value).toBe('');
 fireEvent.click(screen.getByRole('button',{name:'生成媒体渠道推荐'}));
 await waitFor(()=>expect(bodies).toHaveLength(1));
 expect(bodies[0]).toMatchObject({industry_query:{scopeType:'CATEGORY',scopeId:'9007199254740993',periodType:'MONTH',date:'2026-10-01',modelCode:'public-model'}});
 expect(bodies[0]).not.toHaveProperty('connection_mode');expect(bodies[0]).not.toHaveProperty('connection_revision');
});
it('leaves an unscoped query to the server industry mapping instead of sending ALL',async()=>{
 const bodies:Record<string,unknown>[]=[];platformFixture(platformTask(),body=>{bodies.push(body);return {state:'complete',result:{status:'needs_ai_decisions',errors:[]}};});
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&siPeriod=MONTH&siDate=2026-10-01&siModel=all');
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('option',{name:'真实行业'});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'industry-live'}});expect((screen.getByLabelText('目标平台') as HTMLSelectElement).value).toBe('');
 fireEvent.click(screen.getByRole('button',{name:'生成媒体渠道推荐'}));await waitFor(()=>expect(bodies).toHaveLength(1));expect(bodies[0]).not.toHaveProperty('industry_query');
});
it('keeps industry evidence in reports and still invalidates a changed range',async()=>{
 const query={scopeType:'CATEGORY',scopeId:'industry-live',periodType:'DAY',date:'2026-10-28',modelCode:'public-model'};
 platformFixture(platformTask({industry_query:query,industry_context:{status:'partial',message:'发布时间分布暂缺',query,fetched_at:'2026-11-07T00:00:00Z',data_version:'version-42',limitations:['仅有类型分布']}}));
 openMatrix('siScope=42&siPeriod=DAY&siDate=2026-10-28&siModel=public-model');
 await waitFor(()=>expect((screen.getByLabelText('目标行业 *') as HTMLSelectElement).value).toBe('industry-live'));
 expect(screen.queryByText(/行业数据不完整|仅有类型分布/)).toBeNull();
 expect(screen.queryByText(/需求、任务或稿件版本已变化/)).toBeNull();
 await act(async()=>{window.history.pushState({},'',window.location.pathname+window.location.search.replace('siDate=2026-10-28','siDate=2026-10-27'));window.dispatchEvent(new PopStateEvent('popstate'));});
 expect(await screen.findByText('内容已更新，请重新生成。')).toBeTruthy();
});
it('requires historical personal-model tasks to regenerate without offering connection settings',async()=>{
 platformFixture(platformTask({model_source:'user'}));openMatrix('');
 expect(await screen.findByText('内容已更新，请重新生成。')).toBeTruthy();
 expect(screen.queryByText(/此历史矩阵需要使用平台推荐服务/)).toBeNull();
 expect(screen.queryByRole('button',{name:'连接 API'})).toBeNull();expect(screen.queryByText(/请先连接|打开连接设置/)).toBeNull();
 expect((screen.getByRole('button',{name:'生成组合'}) as HTMLButtonElement).disabled).toBe(true);
});
it('keeps the previous matrix and cart when a replacement generation fails',async()=>{
 const fetcher=platformFixture(platformTask(),()=>{throw new Error('Synthetic platform failure');});openMatrix('');
 await waitFor(()=>expect((screen.getByLabelText('目标行业 *') as HTMLSelectElement).value).toBe('industry-live'));
 fireEvent.click(screen.getByRole('button',{name:'重新生成推荐并组合'}));
 expect(await screen.findByText(/Synthetic platform failure/)).toBeTruthy();
 expect(screen.getByText(/下面保留上次有效矩阵/)).toBeTruthy();expect(screen.getByRole('heading',{name:'可投媒体'})).toBeTruthy();
 expect(screen.getByRole('button',{name:/配置标题/})).toBeTruthy();
 expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/budget'))).toHaveLength(0);
 expect(mediaGateway.createDraft).not.toHaveBeenCalled();expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
});

it('ignores a delayed generation poll after the industry query has changed',async()=>{
 let finish!:(value:{})=>void;const pending=new Promise<{}>(resolve=>{finish=resolve;});let polling=false;
 const fetcher=platformFixture(platformTask(),()=>({state:'running',task_id:'new-task'}));
 const base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/classify/new-task')){polling=true;return {ok:true,json:async()=>await pending};}
  return base(input,init);
 });
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&siScope=42&siPeriod=DAY&siDate=2026-10-28&siModel=public-model');
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('option',{name:'真实行业'});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'industry-live'}});expect((screen.getByLabelText('目标平台') as HTMLSelectElement).value).toBe('');
 fireEvent.click(screen.getByRole('button',{name:'生成媒体渠道推荐'}));await waitFor(()=>expect(polling).toBe(true));
 await act(async()=>{window.history.pushState({},'',window.location.pathname+window.location.search.replace('siDate=2026-10-28','siDate=2026-10-27'));window.dispatchEvent(new PopStateEvent('popstate'));});
 await act(async()=>finish({state:'complete',task_id:'new-task',result:platformTask()}));
 expect(await screen.findByText(/行业范围或稿件已变化，先前生成结果未应用/)).toBeTruthy();
 expect(screen.queryByRole('heading',{name:'可投媒体'})).toBeNull();
 expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/budget'))).toHaveLength(0);
});

it('adopts only the verified first workbench assignment after generation and still rejects a later real task switch',async()=>{
 liveDirectory();const base=vi.mocked(fetch).getMockImplementation()!,owner=flow();owner.taskId=undefined;owner.resources=[];
 const generated={...matrix,scope:{...matrix.scope,task:{...matrix.scope.task,industry:'软件测试',questions:[{question_id:'q1',text:'软件测试公司怎么选'}]}}};
 vi.mocked(fetch).mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/industries'))return {ok:true,json:async()=>canonicalCatalog([{id:'industry-live',name:'软件测试'}])} as Response;
  if(url.endsWith('/matrix/generate')||url.endsWith('/classify/generated-task'))return {ok:true,json:async()=>({state:'complete',task_id:'generated-task',result:generated})} as Response;
  return base(input,init);
 });
 mediaGateway.createDraft.mockImplementation(async()=>{const saved=draft('draft-1',1,[media]);mediaGateway.getDraft.mockResolvedValue(saved);return saved;});
 function AssigningHost(){const [taskId,setTaskId]=useState<string>();const current:PublishingFlow={...owner,taskId,ensureTask:async()=>{setTaskId('created-task');await Promise.resolve();return 'created-task';}};return <PublishingFlowProvider value={current}><div className="monitoring-module"><SourceMatrixPage view="matrix"/></div></PublishingFlowProvider>;}
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&articleVersion=version-1&mode=multi');render(<AssigningHost/>);
 await screen.findByRole('option',{name:'软件测试'});await screen.findByRole('button',{name:'重新检查配置'});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'industry-live'}});
 fireEvent.change(screen.getByLabelText('目标问题 / 内容需求 *'),{target:{value:'软件测试公司怎么选'}});
 fireEvent.click(screen.getByRole('button',{name:'生成媒体渠道推荐'}));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('task')).toBe('generated-task'));
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'},{timeout:4000});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));fireEvent.click(checkbox);
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('workbenchTask')).toBe('created-task'));
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(true));
 fireEvent.click(screen.getByRole('button',{name:'刷新结果'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'刷新结果'}) as HTMLButtonElement).disabled).toBe(false),{timeout:4000});
 expect(screen.queryByText(/先前生成结果未应用/)).toBeNull();expect(mediaGateway.createDraft).toHaveBeenCalledTimes(1);
 await act(async()=>{window.history.pushState({},'',window.location.pathname+window.location.search.replace('workbenchTask=created-task','workbenchTask=other-task'));window.dispatchEvent(new PopStateEvent('popstate'));});
 fireEvent.click(screen.getByRole('button',{name:'刷新结果'}));
 expect(await screen.findByText(/行业范围或稿件已变化，先前生成结果未应用/)).toBeTruthy();
});

it('ignores a generation response after the independent target platform changes',async()=>{
 let finish!:(value:unknown)=>void;
 const pending=new Promise<unknown>(resolve=>{finish=resolve;});
 const fetcher=platformFixture(platformTask(),async()=>pending);
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('option',{name:'真实行业'});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'industry-live'}});
 fireEvent.change(screen.getByLabelText('目标平台'),{target:{value:'DeepSeek'}});
 fireEvent.click(screen.getByRole('button',{name:'生成媒体渠道推荐'}));
 await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/matrix/generate'))).toBe(true));
 fireEvent.change(screen.getByLabelText('目标平台'),{target:{value:'Kimi'}});
 await act(async()=>finish({task_id:'late-target-task',state:'complete',result:platformTask({target_platforms:['DeepSeek']})}));
 expect(await screen.findByText(/投放需求已变化，先前生成结果未应用/)).toBeTruthy();
 expect(new URLSearchParams(window.location.search).get('task')).toBeNull();
 expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/budget'))).toHaveLength(0);
});

it('adopts the latest verified research draft when identity arrives before a pending generation result',async()=>{
 let scopeReady!:(value:unknown)=>void,generated!:(value:unknown)=>void;
 const scopePromise=new Promise(resolve=>{scopeReady=resolve;}),generationPromise=new Promise(resolve=>{generated=resolve;});
 let submitted:Record<string,unknown>={};
 const fetcher=platformFixture(platformTask(),async body=>{submitted=body;return generationPromise;});
 const base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>String(input).endsWith('/matrix/form-scope')?{ok:true,json:async()=>scopePromise as {}}:base(input,init));
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('option',{name:'真实行业'});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'industry-live'}});
 fireEvent.change(screen.getByLabelText('目标平台'),{target:{value:'Kimi'}});
 fireEvent.change(screen.getByLabelText('期望发布时效'),{target:{value:'12'}});
 fireEvent.click(screen.getByRole('button',{name:'生成媒体渠道推荐'}));
 await waitFor(()=>expect(submitted.target_platforms).toEqual(['Kimi']));
 await act(async()=>scopeReady({scopeKey:'a'.repeat(64)}));
 await waitFor(()=>expect(sessionStorage.length).toBeGreaterThan(0));
 await act(async()=>generated({task_id:'verified-research-task',state:'running'}));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('task')).toBe('verified-research-task'));
 expect((screen.getByLabelText('目标平台') as HTMLSelectElement).value).toBe('Kimi');
 expect((screen.getByLabelText('期望发布时效') as HTMLSelectElement).value).toBe('12');
 expect(screen.queryByText(/投放需求已变化，先前生成结果未应用/)).toBeNull();
});


// Source-only regressions for confirmed import hydration and legacy-free generation.
it('confirms selected IDs against the saved list before counting and puts the summary above questions',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&researchDataset=synthetic-file');
 let finish!:(value:{})=>void;const pending=new Promise<{}>(resolve=>{finish=resolve;});
 const fetcher=platformFixture();const base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>String(input).endsWith('/matrix/imports')?{ok:true,json:async()=>pending}:base(input,init));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 const loading=await screen.findByText('正在读取已保存文件列表…');
 expect(screen.queryByText(/已选用 1 份导入数据/)).toBeNull();
 expect(loading.closest('.sm-import-summary')!.compareDocumentPosition(screen.getByLabelText('目标问题 / 内容需求 *'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 await act(async()=>finish({datasets:[{id:'synthetic-file',name:'Synthetic research.csv',version:'v1',recordCount:7,createdAt:'',status:'confirmed'}]}));
 expect(await screen.findByText('已选用 1 份导入数据')).toBeTruthy();expect(screen.getByText('Synthetic research.csv')).toBeTruthy();expect(screen.getByText('（7 条）')).toBeTruthy();
 expect(document.querySelector('.sm-input-status')?.textContent??'').not.toContain('Synthetic research.csv');
});
it('keeps import list failures independent and retries without turning preview metadata into success',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&researchDataset=synthetic-file');
 let reads=0;const fetcher=platformFixture();const base=fetcher.getMockImplementation()!;
 // Hold the form scope pending so the list failure is observed before any owner change refetches.
 let scopeReady!:(value:{})=>void;const scopePromise=new Promise<{}>(resolve=>{scopeReady=resolve;});
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/matrix/form-scope'))return {ok:true,json:async()=>scopePromise};
  if(String(input).endsWith('/matrix/imports')){if(++reads===1)throw new Error('Synthetic import failure');return {ok:true,json:async()=>({datasets:[{id:'synthetic-file',name:'Unconfirmed preview',version:'v1',recordCount:2,createdAt:'',status:'preview'}]})};}
  return base(input,init);
 });
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 expect(await screen.findByText('选用数据尚未确认')).toBeTruthy();expect(screen.queryByText(/已选用 1 份/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'重试读取文件列表'}));
 expect(await screen.findByText('已取消失效文件的选用，请核对当前选择。')).toBeTruthy();expect(screen.getByText('未选用导入数据')).toBeTruthy();expect(screen.queryByText('Unconfirmed preview')).toBeNull();
});
it('generates a valid canonical industry without legacy mappings and corrects stale scope while preserving period and model',async()=>{
 const bodies:Record<string,unknown>[]=[];const fetcher=platformFixture(platformTask(),body=>{bodies.push(body);return {state:'complete',result:{status:'needs_ai_decisions',errors:[]}};});
 const base=fetcher.getMockImplementation()!;fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>String(input).endsWith('/industries')?{ok:true,json:async()=>({...canonicalCatalog([{id:'industry-live',name:'真实行业'}]),legacyMappings:[]})}:base(input,init));
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&siScope=42&siPeriod=DAY&siDate=2026-10-28&siModel=all');
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);await screen.findByRole('option',{name:'真实行业'});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'industry-live'}});fireEvent.click(screen.getByRole('button',{name:'生成媒体渠道推荐'}));
 await waitFor(()=>expect(bodies).toHaveLength(1));expect(bodies[0]).toMatchObject({industry_id:'industry-live'});expect(bodies[0]).toMatchObject({industry_query:{scopeId:'industry-live',scopeType:'CATEGORY',periodType:'DAY',date:'2026-10-28',modelCode:'all'}});expect(screen.queryByText(/推荐数据尚未接入/)).toBeNull();
});


it.each(['imports-first','task-first'])('keeps current confirmed metadata and detects selected version changes with %s hydration',async order=>{
 const saved=platformTask({research_dataset_ids:['synthetic-selected'],research_dataset_refs:[{id:'synthetic-selected',name:'Historical snapshot.csv',recordCount:2,version:'old-version'}],model_source:'environment',industry_context:{status:'ok'}});
 let finishTask!:(value:{})=>void,finishImports!:(value:{})=>void;
 const pendingTask=new Promise<{}>(resolve=>{finishTask=resolve;}),pendingImports=new Promise<{}>(resolve=>{finishImports=resolve;});
 const fetcher=platformFixture(saved);const base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/matrix/imports'))return {ok:true,json:async()=>pendingImports};
  if(String(input).includes('/classify/'))return {ok:true,json:async()=>pendingTask};
  return base(input,init);
 });
 openMatrix('researchDataset=synthetic-selected');
 await screen.findByRole('option',{name:'真实行业'});
 const current={datasets:[{id:'synthetic-selected',name:'Current confirmed.csv',recordCount:7,version:'current-version',createdAt:'',status:'confirmed'}]};
 const task={task_id:'matrix-1',state:'complete',result:saved};
 if(order==='imports-first'){
  await act(async()=>finishImports(current));await screen.findByText('Current confirmed.csv');
  await act(async()=>finishTask(task));
 }else{
  await act(async()=>finishTask(task));await waitFor(()=>expect((screen.getByLabelText('目标行业 *') as HTMLSelectElement).value).toBe('industry-live'));
  expect(screen.queryByText('Historical snapshot.csv')).toBeNull();
  await act(async()=>finishImports(current));
 }
 expect(await screen.findByText('选用文件的版本已变化，请重新生成矩阵。')).toBeTruthy();
 expect(screen.getByText('Current confirmed.csv')).toBeTruthy();expect(screen.getByText('（7 条）')).toBeTruthy();expect(screen.queryByText('Historical snapshot.csv')).toBeNull();
 // An unchanged dialog list refresh and close cannot erase the independent version warning.
 fireEvent.click(screen.getByRole('button',{name:'导入数据'}));await screen.findByRole('checkbox',{name:'选用 Current confirmed.csv'});
 fireEvent.click(screen.getByRole('button',{name:'完成'}));
 expect(screen.getByText('选用文件的版本已变化，请重新生成矩阵。')).toBeTruthy();
});
it('ignores version changes of unselected server files and historical references during metadata refresh',async()=>{
 const saved=platformTask({research_dataset_ids:['synthetic-selected'],research_dataset_refs:[{id:'synthetic-selected',name:'Selected.csv',version:'same-version'},{id:'synthetic-unselected',name:'Unselected.csv',version:'old-unselected'}],model_source:'environment',industry_context:{status:'ok'}});
 let otherVersion='new-unselected';const fetcher=platformFixture(saved);const base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>String(input).endsWith('/matrix/imports')?{ok:true,json:async()=>({datasets:[{id:'synthetic-selected',name:'Selected.csv',recordCount:3,version:'same-version',createdAt:'',status:'confirmed'},{id:'synthetic-unselected',name:'Unselected.csv',recordCount:5,version:otherVersion,createdAt:'',status:'confirmed'}]})}:base(input,init));
 openMatrix('researchDataset=synthetic-selected');await screen.findByText('已选用 1 份导入数据');
 await waitFor(()=>expect((screen.getByLabelText('目标行业 *') as HTMLSelectElement).value).toBe('industry-live'));
 expect(screen.queryByText('选用文件的版本已变化，请重新生成矩阵。')).toBeNull();
 otherVersion='later-unselected';fireEvent.click(screen.getByRole('button',{name:'导入数据'}));await screen.findByRole('checkbox',{name:'选用 Unselected.csv'});
 fireEvent.click(screen.getByRole('button',{name:'完成'}));
 expect(screen.queryByText('选用文件的版本已变化，请重新生成矩阵。')).toBeNull();expect(screen.getByText('已选用 1 份导入数据')).toBeTruthy();
});


it('uses compact server readiness for a restored task without copying the industry snapshot into the form projection',async()=>{
 const query={scopeType:'CATEGORY',scopeId:'industry-live',periodType:'DAY',date:'2026-10-28',modelCode:'public-model'};
 const saved=platformTask({industry_query:query});
 const fetcher=platformFixture(saved),base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>String(input).includes('/classify/')?Promise.resolve({ok:true,json:async()=>({state:'complete',task_id:'matrix-1',task:{industry:'真实行业',industry_id:'industry-live',questions:[{text:'真实问题'}],model_source:'environment',platform_regeneration_required:false,industry_query:query},result:saved})}):base(input,init));
 openMatrix('siScope=42&siPeriod=DAY&siDate=2026-10-28&siModel=public-model');
 await waitFor(()=>expect((screen.getByRole('button',{name:'生成组合'}) as HTMLButtonElement).disabled).toBe(false));
 expect(screen.queryByText('内容已更新，请重新生成。')).toBeNull();
 expect(screen.queryByText(/此历史矩阵需要使用平台推荐服务/)).toBeNull();
});

it('shows a failed semantic pool honestly and retains the matrix regenerate action',async()=>{
 const invalid={...platformTask(),status:'invalid_decisions',matrix:{...matrix.matrix,status:'invalid_decisions',candidates:matrix.matrix.candidates.map(row=>({...row,primary_role:null})),layers:[],fit_order:[]},errors:[{code:'invalid_aggregate_reference',path:'matrix_decisions.items[0]',message:'invalid reference'}]};
 platformFixture(invalid);openMatrix('');
 await screen.findAllByText('媒体渠道推荐未通过校验，请重新生成矩阵。');
 expect(screen.getByRole('heading',{name:'完整信源矩阵'})).toBeTruthy();
 expect(screen.queryByText('0 个候选')).toBeNull();
 expect(screen.getByRole('button',{name:'重新生成矩阵'})).toBeTruthy();
 expect((screen.getByRole('button',{name:'生成组合'}) as HTMLButtonElement).disabled).toBe(true);
});


it('counts only candidates rendered in recommendation layers as available to add',async()=>{
 liveDirectory();
 const hiddenMedia:MediaResource={...media,id:'media-2',externalResourceId:'external-2',name:'尚未分层媒体'};
 const withPool:MatrixResult={...matrix,matrix:{...matrix.matrix,candidates:[...matrix.matrix.candidates,{...matrix.matrix.candidates[0],candidate_id:'candidate-2',resource_id:'external-2',attributes:{source_name:'尚未分层媒体'},primary_role:null,selection:'undecided'}]}};
 mediaGateway.listMedia.mockResolvedValue({items:[media,hiddenMedia],total:2,page:1,pageSize:100,exactResourceLookupVersion:1,catalog:{activeRevision:'catalog-1'}});
 const fetcher=vi.mocked(fetch),base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('/classify/'))return {ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:withPool})} as Response;
  if(url.includes('/media-requirements'))return {ok:true,json:async()=>({items:[media,hiddenMedia].map(row=>({id:row.id,rules:{rules:[],rawRemark:'',unresolved:[]}}))})} as Response;
  return base(input,init);
 });
 openMatrix('draftId=draft-1&articleVersion=version-1');
 expect(await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'})).toBeTruthy();
 expect(screen.queryByRole('checkbox',{name:'选择 尚未分层媒体 新闻'})).toBeNull();
});

// Source-only regression: a new generation owns fresh quantity drafts; ordinary
// quantity updates use the existing owner and are covered by component tests.
it.each(['','4'])('discards previous local quantity %s when regenerating the same recommendation resources',async(value)=>{
 liveDirectory();let generated=0,finish!:(response:unknown)=>void;const quantityRequests:unknown[]=[];
 const recommendation:ContentPlan={schema_version:'recommendation/1.0',recommendation_id:'recommendation-stable',kind:'recommendation',strategy:'行业组合',reason_summary:'结合当前目标安排篇数',explanation:null,items:[{candidate_id:'candidate-1',resource_id:'external-1',offer_id:'quote-1',publication_spec:'text',quantity:2,quantity_mode:'new_articles',content_tasks:['补充当前稿件的事实依据'],purpose:'standard',unit_price:'100.00',base_cost:'200.00',cost:'200.00',known_cost:'200.00',pricing_status:'priced'}],total_articles:2,currency:'CNY',known_total_cost:'200.00',total_cost:'200.00',total_remaining:'800.00',total_cap:'1000.00',budget_feasible:true,ready_to_publish:false,execution_recommended:false,unknown_items:[],errors:[]};
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation((input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/budget')){generated++;return generated===1?Promise.resolve({ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,plan_version:'generated-first',recommendations:[recommendation],content_plans:[]}})}):new Promise(resolve=>{finish=resolve;});}
  if(url.endsWith('/recommendation')){quantityRequests.push(JSON.parse(String(init?.body)));return Promise.resolve({ok:false,json:async()=>({status:'unexpected_obsolete_quantity'})});}
  return base(input,init);
 });
 openMatrix('draftId=draft-1&articleVersion=version-1');await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((screen.getByRole('button',{name:/生成组合|更新组合/}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'1000'}});fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 const quantity=await screen.findByLabelText('可投媒体建议篇数');await waitFor(()=>expect((quantity as HTMLInputElement).disabled).toBe(false));
 fireEvent.change(quantity,{target:{value}});fireEvent.click(screen.getByRole('button',{name:'更新组合'}));
 await waitFor(()=>expect(generated).toBe(2));
 const next={...recommendation,items:[{...recommendation.items[0]!,quantity:5,base_cost:'500.00',cost:'500.00',known_cost:'500.00'}],total_articles:5,known_total_cost:'500.00',total_cost:'500.00',total_remaining:'500.00'};
 await act(async()=>finish({ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...matrix,plan_version:'generated-second',recommendations:[next],content_plans:[]}})}));
 await waitFor(()=>expect((screen.getByLabelText('可投媒体建议篇数') as HTMLInputElement).value).toBe('5'));
 expect(screen.getByText('预计总价').parentElement?.textContent).toContain('500.00');expect(screen.getByRole('button',{name:'查看报告'})).toBeTruthy();expect(quantityRequests).toEqual([]);
});
