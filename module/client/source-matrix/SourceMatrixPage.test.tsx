// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { useState } from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import SourceMatrixPage from './SourceMatrixPage';
import {downloadUrl} from './api';
import { PublishingFlowProvider,type PublishingFlow } from '../PublishingFlowContext';
import type { MediaResource,PublicationDraft } from '../types';
import type { MatrixResult } from './types';
import {matrixDemo} from './demo';
// jsdom does not implement <dialog>; the confirmation dialog needs these stubs.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

const mediaGateway=vi.hoisted(()=>({listMedia:vi.fn(),getDraft:vi.fn(),getArticleVersion:vi.fn(),createDraft:vi.fn(),updateDraftMedia:vi.fn()}));
vi.mock('../PublishingContext',()=>({usePublisherGateway:()=>mediaGateway}));
vi.mock('./industry/IndustryDistribution',()=>({LiveIndustryDistribution:()=> <div>真实行业分布</div>}));
beforeEach(()=>{Object.values(mediaGateway).forEach(mock=>mock.mockReset());vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState({},'', '/');});
it('defaults to real industry distribution and exposes only the two canonical tabs',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?draftId=draft-1&articleVersion=version-1#range');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({industries:[]})})));
 mediaGateway.getDraft.mockResolvedValue(draft());
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByText('真实行业分布');
 const matrixLink=screen.getByRole('link',{name:'信源矩阵推荐'}) as HTMLAnchorElement;
 expect(matrixLink.search).toContain('tab=matrix');expect(matrixLink.search).toContain('draftId=draft-1');expect(matrixLink.hash).toBe('#range');
 expect(screen.queryByRole('link',{name:'媒体库首页'})).toBeNull();expect(screen.queryByRole('link',{name:'第三方媒体列表'})).toBeNull();expect(screen.queryByText('输入信源数据')).toBeNull();
});
it('keeps configuration details out of permanent layout and offers a local industry retry',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({status:'configuration_required',industries:[],message:'信源规划存储尚未配置，请联系管理员完成模块迁移'})})));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('button',{name:'重试读取行业'});expect(screen.queryByText(/请联系管理员完成模块迁移/)).toBeNull();
 expect(screen.getByLabelText('目标行业 *')).toBeTruthy();expect(screen.getByLabelText('期望发布时效（小时）')).toBeTruthy();expect(screen.getByLabelText('素材能力要求')).toBeTruthy();expect(screen.getByLabelText('品牌引用数据')).toBeTruthy();expect(screen.getByLabelText('引用样本平台')).toBeTruthy();
});
it('renders structured stale results without replacing or reading nonexistent matrix fields',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?task=task&tab=matrix');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('/industries')?{industries:[]}:{task_id:'task',state:'complete',result:{status:'stale_matrix',errors:[{code:'stale_matrix',message:'任务已变化，请重新生成'}]}}})));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByText('任务已变化，请重新生成');expect(screen.getByText('等待生成矩阵')).toBeTruthy();
});

