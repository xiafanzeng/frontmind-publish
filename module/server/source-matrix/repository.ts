import { and,eq } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { sourceMatrixIndustries as industries,sourceMatrixTasks as tasks,sourceMatrixSnapshots as snapshots } from '../../schema/source-matrix.js';
import { clone,digest,type Row } from './common.js';
import { DISTRIBUTION_LIMITS,readSourceDistribution } from './distribution.js';
export class MatrixRepository {
 constructor(private db:MySql2Database<any>,readonly tenantId:string){}
 async industries(){return this.db.select({id:industries.industryId,name:industries.name}).from(industries).where(eq(industries.tenantId,this.tenantId));}
 async brandBatches(){
  const configured=await this.db.select({dataset:industries.dataset}).from(industries).where(eq(industries.tenantId,this.tenantId));
  const batches:Row[]=[];
  for(const row of configured)for(const source of Array.isArray(row.dataset?.brand_exports)?row.dataset.brand_exports:[]){
   if(!source||typeof source.id!=='string'||typeof source.sourceSha256!=='string'||!Array.isArray(source.records))continue;
   batches.push({id:source.id,label:source.label??source.sourceFile??source.id,version:source.version??source.sourceSha256,sourceFile:source.sourceFile??null,recordCount:source.records.length,period:clone(source.period??null),models:[...new Set(source.records.map((x:Row)=>x.model).filter((x:unknown)=>typeof x==='string'))]});
  }
  return batches;
 }
 /** Independent of planner tasks. Projection is the only path from trusted datasets to the public analysis view. */
 async sourceDistribution(){
  const configured=await this.db.select({industryId:industries.industryId,name:industries.name,dataset:industries.dataset}).from(industries).where(eq(industries.tenantId,this.tenantId)).limit(DISTRIBUTION_LIMITS.industries+1);
  return readSourceDistribution(configured,this.tenantId);
 }
 async industry(id:string){return (await this.db.select().from(industries).where(and(eq(industries.tenantId,this.tenantId),eq(industries.industryId,id))).limit(1))[0];}
 async create(taskId:string,industryId:string,brandId:string,task:Row){await this.db.insert(tasks).values({tenantId:this.tenantId,taskId,industryId,brandId,task,state:'running'});}
 async get(taskId:string){return (await this.db.select().from(tasks).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId))).limit(1))[0];}
 async snapshot(taskId:string,planId:string,version:string){return (await this.db.select().from(snapshots).where(and(eq(snapshots.tenantId,this.tenantId),eq(snapshots.taskId,taskId),eq(snapshots.planId,planId),eq(snapshots.planVersion,version))).limit(1))[0]?.result;}
 /** Compare-and-set protects cancellation and concurrent budget requests. */
 async begin(taskId:string,expectedPlanVersion?:string){
  return this.db.transaction(async tx=>{const current=(await tx.select().from(tasks).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId))).limit(1).for('update'))[0];if(!current||current.state!=='complete'||(expectedPlanVersion!==undefined&&current.latest?.plan_version!==expectedPlanVersion))return false;await tx.update(tasks).set({state:'running'}).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId)));return true;});
 }
 async save(taskId:string,result:Row){
  return this.db.transaction(async tx=>{
   const current=(await tx.select().from(tasks).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId))).limit(1).for('update'))[0];
   if(!current||current.state==='cancelled')return false;
   let saved=clone(result);
   const rejected=['invalid_input','invalid_decisions','stale_matrix'].includes(result.status);
   // A rejected budget decision must not strand a valid semantic matrix. Keep a
   // persisted retry revision, never any partially accepted formal/content plan.
   // Initial rejected matrix decisions have no reusable matrix and stay rejected.
   const prior=current.latest;
   if(rejected&&prior?.matrix?.status==='complete'&&prior.snapshot&&prior.scope?.input_snapshot){
    const validCurrent=result.stage==='budget'&&result.matrix?.status==='complete'&&result.snapshot&&result.scope?.input_snapshot;
    saved={...clone(validCurrent?result:prior),stage:'budget',status:result.status,errors:clone(result.errors??[]),budget_plans:[],content_plans:[],minimum_known_cost:null,retryable_budget:true,last_budget_attempt:{status:result.status,errors:clone(result.errors??[]),attempted_plan_version:result.plan_version??null}};
    saved.plan_version='plan-version-'+digest({retryOf:prior.plan_version,result:saved});
    saved.report={...clone(saved.report??{}),status:saved.status,plan_version:saved.plan_version,budget_plans:[],content_plans:[],minimum_known_cost:null,errors:clone(saved.errors),last_budget_attempt:clone(saved.last_budget_attempt)};
   }
   const reusable=saved.matrix?.status==='complete'&&(!rejected||saved.retryable_budget===true);
   if(reusable)await tx.insert(snapshots).values({tenantId:this.tenantId,taskId,planId:saved.plan_id,planVersion:saved.plan_version,result:clone(saved)}).onDuplicateKeyUpdate({set:{planId:saved.plan_id}});
   await tx.update(tasks).set({state:'complete',latest:saved}).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId)));return true;
  });
 }
 async cancel(taskId:string){await this.db.update(tasks).set({state:'cancelled'}).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId)));}
}
