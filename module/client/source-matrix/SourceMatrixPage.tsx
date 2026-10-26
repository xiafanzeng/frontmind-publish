import { useEffect,useLayoutEffect,useMemo,useRef,useState,type FormEvent } from 'react';
import { Link,useLocation,useSearch } from 'wouter';
import { projectWorkspaceUrl,usePublishingWorkspaceKey,useWorkspaceDraftGuard } from '../host';
import { matrixApi,downloadUrl } from './api';
import type { ApplyPlanDiff,BudgetPlan,MatrixResult,ServerBinding,TaskResponse,ResourceSelection } from './types';
import { label,display,Report,ModelInputDialog,BudgetConfirmDialog,downloadMatrixData } from './SourceMatrixPresentation';
import {BudgetRecommendations,MatrixRecommendation,RecommendationReason,candidateForItem,differentPlans,itemObject} from './MatrixRecommendation';
import {LiveIndustryDistribution} from './industry/IndustryDistribution';
import {matrixDemo,demoInitialForm,demoSemanticKey,demoBudgetMatches} from './demo';
import {DemoProvenance,DemoBudgetRecommendations,DemoReport} from './DemoRecommendation';
import {MediaShell,MediaCartFooter,MediaTaskbar,MediaDetails,useMarketRules,rulesRequest} from './MediaMarket';
import {usePublisherGateway} from '../PublishingContext';
import {publishingDraftRequestKey,usePublishingFlow} from '../PublishingFlowContext';
import {useMediaSelectionTask} from '../useMediaSelectionTask';
import {uniqueBatchIds} from '../batchMediaSelection';
import {titleModeForFlowMode,type FlowStageMode} from '../components/PublishingFlowSteps';
import {mediaShortlistKey,mediaSelectionBlocker} from '../mediaShortlist';
import {publicationSelectionAmounts} from '../publicationAmounts';
import {formatPublishingMoney,type ArticleVersion,type MediaResource,type PublicationDraft} from '../types';
import {ContentPlanRecommendations,type QuantityChange} from './ContentPlanRecommendations';
import {pricingReason} from './PlanningDetails';
import './source-matrix.css';
export interface BrandDataBatchOption { id:string; label:string; version:string; sourceFile:string; recordCount:number; period:{start:string|null;end:string|null}; models?:string[] }
function refreshedMatrixQuotes(previous:MatrixResult['matrix'],next:MatrixResult['matrix']):MatrixResult['matrix'] {
 const current=new Map(next.candidates.map(candidate=>[candidate.candidate_id,candidate]));
 return {...previous,candidates:previous.candidates.map(candidate=>{const fresh=current.get(candidate.candidate_id);return fresh?{...candidate,offers:fresh.offers,catalog_matches:fresh.catalog_matches}:candidate;})};
}
function additionSummary(addition:ApplyPlanDiff['additions'][number]) {
 const quantity=Number.isSafeInteger(addition.quantity)&&(addition.quantity??0)>0?`${addition.quantity} 篇`:'篇数待确认';
 const amount=addition.totalPriceTenThousandths;
 return `${addition.replaceExisting?'更新数量':'新增'} · ${quantity} · ${amount!=null&&/^\d+$/.test(amount)?formatPublishingMoney(amount):'完整费用待确认'}`;
}
type MatrixView='matrix'|'analysis'|'report'|'industry';
export default function SourceMatrixPage({view='analysis'}:{view?:MatrixView}) {
 // Two data lanes share one page: the industry distribution always reads the
 // upstream industry service; brand samples feed only the recommendation lane.
 const search=useSearch(),params=new URLSearchParams(search);
 const activeView=params.get('tab')==='matrix'?'matrix':params.get('tab')==='analysis'?'analysis':view==='matrix'||view==='report'?'matrix':'analysis';
 return <LiveSourceMatrixPage view={activeView}/>;
}
function LiveSourceMatrixPage({view='analysis'}:{view?:MatrixView}) {
 const [path,navigate]=useLocation(),search=useSearch(),workspace=usePublishingWorkspaceKey();
 const params=new URLSearchParams(search),taskId:string=params.get('task')??params.get('matrixTask')??'';
 const initialDemoForm=demoInitialForm(matrixDemo),initialForm=taskId?null:initialDemoForm;
 const [showDemo,setShowDemo]=useState(!taskId);
 const [industries,setIndustries]=useState<Array<{id:string;name:string}>>([]),[industry,setIndustry]=useState(''),[questions,setQuestions]=useState(initialForm?.questions??''),[product,setProduct]=useState(initialForm?.product??''),[audience,setAudience]=useState(initialForm?.audience??''),[regions,setRegions]=useState(initialForm?.regions??'');
 const [hours,setHours]=useState(initialForm?.hours??''),[assetKind,setAssetKind]=useState(initialForm?.assetKind??''),[samplePlatform,setSamplePlatform]=useState(initialForm?.samplePlatform??''),[brandBatches,setBrandBatches]=useState<BrandDataBatchOption[]>([]),[brandData,setBrandData]=useState(initialForm?.brandData??'');
 const [modelOpen,setModelOpen]=useState(false),[confirmBudget,setConfirmBudget]=useState<BudgetPlan|null>(null),[confirmLayer,setConfirmLayer]=useState<MatrixResult['matrix']['candidates']|null>(null),[reasonCandidate,setReasonCandidate]=useState<MatrixResult['matrix']['candidates'][number]|null>(null),[planIndex,setPlanIndex]=useState(0),[showReport,setShowReport]=useState(false);
 const [receivedResult,setResult]=useState<MatrixResult|null>(null),[resultTask,setResultTask]=useState(''),[error,setError]=useState<Error|null>(null),[notice,setNotice]=useState(''),[industryUnavailable,setIndustryUnavailable]=useState(false),[industryAttempt,setIndustryAttempt]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[,setTaskState]=useState(''),[pollEpoch,setPollEpoch]=useState(0),[selected,setSelected]=useState<string[]>([]);
 const result=resultTask===`${workspace}:${taskId}`?receivedResult:null;
 const [matrixInput,setMatrixInput]=useState<string|null>(null),[matrixBinding,setMatrixBinding]=useState<string|null>(null),[serverStale,setServerStale]=useState(false),[budgetPending,setBudgetPending]=useState(false);
 const [budgetNeedsRecompute,setBudgetNeedsRecompute]=useState(false);
 const [applyPreview,setApplyPreview]=useState<{scope:string;data:ApplyPlanDiff}|null>(null),[applyBusy,setApplyBusy]=useState(false);
 const [resourceSelections,setResourceSelections]=useState<ResourceSelection[]>([]),[quantityMode,setQuantityMode]=useState<'new_articles'|'repeat_article'>('new_articles'),[preferFormal,setPreferFormal]=useState(false);
 const [currency,setCurrency]=useState('CNY'),[total,setTotal]=useState(matrixDemo.form.budget),[exploration,setExploration]=useState(initialForm?matrixDemo.form.explorationCap:''),[enabled,setEnabled]=useState(initialForm?matrixDemo.form.explorationEnabled:false),[min,setMin]=useState(''),[max,setMax]=useState(''),[fieldError,setFieldError]=useState(''),[errorStage,setErrorStage]=useState<'matrix'|'budget'>('matrix'),[failedOperation,setFailedOperation]=useState<'load'|'matrix'|'budget'>('load');
 const appliedBudget=useRef('');
 const reasonTrigger=useRef<HTMLElement|null>(null);
 const openReason=(candidate:MatrixResult['matrix']['candidates'][number])=>{reasonTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setReasonCandidate(candidate);};
 const latestInput=useRef(''),latestBudget=useRef(''),latestRecommendationContext=useRef(''),pendingBudget=useRef<{key:string;matrix:MatrixResult}|null>(null);
 const inputKey=JSON.stringify([industry,product.trim(),audience.trim(),regions.split('、').map(value=>value.trim()).filter(Boolean),questions.split('\n').map(value=>value.trim()).filter(Boolean),hours,assetKind,samplePlatform,brandData]);latestInput.current=inputKey;
 // Saved samples are display data only. They never populate live task/cart state.
 const demoActive=showDemo&&!taskId&&!result,displayResult=demoActive?matrixDemo.result:result;
 const demoSemanticStale=demoSemanticKey({industryLabel:industry?industries.find(item=>item.id===industry)?.name??industry:matrixDemo.form.industry,product,audience,regions,questions,hours,assetKind,samplePlatform,brandData})!==demoSemanticKey(initialDemoForm);
 const demoBudgetStale=demoSemanticStale||!demoBudgetMatches(matrixDemo,{currency,total,enabled,exploration,min,max});
 const selectedDemoCombination=matrixDemo.research_combinations[planIndex]??matrixDemo.research_combinations[0];
 const sampleModels=brandBatches.find(batch=>batch.id===brandData)?.models??(brandData===matrixDemo.form.brandDataBatchId?matrixDemo.source.models??matrixDemo.form.platforms:[]);
 const submissionLock=useRef(false);
 // TS 5.9 infers this inline object literal type as numeric ids inside this
 // file's import graph (compiler quirk; values are always task-id strings at
 // runtime), so type the ref fields as any to keep comparisons honest.
 const submittedTask=useRef<{id:any;workspace:any;inputKey:any;bindingKey:any}|null>(null);
 // One-click chain: matrix first, then the budget stage follows automatically on the hydrated render.
 const followUpBudget=useRef(false);
 const request=useRef<AbortController|null>(null),pollRequest=useRef<AbortController|null>(null),cancelRequest=useRef<AbortController|null>(null),sequence=useRef(0),formRef=useRef<HTMLFormElement>(null);
 useLayoutEffect(()=>{const node=formRef.current?.querySelector('textarea');if(node){node.style.height='auto';node.style.height=`${Math.min(320,Math.max(132,node.scrollHeight))}px`;}},[questions,view]);
 useWorkspaceDraftGuard({dirty:demoActive?demoSemanticStale:!!questions&&(!result&&!taskId||matrixInput!==null&&matrixInput!==inputKey),label:'信源矩阵输入'});
 const href=(v:string,id=taskId)=>{const params=new URLSearchParams(search);params.set('tab',v==='matrix'||v==='report'?'matrix':'analysis');if(id)params.set('task',id);else params.delete('task');return projectWorkspaceUrl(`/publishing/source-matrix?${params.toString()}`)+(typeof window!=='undefined'?window.location.hash:'');};
 useEffect(()=>{const abort=new AbortController();setLoading(true);
  void matrixApi<{industries:Array<{id:string;name:string}>;brand_data_batches?:BrandDataBatchOption[];message?:string}>('/industries',abort.signal).then(r=>{if(!abort.signal.aborted){setIndustries(r.industries);setIndustryUnavailable(!r.industries.length);const batches=r.brand_data_batches??[];setBrandBatches(batches);setBrandData(current=>current||batches[0]?.id||'');}}).catch(()=>{if(!abort.signal.aborted)setIndustryUnavailable(true);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>{abort.abort();};
 },[workspace,industryAttempt]);
 useEffect(()=>{const created=submittedTask.current;if(!created||created.id!==taskId||created.workspace!==workspace)followUpBudget.current=false;setResult(null);setResultTask('');setMatrixInput(null);setMatrixBinding(null);setServerStale(false);setBudgetNeedsRecompute(false);setSelected([]);setBusy(!!taskId);setError(null);setNotice('');setConfirmBudget(null);setConfirmLayer(null);setReasonCandidate(null);setShowReport(false);setBudgetPending(false);setResourceSelections([]);if(!created||created.id!==taskId||created.workspace!==workspace)setQuantityMode('new_articles');setPreferFormal(false);submissionLock.current=false;pendingBudget.current=null;appliedBudget.current='';return()=>{request.current?.abort();cancelRequest.current?.abort();sequence.current++;};},[taskId,workspace]);
 const serviceMessage=(value:string)=>/迁移|migration|ER_NO_SUCH_TABLE|凭据|PUBLISHER_/.test(value)?'推荐服务暂不可用，请稍后重试或联系运营。':value;
 const receiveTask=(response:TaskResponse)=>{
  const next=response.result,pending=pendingBudget.current,resultOwner=`${workspace}:${response.task_id??taskId}`;
  setTaskState(response.state??'');setBusy(response.state==='running');
  if(pending){
   // A 202 precheck is not a persisted plan snapshot. Keep the last complete
   // plan id/version until the matching terminal result has been saved.
   if(response.state==='running'){setNotice(pending.key!==latestBudget.current?'预算、需求或媒体选择已变化，先前组合仅供查询；请在处理结束后重新生成。':'预算组合正在校验，请稍后刷新结果。');return;}
   if(pending.key!==latestBudget.current){
    // The server has persisted a new revision even though this request no
    // longer represents the current budget. Retain that authoritative version
    // for the next submission, but never display its obsolete combinations.
    appliedBudget.current='';setBudgetNeedsRecompute(true);setShowReport(false);
    if(next?.status==='stale_matrix'||next?.matrix&&next.matrix_version!==pending.matrix.matrix_version){setServerStale(true);setNotice('矩阵版本已变化，请重新更新矩阵。');}
    else if(next?.matrix&&next.plan_id&&next.plan_version){setResultTask(resultOwner);setResult({...next,matrix:refreshedMatrixQuotes(pending.matrix.matrix,next.matrix),source_analysis:pending.matrix.source_analysis,budget_plans:[],content_plans:[]});setPlanIndex(0);setNotice('预算、需求或媒体选择已变化，先前组合未应用。请重新生成组合。');}
    else setNotice('预算、需求或媒体选择已变化，先前组合未应用。请刷新结果后重新生成组合。');
    pendingBudget.current=null;setBudgetPending(false);return;
   }
   if(next?.status==='stale_matrix'){setServerStale(true);setNotice('任务数据已变化，请更新矩阵后再生成组合。');}
   else if(next?.matrix){
    if(next.matrix_version!==pending.matrix.matrix_version){setServerStale(true);setNotice('矩阵版本已变化，请重新更新矩阵。');}
    else {const failed=next.retryable_budget===true||!!next.errors.length;setResultTask(resultOwner);setResult({...next,matrix:refreshedMatrixQuotes(pending.matrix.matrix,next.matrix),source_analysis:pending.matrix.source_analysis,...(failed?{budget_plans:[],content_plans:[]}: {})});setPlanIndex(0);appliedBudget.current=failed?'':pending.key;setBudgetNeedsRecompute(failed);if(failed){setShowReport(false);setNotice('组合生成未通过复核，请调整条件后重试：'+(next.errors.map(issue=>pricingReason(issue.message||issue.code)).join('；')||'尚未得到有效组合'));}else setNotice('');}
   } else if(next)setNotice(serviceMessage(next.errors?.map(issue=>issue.message).join('；')||label(next.status)));
   if(response.state!=='running'){pendingBudget.current=null;setBudgetPending(false);}return;
  }
  if(next?.matrix){setResultTask(resultOwner);setResult(next);if(next.retryable_budget){appliedBudget.current='';setBudgetNeedsRecompute(true);setShowReport(false);setNotice('组合生成未通过复核，可调整预算后重试：'+(next.errors.map(issue=>pricingReason(issue.message||issue.code)).join('；')||'尚未得到有效组合'));}else if(response.state!=='running')setNotice('');}
  else if(next){if(next.status==='stale_matrix')setServerStale(true);setNotice(serviceMessage(next.errors?.map(issue=>issue.message).join('；')||label(next.status)));}
 };
 useEffect(()=>{
  if(!taskId){setResult(null);setTaskState('');return;}const abort=new AbortController();pollRequest.current=abort;let timer:ReturnType<typeof setTimeout>|undefined,attempt=0;
  const poll=async()=>{try{const r=await matrixApi<TaskResponse>('/classify/'+encodeURIComponent(taskId),abort.signal);if(abort.signal.aborted)return;receiveTask(r);
    if(r.state==='running'){if(++attempt<150)timer=setTimeout(()=>void poll(),2000);else{setBusy(false);setNotice('任务仍在处理中，可点击刷新结果继续查询。');}}
   }catch(e){if(!abort.signal.aborted){setFailedOperation('load');setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));setBusy(false);setBudgetPending(false);}}};void poll();return()=>{abort.abort();if(timer)clearTimeout(timer);};
 },[taskId,workspace,pollEpoch]);
 async function refresh(){if(!taskId)return;setError(null);setFailedOperation('load');const abort=new AbortController();request.current?.abort();request.current=abort;try{const r=await matrixApi<TaskResponse>('/classify/'+encodeURIComponent(taskId),abort.signal);if(!abort.signal.aborted){receiveTask(r);if(r.state==='running')setPollEpoch(n=>n+1);}}catch(e){if(!abort.signal.aborted)setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));}}
 async function submit(stage:'matrix'|'budget',e?:FormEvent){e?.preventDefault();if(busy||submissionLock.current||e&&(e.nativeEvent as Event&{isComposing?:boolean}).isComposing)return;setFieldError('');setErrorStage(stage);
  const qs=questions.split('\n').map(q=>q.trim()).filter(Boolean);
  if(stage==='matrix'&&(!industry||!qs.length)){setFieldError('请选择已配置行业，并填写至少一个问题（每行一个）。');formRef.current?.querySelector<HTMLElement>(!industry?'select':'textarea')?.focus();return;}
  if(stage==='matrix'&&hours&&(!/^\d+(?:\.\d+)?$/.test(hours)||Number(hours)<=0)){setFieldError('期望发布时效应为正数，或留空表示不限定。');return;}
  if(stage==='matrix'&&brandData&&!brandBatches.some(batch=>batch.id===brandData)){setFieldError('当前品牌样本尚未接入在线推荐服务。保存样本仍可查看；请接入该批次或选择可用数据后再在线生成。');return;}
  if(stage==='budget'&&(!total||!/^\d+(?:\.\d+)?$/.test(total))){setFieldError('请输入非负十进制总预算，勿使用科学计数法。');document.getElementById('z-budget-total')?.focus();return;}
  if(stage==='budget'&&(!result||matrixStale)){setFieldError('请先更新当前需求与稿件对应的矩阵。');return;}
  if(stage==='budget'){pendingBudget.current={key:latestBudget.current,matrix:result!};setBudgetPending(true);appliedBudget.current='';}
  else {pendingBudget.current=null;setBudgetPending(false);followUpBudget.current=true;setShowDemo(false);setShowReport(false);setReasonCandidate(null);setPlanIndex(0);}
  const submittedInput=inputKey,submittedContext=latestRecommendationContext.current;submissionLock.current=true;
  const abort=new AbortController(),seq=++sequence.current;request.current?.abort();pollRequest.current?.abort();request.current=abort;setBusy(true);setError(null);setNotice('');
  try{
   const body=stage==='matrix'?{industry_id:industry,questions:qs,...(product?{product}:{}),...(audience?{audience}:{}),...(regions.trim()?{regions:regions.split('、').map(x=>x.trim()).filter(Boolean)}:{}),...(hours?{hours}:{}),...(assetKind?{requirements:[assetKind]}:{}),...(brandData?{brand_data:brandData}:{}),...(brandData&&samplePlatform?{sample_platforms:[samplePlatform]}:{}),as_of:new Date().toISOString(),
     // Name the real draft/version; the server re-reads and verifies them.
     ...(serverDraft?{draft_id:serverDraft.id,article_version_id:serverDraft.articleVersionId}:contextDraftId||articleVersionId?{...(contextDraftId?{draft_id:contextDraftId}:{}),...(articleVersionId?{article_version_id:articleVersionId}:{})}:{})}
    :{plan_id:result?.plan_id,plan_version:result?.plan_version,budget:{currency,total_cap:total,exploration_enabled:enabled,...(enabled&&exploration!==''?{exploration_cap:exploration}:{}),...(min!==''?{unit_price_min:min}:{}),...(max!==''?{unit_price_max:max}:{})},selected_candidate_ids:selected,resource_selections:resourceSelections,quantity_mode:quantityMode,as_of:new Date().toISOString()};
   const r=await matrixApi<TaskResponse>(stage==='matrix'?'/matrix/generate':'/classify/'+encodeURIComponent(taskId)+'/budget',abort.signal,body);
   if(seq!==sequence.current||abort.signal.aborted)return;
   if(latestRecommendationContext.current!==submittedContext){setBusy(false);setBudgetPending(false);pendingBudget.current=null;setNotice('稿件或任务上下文已变化，先前请求未应用。');return;}
   if(stage==='matrix'&&submittedInput!==latestInput.current){setBusy(false);setNotice('投放需求已变化，先前生成结果未应用。请按当前需求重新生成。');return;}
   receiveTask(r);if(r.state==='running')setPollEpoch(n=>n+1);
   if(stage==='matrix'&&r.task_id){submittedTask.current={id:r.task_id,workspace,inputKey:submittedInput,bindingKey};setSelected([]);navigate(href('matrix',r.task_id));}
   if(stage==='budget'&&r.state==='running')setNotice('预算组合正在校验，请稍后刷新结果。');
  }catch(e){if(!abort.signal.aborted&&seq===sequence.current){setFailedOperation(stage);setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));setBusy(false);setBudgetPending(false);pendingBudget.current=null;}}finally{if(seq===sequence.current)submissionLock.current=false;}
 }
 async function cancel(){
  if(!taskId||cancelRequest.current&&!cancelRequest.current.signal.aborted)return;
  followUpBudget.current=false;
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
 const budgetKey=JSON.stringify([inputKey,bindingKey,currency,total,enabled,exploration,min,max,selected.slice().sort(),serverDraft?.revision,resourceSelections,quantityMode]);latestBudget.current=budgetKey;
 const budgetStale=matrixStale||budgetPending||budgetNeedsRecompute||!!(result?.budget_plans.length||result?.content_plans?.length)&&appliedBudget.current!==budgetKey;
 const reportReady=!!result&&!busy&&!budgetStale&&result.matrix.status==='complete'&&['complete','needs_budget','needs_budget_plans'].includes(result.status)&&!result.errors.length&&!!result.plan_id&&!!result.plan_version;
 const contentPlansActive=!!result?.content_plans?.length&&(!preferFormal||!result.budget_plans.length);
 const highlightedContentIds=contentPlansActive?(result?.content_plans?.[planIndex]??result?.content_plans?.[0])?.items.map(item=>item.candidate_id)??[]:[];
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
  const requirements=itemObject(t.requirements??null),brand=itemObject(t.brand??null),platforms=Array.isArray(brand.platforms)?brand.platforms.filter((value):value is string=>typeof value==='string'):[];
  const nextHours=typeof t.hours==='string'?t.hours:'',nextAsset=requirements.images===true?'图片':requirements.tables===true?'表格':requirements.links===true?'链接':'',nextPlatform=platforms.length===1?platforms[0]??'':'',nextBrand=typeof brand.batch_id==='string'?brand.batch_id:'';
  const submitted=submittedTask.current?.id===taskId&&submittedTask.current.workspace===workspace?submittedTask.current:null;
  if(submitted)submittedTask.current=null;
  setMatrixInput(submitted?.inputKey??JSON.stringify([nextIndustry,nextProduct.trim(),nextAudience.trim(),nextRegions,nextQuestions,nextHours,nextAsset,nextPlatform,nextBrand]));setMatrixBinding(submitted?.bindingKey??bindingKey);
  // Hydrate another saved task exactly once. A task just created here keeps any
  // edits made while it was running; its submitted key marks those edits stale.
  if(!submitted){setIndustry(nextIndustry);setProduct(nextProduct);setAudience(nextAudience);setRegions(nextRegions.join('、'));setQuestions(nextQuestions.join('\n'));setHours(nextHours);setAssetKind(nextAsset);setSamplePlatform(nextPlatform);setBrandData(nextBrand);setShowDemo(false);
   setResourceSelections(result.resource_selections??[]);setQuantityMode(result.quantity_mode??'new_articles');
   const p=result.budget_plans[0]??result.content_plans?.[0];if(p?.total_cap)setTotal(p.total_cap);if(p?.currency)setCurrency(p.currency);setEnabled(!!p?.exploration_cap&&Number(p.exploration_cap)>0);setExploration(p?.exploration_cap??'');setMin('');setMax('');
  }
  // A restored plan has no verified current-cart preference snapshot; compare it,
  // then regenerate before applying rather than treating it as freshly checked.
 },[taskId,result,workspace,industries,loading]);
 useEffect(()=>{
  if(!followUpBudget.current||busy||budgetPending||!result||matrixInput===null||matrixStale)return;
  followUpBudget.current=false;
  if(result.matrix.status!=='complete'){setNotice(label(result.status)+'：矩阵候选已生成；'+(result.status==='needs_ai_decisions'?'模型决策服务未接入，配置服务端模型密钥后可重新生成分层。':'模型决定未通过校验，可重试。'));return;}
  if(!/^\d+(?:\.\d+)?$/.test(total)){setNotice('矩阵已生成。请在右侧填写总预算后点击“更新组合”。');return;}
  setNotice('矩阵已生成，正在按当前预算生成组合…');
  void submit('budget');
 },[result,busy,budgetPending,matrixInput,matrixStale,total]);
 const cartAmounts=publicationSelectionAmounts([...cart.values()],serverDraft?.items);
 const pendingPrices=cartAmounts.pending;
 const moneyTotal=currentBinding?.loading||currentBinding?.error||!currentBinding?undefined:cartAmounts.knownTotal;
 const cartHref=mediaHref('cart');
 const footer=<MediaCartFooter count={cart.size} total={moneyTotal} cartHref={cartHref} nextLabel="查看购物车" nextDisabled={!!bindingIssue||cartBusy||registrationPending} nextHint={bindingIssue||registrationPending?'请完成当前稿件与任务关联后继续。':undefined} onNext={()=>navigate(cartHref)} pending={pendingPrices} publicationItems={serverDraft?.items} items={[...cart.values()]} onRemove={media=>{void persistCart([...cart.keys()].filter(id=>id!==media.id));}}/>;
 const cartBudgetMessage=currency!=='CNY'&&total?'购物车费用以人民币展示；当前组合预算为 '+currency+'，不能直接比较或自动换汇。':total&&/^\d+(?:\.\d{1,4})?$/.test(total)&&moneyTotal!==undefined?(()=>{const [whole='0',fraction='']=total.split('.'),cap=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0')),actual=BigInt(moneyTotal);return `当前购物车已知费用 ${formatPublishingMoney(moneyTotal)}${pendingPrices?'，另有 '+pendingPrices+' 项待询价':''}${actual>cap?'；超出当前预算 '+formatPublishingMoney((actual-cap).toString()):'；预算内仍需核对报价和预检'}。`;})():'';
 const serverBinding=(()=>{const value=result?.scope?.task?.binding;return value&&typeof value==='object'&&!Array.isArray(value)?value as unknown as ServerBinding:undefined;})();
 const planItemIssue=(item:BudgetPlan['items'][number])=>{
  const row=itemObject(item),candidate=candidateForItem(item,candidates),media=candidate?mediaFor(candidate.resource_id):undefined;
  if(!candidate||!media)return '尚未映射到唯一可投资源';
  if(row.resource_id&&row.resource_id!==candidate.resource_id)return '候选与发布资源不一致';
  const boundArticleId=serverBinding?.article_id??serverDraft?.articleId,boundVersions=serverBinding?['v'+serverBinding.version_number]:serverDraft?[serverDraft.articleVersionId,serverDraft.articleVersionHash,String(serverDraft.articleVersion)]:[];
  if(!boundArticleId)return '请先在稿件页确认冻结版本并保存选媒，再应用组合';
  if(row.article_id!==boundArticleId||!boundVersions.includes(String(row.version??'')))return '组合发布项与当前绑定稿件或版本不一致，不能按媒体名称合并';
  if(!/^\d+$/.test(String(row.quantity))||!Number.isSafeInteger(Number(row.quantity))||Number(row.quantity)<1)return '篇数必须为正整数，且符合资源限制';
  return candidateIssue(candidate,media);
 };
 const prepareLayer=(items:typeof candidates)=>{setConfirmBudget(null);setConfirmLayer(items.filter(candidate=>{const media=mediaFor(candidate.resource_id);return media&&!cart.has(media.id)&&!candidateIssue(candidate,media);}));};
 const applyPlanRequest=async(plan:BudgetPlan,preview:boolean,draft:PublicationDraft):Promise<ApplyPlanDiff|null>=>{
  if(!result||!taskId)return null;
  const index=result.budget_plans.indexOf(plan);if(index<0)return null;
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
  :planPreviewData?[...planPreviewData.additions.map(addition=>({name:addition.name,status:additionSummary(addition),reason:addition.reason??(addition.offerId?'报价身份 '+addition.offerId:'按组合核验加入')})),...planPreviewData.alreadySelected.map(entry=>({name:entry.name,status:'已在购物车',reason:entry.reason})),...planPreviewData.skipped.map(entry=>({name:entry.key,status:'暂不加入',reason:entry.reason}))]
   :[{name:'组合成员',status:'正在核对差异…',reason:'正在读取服务端核验的组合与购物车差异'}],
  blocked:confirmLayer?previewItems.some(item=>!!item.issue)||new Set([...cart.keys(),...previewIds]).size>20:!!planPreviewData&&(planPreviewData.overLimit||!planPreviewData.additions.length),
  summary:confirmLayer?`新增 ${new Set(previewIds.filter(id=>!cart.has(id))).size} 项，重复 ${previewIds.filter(id=>cart.has(id)).length} 项；已有 ${cart.size} 项保留。`+(new Set([...cart.keys(),...previewIds]).size>20?'合并后超过 20 家上限。':'')+'报价、规格与锁定项不自动替换。'
   :planPreviewData?`新增 ${planPreviewData.additions.filter(item=>!item.replaceExisting).length} 项，更新数量 ${planPreviewData.additions.filter(item=>item.replaceExisting).length} 项，保留已选 ${planPreviewData.alreadySelected.length} 项${planPreviewData.skipped.length?'，暂不加入 '+planPreviewData.skipped.length+' 项':''}；合并后 ${planPreviewData.mergedCount} 项`+(planPreviewData.knownTotalTenThousandths?'，已知费用 '+formatPublishingMoney(planPreviewData.knownTotalTenThousandths):'')+(planPreviewData.pendingPriced?'，待询价 '+planPreviewData.pendingPriced+' 项':'')+'。发布项保留报价与规格身份；手选与标题不被动改。':'服务端核验组合成员、报价与购物车差异。'}:undefined;
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
  setNotice('已加入组合：新增 '+applied.additions.filter(item=>!item.replaceExisting).length+' 项，更新数量 '+applied.additions.filter(item=>item.replaceExisting).length+' 项，保留原有选择'+(applied.alreadySelected.length?'（组合内已选 '+applied.alreadySelected.length+' 项）':'')+(applied.skipped.length?'；暂不加入 '+applied.skipped.length+' 项：'+applied.skipped.map(entry=>entry.reason).join('；'):'')+'。发布项保留报价与规格身份，发布仍需重新报价与预检。');
 };
 const updateContentQuantities=async(planIndex:number,quantities:QuantityChange[],kind:'content'|'formal'='content')=>{
  if(!result||!taskId||busy||budgetStale)return false;
  const context=latestRecommendationContext.current,key=budgetKey,matrixVersion=result.matrix_version,abort=new AbortController(),seq=++sequence.current;
  request.current?.abort();pollRequest.current?.abort();request.current=abort;submissionLock.current=true;setBusy(true);setNotice('');
  try{
   const response=await matrixApi<TaskResponse>('/classify/'+encodeURIComponent(taskId)+(kind==='formal'?'/formal-plan':'/content-plan'),abort.signal,{plan_id:result.plan_id,plan_version:result.plan_version,plan_index:planIndex,quantities,as_of:new Date().toISOString()});
   if(abort.signal.aborted||seq!==sequence.current||context!==latestRecommendationContext.current||key!==latestBudget.current)return false;
   const status=response.result?.status??response.status;
   if(status&&['stale_matrix','invalid_input','invalid_decisions','needs_matrix'].includes(status)){
    appliedBudget.current='';if(status==='stale_matrix'||status==='needs_matrix')setServerStale(true);
    const issues=response.result?.errors??response.errors??[];
    setNotice(issues.length?'篇数调整未通过复核：'+issues.map(issue=>pricingReason(issue.message||issue.code)).join('；'):'当前矩阵或组合条件已变化，请更新结果后重新核算。');return false;
   }
   if(!response.result?.matrix||response.result.matrix_version!==matrixVersion){setNotice('组合版本已变化，请刷新结果后重新核算。');return false;}
   setResultTask(`${workspace}:${taskId}`);setResult({...response.result,matrix:refreshedMatrixQuotes(result.matrix,response.result.matrix),source_analysis:result.source_analysis});appliedBudget.current=key;const issues=response.result.errors??[];setNotice(issues.length?'篇数调整未通过完整复核：'+issues.map(issue=>pricingReason(issue.message||issue.code)).join('；'):'篇数已重新复核，矩阵适配顺序保持不变。');return !issues.length;
  }catch(reason){if(!abort.signal.aborted&&seq===sequence.current)setNotice(serviceMessage(reason instanceof Error?reason.message:'篇数核算失败，请重试。'));return false;}
  finally{if(seq===sequence.current){setBusy(false);submissionLock.current=false;}}
 };
 const generate=(e:FormEvent)=>{void submit('matrix',e);};
 const modelInput={...(industry?{industry_id:industry}:demoActive?{industry:matrixDemo.form.industry}:{}),product,audience,regions:regions?regions.split('、'):[],questions:questions.split('\n').filter(Boolean),...(hours?{hours}:{}),...(assetKind?{requirements:[assetKind]}:{}),...(brandData?{brand_data:brandData}:{}),...(samplePlatform?{sample_platforms:[samplePlatform]}:{})};
 const budgetFields=<><div className="sm-budget-fields"><label>总预算（{currency}）<input className="field" id="z-budget-total" inputMode="decimal" value={total} placeholder="输入总预算" onChange={e=>setTotal(e.target.value)}/></label><span className="small muted">{demoActive?'保存样本的演示预算，可修改':'探索费用包含在总预算内'}</span><label>篇数含义<select value={quantityMode} disabled={busy} onChange={event=>setQuantityMode(event.target.value as 'new_articles'|'repeat_article')}><option value="new_articles">每篇为不同内容</option><option value="repeat_article">使用当前稿件重复发布</option></select></label>{quantityMode==='repeat_article'&&<p className="small muted">须绑定真实冻结稿件，且所选资源允许重复发布。</p>}<label className="sm-exploration-toggle"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用探索投放</label>{enabled&&<label>探索子预算上限<input className="field" inputMode="decimal" value={exploration} placeholder="包含在总预算内" onChange={e=>setExploration(e.target.value)}/></label>}<details><summary>单篇价格条件</summary><label>最低单篇价格<input className="field" inputMode="decimal" value={min} placeholder="不限" onChange={e=>setMin(e.target.value)}/></label><label>最高单篇价格<input className="field" inputMode="decimal" value={max} placeholder="不限" onChange={e=>setMax(e.target.value)}/></label></details><button className="button primary" disabled={demoActive?busy||loading:busy||!result||matrixStale||result.matrix.status!=='complete'} onClick={e=>demoActive?generate(e):void submit('budget',e)}>{demoActive?'按当前要求在线生成':budgetPending?'正在生成组合…':result?.budget_plans.length||result?.content_plans?.length?'更新组合':'生成组合'}</button></div>{demoActive&&<p className="small muted">保存样本不属于在线任务。修改预算会保留原矩阵和原组合供对照；选择已接入行业及数据后，可按当前要求新建在线推荐。</p>}{errorStage==='budget'&&fieldError&&<p className="block-error" role="alert">{fieldError}</p>}{!result&&!demoActive&&<p className="small muted">先生成矩阵；预算可在点击前先填好，生成完成后自动用于组合。</p>}</>;
 const recommendationSwitch=!!result?.content_plans?.length&&!!result.budget_plans.length?<div className="sm-plan-kind" aria-label="组合类型"><button type="button" aria-pressed={contentPlansActive} onClick={()=>{setPreferFormal(false);setPlanIndex(0);}}>内容规划草案</button><button type="button" aria-pressed={!contentPlansActive} onClick={()=>{setPreferFormal(true);setPlanIndex(0);}}>正式发布方案</button></div>:null;
 const taskbarTitle=serverDraft?.articleTitle||(currentBinding?.version?'已确认稿件 v'+currentBinding.version.version:contextDraftId||articleVersionId?'当前稿件':undefined);
 const taskbarNote=bindingIssue||(serverDraft?'已确认 v'+serverDraft.articleVersion:currentBinding?.version?'当前冻结版本，首次选媒后保存投放草稿':undefined);
 return <MediaShell title="信源矩阵" note="查看行业信源分布，按目标问题生成完整矩阵，再比较预算组合。" taskbar={<MediaTaskbar title={taskbarTitle} note={taskbarNote} count={cart.size} total={pendingPrices?undefined:moneyTotal} cartHref={cartHref} actions={registrationPending?<button className="link small" disabled={cartBusy} onClick={()=>void retryAssociation()}>重试关联当前投放草稿</button>:undefined}/>}
 dialogs={<><ModelInputDialog open={modelOpen} value={modelInput} onClose={()=>setModelOpen(false)}/><BudgetConfirmDialog plan={confirmBudget} candidates={candidates} busy={cartBusy||applyBusy} preview={budgetPreview} onClose={()=>{setConfirmBudget(null);setConfirmLayer(null);setApplyPreview(null);}} onConfirm={()=>void confirmBudgetMedia()}/><RecommendationReason candidate={reasonCandidate} result={displayResult} returnFocus={reasonTrigger.current} resourceSelection={resourceSelections.find(value=>value.candidate_id===reasonCandidate?.candidate_id)} disabled={busy||matrixStale} onResourceSelection={!demoActive&&reasonCandidate?value=>{setResourceSelections(current=>[...current.filter(item=>item.candidate_id!==reasonCandidate.candidate_id),...(value?[value]:[])]);}:undefined} onClose={()=>setReasonCandidate(null)}/></>}>
  <div className={'sm-workspace'+(view==='matrix'?' sm-recommendation-workspace':'')}>
   <nav className="x-matrix-nav" aria-label="信源矩阵子板块"><Link className={view==='analysis'?'active':''} aria-current={view==='analysis'?'page':undefined} href={href('analysis')}>行业信源分布</Link><Link className={view==='matrix'?'active':''} aria-current={view==='matrix'?'page':undefined} href={href('matrix')}>信源矩阵推荐</Link></nav>
   {view==='analysis'?<LiveIndustryDistribution/>:<>
    <form className="panel sm-demand" ref={formRef} aria-labelledby="sm-demand-title" noValidate onSubmit={generate}><div className="panel-title"><h2 id="sm-demand-title"><span className="sm-step-marker" aria-hidden="true">01</span>本次投放要求</h2><span className="small muted">预算独立设置</span></div>
     {demoActive&&<DemoProvenance demo={matrixDemo} stale={demoSemanticStale}/>}
     <div className="sm-demand-fields"><label>品牌 / 产品<input className="field" value={product} placeholder="输入品牌或产品" onChange={e=>setProduct(e.target.value)}/></label><label>目标行业 *<select value={industry} aria-required="true" aria-invalid={!!fieldError&&errorStage==='matrix'&&!industry} aria-describedby={fieldError&&errorStage==='matrix'?'sm-demand-error':undefined} onChange={e=>setIndustry(e.target.value)}><option value="">{demoActive?matrixDemo.form.industry+' · 演示':loading?'正在读取行业…':industries.length?'选择行业':'暂无已接入行业'}</option>{industries.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>覆盖地区<input className="field" value={regions} placeholder="多个地区用顿号分隔" onChange={e=>setRegions(e.target.value)}/></label><label>目标受众<input className="field" value={audience} placeholder="描述内容面向的人群" onChange={e=>setAudience(e.target.value)}/></label><label>期望发布时效（小时）<input className="field" inputMode="numeric" value={hours} placeholder="不限定" onChange={e=>setHours(e.target.value)}/></label><label>素材能力要求<select value={assetKind} onChange={e=>setAssetKind(e.target.value)}><option value="">不限定</option><option value="图片">图片</option><option value="表格">表格</option><option value="链接">链接</option></select></label><label>品牌引用数据<select value={brandData} onChange={e=>{setBrandData(e.target.value);setSamplePlatform('');}}>{brandData===matrixDemo.form.brandDataBatchId&&!brandBatches.some(batch=>batch.id===brandData)&&<option value={brandData}>一航软件 · 保存样本</option>}{brandBatches.map(batch=><option key={batch.id} value={batch.id}>{batch.label} · {batch.recordCount} 条</option>)}{!brandBatches.length&&brandData!==matrixDemo.form.brandDataBatchId&&<option value="">暂无可用品牌数据批次</option>}</select></label><label>引用样本平台<select value={samplePlatform} onChange={e=>setSamplePlatform(e.target.value)}><option value="">全部已输入平台</option>{[...new Set(sampleModels)].map(model=><option key={model} value={model}>{model}</option>)}</select></label><label className="sm-demand-questions">目标问题 / 内容需求 *<textarea className="field" aria-required="true" aria-invalid={!!fieldError&&errorStage==='matrix'&&!questions.trim()} aria-describedby={fieldError&&errorStage==='matrix'?'sm-demand-error':undefined} value={questions} placeholder="每行一个问题；保留问题场景与内容方向" onChange={e=>setQuestions(e.target.value)}/></label></div>
     <div className="sm-demand-actions"><div><span className="small muted">{taskbarTitle?taskbarTitle+' · '+(taskbarNote||''):'可先研究矩阵，选择媒体前需确认稿件版本。'}</span>{industryUnavailable&&<p className="small" role="status">在线推荐行业暂不可用，{demoActive?'保存样本可继续查看；':''}请重试或联系运营接入。<button type="button" className="link small" disabled={loading} onClick={()=>setIndustryAttempt(value=>value+1)}>重试读取行业</button></p>}</div><div className="actions"><button type="button" className="link small" onClick={()=>setModelOpen(true)}>查看模型输入</button><button className="button primary" disabled={busy||loading} type="submit">{busy&&!budgetPending?'正在生成…':result?'重新生成矩阵并组合':'生成推荐矩阵'}</button></div></div>
     <p className="small muted">{demoActive?'下方为离线保存样本；点击生成按钮将发起新的在线任务。':''}{serverDraft||articleVersionId?'生成时绑定当前稿件冻结版本（服务端核验），组合与应用使用同一绑定。':'尚未绑定稿件版本；确认稿件后生成可获得服务端绑定。'}点击一次将先生成完整矩阵，再按右侧预算自动生成组合；品牌引用数据仅用于推荐，不进入行业分布。媒体选择后仍需重新报价和预检。</p>
     {errorStage==='matrix'&&fieldError&&<p id="sm-demand-error" className="block-error" role="alert">{fieldError}</p>}
    </form>
    {matrixStale&&<p className="notice warn" role="status">需求、任务或稿件版本已变化，当前矩阵仅供对照。请更新矩阵后生成组合或新增媒体。</p>}
    {error&&<p className="block-error" role="alert">{error.message}<button className="link small" disabled={busy} onClick={e=>{if(failedOperation==='budget')void submit('budget',e);else if(failedOperation==='matrix'||!taskId)generate(e);else void refresh();}}>重试</button></p>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    <div className="sm-recommendation-layout"><section className="sm-matrix" aria-labelledby="sm-matrix-title"><header className="sm-matrix-heading"><div><h2 id="sm-matrix-title">完整信源矩阵</h2><p title={displayResult?.matrix_version}>{displayResult?`${displayResult.matrix.candidates.length} 个候选 · ${demoActive?'已保存的样本矩阵':'在线任务结果'}`:'先填写目标行业与问题，再生成完整矩阵。'}</p></div>{taskId&&<div className="actions"><button className="link small" disabled={busy} onClick={()=>void refresh()}>刷新结果</button>{busy&&<button className="link small" onClick={()=>void cancel()}>取消生成</button>}{result&&(reportReady?<a className="link small" href={downloadUrl(taskId,result.plan_id,result.plan_version)}>导出当前版本</a>:<button className="link small" disabled title="请等待当前有效矩阵完成后导出">导出当前版本</button>)}{result&&<button className="link small" onClick={()=>setShowReport(value=>!value)}>{showReport?'收起报告':'查看报告'}</button>}</div>}{demoActive&&<div className="actions"><button className="link small" onClick={()=>downloadMatrixData('一航软件-已生成研究样本.json',JSON.stringify(matrixDemo,null,2),'application/json')}>导出保存样本</button><button className="link small" onClick={()=>setShowReport(value=>!value)}>{showReport?'收起样本报告':'查看样本报告'}</button></div>}</header>
     {!demoActive&&mappedState?.scope===cartScope&&mappedState.error&&<p className="block-error" role="alert">{mappedState.error}<button className="link" onClick={()=>setMappingAttempt(value=>value+1)}>重试读取媒体映射</button></p>}
     {!demoActive&&mappedState?.scope===cartScope&&mappedState.loading&&<p className="small muted" role="status">正在匹配可投媒体…</p>}
     {!demoActive&&bindingIssue&&<p className="sm-selection-status" role={currentBinding?.error?'alert':'status'}>{bindingIssue}{currentBinding?.error?<button className="link" onClick={()=>setBindingAttempt(value=>value+1)}>重试读取稿件上下文</button>:!currentBinding?.loading&&!contextDraftId&&!articleVersionId?<Link className="link" href={projectWorkspaceUrl('/publishing/articles')}>进入稿件选择</Link>:null}</p>}
     {!demoActive&&rules.error&&<p className="sm-selection-status" role="status">媒体要求暂不可用，暂不能新增选择。<button className="link" onClick={rules.reload}>重试读取媒体规则</button></p>}
     {demoActive?<><p className="small muted">以下候选来自样本观察，角色由 AI 判断并经本地 Skill 复核。身份与报价待确认，不映射当前购物车。</p><MatrixRecommendation result={matrixDemo.result} highlightedPlan={null} highlightedCandidateIds={selectedDemoCombination?.candidate_ids??[]} referenceCandidateIds={matrixDemo.research_combinations.flatMap(combination=>Object.entries(combination.usage_by_candidate).flatMap(([id,usage])=>usage==='reference'?[id]:[]))} mediaFor={()=>undefined} isSelected={()=>false} issue={()=>'研究样本不可加入购物车'} onToggle={()=>{}} onDetails={openReason} onMediaDetails={()=>{}} onLayer={()=>{}}/></>:result?<><p className="small muted">已核验引用明细 {result.source_analysis.known_detail_count} 条 · 行业依据 {result.source_analysis.external_aggregates.length} 项。{serverBinding?'已服务端绑定稿件：'+(serverBinding.article_title||serverBinding.article_id)+' · v'+serverBinding.version_number+'（指纹 '+serverBinding.fingerprint.slice(0,8)+'）；组合与应用使用同一绑定。':'尚未绑定当前稿件版本；生成时可自动绑定已确认稿件。'}推荐不代表该稿件已被引用或可直接发布。</p><MatrixRecommendation result={result} highlightedPlan={contentPlansActive?null:highlightedPlan} highlightedCandidateIds={highlightedContentIds} mediaFor={mediaFor} isSelected={media=>cart.has(media.id)} issue={candidateIssue} onToggle={id=>void toggleCandidate(id)} onDetails={openReason} onMediaDetails={setDetailMedia} onLayer={items=>prepareLayer(items)}/></>:<div className="x-empty"><strong>{busy?'正在生成完整矩阵':'等待生成矩阵'}</strong><p>推荐基于当前已接入的行业与引用依据；不会用样本或假媒体填充。</p></div>}
    </section>{demoActive?<DemoBudgetRecommendations demo={matrixDemo} selectedIndex={planIndex} onSelect={setPlanIndex} onDetails={openReason} stale={demoBudgetStale}>{budgetFields}</DemoBudgetRecommendations>:contentPlansActive?<ContentPlanRecommendations plans={result?.content_plans??[]} candidates={candidates} selectedIndex={planIndex} onSelect={setPlanIndex} onDetails={openReason} onUpdate={updateContentQuantities} disabled={busy||cartBusy} stale={budgetStale}>{budgetFields}{recommendationSwitch}</ContentPlanRecommendations>:<BudgetRecommendations plans={result?.budget_plans??[]} candidates={candidates} selectedIndex={planIndex} onSelect={setPlanIndex} onApply={plan=>{void openApplyPlan(plan);}} onUpdate={(plan,quantities)=>updateContentQuantities(result?.budget_plans.indexOf(plan)??-1,quantities,'formal')} onDetails={openReason} disabled={busy||cartBusy} stale={budgetStale} applicationIssue={plan=>plan.items.map(planItemIssue).find(Boolean)}>{budgetFields}{recommendationSwitch}</BudgetRecommendations>}</div>
    {showReport&&displayResult&&<div className="sm-report"><div className="actions"><button className="button secondary" disabled={!demoActive&&!reportReady} onClick={()=>window.print()}>{demoActive?'打印保存样本报告':'打印报告'}</button></div>{demoActive?<DemoReport demo={matrixDemo} stale={demoBudgetStale}/>:result&&<Report result={result}/>}</div>}
   </>}
   {view==='analysis'&&notice&&<p className="notice" role="status">{notice}</p>}
   {cartBudgetMessage&&<p className="sm-cart-budget" role="status">{cartBudgetMessage}</p>}
   {footer}
  </div>
  <MediaDetails media={detailMedia} rules={detailMedia?rules.rules[detailMedia.id]:undefined} checked={detailMedia?cart.has(detailMedia.id):false} onToggle={()=>{const candidate=candidates.find(item=>mediaFor(item.resource_id)?.id===detailMedia?.id);if(candidate)void toggleCandidate(candidate.candidate_id);}} onClose={()=>setDetailMedia(undefined)}/>
 </MediaShell>;
}
