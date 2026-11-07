import { useEffect,useRef,useState } from 'react';
import { matrixApi } from './api';
import { MatrixDialog } from './SourceMatrixPresentation';
import { providerLabels,connectionDisplayName,type AiProvider,type ConnectionState,type SafeConnection } from './api-connection-types';
import './api-connection.css';

const choices:Array<{id:AiProvider;label:string}>=(Object.keys(providerLabels) as AiProvider[]).map(id=>({
 id,label:providerLabels[id]+(id==='azure-openai'?'（v1）':id==='azure-foundry'?'（OpenAI 兼容 v1）':''),
}));
const regionOptions=[['cn-beijing','中国大陆（北京）'],['ap-southeast-1','新加坡'],['us-east-1','美国']];
type TestResult={testToken:string;expiresAt:string;provider:AiProvider;model:string;maskedKey:string};
type Tested=TestResult&{version:number;revision:string|null};
type ModelListResult={mode:'listed'|'manual'|'catalog';models:string[];truncated:boolean;message:string};
type ModelQuery={status:'idle'|'loading'|'listed'|'empty'|'manual'|'catalog'|'error';models:string[];message:string;truncated:boolean};
type Field='key'|'endpoint'|'workspace'|'model';
const emptyQuery=():ModelQuery=>({status:'idle',models:[],message:'',truncated:false});
const isAzure=(provider:AiProvider)=>provider==='azure-openai'||provider==='azure-foundry';
function message(error:unknown){return error instanceof Error?error.message:'连接服务暂不可用，请重试';}
async function request<T>(path:string,controller:AbortController,body?:unknown,timeoutMs=20000):Promise<T>{
 let timedOut=false;
 const timer=window.setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 try{return await matrixApi<T>(path,controller.signal,body);}
 catch(reason){if(timedOut)throw new Error('连接服务响应超时，请重试');throw reason;}
 finally{window.clearTimeout(timer);}
}

