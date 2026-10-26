import { createMediaRequirementsApi } from "./media-requirements-api.js";
import { Router, type Request } from "express";
import { createSourceMatrixRouter } from "./source-matrix/http.js";
import { createAiConnectionRouter } from "./source-matrix/ai-connection-http.js";
import type { SourceMatrixDecisionAdapter } from "./source-matrix/adapter.js";
import type { MySql2Database } from "drizzle-orm/mysql2";

/** Supplied by the host after authentication; never derive ownership from request data. */
export interface ModuleHttpCore {
 context(request:Request):{accountUserId:number;actorUserId:number;enterpriseProjectId:string|null;businessOwnerId:string;businessActorId:string};
 database():Promise<MySql2Database<any>>;
 /** Optional real LLM integration; absent returns needs_ai_decisions. */
 sourceMatrixDecisions?:SourceMatrixDecisionAdapter;
 /** Server-only runtime settings. Never return this object or secret values to the browser. */
 environment:Readonly<Record<string,string|undefined>>;
}

/** Add new module-owned APIs here. Mounted in both Dashboard and the development subdomain. */
export function createModuleHttpApi(core:ModuleHttpCore):Router {
 // Resolve a personal connection inside each authenticated planner request.
 // Preserve the original host override rather than replacing it with env config.
 const router=Router();
 const connections=createAiConnectionRouter(core);
 router.use((req,res,next)=>{
  // The upload router owns multer + parser dependencies; hosts bundle this
  // file into their own server, so load it through the package boundary at
  // request time instead of a static import that would inline those packages.
  if(req.path!=='/matrix/imports'&&!req.path.startsWith('/matrix/imports/')){next();return;}
  void import('@frontmind/module-publish/persistence/source-matrix/research-import-http')
    .then(module=>{module.createResearchImportRouter(core)(req,res,next);})
    .catch(error=>{next(error);});
 });
 router.use((req,res,next)=>req.path==='/matrix/connection'||req.path.startsWith('/matrix/connection/')?connections(req,res,next):next());
 router.use("/media-requirements", createMediaRequirementsApi(core));
 router.get("/capabilities",(req,res)=>{
  const context=core.context(req);
  res.setHeader("Cache-Control","no-store");
  res.json({module:"publish",apiVersion:1,workspaceId:context.enterpriseProjectId,
   features:["articles", "media", "quotes", "orders", "results"]});
 });
 router.use(createSourceMatrixRouter(core));
 return router;
}