const media:MediaResource={id:'media-1',externalResourceId:'external-1',name:'可投媒体',shortName:'可投',kind:'news',platform:'新闻',taxonomy:'',mediaType:'',channel:'',region:'',titleLimit:200,priceTenThousandths:'1000000',turnaround:'',active:true,capability:'image',catalogRevision:'catalog-1',logoSource:'generated_fallback',logoResolutionStatus:'missing'};
function draft(id='draft-1',revision=1,items:MediaResource[]=[]):PublicationDraft{return {id,revision,articleId:'article-1',articleVersionId:'version-1',articleTitle:'当前稿件',articleVersion:1,articleVersionHash:'hash-1',articleContainsImages:false,titleMode:'per_media',items:items.map(media=>({media,title:'当前稿件'})),updatedAt:'2026-10-24T00:00:00Z'};}
const matrix:MatrixResult={status:'complete',plan_id:'plan-1',plan_version:'plan-version-1',matrix_version:'matrix-version-1',as_of:'2026-10-24T00:00:00Z',scope:{task:{},evidence_scope:{}},matrix:{status:'complete',candidates:[{candidate_id:'candidate-1',resource_id:'external-1',attributes:{source_name:'可投媒体'},offers:[],primary_role:'industry',auxiliary_roles:[],selection:'recommended',matched_questions:[],reason_summary:'已核验行业相关',channel_status:'eligible',manuscript_status:'compatible',hard_failures:[],pending_conditions:[],evidence_relation:'',evidence_ids:[],aggregate_ids:[]}],layers:[{role:'industry',display_name:'行业核心',status:'populated',candidate_ids:['candidate-1'],auxiliary_candidate_ids:[]}],fit_order:['candidate-1']},source_analysis:{status:'complete',known_detail_count:0,total_citations:0,groups:[],actual_sources:[],domain_rollups:[],detail_citations:[],external_aggregates:[],supplier_claims:[],unknown_records:[],content_age:null},budget_plans:[],limitations:[],warnings:[],errors:[],minimum_known_cost:null};
function liveDirectory(){
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
  const url=String(input);
  return {ok:true,json:async()=>url.includes('/industries')?{industries:[]}:url.includes('/classify/')?{task_id:'matrix-1',state:'complete',result:matrix}:url.endsWith('/status')?{configured:true}:{items:[{id:media.id,externalResourceId:media.externalResourceId,rules:{rules:[],rawRemark:'',unresolved:[]}}]}};
 }));
 mediaGateway.listMedia.mockResolvedValue({items:[media],total:1,page:1,pageSize:100,catalog:{activeRevision:'catalog-1'}});
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
 const cartLink=new URL((screen.getByRole('link',{name:/购物车 1/}) as HTMLAnchorElement).href);
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
 mediaGateway.listMedia.mockResolvedValue({items:[{...media,capability:'text'}],total:1,page:1,pageSize:100,catalog:{activeRevision:'catalog-1'}});
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
 mediaGateway.listMedia.mockResolvedValue({items:[pending],total:1,page:1,pageSize:100,catalog:{activeRevision:'catalog-1'}});
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
 // The matrix binding changed with the draft: selection stays conservatively
 // disabled until the matrix is regenerated; the stale update must not check it.
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).disabled).toBe(true));
 expect(screen.getByText('需求已变化，请更新矩阵。')).toBeTruthy();
 expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(false);
 expect((screen.getByRole('link',{name:/购物车 0/}) as HTMLAnchorElement).pathname).toBe('/publishing/drafts/draft-2/media/cart');
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
 liveDirectory();mediaGateway.listMedia.mockRejectedValueOnce(new Error('媒体映射暂不可用')).mockResolvedValue({items:[media],total:1,page:1,pageSize:100,catalog:{activeRevision:'catalog-1'}});
 openMatrix('draftId=draft-1&articleVersion=version-1&mode=multi');
 fireEvent.click(await screen.findByRole('button',{name:'重试读取媒体映射'}));
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));
 expect(mediaGateway.listMedia).toHaveBeenCalledTimes(2);expect(mediaGateway.createDraft).not.toHaveBeenCalled();
 expect((screen.getByRole('link',{name:/购物车 0/}) as HTMLAnchorElement).pathname).toBe('/publishing/drafts/draft-1/media/cart');
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
 const cartLink=await screen.findByRole('link',{name:'购物车 2 · ¥300.00'});
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
 const echoedTask={...matrix,scope:{...matrix.scope,task:{industry:'软件测试',questions:[{question_id:'question-0',text:'软件测试公司怎么选'}]}}};
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
 await screen.findByRole('heading',{name:'保守覆盖'});
 expect(screen.queryByText('不得覆盖原矩阵的预算理由')).toBeNull();
 expect(screen.getByRole('heading',{name:'权威参考层'})).toBeTruthy();expect(screen.getByRole('heading',{name:'探索验证层'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'150'}});
 expect(screen.getByText('条件已变化，此组合仅供对照，请重新生成。')).toBeTruthy();
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
 expect((screen.getByRole('button',{name:'导出当前版本'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:/生成组合|更新组合/}));
 await waitFor(()=>expect(bodies[1]).toMatchObject({plan_version:'saved-obsolete-budget',budget:{total_cap:'300'}}));
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
});

