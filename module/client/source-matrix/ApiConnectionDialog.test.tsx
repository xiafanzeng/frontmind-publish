// @vitest-environment jsdom
import { useState } from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { ApiConnectionDialog } from './ApiConnectionDialog';
import { connectionDisplayName,type ConnectionState,type SafeConnection } from './api-connection-types';

HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
const existing:SafeConnection={id:'saved-1',revision:'revision-1',name:'项目连接',provider:'openai',model:'gpt-4.1',maskedKey:'****abcd'};
const noConnection:ConnectionState={connection:null,mode:'none',available:false};
const manualDirectory={mode:'manual',models:[],message:'此配置请手动输入模型 ID',truncated:false};
const token=(model='gpt-4.1')=>({testToken:'t'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),provider:'openai',model,maskedKey:'****abcd'});
function response(value:unknown,ok=true){return {ok,json:async()=>value};}
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function body(init?:RequestInit){return JSON.parse(String(init?.body??'{}')) as Record<string,unknown>;}
type Handler=(path:string,init?:RequestInit)=>ReturnType<typeof response>|Promise<ReturnType<typeof response>>;
function mockService(initial:ConnectionState=noConnection,handler?:Handler){
 const fetcher=vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);
  if(path.endsWith('/matrix/connection')&&init?.method==='GET')return Promise.resolve(response(initial));
  return Promise.resolve(handler?.(path,init)??response({message:'Unexpected request'},false));
 });
 vi.stubGlobal('fetch',fetcher);return fetcher;
}
function Harness({onChange=()=>{}}:{onChange?:(connection:SafeConnection|null)=>void}){
 const [open,setOpen]=useState(true);
 return <div className="fm-media"><button type="button" onClick={()=>setOpen(true)}>打开连接设置</button><ApiConnectionDialog open={open} onClose={()=>setOpen(false)} onChange={onChange}/></div>;
}
async function openReady(onChange?:((connection:SafeConnection|null)=>void)){
 render(<Harness onChange={onChange}/>);
 await waitFor(()=>expect((screen.getByLabelText('服务商') as HTMLSelectElement).closest('fieldset')?.disabled).toBe(false));
}
function key(value='test-key-for-fixture'){fireEvent.change(screen.getByLabelText('API Key'),{target:{value}});}
async function manualModel(value='gpt-4.1'){
 if(!screen.queryByLabelText('模型 ID')){
  const manual=screen.queryByRole('button',{name:'手动输入模型 ID'});
  if(manual)fireEvent.click(manual);
  else{fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));await screen.findByLabelText('模型 ID');}
 }
 fireEvent.change(screen.getByLabelText('模型 ID'),{target:{value}});
}
async function testReady(){
 fireEvent.click(screen.getByRole('button',{name:'测试连接'}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'保存已测试连接'}) as HTMLButtonElement).disabled).toBe(false));
}
const postCalls=(fetcher:ReturnType<typeof mockService>,suffix:string)=>fetcher.mock.calls.filter(([path])=>String(path).endsWith(suffix));
beforeEach(()=>{vi.useRealTimers();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});

it('puts the optional remark after main fields and sends no request while typing or without a Key',async()=>{
 const fetcher=mockService();await openReady();
 const dialog=screen.getByRole('dialog');
 const labels=[...dialog.querySelectorAll('label')].map(label=>label.textContent);
 expect(labels[0]).toContain('服务商');expect(labels[1]).toBe('API Key');expect(labels[labels.length-1]).toContain('连接备注（选填）');
 expect((screen.getByLabelText('连接备注（选填）') as HTMLInputElement).value).toBe('');
 expect(screen.queryByRole('button',{name:'手动输入模型 ID'})).toBeNull();
 expect(screen.getByText('请先填写 API Key 并获取模型列表')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));
 key('fixture-1');key('fixture-12');
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(dialog.querySelector('datalist')).toBeNull();expect(screen.queryByText(/高级接口地址/)).toBeNull();expect(screen.queryByLabelText('API 基础地址')).toBeNull();
});

