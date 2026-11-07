/** Fixed provider routing, with strictly scoped Azure resource endpoints. */
export type AiProvider = 'openai'|'deepseek'|'dashscope'|'glm'|'claude'|'gemini'|'siliconflow'|'azure-openai'|'azure-foundry';
export interface AiSettings { name:string;provider:AiProvider;model:string;apiKey:string;region?:string;workspace?:string;azureEndpoint?:string;baseUrl?:string }
export interface ModelMessage {role:'system'|'user';content:string}

type AzureProvider='azure-openai'|'azure-foundry';
type EndpointSettings=Pick<AiSettings,'provider'|'region'|'workspace'|'azureEndpoint'|'baseUrl'>;
const CHAT_HOSTS:Record<Exclude<AiProvider,'dashscope'|AzureProvider>,string>={
 openai:'https://api.openai.com/v1/responses',
 deepseek:'https://api.deepseek.com/chat/completions',
 glm:'https://open.bigmodel.cn/api/paas/v4/chat/completions',
 claude:'https://api.anthropic.com/v1/messages',
 gemini:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
 siliconflow:'https://api.siliconflow.cn/v1/chat/completions',
};
const DASH_REGIONS:Record<string,string>={
 'cn-beijing':'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
 'ap-southeast-1':'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
 'us-east-1':'https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions',
};
const END_PATH:Record<AiProvider,string>={openai:'responses',deepseek:'chat/completions',dashscope:'chat/completions',glm:'chat/completions',claude:'messages',gemini:'chat/completions',siliconflow:'chat/completions','azure-openai':'chat/completions','azure-foundry':'chat/completions'};
function isAzure(provider:AiProvider):provider is AzureProvider {return provider==='azure-openai'||provider==='azure-foundry';}
/** Only the public resource root and documented OpenAI v1 base path are accepted.
 * Match the original text before URL normalization can hide dot segments or credentials.
 * This does not accept project endpoints, Azure AI Inference, or management APIs.
 */