it('keeps the cart footer on the distribution tab without discarding selected media',async()=>{
 liveDirectory();mediaGateway.getDraft.mockResolvedValue(draft('draft-1',1,[media]));
 window.history.replaceState({},'', '/publishing/source-matrix?tab=analysis&task=matrix-1&draftId=draft-1&articleVersion=version-1');
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('link',{name:'购物车 1 · ¥100.00'});expect(screen.getByText('真实行业分布')).toBeTruthy();
 expect(screen.getByRole('button',{name:/查看购物车/})).toBeTruthy();expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
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
 expect(screen.getByText(/需求、任务或稿件版本已变化，当前矩阵仅供对照/)).toBeTruthy();
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
 expect((screen.getByRole('button',{name:'导出当前版本'}) as HTMLButtonElement).disabled).toBe(true);
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

it('pins export to the currently displayed persisted plan rather than the task latest report',async()=>{
 liveDirectory();openMatrix('draftId=draft-1&articleVersion=version-1');
 const link=await screen.findByRole('link',{name:'导出当前版本'});
 const url=new URL((link as HTMLAnchorElement).href);
 expect(url.pathname).toBe('/api/modules/publish/classify/matrix-1/download');
 expect(Object.fromEntries(url.searchParams)).toEqual({plan_id:matrix.plan_id,plan_version:matrix.plan_version});
 expect(downloadUrl('legacy-task')).toBe('/api/modules/publish/classify/legacy-task/download');
});

it('applies a server-verified budget plan into the shared cart with preview, refresh and no mediaIds overwrite',async()=>{
 liveDirectory();
 const offerPlan={strategy:'保守覆盖',reason_summary:'费用与适配分别判断',status:'complete',currency:'CNY',total_cost:'100.00',exploration_cost:'0.00',known_total_cost:'100.00',total_cap:'200.00',total_remaining:'100.00',exploration_remaining:'0.00',budget_feasible:true,manuscript_status:'needs_manuscript_check',ready_to_publish:false,execution_recommended:false,is_estimate:false,unknown_items:[],items:[{candidate_id:'candidate-1',resource_id:'external-1',article_id:'article-1',version:'1',quantity:1,purpose:'standard',offer_id:'quote-1'}],errors:[],semantic_pending:[]};
 const applyDiff={status:'ok',task_id:'matrix-1',plan_index:0,draft:{id:'draft-1',revision:2},additions:[{mediaResourceId:'media-1',name:'可投媒体',externalResourceId:'external-1',priceTenThousandths:'1000000',totalPriceTenThousandths:'1000000',quantity:1,offerId:'quote-1',publicationSpec:null,purpose:'standard',reason:'命中目标问题'}],alreadySelected:[],skipped:[],overLimit:false,mergedCount:1,knownTotalTenThousandths:'1000000',pendingPriced:0};
 const applyBodies:unknown[]=[];
 // 生成请求会把表单值回显进任务（真实服务行为），水合后输入与任务一致，链式预算才会自动触发
 const echoedTask={...matrix,scope:{...matrix.scope,task:{industry:'软件测试',questions:[{question_id:'question-0',text:'软件测试公司怎么选'}]}}};
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
 const echoedTask={...matrix,scope:{...matrix.scope,task:{industry:'软件测试',questions:[{question_id:'question-0',text:'软件测试公司怎么选'}]}}};
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

it('one click generates the matrix then automatically the budget combination with the editable demo budget',async()=>{
 liveDirectory();
 const budgetBodies:unknown[]=[];
 const offerPlan={strategy:'保守覆盖',reason_summary:'费用与适配分别判断',status:'complete',currency:'CNY',total_cost:'100.00',exploration_cost:'0.00',known_total_cost:'100.00',total_cap:'3000.00',total_remaining:'2900.00',exploration_remaining:'0.00',budget_feasible:true,manuscript_status:'needs_manuscript_check',ready_to_publish:false,execution_recommended:false,is_estimate:false,unknown_items:[],items:[{candidate_id:'candidate-1',resource_id:'external-1',article_id:'article-1',version:'1',quantity:1,purpose:'standard',offer_id:'quote-1'}],errors:[],semantic_pending:[]};
 // 生成请求会把表单值回显进任务（真实服务行为），水合后输入与任务一致，链式预算才会自动触发
 const echoedTask={...matrix,scope:{...matrix.scope,task:{industry:'软件测试',questions:[{question_id:'question-0',text:'软件测试公司怎么选'}]}}};
 const fetcher=globalThis.fetch as ReturnType<typeof vi.fn>,base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/industries'))return {ok:true,json:async()=>({industries:[{id:'industry-1',name:'软件测试'}],brand_data_batches:[{id:'sha256:639e43735887ff20852f99aa4bc643853259dbd7f44aba163598064720a60e0d',label:'一航软件样本',version:'v1',sourceFile:'一航软件-信源分析-20260913-214944.xlsx',recordCount:502,period:{start:'2026-09-07',end:'2026-09-13'},models:['百度文心-手机版']}]})};
  if(url.endsWith('/matrix/generate')){const body=JSON.parse(String(init?.body));expect(body.brand_data).toBe('sha256:639e43735887ff20852f99aa4bc643853259dbd7f44aba163598064720a60e0d');return {ok:true,json:async()=>({task_id:'matrix-1',state:'running',result:echoedTask})};}
  if(url.endsWith('/budget')){budgetBodies.push(JSON.parse(String(init?.body)));return {ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:{...echoedTask,budget_plans:[offerPlan]}})};}
  if(url.includes('/classify/matrix-1'))return {ok:true,json:async()=>({task_id:'matrix-1',state:'complete',result:echoedTask})};
  return base(input,init);
 });
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix&articleVersion=version-1');
 render(<div className="monitoring-module"><SourceMatrixPage view="matrix"/></div>);
 fireEvent.change(await screen.findByLabelText('目标行业 *'),{target:{value:'industry-1'}});
 fireEvent.change(await screen.findByLabelText('目标问题 / 内容需求 *'),{target:{value:'软件测试公司怎么选'}});
 fireEvent.click(screen.getByRole('button',{name:'生成推荐矩阵'}));
 // 一次点击后自动串联：预算请求以同一矩阵快照和可编辑示例预算 3000 发出
 await waitFor(()=>expect(budgetBodies.length).toBeGreaterThanOrEqual(1));
 expect(budgetBodies[0]).toMatchObject({plan_id:'plan-1',plan_version:'plan-version-1',budget:{total_cap:'3000',currency:'CNY'}});
 await screen.findByRole('heading',{name:'保守覆盖'});
 expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
});