it('queries once explicitly, filters one returned selection locally, and tests with a blank remark',async()=>{
 const fetcher=mockService(noConnection,(path)=>path.endsWith('/models')?response({mode:'listed',models:['gpt-4.1','gpt-4.1-mini'],message:'',truncated:false}):response(token('gpt-4.1-mini')));
 await openReady();key();fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));
 await screen.findByLabelText('筛选已获取的模型');
 expect(screen.queryByLabelText('模型 ID')).toBeNull();
 expect(screen.queryByRole('button',{name:'手动输入模型 ID'})).toBeNull();
 fireEvent.change(screen.getByLabelText('筛选已获取的模型'),{target:{value:'mini'}});
 expect(screen.queryByRole('option',{name:'gpt-4.1'})).toBeNull();
 fireEvent.change(screen.getByLabelText('模型'),{target:{value:'gpt-4.1-mini'}});
 await testReady();
 const payload=body(postCalls(fetcher,'/test')[0][1]);
 expect(payload).toMatchObject({provider:'openai',model:'gpt-4.1-mini',expectedRevision:null});expect(payload).not.toHaveProperty('name');expect(payload).not.toHaveProperty('baseUrl');
 expect(postCalls(fetcher,'/models')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'清空模型筛选'}));
 expect(document.activeElement).toBe(screen.getByLabelText('筛选已获取的模型'));
 expect(postCalls(fetcher,'/models')).toHaveLength(1);
});

it('clears Key and ignores a late directory response after switching provider',async()=>{
 const pending=deferred<ReturnType<typeof response>>();
 const fetcher=mockService(noConnection,()=>pending.promise);await openReady();
 key();fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));
 const oldSignal=postCalls(fetcher,'/models')[0][1]?.signal;
 fireEvent.change(screen.getByLabelText('服务商'),{target:{value:'siliconflow'}});
 expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');expect(oldSignal?.aborted).toBe(true);
 await act(async()=>pending.resolve(response({mode:'listed',models:['wrong-provider-model'],message:'',truncated:false})));
 expect(screen.queryByRole('option',{name:'wrong-provider-model'})).toBeNull();
 expect((screen.getByRole('button',{name:'保存已测试连接'}) as HTMLButtonElement).disabled).toBe(true);
});

it('sends identical DashScope scope and revision to query and test and preserves the old remark',async()=>{
 const stored={...existing,provider:'dashscope' as const,region:'ap-southeast-1',workspace:'team-space'};
 const fetcher=mockService({connection:stored,mode:'user',available:true},path=>path.endsWith('/models')?response({mode:'manual',models:[],message:'请手填模型 ID',truncated:false}):response({...token('qwen-plus'),provider:'dashscope'}));
 await openReady();expect((screen.getByLabelText('地域') as HTMLSelectElement).value).toBe('ap-southeast-1');
 key();fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));await screen.findByText('请手填模型 ID');await manualModel('qwen-plus');await testReady();
 const query=body(postCalls(fetcher,'/models')[0][1]),tested=body(postCalls(fetcher,'/test')[0][1]);
 expect(query).toEqual({provider:'dashscope',apiKey:'test-key-for-fixture',region:'ap-southeast-1',workspace:'team-space',expectedRevision:'revision-1'});
 expect(tested).toMatchObject({...query,name:'项目连接',model:'qwen-plus'});
 fireEvent.change(screen.getByLabelText('业务空间／Workspace（选填）'),{target:{value:'next-space'}});
 expect(screen.queryByText('请手填模型 ID')).toBeNull();expect((screen.getByRole('button',{name:'保存已测试连接'}) as HTMLButtonElement).disabled).toBe(true);
});