function azureV1Base(config:EndpointSettings):string {
 if(!isAzure(config.provider)||config.baseUrl)throw new Error('endpoint_not_allowed');
 const raw=config.azureEndpoint?.trim()||'';
 const match=/^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(openai\.azure\.com|services\.ai\.azure\.com)(?::443)?(\/[^?#]*)?$/i.exec(raw);
 const suffix=config.provider==='azure-openai'?'openai.azure.com':'services.ai.azure.com';
 if(!match||match[2]!.toLowerCase()!==suffix||!['','/','/openai/v1','/openai/v1/'].includes(match[3]||''))throw new Error('endpoint_not_allowed');
 return `https://${match[1]!.toLowerCase()}.${suffix}/openai/v1`;
}
function safePublicHttps(raw:string):string {
 const url=new URL(raw);
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.port&&url.port!=='443')throw new Error('endpoint_not_allowed');
 const host=url.hostname.toLowerCase();
 if(!/^[a-z0-9.-]+$/.test(host)||!host.includes('.')||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||/^\d+(?:\.\d+){3}$/.test(host)||host.includes('..'))throw new Error('endpoint_not_allowed');
 return url.href;
}
function fullEndpoint(raw:string,provider:AiProvider):string {
 const value=safePublicHttps(raw),path=END_PATH[provider];
 if(value.endsWith('/'+path))return value;
 return value.replace(/\/+$/,'')+'/'+path;
}
export function endpointFor(config:EndpointSettings,env:Readonly<Record<string,string|undefined>>):string {
 if(isAzure(config.provider))return azureV1Base(config)+'/chat/completions';
 let official=config.provider==='dashscope'?(DASH_REGIONS[config.region||'cn-beijing']||''):CHAT_HOSTS[config.provider];
 if(config.provider==='dashscope'&&config.workspace){
  if(!/^[a-z0-9-]{1,120}$/.test(config.workspace)||!DASH_REGIONS[config.region||'cn-beijing'])throw new Error('unsupported_region');
  official=`https://${config.workspace}.${config.region||'cn-beijing'}.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
 }
 if(!official)throw new Error('unsupported_region');
 if(!config.baseUrl)return official;
 const selected=fullEndpoint(config.baseUrl,config.provider);
 const allowed=(env.FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>fullEndpoint(x,config.provider));
 if(selected!==official&&!allowed.includes(selected))throw new Error('endpoint_not_allowed');
 return selected;
}
function extractJson(text:string):unknown {
 const cleaned=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 const start=cleaned.indexOf('{'),end=cleaned.lastIndexOf('}');
 return JSON.parse(start>=0&&end>start?cleaned.slice(start,end+1):cleaned);
}
async function readBounded(response:Response,maxBytes:number):Promise<string> {
 const claimed=Number(response.headers.get('content-length')||0);
 if(claimed>maxBytes)throw new Error('provider_response_too_large');
 const reader=response.body?.getReader();
 if(!reader)throw new Error('provider_invalid_response');
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>maxBytes){await reader.cancel();throw new Error('provider_response_too_large');}
   chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks,size));
 }finally{reader.releaseLock();}
}
function errorCode(value:unknown):string|undefined {
 if(!value||typeof value!=='object')return undefined;
 const outer=value as Record<string,unknown>;
 const nested=outer.error&&typeof outer.error==='object'?outer.error as Record<string,unknown>:outer;
 for(const candidate of [nested.code,nested.type,outer.code]){
  if(typeof candidate==='string'&&/^[a-z0-9_-]{1,80}$/i.test(candidate))return candidate.toLowerCase();
 }
 return undefined;
}
function classifiedFailure(status:number,code?:string):string {
 if(code&&/^(invalid_api_key|invalid_authentication|authentication_error|unauthorized|invalid_token)$/.test(code))return 'provider_credential_invalid';
 if(code&&/^(permission_denied|access_denied|insufficient_permissions|forbidden)$/.test(code))return 'provider_permission_denied';
 if(code&&/^(insufficient_quota|quota_exceeded|billing_hard_limit_reached|insufficient_balance)$/.test(code))return 'provider_quota_exhausted';
 if(code&&/^(rate_limit_exceeded|too_many_requests|rate_limit_error)$/.test(code))return 'provider_rate_limited';
 if(code&&/^(model_not_found|model_not_available|model_not_supported|invalid_model)$/.test(code))return 'provider_model_unavailable';
 if(code&&/^(invalid_request_error|invalid_parameter|invalid_parameters|invalid_argument)$/.test(code))return 'provider_parameters_invalid';
 if(status===401)return 'provider_credential_invalid';
 if(status===403)return 'provider_permission_denied';
 if(status===402)return 'provider_quota_exhausted';
 if(status===429)return 'provider_rate_limited';
 if(status===404)return 'provider_model_unavailable';
 if(status===400||status===422)return 'provider_parameters_invalid';
 return 'provider_unavailable';
}
async function checkedProviderResponse(response:Response):Promise<void> {
 if(response.ok)return;
 let code:string|undefined;
 try{code=errorCode(JSON.parse(await readBounded(response,64_000)));}catch{/** Status is authoritative when the error body is absent or malformed. */}
 throw new Error(classifiedFailure(response.status,code));
}
export interface ModelListResult {mode:'listed'|'manual'|'catalog';models:string[];truncated:boolean;message:string}
/** Official list APIs only. Never derive an arbitrary list URL from a custom chat endpoint. */
export async function listProviderModels(config:Pick<AiSettings,'provider'|'apiKey'|'region'|'workspace'|'azureEndpoint'|'baseUrl'>,env:Readonly<Record<string,string|undefined>>={}):Promise<ModelListResult> {
 // Directory and inference validate the same scoped settings before any Key is sent.
 endpointFor(config,env);
 if(config.baseUrl||config.provider==='dashscope'||config.provider==='glm')return {mode:'manual',models:[],truncated:false,message:'此配置没有已确认的模型列表接口；请从服务商控制台复制模型 ID，再测试连接。'};
 const azure=isAzure(config.provider);
 const url=azure?azureV1Base(config)+'/models':{
  openai:'https://api.openai.com/v1/models',deepseek:'https://api.deepseek.com/models',
  claude:'https://api.anthropic.com/v1/models?limit=100',
  gemini:'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
  siliconflow:'https://api.siliconflow.cn/v1/models?sub_type=chat',
 }[config.provider as Exclude<AiProvider,'dashscope'|'glm'|AzureProvider>];
 const headers:Record<string,string>={};
 if(azure)headers['api-key']=config.apiKey;
 else if(config.provider==='claude'){headers['x-api-key']=config.apiKey;headers['anthropic-version']='2023-06-01';}
 else if(config.provider==='gemini')headers['x-goog-api-key']=config.apiKey;
 else headers.Authorization=`Bearer ${config.apiKey}`;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
 try{
  const response=await fetch(url,{method:'GET',headers,redirect:'error',signal:controller.signal});
  await checkedProviderResponse(response);
  const value=JSON.parse(await readBounded(response,512_000)) as Record<string,any>;
  const source=config.provider==='gemini'?value.models:value.data;
  if(!Array.isArray(source))throw new Error('provider_invalid_response');
  const rows:unknown[]=source;
  const records=rows.filter((row):row is Record<string,unknown>=>!!row&&typeof row==='object'&&!Array.isArray(row));
  if(records.length!==rows.length)throw new Error('provider_invalid_response');
  const candidates=records
   .filter(row=>config.provider!=='gemini'||Array.isArray(row.supportedGenerationMethods)&&row.supportedGenerationMethods.includes('generateContent'))
   .map(row=>{const id=config.provider==='gemini'?row.name:row.id;return config.provider==='gemini'&&typeof id==='string'?id.replace(/^models\//,''):id;});
  const ids=candidates.filter((id:unknown):id is string=>typeof id==='string'&&/^[\w.\-:/]{1,160}$/.test(id));
  if(ids.length!==candidates.length)throw new Error('provider_invalid_response');
  const unique=[...new Set(ids)].slice(0,100);
  const truncated=ids.length>100||value.has_more===true||[value.nextPageToken,value.nextLink,value['@odata.nextLink'],value.next].some(x=>typeof x==='string'&&!!x);
  if(azure)return {mode:'catalog',models:unique,truncated,message:unique.length?'这是资源返回的模型目录，不是已部署清单。请从 Azure 控制台复制部署名称，并测试该部署的调用权限。':'资源返回的模型目录为空；这不能说明没有部署。请从 Azure 控制台复制部署名称并测试。'};
  return {mode:'listed',models:unique,truncated,message:unique.length?'这是服务商当前返回的模型目录；仍需测试该 Key 对所选模型的调用权限。':'服务商未返回可用于生成的模型；请手填模型 ID 并测试。'};
 }catch(error){
  if(error instanceof Error&&['provider_credential_invalid','provider_permission_denied','provider_quota_exhausted','provider_rate_limited','provider_model_unavailable','provider_parameters_invalid','provider_unavailable','provider_response_too_large','provider_invalid_response'].includes(error.message))throw error;
  if(error instanceof Error&&error.name==='AbortError')throw new Error('provider_timeout');
  throw new Error('provider_invalid_response');
 }finally{clearTimeout(timer);}
}
export async function invokeAi(config:AiSettings,env:Readonly<Record<string,string|undefined>>,messages:ModelMessage[],test=false):Promise<unknown> {
 const url=endpointFor(config,env);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),test?30_000:240_000);
 const headers:Record<string,string>={'Content-Type':'application/json'};
 let body:unknown;
 if(config.provider==='openai'){
  headers.Authorization=`Bearer ${config.apiKey}`;
  body={model:config.model,input:messages.map(m=>({role:m.role,content:m.content})),max_output_tokens:test?256:8192};
 }else if(config.provider==='claude'){
  headers['x-api-key']=config.apiKey;headers['anthropic-version']='2023-06-01';
  body={model:config.model,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),messages:messages.filter(m=>m.role==='user'),max_tokens:test?16:8192};
 }else if(isAzure(config.provider)){
  headers['api-key']=config.apiKey;
  // Azure v1 uses the deployment name as model. The v1 budget includes reasoning.
  body={model:config.model,messages,max_completion_tokens:test?256:8192};
 }else{
  headers.Authorization=`Bearer ${config.apiKey}`;
  if(config.provider==='dashscope'&&config.workspace)headers['X-DashScope-WorkSpace']=config.workspace;
  body={model:config.model,messages,max_tokens:test?16:8192};
 }
 try{
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:controller.signal});
  await checkedProviderResponse(response);
  const raw=await readBounded(response,2_000_000);
  const value=JSON.parse(raw) as Record<string,any>;
  // A minimal probe checks real model callability, not recommendation JSON.
  // Reasoning models may spend the probe budget before visible text; accept
  // only a recognized, metered response that exhausted that deliberate limit.
  if(test){
   const used=Number(value.usage?.output_tokens??value.usage?.completion_tokens??0)>0;
   const limited=config.provider==='openai'
    ?value.status==='incomplete'&&value.incomplete_details?.reason==='max_output_tokens'&&Array.isArray(value.output)
    :config.provider==='claude'?value.stop_reason==='max_tokens'&&Array.isArray(value.content)
    :value.choices?.[0]?.finish_reason==='length'&&!!value.choices?.[0]?.message;
   if(used&&limited)return {ok:true};
  }
  if(config.provider==='openai'&&typeof value.status==='string'&&value.status!=='completed')throw new Error('provider_incomplete_response');
  if(test&&config.provider!=='openai'&&config.provider!=='claude'&&value.choices?.[0]?.finish_reason==='length')throw new Error('provider_incomplete_response');
  const content=config.provider==='openai'?(value.output_text||value.output?.flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('')):config.provider==='claude'?value.content?.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join(''):value.choices?.[0]?.message?.content;
  if(typeof content!=='string'||!content.trim())throw new Error('provider_empty_response');
  return test?{ok:true}:extractJson(content);
 }catch(error){
  if(error instanceof Error&&['provider_credential_invalid','provider_permission_denied','provider_quota_exhausted','provider_rate_limited','provider_model_unavailable','provider_parameters_invalid','provider_unavailable','provider_response_too_large','provider_empty_response','provider_incomplete_response'].includes(error.message))throw error;
  if(error instanceof Error&&error.name==='AbortError')throw new Error('provider_timeout');
  throw new Error('provider_invalid_response');
 }finally{clearTimeout(timer);}
}