it('shows the actual saved sample without configured services and never writes a sample into the cart',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{throw new Error('service unavailable');});vi.stubGlobal('fetch',fetcher);
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('button',{name:'重试读取行业'});
 expect(screen.getByText('一航软件 · 已保存样本')).toBeTruthy();
 expect((screen.getByLabelText('品牌 / 产品') as HTMLInputElement).value).toBe(matrixDemo.form.product);
 expect((screen.getByLabelText('目标问题 / 内容需求 *') as HTMLTextAreaElement).value).toBe(matrixDemo.form.questions.join('\n'));
 expect(screen.getAllByRole('heading',{level:3}).filter(node=>/层$/.test(node.textContent??''))).toHaveLength(5);
 expect(document.querySelectorAll('[data-source-id]')).toHaveLength(matrixDemo.result.matrix.layers.reduce((sum,layer)=>sum+Math.min(3,layer.candidate_ids.length),0));
 for(const button of screen.queryAllByRole('button',{name:/更多候选/}))fireEvent.click(button);
 expect(document.querySelectorAll('[data-source-id]')).toHaveLength(matrixDemo.result.matrix.candidates.length);
 expect(screen.getAllByRole('button',{name:/^组合 [123]/})).toHaveLength(3);
 expect(screen.queryByRole('button',{name:'加入本组合'})).toBeNull();
 expect(screen.queryByRole('checkbox',{name:/^选择 /})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/^组合 2/}));
 expect([...document.querySelectorAll('.sm-candidate.is-highlighted')].map(node=>node.getAttribute('data-source-id')).sort()).toEqual([...matrixDemo.research_combinations[1]!.candidate_ids].sort());
 expect(mediaGateway.createDraft).not.toHaveBeenCalled();expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
 expect(fetcher.mock.calls.some(call=>String(call[0]).includes('/matrix/generate'))).toBe(false);
});

it('keeps the saved matrix unchanged on budget-only edits and distinguishes semantic edits',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({industries:[]})})));
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
 expect(screen.getByText(/投放要求已修改，下方保存矩阵/)).toBeTruthy();
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
  if(url.endsWith('/industries'))return {ok:true,json:async()=>({industries:[{id:'configured-industry',name:matrixDemo.form.industry}],brand_data_batches:[{id:matrixDemo.form.brandDataBatchId,label:'一航软件样本',version:'verified-source',sourceFile:matrixDemo.source.file,recordCount:502,period:matrixDemo.source.period,models:matrixDemo.source.models}]})};
  if(init?.method==='POST'){bodies.push({url,body:JSON.parse(String(init.body))});return {ok:false,json:async()=>({message:'模型尚未配置，请稍后重试'})};}
  return {ok:true,json:async()=>({})};
 }));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('option',{name:matrixDemo.form.industry});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'configured-industry'}});
 expect(screen.queryByText(/投放要求已修改，下方保存矩阵/)).toBeNull();
 fireEvent.change(screen.getByLabelText('总预算（CNY）'),{target:{value:'5000'}});
 fireEvent.click(screen.getByRole('button',{name:'按当前要求在线生成'}));
 await screen.findByText('模型尚未配置，请稍后重试');
 expect(bodies).toHaveLength(1);expect(bodies[0]!.url).toContain('/matrix/generate');
 expect(bodies[0]!.body).toMatchObject({industry_id:'configured-industry',brand_data:matrixDemo.form.brandDataBatchId});
 expect(bodies[0]!.body).not.toHaveProperty('budget');expect(bodies[0]!.body).not.toHaveProperty('plan_id');
 expect(screen.queryByText('一航软件 · 已保存样本')).toBeNull();expect(screen.getByText('等待生成矩阵')).toBeTruthy();
 expect(mediaGateway.createDraft).not.toHaveBeenCalled();expect(mediaGateway.updateDraftMedia).not.toHaveBeenCalled();
});