it.each(['azure-openai','azure-foundry'] as const)('keeps %s catalogs separate from the manually entered deployment',async provider=>{
 const endpoint=provider==='azure-openai'?'https://fixture.openai.azure.com':'https://fixture.services.ai.azure.com';
 const fetcher=mockService(noConnection,path=>path.endsWith('/models')?response({mode:'catalog',models:['catalog-model'],message:'模型目录查询成功。',truncated:false}):response({...token('deployment-prod'),provider}));
 await openReady();fireEvent.change(screen.getByLabelText('服务商'),{target:{value:provider}});key();
 fireEvent.change(screen.getByLabelText('资源地址'),{target:{value:endpoint}});
 fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));await screen.findByText(/模型目录不代表已部署/);
 expect((screen.getByLabelText('部署名称') as HTMLInputElement).value).toBe('');expect(screen.queryByRole('option',{name:'catalog-model'})).toBeNull();
 expect(screen.queryByLabelText('模型')).toBeNull();
 fireEvent.change(screen.getByLabelText('部署名称'),{target:{value:'deployment-prod'}});await testReady();
 const query=body(postCalls(fetcher,'/models')[0][1]),tested=body(postCalls(fetcher,'/test')[0][1]);
 expect(query).toMatchObject({provider,azureEndpoint:endpoint,expectedRevision:null});expect(query).not.toHaveProperty('region');
 expect(tested).toMatchObject({...query,model:'deployment-prod'});
});

it.each([
 ['empty','查询成功，当前目录没有返回模型。可重试或手动输入模型 ID。'],
 ['credential','API Key 无效，请检查后重试'],
 ['permission','当前 Key 无权读取模型目录，请检查权限'],
 ['manual','此服务商暂不支持模型目录查询，请手动输入模型 ID 并测试。'],
] as const)('distinguishes %s from directory availability and permits manual recovery',async(kind,expected)=>{
 const fetcher=mockService(noConnection,()=>kind==='credential'||kind==='permission'?response({message:expected},false):response({mode:kind==='empty'?'listed':'manual',models:[],message:kind==='manual'?expected:'',truncated:false}));
 await openReady();key();fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));await screen.findByText(expected);
 expect(screen.getByLabelText('模型 ID')).toBeTruthy();
 if(kind!=='empty')expect(screen.queryByText(/查询成功，当前目录没有返回模型/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));await waitFor(()=>expect(postCalls(fetcher,'/models')).toHaveLength(2));
});

it('reports returned range and does not imply a truncated directory is complete',async()=>{
 mockService(noConnection,()=>response({mode:'listed',models:['model-a'],message:'',truncated:true}));
 await openReady();key();fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));
 await screen.findByText('仅展示本次目录返回的前 1 项；其他模型 ID 可手动填写。');
});

it('invalidates late test results when the remark changes and never saves that snapshot',async()=>{
 const pending=deferred<ReturnType<typeof response>>();const fetcher=mockService({connection:existing,mode:'user',available:true},()=>pending.promise);await openReady();
 key();await manualModel();fireEvent.click(screen.getByRole('button',{name:'测试连接'}));
 fireEvent.change(screen.getByLabelText('连接备注（选填）'),{target:{value:'新的备注'}});
 expect(postCalls(fetcher,'/test')[0][1]?.signal?.aborted).toBe(true);
 await act(async()=>pending.resolve(response(token())));
 expect(screen.queryByText(/模型调用已验证/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'保存已测试连接'}));
 expect(postCalls(fetcher,'/save')).toHaveLength(0);
});

