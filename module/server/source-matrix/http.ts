import { randomUUID } from 'node:crypto';
import { Router,json,type Request,type Response,type NextFunction } from 'express';
import { z } from 'zod';
import type { ModuleHttpCore } from '../http-api.js';
import { digest,clone,equal,issue,semantic,type Row } from './common.js';
import { validateBudget } from './contracts.js';
import { runPlanner } from './planner.js';
import { SOURCE_MATRIX_SKILL,SOURCE_MATRIX_INSTRUCTIONS } from './instructions.js';
import { MatrixRepository } from './repository.js';
import { BindingStore,bindingManuscripts,bindingSelectedItems,publicationSnapshot,resolvePlanItems,type TrustedArticleBinding } from './binding.js';
import { BRAND_DATA_BATCHES,brandCitationRecords,brandExportBatch } from './brand-data.js';
import { prepareExportResearch,researchCatalog } from './export-research.js';
import { loadPlannerCatalog } from '../publisher-source-matrix-catalog.js';
import { publisherImageCompatibilityBlocker } from '../publisher-capability.js';
import { mediaRulesImageBlocker } from '../providers/kol/media-rules.js';
const start=z.object({industry_id:z.string().min(1).max(80),questions:z.array(z.string().trim().min(1).max(2000)).min(1).max(50),product:z.string().max(2000).optional(),audience:z.string().max(2000).optional(),regions:z.array(z.string().min(1).max(200)).max(50).optional(),hours:z.string().regex(/^\d{1,6}$/).optional(),requirements:z.array(z.enum(['图片','表格','链接'])).max(3).optional(),sample_platforms:z.array(z.string().min(1).max(80)).max(10).optional(),brand_data:z.string().min(1).max(80).optional(),as_of:z.string(),draft_id:z.string().uuid().optional(),article_version_id:z.string().uuid().optional()}).strict();
const resourceChoice=z.object({candidate_id:z.string().min(1).max(300),resource_id:z.string().min(1).max(300),offer_id:z.string().min(1).max(300),publication_spec:z.union([z.string().min(1),z.record(z.string(),z.unknown())])}).strict();
const budget=z.object({plan_id:z.string().regex(/^plan-[a-f0-9]{24}$/),plan_version:z.string().regex(/^plan-version-[a-f0-9]{24}$/),budget:z.record(z.string(),z.unknown()),selected_candidate_ids:z.array(z.string().max(300)).max(500).optional(),resource_selections:z.array(resourceChoice).max(500).optional(),quantity_mode:z.enum(['new_articles','repeat_article']).optional(),as_of:z.string()}).strict();
const editContent=z.object({plan_id:z.string().regex(/^plan-[a-f0-9]{24}$/),plan_version:z.string().regex(/^plan-version-[a-f0-9]{24}$/),plan_index:z.number().int().min(0).max(2),quantities:z.array(z.object({item_index:z.number().int().nonnegative(),candidate_id:z.string().min(1),quantity:z.number().int().min(1).max(100)}).strict()).min(1).max(100),as_of:z.string()}).strict();
const applyPlan=z.object({plan_id:z.string().regex(/^plan-[a-f0-9]{24}$/),plan_version:z.string().regex(/^plan-version-[a-f0-9]{24}$/),plan_index:z.number().int().min(0).max(2),draft_id:z.string().uuid(),article_version_id:z.string().uuid(),expected_revision:z.number().int().nonnegative(),preview:z.boolean()}).strict();
const download=z.object({plan_id:z.string().regex(/^plan-[a-f0-9]{24}$/).optional(),plan_version:z.string().regex(/^plan-version-[a-f0-9]{24}$/).optional()}).strict().refine(value=>(value.plan_id===undefined)===(value.plan_version===undefined));
function datasetRequest(dataset:Row,task:Row,tenantId:string,taskId:string,brandId:string,binding?:TrustedArticleBinding|null,brandCitations?:Row[],directory:Row[]=[]):Row {
 // Fixed allowlist: config cannot overwrite server identity or user task goals.
 // A trusted article binding replaces configured manuscripts and selections with
 // the server-verified frozen version and the current draft cart; a selected
 // brand batch supplies the observation records for the recommendation lane.
 const bound=!!binding;
 const selectedBatch=task.brand?.batch_id?(brandExportBatch(task.brand.batch_id)??(dataset.brand_exports??[]).find((row:Row)=>row.id===task.brand.batch_id)):undefined;
 const observation=selectedBatch?prepareExportResearch(selectedBatch,task,task.brand?.platforms??[]):undefined;
 const citations=observation?[]:brandCitations??clone(dataset.citations??[]);
 const configured:Row[]=dataset.catalog??[];
 // Live directory is the authority for purchasable IDs/offers. Configured media
 // attributes may enrich matching IDs but cannot overwrite fresh quote facts.
 const catalog=directory.map(row=>({...semantic(configured.find(c=>c.resource_id===row.resource_id)??{}),...clone(row)}));
 catalog.push(...configured.filter(c=>!c.resource_id).map(clone));
 if(observation)catalog.push(...researchCatalog(observation,catalog));
 return {tenant_id:tenantId,task_id:taskId,brand_id:brandId,task:{...clone(task),...(bound?{manuscripts:bindingManuscripts(binding!)}:dataset.manuscripts?{manuscripts:clone(dataset.manuscripts)}:{}),...(dataset.requirements&&!bound?{requirements:{...clone(dataset.requirements),...clone(task.requirements??{})}}:{})},catalog,citations,...(observation?{research_observation:observation}:{}),source_mappings:clone(dataset.source_mappings??[]),scope:{...clone(dataset.scope??{}),tenant_id:tenantId},identity_config:clone(dataset.identity_config??{}),industry_recommendations:clone(dataset.industry_recommendations??[]),selected_items:bound?bindingSelectedItems(binding!):clone(dataset.selected_items??[])};
}
export function createSourceMatrixRouter(core:ModuleHttpCore):Router {
 const router=Router();router.use(json({limit:'256kb'}));
 const wrap=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
 async function repository(req:Request){const c=core.context(req);if(!c.enterpriseProjectId||!c.businessOwnerId)throw Object.assign(new Error('需要已授权企业项目'),{status:403});
  // Opaque tenant boundary derives exclusively from authenticated project + business owner.
  return new MatrixRepository(await core.database(),'publish-'+digest({project:c.enterpriseProjectId,owner:c.businessOwnerId}));}
 async function directory(req:Request):Promise<Row[]>{const c=core.context(req);return loadPlannerCatalog(await core.database(),String(c.businessOwnerId??''),String(c.enterpriseProjectId??''));}
 router.use((req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method==='POST'){
   const origin=req.get('Origin'),host=req.get('Host');
   if(req.get('Sec-Fetch-Site')==='cross-site'||!origin||!host){res.status(403).json({status:'forbidden',errors:[issue('same_origin_required','$','请从当前站点提交')]});return;}
   try{if(new URL(origin).host!==host){res.status(403).json({status:'forbidden'});return;}}catch{res.status(403).json({status:'forbidden'});return;}
  }next();
 });
 router.get('/industries',wrap(async(req,res)=>{
  const repo=await repository(req),items=await repo.industries();res.json({status:items.length?'configured':'configuration_required',industries:items,brand_data_batches:[...BRAND_DATA_BATCHES.map(({id,label,version,sourceFile,recordCount,period,models})=>({id,label,version,sourceFile,recordCount,period,models})),...await repo.brandBatches()],message:items.length?null:'行业数据尚未配置，请联系运营接入真实行业、媒体与报价'});
 }));
 router.get('/source-distribution',wrap(async(req,res)=>{
  const repo=await repository(req),view=await repo.sourceDistribution();
  if(['invalid_data','data_limit_exceeded'].includes(view.status))console.warn('source_matrix_distribution_unavailable',{reason:view.status});
  res.json(view);
 }));
 router.post('/matrix/generate',wrap(async(req,res)=>{
  const parsed=start.safeParse(req.body);if(!parsed.success){res.status(400).json({status:'invalid_input',errors:parsed.error.issues});return;}
  const body=parsed.data,repo=await repository(req),industry=await repo.industry(body.industry_id);
  if(!industry){res.status(409).json({status:'configuration_required',message:'所选行业未配置或无权访问'});return;}
  // A browser can only name the draft/version; the server re-reads and verifies
  // both inside the authenticated owner and project scope before trusting them.
  let binding:TrustedArticleBinding|null=null;
  if(body.draft_id||body.article_version_id){
   const context=core.context(req),store=new BindingStore(await core.database(),{ownerId:String(context.businessOwnerId),enterpriseProjectId:String(context.enterpriseProjectId)});
   const loaded=await store.loadBinding({draftId:body.draft_id,articleVersionId:body.article_version_id});
   if(loaded.failure==='draft_not_found'){res.status(404).json({status:'binding_not_found',message:'未找到当前授权范围内的投放草稿，请返回稿件页面核对'});return;}
   if(loaded.failure==='version_not_found'){res.status(404).json({status:'binding_not_found',message:'未找到当前稿件冻结版本，请返回稿件页面确认版本'});return;}
   if(loaded.failure==='draft_version_mismatch'){res.status(409).json({status:'binding_not_found',message:'投放草稿与指定稿件版本不一致，请返回稿件页面核对'});return;}
   binding=loaded.binding!;
  }
  const taskId=randomUUID(),task:Row={industry:industry.name,questions:body.questions.map((text,i)=>({question_id:'question-'+digest({text,index:i}),text})),...(body.product?{product:body.product}:{}),...(body.audience?{audience:body.audience}:{}),...(body.regions?.length?{regions:body.regions}:{}),...(body.hours?{hours:body.hours}:{}),...(body.requirements?.length?{requirements:Object.fromEntries(body.requirements.map(kind=>[kind==='图片'?'images':kind==='表格'?'tables':'links',true]))}:{}),...(body.brand_data?{brand:{batch_id:body.brand_data,label:BRAND_DATA_BATCHES.find(b=>b.id===body.brand_data)?.label??body.brand_data,...(body.sample_platforms?.length?{platforms:body.sample_platforms}:{})}}:{})};
  if(binding)task.binding={draft_id:binding.draftId,article_version_id:binding.articleVersionId,article_id:binding.articleId,version_number:binding.versionNumber,content_hash:binding.contentHash,article_title:binding.articleTitle,fingerprint:binding.fingerprint,bound_at:body.as_of};
  // Brand sample rows are real recommendation input (never an industry-page fallback).
  const brandCitations=body.brand_data?brandCitationRecords(body.brand_data,body.sample_platforms):undefined;
  if(body.brand_data&&!brandExportBatch(body.brand_data)&&!(industry.dataset.brand_exports??[]).some((row:Row)=>row.id===body.brand_data)){res.status(400).json({status:'invalid_input',message:'所选品牌样本不存在或无权访问'});return;}
  const request=datasetRequest(industry.dataset,task,repo.tenantId,taskId,industry.brandId,binding,brandCitations,await directory(req)),prepared=runPlanner(request,undefined,'matrix',undefined,body.as_of);
  if(prepared.status==='invalid_input'){res.status(400).json(prepared);return;}
  await repo.create(taskId,industry.industryId,industry.brandId,task);
  res.status(202).json({task_id:taskId,state:'running',result:prepared});
  void (async()=>{
  let result=prepared;
  try{if(core.sourceMatrixDecisions){const d=await core.sourceMatrixDecisions.matrix({request:clone(request),prepared:clone(prepared),as_of:body.as_of,skill:SOURCE_MATRIX_SKILL,instructions:SOURCE_MATRIX_INSTRUCTIONS});if(d)result=runPlanner(request,d,'matrix',undefined,body.as_of);}}
  catch(reason){result={...prepared,limitations:[...prepared.limitations,'decision_adapter_unavailable:'+String((reason as Error)?.message??reason).split(' ').join(' ').slice(0,90)]};}
  if(result.report)result.report.limitations=clone(result.limitations);
  await repo.save(taskId,result);
  })().catch(async()=>{await repo.save(taskId,{...prepared,limitations:[...prepared.limitations,'result_persistence_failed']}).catch(()=>undefined);});
 }));
 router.post('/classify/:taskId/budget',wrap(async(req,res)=>{
  const parsed=budget.safeParse(req.body);if(!parsed.success){res.status(400).json({status:'invalid_input',errors:parsed.error.issues});return;}
  const body=parsed.data,errors=validateBudget(body.budget);if(errors.length){res.status(400).json({status:'invalid_input',errors});return;}
  const repo=await repository(req),task=await repo.get(String(req.params.taskId));if(!task){res.status(404).json({status:'not_found'});return;}
  const previous=await repo.snapshot(task.taskId,body.plan_id,body.plan_version);if(!previous){res.status(409).json({status:'needs_matrix',message:'请先生成并校验信源矩阵'});return;}
  if(task.latest?.plan_version!==body.plan_version){res.status(409).json({status:'stale_plan',message:'方案已更新，请刷新后使用当前版本'});return;}
  const industry=await repo.industry(task.industryId);if(!industry){res.status(409).json({status:'configuration_required',message:'原行业配置不可用'});return;}
  // Re-read actual article identity. Cart revision/locks are refreshed budget
  // inputs, not semantic media fitness: adopting a plan must not force AI rerun.
  let binding:TrustedArticleBinding|null=null;
  const stored=task.task?.binding;
  if(stored){
   const context=core.context(req),store=new BindingStore(await core.database(),{ownerId:String(context.businessOwnerId),enterpriseProjectId:String(context.enterpriseProjectId)});
   const loaded=await store.loadBinding({draftId:stored.draft_id??undefined,articleVersionId:stored.article_version_id});
   if(!loaded.binding||loaded.binding.articleId!==stored.article_id||loaded.binding.articleVersionId!==stored.article_version_id||loaded.binding.contentHash!==stored.content_hash){res.status(409).json({status:'stale_binding',message:'绑定稿件或冻结版本已变化，请重新生成矩阵'});return;}
   binding=loaded.binding;
  }
  // Budget rebuilds the identical brand citations so both stages see one input set.
  const storedBrand=task.task?.brand;
  const brandCitations=storedBrand?.batch_id?brandCitationRecords(String(storedBrand.batch_id),Array.isArray(storedBrand.platforms)?storedBrand.platforms.map(String):undefined):undefined;
  const request:Row={...datasetRequest(industry.dataset,task.task,repo.tenantId,task.taskId,industry.brandId,binding,brandCitations,await directory(req)),budget:body.budget,publication_intent:body.quantity_mode==='repeat_article'?'repeat_existing_article':'new_articles',resource_selections:body.resource_selections??[]};
  if(body.quantity_mode==='repeat_article'&&!request.task.manuscripts?.length){res.status(400).json({status:'binding_required',message:'重复当前稿件前请绑定真实冻结版本'});return;}
  if(new Set(request.resource_selections.map((choice:Row)=>choice.candidate_id)).size!==request.resource_selections.length||request.resource_selections.some((choice:Row)=>!previous.matrix.candidates.some((c:Row)=>c.candidate_id===choice.candidate_id&&(c.catalog_matches??[]).some((m:Row)=>m.resource_id===choice.resource_id))||!request.catalog.some((o:Row)=>o.resource_id===choice.resource_id&&o.offer_id===choice.offer_id&&equal(o.publication_spec,choice.publication_spec)))){res.status(400).json({status:'invalid_resource_selection',message:'请从本次矩阵对应的真实媒体与报价中选择'});return;}
  const asOf=new Date().toISOString();
  // User choices are preferences, not trusted locks or forced publication quantities.
  const ids=body.selected_candidate_ids??[];
  if(ids.some(id=>!previous.matrix.candidates.some((c:Row)=>c.candidate_id===id))){res.status(400).json({status:'invalid_input',message:'所选来源不属于原矩阵'});return;}
  const precheck=runPlanner(request,undefined,'budget',previous,asOf);
  if(['stale_matrix','invalid_input','needs_matrix'].includes(precheck.status)){res.status(409).json({result:precheck});return;}
  if(!await repo.begin(task.taskId,body.plan_version)){res.status(409).json({status:'task_busy_or_cancelled',message:'任务版本已更新、正在处理或已取消'});return;}
  res.status(202).json({task_id:task.taskId,state:'running',result:precheck});
  void (async()=>{
  let result=precheck;
  try{if(core.sourceMatrixDecisions){const d=await core.sourceMatrixDecisions.budget({request:clone({...request,selection_preferences:ids}),matrix:clone(precheck),as_of:asOf,skill:SOURCE_MATRIX_SKILL,instructions:SOURCE_MATRIX_INSTRUCTIONS});if(d)result=runPlanner(request,d,'budget',previous,asOf);}}
  catch(reason){result={...precheck,limitations:[...precheck.limitations,'decision_adapter_unavailable:'+String((reason as Error)?.message??reason).split(' ').join(' ').slice(0,90)]};}
  if(result.report)result.report.limitations=clone(result.limitations);
  await repo.save(task.taskId,result);
  })().catch(async()=>{await repo.save(task.taskId,{...precheck,limitations:[...precheck.limitations,'result_persistence_failed']}).catch(()=>undefined);});
 }));
 router.get('/classify/:taskId',wrap(async(req,res)=>{const repo=await repository(req),task=await repo.get(String(req.params.taskId));if(!task){res.status(404).json({status:'not_found'});return;}res.json({task_id:task.taskId,state:task.state,result:task.state==='cancelled'?null:task.latest});}));
 router.post(['/classify/:taskId/content-plan','/classify/:taskId/formal-plan'],wrap(async(req,res)=>{
  const parsed=editContent.safeParse(req.body);if(!parsed.success){res.status(400).json({status:'invalid_input',errors:parsed.error.issues});return;}
  const body=parsed.data,repo=await repository(req),task=await repo.get(String(req.params.taskId));
  if(!task){res.status(404).json({status:'not_found'});return;}
  const previous=await repo.snapshot(task.taskId,body.plan_id,body.plan_version);
  if(!previous||task.latest?.plan_version!==body.plan_version){res.status(409).json({status:'stale_plan',message:'方案已更新，请刷新后编辑当前版本'});return;}
  const formalEdit=req.path.endsWith('/formal-plan'),plans:Row[]=clone(previous.content_plans??[]);
  const formal=(previous.budget_plans??[]).map((p:Row)=>({strategy:p.strategy,reason_summary:p.reason_summary,...(p.explanation?{explanation:p.explanation}:{}),items:p.items.map((x:Row)=>Object.fromEntries(['article_id','version','resource_id','offer_id','publication_spec','quantity','purpose'].map(k=>[k,x[k]])))}));
  const target=formalEdit?formal[body.plan_index]:plans[body.plan_index]?.decisions;
  if(!target){res.status(404).json({status:'plan_not_found'});return;}
  if(new Set(body.quantities.map(x=>x.item_index)).size!==body.quantities.length||body.quantities.some(x=>{const item=target.items[x.item_index];return !item||(formalEdit?previous.matrix.candidates.find((c:Row)=>c.resource_id===item.resource_id)?.candidate_id:item.candidate_id)!==x.candidate_id;})){res.status(400).json({status:'invalid_quantity_selection'});return;}
  for(const edit of body.quantities)target.items[edit.item_index].quantity=edit.quantity;
  const industry=await repo.industry(task.industryId);if(!industry){res.status(409).json({status:'configuration_required'});return;}
  let binding:TrustedArticleBinding|null=null;
  if(task.task?.binding){const context=core.context(req),store=new BindingStore(await core.database(),{ownerId:String(context.businessOwnerId),enterpriseProjectId:String(context.enterpriseProjectId)}),loaded=await store.loadBinding({draftId:task.task.binding.draft_id??undefined,articleVersionId:task.task.binding.article_version_id});
   if(!loaded.binding||loaded.binding.articleId!==task.task.binding.article_id||loaded.binding.articleVersionId!==task.task.binding.article_version_id||loaded.binding.contentHash!==task.task.binding.content_hash){res.status(409).json({status:'stale_binding',message:'稿件或冻结版本已变化，请重新确认矩阵'});return;}binding=loaded.binding;}
  const snapshot=previous.scope.input_snapshot,request={...datasetRequest(industry.dataset,task.task,repo.tenantId,task.taskId,industry.brandId,binding,undefined,await directory(req)),budget:clone(snapshot.budget),publication_intent:snapshot.publication_intent??'new_articles',resource_selections:clone(snapshot.resource_selections??[]),quantity_edits:{plan_kind:formalEdit?'formal':'content',plan_index:body.plan_index,items:clone(body.quantities)}};
  const result=runPlanner(request,{budget_plans:formal,content_plans:plans.map(p=>p.decisions)},'budget',previous,new Date().toISOString());
  if(['stale_matrix','invalid_input','invalid_decisions','needs_matrix'].includes(result.status)){res.status(409).json({status:result.status,result});return;}
  if(!await repo.begin(task.taskId,body.plan_version)){res.status(409).json({status:'task_busy_or_cancelled'});return;}
  await repo.save(task.taskId,result);res.json({task_id:task.taskId,state:'complete',result});
 }));
 router.post('/classify/:taskId/apply-plan',wrap(async(req,res)=>{
  const parsed=applyPlan.safeParse(req.body);if(!parsed.success){res.status(400).json({status:'invalid_input',errors:parsed.error.issues});return;}
  const body=parsed.data,repo=await repository(req),task=await repo.get(String(req.params.taskId));if(!task){res.status(404).json({status:'not_found'});return;}
  if(task.state!=='complete'||task.latest?.status!=='complete'||task.latest?.plan_version!==body.plan_version){res.status(409).json({status:'stale_plan',message:'任务正在更新、已取消、上次组合校验失败或组合不是当前版本，请刷新后重试'});return;}
  const snapshot=await repo.snapshot(task.taskId,body.plan_id,body.plan_version);if(!snapshot){res.status(409).json({status:'needs_matrix',message:'请先生成并校验信源矩阵'});return;}
  const plans=Array.isArray(snapshot.budget_plans)?snapshot.budget_plans as Row[]:[],plan=plans[body.plan_index];
  if(!plan){res.status(404).json({status:'plan_not_found',message:'指定组合不存在，请重新生成组合'});return;}
  if(plan.budget_feasible!==true||plan.is_estimate===true||(Array.isArray(plan.unknown_items)&&plan.unknown_items.length)||(Array.isArray(plan.errors)&&plan.errors.length)){res.status(409).json({status:'plan_not_applicable',message:'该组合仍有待确认费用或未通过核验，不能加入购物车'});return;}
  const context=core.context(req),store=new BindingStore(await core.database(),{ownerId:String(context.businessOwnerId),enterpriseProjectId:String(context.enterpriseProjectId)});
  const stored=task.task?.binding;
  if(stored&&(body.article_version_id!==stored.article_version_id||body.draft_id!==(stored.draft_id??body.draft_id))){res.status(409).json({status:'stale_binding',message:'矩阵绑定的稿件或草稿已变化，请重新生成矩阵'});return;}
  const loaded=await store.loadBinding({draftId:body.draft_id,articleVersionId:body.article_version_id});
  if(loaded.failure==='draft_not_found'){res.status(404).json({status:'binding_not_found',message:'未找到当前授权范围内的投放草稿，请返回稿件页面核对'});return;}
  if(loaded.failure==='version_not_found'){res.status(404).json({status:'binding_not_found',message:'未找到当前稿件冻结版本，请返回稿件页面确认版本'});return;}
  if(loaded.failure==='draft_version_mismatch'){res.status(409).json({status:'binding_not_found',message:'投放草稿与指定稿件版本不一致，请返回稿件页面核对'});return;}
  const binding=loaded.binding!;
  if(stored&&(binding.articleId!==stored.article_id||binding.articleVersionId!==stored.article_version_id||binding.contentHash!==stored.content_hash)){res.status(409).json({status:'stale_binding',message:'绑定稿件或冻结版本已变化，请重新生成矩阵和组合'});return;}
  // Re-read quotes and all authoritative constraints immediately before cart
  // preview/apply. A saved plan's successful calculation is not a current price.
  const industry=await repo.industry(task.industryId);if(!industry){res.status(409).json({status:'configuration_required'});return;}
  const input=snapshot.scope?.input_snapshot;
  if(!input?.budget){res.status(409).json({status:'plan_not_applicable'});return;}
  const currentRequest={...datasetRequest(industry.dataset,task.task,repo.tenantId,task.taskId,industry.brandId,binding,undefined,await directory(req)),budget:clone(input.budget),publication_intent:input.publication_intent??'new_articles',resource_selections:clone(input.resource_selections??[])};
  const formal={strategy:plan.strategy,reason_summary:plan.reason_summary,items:plan.items.map((x:Row)=>Object.fromEntries(['article_id','version','resource_id','offer_id','publication_spec','quantity','purpose'].map(k=>[k,x[k]])))};
  const verified=runPlanner(currentRequest,{budget_plans:[formal]},'budget',snapshot,new Date().toISOString()),current=verified.budget_plans?.[0];
  if(verified.status!=='complete'||!current?.budget_feasible||!current?.semantic_ready||current.is_estimate||current.errors?.length||current.unknown_items?.length||current.total_cost!==plan.total_cost){res.status(409).json({status:'stale_quote_or_plan',message:'最新报价、约束或预算核算已变化，请更新组合后再采用'});return;}
  const existingItems=await store.loadDraftItems(body.draft_id);
  const itemKeys=(Array.isArray(plan.items)?plan.items as Row[]:[]).map((row:Row)=>typeof row.resource_id==='string'?row.resource_id:'').filter(Boolean);
  const resources=await store.loadMediaResources(itemKeys);
  const imageCount=binding.containsImages?1:0;
  const imageBlocker=(resource:{remark:string|null;titleLimit:number|null;rawPayload:Record<string,unknown>;imageSupport:'unknown'|'verified'|'unsupported'})=>
   (imageCount>0?publisherImageCompatibilityBlocker(resource.imageSupport):null)??mediaRulesImageBlocker(resource.remark,resource.titleLimit,resource.rawPayload,imageCount);
  const diff=resolvePlanItems(current,binding,existingItems,resources,imageBlocker,{publicationIntent:input.publication_intent,asOf:new Date().toISOString(),taskId:task.taskId});
  const identity={taskId:task.taskId,planId:body.plan_id,planVersion:body.plan_version,planIndex:body.plan_index};
  const summary={status:'ok',task_id:task.taskId,plan_index:body.plan_index,draft:{id:body.draft_id,revision:body.expected_revision},...clone(diff)};
  if(body.preview||diff.overLimit){res.json(summary);return;}
  if(diff.skipped.length){res.status(409).json({...summary,status:'plan_not_applicable',message:'部分发布项未通过当前校验，未写入任何组合项'});return;}
  if(!diff.additions.length){res.json(summary);return;}
  const applied=await store.insertPlanItems({tenantId:repo.tenantId,draftId:body.draft_id,expectedRevision:body.expected_revision,additions:diff.additions,
   mediaSnapshotFor:(resource,addition)=>publicationSnapshot(resource,addition,identity),planIdentity:identity,resourceBlocker:imageBlocker});
  if(!applied.ok){res.status(409).json({status:applied.reason,message:applied.reason==='plan_changed'?'推荐方案已更新或正在重新生成，请使用当前方案重试':applied.reason==='revision_conflict'?'购物车刚被其他操作更新，请刷新后重试':'草稿状态已变化，请刷新后重试'});return;}
  res.json({...summary,draft:{id:body.draft_id,revision:applied.revision}});
 }));
 router.post('/classify/:taskId/cancel',wrap(async(req,res)=>{const repo=await repository(req),task=await repo.get(String(req.params.taskId));if(!task){res.status(404).json({status:'not_found'});return;}await repo.cancel(task.taskId);res.json({task_id:task.taskId,state:'cancelled'});}));
 router.get('/classify/:taskId/download',wrap(async(req,res)=>{
  const parsed=download.safeParse(req.query);if(!parsed.success){res.status(400).json({status:'invalid_input',message:'请同时提供有效的方案与版本标识'});return;}
  const repo=await repository(req),task=await repo.get(String(req.params.taskId));if(!task){res.status(404).json({status:'not_found'});return;}
  if(task.state==='cancelled'){res.status(409).json({status:'report_unavailable'});return;}
  const result=parsed.data.plan_id&&parsed.data.plan_version?await repo.snapshot(task.taskId,parsed.data.plan_id,parsed.data.plan_version):task.latest;
  if(!result?.report){res.status(409).json({status:'report_unavailable'});return;}
  res.setHeader('Content-Disposition','attachment; filename="source-matrix-report.json"');res.type('application/json').send(JSON.stringify(result.report,null,2));
 }));
 router.use((err:any,req:Request,res:Response,_next:NextFunction)=>{
  const missing=err?.code==='ER_NO_SUCH_TABLE'||err?.cause?.code==='ER_NO_SUCH_TABLE';
  const badBody=err?.type==='entity.parse.failed'||err?.type==='entity.too.large';
  if(badBody){res.status(err.type==='entity.too.large'?413:400).json({status:'invalid_input',message:'请求内容不是有效 JSON 或超出大小限制'});return;}
  const status=err?.status===403?403:missing?503:500;
  // Fixed diagnostic codes only: SQL, dataset values and project/tenant identifiers stay out of logs and responses.
  if(status!==403)console.warn('source_matrix_service_unavailable',{reason:missing?'storage_missing':'service_error'});
  res.status(status).json({status:missing?'configuration_required':status===403?'forbidden':'unavailable',...(req.path==='/source-distribution'?{batches:[]}:{}),message:status===403?'需要已授权企业项目':'行业信源服务暂不可用，请稍后重试'});
 });
 return router;
}