it('hydrates a different task instead of mixing its result with the prefilled demo or previous task',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 const resultFor=(id:string):MatrixResult=>({...matrix,scope:{...matrix.scope,task:{industry:'已接入行业',product:'产品 '+id,audience:'受众 '+id,regions:['上海'],hours:'24',requirements:{links:true},brand:{batch_id:matrixDemo.form.brandDataBatchId,platforms:['百度文心-手机版']},questions:[{question_id:'q-'+id,text:'问题 '+id}]}}});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const url=String(input),id=url.endsWith('/task-B')?'B':'A';return {ok:true,json:async()=>url.endsWith('/industries')?{industries:[{id:'configured-industry',name:'已接入行业'}]}:url.includes('/classify/')?{task_id:'task-'+id,state:'complete',result:resultFor(id)}:{items:[]}};}));
 mediaGateway.listMedia.mockResolvedValue({items:[],total:0,page:1,pageSize:100});
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByText('一航软件 · 已保存样本');
 fireEvent.click(screen.getByRole('button',{name:'查看样本报告'}));
 for(const id of ['A','B','A']){
  await act(async()=>{window.history.pushState({},'', '/publishing/source-matrix?tab=matrix&task=task-'+id);window.dispatchEvent(new PopStateEvent('popstate'));});
  await waitFor(()=>expect((screen.getByLabelText('品牌 / 产品') as HTMLInputElement).value).toBe('产品 '+id));
  expect((screen.getByLabelText('目标问题 / 内容需求 *') as HTMLTextAreaElement).value).toBe('问题 '+id);
  expect((screen.getByLabelText('期望发布时效（小时）') as HTMLInputElement).value).toBe('24');
  expect((screen.getByLabelText('引用样本平台') as HTMLSelectElement).value).toBe('百度文心-手机版');
  expect(screen.queryByRole('heading',{name:'一航软件信源矩阵与研究组合'})).toBeNull();
 }
 fireEvent.change(screen.getByLabelText('品牌 / 产品'),{target:{value:'未提交编辑'}});
 fireEvent.click(screen.getByRole('button',{name:'刷新结果'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'刷新结果'}) as HTMLButtonElement).disabled).toBe(false));
 expect((screen.getByLabelText('品牌 / 产品') as HTMLInputElement).value).toBe('未提交编辑');
});

it('does not send the automatic budget stage to another task after leaving a running generation',async()=>{
 liveDirectory();window.history.replaceState({},'', '/publishing/source-matrix?tab=matrix');
 const posts:string[]=[],taskResult=(name:string):MatrixResult=>({...matrix,scope:{...matrix.scope,task:{industry:matrixDemo.form.industry,product:name,questions:[{question_id:'q1',text:'当前问题'}]}}});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);if(init?.method==='POST')posts.push(url);
  if(url.endsWith('/industries'))return {ok:true,json:async()=>({industries:[{id:'industry-live',name:matrixDemo.form.industry}],brand_data_batches:[{id:matrixDemo.form.brandDataBatchId,label:'一航软件样本',version:'v1',recordCount:502,sourceFile:matrixDemo.source.file,period:matrixDemo.source.period,models:matrixDemo.source.models}]})};
  if(url.endsWith('/matrix/generate')||url.endsWith('/task-A'))return {ok:true,json:async()=>({task_id:'task-A',state:'running',result:taskResult('正在生成的A')})};
  if(url.endsWith('/task-B'))return {ok:true,json:async()=>({task_id:'task-B',state:'complete',result:taskResult('已有任务B')})};
  return {ok:true,json:async()=>({items:[]})};
 }));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByRole('option',{name:matrixDemo.form.industry});
 fireEvent.change(screen.getByLabelText('目标行业 *'),{target:{value:'industry-live'}});
 fireEvent.click(screen.getByRole('button',{name:'生成推荐矩阵'}));
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get('task')).toBe('task-A'));
 await act(async()=>{window.history.pushState({},'', '/publishing/source-matrix?tab=matrix&task=task-B');window.dispatchEvent(new PopStateEvent('popstate'));});
 await waitFor(()=>expect((screen.getByLabelText('品牌 / 产品') as HTMLInputElement).value).toBe('已有任务B'));
 expect(posts.filter(url=>url.endsWith('/budget'))).toEqual([]);
 expect(posts.filter(url=>url.endsWith('/matrix/generate'))).toHaveLength(1);
});
