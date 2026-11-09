import type { Row } from './common.js';
export interface ArticleIdentificationInput {
 article:Readonly<{title:string;body:string}>;
 industries:ReadonlyArray<Readonly<{id:string;name:string;path?:readonly string[]}>>;
 /** Candidate search scans the complete catalog before a bounded prompt is built. */
 catalogSearch?:Readonly<{total:number;matched:number;complete:boolean}>;
 signal?:AbortSignal;
}
/** Server-only seam. Host injects a real model. Never accept decisions from HTTP.
 * Prompt/task/catalog text is untrusted data, not model instructions or facts. */
export interface SourceMatrixDecisionAdapter {
 /** Host should supply a stable revision across workers and change it with model configuration. */
 identificationRevision?:string;
 /** Optional read-only four-field extraction. The route validates all output.
  * Replace the host adapter when configuration changes; honor signal where possible. */
 identify?(input:ArticleIdentificationInput):Promise<unknown>;
 /** Resume continues a persisted partial matrix: only pending candidates are
  * reviewed and the seeded decisions are merged verbatim by the adapter. */
 matrix(input:{request:Readonly<Row>;prepared:Readonly<Row>;as_of:string;skill:string;instructions:string;signal?:AbortSignal;resume?:{pending_ids:readonly string[];accepted_items:readonly Row[];excluded:readonly Row[]}}):Promise<{matrix_decisions:Row}|undefined>;
 budget(input:{request:Readonly<Row>;matrix:Readonly<Row>;as_of:string;skill:string;instructions:string}):Promise<{recommendations?:Row[];budget_plans?:Row[];content_plans?:Row[]}|undefined>;
}