export function ApiConnectionDialog({open,onClose,onChange}:{open:boolean;onClose:()=>void;onChange:(connection:SafeConnection|null)=>void}) {
 const [state,setState]=useState<ConnectionState|null>(null),[loading,setLoading]=useState(false),[readError,setReadError]=useState('');
 const [provider,setProvider]=useState<AiProvider>('openai'),[name,setName]=useState(''),[model,setModel]=useState(''),[apiKey,setApiKey]=useState('');
 const [region,setRegion]=useState('cn-beijing'),[workspace,setWorkspace]=useState(''),[azureEndpoint,setAzureEndpoint]=useState('');
 const [showKey,setShowKey]=useState(false),[manual,setManual]=useState(false),[search,setSearch]=useState(''),[query,setQuery]=useState<ModelQuery>(emptyQuery);
 const [tested,setTested]=useState<Tested|null>(null),[testing,setTesting]=useState(false),[mutation,setMutation]=useState<'save'|'remove'|null>(null);
 const [error,setError]=useState(''),[invalid,setInvalid]=useState<Field|null>(null),[notice,setNotice]=useState(''),[confirmRemove,setConfirmRemove]=useState(false);
 const mounted=useRef(false),active=useRef(open),session=useRef(0),configuration=useRef(0),testVersion=useRef(0);
 const readRequest=useRef<AbortController|null>(null),modelRequest=useRef<AbortController|null>(null),testRequest=useRef<AbortController|null>(null);
 const writing=useRef<'save'|'remove'|null>(null),notify=useRef(onChange);
 const keyInput=useRef<HTMLInputElement>(null),endpointInput=useRef<HTMLInputElement>(null),workspaceInput=useRef<HTMLInputElement>(null);
 const modelInput=useRef<HTMLInputElement>(null),modelSelect=useRef<HTMLSelectElement>(null),searchInput=useRef<HTMLInputElement>(null),removeCancel=useRef<HTMLButtonElement>(null),queryButton=useRef<HTMLButtonElement>(null);
 notify.current=onChange;
 const current=state?.connection,azure=isAzure(provider),legacy=!!(current?.requiresAdminEndpoint||current?.settingsUnavailable);
 const ready=!!state&&!loading&&!readError&&!mutation,editable=ready&&!legacy;
 const querying=query.status==='loading',busy=querying||testing||!!mutation;
 const selectable=query.status==='listed'&&query.models.length>0&&!azure;
 const allowManual=azure||current?.provider===provider||query.status==='manual'||query.status==='error'||query.status==='empty'||query.truncated;
 const filtered=query.models.filter(id=>id.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 const validTest=!!tested&&tested.version===testVersion.current&&tested.revision===(current?.revision??null)&&Date.parse(tested.expiresAt)>Date.now();

 function clearTest(){
  testVersion.current++;testRequest.current?.abort();testRequest.current=null;
  setTested(null);setTesting(false);setError('');setInvalid(null);setNotice('');
 }
 function clearModels(){
  configuration.current++;modelRequest.current?.abort();modelRequest.current=null;
  setQuery(emptyQuery());setSearch('');setModel('');setManual(isAzure(provider));clearTest();setConfirmRemove(false);
 }
 function cancelTransient(){
  session.current++;configuration.current++;testVersion.current++;
  readRequest.current?.abort();readRequest.current=null;
  modelRequest.current?.abort();modelRequest.current=null;
  testRequest.current?.abort();testRequest.current=null;
 }
 function hydrate(value:ConnectionState){
  const connection=value.connection;
  const automatic=connection?`${providerLabels[connection.provider]} · ${connection.model}`:'';
  setProvider(connection?.provider??'openai');setName(connection?.name===automatic.slice(0,100)?'':connection?.name??'');setModel(connection?.model??'');
  setApiKey('');setShowKey(false);setRegion(connection?.region??'cn-beijing');setWorkspace(connection?.workspace??'');setAzureEndpoint(connection?.azureEndpoint??'');
  setQuery(emptyQuery());setSearch('');const savedProvider=connection?.provider??'openai';setManual(!!connection||isAzure(savedProvider));setTested(null);setInvalid(null);setConfirmRemove(false);
 }
 async function readState(){
  if(!active.current||writing.current)return;
  const controller=new AbortController(),ticket=session.current;
  readRequest.current?.abort();readRequest.current=controller;
  setLoading(true);setReadError('');clearTest();
  try{
   const value=await request<ConnectionState>('/matrix/connection',controller);
   if(!mounted.current||!active.current||ticket!==session.current||readRequest.current!==controller)return;
   setState(value);hydrate(value);notify.current(value.connection);
  }catch(reason){
   if(mounted.current&&active.current&&ticket===session.current&&readRequest.current===controller)setReadError(message(reason));
  }finally{
   if(readRequest.current===controller){readRequest.current=null;if(mounted.current&&active.current&&ticket===session.current)setLoading(false);}
  }
 }
 function close(){
  active.current=false;cancelTransient();setApiKey('');setShowKey(false);setTested(null);setTesting(false);setQuery(emptyQuery());setConfirmRemove(false);
  // A dispatched write can commit after the dialog closes. Its reconciliation continues below.
  onClose();
 }
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current=false;cancelTransient();};},[]);
 useEffect(()=>{
  active.current=open;cancelTransient();setApiKey('');setShowKey(false);setTested(null);setTesting(false);setQuery(emptyQuery());setError('');setNotice('');setConfirmRemove(false);
  if(open){setState(null);setReadError('');setLoading(true);if(!writing.current)void readState();}
  return()=>{active.current=false;cancelTransient();};
 },[open]);
 useEffect(()=>{
  if(!tested)return;
  const remaining=Date.parse(tested.expiresAt)-Date.now();
  if(!Number.isFinite(remaining)||remaining<=0){setTested(null);setNotice('连接测试已过期，请重新测试后保存。');return;}
  const timer=window.setTimeout(()=>{setTested(null);setNotice('连接测试已过期，请重新测试后保存。');},remaining);
  return()=>window.clearTimeout(timer);
 },[tested]);
 useEffect(()=>{if(confirmRemove)removeCancel.current?.focus();},[confirmRemove]);

 function validate(includeModel:boolean){
  let field:Field|null=null,text='';
  if(!apiKey.trim()){field='key';text='请先填写 API Key 并获取模型列表';}
  else if(azure&&!azureEndpoint.trim()){field='endpoint';text='请填写当前 Azure 资源的 HTTPS 资源地址';}
  else if(provider==='dashscope'&&workspace.trim()&&!/^[a-z0-9-]{1,120}$/.test(workspace.trim())){field='workspace';text='业务空间只能包含小写字母、数字和连字符';}
  else if(includeModel&&!model.trim()){field='model';text=azure?'请填写 Azure 控制台中的部署名称，再测试连接':'请选择模型或手动输入模型 ID，再测试连接';}
  if(field){setError(text);setInvalid(field);({key:keyInput,endpoint:endpointInput,workspace:workspaceInput,model:manual||azure?modelInput:selectable?modelSelect:queryButton}[field]).current?.focus();return false;}
  return true;
 }
 function settings(){
  return {provider,apiKey:apiKey.trim(),...(provider==='dashscope'?{region,...(workspace.trim()?{workspace:workspace.trim()}:{})}:{}),...(azure?{azureEndpoint:azureEndpoint.trim()}:{}),expectedRevision:current?.revision??null};
 }
 async function fetchModels(){
  if(!editable||modelRequest.current||testRequest.current||writing.current||!validate(false))return;
  clearTest();setModel('');setSearch('');
  const controller=new AbortController(),ticket=session.current,version=configuration.current;
  modelRequest.current=controller;setQuery({...emptyQuery(),status:'loading'});
  try{
   const result=await request<ModelListResult>('/matrix/connection/models',controller,settings());
   if(!mounted.current||!active.current||ticket!==session.current||version!==configuration.current||modelRequest.current!==controller)return;
   // Azure catalogs are references, never deployment discovery, even if an older server calls them listed.
   const mode=azure&&result.mode==='listed'?'catalog':result.mode;
   setQuery({status:mode==='listed'&&!result.models.length?'empty':mode,models:result.models,message:result.message,truncated:result.truncated});
   setManual(mode!=='listed'||!result.models.length||azure);
  }catch(reason){
   if(mounted.current&&active.current&&ticket===session.current&&version===configuration.current&&modelRequest.current===controller){setQuery({...emptyQuery(),status:'error',message:message(reason)});setManual(true);}
  }finally{if(modelRequest.current===controller)modelRequest.current=null;}
 }
 async function test(){
  if(!editable||modelRequest.current||testRequest.current||writing.current||!validate(true))return;
  clearTest();
  const controller=new AbortController(),ticket=session.current,version=testVersion.current,revision=current?.revision??null;
  testRequest.current=controller;setTesting(true);
  try{
   const result=await request<TestResult>('/matrix/connection/test',controller,{...settings(),model:model.trim(),...(name.trim()?{name:name.trim()}:{})},35000);
   if(mounted.current&&active.current&&ticket===session.current&&version===testVersion.current&&testRequest.current===controller)setTested({...result,version,revision});
  }catch(reason){if(mounted.current&&active.current&&ticket===session.current&&version===testVersion.current&&testRequest.current===controller)setError(message(reason));}
  finally{if(testRequest.current===controller){testRequest.current=null;if(mounted.current&&active.current&&ticket===session.current)setTesting(false);}}
 }
 async function mutate(kind:'save'|'remove'){
  if(!ready||writing.current||kind==='save'&&(!editable||!validTest||!tested)||kind==='remove'&&!current)return;
  const previous=state!,body=kind==='save'?{testToken:tested!.testToken,expectedRevision:tested!.revision}:{expectedRevision:current!.revision};
  writing.current=kind;setMutation(kind);clearTest();setConfirmRemove(false);modelRequest.current?.abort();modelRequest.current=null;
  let writeError='',saved=false;
  try{await request<{connection:SafeConnection|null;mode?:ConnectionState['mode'];available?:boolean;message?:string}>('/matrix/connection/'+kind,new AbortController(),body,35000);saved=true;}
  catch(reason){writeError=message(reason);}
  // Do not derive availability or the active model from the write response. Re-read even after an uncertain write.
  let refreshed:ConnectionState|null=null,refreshError='';
  try{refreshed=await request<ConnectionState>('/matrix/connection',new AbortController());}
  catch(reason){refreshError=message(reason);}
  writing.current=null;
  if(!mounted.current)return;
  setMutation(null);
  notify.current(refreshed?refreshed.connection:previous.connection);
  if(!active.current)return;
  setLoading(false);
  if(refreshed){
   setState(refreshed);setReadError('');
   if(saved||refreshed.connection?.revision!==previous.connection?.revision)hydrate(refreshed);
   if(writeError)setError(writeError+'；已重新读取当前连接，请核对后再操作。');
   else setNotice(kind==='save'?'个人连接已保存。':'个人连接已移除。');
  }else{
   setReadError((saved?'请求已处理，但当前连接状态未能确认。':'请求结果尚未确认。')+refreshError);
   setError(writeError);setApiKey('');setShowKey(false);
  }
 }
 const fieldDescription=(field:Field,help?:string)=>[help,invalid===field?'sm-api-error':undefined].filter(Boolean).join(' ')||undefined;
 const footer=<>
  <button className="button secondary" type="button" onClick={close}>关闭</button>
  {current&&<button className="button secondary" type="button" onClick={()=>setConfirmRemove(true)} disabled={!ready||busy}>移除连接</button>}
  <button className="button secondary" type="button" onClick={()=>void test()} disabled={!editable||busy} aria-busy={testing}>测试连接</button>
  <button className="button primary" type="button" onClick={()=>void mutate('save')} disabled={!editable||busy||!validTest} aria-busy={mutation==='save'}>保存已测试连接</button>
 </>;
 return <MatrixDialog open={open} title="连接 API" onClose={close} width={540} footer={footer}>
  <div className="sm-api-connection">
   <div className="sm-api-feedback" aria-live="polite">
    {loading&&<p role="status">{mutation?'正在核实连接请求结果…':'正在读取连接状态…'}</p>}
    {state?.mode==='host'&&<p className="sm-api-note">平台统一模型优先，个人连接保存后暂不参与生成。</p>}
    {state&&!state.available&&state.message&&<p className="sm-api-note">{state.message}</p>}
    {legacy&&<p className="sm-api-note">{current?.settingsUnavailable?'已保存连接的配置暂时无法读取，请联系管理员恢复。':'已保存连接使用管理员配置的专用地址，请联系管理员维护。'}此处仅可查看或移除，不会替换原配置。</p>}
    {legacy&&current&&<p className="sm-api-note">已保存：{connectionDisplayName(current)} · {current.maskedKey}</p>}
    {readError&&<div className="sm-api-error" role="alert"><p>{readError}</p><button className="button secondary" type="button" disabled={loading||!!mutation} onClick={()=>void readState()}>重新读取连接</button></div>}
   </div>
   <fieldset disabled={!editable} className="sm-api-fields">
    <label htmlFor="sm-api-provider">服务商<select id="sm-api-provider" value={provider} onChange={event=>{clearModels();const next=event.target.value as AiProvider;setProvider(next);setApiKey('');setShowKey(false);setRegion('cn-beijing');setWorkspace('');setAzureEndpoint('');setManual(isAzure(next));}}>{choices.map(choice=><option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
    <div className="sm-api-field">
     <label htmlFor="sm-api-key">API Key</label>
     <div className="sm-api-input-action"><input ref={keyInput} id="sm-api-key" value={apiKey} type={showKey?'text':'password'} maxLength={512} placeholder={current?'输入 Key 以重新验证连接':'填写所选服务商的 API Key'} autoComplete="new-password" aria-invalid={invalid==='key'} aria-describedby={fieldDescription('key')} onChange={event=>{clearModels();setApiKey(event.target.value);}}/><button className="button secondary" type="button" aria-label={showKey?'隐藏 API Key':'显示 API Key'} aria-pressed={showKey} onClick={()=>setShowKey(value=>!value)}>{showKey?'隐藏':'显示'}</button></div>
    </div>
    {provider==='dashscope'&&<>
     <label htmlFor="sm-api-region">地域<select id="sm-api-region" value={region} onChange={event=>{clearModels();setRegion(event.target.value);}}>{regionOptions.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
     <label htmlFor="sm-api-workspace">业务空间／Workspace（选填）<input ref={workspaceInput} id="sm-api-workspace" value={workspace} maxLength={120} aria-invalid={invalid==='workspace'} aria-describedby={fieldDescription('workspace')} onChange={event=>{clearModels();setWorkspace(event.target.value);}}/></label>
    </>}
    {azure&&<div className="sm-api-field"><label htmlFor="sm-api-endpoint">资源地址</label><input ref={endpointInput} id="sm-api-endpoint" type="url" value={azureEndpoint} maxLength={500} placeholder={provider==='azure-openai'?'https://资源名.openai.azure.com':'https://资源名.services.ai.azure.com'} aria-invalid={invalid==='endpoint'} aria-describedby={fieldDescription('endpoint','sm-api-endpoint-help')} onChange={event=>{clearModels();setAzureEndpoint(event.target.value);}}/><small id="sm-api-endpoint-help">复制当前资源的 HTTPS 地址。此入口支持{provider==='azure-openai'?' Azure OpenAI v1':' Foundry OpenAI 兼容 v1'}，部署名称在下方填写。</small></div>}
    <div className="sm-api-model-picker" aria-busy={querying}>
     <div className="sm-api-model-heading"><span>{azure?'模型目录与部署':'模型'}</span><button ref={queryButton} className="button secondary" type="button" disabled={!apiKey.trim()||querying||testing} aria-busy={querying} onClick={()=>void fetchModels()}>获取模型列表</button></div>
     <div className="sm-api-model-feedback" aria-live="polite">
      {!apiKey.trim()?<p>请先填写 API Key 并获取模型列表</p>:querying?<p role="status">正在查询模型列表…</p>:query.status==='error'?<p className="sm-api-inline-error" role="alert">{query.message}</p>:query.status==='empty'?<p role="status">查询成功，当前目录没有返回模型。可重试或手动输入模型 ID。</p>:query.status==='manual'?<p role="status">{query.message||'此服务商暂不支持模型目录查询，请手动输入模型 ID 并测试。'}</p>:query.status==='catalog'?<p role="status">{query.message} 模型目录不代表已部署；请从 Azure 控制台复制实际部署名称并测试。</p>:query.status==='listed'?<p role="status">已获取 {query.models.length} 个模型，选择后仍需测试调用权限。{query.message}</p>:<p>{azure?'可查询模型目录作参考；请填写实际部署名称。':'点击获取模型列表，再选择需要使用的模型。'}</p>}
      {query.truncated&&<p>仅展示本次目录返回的前 {query.models.length} 项；其他{azure?'部署名称':'模型 ID '}可手动填写。</p>}
     </div>
     {query.status==='catalog'&&query.models.length>0&&<details className="sm-api-catalog"><summary>查看模型目录（仅供参考）</summary><ul>{query.models.map(id=><li key={id}>{id}</li>)}</ul></details>}
     {selectable&&!manual?<>
      <div className="sm-api-field"><label htmlFor="sm-api-model-search">筛选已获取的模型</label><div className="sm-api-input-action"><input ref={searchInput} id="sm-api-model-search" type="search" value={search} placeholder="输入模型名称筛选" onChange={event=>setSearch(event.target.value)}/>{search&&<button className="button secondary" type="button" aria-label="清空模型筛选" onClick={()=>{setSearch('');searchInput.current?.focus();}}>清空</button>}</div></div>
      <label htmlFor="sm-api-model-select">模型<select ref={modelSelect} id="sm-api-model-select" value={model} aria-invalid={invalid==='model'} aria-describedby={fieldDescription('model','sm-api-model-help')} onChange={event=>{clearTest();setModel(event.target.value);}}><option value="">请选择模型</option>{model&&!filtered.includes(model)&&<option value={model}>{model}（已选）</option>}{filtered.map(id=><option key={id} value={id}>{id}</option>)}</select></label>
      {filtered.length===0&&<small role="status">当前筛选无匹配模型，请修改或清空筛选。</small>}
     </>:manual||azure?<label htmlFor="sm-api-model-id">{azure?'部署名称':'模型 ID'}<input ref={modelInput} id="sm-api-model-id" value={model} maxLength={160} autoComplete="off" placeholder={azure?'复制实际部署名称，不是模型目录 ID':'从服务商控制台复制模型 ID'} aria-invalid={invalid==='model'} aria-describedby={fieldDescription('model','sm-api-model-help')} onChange={event=>{clearTest();setModel(event.target.value);}}/></label>:null}
     {!azure&&allowManual&&<button className="link small sm-api-manual" type="button" disabled={querying||testing} onClick={()=>{clearTest();setModel('');setManual(value=>!value);setSearch('');}}>{manual?(selectable?'返回模型列表':'收起手动输入'):'手动输入模型 ID'}</button>}
     <small id="sm-api-model-help">{azure?'部署名称由当前资源中的部署决定；目录查询成功不等于可调用。':'列表仅供选择；手动输入的模型也需测试。'}</small>
    </div>
    <div className="sm-api-field"><label htmlFor="sm-api-name">连接备注（选填）</label><input id="sm-api-name" value={name} maxLength={100} placeholder="留空使用“服务商 · 模型”" aria-describedby="sm-api-name-help" onChange={event=>{clearTest();setName(event.target.value);}}/><small id="sm-api-name-help">仅用于识别此连接，已有自定义备注会保留。</small></div>
   </fieldset>
   <p className="sm-api-note">测试会向所选服务商发送一条极短请求，可能产生少量费用；测试通过后才能保存。</p>
   <div className="sm-api-result" aria-live="polite">
    {testing&&<p role="status">正在测试所选{azure?'部署':'模型'}…</p>}
    {mutation&&<p role="status">{mutation==='save'?'正在保存并核实连接状态…':'正在移除并核实连接状态…'}关闭弹窗不会撤销已发送的请求。</p>}
    {validTest&&tested&&<p className="sm-api-success" role="status">模型调用已验证：{providerLabels[tested.provider]} · {tested.model}。请在十分钟内保存。</p>}
    {notice&&<p role="status">{notice}</p>}
    {error&&<p id="sm-api-error" className="sm-api-error" role="alert">{error}</p>}
   </div>
   {confirmRemove&&current&&<section className="sm-api-remove" aria-label="确认移除连接"><p>移除“{current.name}”后，此账号将不再使用这份个人连接；平台模型是否可用会重新读取。</p><div><button ref={removeCancel} className="button secondary" type="button" onClick={()=>setConfirmRemove(false)}>取消移除</button><button className="button secondary" type="button" onClick={()=>void mutate('remove')} disabled={!ready||busy}>确认移除连接</button></div></section>}
  </div>
 </MatrixDialog>;
}
