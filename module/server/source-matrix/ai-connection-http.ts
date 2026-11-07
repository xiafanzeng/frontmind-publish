import { createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID } from 'node:crypto';
import { Router,json,type Request,type Response,type NextFunction } from 'express';
import { and,eq,lt } from 'drizzle-orm';
import { z } from 'zod';
import type { ModuleHttpCore } from '../http-api.js';
import type { SourceMatrixDecisionAdapter } from './adapter.js';
import { createDecisionAdapter,createEnvDecisionAdapter } from './decisions.js';
import { digest } from './common.js';
import { sourceMatrixConnections as connections,sourceMatrixConnectionTests as tests } from '../../schema/source-matrix-connections.js';
import { endpointFor,invokeAi,listProviderModels,type AiSettings } from './ai-connection-provider.js';

export interface SafeConnection {
 id:string;revision:string;name:string;provider:string;model:string;maskedKey:string;
 region?:string;workspace?:string;azureEndpoint?:string;requiresAdminEndpoint?:boolean;settingsUnavailable?:boolean;
}
type Mode='host'|'user'|'environment'|'none';
type PublicFailure=Error&{status:number;code:string;publicMessage:string};
function failure(status:number,code:string,publicMessage:string):PublicFailure {
 return Object.assign(new Error(code),{status,code,publicMessage});
}
function encryptionKey(core:ModuleHttpCore):Buffer {
 const value=core.environment.FRONTMIND_SOURCE_MATRIX_CREDENTIAL_KEY||'';
 const key=Buffer.from(value,'base64');
 if(key.length!==32||key.toString('base64')!==value)throw failure(503,'configuration_required','连接服务尚未配置加密密钥，请联系管理员');
 return key;
}
function sealed(core:ModuleHttpCore,scope:string,value:AiSettings):string {
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(core),nonce);
 cipher.setAAD(Buffer.from(scope));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return [nonce.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');
}
function unseal(core:ModuleHttpCore,scope:string,value:string):AiSettings {
 try{
  const [iv,tag,data]=value.split('.');
  if(!iv||!tag||!data)throw new Error('invalid');
  const cipher=createDecipheriv('aes-256-gcm',encryptionKey(core),Buffer.from(iv,'base64'));
  cipher.setAAD(Buffer.from(scope));cipher.setAuthTag(Buffer.from(tag,'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8')) as AiSettings;
 }catch{throw failure(503,'configuration_required','连接凭据无法读取，请联系管理员');}
}
function scopeOf(core:ModuleHttpCore,req:Request){
 const ctx=core.context(req);
 if(!ctx.enterpriseProjectId||!ctx.businessOwnerId||!ctx.actorUserId)throw failure(403,'forbidden','需要已授权企业项目');
 const tenantId='publish-'+digest({project:ctx.enterpriseProjectId,owner:ctx.businessOwnerId});
 const actorId=digest({account:ctx.accountUserId,actor:ctx.actorUserId});
 return {tenantId,actorId,scope:`${tenantId}:${actorId}`};
}
function sqlCode(error:unknown):string|undefined {
 const item=error as {code?:string;cause?:{code?:string}}|null;
 return item?.code||item?.cause?.code;
}
function dbFailure(error:unknown):never {
 if(error instanceof Error&&'publicMessage'in error)throw error;
 const code=sqlCode(error);
 if(code==='ER_NO_SUCH_TABLE'||code==='ER_BAD_TABLE_ERROR')throw failure(503,'configuration_required','连接数据表尚未迁移，请联系管理员');
 if(code==='ER_DUP_ENTRY')throw failure(409,'stale_connection','连接已被更改，请刷新后重试');
 throw failure(503,'connection_storage_unavailable','连接存储暂不可用，请稍后重试');
}
const provider=z.enum(['openai','deepseek','dashscope','glm','claude','gemini','siliconflow','azure-openai','azure-foundry']);
const providerLabels:Record<AiSettings['provider'],string>={openai:'OpenAI',deepseek:'DeepSeek',dashscope:'通义千问／阿里云百炼',glm:'智谱 GLM',claude:'Anthropic Claude',gemini:'Google Gemini',siliconflow:'硅基流动', 'azure-openai':'Azure OpenAI', 'azure-foundry':'Microsoft Foundry'};
const connectionFields={
 provider,apiKey:z.string().trim().min(4).max(512),
 region:z.enum(['cn-beijing','ap-southeast-1','us-east-1']).optional(),
 workspace:z.string().trim().regex(/^[a-z0-9-]{1,120}$/).optional(),
 azureEndpoint:z.string().trim().url().max(500).optional(),
 expectedRevision:z.string().uuid().nullable().optional(),
};
function matchingProviderFields(value:{provider:AiSettings['provider'];region?:string;workspace?:string;azureEndpoint?:string}):boolean {
 const azure=value.provider==='azure-openai'||value.provider==='azure-foundry';
 return (value.provider==='dashscope'||value.region===undefined&&value.workspace===undefined)&&
  (azure?!!value.azureEndpoint:value.azureEndpoint===undefined);
}
const testBody=z.object({
 ...connectionFields,name:z.string().trim().max(100).optional(),model:z.string().trim().min(1).max(160).regex(/^[\w.\-:/]+$/),
}).strict().refine(matchingProviderFields);
const modelsBody=z.object(connectionFields).strict().refine(matchingProviderFields);
const saveBody=z.object({testToken:z.string().regex(/^[a-f0-9]{64}$/),expectedRevision:z.string().uuid().nullable().optional()}).strict();
const removeBody=z.object({expectedRevision:z.string().uuid()}).strict();
function mask(key:string){return key.length>8?`••••${key.slice(-4)}`:'••••';}
function safe(row:typeof connections.$inferSelect,settings?:AiSettings):SafeConnection {
 return {
  id:row.id,revision:row.revision,name:row.name,provider:row.provider,model:row.model,maskedKey:row.maskedKey,
  ...(settings?{
   ...(settings.region?{region:settings.region}:{}),...(settings.workspace?{workspace:settings.workspace}:{}),
   ...(settings.azureEndpoint?{azureEndpoint:settings.azureEndpoint}:{}),
   ...(settings.baseUrl?{requiresAdminEndpoint:true}:{}),
  }:{settingsUnavailable:true}),
 };
}
function tokenHash(value:string){return createHash('sha256').update(value).digest('hex');}
function activeWhere(scope:{tenantId:string;actorId:string}){return and(eq(connections.tenantId,scope.tenantId),eq(connections.actorId,scope.actorId));}
function testWhere(scope:{tenantId:string;actorId:string},hash:string){return and(eq(tests.tenantId,scope.tenantId),eq(tests.actorId,scope.actorId),eq(tests.tokenHash,hash));}
function envOrNone(core:ModuleHttpCore):{mode:Mode;available:boolean;message?:string}{
 return createEnvDecisionAdapter(core.environment)?{mode:'environment',available:true}:{mode:'none',available:false,message:'尚未配置可用的 AI 连接'};
}