it('expires tested permission without needing another field edit',async()=>{
 mockService(noConnection,path=>response(path.endsWith('/models')?manualDirectory:token()));await openReady();key();await manualModel();await testReady();
 vi.useFakeTimers();
 // Trigger a fresh test while fake timers own the expiry timeout.
 fireEvent.change(screen.getByLabelText('连接备注（选填）'),{target:{value:'限时测试'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'测试连接'}));});
 expect((screen.getByRole('button',{name:'保存已测试连接'}) as HTMLButtonElement).disabled).toBe(false);
 await act(async()=>{vi.advanceTimersByTime(600001);});
 expect((screen.getByRole('button',{name:'保存已测试连接'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText('连接测试已过期，请重新测试后保存。')).toBeTruthy();
});

it('blocks all writes when initial read fails and retries before editing',async()=>{
 let reads=0;
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{expect(String(input).endsWith('/matrix/connection')).toBe(true);return ++reads===1?response({message:'读取连接失败'},false):response(noConnection);});
 vi.stubGlobal('fetch',fetcher);render(<Harness/>);await screen.findByText('读取连接失败');
 expect((screen.getByRole('button',{name:'测试连接'}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByRole('button',{name:'保存已测试连接'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'重新读取连接'}));
 await waitFor(()=>expect((screen.getByLabelText('服务商') as HTMLSelectElement).closest('fieldset')?.disabled).toBe(false));
 expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(['requiresAdminEndpoint','settingsUnavailable'] as const)('keeps %s configurations read/remove-only until an explicit removal',async flag=>{
 const stored={...existing,[flag]:true};const notify=vi.fn();
 const fetcher=mockService({connection:stored,mode:'host',available:true},()=>response(noConnection));
 render(<Harness onChange={notify}/>);await screen.findByText(/此处仅可查看或移除/);
 expect((screen.getByLabelText('服务商') as HTMLSelectElement).closest('fieldset')?.disabled).toBe(true);
 expect((screen.getByRole('button',{name:'测试连接'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'移除连接'}));expect(postCalls(fetcher,'/remove')).toHaveLength(0);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'取消移除'}));
 fireEvent.click(screen.getByRole('button',{name:'取消移除'}));expect(notify).toHaveBeenLastCalledWith(stored);
});

it('preserves the saved connection on test failure and clears credentials after close/reopen',async()=>{
 const notify=vi.fn();const fetcher=mockService({connection:existing,mode:'user',available:true},()=>response({message:'当前模型无调用权限'},false));
 await openReady(notify);key();await manualModel();fireEvent.click(screen.getByRole('button',{name:'测试连接'}));await screen.findByText('当前模型无调用权限');
 expect(notify).toHaveBeenLastCalledWith(existing);expect(postCalls(fetcher,'/save')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'关闭',exact:true}));fireEvent.click(screen.getByRole('button',{name:'打开连接设置'}));
 await waitFor(()=>expect((screen.getByLabelText('服务商') as HTMLSelectElement).closest('fieldset')?.disabled).toBe(false));
 expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');expect((screen.getByLabelText('连接备注（选填）') as HTMLInputElement).value).toBe(existing.name);
 expect((screen.getByLabelText('模型 ID') as HTMLInputElement).value).toBe(existing.model);
});

it('refreshes after saving and preserves host priority instead of inferring an active user model',async()=>{
 const saved={...existing,revision:'revision-2',name:'OpenAI · gpt-4.1'};let stored:ConnectionState={connection:null,mode:'host',available:true};
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);if(path.endsWith('/test'))return response(token());if(path.endsWith('/models'))return response(manualDirectory);
  if(path.endsWith('/save')){stored={connection:saved,mode:'host',available:true};return response({connection:saved});}
  return response(stored);
 });vi.stubGlobal('fetch',fetcher);const notify=vi.fn();await openReady(notify);key();await manualModel();await testReady();
 fireEvent.click(screen.getByRole('button',{name:'保存已测试连接'}));await screen.findByText('个人连接已保存。');
 expect(fetcher.mock.calls.filter(([path])=>String(path).endsWith('/matrix/connection'))).toHaveLength(2);
 expect(screen.getByText('平台统一模型优先，个人连接保存后暂不参与生成。')).toBeTruthy();expect(notify).toHaveBeenLastCalledWith(saved);
 expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
 expect(body(fetcher.mock.calls.find(([path])=>String(path).endsWith('/save'))?.[1])).toMatchObject({expectedRevision:null});
});

it('reconciles a dispatched save after close and locks a reopened dialog until the write settles',async()=>{
 const pending=deferred<ReturnType<typeof response>>(),saved={...existing,revision:'revision-2'};let stored=noConnection;
 const fetcher=vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);if(path.endsWith('/test'))return Promise.resolve(response(token()));if(path.endsWith('/models'))return Promise.resolve(response(manualDirectory));
  if(path.endsWith('/save'))return pending.promise;
  return Promise.resolve(response(stored));
 });vi.stubGlobal('fetch',fetcher);const notify=vi.fn();await openReady(notify);key();await manualModel();await testReady();
 fireEvent.click(screen.getByRole('button',{name:'保存已测试连接'}));
 const signal=fetcher.mock.calls.find(([path])=>String(path).endsWith('/save'))?.[1]?.signal;
 fireEvent.click(screen.getByRole('button',{name:'关闭',exact:true}));expect(signal?.aborted).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'打开连接设置'}));
 expect((screen.getByRole('button',{name:'测试连接'}) as HTMLButtonElement).disabled).toBe(true);
 stored={connection:saved,mode:'user',available:true};
 await act(async()=>pending.resolve(response({connection:saved})));
 await screen.findByText('个人连接已保存。');expect(notify).toHaveBeenLastCalledWith(saved);
 expect((screen.getByLabelText('连接备注（选填）') as HTMLInputElement).value).toBe(saved.name);
});

