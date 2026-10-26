import { useEffect,useRef,useState } from 'react';
import { matrixApi } from './api';
import { MatrixDialog } from './SourceMatrixPresentation';
import type { AiProvider,ConnectionState,SafeConnection } from './api-connection-types';
import './api-connection.css';

const choices:Array<{id:AiProvider;label:string;region?:boolean;workspace?:boolean}>=[
 {id:'openai',label:'OpenAI'}, {id:'deepseek',label:'DeepSeek'},
 {id:'dashscope',label:'通义千问／阿里云百炼',region:true,workspace:true},
 {id:'glm',label:'智谱 GLM'}, {id:'claude',label:'Anthropic Claude'},
 {id:'gemini',label:'Google Gemini'},
];
const regionOptions=[['cn-beijing','中国大陆（北京）'],['ap-southeast-1','新加坡'],['us-east-1','美国']];
const labelOf=(value:string)=>choices.find(x=>x.id===value)?.label||value;
type TestResult={status:'tested';testToken:string;expiresAt:string;provider:AiProvider;model:string;maskedKey:string};
type ModelListResult={mode:'listed'|'manual';models:string[];truncated:boolean;message:string};
function message(error:unknown){return error instanceof Error?error.message:'连接服务暂不可用';}

export function ApiConnectionDialog({open,onClose,onChange}:{open:boolean;onClose:()=>void;onChange:(connection:SafeConnection|null)=>void}) {
 const [state,setState]=useState<ConnectionState|null>(null),[provider,setProvider]=useState<AiProvider>('openai');
 const [name,setName]=useState('OpenAI'),[model,setModel]=useState(''),[apiKey,setApiKey]=useState('');
 const [region,setRegion]=useState('cn-beijing'),[workspace,setWorkspace]=useState(''),[baseUrl,setBaseUrl]=useState('');
 const [tested,setTested]=useState<TestResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [modelOptions,setModelOptions]=useState<string[]>([]),[modelNotice,setModelNotice]=useState('');
 const pending=useRef<Set<AbortController>>(new Set()),epoch=useRef(0);
 const cancel=()=>{epoch.current++;for(const controller of pending.current)controller.abort();pending.current.clear();};
 const close=()=>{cancel();setBusy(false);setApiKey('');setTested(null);onClose();};
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();pending.current.add(controller);const ticket=epoch.current;setLoading(true);setBusy(false);setState(null);setError('');setTested(null);setApiKey('');setModelOptions([]);setModelNotice('');setRegion('cn-beijing');setWorkspace('');setBaseUrl('');
  void matrixApi<ConnectionState>('/matrix/connection',controller.signal).then(value=>{
   if(controller.signal.aborted||epoch.current!==ticket)return;
   setState(value);onChange(value.connection);if(value.connection){setProvider(value.connection.provider);setName(value.connection.name);setModel(value.connection.model);}else{setProvider('openai');setName('OpenAI');setModel('');}
  }).catch(reason=>{if(!controller.signal.aborted&&epoch.current===ticket)setError(message(reason));}).finally(()=>{pending.current.delete(controller);if(!controller.signal.aborted&&epoch.current===ticket)setLoading(false);});
  return()=>cancel();
 },[open]);
 const changed=()=>{setTested(null);setError('');};
 const invalidateModels=()=>{setModelOptions([]);setModelNotice('');};
 const current=state?.connection,selected=choices.find(x=>x.id===provider)!;
 async function fetchModels(){
  const controller=new AbortController(),ticket=epoch.current;pending.current.add(controller);setBusy(true);setError('');setModelOptions([]);setModelNotice('');
  try{
   const result=await matrixApi<ModelListResult>('/matrix/connection/models',controller.signal,{provider,apiKey:apiKey.trim(),...(baseUrl.trim()?{baseUrl:baseUrl.trim()}:{})});
   if(controller.signal.aborted||epoch.current!==ticket)return;
   setModelOptions(result.models);setModelNotice(result.message+(result.truncated?' 仅展示当前目录的前 100 项；其他模型可手填。':''));
  }catch(reason){if(!controller.signal.aborted&&epoch.current===ticket)setError(message(reason));}
  finally{pending.current.delete(controller);if(!controller.signal.aborted&&epoch.current===ticket)setBusy(false);}
 }
 async function test(){
  if(!name.trim()||!model.trim()||!apiKey.trim()){setError('请填写连接名称、模型 ID 和 API Key');return;}
  const controller=new AbortController(),ticket=epoch.current;pending.current.add(controller);setBusy(true);setError('');setTested(null);
  try{const result=await matrixApi<TestResult>('/matrix/connection/test',controller.signal,{name:name.trim(),provider,model:model.trim(),apiKey:apiKey.trim(),...(selected.region?{region}:{}),...(selected.workspace&&workspace.trim()?{workspace:workspace.trim()}:{}),...(baseUrl.trim()?{baseUrl:baseUrl.trim()}:{}),expectedRevision:current?.revision??null});if(!controller.signal.aborted&&epoch.current===ticket)setTested(result);}
  catch(reason){if(!controller.signal.aborted&&epoch.current===ticket)setError(message(reason));}finally{pending.current.delete(controller);if(!controller.signal.aborted&&epoch.current===ticket)setBusy(false);}
 }
 async function save(){
  if(!tested)return;const controller=new AbortController(),ticket=epoch.current;pending.current.add(controller);setBusy(true);setError('');
  try{const result=await matrixApi<{connection:SafeConnection}>('/matrix/connection/save',controller.signal,{testToken:tested.testToken,expectedRevision:current?.revision??null});if(controller.signal.aborted||epoch.current!==ticket)return;setState({connection:result.connection,mode:state?.mode==='host'?'host':'user',available:true});setApiKey('');setTested(null);onChange(result.connection);}
  catch(reason){if(!controller.signal.aborted&&epoch.current===ticket)setError(message(reason));}finally{pending.current.delete(controller);if(!controller.signal.aborted&&epoch.current===ticket)setBusy(false);}
 }
 async function remove(){
  if(!current)return;const controller=new AbortController(),ticket=epoch.current;pending.current.add(controller);setBusy(true);setError('');
  try{const result=await matrixApi<ConnectionState>('/matrix/connection/remove',controller.signal,{expectedRevision:current.revision});if(controller.signal.aborted||epoch.current!==ticket)return;setState(result);setApiKey('');setTested(null);onChange(null);}
  catch(reason){if(!controller.signal.aborted&&epoch.current===ticket)setError(message(reason));}finally{pending.current.delete(controller);if(!controller.signal.aborted&&epoch.current===ticket)setBusy(false);}
 }
 const footer=<><button className="button secondary" type="button" onClick={close}>关闭</button>{current&&<button className="button secondary" type="button" onClick={remove} disabled={busy||loading}>移除连接</button>}<button className="button secondary" type="button" onClick={test} disabled={busy||loading}>测试连接</button><button className="button primary" type="button" onClick={save} disabled={busy||!tested||new Date(tested.expiresAt).getTime()<=Date.now()}>保存已测试连接</button></>;
 return <MatrixDialog open={open} title="连接 API" onClose={close} width={540} footer={footer}>
  <div className="sm-api-connection">
   {loading?<p role="status">正在读取连接状态…</p>:state&&<div className="sm-api-current" role="status"><strong>{state.mode==='host'?'系统模型连接':state.mode==='environment'?'环境模型连接':state.mode==='user'?'当前用户连接':'尚无可用连接'}</strong><span>{current?`${labelOf(current.provider)} · ${current.model} · ${current.maskedKey}`:state.message||'可填写自己的 API 连接'}</span>{state.mode==='host'&&<small>系统模型优先使用。保存个人连接后需管理员调整系统设置才会参与生成。</small>}</div>}
   {busy&&<p role="status">正在处理连接请求，请稍候…</p>}
   <p className="sm-api-note">选择已开通的服务商和模型。测试会向服务商发送一条极短请求，可能产生少量费用；保存只接受本次测试通过的配置。</p>
   <fieldset disabled={busy||loading} className="sm-api-fields"><label>连接名称<input value={name} maxLength={100} onChange={e=>{changed();setName(e.target.value);}}/></label>
   <label>服务商<select value={provider} onChange={e=>{changed();invalidateModels();const next=e.target.value as AiProvider;setProvider(next);setName(labelOf(next));setModel('');setBaseUrl('');setWorkspace('');}}>{choices.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
   <div className="sm-api-model-picker"><label htmlFor="sm-api-model-id">模型 ID</label><div><input id="sm-api-model-id" list="sm-api-model-list" value={model} maxLength={160} placeholder="选择或填写模型 ID" autoComplete="off" onChange={e=>{changed();setModel(e.target.value);}}/><button className="button secondary" type="button" onClick={()=>void fetchModels()}>获取模型列表</button></div><datalist id="sm-api-model-list">{modelOptions.map(id=><option key={id} value={id}/>)}</datalist>{modelOptions.length>0&&<select aria-label="从服务商模型列表选择" value="" onChange={e=>{changed();setModel(e.target.value);}}><option value="">从已返回的模型列表选择…</option>{modelOptions.map(id=><option key={id} value={id}>{id}</option>)}</select>}<small>列表仅供选择；仍需点击“测试连接”确认 Key 对该模型的调用权限。也可直接手填。</small>{modelNotice&&<small role="status">{modelNotice}</small>}</div>
   <label>API Key<input value={apiKey} type="password" maxLength={512} placeholder={current?'输入新 Key 以替换当前连接':'仅通过服务端处理'} autoComplete="new-password" onChange={e=>{changed();invalidateModels();setApiKey(e.target.value);}}/></label>
   {selected.region&&<label>地域<select value={region} onChange={e=>{changed();invalidateModels();setRegion(e.target.value);}}>{regionOptions.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}
   {selected.workspace&&<label>业务空间／Workspace（可选）<input value={workspace} maxLength={120} onChange={e=>{changed();invalidateModels();setWorkspace(e.target.value);}}/></label>}
   <details><summary>高级接口地址（仅限管理员许可）</summary><label>API 基础地址<input value={baseUrl} type="url" placeholder="留空使用服务商官方地址" onChange={e=>{changed();invalidateModels();setBaseUrl(e.target.value);}}/><small>可填官方基础地址或完整请求地址；其他地址须由服务器加入 HTTPS 白名单。</small></label></details></fieldset>
   {!tested&&apiKey&&!busy&&<p role="status">当前填写的配置需测试验证后才能保存。</p>}
   {tested&&<p className="sm-api-success" role="status">模型调用已验证：{labelOf(tested.provider)} · {tested.model}。请在十分钟内保存。</p>}
   {error&&<p className="sm-api-error" role="alert">{error}</p>}
  </div>
 </MatrixDialog>;
}
