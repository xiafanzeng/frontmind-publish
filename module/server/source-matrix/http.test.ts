import { afterEach,expect,it } from 'vitest';
import express from 'express';
import { createServer,type Server } from 'node:http';
import { once } from 'node:events';
import { createModuleHttpApi,type ModuleHttpCore } from '../http-api.js';
const servers:Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise<void>((resolve,reject)=>s.close(e=>e?reject(e):resolve()))));});
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
