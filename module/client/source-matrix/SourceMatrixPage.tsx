import { useEffect,useLayoutEffect,useMemo,useRef,useState,type FormEvent } from 'react';
import { Link,useLocation,useSearch } from 'wouter';
import { projectWorkspaceUrl,usePublishingWorkspaceKey,useWorkspaceDraftGuard,requestWorkspaceNavigation,performApprovedWorkspaceNavigation } from '../host';
import { matrixApi } from './api';
import {matrixReadiness} from './matrix-readiness';
import {useExactMediaMapping} from './useExactMediaMapping';
import type { ApplyPlanDiff,BudgetPlan,MatrixResult,ServerBinding,TaskResponse,ResourceSelection } from './types';
import { label,display,Report,BudgetConfirmDialog,MatrixDialog,downloadMatrixData } from './SourceMatrixPresentation';
import {MatrixRecommendation,RecommendationReason,candidateForItem,itemObject} from './MatrixRecommendation';
import {LiveIndustryDistribution} from './industry/IndustryDistribution';
import {matrixDemo,demoInitialForm,demoSemanticKey,demoBudgetMatches} from './demo';
import {DemoBudgetRecommendations,DemoReport} from './DemoRecommendation';
import {MediaShell,MediaCartFooter,MediaDetails,useMarketRules} from './MediaMarket';
import {usePublisherGateway} from '../PublishingContext';
import {publishingDraftRequestKey,usePublishingFlow,PublishingFlowContext} from '../PublishingFlowContext';
import {useMediaSelectionTask} from '../useMediaSelectionTask';
import {uniqueBatchIds} from '../batchMediaSelection';
import {withPublishingBatch} from '../batchPublishing';
import {titleModeForFlowMode,type FlowStageMode} from '../components/PublishingFlowSteps';
import {mediaShortlistKey,mediaSelectionBlocker} from '../mediaShortlist';
import {publicationSelectionAmounts} from '../publicationAmounts';
import {formatPublishingMoney,type ArticleDetail,type ArticleVersion,type MediaResource,type PublicationDraft} from '../types';
import {ContentPlanRecommendations,type QuantityChange} from './ContentPlanRecommendations';
import {pricingReason} from './PlanningDetails';
import {normalizeRecommendations} from './recommendations';
import {ResearchImportDialog} from './ResearchImportDialog';
import type {ResearchDatasetSummary} from './research-import-types';
import type {IndustryCommonQuery} from '../../contracts/industry-source';
import {ConfirmedArticleHeader,type ConfirmedArticleSelection} from '../components/ConfirmedArticleHeader';
import {confirmedArticleSelectionHref,isIndependentArticleSelection} from '../confirmedArticleRoute';
import {readVerifiedArticleSelection} from '../latestArticleSelection';
import {consumePreparedArticleSelection,prepareArticleSelection} from '../articleSelectionHandoff';
import {articleEditorHref} from '../articleEditorRoute';
import {useArticleIdentification} from './useArticleIdentification';
import {identificationProvenance} from './article-identification-store';
import {ArticleIdentificationStatus,ArticleIdentificationFieldInfo} from './ArticleIdentificationFeedback';
import {useMatrixFormDraft} from './useMatrixFormDraft';
import {useMatrixFormScope} from './useMatrixFormScope';
import {useIndustryCatalog} from './industry/useIndustryCatalog';
import {canonicalizeMatrixInputIndustry,resolveSavedTaskIndustry} from './saved-task-industry';
import {MatrixRegionSelect} from './MatrixRegionSelect';
import {mediaAiPlatforms} from '../../shared/media-catalog-filters';
import {isMatrixTargetPlatform,matrixHourLabel,matrixHourOptions,matrixRegionDraft,normalizeMatrixRegions,normalizeMatrixTargetPlatform} from '../../shared/matrix-requirements';
import './source-matrix.css';
import './article-matrix-navigation.css';
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
interface PlatformModelStatus {connection:null;mode:'environment'|'none';available:boolean;message?:string}
function industryQueryKey(value:unknown):string|null {
 const query=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 return query.scopeType==='CATEGORY'?JSON.stringify([query.periodType,query.date??null,query.scopeType,query.scopeId,query.modelCode]):null;
}
function generationBindingMatches(previous:string,current:string):boolean {
 const [savedDraft,savedVersion,savedTask]=JSON.parse(previous) as string[],[draft,version,task]=JSON.parse(current) as string[];
 return savedVersion===version&&savedTask===task&&(!savedDraft||savedDraft===draft);
}
function selectedIndustryQuery(params:URLSearchParams,industry:string):{query?:IndustryCommonQuery;error?:string} {
 const scopeId=params.get('siScope');
 // An unscoped analysis view never supplies an ALL-industry recommendation query.
 if(!scopeId||!industry)return {};
 const periodType=params.get('siPeriod'),date=params.get('siDate')??undefined,modelCode=params.get('siModel')??'';
 if(!/^[1-9]\d{0,18}$/.test(scopeId)||BigInt(scopeId)>9223372036854775807n||!['ALL','DAY','WEEK','MONTH'].includes(periodType??'')||!modelCode.trim()||(periodType!=='ALL'&&(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))))
  return {error:'已选行业数据范围不完整，请在“行业信源分布”中重新选择行业、模型和日期后重试。'};
 return {query:{periodType:periodType as IndustryCommonQuery['periodType'],...(periodType!=='ALL'?{date}:{}),scopeType:'CATEGORY',scopeId:industry,modelCode}};
}
type MatrixView='matrix'|'analysis'|'report'|'industry';
interface MatrixHistoryEntry {task_id:string;created_at:string;state:string;industry:string|null;product:string|null;matrix_status:string|null;candidate_count:number|null;recommendation_count:number|null}
const matrixGatewayScopes=new WeakMap<object,number>();let nextMatrixGatewayScope=0;
function matrixGatewayScope(gateway:object){let scope=matrixGatewayScopes.get(gateway);if(scope===undefined){scope=++nextMatrixGatewayScope;matrixGatewayScopes.set(gateway,scope);}return scope;}
export default function SourceMatrixPage({view='analysis'}:{view?:MatrixView}) {
 // The analysis and recommendation views share the selected industry range;
 // the server freezes the free upstream distributions into each generated task.
 const search=useSearch(),params=new URLSearchParams(search);
 const activeView=params.get('tab')==='matrix'?'matrix':params.get('tab')==='analysis'?'analysis':view==='matrix'||view==='report'?'matrix':'analysis';
 const hostFlow=usePublishingFlow(),gateway=usePublisherGateway(),workspace=usePublishingWorkspaceKey();
 // Remount every task/result/request owner when the authenticated gateway changes.
 return <PublishingFlowContext.Provider value={isIndependentArticleSelection(search)?null:hostFlow}><LiveSourceMatrixPage key={`${matrixGatewayScope(gateway)}:${workspace}`} view={activeView}/></PublishingFlowContext.Provider>;
}
function LiveSourceMatrixPage({view='analysis'}:{view?:MatrixView}) {
 const [path,navigate]=useLocation(),search=useSearch(),workspace=usePublishingWorkspaceKey();
 const params=new URLSearchParams(search),taskId:string=params.get('task')??params.get('matrixTask')??'';
 const gateway=usePublisherGateway(),flow=usePublishingFlow(),shortlist=mediaShortlistKey(workspace,search);
 const industryCatalog=useIndustryCatalog(gateway,workspace),catalog=industryCatalog.catalog;
 const industries=industryCatalog.industries,loading=industryCatalog.loading;
 const brandBatches=useMemo(()=>industryCatalog.brandBatches.map(batch=>({id:batch.id,label:batch.label,
  recordCount:typeof batch.recordCount==='number'&&Number.isSafeInteger(batch.recordCount)&&batch.recordCount>=0?batch.recordCount:undefined,
  models:Array.isArray(batch.models)?batch.models.filter((value):value is string=>typeof value==='string'):[]})),[industryCatalog.brandBatches]);
 const industryUnavailable=Boolean(industryCatalog.error)||!industries.length;
 const routeArticleId=params.get('articleId')??'',routeDraftId=params.get('draftId')??'',routeVersionId=params.get('articleVersion')??'',routeTaskId=params.get('workbenchTask')??'';
 const contextDraftId=routeDraftId||(!routeArticleId&&!routeVersionId?flow?.resources?.find(resource=>resource.kind==='publication_draft')?.id:'')||'';
 const articleVersionId=routeVersionId||(!routeArticleId&&!routeDraftId?flow?.resources?.find(resource=>resource.kind==='article_version')?.id:'')||'';
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
 const taskContext=useMemo(()=>({gateway,workspace,shortlist,routeArticleId,routeDraftId,routeVersionId,routeTaskId,mode,batchBindingKey,taskId,flowScope:flow?.scopeKey,agent:flow?.agentId}),
  [gateway,workspace,shortlist,routeArticleId,routeDraftId,routeVersionId,routeTaskId,mode,batchBindingKey,taskId,flow?.scopeKey,flow?.agentId]);
 const selectionTask=useMediaSelectionTask(flow,taskContext);
 const cartKey=JSON.stringify([shortlist,flow?.scopeKey,routeArticleId,contextDraftId,articleVersionId,selectionTask.scopeKey,routeTaskId,mode,taskId]);
 const cartScope=useMemo(()=>({gateway,key:cartKey}),[gateway,cartKey]);
 const [binding,setBinding]=useState<{scope:typeof cartScope;loading:boolean;error:string;draft?:PublicationDraft;version?:ArticleVersion;article?:ArticleDetail}>();
 const currentBinding=binding?.scope===cartScope?binding:undefined,serverDraft=currentBinding?.draft;
 const [bindingAttempt,setBindingAttempt]=useState(0),[cartBusy,setCartBusy]=useState(false),cartEpoch=useRef(0),cartMutation=useRef(false);
 const hasArticleContext=Boolean(routeArticleId||contextDraftId||articleVersionId);
 const researchFormScope=useMatrixFormScope(gateway,workspace,!hasArticleContext);
 const [connectionEpoch,setConnectionEpoch]=useState(0),[taskHydratedKey,setTaskHydratedKey]=useState('');
 const [emptyTaskOwner,setEmptyTaskOwner]=useState('');
 const hydratedTask=useRef('');
 const identificationVersion=serverDraft?.articleVersionId??currentBinding?.version?.id??articleVersionId;
 const taskHydrationKey=JSON.stringify([workspace,taskId,contextDraftId,identificationVersion,hasArticleContext?null:researchFormScope.scopeKey??'pending']);
 const identificationLoading=hasArticleContext&&(!identificationVersion||!currentBinding||currentBinding.loading);
 const identification=useArticleIdentification({gateway,workspace:String(workspace),formScope:taskId||'new',articleVersionId:identificationVersion,draftId:contextDraftId||undefined,connectionEpoch,
  enabled:Boolean(hasArticleContext&&identificationVersion&&currentBinding&&!currentBinding.loading&&!currentBinding.error),
  autoIdentify:Boolean(currentBinding&&!currentBinding.loading&&!currentBinding.error)&&(!taskId||taskHydratedKey===taskHydrationKey||emptyTaskOwner===`${workspace}:${taskId}`)});
 const initialDemoForm=demoInitialForm(matrixDemo),initialForm=taskId||hasArticleContext?null:initialDemoForm;
 const verifiedFormScope=identification.context?JSON.stringify([identification.context.scopeKey,identification.context.articleId,identification.context.articleVersionId,identification.context.contentDigest]):researchFormScope.scopeKey?JSON.stringify([researchFormScope.scopeKey,'research',workspace]):undefined;
 const pendingFormIdentity=JSON.stringify([workspace,shortlist,routeArticleId,contextDraftId,articleVersionId,hasArticleContext?'pending':'research']);
 const pendingFormScope=JSON.stringify([pendingFormIdentity,taskId||'new']);
 const formScope=verifiedFormScope?JSON.stringify([verifiedFormScope,taskId||'new']):pendingFormScope;
 const formDraft=useMatrixFormDraft(gateway,formScope,{product:initialForm?.product??'',industry:'',audience:initialForm?.audience??'',questions:initialForm?.questions??'',
  regions:'',regionsUnrestricted:true,hours:'',assetKind:initialForm?.assetKind??'',samplePlatform:'',brandData:'',targetPlatform:'',
  currency:'CNY',total:initialForm?matrixDemo.form.budget:'',exploration:initialForm?matrixDemo.form.explorationCap:'',enabled:initialForm?matrixDemo.form.explorationEnabled:false,min:'',max:''},verifiedFormScope?formScope:undefined,pendingFormScope);
 const latestFormOwner=useRef({formDraft,verifiedFormScope,pendingFormIdentity});latestFormOwner.current={formDraft,verifiedFormScope,pendingFormIdentity};
 const {regions,regionsUnrestricted,hours,assetKind,samplePlatform,brandData,targetPlatform='',currency,total,exploration,enabled,min,max}=formDraft.values;
 const {product,industry,audience,questions}=hasArticleContext?identification.values:formDraft.values;
 const setProduct=(value:string)=>hasArticleContext?identification.setField('product',value):formDraft.setField('product',value);
 const setIndustry=(value:string)=>hasArticleContext?identification.setField('industry',value):formDraft.setField('industry',value);
 const setAudience=(value:string)=>hasArticleContext?identification.setField('audience',value):formDraft.setField('audience',value);
 const setQuestions=(value:string)=>hasArticleContext?identification.setField('questions',value):formDraft.setField('questions',value);
 const setHours=(value:string)=>formDraft.setField('hours',value),setAssetKind=(value:string)=>formDraft.setField('assetKind',value);
 const setTargetPlatform=(value:string)=>formDraft.setField('targetPlatform',value);
 const setTotal=(value:string)=>formDraft.setField('total',value),setExploration=(value:string)=>formDraft.setField('exploration',value),setEnabled=(value:boolean)=>formDraft.setField('enabled',value),setMin=(value:string)=>formDraft.setField('min',value),setMax=(value:string)=>formDraft.setField('max',value);
 const [showDemo,setShowDemo]=useState(!taskId&&!hasArticleContext);
 const [confirmBudget,setConfirmBudget]=useState<BudgetPlan|null>(null),[confirmLayer,setConfirmLayer]=useState<MatrixResult['matrix']['candidates']|null>(null),[layerChecked,setLayerChecked]=useState<string[]>([]),[reasonCandidate,setReasonCandidate]=useState<MatrixResult['matrix']['candidates'][number]|null>(null),[planIndex,setPlanIndex]=useState(0),[showReport,setShowReport]=useState(false);
 const [importOpen,setImportOpen]=useState(false);
 const [historyOpen,setHistoryOpen]=useState(false),[historyItems,setHistoryItems]=useState<MatrixHistoryEntry[]|null>(null),[historyError,setHistoryError]=useState('');
 const [importedDataIds,setImportedDataIds]=useState<string[]>(params.getAll('researchDataset'));
 const [importedDatasets,setImportedDatasets]=useState<ResearchDatasetSummary[]>([]);
 const [historicalImportRefs,setHistoricalImportRefs]=useState<{owner:string;versions:Array<{id:string;version:string}>}>();
 const [importMetadata,setImportMetadata]=useState<{owner:string;status:'loading'|'ready'|'failed';error?:string}>();
 const [importNotice,setImportNotice]=useState(''),[importMetadataAttempt,setImportMetadataAttempt]=useState(0);
 const importMetadataEpoch=useRef(0);
 const importMetadataOwner=JSON.stringify([formScope,[...new Set(importedDataIds)].sort()]);
 const confirmedImports=importMetadata?.owner===importMetadataOwner&&importMetadata.status==='ready'?importedDatasets.filter(item=>importedDataIds.includes(item.id)&&item.status==='confirmed'):[];
 const [connectionState,setConnectionState]=useState<PlatformModelStatus|null>(null);
 const [connectionError,setConnectionError]=useState(''),[generationPhase,setGenerationPhase]=useState('');
 const [comparisonResult,setComparisonResult]=useState<MatrixResult|null>(null),[comparingPrevious,setComparingPrevious]=useState(false);
 const industrySelection=selectedIndustryQuery(params,industry),industrySelectionKey=industryQueryKey(industrySelection.query)??(industrySelection.error?JSON.stringify(['invalid',params.get('siScope'),params.get('siPeriod'),params.get('siDate'),params.get('siModel')]):null);
 const [receivedResult,setResult]=useState<MatrixResult|null>(null),[resultTask,setResultTask]=useState(''),[error,setError]=useState<Error|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[taskState,setTaskState]=useState(''),[pollEpoch,setPollEpoch]=useState(0),[selected,setSelected]=useState<string[]>([]);
 const result=resultTask===`${workspace}:${taskId}`?receivedResult:null;
 const [receivedTaskDetails,setReceivedTaskDetails]=useState<{owner:string;task:TaskResponse['task']}>();
 const savedTask=(receivedTaskDetails?.owner===`${workspace}:${taskId}`?receivedTaskDetails.task:undefined)??result?.scope.task;
 const savedIndustryResolution=savedTask&&catalog&&!industryCatalog.error?resolveSavedTaskIndustry(savedTask,catalog):null;
 const [matrixInput,setMatrixInput]=useState<string|null>(null),[matrixBinding,setMatrixBinding]=useState<string|null>(null),[serverStale,setServerStale]=useState(false),[budgetPending,setBudgetPending]=useState(false);
 const [budgetNeedsRecompute,setBudgetNeedsRecompute]=useState(false);
 const [applyPreview,setApplyPreview]=useState<{scope:string;data:ApplyPlanDiff}|null>(null),[applyBusy,setApplyBusy]=useState(false);
 const [resourceSelections,setResourceSelections]=useState<ResourceSelection[]>([]),[quantityMode,setQuantityMode]=useState<'new_articles'|'repeat_article'>('new_articles'),[quantityEditing,setQuantityEditing]=useState(false),[recommendationEditEpoch,setRecommendationEditEpoch]=useState(0);
 const [fieldError,setFieldError]=useState(''),[errorStage,setErrorStage]=useState<'matrix'|'budget'>('matrix'),[failedOperation,setFailedOperation]=useState<'load'|'matrix'|'budget'>('load');
 const appliedBudget=useRef('');
 const reasonTrigger=useRef<HTMLElement|null>(null);
 const openReason=(candidate:MatrixResult['matrix']['candidates'][number])=>{reasonTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setReasonCandidate(candidate);};
 const latestInput=useRef(''),latestBudget=useRef(''),latestRecommendationContext=useRef(''),pendingBudget=useRef<{key:string;matrix:MatrixResult}|null>(null);
 const inputKey=JSON.stringify([industry,product.trim(),audience.trim(),normalizeMatrixRegions(regions),questions.split('\n').map(value=>value.trim()).filter(Boolean),hours,assetKind,samplePlatform,brandData,targetPlatform,[...importedDataIds].sort(),industrySelectionKey]);latestInput.current=inputKey;
 // Saved samples are display data only. They never populate live task/cart state.
 const demoActive=showDemo&&!hasArticleContext&&!taskId&&!result,showingPrevious=!demoActive&&!!comparisonResult&&(comparingPrevious||!result||result.matrix.status!=='complete'),displayResult=demoActive?matrixDemo.result:showingPrevious?comparisonResult:result;

 const demoSemanticStale=demoSemanticKey({industryLabel:industry?industries.find(item=>item.id===industry)?.name??industry:matrixDemo.form.industry,product,audience,regions,questions,hours,assetKind,samplePlatform,brandData,targetPlatform})!==demoSemanticKey(initialDemoForm);
 const demoBudgetStale=demoSemanticStale||!demoBudgetMatches(matrixDemo,{currency,total,enabled,exploration,min,max});
 const selectedDemoCombination=matrixDemo.research_combinations[planIndex]??matrixDemo.research_combinations[0];
 const submissionLock=useRef(false);
 // TS 5.9 infers this inline object literal type as numeric ids inside this
 // file's import graph (compiler quirk; values are always task-id strings at
 // runtime), so type the ref fields as any to keep comparisons honest.
 const submittedTask=useRef<{id:any;workspace:any;inputKey:any;bindingKey:any}|null>(null);
 // One-click chain: matrix first, then the budget stage follows automatically on the hydrated render.
 const followUpBudget=useRef(false);
 const generationInputs=useRef(new Map<string,{inputKey:string;bindingKey:string}>()),latestBinding=useRef(''),latestGenerationReady=useRef(false);
 latestGenerationReady.current=!hasArticleContext||Boolean(identification.context&&identification.context.articleVersionId===identificationVersion&&currentBinding&&!currentBinding.loading&&!currentBinding.error);
 const request=useRef<AbortController|null>(null),pollRequest=useRef<AbortController|null>(null),cancelRequest=useRef<AbortController|null>(null),sequence=useRef(0),formRef=useRef<HTMLFormElement>(null);
 useLayoutEffect(()=>{const node=formRef.current?.querySelector('textarea');if(node){node.style.height='auto';node.style.height=`${Math.min(320,Math.max(132,node.scrollHeight))}px`;}},[questions,view]);
 const formNeedsGuard=hasArticleContext?(identification.hasManualChanges&&!identification.persisted||formDraft.hasEdits&&!formDraft.persisted):formDraft.hasEdits&&!formDraft.persisted;
 useWorkspaceDraftGuard({dirty:formNeedsGuard,label:'信源矩阵输入'});
 const href=(v:string,id=taskId)=>{const params=new URLSearchParams(search);params.set('tab',v==='matrix'||v==='report'?'matrix':'analysis');if(id)params.set('task',id);else params.delete('task');return projectWorkspaceUrl(`/publishing/source-matrix?${params.toString()}`)+(typeof window!=='undefined'?window.location.hash:'');};
 useEffect(()=>{
  if(!catalog||industryCatalog.error||!identification.context)return;
  const current=identification.values.industry;
  const mapping=catalog.legacyMappings.find(item=>item.localId===current&&item.status==='mapped'&&item.canonicalId&&industries.some(option=>option.id===item.canonicalId));
  if(mapping?.canonicalId)identification.remapIndustry(current,mapping.canonicalId);
  if(catalog.catalogVersion)identification.setIndustryCatalog({ids:industries.map(item=>item.id),version:catalog.catalogVersion});
 },[catalog,industryCatalog.error,identification.context,identification.scopeToken,identification.values.industry]);
 useEffect(()=>{const abort=new AbortController();setConnectionError('');
  void matrixApi<PlatformModelStatus>('/matrix/connection',abort.signal)
   .then(value=>{if(!abort.signal.aborted)setConnectionState(value);})
   .catch(()=>{if(!abort.signal.aborted){setConnectionState(null);setConnectionError('无法读取推荐服务状态，请重试或稍后联系运营。');}});
  return()=>abort.abort();
 },[workspace,connectionEpoch]);
 useEffect(()=>{setImportOpen(false);setImportedDatasets([]);setImportedDataIds(params.getAll('researchDataset'));setComparisonResult(null);setConnectionState(null);},[workspace]);
 const importScope=useRef(formScope);importScope.current=formScope;
 const authenticatedFormOwner=identification.context?.scopeKey??researchFormScope.scopeKey,importOwner=useRef(authenticatedFormOwner);
 useEffect(()=>{const owner=authenticatedFormOwner;if(owner&&importOwner.current&&owner!==importOwner.current){setImportedDataIds([]);setImportedDatasets([]);setImportNotice('');}if(owner)importOwner.current=owner;},[authenticatedFormOwner]);
 useEffect(()=>{setImportOpen(false);},[formScope]);
 const refreshImportedMetadata=(datasets:ResearchDatasetSummary[])=>{
  if(importScope.current!==formScope)return;
  const versionChanged=importedDatasets.filter(item=>importedDataIds.includes(item.id)).some(previous=>{const current=datasets.find(item=>item.id===previous.id&&item.status==='confirmed');return current&&previous.version&&current.version!==previous.version;});
  importMetadataEpoch.current++;setImportedDatasets(datasets.filter(item=>importedDataIds.includes(item.id)&&item.status==='confirmed'));setImportMetadata({owner:importMetadataOwner,status:'ready'});
  if(versionChanged){setServerStale(true);setShowDemo(false);followUpBudget.current=false;setImportNotice('选用文件的版本已变化，请重新生成矩阵。');}
 };
 const updateImports=(ids:string[],datasets:ResearchDatasetSummary[])=>{
  if(importScope.current!==formScope)return;
  importMetadataEpoch.current++;setImportedDataIds(ids);setImportedDatasets(datasets.filter(item=>ids.includes(item.id)&&item.status==='confirmed'));setImportMetadata({owner:JSON.stringify([formScope,[...new Set(ids)].sort()]),status:'ready'});setImportNotice('');setShowDemo(false);followUpBudget.current=false;
  const next=new URLSearchParams(search);next.delete('researchDataset');ids.forEach(id=>next.append('researchDataset',id));next.set('researchSelection','custom');
  navigate(projectWorkspaceUrl(`/publishing/source-matrix?${next.toString()}`)+(typeof window!=='undefined'?window.location.hash:''));
 };
 // URL and saved-task IDs are only a selection intent until the current server list confirms them.
 useEffect(()=>{
  if(!importedDataIds.length){setImportMetadata(undefined);return;}
  const abort=new AbortController(),epoch=++importMetadataEpoch.current,owner=importMetadataOwner;
  setImportMetadata({owner,status:'loading'});
  void matrixApi<{datasets:ResearchDatasetSummary[]}>('/matrix/imports',abort.signal).then(response=>{
   if(abort.signal.aborted||epoch!==importMetadataEpoch.current)return;
   const datasets=response.datasets.filter(item=>item.status==='confirmed'&&importedDataIds.includes(item.id)),valid=importedDataIds.filter(id=>datasets.some(item=>item.id===id));
   const changed=importedDatasets.filter(item=>importedDataIds.includes(item.id)).some(previous=>{const current=datasets.find(item=>item.id===previous.id);return current&&previous.version&&current.version!==previous.version;});
   setImportedDatasets(datasets);setImportMetadata({owner,status:'ready'});
   if(changed){setServerStale(true);followUpBudget.current=false;setImportNotice('选用文件的版本已变化，请重新生成矩阵。');}
   if(valid.length!==importedDataIds.length){
    setImportedDataIds(valid);setServerStale(true);followUpBudget.current=false;setImportNotice('已取消失效文件的选用，请核对当前选择。');
    const next=new URLSearchParams(search);next.delete('researchDataset');valid.forEach(id=>next.append('researchDataset',id));next.set('researchSelection','custom');
    navigate(projectWorkspaceUrl(path+'?'+next.toString())+(typeof window!=='undefined'?window.location.hash:''),{replace:true});
   }
  }).catch(()=>{if(!abort.signal.aborted&&epoch===importMetadataEpoch.current)setImportMetadata({owner,status:'failed',error:'已保存文件列表读取失败，尚未确认当前选用数据，请重试。'});});
  return()=>abort.abort();
 },[importMetadataOwner,importMetadataAttempt]);
 // Frozen task references are version baselines only; they never replace current server metadata.
 // Compare after either response order settles, rather than using an async request's old closure.
 useEffect(()=>{
  if(historicalImportRefs?.owner!==`${workspace}:${taskId}`||importMetadata?.owner!==importMetadataOwner||importMetadata.status!=='ready')return;
  const changed=historicalImportRefs.versions.filter(item=>importedDataIds.includes(item.id)).some(previous=>{
   const current=importedDatasets.find(item=>item.id===previous.id&&item.status==='confirmed');
   return current&&previous.version&&current.version!==previous.version;
  });
  if(changed){setServerStale(true);followUpBudget.current=false;setImportNotice('选用文件的版本已变化，请重新生成矩阵。');}
 },[historicalImportRefs,workspace,taskId,importMetadata,importMetadataOwner,importedDatasets]);
 useEffect(()=>{const created=submittedTask.current;if(!created||created.id!==taskId||created.workspace!==workspace){followUpBudget.current=false;setComparisonResult(null);setComparingPrevious(false);}setResult(null);setResultTask('');setTaskState('');setMatrixInput(null);setMatrixBinding(null);setServerStale(false);setBudgetNeedsRecompute(false);setSelected([]);setBusy(!!taskId);setError(null);setNotice('');setConfirmBudget(null);setConfirmLayer(null);setReasonCandidate(null);setShowReport(false);setBudgetPending(false);setResourceSelections([]);if(!created||created.id!==taskId||created.workspace!==workspace)setQuantityMode('new_articles');setQuantityEditing(false);submissionLock.current=false;pendingBudget.current=null;appliedBudget.current='';return()=>{request.current?.abort();cancelRequest.current?.abort();sequence.current++;};},[taskId,workspace]);
 const serviceMessage=(value:string)=>/迁移|migration|ER_NO_SUCH_TABLE|凭据|PUBLISHER_/.test(value)?'推荐服务暂不可用，请稍后重试或联系运营。':value;
 const receiveTask=(response:TaskResponse)=>{
  setReceivedTaskDetails({owner:`${workspace}:${response.task_id??taskId}`,task:response.task});
  // A terminal task without a result or restorable requirements must not hold
  // article recognition behind an impossible hydration gate.
  setEmptyTaskOwner(!response.result&&!response.task&&response.state!=='running'?`${workspace}:${response.task_id??taskId}`:'');
  const next=response.result,pending=pendingBudget.current,resultOwner=`${workspace}:${response.task_id??taskId}`;
  setTaskState(response.state??'');setBusy(response.state==='running');setGenerationPhase(response.state==='running'?(response.progress==='validating'?'正在校验结果…':'正在分析推荐…'):'');
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
    else if(next?.matrix&&next.plan_id&&next.plan_version){setResultTask(resultOwner);setResult({...next,matrix:refreshedMatrixQuotes(pending.matrix.matrix,next.matrix),source_analysis:pending.matrix.source_analysis,recommendations:[],budget_plans:[],content_plans:[]});setPlanIndex(0);setNotice('预算、需求或媒体选择已变化，先前组合未应用。请重新生成组合。');}
    else setNotice('预算、需求或媒体选择已变化，先前组合未应用。请刷新结果后重新生成组合。');
    pendingBudget.current=null;setBudgetPending(false);return;
   }
   if(next?.status==='stale_matrix'){setServerStale(true);setNotice('任务数据已变化，请更新矩阵后再生成组合。');}
   else if(next?.matrix){
    if(next.matrix_version!==pending.matrix.matrix_version){setServerStale(true);setNotice('矩阵版本已变化，请重新更新矩阵。');}
    else {const failed=next.retryable_budget===true||!!next.errors.length;setResultTask(resultOwner);setResult({...next,matrix:refreshedMatrixQuotes(pending.matrix.matrix,next.matrix),source_analysis:pending.matrix.source_analysis,...(failed?{recommendations:[],budget_plans:[],content_plans:[]}: {})});setPlanIndex(0);appliedBudget.current=failed?'':pending.key;setBudgetNeedsRecompute(failed);if(failed){setShowReport(false);setNotice('组合生成未通过复核，请调整条件后重试：'+(next.errors.map(issue=>pricingReason(issue.message||issue.code)).join('；')||'尚未得到有效组合'));}else setNotice('');}
   } else if(next)setNotice(serviceMessage(next.errors?.map(issue=>issue.message).join('；')||label(next.status)));
   if(response.state!=='running'){pendingBudget.current=null;setBudgetPending(false);}return;
  }
  if(response.state!=='running'&&(!next?.matrix||next.matrix.status!=='complete'||next.errors.length>0))followUpBudget.current=false;
  if(next?.matrix){if(response.state!=='running'&&next.matrix.status==='complete'&&!next.errors.length)setComparingPrevious(false);setResultTask(resultOwner);setResult(next);if(next.retryable_budget){appliedBudget.current='';setBudgetNeedsRecompute(true);setShowReport(false);setNotice('组合生成未通过复核，可调整预算后重试：'+(next.errors.map(issue=>pricingReason(issue.message||issue.code)).join('；')||'尚未得到有效组合'));}else if(response.state!=='running')setNotice('');}
  else if(next){if(next.status==='stale_matrix')setServerStale(true);setNotice(serviceMessage(next.errors?.map(issue=>issue.message).join('；')||label(next.status)));}
 };
 useEffect(()=>{
  if(!taskId){setResult(null);setTaskState('');return;}const abort=new AbortController();pollRequest.current=abort;const seq=sequence.current;let timer:ReturnType<typeof setTimeout>|undefined,attempt=0;
  const current=()=>!abort.signal.aborted&&seq===sequence.current;
  const poll=async()=>{try{const r=await matrixApi<TaskResponse>('/classify/'+encodeURIComponent(taskId),abort.signal);if(!current())return;
    const owner=generationInputs.current.get(taskId);
    if(owner&&!generationBindingMatches(owner.bindingKey,latestBinding.current)){followUpBudget.current=false;setBusy(false);setBudgetPending(false);pendingBudget.current=null;setNotice('投放需求、行业范围或稿件已变化，先前生成结果未应用。请重新生成。');return;}
    // A new task scope must re-authorize before its transferred fields are restored.
    // Temporary empty identification fields are not a user edit.
    if(owner&&!latestGenerationReady.current){setBusy(true);setGenerationPhase('正在核验当前稿件…');if(++attempt<700)timer=setTimeout(()=>void poll(),2000);else{setBusy(false);setNotice('当前稿件尚未核验完成，请重试读取稿件信息后刷新结果。');}return;}
    if(owner&&owner.inputKey!==latestInput.current){followUpBudget.current=false;setBusy(false);setBudgetPending(false);pendingBudget.current=null;setNotice('投放需求、行业范围或稿件已变化，先前生成结果未应用。请重新生成。');return;}
    if(owner)owner.bindingKey=latestBinding.current;
    receiveTask(r);
    // Long model runs are legitimate (multi-batch adjudication): keep polling
    // for the full run window instead of silently giving up after five minutes.
    if(r.state==='running'){if(++attempt<700)timer=setTimeout(()=>void poll(),2000);else{setBusy(false);setNotice('任务仍在处理中，可点击刷新结果继续查询。');}}
   }catch(e){if(current()){followUpBudget.current=false;setFailedOperation('load');setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));setBusy(false);setBudgetPending(false);}}};void poll();return()=>{abort.abort();if(timer)clearTimeout(timer);};
 },[taskId,workspace,pollEpoch]);
 async function refresh(){if(!taskId)return;setError(null);setFailedOperation('load');const abort=new AbortController(),seq=++sequence.current,context=latestRecommendationContext.current;request.current?.abort();pollRequest.current?.abort();request.current=abort;
  const current=()=>!abort.signal.aborted&&seq===sequence.current&&context===latestRecommendationContext.current;
  try{const r=await matrixApi<TaskResponse>('/classify/'+encodeURIComponent(taskId),abort.signal);if(current()){
   const owner=generationInputs.current.get(taskId);
   if(owner&&!generationBindingMatches(owner.bindingKey,latestBinding.current)){followUpBudget.current=false;setBusy(false);setNotice('投放需求、行业范围或稿件已变化，先前生成结果未应用。请重新生成。');return;}
   if(owner&&!latestGenerationReady.current){setBusy(true);setGenerationPhase('正在核验当前稿件…');setPollEpoch(n=>n+1);return;}
   if(owner&&owner.inputKey!==latestInput.current){followUpBudget.current=false;setBusy(false);setNotice('投放需求、行业范围或稿件已变化，先前生成结果未应用。请重新生成。');return;}
   if(owner)owner.bindingKey=latestBinding.current;
   receiveTask(r);if(r.state==='running')setPollEpoch(n=>n+1);
  }}catch(e){if(current())setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));}}
 // 历史存档：每次生成的矩阵与组合按任务留档，此处仅读取摘要，不载入正文。
 async function openHistory(){
  setHistoryOpen(true);
  if(historyItems||historyError)return;
  try{const data=await matrixApi<{items:MatrixHistoryEntry[]}>('/classify/history',new AbortController().signal);setHistoryItems(data.items??[]);}
  catch(e){setHistoryError(e instanceof Error?e.message:'历史记录读取失败，请重试。');}
 }

 // Resume a partial matrix on the server: only unprocessed/failed candidates
 // are re-reviewed, validated decisions are reused and never cleared.
 async function retryMatrix(){
  if(!taskId||busy||submissionLock.current)return;setError(null);setFailedOperation('matrix');setErrorStage('matrix');
  const abort=new AbortController(),seq=++sequence.current,context=latestRecommendationContext.current;
  request.current?.abort();pollRequest.current?.abort();request.current=abort;submissionLock.current=true;
  setBusy(true);setGenerationPhase('正在重试未完成候选…');setNotice('');
  const current=()=>!abort.signal.aborted&&seq===sequence.current&&context===latestRecommendationContext.current;
  try{
   const r=await matrixApi<TaskResponse>('/classify/'+encodeURIComponent(taskId)+'/retry-matrix',abort.signal,{as_of:new Date().toISOString()});
   if(current()){receiveTask(r);if(r.state==='running')setPollEpoch(n=>n+1);}
  }catch(e){if(current()){setFailedOperation('matrix');setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));setBusy(false);}}
  finally{if(seq===sequence.current)submissionLock.current=false;}
 }

 async function submit(stage:'matrix'|'budget',e?:FormEvent){e?.preventDefault();if(busy||submissionLock.current||e&&(e.nativeEvent as Event&{isComposing?:boolean}).isComposing)return;setFieldError('');setErrorStage(stage);
  const qs=questions.split('\n').map(q=>q.trim()).filter(Boolean);
  if(hasArticleContext&&bindingIssue){setFieldError(bindingIssue);return;}
  if(hasArticleContext&&!identification.context){setFieldError(identification.status==='failed'?identification.message:'正在读取稿件信息，请稍候。');return;}
  if(stage==='matrix'&&connectionState===null&&!connectionError){setFieldError('正在读取推荐服务状态，请稍候。');return;}
  if(stage==='matrix'&&(connectionError||!connectionState?.available)){setFieldError(connectionError||connectionState?.message||'推荐服务暂不可用，请稍后重试或联系运营。');return;}
  if(stage==='matrix'&&industrySelection.error){setFieldError(industrySelection.error);return;}
  if(stage==='matrix'&&(!industry||!qs.length)){setFieldError('请选择已配置行业，并填写至少一个问题（每行一个）。');formRef.current?.querySelector<HTMLElement>(!industry?'select':'textarea')?.focus();return;}
  if(stage==='matrix'&&(!catalog||industryCatalog.error||!industries.some(item=>item.id===industry))){setFieldError('请先读取行业目录，并选择当前有效行业。');return;}
  if(stage==='matrix'&&hours&&(!/^\d{1,6}$/.test(hours)||Number(hours)<=0)){setFieldError('原时效设置不可用于生成，请选择正整数时效选项或不限时效。');document.getElementById('sm-demand-hours')?.focus();return;}
  if(stage==='matrix'&&targetPlatform&&!isMatrixTargetPlatform(targetPlatform)){setFieldError('请选择当前支持的目标平台，或选择不限平台。');document.getElementById('sm-demand-target')?.focus();return;}
  if(stage==='matrix'&&brandData&&!brandBatches.some(batch=>batch.id===brandData)){setFieldError('历史任务选用的品牌样本当前不可用。请在数据选用状态中取消选用该样本，或联系运营恢复后重试。');return;}
  if(stage==='budget'&&(!total||!/^\d+(?:\.\d+)?$/.test(total))){setFieldError('请输入非负十进制总预算，勿使用科学计数法。');document.getElementById('z-budget-total')?.focus();return;}
  if(stage==='budget'&&(!result||matrixStale)){setFieldError('请先更新当前需求与稿件对应的矩阵。');return;}
  if(stage==='budget'&&result&&!['complete','partial'].includes(result.matrix.status)){setFieldError('请先生成并校验信源矩阵。');return;}
  // A new generated recommendation set replaces local quantity drafts, even
  // when the model returns the same resource/spec configuration. Ordinary
  // quantity recalculation responses keep their existing editor owner.
  setRecommendationEditEpoch(value=>value+1);setQuantityEditing(false);
  if(stage==='budget'){pendingBudget.current={key:latestBudget.current,matrix:result!};setBudgetPending(true);appliedBudget.current='';}
  else {if(result?.matrix.status==='complete'){setComparisonResult(result);setComparingPrevious(true);}pendingBudget.current=null;setBudgetPending(false);followUpBudget.current=true;setShowDemo(false);setShowReport(false);setReasonCandidate(null);setPlanIndex(0);}
  const submittedInput=inputKey,submittedContext=latestRecommendationContext.current;submissionLock.current=true;
  const abort=new AbortController(),seq=++sequence.current;request.current?.abort();pollRequest.current?.abort();request.current=abort;setBusy(true);setGenerationPhase('正在读取数据…');setError(null);setNotice('');
  try{
   const body=stage==='matrix'?{industry_id:industry,questions:qs,...(hasArticleContext?{identification_provenance:identificationProvenance(identification.fields)}:{}),dataset_ids:importedDataIds,...(industrySelection.query?{industry_query:industrySelection.query}:{}),...(product?{product}:{}),...(audience?{audience}:{}),...(normalizeMatrixRegions(regions).length?{regions:normalizeMatrixRegions(regions)}:{}),...(hours?{hours}:{}),...(targetPlatform?{target_platforms:[targetPlatform]}:{}),...(assetKind?{requirements:[assetKind]}:{}),...(brandData?{brand_data:brandData}:{}),...(brandData&&samplePlatform?{sample_platforms:[samplePlatform]}:{}),as_of:new Date().toISOString(),
     // Name the real draft/version; the server re-reads and verifies them.
     ...(serverDraft?{draft_id:serverDraft.id,article_version_id:serverDraft.articleVersionId}:contextDraftId||articleVersionId?{...(contextDraftId?{draft_id:contextDraftId}:{}),...(articleVersionId?{article_version_id:articleVersionId}:{})}:{})}
    :{plan_id:result?.plan_id,plan_version:result?.plan_version,budget:{currency,total_cap:total,exploration_enabled:enabled,...(enabled&&exploration!==''?{exploration_cap:exploration}:{}),...(min!==''?{unit_price_min:min}:{}),...(max!==''?{unit_price_max:max}:{})},selected_candidate_ids:selected,resource_selections:resourceSelections,quantity_mode:quantityMode,as_of:new Date().toISOString()};
   const r=await matrixApi<TaskResponse>(stage==='matrix'?'/matrix/generate':'/classify/'+encodeURIComponent(taskId)+'/budget',abort.signal,body);
   if(seq!==sequence.current||abort.signal.aborted)return;
   if(latestRecommendationContext.current!==submittedContext){followUpBudget.current=false;setBusy(false);setBudgetPending(false);pendingBudget.current=null;setNotice('稿件或任务上下文已变化，先前请求未应用。');return;}
   if(stage==='matrix'&&submittedInput!==latestInput.current){followUpBudget.current=false;setBusy(false);setNotice('投放需求已变化，先前生成结果未应用。请按当前需求重新生成。');return;}
   if(stage==='matrix'&&r.task_id)generationInputs.current.set(r.task_id,{inputKey:submittedInput,bindingKey});
   receiveTask(r);if(r.state==='running')setPollEpoch(n=>n+1);
   if(stage==='matrix'&&r.task_id){identification.adoptFormScope(r.task_id);const currentForm=latestFormOwner.current,nextFormScope=JSON.stringify([currentForm.verifiedFormScope??currentForm.pendingFormIdentity,r.task_id]);currentForm.formDraft.adoptScope(nextFormScope,currentForm.verifiedFormScope?nextFormScope:undefined);submittedTask.current={id:r.task_id,workspace,inputKey:submittedInput,bindingKey};setSelected([]);navigate(href('matrix',r.task_id));}
   if(stage==='budget'&&r.state==='running')setNotice('预算组合正在校验，请稍后刷新结果。');
  }catch(e){if(!abort.signal.aborted&&seq===sequence.current){if(stage==='matrix')followUpBudget.current=false;setFailedOperation(stage);setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));setBusy(false);setBudgetPending(false);pendingBudget.current=null;}}finally{if(seq===sequence.current)submissionLock.current=false;}
 }
 async function cancel(){
  if(!taskId){
   // 生成请求仍在途（服务端尚未返回任务号）：直接中止本次请求并复位界面。
   request.current?.abort();pollRequest.current?.abort();submissionLock.current=false;sequence.current++;
   setBusy(false);setBudgetPending(false);pendingBudget.current=null;setGenerationPhase('');setNotice('已取消本次生成请求。');
   return;
  }
  if(cancelRequest.current&&!cancelRequest.current.signal.aborted)return;
  followUpBudget.current=false;
  const abort=new AbortController(),context=latestRecommendationContext.current,seq=sequence.current;cancelRequest.current=abort;
  const current=()=>mounted.current&&!abort.signal.aborted&&context===latestRecommendationContext.current&&seq===sequence.current;
  try{await matrixApi('/classify/'+encodeURIComponent(taskId)+'/cancel',abort.signal,{});if(!current())return;request.current?.abort();pollRequest.current?.abort();submissionLock.current=false;sequence.current++;setBusy(false);setBudgetPending(false);pendingBudget.current=null;setResult(null);setTaskState('cancelled');setPollEpoch(n=>n+1);}
  catch(e){if(current())setError(new Error(serviceMessage(e instanceof Error?e.message:String(e))));}
  finally{if(cancelRequest.current===abort)cancelRequest.current=null;}
 }
 const candidates=result?.matrix.candidates??[];
 const [detailMedia,setDetailMedia]=useState<MediaResource>();
 const mapping=useExactMediaMapping(gateway,candidates.flatMap(candidate=>candidate.resource_id?[candidate.resource_id]:[]),JSON.stringify([taskId,result?.matrix_version]),cartScope);
 const mapped=mapping.items;
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
  const abort=new AbortController();
  const prepared=routeArticleId&&articleVersionId&&!contextDraftId?consumePreparedArticleSelection(gateway,workspace,routeArticleId,articleVersionId):undefined;
  setBinding(previous=>({...(previous?.scope===cartScope?previous:{}),...prepared,scope:cartScope,loading:true,error:''}));
  const failed=(error:string)=>setBinding(previous=>({...(previous?.scope===cartScope?previous:{}),scope:cartScope,loading:false,error}));
  const timer=setTimeout(()=>{abort.abort();failed('稿件上下文读取超时，请重试。');},20_000);
  void (async()=>{
   if(contextDraftId){
    const draft=await gateway.getDraft(contextDraftId,abort.signal);
    if(draft.id!==contextDraftId||articleVersionId&&draft.articleVersionId!==articleVersionId||routeArticleId&&draft.articleId!==routeArticleId)throw new Error('投放草稿与指定稿件版本不一致，请返回稿件页面核对。');
    return {draft};
   }
   if(articleVersionId){
    if(routeArticleId)return readVerifiedArticleSelection(gateway,{articleId:routeArticleId,versionId:articleVersionId},abort.signal);
    const version=await gateway.getArticleVersion(articleVersionId,abort.signal);
    if(version.id!==articleVersionId||!version.frozen)throw new Error('指定稿件版本尚未确认，请返回稿件页面核对。');
    return {version};
   }
   if(routeArticleId)throw new Error('当前稿件缺少关联版本，请重新选择稿件。');
   return {};
  })().then(value=>{if(!abort.signal.aborted)setBinding({scope:cartScope,loading:false,error:'',...value});}).catch(reason=>{if(!abort.signal.aborted)failed(reason instanceof Error?reason.message:'稿件上下文读取失败，请重试。');}).finally(()=>clearTimeout(timer));
  return()=>{abort.abort();clearTimeout(timer);};
 },[cartScope,bindingAttempt,routeArticleId,contextDraftId,articleVersionId,gateway,workspace]);
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
  const verifiedArticleId=serverDraft?.articleId??currentBinding?.article?.id??identification.context?.articleId;if(verifiedArticleId)query.set('articleId',verifiedArticleId);
  const boundId=serverDraft?.id||contextDraftId,base=boundId?`/publishing/drafts/${encodeURIComponent(boundId)}/media`:'/publishing/media';
  return projectWorkspaceUrl(base+(view==='home'?'':'/'+view)+(query.size?'?'+query.toString():''))+(typeof window!=='undefined'?window.location.hash:'');
 };
 const continueToTitles=async()=>{
  if(!serverDraft||!cart.size||bindingIssue||registrationPending||cartMutation.current||busy)return;
  const epoch=cartEpoch.current,scope=cartScope,owner=routeOwner;
  const current=()=>mounted.current&&epoch===cartEpoch.current&&latestScope.current===scope&&latestOwner.current===owner;
  cartMutation.current=true;setCartBusy(true);setNotice('');
  try{
   const batchMode=mode==='batch'||params.getAll('batchDraft').length>1||params.getAll('batchArticleVersion').length>1;
   const routeDraftIds=params.getAll('batchDraft');
   const draftIds=uniqueBatchIds([serverDraft.id,...(routeDraftIds.length?routeDraftIds:batchMode?flow?.resources?.filter(item=>item.kind==='publication_draft').map(item=>item.id)??[]:[])]);
   const drafts=await Promise.all(draftIds.map(id=>gateway.getDraft(id)));
   if(!current())return;
   if(drafts.some((draft,index)=>draft.id!==draftIds[index])||drafts[0]!.articleVersionId!==serverDraft.articleVersionId)
    throw new Error('投放草稿或冻结版本已变化，请重新读取稿件上下文。');
   const routeVersionIds=params.getAll('batchArticleVersion');
   const versionIds=uniqueBatchIds(routeVersionIds.length?routeVersionIds:batchMode?flow?.resources?.filter(item=>item.kind==='article_version').map(item=>item.id)??[]:[]);
   if(versionIds.some(id=>!drafts.some(draft=>draft.articleVersionId===id)))
    throw new Error('部分批量稿件尚未关联投放草稿，请在完整购物车中完成稿件关联后继续。');
   const url=new URL(mediaHref('cart'),window.location.origin);
   url.pathname=`/publishing/drafts/${encodeURIComponent(serverDraft.id)}/titles`;
   const route=withPublishingBatch(`${url.pathname}${url.search}${url.hash}`,draftIds,params.getAll('excludedDraft'));
   // The combined page owns title validation and saves. Opening it must not
   // change accepted/unknown drafts or create another supplier submission.
   if(flow)await flow.handoff({targetAgentId:'publishing',title:drafts.length>1?`批量发布 · ${drafts.length} 篇稿件`:`发布 · ${serverDraft.articleTitle}`,
    resources:drafts.flatMap(draft=>[{kind:'article_version' as const,id:draft.articleVersionId},{kind:'publication_draft' as const,id:draft.id}]),
    idempotencyKey:drafts.length>1?`media-publishing-batch-${draftIds.join(':')}`:`media-publishing-${serverDraft.id}`,route});
   else navigate(projectWorkspaceUrl(route));
  }catch(reason){if(current())setNotice(reason instanceof Error?reason.message:'标题配置入口暂不可用，当前媒体选择已保留，请重试。');}
  finally{if(current()){cartMutation.current=false;setCartBusy(false);}}
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
    const ownerTask=await selectionTask.ensureTask();if(ownerTask)savedTaskId=ownerTask;adoptFirstWorkbenchTask(ownerTask);
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
 const mediaFor=(id:string|null)=>id?mapping.mediaForResource(id):undefined;
 const rules=useMarketRules(mapped.map(m=>m.id),JSON.stringify([taskId,result?.matrix_version]),cartScope);
 const bindingKey=JSON.stringify([contextDraftId,articleVersionId,workbenchTask]);latestBinding.current=bindingKey;
 const adoptFirstWorkbenchTask=(verifiedTaskId:string|undefined)=>{
  // Only the ID returned by this scope's ensureTask may extend an unbound owner.
  if(!verifiedTaskId||workbenchTask||latestScope.current!==cartScope)return;
  const owner=generationInputs.current.get(taskId);
  if(owner?.bindingKey===bindingKey)owner.bindingKey=JSON.stringify([contextDraftId,articleVersionId,verifiedTaskId]);
 };
 // This client-context snapshot only invalidates comparison after navigation;
 // it is not proof that dataset.manuscripts matches the current frozen version.
 latestRecommendationContext.current=JSON.stringify([workspace,taskId,bindingKey]);
 /** 矩阵内容只依赖冻结稿件版本；承载它的投放草稿或工作台任务变化不算需求变化。 */
 const matrixVersionBinding=(value:string|null):string|null=>{if(value===null)return null;if(value==='mismatched')return 'mismatched';try{const parsed:unknown=JSON.parse(value);return JSON.stringify([Array.isArray(parsed)&&typeof parsed[1]==='string'?parsed[1]:'']);}catch{return value;}};
 const matrixStale=showingPrevious||!!result&&(serverStale||matrixInput!==null&&matrixInput!==inputKey||matrixBinding!==null&&matrixVersionBinding(matrixBinding)!==matrixVersionBinding(bindingKey));
 const budgetKey=JSON.stringify([inputKey,bindingKey,currency,total,enabled,exploration,min,max,selected.slice().sort(),resourceSelections,quantityMode]);latestBudget.current=budgetKey;
 const recommendations=useMemo(()=>normalizeRecommendations(result),[result]);
 const selectedRecommendation=recommendations[planIndex]??recommendations[0];
 const budgetStale=matrixStale||budgetPending||budgetNeedsRecompute||!!recommendations.length&&appliedBudget.current!==budgetKey;
 // 载入已保存任务且输入稳定后，把当前输入登记为组合基线：用户未改动前不提示“请更新组合”。
 // 延迟一拍读取，避免草稿/行业等异步水合改写 budgetKey 造成误报；写入 ref 后主动触发一次渲染。
 const [,bumpBudgetBaseline]=useState(0);
 useEffect(()=>{
  if(!taskState||taskState==='running'||!recommendations.length||budgetPending||budgetNeedsRecompute||matrixStale)return;
  const timer=setTimeout(()=>{if(appliedBudget.current===''){appliedBudget.current=latestBudget.current;bumpBudgetBaseline(value=>value+1);}},1500);
  return()=>clearTimeout(timer);
 },[taskState,recommendations.length,budgetPending,budgetNeedsRecompute,matrixStale]);
 const reportReady=!!result&&!busy&&!quantityEditing&&!budgetStale&&result.matrix.status==='complete'&&['complete','needs_budget','needs_budget_plans'].includes(result.status)&&!result.errors.length&&!!result.plan_id&&!!result.plan_version;
 const highlightedContentIds=selectedRecommendation?.items.map(item=>item.candidate_id)??[];
 const candidateIssue=(candidate:typeof candidates[number],media:MediaResource)=>bindingIssue||(busy?'矩阵正在更新，请稍后再选。':cartBusy?'正在保存媒体选择…':'')
  ||(!cart.has(media.id)?(!(candidate.semantic_decision_validated??result?.matrix.status==='complete')?'该候选尚未完成分层校验，暂供研究。':!rules.ready?rules.error||'正在读取媒体规则…':!rules.rules[media.id]?'媒体要求暂不可用，请刷新后重试。':candidate.channel_status!=='eligible'?'此信源的可投条件尚未通过。':mediaSelectionBlocker(media,articleHasImages)|| (cart.size>=20?'一次最多选择 20 家媒体':'')):'');
 const toggleCandidate=async(id:string)=>{
  const candidate=candidates.find(item=>item.candidate_id===id),media=candidate?mediaFor(candidate.resource_id):undefined;
  if(!candidate||!media)return;const issue=candidateIssue(candidate,media);if(issue){setNotice(issue);return;}
  const next=new Set(cart.keys());if(next.has(media.id))next.delete(media.id);else next.add(media.id);
  await persistCart([...next]);
 };
 useEffect(()=>{const next=candidates.filter(candidate=>{const media=mediaFor(candidate.resource_id);return media&&cart.has(media.id);}).map(candidate=>candidate.candidate_id);setSelected(previous=>previous.length===next.length&&previous.every((id,index)=>id===next[index])?previous:next);},[result,mapped,cart]);
 useEffect(()=>{if((!result&&!savedTask)||!taskId||hasArticleContext&&!identification.context||hydratedTask.current===taskHydrationKey)return;hydratedTask.current=taskHydrationKey;
  const savedBinding=itemObject(savedTask?.binding??result?.scope.task.binding??null);
  if(hasArticleContext&&(savedBinding.article_version_id!==identification.context?.articleVersionId||savedBinding.article_id!==identification.context?.articleId)){
   setServerStale(true);setMatrixBinding('mismatched');setNotice('已保存矩阵与当前稿件或版本不一致。已保留当前输入，请重新生成矩阵。');setTaskHydratedKey(taskHydrationKey);return;
  }
  // A saved task bound to a DIFFERENT draft is a real context change. A missing
  // draft on either side is the idempotent first-selection flow (createDraft
  // re-resolves the same draft for the same task/version/media), so it must not
  // block selection or budget application.
  const contextDraftIdValue=typeof contextDraftId==='string'?contextDraftId:'';
  const savedDraftId=typeof savedBinding.draft_id==='string'?savedBinding.draft_id:'';
  const draftBindingChanged=hasArticleContext&&!!savedDraftId&&!!contextDraftIdValue&&savedDraftId!==contextDraftIdValue;
  const t=savedTask??result!.scope.task,nextIndustry=catalog&&!industryCatalog.error?resolveSavedTaskIndustry(t,catalog).id??'':'',nextProduct=typeof t.product==='string'?t.product:'',nextAudience=typeof t.audience==='string'?t.audience:'',nextRegions=normalizeMatrixRegions(Array.isArray(t.regions)?t.regions.filter((x):x is string=>typeof x==='string'):typeof t.regions==='string'?t.regions:[]),nextQuestions=Array.isArray(t.questions)?t.questions.map(q=>q&&typeof q==='object'&&!Array.isArray(q)?typeof q.text==='string'?q.text:'':typeof q==='string'?q:'').filter(Boolean):[];
  const requirements=itemObject(t.requirements??null),brand=itemObject(t.brand??null),platforms=Array.isArray(brand.platforms)?brand.platforms.filter((value):value is string=>typeof value==='string'):[];
  const nextTargetPlatform=normalizeMatrixTargetPlatform(Array.isArray(t.target_platforms)&&typeof t.target_platforms[0]==='string'?t.target_platforms[0]:''),nextHours=typeof t.hours==='string'?t.hours:typeof t.hours==='number'?String(t.hours):'',nextAsset=requirements.images===true?'图片':requirements.tables===true?'表格':requirements.links===true?'链接':'',nextPlatform=platforms.length===1?platforms[0]??'':'',nextBrand=typeof brand.batch_id==='string'?brand.batch_id:'';
  const nextImportIds=Array.isArray(t.research_dataset_ids)?t.research_dataset_ids.filter((id):id is string=>typeof id==='string'):[];
  const savedIndustryQueryKey=industryQueryKey(t.industry_query);
  const platformRegeneration=typeof t.platform_regeneration_required==='boolean'?t.platform_regeneration_required:t.model_source==='user'||t.model_source==='host'||typeof itemObject(t.industry_context??result?.scope.task.industry_context??null).status!=='string';
  const submitted=submittedTask.current?.id===taskId&&submittedTask.current.workspace===workspace?submittedTask.current:null;
  if(submitted)submittedTask.current=null;
  setMatrixInput(submitted?.inputKey??JSON.stringify([nextIndustry,nextProduct.trim(),nextAudience.trim(),nextRegions,nextQuestions,nextHours,nextAsset,nextPlatform,nextBrand,nextTargetPlatform,[...nextImportIds].sort(),savedIndustryQueryKey]));setMatrixBinding(draftBindingChanged?'mismatched':submitted?.bindingKey??bindingKey);
  if(platformRegeneration)setServerStale(true);
  if(draftBindingChanged){setServerStale(true);setNotice('当前稿件的投放草稿已变化，已恢复投放要求；请重新生成矩阵后采用推荐组合。');}
  // Hydrate another saved task exactly once. A task just created here keeps any
  // edits made while it was running; its submitted key marks those edits stale.
  if(!submitted){
   if(savedIndustryQueryKey&&!['siScope','siPeriod','siDate','siModel'].some(key=>params.has(key))){const savedQuery=itemObject(t.industry_query??null);const next=new URLSearchParams(search);next.set('siScope',String(savedQuery.scopeId));next.set('siPeriod',String(savedQuery.periodType));next.set('siModel',String(savedQuery.modelCode));if(typeof savedQuery.date==='string')next.set('siDate',savedQuery.date);navigate(projectWorkspaceUrl(path+'?'+next.toString())+(typeof window!=='undefined'?window.location.hash:''),{replace:true});}
   setHistoricalImportRefs({owner:`${workspace}:${taskId}`,versions:Array.isArray(t.research_dataset_refs)?t.research_dataset_refs.flatMap(value=>{const row=itemObject(value);return typeof row.id==='string'&&typeof row.version==='string'?[{id:row.id,version:row.version}]:[];}):[]});setImportedDataIds(params.get('researchSelection')==='custom'?params.getAll('researchDataset'):nextImportIds);if(hasArticleContext)identification.hydrate({product:nextProduct,audience:nextAudience,questions:nextQuestions.join('\n')},`${workspace}:${taskId}`,{provenance:t.identification_provenance});
    formDraft.hydrate({product:nextProduct,audience:nextAudience,questions:nextQuestions.join('\n'),...matrixRegionDraft(nextRegions.join('、')),hours:nextHours,assetKind:nextAsset,samplePlatform:nextPlatform,brandData:nextBrand,targetPlatform:nextTargetPlatform});setShowDemo(false);
   setResourceSelections(result?.resource_selections??[]);setQuantityMode(result?.quantity_mode??'new_articles');
   const p=normalizeRecommendations(result)[0];formDraft.hydrate({total:p?.total_cap??'',currency:p?.currency??'CNY',enabled:!!p?.exploration_cap&&Number(p.exploration_cap)>0,exploration:p?.exploration_cap??'',min:'',max:''});
  }
  setTaskHydratedKey(taskHydrationKey);
   // A restored plan has no verified current-cart preference snapshot; compare it,
  // then regenerate before applying rather than treating it as freshly checked.
 },[taskId,result,savedTask,workspace,identification.context,hasArticleContext,taskHydrationKey,contextDraftId]);
 useEffect(()=>{if(taskId&&error&&failedOperation==='load')setTaskHydratedKey(taskHydrationKey);},[taskId,error,failedOperation,taskHydrationKey]);
 // Industry may arrive later than the saved task. It has a separate hydration
 // stamp, and never resets brand/audience/questions or an explicit manual clear.
 useEffect(()=>{
  if(!taskId||!savedTask||!catalog||industryCatalog.error||hydratedTask.current!==taskHydrationKey||hasArticleContext&&!identification.context)return;
  const savedBinding=itemObject(savedTask.binding??null);
  if(hasArticleContext&&(savedBinding.article_version_id!==identification.context?.articleVersionId||savedBinding.article_id!==identification.context?.articleId))return;
  const resolved=resolveSavedTaskIndustry(savedTask,catalog);
  if(!resolved.id){if(resolved.reason!=='missing')setServerStale(true);return;}
  if(hasArticleContext)identification.hydrate({industry:resolved.id},`${taskHydrationKey}:industry:${catalog.catalogVersion}`,{replaceSaved:['industry'],provenance:savedTask.identification_provenance});
  else formDraft.hydrate({industry:resolved.id});
  setMatrixInput(current=>canonicalizeMatrixInputIndustry(current,resolved.id!));
 },[result,taskId,savedTask,catalog,industryCatalog.error,taskHydrationKey,taskHydratedKey,identification.context,hasArticleContext]);
 useEffect(()=>{
  if(!followUpBudget.current||busy||budgetPending||!result||matrixInput===null||matrixStale)return;
  followUpBudget.current=false;
  if(!['complete','partial'].includes(result.matrix.status)){setNotice(label(result.status)+'：矩阵候选已生成；'+(result.status==='needs_ai_decisions'?'尚未得到有效模型决定，请稍后重试或联系运营。':'模型决定未通过校验，可重试。'));return;}
  if(result.matrix.status==='partial')setNotice('矩阵部分完成，正在基于已验证候选生成组合；未完成候选不参与本次估算。');
  if(!/^\d+(?:\.\d+)?$/.test(total)){setNotice('矩阵已生成。请在右侧填写总预算后点击“更新组合”。');return;}
  setNotice('矩阵已生成，正在按当前预算生成组合…');
  void submit('budget');
 },[result,busy,budgetPending,matrixInput,matrixStale,total]);
 const cartAmounts=publicationSelectionAmounts([...cart.values()],serverDraft?.items);
 const pendingPrices=cartAmounts.pending;
 const moneyTotal=currentBinding?.loading||currentBinding?.error||!currentBinding?undefined:cartAmounts.knownTotal;
 const cartHref=mediaHref('cart');
 const footer=<MediaCartFooter count={cart.size} total={moneyTotal} cartHref={cartHref} nextLabel="配置标题" nextDisabled={!!bindingIssue||cartBusy||busy||registrationPending||!serverDraft||!cart.size} nextHint={bindingIssue||registrationPending?'请完成当前稿件与任务关联后继续。':cartBusy?'正在核验或保存媒体选择…':busy?'正在更新信源规划，请稍候。':!cart.size?'请先选择媒体':undefined} onNext={()=>void continueToTitles()} pending={pendingPrices} publicationItems={serverDraft?.items} items={[...cart.values()]} onRemove={media=>{void persistCart([...cart.keys()].filter(id=>id!==media.id));}} onClear={()=>{void persistCart([]);}}/>;
 const cartBudgetMessage=currency!=='CNY'&&total?'购物车费用以人民币展示；当前组合预算为 '+currency+'，不能直接比较或自动换汇。':total&&/^\d+(?:\.\d{1,4})?$/.test(total)&&moneyTotal!==undefined?(()=>{const [whole='0',fraction='']=total.split('.'),cap=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0')),actual=BigInt(moneyTotal);return `当前购物车已知费用 ${formatPublishingMoney(moneyTotal)}${pendingPrices?'，另有 '+pendingPrices+' 项待询价':''}${actual>cap?'；超出当前预算 '+formatPublishingMoney((actual-cap).toString()):'；预算内仍需核对报价和预检'}。`;})():'';
 const serverBinding=(()=>{const value=result?.scope?.task?.binding;return value&&typeof value==='object'&&!Array.isArray(value)?value as unknown as ServerBinding:undefined;})();
 const planItemIssue=(item:BudgetPlan['items'][number])=>{
  const row=itemObject(item),candidate=candidateForItem(item,candidates),media=candidate?mediaFor(candidate.resource_id):undefined;
  if(!candidate||!media)return '尚未映射到唯一可投资源';
  if(row.resource_id&&row.resource_id!==candidate.resource_id)return '候选与发布资源不一致';
  // Plan items carry the plain version number; historical bindings may render "vN". Accept both spellings so a verified plan of the SAME frozen version is never blocked by formatting alone.
  const boundArticleId=serverBinding?.article_id??serverDraft?.articleId,boundVersions=serverBinding?(serverBinding.version_number===undefined?[]:[String(serverBinding.version_number),'v'+serverBinding.version_number]):serverDraft?[serverDraft.articleVersionId,serverDraft.articleVersionHash,String(serverDraft.articleVersion)]:[];
  if(!boundArticleId)return '请先在稿件页确认冻结版本并保存选媒，再应用组合';
  if(row.article_id!==boundArticleId||!boundVersions.includes(String(row.version??'')))return '组合发布项与当前绑定稿件或版本不一致，不能按媒体名称合并';
  if(!/^\d+$/.test(String(row.quantity))||!Number.isSafeInteger(Number(row.quantity))||Number(row.quantity)<1)return '篇数必须为正整数，且符合资源限制';
  return candidateIssue(candidate,media);
 };
 const prepareLayer=(items:typeof candidates)=>{setConfirmBudget(null);const next=items.filter(candidate=>{const media=mediaFor(candidate.resource_id);return media&&!cart.has(media.id)&&!candidateIssue(candidate,media);});setConfirmLayer(next);/* 多选本层可投媒体：默认全部勾选，可在确认弹窗中逐项取消。 */setLayerChecked(next.flatMap(candidate=>{const media=mediaFor(candidate.resource_id);return media?[media.id]:[];}));};
 const applyPlanRequest=async(plan:BudgetPlan,preview:boolean,draft:PublicationDraft):Promise<ApplyPlanDiff|null>=>{
  if(!result||!taskId)return null;
  const index=(result.budget_plans??[]).indexOf(plan);if(index<0)return null;
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
   const ownerTask=await selectionTask.ensureTask();adoptFirstWorkbenchTask(ownerTask);
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
 const previewItems=confirmLayer?confirmLayer.map(candidate=>({candidate,issue:(()=>{const media=mediaFor(candidate.resource_id);return media?candidateIssue(candidate,media):'尚未映射可投资源';})(),id:(()=>{const media=mediaFor(candidate.resource_id);return media?.id??candidate.candidate_id;})()})):planPreviewData?[]:[];
 const previewIds=confirmLayer?previewItems.flatMap(item=>item.id?[item.id]:[]):[];
 const checkedPreviewIds=previewIds.filter(id=>layerChecked.includes(id));
 const budgetPreview=confirmLayer||confirmBudget?{title:confirmLayer?'确认加入本层可投媒体':'确认加入预算组合',items:confirmLayer?previewItems.map((item,index)=>({id:item.id,name:mediaFor(item.candidate.resource_id)?.name??(item.candidate?display(item.candidate.attributes.source_name??item.candidate.attributes.name):'媒体 '+(index+1)),status:item.issue?'冲突 / 待确认':mediaFor(item.candidate.resource_id)&&cart.has(mediaFor(item.candidate.resource_id)!.id)?'已选，保留原项':'新增',reason:item.issue}))
  :planPreviewData?[...planPreviewData.additions.map(addition=>({name:addition.name,status:additionSummary(addition),reason:addition.reason??(addition.offerId?'报价身份 '+addition.offerId:'按组合核验加入')})),...planPreviewData.alreadySelected.map(entry=>({name:entry.name,status:'已在购物车',reason:entry.reason})),...planPreviewData.skipped.map(entry=>({name:entry.key,status:'暂不加入',reason:entry.reason}))]
   :[{name:'组合成员',status:'正在核对差异…',reason:'正在读取服务端核验的组合与购物车差异'}],
  blocked:confirmLayer?previewItems.some(item=>!!item.issue)||new Set([...cart.keys(),...checkedPreviewIds]).size>20:!!planPreviewData&&(planPreviewData.overLimit||!planPreviewData.additions.length),
  summary:confirmLayer?`已勾选 ${new Set(checkedPreviewIds.filter(id=>!cart.has(id))).size} 项，重复 ${checkedPreviewIds.filter(id=>cart.has(id)).length} 项；已有 ${cart.size} 项保留。`+(new Set([...cart.keys(),...checkedPreviewIds]).size>20?'合并后超过 20 家上限。':'')+'仅勾选媒体加入购物车，报价、规格与锁定项不自动替换。'
   :planPreviewData?`新增 ${planPreviewData.additions.filter(item=>!item.replaceExisting).length} 项，更新数量 ${planPreviewData.additions.filter(item=>item.replaceExisting).length} 项，保留已选 ${planPreviewData.alreadySelected.length} 项${planPreviewData.skipped.length?'，暂不加入 '+planPreviewData.skipped.length+' 项':''}；合并后 ${planPreviewData.mergedCount} 项`+(planPreviewData.knownTotalTenThousandths?'，已知费用 '+formatPublishingMoney(planPreviewData.knownTotalTenThousandths):'')+(planPreviewData.pendingPriced?'，待询价 '+planPreviewData.pendingPriced+' 项':'')+'。发布项保留报价与规格身份；手选与标题不被动改。':'服务端核验组合成员、报价与购物车差异。'}:undefined;
 const confirmBudgetMedia=async()=>{
  if(confirmLayer){if(!budgetPreview||budgetPreview.blocked)return;const ids=confirmLayer.flatMap(candidate=>{const media=mediaFor(candidate.resource_id);return media&&!candidateIssue(candidate,media)&&layerChecked.includes(media.id)?[media.id]:[];});if(!ids.length)return;if(await persistCart([...new Set([...cart.keys(),...ids])]))setConfirmLayer(null);return;}
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
 const updateContentQuantities=async(index:number,quantities:QuantityChange[])=>{
  if(!result||!taskId||busy||budgetStale)return false;
  const recommendation=recommendations[index];if(!recommendation)return false;
  const context=latestRecommendationContext.current,key=budgetKey,matrixVersion=result.matrix_version,abort=new AbortController(),seq=++sequence.current;
  request.current?.abort();pollRequest.current?.abort();request.current=abort;submissionLock.current=true;setBusy(true);setNotice('');
  try{
   const response=await matrixApi<TaskResponse>('/classify/'+encodeURIComponent(taskId)+(recommendation.legacy_kind==='formal'?'/formal-plan':recommendation.legacy_kind==='content'?'/content-plan':'/recommendation'),abort.signal,{plan_id:result.plan_id,plan_version:result.plan_version,plan_index:recommendation.source_index,...(!recommendation.legacy_kind&&recommendation.recommendation_id?{recommendation_id:recommendation.recommendation_id}:{}),quantities,as_of:new Date().toISOString()});
   if(abort.signal.aborted||seq!==sequence.current||context!==latestRecommendationContext.current||key!==latestBudget.current)return false;
   const status=response.result?.status??response.status;
   if(status&&['stale_matrix','invalid_input','invalid_decisions','needs_matrix'].includes(status)){
    appliedBudget.current='';if(status==='stale_matrix'||status==='needs_matrix')setServerStale(true);
    const issues=response.result?.errors??response.errors??[];
    setNotice(issues.length?'篇数调整未通过复核：'+issues.map(issue=>pricingReason(issue.message||issue.code)).join('；'):'当前矩阵或组合条件已变化，请更新结果后重新核算。');return false;
   }
   if(!response.result?.matrix||response.result.matrix_version!==matrixVersion){setNotice('组合版本已变化，请刷新结果后重新核算。');return false;}
   setResultTask(`${workspace}:${taskId}`);setResult({...response.result,matrix:refreshedMatrixQuotes(result.matrix,response.result.matrix),source_analysis:result.source_analysis});appliedBudget.current=key;const issues=response.result.errors??[];setNotice(issues.length?'篇数调整未通过完整复核：'+issues.map(issue=>pricingReason(issue.message||issue.code)).join('；'):'篇数和预计费用已更新。');return !issues.length;
  }catch(reason){if(!abort.signal.aborted&&seq===sequence.current)setNotice(serviceMessage(reason instanceof Error?reason.message:'篇数核算失败，请重试。'));return false;}
  finally{if(seq===sequence.current){setBusy(false);submissionLock.current=false;}}
 };
 const generate=(e:FormEvent)=>{void submit('matrix',e);};
 const matrixState=result?matrixReadiness(result.matrix,taskState):null;
 const matrixActionBlocker=matrixStale?'内容已更新，请重新生成。':!result?'请先生成矩阵。':busy?'正在处理，请稍候。':matrixState?.complete||matrixState?.partial?'':matrixState?.message??'';
 const budgetFields=<><div className="sm-budget-fields"><label>总预算（{currency}）<input className="field" id="z-budget-total" inputMode="decimal" value={total} placeholder="输入总预算" onChange={e=>setTotal(e.target.value)}/></label><label className="sm-exploration-toggle"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用探索投放</label>{enabled&&<label>探索子预算上限<input className="field" inputMode="decimal" value={exploration} placeholder="包含在总预算内" onChange={e=>setExploration(e.target.value)}/></label>}<details><summary>单篇价格条件</summary><label>最低单篇价格<input className="field" inputMode="decimal" value={min} placeholder="不限" onChange={e=>setMin(e.target.value)}/></label><label>最高单篇价格<input className="field" inputMode="decimal" value={max} placeholder="不限" onChange={e=>setMax(e.target.value)}/></label></details><button className="button primary" disabled={demoActive?busy||loading:busy||!result||matrixStale||!['complete','partial'].includes(result.matrix.status)} onClick={e=>demoActive?generate(e):void submit('budget',e)}>{demoActive?'按当前要求在线生成':budgetPending?'正在生成组合…':recommendations.length?'更新组合':'生成组合'}</button>{budgetPending&&<p className="small muted" role="status">组合生成预计需要约 3–6 分钟，请稍候。</p>}{!demoActive&&matrixActionBlocker&&<p className="small muted" role="status">{matrixActionBlocker}</p>}</div>{errorStage==='budget'&&fieldError&&<p className="block-error" role="alert">{fieldError}</p>}</>;

 const selectedArticleId=serverDraft?.articleId??currentBinding?.article?.id??identification.context?.articleId;
 const selectedArticleTitle=serverDraft?.articleTitle??currentBinding?.article?.title??identification.context?.title;
 const selectedArticleVersion=serverDraft?.articleVersion??currentBinding?.version?.version;
 const headerRows=selectedArticleTitle&&identificationVersion?[{id:identificationVersion,title:selectedArticleTitle,articleId:selectedArticleId,versionId:identificationVersion,version:selectedArticleVersion}]:[];
 const editHref=selectedArticleId?projectWorkspaceUrl(articleEditorHref(selectedArticleId,search,{retainArticleContext:true})):undefined;
 const selectArticle=(selection:ConfirmedArticleSelection)=>{
  prepareArticleSelection(gateway,workspace,selection);
  if(selection.article.id===selectedArticleId&&selection.version.id===identificationVersion){
   setBinding(previous=>({...(previous?.scope===cartScope?previous:{}),...selection,scope:cartScope,loading:false,error:''}));
   setBindingAttempt(value=>value+1);
   return true;
  }
  const next=confirmedArticleSelectionHref('/publishing/source-matrix',search,{articleId:selection.article.id,versionId:selection.version.id},{articleId:selectedArticleId,versionId:identificationVersion});
  performApprovedWorkspaceNavigation(()=>navigate(projectWorkspaceUrl(next)));
  return true;
 };
 const navigateFromHeader=(next:string)=>requestWorkspaceNavigation(()=>navigate(next));
 const distributionIndustry=industry;
 const distributionScope=JSON.stringify([workspace,identification.context?.scopeKey??[params.get('operatorOwnerId'),params.get('enterpriseProjectId')],identificationVersion||contextDraftId,identification.context?.contentDigest??'pending']);
 const savedTaskPending=Boolean(taskId&&taskHydratedKey!==taskHydrationKey&&emptyTaskOwner!==`${workspace}:${taskId}`&&!(error&&failedOperation==='load'));
 const distributionArticle=hasArticleContext?{scopeKey:distributionScope,contextReady:Boolean(identification.context&&currentBinding&&!currentBinding.loading&&!currentBinding.error),recognitionPending:!identification.fields.industry.edited&&!currentBinding?.error&&(identificationLoading||!currentBinding||currentBinding.loading||savedTaskPending||['loading','ready','identifying'].includes(identification.status)),suggestedIndustryId:distributionIndustry&&industries.some(item=>item.id===distributionIndustry)?distributionIndustry:null}:undefined;
 const identificationStatus=identificationLoading?<p role="status">{currentBinding?.error||'正在读取稿件上下文…'}</p>:<ArticleIdentificationStatus identification={identification}/>;
 const taskbar=<div className="sm-article-context"><ConfirmedArticleHeader rows={headerRows} selectedVersionId={identificationVersion||undefined} batch={mode==='batch'}
  loading={hasArticleContext&&(!currentBinding||currentBinding.loading)} error={currentBinding?.error||undefined} onRetry={()=>setBindingAttempt(value=>value+1)}
  disabled={cartBusy||busy||registrationPending} onRequestSelect={requestWorkspaceNavigation} onSelect={selectArticle} editHref={editHref} onNavigate={navigateFromHeader}/>
  <div className="sm-article-context-tools">
   {registrationPending&&<button className="link small" disabled={cartBusy} onClick={()=>void retryAssociation()}>重试关联当前投放草稿</button>}
  </div></div>;
 return <MediaShell title="信源矩阵" actions={<Link className="button secondary" href={mediaHref('third')} onClick={event=>{if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();navigateFromHeader(mediaHref('third'));}}}>进入媒体库自选</Link>} taskbar={taskbar}
 dialogs={<><ResearchImportDialog key={formScope+':imports'} scopeKey={formScope} open={importOpen} selectedIds={importedDataIds} onChange={updateImports} onRefresh={refreshImportedMetadata} onNotice={message=>{if(importScope.current===formScope)setImportNotice(message);}} onClose={()=>setImportOpen(false)}/><BudgetConfirmDialog plan={confirmBudget} candidates={candidates} busy={cartBusy||applyBusy} preview={budgetPreview} checkedIds={confirmLayer?layerChecked:undefined} onToggleItem={confirmLayer?(id=>setLayerChecked(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])):undefined} onClose={()=>{setConfirmBudget(null);setConfirmLayer(null);setLayerChecked([]);setApplyPreview(null);}} onConfirm={()=>void confirmBudgetMedia()}/><MatrixDialog open={historyOpen} title="历史矩阵与组合" onClose={()=>setHistoryOpen(false)} width={760} footer={<button className="button primary" onClick={()=>setHistoryOpen(false)}>关闭</button>}><div className="sm-history-list">{historyError&&<p className="block-error" role="alert">{historyError}<button className="link small" onClick={()=>{setHistoryError('');setHistoryItems(null);void openHistory();}}>重试</button></p>}{!historyError&&historyItems===null&&<p role="status">正在读取历史记录…</p>}{historyItems&&!historyItems.length&&<p>还没有生成记录。</p>}{historyItems?.map(item=><div className={'sm-history-row'+(item.task_id===taskId?' is-current':'')} key={item.task_id}><span className="sm-history-when">{new Date(item.created_at).toLocaleString()}</span><span className="sm-history-meta"><strong>{display(item.industry||'未记录行业')}</strong>{item.product?` · ${item.product}`:''}<small>{item.state==='complete'?`矩阵${label(item.matrix_status??item.state)} · ${item.candidate_count??'—'} 候选 · ${item.recommendation_count??0} 组组合`:item.state==='running'?'生成中':item.state}</small></span><button className="link small" onClick={()=>{setHistoryOpen(false);navigate(href('matrix',item.task_id));}}>查看</button></div>)}</div></MatrixDialog><RecommendationReason candidate={reasonCandidate} result={displayResult} returnFocus={reasonTrigger.current} resourceSelection={resourceSelections.find(value=>value.candidate_id===reasonCandidate?.candidate_id)} disabled={busy||matrixStale} onResourceSelection={!demoActive&&!showingPrevious&&reasonCandidate?value=>{setResourceSelections(current=>[...current.filter(item=>item.candidate_id!==reasonCandidate.candidate_id),...(value?[value]:[])]);}:undefined} onClose={()=>setReasonCandidate(null)}/></>}>
  <div className={'sm-workspace'+(view==='matrix'?' sm-recommendation-workspace':'')}>
   <nav className="x-matrix-nav" aria-label="信源矩阵子板块"><Link className={view==='analysis'?'active':''} aria-current={view==='analysis'?'page':undefined} href={href('analysis')}>行业信源分布</Link><Link className={view==='matrix'?'active':''} aria-current={view==='matrix'?'page':undefined} href={href('matrix')}>信源矩阵推荐</Link></nav>
   {view==='analysis'?<>{hasArticleContext&&identificationStatus}<LiveIndustryDistribution article={distributionArticle} selectedIndustry={{id:industry,onChange:setIndustry}}/></>:<>
    <form className="panel sm-demand" ref={formRef} aria-labelledby="sm-demand-title" noValidate onSubmit={generate}><div className="panel-title"><h2 id="sm-demand-title">本次投放要求</h2></div>
     {identificationStatus}
     
     <div className="sm-demand-fields"><label>品牌 / 产品<input className="field" aria-label="品牌 / 产品" disabled={identificationLoading} value={product} placeholder="输入品牌或产品" onChange={e=>setProduct(e.target.value)}/>{hasArticleContext&&<ArticleIdentificationFieldInfo fieldKey="product" identification={identification}/>}</label><label>目标行业 *<select aria-label="目标行业 *" disabled={identificationLoading} value={industry} aria-required="true" aria-invalid={!!fieldError&&errorStage==='matrix'&&!industry} aria-describedby={fieldError&&errorStage==='matrix'?'sm-demand-error':undefined} onChange={e=>setIndustry(e.target.value)}><option value="">{loading?'正在读取行业…':industries.length?'选择行业':industryCatalog.error?'行业目录读取失败':'暂无可用行业'}</option>{industry&&!industries.some(item=>item.id===industry)&&<option value={industry} disabled>原行业待确认，请重新选择</option>}{industries.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select>{hasArticleContext&&<ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={{loading,error:Boolean(industryCatalog.error),options:industries,retry:industryCatalog.retry}} onIndustryAdopted={()=>{
       formRef.current?.querySelector<HTMLSelectElement>('select[aria-label="目标行业 *"]')?.focus();
       if(errorStage==='matrix'&&fieldError==='请选择已配置行业，并填写至少一个问题（每行一个）。')setFieldError(questions.trim()?'':'请填写至少一个问题（每行一个）。');
       else if(errorStage==='matrix'&&fieldError==='请先读取行业目录，并选择当前有效行业。')setFieldError('');
      }}/>}</label><MatrixRegionSelect value={regions} unrestricted={regionsUnrestricted} onChange={formDraft.setRegions}/><label>目标受众<input className="field" aria-label="目标受众" disabled={identificationLoading} value={audience} placeholder="描述内容面向的人群" onChange={e=>setAudience(e.target.value)}/>{hasArticleContext&&<ArticleIdentificationFieldInfo fieldKey="audience" identification={identification}/>}</label><label>期望发布时效<select id="sm-demand-hours" aria-invalid={!!fieldError&&!!hours&&(!/^\d{1,6}$/.test(hours)||Number(hours)<=0)} aria-describedby={fieldError&&errorStage==='matrix'?'sm-demand-error':undefined} value={hours} onChange={e=>setHours(e.target.value)}>{matrixHourOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}{hours&&!matrixHourOptions.some(option=>option.value===hours)&&<option value={hours}>{matrixHourLabel(hours)}</option>}</select></label><label>素材能力要求<select value={assetKind} onChange={e=>setAssetKind(e.target.value)}><option value="">不限定</option><option value="图片">图片</option><option value="表格">表格</option><option value="链接">链接</option></select></label><label>目标平台<select id="sm-demand-target" aria-invalid={!!fieldError&&!!targetPlatform&&!isMatrixTargetPlatform(targetPlatform)} aria-describedby={fieldError&&errorStage==='matrix'?'sm-demand-error':undefined} value={targetPlatform} onChange={e=>setTargetPlatform(e.target.value)}><option value="">不限平台</option>{mediaAiPlatforms.map(platform=><option key={platform} value={platform}>{platform}</option>)}{targetPlatform&&!isMatrixTargetPlatform(targetPlatform)&&<option value={targetPlatform}>原设置：{targetPlatform}（请重新选择）</option>}</select></label><div className="sm-import-field"><span>导入数据</span><button type="button" className="button secondary" disabled={busy} onClick={()=>setImportOpen(true)}>导入数据</button></div>
      <div className="sm-import-summary" role="status" aria-live="polite" aria-atomic="true" aria-busy={!!importedDataIds.length&&(importMetadata?.owner!==importMetadataOwner||importMetadata.status==='loading')}>
       <strong>{!importedDataIds.length?'未选用导入数据':importMetadata?.owner!==importMetadataOwner||importMetadata.status==='loading'?'正在读取已保存文件列表…':importMetadata.status==='failed'?'选用数据尚未确认':`已选用 ${confirmedImports.length} 份导入数据`}</strong>
       {confirmedImports.length>0&&<ul>{confirmedImports.map(item=><li key={item.id}><span>{item.name}</span><span>（{Number.isSafeInteger(item.recordCount)&&item.recordCount>=0?item.recordCount:'—'} 条）</span></li>)}</ul>}
       {importMetadata?.owner===importMetadataOwner&&importMetadata.status==='failed'&&<p>{importMetadata.error}<button type="button" className="link small" onClick={()=>setImportMetadataAttempt(value=>value+1)}>重试读取文件列表</button></p>}
       {importNotice&&<p>{importNotice}</p>}
      </div>
      <label className="sm-demand-questions">目标问题 / 内容需求 *<textarea className="field" aria-label="目标问题 / 内容需求 *" disabled={identificationLoading} aria-required="true" aria-invalid={!!fieldError&&errorStage==='matrix'&&!questions.trim()} aria-describedby={fieldError&&errorStage==='matrix'?'sm-demand-error':undefined} value={questions} placeholder="输入目标问题" onChange={e=>setQuestions(e.target.value)}/>{hasArticleContext&&<ArticleIdentificationFieldInfo fieldKey="questions" identification={identification}/>}</label></div>
     {savedIndustryResolution?.reason&&savedIndustryResolution.reason!=='missing'&&<p className="small" role="status">原任务行业尚未对应到当前目录，请核对行业后重新生成矩阵。</p>}
     {researchFormScope.error&&<p className="small" role="status">{researchFormScope.error}<button type="button" className="link small" onClick={researchFormScope.retry}>重试保存草稿</button></p>}
     <div className="sm-demand-actions"><div>{industryUnavailable&&!hasArticleContext&&<p className="small" role="status">{industryCatalog.error?.status==='configuration_required'?'行业目录暂不可用，请稍后重试或联系运营。':serviceMessage(industryCatalog.error?.message||'行业目录暂不可用，请重试。')}<button type="button" className="link small" disabled={loading} onClick={industryCatalog.retry}>重试读取行业</button></p>}{busy&&!budgetPending&&<p className="small muted" role="status">矩阵生成预计需要约 5–10 分钟（候选越多耗时越长），期间可离开本页，稍后点击“刷新结果”查看进度。</p>}</div><div className="actions">{busy&&<button type="button" className="button secondary" onClick={()=>void cancel()}>取消生成</button>}<button className="button primary" disabled={busy||loading} type="submit">{busy&&!budgetPending?generationPhase||'正在生成…':result?'重新生成推荐并组合':'生成媒体渠道推荐'}</button></div></div>
     
     {(brandData||connectionError||!connectionState?.available)&&<div className="sm-input-status" aria-live="polite">{brandData&&<span>历史任务样本：{brandBatches.find(batch=>batch.id===brandData)?.label??'原品牌样本'}{samplePlatform?` · 样本平台：${samplePlatform}`:''}<button type="button" className="link small" disabled={busy} onClick={()=>{formDraft.setField('brandData','');formDraft.setField('samplePlatform','');}}>取消选用历史样本</button></span>}{(connectionError||!connectionState?.available)&&<span>{connectionError||(connectionState?connectionState.message||'推荐服务暂不可用，请稍后重试或联系运营。':'正在读取推荐服务状态…')}{(connectionError||connectionState&&!connectionState.available)&&<button type="button" className="link small" onClick={()=>{setConnectionState(null);setConnectionEpoch(value=>value+1);}}>重试读取服务状态</button>}</span>}</div>}
     {errorStage==='matrix'&&fieldError&&<p id="sm-demand-error" className="block-error" role="alert">{fieldError}</p>}
    </form>
    {showingPrevious&&<p className="notice warn" role="status">本次生成尚未成功，下面保留上次有效矩阵（{comparisonResult?.as_of}）供对照，不能作为本次生成结果或新增采购依据。</p>}
    {matrixStale&&result&&!showingPrevious&&<p className="block-error" role="status">需求已变化，当前矩阵按生成时的要求展示，媒体仍可选择；建议更新矩阵。</p>}
    {error&&<p className="block-error" role="alert">{error.message}<button className="link small" disabled={busy} onClick={e=>{if(failedOperation==='budget')void submit('budget',e);else if(failedOperation==='matrix'||!taskId)generate(e);else void refresh();}}>重试</button></p>}
    {notice&&<p className="notice" role="status">{notice}</p>}
    <div className="sm-recommendation-layout"><section className="sm-matrix" aria-labelledby="sm-matrix-title"><header className="sm-matrix-heading"><div><h2 id="sm-matrix-title">{displayResult?.matrix.suggestions?'媒体渠道推荐（按适配度顺序）':'完整信源矩阵'}</h2></div>{taskId&&<div className="actions"><button className="link small" onClick={()=>void openHistory()}>历史记录</button><button className="link small" disabled={busy} onClick={()=>void refresh()}>刷新结果</button>{result&&!showingPrevious&&<button className="link small" onClick={()=>setShowReport(value=>!value)}>{showReport?'收起报告':'查看报告'}</button>}</div>}{demoActive&&<div className="actions"><button className="link small" onClick={()=>downloadMatrixData('一航软件-已生成研究样本.json',JSON.stringify(matrixDemo,null,2),'application/json')}>导出保存样本</button><button className="link small" onClick={()=>setShowReport(value=>!value)}>{showReport?'收起样本报告':'查看样本报告'}</button></div>}</header>
     {!demoActive&&!showingPrevious&&mapping.error&&<p className="block-error" role="alert">{mapping.error}<button type="button" className="link" disabled={mapping.loading} onClick={mapping.retry}>重试读取媒体映射</button></p>}
     {!demoActive&&!showingPrevious&&mapping.loading&&<p className="small muted" role="status">正在匹配可投媒体…</p>}
     {!demoActive&&!showingPrevious&&matrixState&&!matrixState.complete&&<div className="x-empty" role="status"><strong>{matrixState.message}</strong>{matrixState.partial&&!busy&&<button type="button" className="link" onClick={()=>void retryMatrix()}>重试未完成项</button>}{!busy&&<button type="button" className="link" onClick={()=>void submit('matrix')}>重新生成矩阵</button>}</div>}
     {!demoActive&&bindingIssue&&<p className="sm-selection-status" role={currentBinding?.error?'alert':'status'}>{bindingIssue}{currentBinding?.error?<button className="link" onClick={()=>setBindingAttempt(value=>value+1)}>重试读取稿件上下文</button>:!currentBinding?.loading&&!contextDraftId&&!articleVersionId?<Link className="link" href={projectWorkspaceUrl('/publishing/articles')}>进入稿件选择</Link>:null}</p>}
     {!demoActive&&(rules.error||rules.ready&&mapped.some(media=>!rules.rules[media.id]))&&<p className="sm-selection-status" role="status">媒体要求暂不可用，暂不能新增选择。<button className="link" onClick={rules.reload}>重试读取媒体规则</button></p>}
     {demoActive?<><MatrixRecommendation result={matrixDemo.result} highlightedPlan={null} highlightedCandidateIds={selectedDemoCombination?.candidate_ids??[]} referenceCandidateIds={matrixDemo.research_combinations.flatMap(combination=>Object.entries(combination.usage_by_candidate).flatMap(([id,usage])=>usage==='reference'?[id]:[]))} mediaFor={()=>undefined} isSelected={()=>false} issue={()=>'研究样本不可加入购物车'} onToggle={()=>{}} onDetails={openReason} onMediaDetails={()=>{}} onLayer={()=>{}}/></>:showingPrevious&&comparisonResult?<MatrixRecommendation result={comparisonResult} highlightedPlan={null} mediaFor={()=>undefined} isSelected={()=>false} issue={()=>'上次结果仅供对照，请重新生成'} onToggle={()=>{}} onDetails={openReason} onMediaDetails={()=>{}} onLayer={()=>{}}/>:result&&matrixState&&(matrixState.complete||matrixState.partial)?<><MatrixRecommendation result={result} highlightedPlan={null} highlightedCandidateIds={highlightedContentIds} mediaFor={mediaFor} isSelected={media=>cart.has(media.id)} issue={candidateIssue} onToggle={id=>void toggleCandidate(id)} onDetails={openReason} onMediaDetails={setDetailMedia} onLayer={items=>prepareLayer(items)}/></>:result?null:<div className="x-empty"><strong>{busy?'正在生成完整矩阵':'等待生成矩阵'}</strong></div>}
    </section>{demoActive?<DemoBudgetRecommendations demo={matrixDemo} selectedIndex={planIndex} onSelect={setPlanIndex} onDetails={openReason} stale={demoBudgetStale}>{budgetFields}</DemoBudgetRecommendations>:<ContentPlanRecommendations key={`${taskId}:${bindingKey}:${result?.plan_id??''}:${result?.matrix_version??''}:${recommendationEditEpoch}`} plans={recommendations} candidates={candidates} selectedIndex={planIndex} onSelect={setPlanIndex} onDetails={openReason} onUpdate={updateContentQuantities} onEditingChange={setQuantityEditing} disabled={busy||cartBusy} stale={budgetStale} limitations={result?.recommendation_limit_reason?[result.recommendation_limit_reason]:result?.recommendation_limitations} onAddMedia={index=>{const plan=recommendations[index];if(!plan)return;const list=plan.items.map(item=>candidates.find(candidate=>candidate.candidate_id===item.candidate_id)).filter((candidate):candidate is MatrixResult['matrix']['candidates'][number]=>!!candidate);if(!list.length){setNotice('该组合没有可映射到媒体目录的成员，无法加入购物车。');return;}const addable=list.filter(candidate=>{const media=mediaFor(candidate.resource_id);return media&&!cart.has(media.id)&&!candidateIssue(candidate,media);});if(!addable.length){setNotice('组合媒体均已在购物车或暂不可加入。');return;}prepareLayer(list);}} onApply={selectedRecommendation?.formal_plan?index=>{const formal=recommendations[index]?.formal_plan;if(formal)void openApplyPlan(formal);}:undefined} applicationIssue={selectedRecommendation?.formal_plan?(!selectedRecommendation.formal_plan.items.length||!selectedRecommendation.formal_plan.budget_feasible||selectedRecommendation.formal_plan.is_estimate||selectedRecommendation.formal_plan.unknown_items?.length||selectedRecommendation.formal_plan.errors?.length||selectedRecommendation.formal_plan.semantic_pending?.length?'当前发布条件尚未通过核验':selectedRecommendation.formal_plan.items.map(planItemIssue).find(Boolean)):undefined}>{budgetFields}</ContentPlanRecommendations>}</div>
    {showReport&&displayResult&&<div className="sm-report"><div className="actions"><button className="button secondary" disabled={!demoActive&&!reportReady} onClick={()=>window.print()}>{demoActive?'打印保存样本报告':'打印报告'}</button></div>{demoActive?<DemoReport demo={matrixDemo} stale={demoBudgetStale}/>:quantityEditing?<p role="status">篇数修改尚未完成费用更新，报告将在更新后显示。</p>:result&&<Report result={result}/>}</div>}
   </>}
   {view==='analysis'&&notice&&<p className="notice" role="status">{notice}</p>}
   {cartBudgetMessage&&<p className="sm-cart-budget" role="status">{cartBudgetMessage}</p>}
   {footer}
  </div>
  <MediaDetails media={detailMedia} rules={detailMedia?rules.rules[detailMedia.id]:undefined} checked={detailMedia?cart.has(detailMedia.id):false} onToggle={()=>{const candidate=candidates.find(item=>mediaFor(item.resource_id)?.id===detailMedia?.id);if(candidate)void toggleCandidate(candidate.candidate_id);}} onClose={()=>setDetailMedia(undefined)}/>
 </MediaShell>;
}