function savedState(core:ModuleHttpCore,scope:string,row:typeof connections.$inferSelect|undefined){
 let settings:AiSettings|undefined,problem:string|undefined;
 if(row){
  try{settings=unseal(core,scope,row.ciphertext);}catch{problem='已保存的个人连接配置无法读取，请联系管理员。';}
  if(settings){try{endpointFor(settings,core.environment);}catch{problem='已保存的个人连接地址或地域不可用，请检查设置或联系管理员。';}}
 }
 const connection=row?safe(row,settings):null;
 if(core.sourceMatrixDecisions)return {connection,mode:'host' as const,available:true,message:problem?'当前使用平台统一模型。'+problem:'当前使用平台统一模型，保存个人连接后暂不参与生成。'};
 if(!row)return {connection,...envOrNone(core)};
 return {connection,mode:'user' as const,available:!problem,...(problem?{message:problem}:{})};
}

async function editableConnection(core:ModuleHttpCore,scope:ReturnType<typeof scopeOf>,expectedRevision?:string|null){
 let current:typeof connections.$inferSelect|undefined;
 try{current=(await (await core.database()).select().from(connections).where(activeWhere(scope)).limit(1))[0];}catch(error){dbFailure(error);}
 if((current?.revision||null)!==(expectedRevision||null))throw failure(409,'stale_connection','连接已被更改，请刷新后重试');
 if(current&&unseal(core,scope.scope,current.ciphertext).baseUrl)throw failure(409,'legacy_endpoint_readonly','此连接使用管理员配置的接口地址，请联系管理员修改；原连接已保留。');
 return current;
}

