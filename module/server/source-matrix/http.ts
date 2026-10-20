import { randomUUID } from 'node:crypto';
import { Router,json,type Request,type Response,type NextFunction } from 'express';
import { z } from 'zod';
import type { ModuleHttpCore } from '../http-api.js';
import { digest,clone,issue,type Row } from './common.js';
import { validateBudget } from './contracts.js';
import { runPlanner } from './planner.js';
import { SOURCE_MATRIX_SKILL,SOURCE_MATRIX_INSTRUCTIONS } from './instructions.js';
import { MatrixRepository } from './repository.js';
const start=z.object({industry_id:z.string().min(1).max(80),questions:z.array(z.string().trim().min(1).max(2000)).min(1).max(50),product:z.string().max(2000).optional(),audience:z.string().max(2000).optional(),regions:z.array(z.string().min(1).max(200)).max(50).optional(),as_of:z.string()}).strict();
const budget=z.object({plan_id:z.string().regex(/^plan-[a-f0-9]{24}$/),plan_version:z.string().regex(/^plan-version-[a-f0-9]{24}$/),budget:z.record(z.string(),z.unknown()),selected_candidate_ids:z.array(z.string().max(200)).max(500).optional(),as_of:z.string()}).strict();
function datasetRequest(dataset:Row,task:Row,tenantId:string,taskId:string,brandId:string):Row {
 // Fixed allowlist: config cannot overwrite server identity or user task goals.
 return {tenant_id:tenantId,task_id:taskId,brand_id:brandId,task:{...clone(task),...(dataset.manuscripts?{manuscripts:clone(dataset.manuscripts)}:{}),...(dataset.requirements?{requirements:clone(dataset.requirements)}:{})},catalog:clone(dataset.catalog??[]),citations:clone(dataset.citations??[]),scope:{...clone(dataset.scope??{}),tenant_id:tenantId},identity_config:clone(dataset.identity_config??{}),industry_recommendations:clone(dataset.industry_recommendations??[]),selected_items:clone(dataset.selected_items??[])};
}
export function createSourceMatrixRouter(core:ModuleHttpCore):Router {
 const router=Router();router.use(json({limit:'256kb'}));
 const wrap=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
 async function repository(req:Request){const c=core.context(req);if(!c.enterpriseProjectId||!c.businessOwnerId)throw Object.assign(new Error('需要已授权企业项目'),{status:403});
  // Opaque tenant boundary derives exclusively from authenticated project + business owner.
  return new MatrixRepository(await core.database(),'publish-'+digest({project:c.enterpriseProjectId,owner:c.businessOwnerId}));}
 router.use((req,res,next)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method==='POST'){
   const origin=req.get('Origin'),host=req.get('Host');
   if(req.get('Sec-Fetch-Site')==='cross-site'||!origin||!host){res.status(403).json({status:'forbidden',errors:[issue('same_origin_required','$','请从当前站点提交')]});return;}
   try{if(new URL(origin).host!==host){res.status(403).json({status:'forbidden'});return;}}catch{res.status(403).json({status:'forbidden'});return;}
  }next();
 });
 router.get('/industries',wrap(async(req,res)=>{
  const repo=await repository(req),items=await repo.industries();res.json({status:items.length?'configured':'configuration_required',industries:items,message:items.length?null:'行业数据尚未配置，请联系运营接入真实行业、媒体与报价'});
 }));
 router.post('/matrix/generate',wrap(async(req,res)=>{
  const parsed=start.safeParse(req.body);if(!parsed.success){res.status(400).json({status:'invalid_input',errors:parsed.error.issues});return;}
  const body=parsed.data,repo=await repository(req),industry=await repo.industry(body.industry_id);
  if(!industry){res.status(409).json({status:'configuration_required',message:'所选行业未配置或无权访问'});return;}
  const taskId=randomUUID(),task:Row={industry:industry.name,questions:body.questions.map((text,i)=>({question_id:'question-'+digest({text,index:i}),text})),...(body.product?{product:body.product}:{}),...(body.audience?{audience:body.audience}:{}),...(body.regions?.length?{regions:body.regions}:{})};
  const request=datasetRequest(industry.dataset,task,repo.tenantId,taskId,industry.brandId),prepared=runPlanner(request,undefined,'matrix',undefined,body.as_of);
  if(prepared.status==='invalid_input'){res.status(400).json(prepared);return;}
  await repo.create(taskId,industry.industryId,industry.brandId,task);
  res.status(202).json({task_id:taskId,state:'running',result:prepared});
  void (async()=>{
  let result=prepared;
  try{if(core.sourceMatrixDecisions){const d=await core.sourceMatrixDecisions.matrix({request:clone(request),prepared:clone(prepared),as_of:body.as_of,skill:SOURCE_MATRIX_SKILL,instructions:SOURCE_MATRIX_INSTRUCTIONS});if(d)result=runPlanner(request,d,'matrix',undefined,body.as_of);}}
  catch{result={...prepared,limitations:[...prepared.limitations,'decision_adapter_unavailable']};}
  if(result.report)result.report.limitations=clone(result.limitations);
  await repo.save(taskId,result);
  })().catch(async()=>{await repo.save(taskId,{...prepared,limitations:[...prepared.limitations,'result_persistence_failed']}).catch(()=>undefined);});
 }));
 router.post('/classify/:taskId/budget',wrap(async(req,res)=>{
  const parsed=budget.safeParse(req.body);if(!parsed.success){res.status(400).json({status:'invalid_input',errors:parsed.error.issues});return;}
  const body=parsed.data,errors=validateBudget(body.budget);if(errors.length){res.status(400).json({status:'invalid_input',errors});return;}
  const repo=await repository(req),task=await repo.get(String(req.params.taskId));if(!task){res.status(404).json({status:'not_found'});return;}
  const previous=await repo.snapshot(task.taskId,body.plan_id,body.plan_version);if(!previous){res.status(409).json({status:'needs_matrix',message:'请先生成并校验信源矩阵'});return;}
  const industry=await repo.industry(task.industryId);if(!industry){res.status(409).json({status:'configuration_required',message:'原行业配置不可用'});return;}
  const request={...datasetRequest(industry.dataset,task.task,repo.tenantId,task.taskId,industry.brandId),budget:body.budget};
  // User choices are preferences, not trusted locks or forced publication quantities.
  const ids=body.selected_candidate_ids??[];
  if(ids.some(id=>!previous.matrix.candidates.some((c:Row)=>c.candidate_id===id))){res.status(400).json({status:'invalid_input',message:'所选来源不属于原矩阵'});return;}
  const precheck=runPlanner(request,undefined,'budget',previous,body.as_of);
  if(['stale_matrix','invalid_input','needs_matrix'].includes(precheck.status)){res.status(409).json({result:precheck});return;}
  if(!await repo.begin(task.taskId)){res.status(409).json({status:'task_busy_or_cancelled',message:'任务正在处理或已取消'});return;}
  res.status(202).json({task_id:task.taskId,state:'running',result:precheck});
  void (async()=>{
  let result=precheck;
  try{if(core.sourceMatrixDecisions){const d=await core.sourceMatrixDecisions.budget({request:clone({...request,selection_preferences:ids}),matrix:clone(previous),as_of:body.as_of,skill:SOURCE_MATRIX_SKILL,instructions:SOURCE_MATRIX_INSTRUCTIONS});if(d)result=runPlanner(request,d,'budget',previous,body.as_of);}}
  catch{result={...precheck,limitations:[...precheck.limitations,'decision_adapter_unavailable']};}
  if(result.report)result.report.limitations=clone(result.limitations);
  await repo.save(task.taskId,result);
  })().catch(async()=>{await repo.save(task.taskId,{...precheck,limitations:[...precheck.limitations,'result_persistence_failed']}).catch(()=>undefined);});
 }));
 router.get('/classify/:taskId',wrap(async(req,res)=>{const repo=await repository(req),task=await repo.get(String(req.params.taskId));if(!task){res.status(404).json({status:'not_found'});return;}res.json({task_id:task.taskId,state:task.state,result:task.state==='cancelled'?null:task.latest});}));
 router.post('/classify/:taskId/cancel',wrap(async(req,res)=>{const repo=await repository(req),task=await repo.get(String(req.params.taskId));if(!task){res.status(404).json({status:'not_found'});return;}await repo.cancel(task.taskId);res.json({task_id:task.taskId,state:'cancelled'});}));
 router.get('/classify/:taskId/download',wrap(async(req,res)=>{
  const repo=await repository(req),task=await repo.get(String(req.params.taskId));if(!task){res.status(404).json({status:'not_found'});return;}
  if(task.state==='cancelled'||!task.latest?.report){res.status(409).json({status:'report_unavailable'});return;}
  res.setHeader('Content-Disposition','attachment; filename="source-matrix-report.json"');res.type('application/json').send(JSON.stringify(task.latest.report,null,2));
 }));
 router.use((err:any,_req:Request,res:Response,_next:NextFunction)=>{
  const missing=err?.code==='ER_NO_SUCH_TABLE'||err?.cause?.code==='ER_NO_SUCH_TABLE';
  const badBody=err?.type==='entity.parse.failed'||err?.type==='entity.too.large';
  if(badBody){res.status(err.type==='entity.too.large'?413:400).json({status:'invalid_input',message:'请求内容不是有效 JSON 或超出大小限制'});return;}
  const status=err?.status===403?403:missing?503:500;
  res.status(status).json({status:missing?'configuration_required':status===403?'forbidden':'unavailable',message:missing?'信源规划存储尚未配置，请联系管理员完成模块迁移':status===403?'需要已授权企业项目':'信源规划服务暂不可用，请稍后重试'});
 });
 return router;
}
