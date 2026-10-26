import { Router,json,type Request,type Response,type NextFunction } from 'express';
import multer from 'multer';
import { and,eq,lt,desc } from 'drizzle-orm';
import { z } from 'zod';
import type { ModuleHttpCore } from '../http-api.js';
import { sourceMatrixResearchImports as imports } from '../../schema/source-matrix-imports.js';
import { clone,digest } from './common.js';
import { parseResearchFile,type ParsedResearchFile } from './research-import-parser.js';
import { ResearchImportError,scope,where,summary,validate,datasetId,missingTable } from './research-import-core.js';
import { RESEARCH_IMPORT_LIMITS as L } from '../../client/source-matrix/research-import-types.js';
/**
 * Upload router for private research imports. This module owns the heavy file
 * dependencies (multer + xlsx/mammoth/jszip/pdfjs parsers); hosts load it
 * through the package boundary at request time so their bundled module surface
 * never needs these packages. Shared light logic lives in research-import-core.
 */
const mappingSchema=z.object({source_name:z.string().max(200).optional(),url:z.string().max(200).optional(),platform:z.string().max(200).optional(),question:z.string().max(200).optional(),collected_at:z.string().max(200).optional(),text:z.string().max(200).optional()}).strict();
const confirmSchema=z.object({id:z.string().uuid(),sheet:z.string().max(200),purpose:z.enum(['source','citation','context']),mapping:mappingSchema}).strict();
function preview(row:{parsed:unknown;name:string;id:string;status:string}){const parsed=row.parsed as ParsedResearchFile;return {id:row.id,name:row.name,status:row.status,sheets:parsed.sheets.map(s=>({name:s.name,columns:s.columns,recordCount:s.rows.length,sample:s.rows.slice(0,12)})),warnings:parsed.warnings};}
export function createResearchImportRouter(core:ModuleHttpCore):Router {
 const router=Router();router.use('/matrix/imports',json({limit:'128kb'}));
 router.use('/matrix/imports',(req,res,next)=>{res.setHeader('Cache-Control','private, no-store');try{scope(core,req);}catch(error){next(error);return;}if(req.method==='POST'){const origin=req.get('Origin'),host=req.get('Host');try{if(req.get('Sec-Fetch-Site')==='cross-site'||!origin||!host||new URL(origin).host!==host){res.status(403).json({status:'forbidden',message:'请从当前站点提交'});return;}}catch{res.status(403).json({status:'forbidden'});return;}}next();});
 const wrap=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
 const upload=multer({storage:multer.memoryStorage(),limits:{files:1,fileSize:L.bytes,fields:0,parts:1}}).single('file');
 router.get('/matrix/imports',wrap(async(req,res)=>{const s=scope(core,req),db=await core.database();const rows=await db.select({id:imports.id,name:imports.name,version:imports.version,status:imports.status,createdAt:imports.createdAt,metadata:imports.metadata}).from(imports).where(and(where(s),eq(imports.status,'confirmed'))).orderBy(desc(imports.createdAt)).limit(101);if(rows.length>100)throw new ResearchImportError('已保存数据集超过 100 个，请移除旧数据集后重试',409);res.json({datasets:rows.map(row=>summary({...row,metadata:row.metadata} as never)),limits:L});}));
 router.post('/matrix/imports/preview',upload,wrap(async(req,res)=>{
  const s=scope(core,req);if(!req.file)throw new ResearchImportError('请选择一个文件');const filename=req.file.originalname.replace(/[/\\\u0000-\u001f]/g,'_').slice(0,255),controller=new AbortController();
  const abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
  try{const parsed=await parseResearchFile(filename,req.file.buffer,controller.signal);if(controller.signal.aborted)return;
   const db=await core.database(),id=datasetId(s,parsed.fingerprint);
   await db.delete(imports).where(and(where(s),eq(imports.status,'preview'),lt(imports.createdAt,new Date(Date.now()-24*60*60*1000))));
   const existing=(await db.select().from(imports).where(where(s,id)).limit(1))[0];
   if(existing&&existing.status!=='removed'){res.json({...preview(existing),existing:true});return;}
   if(existing)await db.update(imports).set({status:'preview',confirmed:null,parsed:clone(parsed),version:'preview-'+digest(parsed),createdAt:new Date()}).where(where(s,id));
   else{const count=await db.select({id:imports.id}).from(imports).where(where(s)).limit(101);if(count.length>=100)throw new ResearchImportError('最多保存 100 个导入记录，请先移除旧记录',409);await db.insert(imports).values({...s,id,name:filename,fingerprint:parsed.fingerprint,status:'preview',version:'preview-'+digest(parsed),parsed:clone(parsed)}).onDuplicateKeyUpdate({set:{id}});}
   const saved=(await db.select().from(imports).where(where(s,id)).limit(1))[0];if(!saved)throw new ResearchImportError('预览保存失败，请重试',409);if(!controller.signal.aborted)res.json(preview(saved));
  }finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
 }));
 router.post('/matrix/imports/validate',wrap(async(req,res)=>{const s=scope(core,req),body=confirmSchema.safeParse(req.body);if(!body.success)throw new ResearchImportError('请检查工作表、用途和字段映射');const db=await core.database(),row=(await db.select().from(imports).where(where(s,body.data.id)).limit(1))[0];if(!row||row.status==='removed')throw new ResearchImportError('预览已失效',404);const result=validate(row.parsed as ParsedResearchFile,body.data.sheet,body.data.purpose,body.data.mapping);res.json({validation:{...result,records:undefined}});}));
 router.post('/matrix/imports/confirm',wrap(async(req,res)=>{
  const s=scope(core,req),body=confirmSchema.safeParse(req.body);if(!body.success)throw new ResearchImportError('请检查工作表、用途和字段映射');const input=body.data,db=await core.database();
  const saved=await db.transaction(async tx=>{const current=(await tx.select().from(imports).where(where(s,input.id)).limit(1).for('update'))[0];if(!current||current.status==='removed')throw new ResearchImportError('预览不存在或已移除',404);if(current.status==='confirmed')return current;
   const confirmed=validate(current.parsed as ParsedResearchFile,input.sheet,input.purpose,input.mapping);if(!confirmed.records.length)throw Object.assign(new ResearchImportError('没有有效记录，请修改用途或映射'),{details:confirmed});const version='research-'+digest({file:current.fingerprint,...confirmed}),metadata={purpose:confirmed.purpose,counts:confirmed.counts};await tx.update(imports).set({status:'confirmed',version,confirmed,metadata}).where(where(s,input.id));return {...current,status:'confirmed',version,confirmed,metadata};});
  res.json({dataset:summary(saved),validation:{...saved.confirmed,records:undefined}});
 }));
 router.post('/matrix/imports/:id/remove',wrap(async(req,res)=>{const s=scope(core,req),id=String(req.params.id);if(!z.string().uuid().safeParse(id).success)throw new ResearchImportError('数据集标识无效');const db=await core.database();await db.delete(imports).where(where(s,id));res.json({removed:true,id,message:'已移除可选数据集；已生成任务保留当时的不可变研究快照'});}));
 router.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{if(res.headersSent)return;if(missingTable(error)){res.status(503).json({status:'configuration_required',message:'研究数据存储尚未配置，请联系管理员应用导入数据迁移'});return;}if(error instanceof multer.MulterError){res.status(400).json({status:'invalid_upload',message:'每次上传一个文件，最大 8 MiB；请检查文件数量和体积'});return;}const known=error instanceof ResearchImportError;res.status(known?(error as ResearchImportError).status:400).json({status:'import_failed',message:known?(error as ResearchImportError).message:'文件无法解析或保存，请检查文件是否损坏并重试',...(known&&'details' in (error as ResearchImportError&{details?:unknown})?{validation:(error as ResearchImportError&{details:unknown}).details}:{})});});
 return router;
}