export async function resolveUserDecisionAdapter(core:ModuleHttpCore,req:Request,expectedRevision?:string):Promise<{adapter?:SourceMatrixDecisionAdapter;connection?:{id:string;revision:string;provider:string;model:string};mode:Mode}> {
 if(core.sourceMatrixDecisions){
  if(expectedRevision)throw failure(409,'connection_changed','系统模型配置已更改，请刷新后重新生成');
  return {adapter:core.sourceMatrixDecisions,mode:'host'};
 }
 const scope=scopeOf(core,req);
 let row:typeof connections.$inferSelect|undefined;
 try{row=(await (await core.database()).select().from(connections).where(activeWhere(scope)).limit(1))[0];}
 catch(error){
  if(expectedRevision)dbFailure(error);
  if(sqlCode(error)==='ER_NO_SUCH_TABLE')return {adapter:createEnvDecisionAdapter(core.environment),mode:envOrNone(core).mode};
  dbFailure(error);
 }
 if(expectedRevision&&row?.revision!==expectedRevision)throw failure(409,'stale_connection','连接已更换或移除，请重新生成');
 if(!row)return {adapter:createEnvDecisionAdapter(core.environment),mode:envOrNone(core).mode};
 const settings=unseal(core,scope.scope,row.ciphertext);
 endpointFor(settings,core.environment);
 return {adapter:createDecisionAdapter(messages=>invokeAi(settings,core.environment,messages)),connection:{id:row.id,revision:row.revision,provider:row.provider,model:row.model},mode:'user'};
}

