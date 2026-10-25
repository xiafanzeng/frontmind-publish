import { createMediaRequirementsApi } from "./media-requirements-api.js";
import { Router, type Request } from "express";
import { createSourceMatrixRouter } from "./source-matrix/http.js";
import { createEnvDecisionAdapter } from "./source-matrix/decisions.js";
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
 // Formal extension points: a host-injected adapter wins; otherwise the module's
 // own env-gated adapter (server-side key only) enables real model decisions.
 const decisions=core.sourceMatrixDecisions??createEnvDecisionAdapter(core.environment);
 const router=Router();
 router.use("/media-requirements", createMediaRequirementsApi(core));
 router.get("/capabilities",(req,res)=>{
  const context=core.context(req);
  res.setHeader("Cache-Control","no-store");
  res.json({module:"publish",apiVersion:1,workspaceId:context.enterpriseProjectId,
   features:["articles", "media", "quotes", "orders", "results"]});
 });
 router.use(createSourceMatrixRouter({...core,sourceMatrixDecisions:decisions}));
 return router;
}
