import { afterEach,expect,it,vi } from 'vitest';
import express from 'express';
import { createServer,type Server } from 'node:http';
import { once } from 'node:events';
import { createModuleHttpApi,type ModuleHttpCore } from '../http-api.js';
import { MatrixRepository } from './repository.js';
import { digest } from './common.js';
const servers:Server[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(servers.splice(0).map(s=>new Promise<void>((resolve,reject)=>s.close(e=>e?reject(e):resolve()))));});
async function host(core:ModuleHttpCore){const app=express();app.use('/api/modules/publish',createModuleHttpApi(core));const server=createServer(app);servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('No test address');return `http://127.0.0.1:${address.port}`;}
const context={accountUserId:1,actorUserId:1,enterpriseProjectId:'p',businessOwnerId:'owner',businessActorId:'actor'};
function core(overrides:Partial<ModuleHttpCore>={}):ModuleHttpCore{return {context:()=>context,environment:{},database:async()=>{throw Object.assign(new Error('missing schema'),{code:'ER_NO_SUCH_TABLE'});},...overrides};}
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
