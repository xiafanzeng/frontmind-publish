import { lazy, Suspense, useContext, useEffect,useLayoutEffect,useMemo,useRef,useState,type FormEvent } from 'react';
import { Link,useLocation,useSearch } from 'wouter';
import { projectWorkspaceUrl,usePublishingWorkspaceKey,useWorkspaceDraftGuard } from '../host';
import { matrixApi,downloadUrl } from './api';
import type { ApplyPlanDiff,BudgetPlan,MatrixResult,ServerBinding,TaskResponse } from './types';
import { label,display,Report,ModelInputDialog,BudgetConfirmDialog } from './SourceMatrixPresentation';
import {BudgetRecommendations,MatrixRecommendation,RecommendationReason,candidateForItem,differentPlans,itemObject} from './MatrixRecommendation';
import {LiveIndustryDistribution} from './industry/IndustryDistribution';
import {MediaShell,MediaCartFooter,MediaTaskbar,MediaDetails,useMarketRules,rulesRequest} from './MediaMarket';
import {usePublisherGateway} from '../PublishingContext';
import {publishingDraftRequestKey,usePublishingFlow} from '../PublishingFlowContext';
import {useMediaSelectionTask} from '../useMediaSelectionTask';
import {uniqueBatchIds} from '../batchMediaSelection';
import {titleModeForFlowMode,type FlowStageMode} from '../components/PublishingFlowSteps';
import {mediaShortlistKey,mediaSelectionBlocker} from '../mediaShortlist';
import {formatPublishingMoney,type ArticleVersion,type MediaResource,type PublicationDraft} from '../types';
import { SourceMatrixPreviewContext } from './simulation/mode';
import { referenceScopeStyle } from './ReferenceScope';
import './simulation/simulation.css';
import './source-matrix.css';
const SimulationPage=lazy(()=>import('./simulation/SimulationPage'));
type MatrixView='matrix'|'analysis'|'report'|'industry';
export default function SourceMatrixPage({view='analysis'}:{view?:MatrixView}) {
 const [path,navigate]=useLocation(),search=useSearch(),workspace=usePublishingWorkspaceKey();
 const preview=useContext(SourceMatrixPreviewContext),params=new URLSearchParams(search);
 const simulation=params.get('simulation')==='1'||(!params.has('simulation')&&preview);
 const activeView=params.get('tab')==='matrix'?'matrix':params.get('tab')==='analysis'?'analysis':view==='matrix'||view==='report'?'matrix':'analysis';
 const changeMode=(enabled:boolean)=>{
  const next=new URLSearchParams(search);next.set('simulation',enabled?'1':'0');
  // Neither a real task nor a draft binding crosses the mode boundary.
  next.delete('task');next.delete('draftId');next.delete('matrixTask');next.delete('articleVersion');next.delete('workbenchTask');
  next.delete('batchDraft');next.delete('batchArticleVersion');next.delete('batchArticle');next.delete('excludedDraft');
  navigate(projectWorkspaceUrl(path+'?'+next.toString())+(typeof window!=='undefined'?window.location.hash:''));
 };
 return <><div className="fm-media sm-sim-mode" style={referenceScopeStyle}>
  <div className="sm-sim-mode-control"><label><input type="checkbox" role="switch" checked={simulation} onChange={e=>changeMode(e.target.checked)}/>一航软件样本</label><span>{simulation?'样本分析 · 独立研究，不用于真实采购':'真实模式 · 使用已接入的行业数据'}</span></div>
 </div>{simulation?<Suspense fallback={<p role="status">正在准备一航软件样本…</p>}><SimulationPage key={'simulated:'+workspace} view={activeView}/></Suspense>:<LiveSourceMatrixPage key={'real:'+workspace} view={activeView}/>}</>;
}
function LiveSourceMatrixPage({view='analysis'}:{view?:MatrixView}) {
 const [path,navigate]=useLocation(),search=useSearch(),workspace=usePublishingWorkspaceKey();
 const params=new URLSearchParams(search),taskId=params.get('task')??params.get('matrixTask')??'';
 const [industries,setIndustries]=useState<Array<{id:string;name:string}>>([]),[industry,setIndustry]=useState(''),[questions,setQuestions]=useState(''),[product,setProduct]=useState(''),[audience,setAudience]=useState(''),[regions,setRegions]=useState('');
 const [modelOpen,setModelOpen]=useState(false),[confirmBudget,setConfirmBudget]=useState<BudgetPlan|null>(null),[confirmLayer,setConfirmLayer]=useState<MatrixResult['matrix']['candidates']|null>(null),[reasonCandidate,setReasonCandidate]=useState<MatrixResult['matrix']['candidates'][number]|null>(null),[planIndex,setPlanIndex]=useState(0),[showReport,setShowReport]=useState(false);
 const [result,setResult]=useState<MatrixResult|null>(null),[error,setError]=useState<Error|null>(null),[notice,setNotice]=useState(''),[industryUnavailable,setIndustryUnavailable]=useState(false),[industryAttempt,setIndustryAttempt]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[,setTaskState]=useState(''),[pollEpoch,setPollEpoch]=useState(0),[selected,setSelected]=useState<string[]>([]);
 const [matrixInput,setMatrixInput]=useState<string|null>(null),[matrixBinding,setMatrixBinding]=useState<string|null>(null),[serverStale,setServerStale]=useState(false),[budgetPending,setBudgetPending]=useState(false);
 const [applyPreview,setApplyPreview]=useState<{scope:string;data:ApplyPlanDiff}|null>(null),[applyBusy,setApplyBusy]=useState(false);
 const [currency,setCurrency]=useState('CNY'),[total,setTotal]=useState(''),[exploration,setExploration]=useState(''),[enabled,setEnabled]=useState(false),[min,setMin]=useState(''),[max,setMax]=useState(''),[fieldError,setFieldError]=useState(''),[errorStage,setErrorStage]=useState<'matrix'|'budget'>('matrix'),[failedOperation,setFailedOperation]=useState<'load'|'matrix'|'budget'>('load');
 const appliedBudget=useRef('');
 const reasonTrigger=useRef<HTMLElement|null>(null);
 const openReason=(candidate:MatrixResult['matrix']['candidates'][number])=>{reasonTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setReasonCandidate(candidate);};
 const latestInput=useRef(''),latestBudget=useRef(''),latestRecommendationContext=useRef(''),pendingBudget=useRef<{key:string;matrix:MatrixResult}|null>(null);
 const inputKey=JSON.stringify([industry,product.trim(),audience.trim(),regions.split('、').map(value=>value.trim()).filter(Boolean),questions.split('\n').map(value=>value.trim()).filter(Boolean)]);latestInput.current=inputKey;
 const submissionLock=useRef(false);
 const request=useRef<AbortController|null>(null),pollRequest=useRef<AbortController|null>(null),cancelRequest=useRef<AbortController|null>(null),sequence=useRef(0),formRef=useRef<HTMLElement>(null);
 useWorkspaceDraftGuard({dirty:!!questions&&(!result&&!taskId||matrixInput!==null&&matrixInput!==inputKey),label:'信源矩阵输入'});
 const href=(v:string,id=taskId)=>{const params=new URLSearchParams(search);params.set('tab',v==='matrix'||v==='report'?'matrix':'analysis');if(id)params.set('task',id);else params.delete('task');return projectWorkspaceUrl(`/publishing/source-matrix?${params.toString()}`)+(typeof window!=='undefined'?window.location.hash:'');};
 useEffect(()=>{const abort=new AbortController();setLoading(true);
  void matrixApi<{industries:Array<{id:string;name:string}>;message?:string}>('/industries',abort.signal).then(r=>{if(!abort.signal.aborted){setIndustries(r.industries);setIndustryUnavailable(!r.industries.length);}}).catch(()=>{if(!abort.signal.aborted)setIndustryUnavailable(true);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>{abort.abort();};
 },[workspace,industryAttempt]);
 useEffect(()=>{setResult(null);setMatrixInput(null);setMatrixBinding(null);setServerStale(false);setSelected([]);setBusy(!!taskId);setError(null);setNotice('');setConfirmBudget(null);setConfirmLayer(null);setReasonCandidate(null);setBudgetPending(false);submissionLock.current=false;pendingBudget.current=null;appliedBudget.current='';return()=>{request.current?.abort();cancelRequest.current?.abort();sequence.current++;};},[taskId]);
 const serviceMessage=(value:string)=>/迁移|migration|ER_NO_SUCH_TABLE|凭据|PUBLISHER_/.test(value)?'推荐服务暂不可用，请稍后重试或联系运营。':value;
 const receiveTask=(response:TaskResponse)=>{
  const next=response.result,pending=pendingBudget.current;
  setTaskState(response.state??'');setBusy(response.state==='running');
  if(pending){
   // A 202 precheck is not a persisted plan snapshot. Keep the last complete
   // plan id/version until the matching terminal result has been saved.
   if(response.state==='running'){setNotice(pending.key!==latestBudget.current?'预算、需求或媒体选择已变化，先前组合仅供查询；请在处理结束后重新生成。':'预算组合正在校验，请稍后刷新结果。');return;}
   if(pending.key!==latestBudget.current){setNotice('预算、需求或媒体选择已变化，先前组合未应用。请重新生成组合。');if(response.state!=='running'){pendingBudget.current=null;setBudgetPending(false);}return;}
   if(next?.status==='stale_matrix'){setServerStale(true);setNotice('任务数据已变化，请更新矩阵后再生成组合。');}
   else if(next?.matrix){
    if(next.matrix_version!==pending.matrix.matrix_version){setServerStale(true);setNotice('矩阵版本已变化，请重新更新矩阵。');}
    else {setResult({...next,matrix:pending.matrix.matrix,source_analysis:pending.matrix.source_analysis});setPlanIndex(0);if(response.state!=='running'){appliedBudget.current=pending.key;setNotice('');}}
   } else if(next)setNotice(serviceMessage(next.errors?.map(issue=>issue.message).join('；')||label(next.status)));
   if(response.state!=='running'){pendingBudget.current=null;setBudgetPending(false);}return;
  }
  if(next?.matrix){setResult(next);if(response.state!=='running')setNotice('');}
  else if(next){if(next.status==='stale_matrix')setServerStale(true);setNotice(serviceMessage(next.errors?.map(issue=>issue.message).join('；')||label(next.status)));}
 };
 useEffect(()=>{
  if(!taskId){setResult(null);setTaskState('');return;}const abort=new AbortController();pollRequest.current=abort;let timer:ReturnType<typeof setTimeout>|undefined,attempt=0;
  const poll=async()=>{try{const r=await matrixApi<TaskResponse>('/classify/'+encodeURIComponent(taskId),abort.signal);if(abort.signal.aborted)return;receiveTask(r);
    if(r.state==='running'){if(++attempt<150)timer=setTimeout(()=>void poll(),2000);else{setBusy(false);setNotice('任务仍在处理中，可点击刷新结果继续查询。');}}
   }catch(e){if(!abort.signal.aborted){setFailedOperation('load');setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));setBusy(false);setBudgetPending(false);}}};void poll();return()=>{abort.abort();if(timer)clearTimeout(timer);};
 },[taskId,workspace,pollEpoch]);
 async function refresh(){if(!taskId)return;setError(null);setFailedOperation('load');const abort=new AbortController();request.current?.abort();request.current=abort;try{const r=await matrixApi<TaskResponse>('/classify/'+encodeURIComponent(taskId),abort.signal);if(!abort.signal.aborted){receiveTask(r);if(r.state==='running')setPollEpoch(n=>n+1);}}catch(e){if(!abort.signal.aborted)setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));}}
 async function submit(stage:'matrix'|'budget',e:FormEvent){e.preventDefault();if(busy||submissionLock.current||(e.nativeEvent as Event&{isComposing?:boolean}).isComposing)return;setFieldError('');setErrorStage(stage);
  const qs=questions.split('\n').map(q=>q.trim()).filter(Boolean);
  if(stage==='matrix'&&(!industry||!qs.length)){setFieldError('请选择已配置行业，并填写至少一个问题（每行一个）。');formRef.current?.querySelector<HTMLElement>(!industry?'select':'textarea')?.focus();return;}
  if(stage==='budget'&&(!total||!/^\d+(?:\.\d+)?$/.test(total))){setFieldError('请输入非负十进制总预算，勿使用科学计数法。');document.getElementById('z-budget-total')?.focus();return;}
  if(stage==='budget'&&(!result||matrixStale)){setFieldError('请先更新当前需求与稿件对应的矩阵。');return;}
  if(stage==='budget'){pendingBudget.current={key:latestBudget.current,matrix:result!};setBudgetPending(true);appliedBudget.current='';}
  else {pendingBudget.current=null;setBudgetPending(false);}
  const submittedInput=inputKey,submittedContext=latestRecommendationContext.current;submissionLock.current=true;
  const abort=new AbortController(),seq=++sequence.current;request.current?.abort();pollRequest.current?.abort();request.current=abort;setBusy(true);setError(null);setNotice('');
  try{
   const body=stage==='matrix'?{industry_id:industry,questions:qs,...(product?{product}:{}),...(audience?{audience}:{}),...(regions.trim()?{regions:regions.split('、').map(x=>x.trim()).filter(Boolean)}:{}),as_of:new Date().toISOString(),
     // Name the real draft/version; the server re-reads and verifies them.
     ...(serverDraft?{draft_id:serverDraft.id,article_version_id:serverDraft.articleVersionId}:contextDraftId||articleVersionId?{...(contextDraftId?{draft_id:contextDraftId}:{}),...(articleVersionId?{article_version_id:articleVersionId}:{})}:{})}
    :{plan_id:result?.plan_id,plan_version:result?.plan_version,budget:{currency,total_cap:total,exploration_enabled:enabled,...(enabled&&exploration!==''?{exploration_cap:exploration}:{}),...(min!==''?{unit_price_min:min}:{}),...(max!==''?{unit_price_max:max}:{})},selected_candidate_ids:selected,as_of:new Date().toISOString()};
   const r=await matrixApi<TaskResponse>(stage==='matrix'?'/matrix/generate':'/classify/'+encodeURIComponent(taskId)+'/budget',abort.signal,body);
   if(seq!==sequence.current||abort.signal.aborted)return;
   if(latestRecommendationContext.current!==submittedContext){setBusy(false);setBudgetPending(false);pendingBudget.current=null;setNotice('稿件或任务上下文已变化，先前请求未应用。');return;}
   if(stage==='matrix'&&submittedInput!==latestInput.current){setBusy(false);setNotice('投放需求已变化，先前生成结果未应用。请按当前需求重新生成。');return;}
   receiveTask(r);if(r.state==='running')setPollEpoch(n=>n+1);
   if(stage==='matrix'&&r.task_id){setSelected([]);navigate(href('matrix',r.task_id));}
   if(stage==='budget'&&r.state==='running')setNotice('预算组合正在校验，请稍后刷新结果。');
  }catch(e){if(!abort.signal.aborted&&seq===sequence.current){setFailedOperation(stage);setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));setBusy(false);setBudgetPending(false);pendingBudget.current=null;}}finally{if(seq===sequence.current)submissionLock.current=false;}
 }
 async function cancel(){
  if(!taskId||cancelRequest.current&&!cancelRequest.current.signal.aborted)return;
  const abort=new AbortController(),context=latestRecommendationContext.current,seq=sequence.current;cancelRequest.current=abort;
  const current=()=>mounted.current&&!abort.signal.aborted&&context===latestRecommendationContext.current&&seq===sequence.current;
  try{await matrixApi('/classify/'+encodeURIComponent(taskId)+'/cancel',abort.signal,{});if(!current())return;request.current?.abort();pollRequest.current?.abort();submissionLock.current=false;sequence.current++;setBusy(false);setBudgetPending(false);pendingBudget.current=null;setResult(null);setTaskState('cancelled');setPollEpoch(n=>n+1);}
  catch(e){if(current())setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));}
  finally{if(cancelRequest.current===abort)cancelRequest.current=null;}
 }
 const candidates=result?.matrix.candidates??[];
 const gateway=usePublisherGateway(),flow=usePublishingFlow(),shortlist=mediaShortlistKey(workspace,search);
 const routeDraftId=params.get('draftId')??'',routeVersionId=params.get('articleVersion')??'',routeTaskId=params.get('workbenchTask')??'';
 const contextDraftId=routeDraftId||flow?.resources?.find(resource=>resource.kind==='publication_draft')?.id||'';
 const articleVersionId=routeVersionId||flow?.resources?.find(resource=>resource.kind==='article_version')?.id||'';
 const mode=params.get('mode')??'',workbenchTask=routeTaskId||flow?.taskId||'';
 const batchBindingKey=JSON.stringify([params.getAll('batchArticleVersion'),params.getAll('batchDraft')]);
 const selectionResources=(draft:PublicationDraft)=>{
  if(mode!=='batch')return [{kind:'article_version' as const,id:draft.articleVersionId},{kind:'publication_draft' as const,id:draft.id}];
  // Workbench records replace a resource kind as a whole. Preserve every
  // batch member when the matrix updates its currently bound article.
  const versions=uniqueBatchIds([...params.getAll('batchArticleVersion'),...(flow?.resources?.filter(item=>item.kind==='article_version').map(item=>item.id)??[]),draft.articleVersionId]);
  const drafts=uniqueBatchIds([...params.getAll('batchDraft'),...(flow?.resources?.filter(item=>item.kind==='publication_draft').map(item=>item.id)??[]),draft.id]);
  return [...versions.map(id=>({kind:'article_version' as const,id})),...drafts.map(id=>({kind:'publication_draft' as const,id}))];
 };
 const taskContext=useMemo(()=>({gateway,workspace,shortlist,routeDraftId,routeVersionId,routeTaskId,mode,batchBindingKey,taskId,flowScope:flow?.scopeKey,agent:flow?.agentId}),
  [gateway,workspace,shortlist,routeDraftId,routeVersionId,routeTaskId,mode,batchBindingKey,taskId,flow?.scopeKey,flow?.agentId]);
 const selectionTask=useMediaSelectionTask(flow,taskContext);
 const cartKey=JSON.stringify([shortlist,flow?.scopeKey,contextDraftId,articleVersionId,selectionTask.scopeKey,routeTaskId,mode,taskId]);
 const cartScope=useMemo(()=>({gateway,key:cartKey}),[gateway,cartKey]);
 const [binding,setBinding]=useState<{scope:typeof cartScope;loading:boolean;error:string;draft?:PublicationDraft;version?:ArticleVersion}>();
 const currentBinding=binding?.scope===cartScope?binding:undefined,serverDraft=currentBinding?.draft;
 const [bindingAttempt,setBindingAttempt]=useState(0),[cartBusy,setCartBusy]=useState(false),cartEpoch=useRef(0),cartMutation=useRef(false);
 const [mappedState,setMappedState]=useState<{scope:typeof cartScope;items:MediaResource[];loading?:boolean;error?:string}>(),[detailMedia,setDetailMedia]=useState<MediaResource>();
 const [mappingAttempt,setMappingAttempt]=useState(0);
 const mapped=useMemo(()=>mappedState?.scope===cartScope?mappedState.items:[],[mappedState,cartScope]);
 const [associationAck,setAssociationAck]=useState<{scope:typeof cartScope;draftId:string;versionId:string}>();
 const researchSelection=flow?.selections?.mediaSelection;
 const cart=useMemo(()=>{
  if(serverDraft)return new Map(serverDraft.items.map(item=>[item.media.id,item.media]));
  // Reuse the current flow's research list for display only. A failed bound
  // draft/version read must never fall back to a different local shopping cart.
  if(contextDraftId||articleVersionId||!Array.isArray(researchSelection))return new Map<string,MediaResource>();
  const rows=researchSelection.filter((row):row is MediaResource=>Boolean(row&&typeof row==='object'&&typeof row.id==='string'&&typeof row.priceTenThousandths==='string'));
  return new Map(rows.slice(0,20).map(row=>[row.id,row]));
 },[serverDraft,contextDraftId,articleVersionId,researchSelection]);
 const latestScope=useRef(cartScope);latestScope.current=cartScope;
 const mounted=useRef(false),routeOwner=useMemo(()=>({gateway,workspace,path,search,taskScope:selectionTask.scopeKey}),[gateway,workspace,path,search,selectionTask.scopeKey]);
 const latestOwner=useRef(routeOwner);latestOwner.current=routeOwner;
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cartEpoch.current++;};},[]);
 useLayoutEffect(()=>{cartEpoch.current++;cartMutation.current=false;setCartBusy(false);setConfirmBudget(null);setConfirmLayer(null);appliedBudget.current='';},[cartScope]);
 const setServerDraft=(draft:PublicationDraft)=>setBinding({scope:cartScope,loading:false,error:'',draft});
 useEffect(()=>{
  const abort=new AbortController();setBinding({scope:cartScope,loading:true,error:''});
  const timer=setTimeout(()=>{abort.abort();setBinding({scope:cartScope,loading:false,error:'稿件上下文读取超时，请重试。'});},20_000);
  void (async()=>{
   if(contextDraftId){
    const draft=await gateway.getDraft(contextDraftId,abort.signal);
    if(draft.id!==contextDraftId||articleVersionId&&draft.articleVersionId!==articleVersionId)throw new Error('投放草稿与指定稿件版本不一致，请返回稿件页面核对。');
    return {draft};
   }
   if(articleVersionId){
    const version=await gateway.getArticleVersion(articleVersionId,abort.signal);
    if(version.id!==articleVersionId||!version.frozen)throw new Error('指定稿件版本尚未确认，请返回稿件页面核对。');
    return {version};
   }
   return {};
  })().then(value=>{if(!abort.signal.aborted)setBinding({scope:cartScope,loading:false,error:'',...value});}).catch(reason=>{if(!abort.signal.aborted)setBinding({scope:cartScope,loading:false,error:reason instanceof Error?reason.message:'稿件上下文读取失败，请重试。'});}).finally(()=>clearTimeout(timer));
  return()=>{abort.abort();clearTimeout(timer);};
 },[cartScope,bindingAttempt,contextDraftId,articleVersionId,gateway]);
 const bindingIssue=!currentBinding||currentBinding.loading?'正在读取稿件上下文…':currentBinding.error
  ||(!serverDraft&&!currentBinding.version?'请先在稿件页面确认一份稿件，再选择媒体。':'');
 const draftRegistered=Boolean(serverDraft&&flow?.records?.some(record=>record.id===`media-draft:${serverDraft.id}`&&record.status==='completed')
  &&flow.resources?.some(resource=>resource.kind==='publication_draft'&&resource.id===serverDraft.id)
  &&flow.resources?.some(resource=>resource.kind==='article_version'&&resource.id===serverDraft.articleVersionId));
 // A failed association must remain recoverable after refresh, using only the
 // draft verified in this scope rather than a saved object from another task.
 const registrationPending=Boolean(flow&&serverDraft&&serverDraft.id===contextDraftId&&!bindingIssue&&!draftRegistered
  &&!(associationAck?.scope===cartScope&&associationAck.draftId===serverDraft.id&&associationAck.versionId===serverDraft.articleVersionId));
 const articleHasImages=serverDraft?.articleContainsImages??currentBinding?.version?.containsImages??false;
 const mediaHref=(view:'home'|'third'|'cart')=>{
  const query=new URLSearchParams(search);query.delete('task');query.delete('draftId');query.delete('simulation');
  if(taskId)query.set('matrixTask',taskId);if(serverDraft?.articleVersionId||articleVersionId)query.set('articleVersion',serverDraft?.articleVersionId||articleVersionId);if(workbenchTask)query.set('workbenchTask',workbenchTask);
  const boundId=serverDraft?.id||contextDraftId,base=boundId?`/publishing/drafts/${encodeURIComponent(boundId)}/media`:'/publishing/media';
  return projectWorkspaceUrl(base+(view==='home'?'':'/'+view)+(query.size?'?'+query.toString():''));
 };
 const persistCart=async(mediaIds:string[])=>{
  if(cartMutation.current||busy)return false;
  if(bindingIssue){setNotice(bindingIssue);return false;}
  if(mediaIds.length>20||new Set(mediaIds).size!==mediaIds.length){setNotice('一次最多选择 20 家不同媒体');return false;}
  const epoch=cartEpoch.current,scope=cartScope,owner=routeOwner;
  const current=()=>mounted.current&&epoch===cartEpoch.current&&latestScope.current===scope;
  const stillOnPage=()=>mounted.current&&latestOwner.current===owner;
  cartMutation.current=true;setCartBusy(true);setNotice('');
  try{
   let saved:PublicationDraft,savedTaskId=workbenchTask;
   if(serverDraft)saved=await gateway.updateDraftMedia(serverDraft.id,mediaIds,serverDraft.revision);
   else{
    const ownerTask=await selectionTask.ensureTask();if(ownerTask)savedTaskId=ownerTask;
    const requestKey=ownerTask?await publishingDraftRequestKey(ownerTask,articleVersionId,mediaIds):undefined;
    if(!current())return false;
    const flowMode:FlowStageMode=['single','per_media','multi','batch'].includes(mode)?mode as FlowStageMode:'default';
    saved=await gateway.createDraft(articleVersionId,mediaIds,requestKey,titleModeForFlowMode(flowMode));
   }
   if(!current())return false;
   setServerDraft(saved);
   if(!contextDraftId){
    // The draft already exists even if recording its task reference fails.
    if(flow)try{await flow.record({id:`media-draft:${saved.id}`,label:'已保存媒体选择',resources:selectionResources(saved)});}
    catch{if(stillOnPage())setNotice('媒体选择已保存到投放草稿，但任务关联未完成；可保留当前草稿继续操作。');}
    if(!stillOnPage())return false;
    const query=new URLSearchParams(search);query.set('draftId',saved.id);query.set('articleVersion',saved.articleVersionId);
    if(taskId)query.set('task',taskId);if(savedTaskId)query.set('workbenchTask',savedTaskId);
    navigate(projectWorkspaceUrl(path+'?'+query.toString()),{replace:true});
   }
   return true;
  }catch(reason){if(current())setNotice(reason instanceof Error?(reason.message==='Media title is invalid'?'稿件标题超过所选媒体的字数上限，媒体尚未加入。请核对媒体要求后，返回稿件页面调整标题。':reason.message):'购物车尚未保存，请重试');return false;}
  finally{if(current()){cartMutation.current=false;setCartBusy(false);}}
 };
 const retryAssociation=async()=>{
  if(!flow||!serverDraft||!registrationPending||bindingIssue||cartMutation.current)return;
  const owner=routeOwner;cartMutation.current=true;setCartBusy(true);
  try{await flow.record({id:`media-draft:${serverDraft.id}`,label:'已保存媒体选择',resources:selectionResources(serverDraft)});if(mounted.current&&latestOwner.current===owner){setAssociationAck({scope:cartScope,draftId:serverDraft.id,versionId:serverDraft.articleVersionId});setNotice('投放草稿已重新关联到当前任务。');}}
  catch{if(mounted.current&&latestOwner.current===owner)setNotice('投放草稿仍已保存，任务关联暂未完成，请重试。');}
  finally{if(mounted.current&&latestOwner.current===owner){cartMutation.current=false;setCartBusy(false);}}
 };
 const resourceKey=candidates.map(c=>c.resource_id).filter(Boolean).join('\n');
 useEffect(()=>{const abort=new AbortController();setMappedState({scope:cartScope,items:[],loading:!!resourceKey});if(!resourceKey)return()=>abort.abort();
  const timer=setTimeout(()=>{abort.abort();setMappedState({scope:cartScope,items:[],error:'媒体映射读取超时，请重试。'});},20_000);
  void (async()=>{let ids=resourceKey.split('\n');const internal=ids.filter(id=>/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id));const resolved=new Map<string,string>();for(let n=0;n<internal.length;n+=100){const rows=await rulesRequest<{items:Array<{id:string;externalResourceId:string}>}>('?ids='+encodeURIComponent(internal.slice(n,n+100).join(',')),abort.signal);for(const row of rows.items)resolved.set(row.id,row.externalResourceId);}ids=ids.map(id=>resolved.get(id)??id);const all:MediaResource[]=[];for(let n=0;n<ids.length;n+=50){const page=await gateway.listMedia({query:'',batchQuery:ids.slice(n,n+50).join('\n'),page:1,pageSize:100},abort.signal);all.push(...page.items);}if(!abort.signal.aborted)setMappedState({scope:cartScope,items:all});})().catch(e=>{if(!abort.signal.aborted)setMappedState({scope:cartScope,items:[],error:e instanceof Error?e.message:'媒体映射读取失败'});}).finally(()=>clearTimeout(timer));return()=>{abort.abort();clearTimeout(timer);};
 },[gateway,resourceKey,cartScope,mappingAttempt]);
 const mediaFor=(id:string|null)=>{const matches=mapped.filter(media=>!!id&&(media.id===id||media.externalResourceId===id));const unique=new Map(matches.map(media=>[media.id,media]));return unique.size===1?[...unique.values()][0]:undefined;};
 const rules=useMarketRules(mapped.map(m=>m.id),result?.matrix_version??'');
 const bindingKey=JSON.stringify([contextDraftId,articleVersionId,workbenchTask]);
 // This client-context snapshot only invalidates comparison after navigation;
 // it is not proof that dataset.manuscripts matches the current frozen version.
 latestRecommendationContext.current=JSON.stringify([workspace,taskId,bindingKey]);
 const matrixStale=!!result&&(serverStale||matrixInput!==null&&matrixInput!==inputKey||matrixBinding!==null&&matrixBinding!==bindingKey);
 const budgetKey=JSON.stringify([inputKey,bindingKey,currency,total,enabled,exploration,min,max,selected.slice().sort(),serverDraft?.revision]);latestBudget.current=budgetKey;
 const budgetStale=matrixStale||budgetPending||!!result?.budget_plans.length&&appliedBudget.current!==budgetKey;
 const reportReady=!!result&&!busy&&!budgetPending&&!matrixStale&&result.matrix.status==='complete'&&['complete','needs_budget','needs_budget_plans'].includes(result.status)&&!result.errors.length&&!!result.plan_id&&!!result.plan_version;
 const highlightedPlan=differentPlans(result?.budget_plans??[])[planIndex]??differentPlans(result?.budget_plans??[])[0]??null;
 const candidateIssue=(candidate:typeof candidates[number],media:MediaResource)=>bindingIssue||(busy?'矩阵正在更新，请稍后再选。':cartBusy?'正在保存媒体选择…':'')
  ||(!cart.has(media.id)?(matrixStale?'需求已变化，请更新矩阵。':result?.matrix.status!=='complete'?'矩阵适配尚未完成，此候选暂供研究。':!rules.ready?rules.error||'正在读取媒体规则…':candidate.channel_status!=='eligible'?'此信源的可投条件尚未通过。':mediaSelectionBlocker(media,articleHasImages)|| (cart.size>=20?'一次最多选择 20 家媒体':'')):'');
 const toggleCandidate=async(id:string)=>{
  const candidate=candidates.find(item=>item.candidate_id===id),media=candidate?mediaFor(candidate.resource_id):undefined;
  if(!candidate||!media)return;const issue=candidateIssue(candidate,media);if(issue){setNotice(issue);return;}
  const next=new Set(cart.keys());if(next.has(media.id))next.delete(media.id);else next.add(media.id);
  await persistCart([...next]);
 };
 useEffect(()=>{setSelected(candidates.filter(candidate=>{const media=mediaFor(candidate.resource_id);return media&&cart.has(media.id);}).map(candidate=>candidate.candidate_id));},[result,mapped,cart]);
 const hydratedTask=useRef('');
 useEffect(()=>{if(!result||!taskId||loading||hydratedTask.current===`${workspace}:${taskId}`)return;hydratedTask.current=`${workspace}:${taskId}`;
  const t=result.scope.task,nextIndustry=industries.find(i=>i.name===t.industry)?.id??'',nextProduct=typeof t.product==='string'?t.product:'',nextAudience=typeof t.audience==='string'?t.audience:'',nextRegions=Array.isArray(t.regions)?t.regions.filter((x):x is string=>typeof x==='string'):[],nextQuestions=Array.isArray(t.questions)?t.questions.map(q=>q&&typeof q==='object'&&!Array.isArray(q)?typeof q.text==='string'?q.text:'':typeof q==='string'?q:'').filter(Boolean):[];
  setMatrixInput(JSON.stringify([nextIndustry,nextProduct.trim(),nextAudience.trim(),nextRegions,nextQuestions]));setMatrixBinding(bindingKey);
  if(!industry&&!product&&!audience&&!regions&&!questions){setIndustry(nextIndustry);setProduct(nextProduct);setAudience(nextAudience);setRegions(nextRegions.join('、'));setQuestions(nextQuestions.join('\n'));}
  const p=result.budget_plans[0];if(p?.total_cap&&!total)setTotal(p.total_cap);if(p?.currency)setCurrency(p.currency);
  // A restored plan has no verified current-cart preference snapshot; compare it,
  // then regenerate before applying rather than treating it as freshly checked.
 },[taskId,result,workspace,industries,loading]);
 const validPrice=(media:MediaResource)=>/^\d+$/.test(media.priceTenThousandths)&&BigInt(media.priceTenThousandths)>0n;
 const pendingPrices=[...cart.values()].filter(media=>!validPrice(media)).length;
 const moneyTotal=currentBinding?.loading||currentBinding?.error||!currentBinding?undefined:[...cart.values()].reduce((sum,media)=>sum+(validPrice(media)?BigInt(media.priceTenThousandths):0n),0n).toString();
 const cartHref=mediaHref('cart');
 const footer=<MediaCartFooter count={cart.size} total={moneyTotal} cartHref={cartHref} nextLabel="查看购物车" nextDisabled={!!bindingIssue||cartBusy||registrationPending} nextHint={bindingIssue||registrationPending?'请完成当前稿件与任务关联后继续。':undefined} onNext={()=>navigate(cartHref)} pending={pendingPrices} items={[...cart.values()]} onRemove={media=>{void persistCart([...cart.keys()].filter(id=>id!==media.id));}}/>;
 const cartBudgetMessage=currency!=='CNY'&&total?'购物车费用以人民币展示；当前组合预算为 '+currency+'，不能直接比较或自动换汇。':total&&/^\d+(?:\.\d{1,4})?$/.test(total)&&moneyTotal!==undefined?(()=>{const [whole='0',fraction='']=total.split('.'),cap=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0')),actual=BigInt(moneyTotal);return `当前购物车已知费用 ${formatPublishingMoney(moneyTotal)}${pendingPrices?'，另有 '+pendingPrices+' 项待询价':''}${actual>cap?'；超出当前预算 '+formatPublishingMoney((actual-cap).toString()):'；预算内仍需核对报价和预检'}。`;})():'';
 const serverBinding=(()=>{const value=result?.scope?.task?.binding;return value&&typeof value==='object'&&!Array.isArray(value)?value as unknown as ServerBinding:undefined;})();
 const planItemIssue=(item:BudgetPlan['items'][number])=>{
  const row=itemObject(item),candidate=candidateForItem(item,candidates),media=candidate?mediaFor(candidate.resource_id):undefined;
  if(!candidate||!media)return '尚未映射到唯一可投资源';
  if(row.resource_id&&row.resource_id!==candidate.resource_id)return '候选与发布资源不一致';
  const boundArticleId=serverBinding?.article_id??serverDraft?.articleId,boundVersions=serverBinding?['v'+serverBinding.version_number]:serverDraft?[serverDraft.articleVersionId,serverDraft.articleVersionHash,String(serverDraft.articleVersion)]:[];
  if(!boundArticleId)return '请先在稿件页确认冻结版本并保存选媒，再应用组合';
  if(row.article_id!==boundArticleId||!boundVersions.includes(String(row.version??'')))return '组合发布项与当前绑定稿件或版本不一致，不能按媒体名称合并';
  if(row.quantity!==1&&row.quantity!=='1')return '发布数量 '+String(row.quantity??'未知')+' 暂不支持一键加入，请单独处理';
  return candidateIssue(candidate,media);
 };
 const prepareLayer=(items:typeof candidates)=>{setConfirmBudget(null);setConfirmLayer(items.filter(candidate=>{const media=mediaFor(candidate.resource_id);return media&&!cart.has(media.id)&&!candidateIssue(candidate,media);}));};
 const applyPlanRequest=async(plan:BudgetPlan,preview:boolean,draft:PublicationDraft):Promise<ApplyPlanDiff|null>=>{
  if(!result||!taskId)return null;
  const choices=differentPlans(result.budget_plans),index=Math.max(0,choices.indexOf(plan));
  const abort=new AbortController();
  try{return await matrixApi<ApplyPlanDiff>('/classify/'+encodeURIComponent(taskId)+'/apply-plan',abort.signal,{plan_id:result.plan_id,plan_version:result.plan_version,plan_index:index,draft_id:draft.id,article_version_id:draft.articleVersionId,expected_revision:draft.revision,preview});}
  catch(e){setNotice(serviceMessage(e instanceof Error?e.message:String(e)));try{setServerDraft(await gateway.getDraft(draft.id));}catch{}return null;}
 };
 const ensureServerDraft=async():Promise<PublicationDraft|null>=>{
  if(serverDraft)return serverDraft;
  if(bindingIssue||!articleVersionId){setNotice(bindingIssue||'请先在稿件页面确认一份稿件，再应用组合。');return null;}
  if(cartMutation.current)return null;
  cartMutation.current=true;setCartBusy(true);
  try{
   const ownerTask=await selectionTask.ensureTask();
   const requestKey=ownerTask?await publishingDraftRequestKey(ownerTask,articleVersionId,[]):undefined;
   const flowMode:FlowStageMode=['single','per_media','multi','batch'].includes(mode)?mode as FlowStageMode:'default';
   const saved=await gateway.createDraft(articleVersionId,[],requestKey,titleModeForFlowMode(flowMode));
   setServerDraft(saved);return saved;
  }catch(reason){setNotice(reason instanceof Error?reason.message:'草稿创建失败，请重试');return null;}
  finally{cartMutation.current=false;setCartBusy(false);}
 };
 const openApplyPlan=async(plan:BudgetPlan)=>{
  setConfirmLayer(null);setConfirmBudget(plan);setApplyPreview(null);
  const draft=serverDraft??await ensureServerDraft();
  if(!draft){setConfirmBudget(null);return;}
  setApplyBusy(true);
  const data=await applyPlanRequest(plan,true,draft);
  setApplyBusy(false);
  if(data)setApplyPreview({scope:cartKey,data});
 };
 const planPreviewData=confirmBudget&&applyPreview?.scope===cartKey?applyPreview.data:undefined;
 const previewItems=confirmLayer?confirmLayer.map(candidate=>({candidate,issue:(()=>{const media=mediaFor(candidate.resource_id);return media?candidateIssue(candidate,media):'尚未映射可投资源';})()})):planPreviewData?[]:[];
 const previewIds=confirmLayer?previewItems.flatMap(item=>{const media=item.candidate?mediaFor(item.candidate.resource_id):undefined;return media?[media.id]:[];}):[];
 const budgetPreview=confirmLayer||confirmBudget?{title:confirmLayer?'确认选择本层媒体':'确认加入预算组合',items:confirmLayer?previewItems.map((item,index)=>{const media=item.candidate?mediaFor(item.candidate.resource_id):undefined;return {name:media?.name??(item.candidate?display(item.candidate.attributes.source_name??item.candidate.attributes.name):'媒体 '+(index+1)),status:item.issue?'冲突 / 待确认':media&&cart.has(media.id)?'已选，保留原项':'新增',reason:item.issue};})
  :planPreviewData?[...planPreviewData.additions.map(addition=>({name:addition.name,status:'新增 · '+formatPublishingMoney(addition.priceTenThousandths),reason:addition.reason??(addition.offerId?'报价身份 '+addition.offerId:'按组合核验加入')})),...planPreviewData.alreadySelected.map(entry=>({name:entry.name,status:'已在购物车',reason:entry.reason})),...planPreviewData.skipped.map(entry=>({name:entry.key,status:'暂不加入',reason:entry.reason}))]
   :[{name:'组合成员',status:'正在核对差异…',reason:'正在读取服务端核验的组合与购物车差异'}],
  blocked:confirmLayer?previewItems.some(item=>!!item.issue)||new Set([...cart.keys(),...previewIds]).size>20:!!planPreviewData&&(planPreviewData.overLimit||!planPreviewData.additions.length),
  summary:confirmLayer?`新增 ${new Set(previewIds.filter(id=>!cart.has(id))).size} 项，重复 ${previewIds.filter(id=>cart.has(id)).length} 项；已有 ${cart.size} 项保留。`+(new Set([...cart.keys(),...previewIds]).size>20?'合并后超过 20 家上限。':'')+'报价、规格与锁定项不自动替换。'
   :planPreviewData?`新增 ${planPreviewData.additions.length} 项，保留已选 ${planPreviewData.alreadySelected.length} 项${planPreviewData.skipped.length?'，暂不加入 '+planPreviewData.skipped.length+' 项':''}；合并后 ${planPreviewData.mergedCount} 项`+(planPreviewData.knownTotalTenThousandths?'，已知费用 '+formatPublishingMoney(planPreviewData.knownTotalTenThousandths):'')+(planPreviewData.pendingPriced?'，待询价 '+planPreviewData.pendingPriced+' 项':'')+'。发布项保留报价与规格身份；手选与标题不被动改。':'服务端核验组合成员、报价与购物车差异。'}:undefined;
 const confirmBudgetMedia=async()=>{
  if(confirmLayer){if(!budgetPreview||budgetPreview.blocked||matrixStale)return;const ids=confirmLayer.flatMap(candidate=>{const media=mediaFor(candidate.resource_id);return media&&!candidateIssue(candidate,media)?[media.id]:[];});if(await persistCart([...new Set([...cart.keys(),...ids])]))setConfirmLayer(null);return;}
  if(!confirmBudget||cartMutation.current)return;
  if(!confirmBudget.budget_feasible||confirmBudget.is_estimate||confirmBudget.unknown_items.length||confirmBudget.errors.length||confirmBudget.semantic_pending.length){setNotice('预算组合仍有待确认费用或未通过校验，购物车尚未更新。');setConfirmBudget(null);return;}
  if(budgetStale||appliedBudget.current!==budgetKey){setNotice('预算或购物车已变化，请重新生成组合。');setConfirmBudget(null);return;}
  if(bindingIssue){setNotice(bindingIssue);return;}
  const draft=serverDraft??await ensureServerDraft();
  if(!draft){setNotice('请先在稿件页面确认一份稿件并保存选媒草稿，再应用组合。');setConfirmBudget(null);return;}
  // The write path always follows a server-verified preview of the same plan.
  const preview=planPreviewData??await applyPlanRequest(confirmBudget,true,draft);
  if(!preview){setConfirmBudget(null);return;}
  if(preview.overLimit){setNotice('合并后超过 20 家媒体上限，请先减少手动选择再应用组合。');return;}
  if(!preview.additions.length){setNotice('组合成员均已存在或暂不能加入，购物车未变化。'+(preview.skipped.length?'未加入：'+preview.skipped.map(entry=>entry.reason).join('；'):''));setConfirmBudget(null);return;}
  setApplyBusy(true);
  const applied=await applyPlanRequest(confirmBudget,false,draft);
  setApplyBusy(false);
  if(!applied||applied.status!=='ok'){setNotice('组合应用未完成，购物车未写入。请按提示处理后重试。');return;}
  try{const fresh=await gateway.getDraft(draft.id);setServerDraft(fresh);}catch{setNotice('组合已应用，但购物车刷新失败，请手动刷新核对。');}
  if(!contextDraftId){
   if(flow)try{await flow.record({id:`media-draft:${draft.id}`,label:'已保存媒体选择',resources:selectionResources(draft)});}catch{}
   const query=new URLSearchParams(search);query.set('draftId',draft.id);query.set('articleVersion',draft.articleVersionId);
   if(taskId)query.set('task',taskId);
   navigate(projectWorkspaceUrl(path+'?'+query.toString())+(typeof window!=='undefined'?window.location.hash:''),{replace:true});
  }
  setConfirmBudget(null);setApplyPreview(null);
  setNotice('已加入组合：新增 '+applied.additions.length+' 项，保留原有选择'+(applied.alreadySelected.length?'（组合内已选 '+applied.alreadySelected.length+' 项）':'')+(applied.skipped.length?'；暂不加入 '+applied.skipped.length+' 项：'+applied.skipped.map(entry=>entry.reason).join('；'):'')+'。发布项保留报价与规格身份，发布仍需重新报价与预检。');
 };
 const generate=(e:FormEvent)=>{void submit('matrix',e);};
 const modelInput={industry_id:industry,product,audience,regions:regions?regions.split('、'):[],questions:questions.split('\n').filter(Boolean)};
 const taskbarTitle=serverDraft?.articleTitle||(currentBinding?.version?'已确认稿件 v'+currentBinding.version.version:contextDraftId||articleVersionId?'当前稿件':undefined);
 const taskbarNote=bindingIssue||(serverDraft?'已确认 v'+serverDraft.articleVersion:currentBinding?.version?'当前冻结版本，首次选媒后保存投放草稿':undefined);
 return <MediaShell title="信源矩阵" note="查看行业信源分布，按目标问题生成完整矩阵，再比较预算组合。" taskbar={<MediaTaskbar title={taskbarTitle} note={taskbarNote} count={cart.size} total={pendingPrices?undefined:moneyTotal} cartHref={cartHref} actions={registrationPending?<button className="link small" disabled={cartBusy} onClick={()=>void retryAssociation()}>重试关联当前投放草稿</button>:undefined}/>}
 dialogs={<><ModelInputDialog open={modelOpen} value={modelInput} onClose={()=>setModelOpen(false)}/><BudgetConfirmDialog plan={confirmBudget} candidates={candidates} busy={cartBusy||applyBusy} preview={budgetPreview} onClose={()=>{setConfirmBudget(null);setConfirmLayer(null);setApplyPreview(null);}} onConfirm={()=>void confirmBudgetMedia()}/><RecommendationReason candidate={reasonCandidate} result={result} returnFocus={reasonTrigger.current} onClose={()=>setReasonCandidate(null)}/></>}>
  <div className="sm-workspace">
   <nav className="x-matrix-nav" aria-label="信源矩阵子板块"><Link className={view==='analysis'?'active':''} aria-current={view==='analysis'?'page':undefined} href={href('analysis')}>行业信源分布</Link><Link className={view==='matrix'?'active':''} aria-current={view==='matrix'?'page':undefined} href={href('matrix')}>信源矩阵推荐</Link></nav>
   {view==='analysis'?<LiveIndustryDistribution/>:<>
    <section className="panel sm-demand" ref={formRef} aria-labelledby="sm-demand-title"><div className="panel-title"><h2 id="sm-demand-title">本次投放要求</h2><span className="small muted">预算独立设置</span></div>
     <div className="sm-demand-fields"><label>品牌 / 产品<input className="field" value={product} placeholder="输入品牌或产品" onChange={e=>setProduct(e.target.value)}/></label><label>目标行业 *<select value={industry} aria-required="true" onChange={e=>setIndustry(e.target.value)}><option value="">{loading?'正在读取行业…':industries.length?'选择行业':'暂无已接入行业'}</option>{industries.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>覆盖地区<input className="field" value={regions} placeholder="多个地区用顿号分隔" onChange={e=>setRegions(e.target.value)}/></label><label>目标受众<input className="field" value={audience} placeholder="描述内容面向的人群" onChange={e=>setAudience(e.target.value)}/></label><label className="sm-demand-questions">目标问题 / 内容需求 *<textarea className="field" aria-required="true" value={questions} placeholder="每行一个问题；保留问题场景与内容方向" onChange={e=>setQuestions(e.target.value)}/></label></div>
     <div className="sm-demand-actions"><div><span className="small muted">{taskbarTitle?taskbarTitle+' · '+(taskbarNote||''):'可先研究矩阵，选择媒体前需确认稿件版本。'}</span>{industryUnavailable&&<p className="small" role="status">行业数据暂不可用，请重试或联系运营接入。<button className="link small" disabled={loading} onClick={()=>setIndustryAttempt(value=>value+1)}>重试读取行业</button></p>}</div><div className="actions"><button type="button" className="link small" onClick={()=>setModelOpen(true)}>查看模型输入</button><button className="button primary" disabled={busy||loading} onClick={generate}>{busy&&!budgetPending?'正在生成…':result?'更新矩阵':'生成矩阵'}</button></div></div>
     <p className="small muted">{serverDraft||articleVersionId?'生成矩阵时将绑定当前稿件冻结版本（服务端核验），预算组合与应用使用同一绑定。':'矩阵按目标需求生成，尚未绑定稿件版本；确认稿件后生成可获得服务端绑定。'}媒体选择后仍需重新报价和预检。</p>
     {errorStage==='matrix'&&fieldError&&<p className="block-error" role="alert">{fieldError}</p>}
    </section>
    {matrixStale&&<p className="notice warn" role="status">需求、任务或稿件版本已变化，当前矩阵仅供对照。请更新矩阵后生成组合或新增媒体。</p>}
    {error&&<p className="block-error" role="alert">{error.message}<button className="link small" disabled={busy} onClick={e=>{if(failedOperation==='budget')void submit('budget',e);else if(failedOperation==='matrix'||!taskId)generate(e);else void refresh();}}>重试</button></p>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    <div className="sm-recommendation-layout"><section className="sm-matrix" aria-labelledby="sm-matrix-title"><header className="sm-matrix-heading"><div><h2 id="sm-matrix-title">完整信源矩阵</h2><p>{result?`${candidates.length} 个候选 · ${result.matrix_version}`:'先填写目标行业与问题，再生成完整矩阵。'}</p></div>{taskId&&<div className="actions"><button className="link small" disabled={busy} onClick={()=>void refresh()}>刷新结果</button>{busy&&<button className="link small" onClick={()=>void cancel()}>取消生成</button>}{result&&(reportReady?<a className="link small" href={downloadUrl(taskId,result.plan_id,result.plan_version)}>导出当前版本</a>:<button className="link small" disabled title="请等待当前有效矩阵完成后导出">导出当前版本</button>)}{result&&<button className="link small" onClick={()=>setShowReport(value=>!value)}>{showReport?'收起报告':'查看报告'}</button>}</div>}</header>
     {mappedState?.scope===cartScope&&mappedState.error&&<p className="block-error" role="alert">{mappedState.error}<button className="link" onClick={()=>setMappingAttempt(value=>value+1)}>重试读取媒体映射</button></p>}
     {mappedState?.scope===cartScope&&mappedState.loading&&<p className="small muted" role="status">正在匹配可投媒体…</p>}
     {bindingIssue&&<p className="sm-selection-status" role={currentBinding?.error?'alert':'status'}>{bindingIssue}{currentBinding?.error?<button className="link" onClick={()=>setBindingAttempt(value=>value+1)}>重试读取稿件上下文</button>:!currentBinding?.loading&&!contextDraftId&&!articleVersionId?<Link className="link" href={projectWorkspaceUrl('/publishing/articles')}>进入稿件选择</Link>:null}</p>}
     {rules.error&&<p className="sm-selection-status" role="status">媒体要求暂不可用，暂不能新增选择。<button className="link" onClick={rules.reload}>重试读取媒体规则</button></p>}
     {result?<><p className="small muted">已核验引用明细 {result.source_analysis.known_detail_count} 条 · 行业依据 {result.source_analysis.external_aggregates.length} 项。{serverBinding?'已服务端绑定稿件：'+(serverBinding.article_title||serverBinding.article_id)+' · v'+serverBinding.version_number+'（指纹 '+serverBinding.fingerprint.slice(0,8)+'）；组合与应用使用同一绑定。':'尚未绑定当前稿件版本；生成时可自动绑定已确认稿件。'}推荐不代表该稿件已被引用或可直接发布。</p><MatrixRecommendation result={result} highlightedPlan={highlightedPlan} mediaFor={mediaFor} isSelected={media=>cart.has(media.id)} issue={candidateIssue} onToggle={id=>void toggleCandidate(id)} onDetails={openReason} onMediaDetails={setDetailMedia} onLayer={items=>prepareLayer(items)}/></>:<div className="x-empty"><strong>{busy?'正在生成完整矩阵':'等待生成矩阵'}</strong><p>推荐基于当前已接入的行业与引用依据；不会用样本或假媒体填充。</p></div>}
    </section><BudgetRecommendations plans={result?.budget_plans??[]} candidates={candidates} selectedIndex={planIndex} onSelect={setPlanIndex} onApply={plan=>{void openApplyPlan(plan);}} onDetails={openReason} disabled={busy||cartBusy} stale={budgetStale} applicationIssue={plan=>plan.items.map(planItemIssue).find(Boolean)}>
     {!result?<p className="small muted">先生成矩阵；未填写预算也可查看全部候选。</p>:<><div className="sm-budget-fields"><label>总预算（{currency}）<input className="field" id="z-budget-total" inputMode="decimal" value={total} placeholder="输入总预算" onChange={e=>setTotal(e.target.value)}/></label><label className="sm-exploration-toggle"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用探索投放</label>{enabled&&<label>探索子预算上限<input className="field" inputMode="decimal" value={exploration} placeholder="包含在总预算内" onChange={e=>setExploration(e.target.value)}/></label>}<details><summary>单篇价格条件</summary><label>最低单篇价格<input className="field" inputMode="decimal" value={min} placeholder="不限" onChange={e=>setMin(e.target.value)}/></label><label>最高单篇价格<input className="field" inputMode="decimal" value={max} placeholder="不限" onChange={e=>setMax(e.target.value)}/></label></details><button className="button primary" disabled={busy||matrixStale||result.matrix.status!=='complete'} onClick={e=>void submit('budget',e)}>{budgetPending?'正在生成组合…':'生成 / 更新组合'}</button></div>{errorStage==='budget'&&fieldError&&<p className="block-error" role="alert">{fieldError}</p>}</>}
    </BudgetRecommendations></div>
    {showReport&&result&&<div className="sm-report"><div className="actions"><button className="button secondary" disabled={!reportReady} onClick={()=>window.print()}>打印报告</button></div><Report result={result}/></div>}
   </>}
   {view==='analysis'&&notice&&<p className="notice" role="status">{notice}</p>}
   {cartBudgetMessage&&<p className="sm-cart-budget" role="status">{cartBudgetMessage}</p>}
   {footer}
  </div>
  <MediaDetails media={detailMedia} rules={detailMedia?rules.rules[detailMedia.id]:undefined} checked={detailMedia?cart.has(detailMedia.id):false} onToggle={()=>{const candidate=candidates.find(item=>mediaFor(item.resource_id)?.id===detailMedia?.id);if(candidate)void toggleCandidate(candidate.candidate_id);}} onClose={()=>setDetailMedia(undefined)}/>
 </MediaShell>;
}
