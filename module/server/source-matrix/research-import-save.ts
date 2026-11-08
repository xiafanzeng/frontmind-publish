import type { ModuleHttpCore } from '../http-api.js';
import { and,eq,lt } from 'drizzle-orm';
import { sourceMatrixResearchImports as imports } from '../../schema/source-matrix-imports.js';
import { clone,digest,type Row } from './common.js';
import { ResearchImportError,where,validateAutomatically,summary } from './research-import-core.js';
import type { ParsedResearchFile } from './research-import-parser.js';
import { RESEARCH_IMPORT_LIMITS as L } from '../../client/source-matrix/research-import-types.js';

type Scope={tenantId:string;actorId:string};
interface SaveInput {id:string;filename:string;parsed:ParsedResearchFile;selectedIds:string[];replaceId?:string;}
export interface ResearchSavePlan {dataset:Row;reused:boolean;insert?:Row;update?:Row;deleteId?:string;replacedId?:string;}

/** Pure transaction decision. Call only with the complete, locked scope rows.
 * Existing confirmed snapshots/versions are immutable, including legacy ones. */
export function planAutomaticResearchSave(s:Scope,rows:Row[],input:SaveInput):ResearchSavePlan {
 if(rows.some(row=>row.tenantId!==s.tenantId||row.actorId!==s.actorId))throw new ResearchImportError('导入数据范围不一致',409);
 const existing=rows.find(row=>row.id===input.id),reused=Boolean(existing?.status==='confirmed'&&existing.confirmed);
 if(existing?.status==='confirmed'&&!existing.confirmed)throw new ResearchImportError('已保存数据集的记录不完整，请移除后重新导入',409);
 if(existing&&existing.fingerprint!==input.parsed.fingerprint)throw new ResearchImportError('文件标识冲突，请重试或联系管理员',409);
 const replace=input.replaceId?rows.find(row=>row.id===input.replaceId):undefined;
 // An already-committed replace may be retried after its response was lost.
 // Reuse is harmless when that old scoped row is gone; no new row is deleted.
 if(input.replaceId&&!replace&&!reused)throw new ResearchImportError('待替换数据集已移除或无权访问，请刷新列表',409);
 if(replace&&replace.status!=='confirmed')throw new ResearchImportError('只能替换已保存的数据集',409);
 if(input.selectedIds.includes(input.replaceId??'')||new Set(input.selectedIds).size!==input.selectedIds.length)throw new ResearchImportError('选用数据集重复或包含待替换文件');
 const confirmed=reused?existing!.confirmed:validateAutomatically(input.parsed);
 if(!Array.isArray(confirmed?.records)||!confirmed.records.length||(!reused&&confirmed.counts?.failed))throw new ResearchImportError('没有完整通过校验的记录');
 const selected=[...new Set([...input.selectedIds,input.id])];
 if(selected.length>L.files)throw new ResearchImportError('最多选用 10 个数据集');
 let selectedRows=0;
 for(const id of selected){const row=id===input.id?{status:'confirmed',confirmed}:rows.find(item=>item.id===id);if(!row||row.status!=='confirmed'||!Array.isArray(row.confirmed?.records))throw new ResearchImportError('选用数据集已移除、未确认或无权访问，请刷新列表',409);selectedRows+=row.confirmed.records.length;}
 if(selectedRows>L.selectedRows)throw new ResearchImportError('选用数据集合计超过 10,000 条记录，请减少选择');
 const deleteId=replace&&replace.id!==input.id?replace.id:undefined;
 if(rows.length+(existing?0:1)-(deleteId?1:0)>100)throw new ResearchImportError('最多保存 100 个导入记录，请先移除旧记录',409);
 const replacement=input.replaceId?{replacedId:input.replaceId}:{};
 if(reused){
  const update:Row={},warnings=summary(existing!).warnings??[];
  if(existing!.name!==input.filename)update.name=input.filename;
  // Persist the legacy partial-sheet warning as metadata so the next list
  // request remains honest without loading/replacing immutable snapshots.
  if(digest(warnings)!==digest(existing!.metadata?.warnings??[]))update.metadata={...(existing!.metadata??{purpose:confirmed.purpose,counts:confirmed.counts}),warnings};
  return {dataset:{...existing,...update},reused:true,...(Object.keys(update).length?{update}:{}),...(deleteId?{deleteId}:{}),...replacement};
 }
 const version='research-'+digest({file:input.parsed.fingerprint,...confirmed});
 const metadata={purpose:confirmed.purpose,counts:confirmed.counts,warnings:confirmed.warnings??[]};
 const saved={...s,id:input.id,name:input.filename,fingerprint:input.parsed.fingerprint,status:'confirmed',version,parsed:clone(input.parsed),confirmed:clone(confirmed),metadata,createdAt:new Date()};
 return {dataset:saved,reused:false,...(existing?{update:{name:saved.name,status:saved.status,version:saved.version,parsed:saved.parsed,confirmed:saved.confirmed,metadata:saved.metadata,createdAt:saved.createdAt}}:{insert:saved}),...(deleteId?{deleteId}:{}),...replacement};
}

export async function saveAutomaticResearch(db:Awaited<ReturnType<ModuleHttpCore['database']>>,s:Scope,input:SaveInput,signal?:AbortSignal){
 return db.transaction(async tx=>{
  // Preserve the legacy upload retention policy now that the UI no longer
  // visits /preview. A failed import rolls this scoped cleanup back too.
  await tx.delete(imports).where(and(where(s),eq(imports.status,'preview'),lt(imports.createdAt,new Date(Date.now()-24*60*60*1000))));
  // Lock this actor/project's full primary-key range in stable order. This
  // keeps limits and same-fingerprint decisions inside the write transaction.
  const rows=await tx.select().from(imports).where(where(s)).orderBy(imports.id).limit(101).for('update');
  if(rows.length>100)throw new ResearchImportError('导入记录超过上限，请先移除旧记录',409);
  const plan=planAutomaticResearchSave(s,rows,input);
  if(signal?.aborted)throw new ResearchImportError('上传已取消',499);
  if(plan.insert)await tx.insert(imports).values(plan.insert as typeof imports.$inferInsert);
  else if(plan.update)await tx.update(imports).set(plan.update).where(where(s,input.id));
  // Never delete the prior row until validation and the new save have both
  // succeeded; a failure/abort rolls back every write in this transaction.
  if(signal?.aborted)throw new ResearchImportError('上传已取消',499);
  if(plan.deleteId)await tx.delete(imports).where(where(s,plan.deleteId));
  return plan;
 });
}