export function createAiConnectionRouter(core:ModuleHttpCore):Router {
 const router=Router();router.use(json({limit:'8kb'}));
 router.use((req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST'){next();return;}
  const origin=req.get('Origin'),host=req.get('Host');
  if(req.get('Sec-Fetch-Site')==='cross-site'||!origin||!host){next(failure(403,'forbidden','请从当前站点提交'));return;}
  try{if(new URL(origin).host!==host){next(failure(403,'forbidden','请从当前站点提交'));return;}}catch{next(failure(403,'forbidden','请从当前站点提交'));return;}
  next();
 });
 const wrap=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
 router.get('/matrix/connection',wrap(async(req,res)=>{
  const scope=scopeOf(core,req);
  try{
   const row=(await (await core.database()).select().from(connections).where(activeWhere(scope)).limit(1))[0];
   res.json(savedState(core,scope.scope,row));
  }catch(error){
   if(sqlCode(error)==='ER_NO_SUCH_TABLE'){
    if(core.sourceMatrixDecisions){res.json({connection:null,mode:'host',available:true,message:'连接数据表尚未迁移；当前使用系统模型'});return;}
    const state=envOrNone(core);res.json({connection:null,...state,message:'连接数据表尚未迁移；'+(state.mode==='environment'?'当前使用系统环境模型':'请联系管理员')});return;
   }
   dbFailure(error);
  }
 }));
 router.post('/matrix/connection/models',wrap(async(req,res)=>{
  const parsed=modelsBody.safeParse(req.body);if(!parsed.success)throw failure(400,'invalid_input','请检查服务商和 API Key');
  const scope=scopeOf(core,req);
  const input=parsed.data;
  await editableConnection(core,scope,input.expectedRevision);
  const config={provider:input.provider,apiKey:input.apiKey,region:input.region,workspace:input.workspace,azureEndpoint:input.azureEndpoint};
  try{endpointFor(config,core.environment);}catch{throw failure(400,'endpoint_not_allowed','请检查所选服务商的资源地址或地域');}
  try{res.json(await listProviderModels(config,core.environment));}
  catch(error){
   const code=error instanceof Error?error.message:'provider_unavailable';
   throw failure(422,'model_list_failed',({provider_credential_invalid:'API Key 无效，请检查后重新获取模型列表',provider_permission_denied:'当前 Key 无权读取模型目录，请检查权限',provider_quota_exhausted:'服务商额度或余额不足',provider_rate_limited:'读取过于频繁，请稍后重试',provider_timeout:'模型目录请求超时，请重试',provider_response_too_large:'模型目录响应超出限制，请手动填写模型或部署名称',provider_invalid_response:'服务商模型目录响应无法识别，请重试或手动填写模型',provider_unavailable:'模型目录服务暂不可用，请重试或手动填写模型'} as Record<string,string>)[code]||'无法读取模型目录，请重试；也可手动填写模型或部署名称并测试');
  }
 }));
 router.post('/matrix/connection/test',wrap(async(req,res)=>{
  const parsed=testBody.safeParse(req.body);if(!parsed.success)throw failure(400,'invalid_input','请检查服务商、模型 ID 和 API Key');
  const scope=scopeOf(core,req),input=parsed.data;
  const config:AiSettings={name:input.name||`${providerLabels[input.provider]} · ${input.model}`.slice(0,100),provider:input.provider,model:input.model,apiKey:input.apiKey,...(input.region?{region:input.region}:{}),...(input.workspace?{workspace:input.workspace}:{}),...(input.azureEndpoint?{azureEndpoint:input.azureEndpoint}:{})};
  encryptionKey(core);
  try{endpointFor(config,core.environment);}catch{throw failure(400,'endpoint_not_allowed','接口地址或地域不在服务器允许范围内');}
  const db=await core.database();
  const current=await editableConnection(core,scope,input.expectedRevision);
  try{await db.select({tokenHash:tests.tokenHash}).from(tests).where(and(eq(tests.tenantId,scope.tenantId),eq(tests.actorId,scope.actorId))).limit(1);}catch(error){dbFailure(error);}
  try{await invokeAi(config,core.environment,[{role:'user',content:'Reply OK.'}],true);}
  catch(error){const code=error instanceof Error?error.message:'provider_unavailable';throw failure(422,'connection_test_failed',({provider_credential_invalid:'API Key 无效，请检查或重新创建',provider_permission_denied:'账号或 Key 无权使用此模型',provider_quota_exhausted:'调用额度或余额不足',provider_rate_limited:'请求过于频繁，请稍后重试',provider_model_unavailable:'模型 ID 不存在或当前账号不可用',provider_parameters_invalid:'模型请求参数不被服务商接受',provider_timeout:'模型响应超时',provider_incomplete_response:'模型未完成最小测试响应',provider_empty_response:'模型未返回可用测试内容',provider_response_too_large:'服务商响应超出限制'} as Record<string,string>)[code]||'连接测试失败，请检查服务商和模型配置');}
  const token=randomBytes(32).toString('hex'),hash=tokenHash(token),expiresAt=new Date(Date.now()+10*60_000);
  try{
   await db.delete(tests).where(and(eq(tests.tenantId,scope.tenantId),eq(tests.actorId,scope.actorId),lt(tests.expiresAt,new Date())));
   await db.insert(tests).values({tenantId:scope.tenantId,actorId:scope.actorId,tokenHash:hash,ciphertext:sealed(core,scope.scope,config),expectedRevision:current?.revision||null,expiresAt});
  }
  catch(error){dbFailure(error);}
  res.json({status:'tested',testToken:token,expiresAt:expiresAt.toISOString(),provider:config.provider,model:config.model,maskedKey:mask(config.apiKey)});
 }));
 router.post('/matrix/connection/save',wrap(async(req,res)=>{
  const parsed=saveBody.safeParse(req.body);if(!parsed.success)throw failure(400,'invalid_input','测试凭据或连接版本无效');
  const scope=scopeOf(core,req),body=parsed.data,db=await core.database();
  let result:SafeConnection;
  try{result=await db.transaction(async tx=>{
   const tested=(await tx.select().from(tests).where(testWhere(scope,tokenHash(body.testToken))).limit(1).for('update'))[0];
   if(!tested||tested.expiresAt.getTime()<=Date.now())throw failure(409,'test_expired','连接测试已过期，请重新测试');
   const current=(await tx.select().from(connections).where(activeWhere(scope)).limit(1).for('update'))[0];
   if((current?.revision||null)!==(tested.expectedRevision||null)||(current?.revision||null)!==(body.expectedRevision||null))throw failure(409,'stale_connection','连接已被更改，请刷新后重新测试');
   const config=unseal(core,scope.scope,tested.ciphertext);
   if(config.baseUrl||current&&unseal(core,scope.scope,current.ciphertext).baseUrl)throw failure(409,'legacy_endpoint_readonly','此连接使用管理员配置的接口地址，请联系管理员修改；原连接已保留。');
   try{endpointFor(config,core.environment);}catch{throw failure(409,'endpoint_not_allowed','连接地址或地域配置已变化，请检查后重新测试');}
   const next={id:randomUUID(),revision:randomUUID(),name:config.name,provider:config.provider,model:config.model,maskedKey:mask(config.apiKey),ciphertext:tested.ciphertext,updatedAt:new Date()};
   if(current)await tx.update(connections).set(next).where(activeWhere(scope));
   else await tx.insert(connections).values({tenantId:scope.tenantId,actorId:scope.actorId,...next});
   await tx.delete(tests).where(testWhere(scope,tested.tokenHash));
   return {id:next.id,revision:next.revision,name:next.name,provider:next.provider,model:next.model,maskedKey:next.maskedKey,...(config.region?{region:config.region}:{}),...(config.workspace?{workspace:config.workspace}:{}),...(config.azureEndpoint?{azureEndpoint:config.azureEndpoint}:{})};
  });}catch(error){dbFailure(error);}
  res.json({status:'saved',connection:result,mode:core.sourceMatrixDecisions?'host':'user',available:true,...(core.sourceMatrixDecisions?{message:'当前使用平台统一模型，保存个人连接后暂不参与生成。'}:{})});
 }));
 router.post('/matrix/connection/remove',wrap(async(req,res)=>{
  const parsed=removeBody.safeParse(req.body);if(!parsed.success)throw failure(400,'invalid_input','连接版本无效');
  const scope=scopeOf(core,req),db=await core.database();
  try{await db.transaction(async tx=>{
   const current=(await tx.select().from(connections).where(activeWhere(scope)).limit(1).for('update'))[0];
   if(!current||current.revision!==parsed.data.expectedRevision)throw failure(409,'stale_connection','连接已被更改，请刷新后重试');
   await tx.delete(connections).where(activeWhere(scope));
   await tx.delete(tests).where(and(eq(tests.tenantId,scope.tenantId),eq(tests.actorId,scope.actorId)));
  });}catch(error){dbFailure(error);}
  res.json({status:'removed',connection:null,...(core.sourceMatrixDecisions?{mode:'host',available:true}:envOrNone(core))});
 }));
 router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  const known=error as Partial<PublicFailure>;
  if(typeof known.status==='number'&&known.publicMessage&&known.code){res.status(known.status).json({status:known.code,message:known.publicMessage});return;}
  const missing=sqlCode(error)==='ER_NO_SUCH_TABLE';
  res.status(missing?503:500).json({status:missing?'configuration_required':'unavailable',message:missing?'连接数据表尚未迁移，请联系管理员':'连接服务暂不可用，请稍后重试'});
 });
 return router;
}
