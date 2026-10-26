import { afterEach,expect,it,vi } from 'vitest';
import express from 'express';
import { createServer,type Server } from 'node:http';
import { once } from 'node:events';
import { createModuleHttpApi,type ModuleHttpCore } from '../http-api.js';
import { MatrixRepository } from './repository.js';
import { BindingStore } from './binding.js';
import { digest } from './common.js';
import * as catalogBridge from '../publisher-source-matrix-catalog.js';
import * as plannerKernel from './planner.js';
const servers:Server[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(servers.splice(0).map(s=>new Promise<void>((resolve,reject)=>s.close(e=>e?reject(e):resolve()))));});
async function host(core:ModuleHttpCore){const app=express();app.use('/api/modules/publish',createModuleHttpApi(core));const server=createServer(app);servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No test address');return `http://127.0.0.1:${address.port}`;}
const context={accountUserId:1,actorUserId:1,enterpriseProjectId:'p',businessOwnerId:'owner',businessActorId:'actor'};
function core(overrides:Partial<ModuleHttpCore>={}):ModuleHttpCore{vi.spyOn(catalogBridge,'loadPlannerCatalog').mockResolvedValue([]);return {context:()=>context,environment:{},database:async()=>{throw Object.assign(new Error('missing schema'),{code:'ER_NO_SUCH_TABLE'});},...overrides};}
it('rejects cross-origin mutations before accessing data',async()=>{
 let accessed=false;const url=await host(core({database:async()=>{accessed=true;throw new Error('must not query');}}));
 const response=await fetch(url+'/api/modules/publish/matrix/generate',{method:'POST',headers:{Origin:'https://other.invalid','Content-Type':'application/json'},body:'{}'});
 expect(response.status).toBe(403);expect(accessed).toBe(false);
});
it('does not accept browser tenant, brand, trusted facts or decisions',async()=>{
 let accessed=false;const url=await host(core({database:async()=>{accessed=true;throw new Error('must not query');}}));
 for(const extra of [{tenant_id:'other'},{brand_id:'other'},{catalog:[]},{decisions:{matrix_decisions:{}}}]){
  const response=await fetch(url+'/api/modules/publish/matrix/generate',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({industry_id:'i',questions:['问题'],as_of:'2026-10-20T00:00:00Z',...extra})});expect(response.status).toBe(400);
 }expect(accessed).toBe(false);
});
it('shows configuration_required rather than sample industry data on missing storage',async()=>{
 const url=await host(core()),response=await fetch(url+'/api/modules/publish/industries');expect(response.status).toBe(503);expect((await response.json()).status).toBe('configuration_required');
});
it('requires a server-authorized enterprise project',async()=>{
 const url=await host(core({context:()=>({...context,enterpriseProjectId:null})})),response=await fetch(url+'/api/modules/publish/industries');expect(response.status).toBe(403);
});
it('reads distribution before any planner task using context ownership and no-store caching',async()=>{
 let observedTenant='';
 vi.spyOn(MatrixRepository.prototype,'sourceDistribution').mockImplementation(async function(this:MatrixRepository){observedTenant=this.tenantId;return {status:'ready',batches:[]};});
 const taskRead=vi.spyOn(MatrixRepository.prototype,'get').mockRejectedValue(new Error('must not read a task'));
 const url=await host(core({database:async()=>({} as any)}));
 const response=await fetch(url+'/api/modules/publish/source-distribution?tenant_id=other&industry_id=private');
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect((await response.json()).status).toBe('ready');expect(taskRead).not.toHaveBeenCalled();
 expect(observedTenant).toBe('publish-'+digest({project:context.enterpriseProjectId,owner:context.businessOwnerId}));
});
it('returns unavailable distribution without storage diagnostics or sample fallback',async()=>{
 vi.spyOn(console,'warn').mockImplementation(()=>undefined);
 const url=await host(core()),response=await fetch(url+'/api/modules/publish/source-distribution');
 const body=await response.json();expect(response.status).toBe(503);expect(body).toMatchObject({status:'configuration_required',batches:[]});
 expect(body.message).not.toContain('迁移');expect(JSON.stringify(body)).not.toContain('一航');
});
it('exports the requested authenticated snapshot rather than a newer latest result',async()=>{
 const planId='plan-'+'a'.repeat(24),version='plan-version-'+'b'.repeat(24);
 vi.spyOn(MatrixRepository.prototype,'get').mockResolvedValue({taskId:'task-1',state:'complete',latest:{report:{revision:'newer'}}} as any);
 const snapshot=vi.spyOn(MatrixRepository.prototype,'snapshot').mockImplementation(async function(this:MatrixRepository,taskId:string,plan:string,revision:string){
  expect(this.tenantId).toBe('publish-'+digest({project:context.enterpriseProjectId,owner:context.businessOwnerId}));
  expect([taskId,plan,revision]).toEqual(['task-1',planId,version]);return {report:{revision:'visible-snapshot'}};
 });
 const url=await host(core({database:async()=>({} as any)}));
 const response=await fetch(url+`/api/modules/publish/classify/task-1/download?plan_id=${planId}&plan_version=${version}`);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({revision:'visible-snapshot'});
 expect(response.headers.get('cache-control')).toBe('private, no-store');expect(snapshot).toHaveBeenCalledOnce();
});
it('keeps the latest-report download compatible when no snapshot identifiers are supplied',async()=>{
 vi.spyOn(MatrixRepository.prototype,'get').mockResolvedValue({taskId:'task-1',state:'complete',latest:{report:{revision:'latest'}}} as any);
 const snapshot=vi.spyOn(MatrixRepository.prototype,'snapshot');
 const url=await host(core({database:async()=>({} as any)})),response=await fetch(url+'/api/modules/publish/classify/task-1/download');
 expect(response.status).toBe(200);expect(await response.json()).toEqual({revision:'latest'});expect(snapshot).not.toHaveBeenCalled();
});
it('rejects incomplete, malformed, repeated or additional download query keys before accessing storage',async()=>{
 let accessed=false;const url=await host(core({database:async()=>{accessed=true;throw new Error('must not query');}}));
 const planId='plan-'+'a'.repeat(24),version='plan-version-'+'b'.repeat(24);
 for(const query of [`plan_id=${planId}`,`plan_version=${version}`,`plan_id=invalid&plan_version=${version}`,`plan_id=${planId}&plan_id=${planId}&plan_version=${version}`,`plan_id=${planId}&plan_version=${version}&tenant_id=other`]){
  const response=await fetch(url+'/api/modules/publish/classify/task-1/download?'+query);expect(response.status).toBe(400);
 }expect(accessed).toBe(false);
});
it('does not fall back to latest for a missing snapshot, cancelled task or snapshot without a report',async()=>{
 const task=vi.spyOn(MatrixRepository.prototype,'get').mockResolvedValue({taskId:'task-1',state:'complete',latest:{report:{revision:'latest'}}} as any);
 const snapshot=vi.spyOn(MatrixRepository.prototype,'snapshot').mockResolvedValue(undefined);
 const url=await host(core({database:async()=>({} as any)}));
 const href=url+'/api/modules/publish/classify/task-1/download?plan_id=plan-'+'a'.repeat(24)+'&plan_version=plan-version-'+'b'.repeat(24);
 const missing=await fetch(href);expect(missing.status).toBe(409);expect(await missing.json()).toEqual({status:'report_unavailable'});
 snapshot.mockResolvedValue({matrix:{status:'complete'}});
 const noReport=await fetch(href);expect(noReport.status).toBe(409);
 snapshot.mockClear();task.mockResolvedValue({taskId:'task-1',state:'cancelled',latest:{report:{revision:'latest'}}} as any);
 const cancelled=await fetch(href);expect(cancelled.status).toBe(409);expect(snapshot).not.toHaveBeenCalled();
});
const bindingRow={draft_id:'3f0d1111-1111-4111-8111-111111111111',article_version_id:'5aab2222-2222-4222-8222-222222222222',article_id:'article-1',version_number:1,content_hash:'hash-1',article_title:'验收稿件',fingerprint:'fp-1'};
it('binds matrix generation to the server-verified frozen version and persists the binding fingerprint',async()=>{
 const create=vi.spyOn(MatrixRepository.prototype,'create').mockResolvedValue(undefined);
 vi.spyOn(MatrixRepository.prototype,'industry').mockResolvedValue({industryId:'industry-1',name:'软件测试',brandId:'brand-1',dataset:{}} as any);
 const loadBinding=vi.spyOn(BindingStore.prototype,'loadBinding').mockResolvedValue({binding:{draftId:'3f0d1111-1111-4111-8111-111111111111',draftRevision:3,draftStatus:'draft',articleVersionId:'5aab2222-2222-4222-8222-222222222222',articleId:'article-1',versionNumber:1,contentHash:'hash-1',containsImages:false,articleTitle:'验收稿件',selections:[],fingerprint:'fp-1'}});
 const url=await host(core({database:async()=>({} as any),sourceMatrixDecisions:{matrix:async()=>undefined,budget:async()=>undefined}}));
 const response=await fetch(url+'/api/modules/publish/matrix/generate',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({industry_id:'industry-1',questions:['如何选型'],as_of:'2026-10-24T00:00:00Z',draft_id:'3f0d1111-1111-4111-8111-111111111111',article_version_id:'5aab2222-2222-4222-8222-222222222222'})});
 expect(response.status).toBe(202);
 const task=create.mock.calls[0]![3] as any;
 expect(task.binding).toEqual({...bindingRow,bound_at:'2026-10-24T00:00:00Z'});
 const body=await response.json();
 expect(body.result.scope.task.manuscripts).toEqual([{article_id:'article-1',version:'v1',title:'验收稿件',content_hash:'hash-1',contains_images:false,source:'trusted_article_version'}]);
 expect(body.result.scope.task.binding).toEqual({...bindingRow,bound_at:'2026-10-24T00:00:00Z'});
 expect(loadBinding).toHaveBeenCalledWith({draftId:'3f0d1111-1111-4111-8111-111111111111',articleVersionId:'5aab2222-2222-4222-8222-222222222222'});
});
it('rejects matrix generation when the named draft or frozen version is outside the authorized owner',async()=>{
 vi.spyOn(MatrixRepository.prototype,'industry').mockResolvedValue({industryId:'industry-1',name:'软件测试',brandId:'brand-1',dataset:{}} as any);
 vi.spyOn(BindingStore.prototype,'loadBinding').mockResolvedValue({failure:'draft_not_found'});
 const url=await host(core({database:async()=>({} as any)}));
 const response=await fetch(url+'/api/modules/publish/matrix/generate',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({industry_id:'industry-1',questions:['如何选型'],as_of:'2026-10-24T00:00:00Z',draft_id:'3f0d1111-1111-4111-8111-111111111111',article_version_id:'5aab2222-2222-4222-8222-222222222222'})});
 expect(response.status).toBe(404);expect((await response.json()).status).toBe('binding_not_found');
});
it('blocks budget recomputation when the bound article content has changed',async()=>{
 const stored={...bindingRow,draft_id:'3f0d1111-1111-4111-8111-111111111111'};
 vi.spyOn(MatrixRepository.prototype,'get').mockResolvedValue({taskId:'task-1',state:'complete',latest:{plan_version:'plan-version-'+'b'.repeat(24)},task:{binding:stored},industryId:'industry-1'} as any);
 vi.spyOn(MatrixRepository.prototype,'snapshot').mockResolvedValue({matrix_version:'matrix-1'} as any);
 vi.spyOn(MatrixRepository.prototype,'industry').mockResolvedValue({industryId:'industry-1',name:'软件测试',brandId:'brand-1',dataset:{}} as any);
 vi.spyOn(BindingStore.prototype,'loadBinding').mockResolvedValue({binding:{draftId:'3f0d1111-1111-4111-8111-111111111111',draftRevision:4,draftStatus:'draft',articleVersionId:'5aab2222-2222-4222-8222-222222222222',articleId:'article-1',versionNumber:1,contentHash:'hash-new',containsImages:false,articleTitle:'验收稿件',selections:[],fingerprint:'fp-other'}});
 const url=await host(core({database:async()=>({} as any)}));
 const response=await fetch(url+'/api/modules/publish/classify/task-1/budget',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({plan_id:'plan-'+'a'.repeat(24),plan_version:'plan-version-'+'b'.repeat(24),budget:{currency:'CNY',total_cap:'100'},as_of:'2026-10-24T00:00:00Z'})});
 expect(response.status).toBe(409);expect((await response.json()).status).toBe('stale_binding');
});
const applicablePlan={budget_feasible:true,is_estimate:false,unknown_items:[],errors:[],items:[{article_id:'article-1',version:'v1',resource_id:'media-1',offer_id:'offer-1',publication_spec:{channel:'news'},quantity:1,purpose:'standard'}]};
function applyHost(){
 vi.spyOn(MatrixRepository.prototype,'get').mockResolvedValue({taskId:'task-1',state:'complete',latest:{status:'complete',plan_version:'plan-version-'+'b'.repeat(24)},task:{binding:{...bindingRow}},industryId:'industry-1'} as any);
 vi.spyOn(MatrixRepository.prototype,'snapshot').mockResolvedValue({budget_plans:[applicablePlan],scope:{input_snapshot:{budget:{currency:'CNY',total_cap:'3000'}}}} as any);
 vi.spyOn(MatrixRepository.prototype,'industry').mockResolvedValue({industryId:'industry-1',brandId:'brand-1',dataset:{}} as any);
 // Route tests isolate the kernel; deterministic quote arithmetic and stale
 // semantic checks have their own planner/content-plan regression fixtures.
 vi.spyOn(plannerKernel,'runPlanner').mockReturnValue({status:'complete',budget_plans:[{...applicablePlan,semantic_ready:true}]} as any);
 const store=BindingStore.prototype;
 vi.spyOn(store,'loadBinding').mockResolvedValue({binding:{draftId:'3f0d1111-1111-4111-8111-111111111111',draftRevision:3,draftStatus:'draft',articleVersionId:'5aab2222-2222-4222-8222-222222222222',articleId:'article-1',versionNumber:1,contentHash:'hash-1',containsImages:false,articleTitle:'验收稿件',selections:[],fingerprint:'fp-1'}});
 vi.spyOn(store,'loadDraftItems').mockResolvedValue([]);
 vi.spyOn(store,'loadMediaResources').mockResolvedValue(resources());
 return store;
}
async function postApply(url:string,body:Record<string,unknown>){
 return fetch(url+'/api/modules/publish/classify/task-1/apply-plan',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify(body)});
}
const applyBody={plan_id:'plan-'+'a'.repeat(24),plan_version:'plan-version-'+'b'.repeat(24),plan_index:0,draft_id:'3f0d1111-1111-4111-8111-111111111111',article_version_id:'5aab2222-2222-4222-8222-222222222222',expected_revision:3,preview:true};
it('previews the archived plan against the live catalogue without writing the cart',async()=>{
 const store=applyHost();const insert=vi.spyOn(store,'insertPlanItems');
 const url=await host(core({database:async()=>({} as any)}));
 const response=await postApply(url,applyBody);
 expect(response.status).toBe(200);
 const body=await response.json();
 expect(body.status).toBe('ok');expect(body.additions).toHaveLength(1);
 expect(body.additions[0]).toMatchObject({mediaResourceId:'media-1',offerId:'offer-1',priceTenThousandths:'1000000'});
 expect(insert).not.toHaveBeenCalled();
});
it('applies the previewed plan inside the transaction and returns the new revision',async()=>{
 const store=applyHost();
 const insert=vi.spyOn(store,'insertPlanItems').mockResolvedValue({ok:true,revision:4} as any);
 const url=await host(core({database:async()=>({} as any)}));
 const response=await postApply(url,{...applyBody,preview:false});
 expect(response.status).toBe(200);
 const body=await response.json();
 expect(body.draft).toEqual({id:'3f0d1111-1111-4111-8111-111111111111',revision:4});
 const input=insert.mock.calls[0]![0] as any;
 expect(input.expectedRevision).toBe(3);
 expect(input.planIdentity).toMatchObject({taskId:'task-1',planIndex:0});
 expect(input.mediaSnapshotFor(resources().get('media-1')!,input.additions[0]).publication).toMatchObject({source:'source_matrix_budget_plan',offerId:'offer-1',quantity:1});
});
function resources(){return new Map([['media-1',{id:'media-1',name:'媒体一',externalResourceId:'ext-1',mediaKind:'news',priceTenThousandths:'1000000',catalogRevision:'cat-1',remark:null,titleLimit:null,rawPayload:{publisher_quote_v1:{offer_id:'offer-1',publication_spec:{channel:'news'},provider_resource_id:'ext-1',provider_execution:'independent_unit_orders',pricing:{kind:'unit',amount:'100.00',currency:'CNY',quoted_at:'2020-01-01T00:00:00Z',valid_until:'2099-01-01T00:00:00Z',mandatory_fees:[]}}},imageSupport:'unknown' as const}]]);}
it('refuses unverified, estimated or unknown-cost plans and unknown apply-plan fields',async()=>{
 applyHost();
 const url=await host(core({database:async()=>({} as any)}));
 const bad=await postApply(url,{...applyBody,extra:'field'});expect(bad.status).toBe(400);
 vi.spyOn(MatrixRepository.prototype,'snapshot').mockResolvedValue({budget_plans:[{...applicablePlan,budget_feasible:false}]} as any);
 const notFeasible=await postApply(url,applyBody);expect(notFeasible.status).toBe(409);expect((await notFeasible.json()).status).toBe('plan_not_applicable');
});
it('surfaces revision conflicts instead of overwriting a concurrently changed cart',async()=>{
 const store=applyHost();
 vi.spyOn(store,'insertPlanItems').mockResolvedValue({ok:false,reason:'revision_conflict'} as any);
 const url=await host(core({database:async()=>({} as any)}));
const response=await postApply(url,{...applyBody,preview:false});
 expect(response.status).toBe(409);expect((await response.json()).status).toBe('revision_conflict');
});

