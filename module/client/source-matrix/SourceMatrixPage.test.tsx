// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { useState } from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import SourceMatrixPage from './SourceMatrixPage';
import { PublishingFlowProvider,type PublishingFlow } from '../PublishingFlowContext';
import type { MediaResource,PublicationDraft } from '../types';
import type { MatrixResult } from './types';
const mediaGateway=vi.hoisted(()=>({listMedia:vi.fn(),getDraft:vi.fn(),getArticleVersion:vi.fn(),createDraft:vi.fn(),updateDraftMedia:vi.fn()}));
vi.mock('../PublishingContext',()=>({usePublisherGateway:()=>mediaGateway}));
beforeEach(()=>{Object.values(mediaGateway).forEach(mock=>mock.mockReset());vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState({},'', '/');});
it('shows the unconfigured industry state without invented media',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({status:'configuration_required',industries:[],message:'行业数据尚未配置'})})));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByText('行业数据尚未配置');expect((screen.getByLabelText('目标行业') as HTMLSelectElement).disabled).toBe(false);expect(screen.queryByText('加入组合偏好')).toBeNull();
});
it('renders a structured stale result without reading nonexistent matrix fields',async()=>{
 window.history.replaceState({},'', '/publishing/source-analysis?task=task');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('/industries')?{industries:[]}:{task_id:'task',state:'complete',result:{status:'stale_matrix',errors:[{code:'stale_matrix',message:'任务已变化，请重新生成'}]}}})));
 render(<div className="monitoring-module"><SourceMatrixPage view="analysis"/></div>);
 await screen.findByText('任务已变化，请重新生成');await waitFor(()=>expect(screen.getByText('暂无匹配的输入引用数据')).toBeTruthy());
});

const media:MediaResource={id:'media-1',externalResourceId:'external-1',name:'可投媒体',shortName:'可投',kind:'news',platform:'新闻',taxonomy:'',mediaType:'',channel:'',region:'',titleLimit:200,priceTenThousandths:'1000000',turnaround:'',active:true,capability:'image',catalogRevision:'catalog-1',logoSource:'generated_fallback',logoResolutionStatus:'missing'};
function draft(id='draft-1',revision=1,items:MediaResource[]=[]):PublicationDraft{return {id,revision,articleId:'article-1',articleVersionId:'version-1',articleTitle:'当前稿件',articleVersion:1,articleVersionHash:'hash-1',articleContainsImages:false,titleMode:'per_media',items:items.map(media=>({media,title:'当前稿件'})),updatedAt:'2026-10-24T00:00:00Z'};}
const matrix:MatrixResult={status:'complete',plan_id:'plan-1',plan_version:'plan-version-1',matrix_version:'matrix-version-1',as_of:'2026-10-24T00:00:00Z',scope:{task:{},evidence_scope:{}},matrix:{status:'complete',candidates:[{candidate_id:'candidate-1',resource_id:'external-1',attributes:{source_name:'可投媒体'},offers:[],primary_role:null,auxiliary_roles:[],selection:'',matched_questions:[],channel_status:'eligible',manuscript_status:'compatible',hard_failures:[],pending_conditions:[],evidence_relation:'',evidence_ids:[],aggregate_ids:[]}],layers:[],fit_order:['candidate-1']},source_analysis:{status:'complete',known_detail_count:0,total_citations:0,groups:[],actual_sources:[],domain_rollups:[],detail_citations:[],external_aggregates:[],supplier_claims:[],unknown_records:[],content_age:null},budget_plans:[],limitations:[],warnings:[],errors:[],minimum_known_cost:null};
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
 window.history.replaceState({},'', '/publishing/source-industry?task=matrix-1&'+query);
 const page=<div className="monitoring-module"><SourceMatrixPage view="industry"/></div>;
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
 expect(window.location.pathname).toBe('/publishing/source-industry');
 const home=new URL((screen.getByRole('link',{name:'媒体库首页'}) as HTMLAnchorElement).href);
 expect(home.pathname).toBe('/publishing/drafts/draft-1/media');
 expect(Object.fromEntries(home.searchParams)).toMatchObject({articleVersion:'version-1',mode:'multi',workbenchTask:'workbench-1',matrixTask:'matrix-1',enterpriseProjectId:'project-1',operatorOwnerId:'owner-1'});
 expect(home.searchParams.has('task')).toBe(false);
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
  return <PublishingFlowProvider value={current}><div className="monitoring-module"><SourceMatrixPage view="industry"/></div></PublishingFlowProvider>;
 }
 window.history.replaceState({},'', '/publishing/source-industry?task=matrix-1&articleVersion=version-1&mode=multi');
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
 await screen.findByText('当前稿件含图片，此媒体的图文能力尚未确认');
 expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).disabled).toBe(true);
 expect(mediaGateway.createDraft).not.toHaveBeenCalled();
});

it('ignores an old draft update after changing the bound draft',async()=>{
 liveDirectory();let resolveUpdate!:(value:PublicationDraft)=>void;
 mediaGateway.updateDraftMedia.mockImplementation(()=>new Promise<PublicationDraft>(resolve=>{resolveUpdate=resolve;}));
 mediaGateway.getDraft.mockImplementation(async(id:string)=>draft(id));
 openMatrix('draftId=draft-1&articleVersion=version-1');
 const checkbox=await screen.findByRole('checkbox',{name:'选择 可投媒体 新闻'});
 await waitFor(()=>expect((checkbox as HTMLInputElement).disabled).toBe(false));fireEvent.click(checkbox);
 await waitFor(()=>expect(mediaGateway.updateDraftMedia).toHaveBeenCalledWith('draft-1',[media.id],1));
 await act(async()=>{window.history.pushState({},'', '/publishing/source-industry?task=matrix-1&draftId=draft-2&articleVersion=version-1');window.dispatchEvent(new PopStateEvent('popstate'));});
 await waitFor(()=>expect(mediaGateway.getDraft).toHaveBeenCalledWith('draft-2',expect.any(AbortSignal)));
 await act(async()=>resolveUpdate(draft('draft-1',2,[media])));
 await waitFor(()=>expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).disabled).toBe(false));
 expect((screen.getByRole('checkbox',{name:'选择 可投媒体 新闻'}) as HTMLInputElement).checked).toBe(false);
 expect((screen.getByRole('link',{name:'媒体库首页'}) as HTMLAnchorElement).pathname).toBe('/publishing/drafts/draft-2/media');
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
 expect((screen.getByRole('link',{name:'第三方媒体列表'}) as HTMLAnchorElement).pathname).toBe('/publishing/drafts/draft-1/media/third');
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
