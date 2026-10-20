import { and,eq } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { sourceMatrixIndustries as industries,sourceMatrixTasks as tasks,sourceMatrixSnapshots as snapshots } from '../../schema/source-matrix.js';
import { clone,type Row } from './common.js';
export class MatrixRepository {
 constructor(private db:MySql2Database<any>,readonly tenantId:string){}
 async industries(){return this.db.select({id:industries.industryId,name:industries.name}).from(industries).where(eq(industries.tenantId,this.tenantId));}
 async industry(id:string){return (await this.db.select().from(industries).where(and(eq(industries.tenantId,this.tenantId),eq(industries.industryId,id))).limit(1))[0];}
 async create(taskId:string,industryId:string,brandId:string,task:Row){await this.db.insert(tasks).values({tenantId:this.tenantId,taskId,industryId,brandId,task,state:'running'});}
 async get(taskId:string){return (await this.db.select().from(tasks).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId))).limit(1))[0];}
 async snapshot(taskId:string,planId:string,version:string){return (await this.db.select().from(snapshots).where(and(eq(snapshots.tenantId,this.tenantId),eq(snapshots.taskId,taskId),eq(snapshots.planId,planId),eq(snapshots.planVersion,version))).limit(1))[0]?.result;}
 /** Compare-and-set protects cancellation and concurrent budget requests. */
 async begin(taskId:string){
  return this.db.transaction(async tx=>{const current=(await tx.select().from(tasks).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId))).limit(1).for('update'))[0];if(!current||current.state!=='complete')return false;await tx.update(tasks).set({state:'running'}).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId)));return true;});
 }
 async save(taskId:string,result:Row){
  return this.db.transaction(async tx=>{
   const current=(await tx.select().from(tasks).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId))).limit(1).for('update'))[0];
   if(!current||current.state==='cancelled')return false;
   // Only authentic, wholly validated matrix results become reusable revisions.
   if(result.matrix?.status==='complete'&&!['invalid_input','invalid_decisions','stale_matrix'].includes(result.status))await tx.insert(snapshots).values({tenantId:this.tenantId,taskId,planId:result.plan_id,planVersion:result.plan_version,result:clone(result)}).onDuplicateKeyUpdate({set:{planId:result.plan_id}});
   await tx.update(tasks).set({state:'complete',latest:clone(result)}).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId)));return true;
  });
 }
 async cancel(taskId:string){await this.db.update(tasks).set({state:'cancelled'}).where(and(eq(tasks.tenantId,this.tenantId),eq(tasks.taskId,taskId)));}
}