it('refuses cancelled and superseded plans before loading publication items',async()=>{
 const store=applyHost(),items=vi.mocked(store.loadDraftItems);items.mockClear();
 vi.spyOn(MatrixRepository.prototype,'get').mockResolvedValue({taskId:'task-1',state:'cancelled',latest:{plan_version:applyBody.plan_version}} as any);
 const url=await host(core({database:async()=>({} as any)})),response=await postApply(url,applyBody);
 expect(response.status).toBe(409);expect((await response.json()).status).toBe('stale_plan');expect(items).not.toHaveBeenCalled();
 vi.spyOn(MatrixRepository.prototype,'get').mockResolvedValue({taskId:'task-1',state:'complete',latest:{plan_version:'newer'}} as any);
 expect((await postApply(url,applyBody)).status).toBe(409);
});

it('feeds the selected brand batch and demand constraints into the planner request',async()=>{
 const create=vi.spyOn(MatrixRepository.prototype,'create').mockResolvedValue(undefined);
 vi.spyOn(MatrixRepository.prototype,'industry').mockResolvedValue({industryId:'industry-1',name:'软件测试',brandId:'brand-1',dataset:{}} as any);
 const url=await host(core({database:async()=>({} as any),sourceMatrixDecisions:{matrix:async()=>undefined,budget:async()=>undefined}}));
 const response=await fetch(url+'/api/modules/publish/matrix/generate',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({industry_id:'industry-1',questions:['如何选型'],as_of:'2026-10-25T00:00:00Z',hours:'48',requirements:['链接'],brand_data:'sha256:639e43735887ff20852f99aa4bc643853259dbd7f44aba163598064720a60e0d',sample_platforms:['通义千问-手机版']})});
 expect(response.status).toBe(202);
 const task=create.mock.calls[0]![3] as any;
 expect(task.hours).toBe('48');
 expect(task.requirements).toEqual({links:true});
 expect(task.brand).toMatchObject({platforms:['通义千问-手机版']});
 const body=await response.json();
 // 平台过滤后的 49 条样本观察进入推荐输入；缺回答 ID 按契约记为 incomplete 观察，
 // 不冒充有效 detail 计数（known_detail_count 保持 0，原始观察保留在 unknown/actual_sources）
 expect(body.result.research_observation.raw_rows).toBe(49);
 expect(body.result.research_observation.exact_citation_count).toBeNull();
 expect(body.result.scope.input_snapshot.citations).toEqual([]);
 expect(body.result.matrix.candidates.some((candidate:any)=>candidate.attributes.data_kind==='raw_brand_observation_context')).toBe(true);
 expect(body.result.scope.task.brand.batch_id).toBe('sha256:639e43735887ff20852f99aa4bc643853259dbd7f44aba163598064720a60e0d');
});