it('refreshes an uncertain save outcome and disables writes if reconciliation fails',async()=>{
 let failRead=false;
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
  const path=String(input);if(path.endsWith('/test'))return response(token());
  if(path.endsWith('/save')){failRead=true;throw new Error('保存响应中断');}
  if(failRead)return response({message:'无法读取当前状态'},false);return response({connection:existing,mode:'user',available:true});
 });vi.stubGlobal('fetch',fetcher);await openReady();key();await manualModel();await testReady();
 fireEvent.click(screen.getByRole('button',{name:'保存已测试连接'}));await screen.findByText(/请求结果尚未确认/);
 expect(screen.queryByText('个人连接已保存。')).toBeNull();expect((screen.getByRole('button',{name:'测试连接'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'重新读取连接'})).toBeTruthy();
});

it('removes only after confirmation then reads actual fallback availability',async()=>{
 let stored:ConnectionState={connection:existing,mode:'user',available:true};
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/remove')){expect(body(init)).toEqual({expectedRevision:'revision-1'});stored={connection:null,mode:'none',available:false,message:'当前没有可用的 AI 连接'};return response(stored);}
  return response(stored);
 });vi.stubGlobal('fetch',fetcher);const notify=vi.fn();await openReady(notify);
 fireEvent.click(screen.getByRole('button',{name:'移除连接'}));fireEvent.click(screen.getByRole('button',{name:'确认移除连接'}));
 await screen.findByText('个人连接已移除。');expect(notify).toHaveBeenLastCalledWith(null);expect(screen.getByText('当前没有可用的 AI 连接')).toBeTruthy();
 expect(fetcher.mock.calls.filter(([path])=>String(path).endsWith('/matrix/connection'))).toHaveLength(2);
});

it('renders automatic names once, including the server-truncated name',()=>{
 expect(connectionDisplayName({...existing,name:'OpenAI · gpt-4.1'})).toBe('OpenAI · gpt-4.1');
 const model='model-'+('x'.repeat(150)),automatic='Microsoft Foundry · '+model;
 expect(connectionDisplayName({...existing,provider:'azure-foundry',model,name:automatic.slice(0,100)})).toBe(automatic);
 expect(connectionDisplayName(existing)).toBe('项目连接 · gpt-4.1');
});

it('restores an automatic name as an empty remark so a changed model receives a new automatic name',async()=>{
 const automatic={...existing,name:'OpenAI · gpt-4.1'};
 const fetcher=mockService({connection:automatic,mode:'user',available:true},()=>response(token('gpt-4.1-mini')));
 await openReady();expect((screen.getByLabelText('连接备注（选填）') as HTMLInputElement).value).toBe('');
 key();await manualModel('gpt-4.1-mini');await testReady();
 expect(body(postCalls(fetcher,'/test')[0][1])).toMatchObject({model:'gpt-4.1-mini',expectedRevision:'revision-1'});
 expect(body(postCalls(fetcher,'/test')[0][1])).not.toHaveProperty('name');
});

it('ignores an old directory after close/reopen and never carries its Key into the new session',async()=>{
 const pending=deferred<ReturnType<typeof response>>();mockService(noConnection,()=>pending.promise);await openReady();
 key();fireEvent.click(screen.getByRole('button',{name:'获取模型列表'}));
 fireEvent.click(screen.getByRole('button',{name:'关闭',exact:true}));fireEvent.click(screen.getByRole('button',{name:'打开连接设置'}));
 await waitFor(()=>expect((screen.getByLabelText('服务商') as HTMLSelectElement).closest('fieldset')?.disabled).toBe(false));
 await act(async()=>pending.resolve(response({mode:'listed',models:['obsolete-model'],message:'',truncated:false})));
 expect(screen.queryByRole('option',{name:'obsolete-model'})).toBeNull();expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
});
