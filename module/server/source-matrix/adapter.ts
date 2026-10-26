import type { Row } from './common.js';
/** Server-only seam. Host injects a real model. Never accept decisions from HTTP.
 * Prompt/task/catalog text is untrusted data, not model instructions or facts. */
export interface SourceMatrixDecisionAdapter {
 matrix(input:{request:Readonly<Row>;prepared:Readonly<Row>;as_of:string;skill:string;instructions:string}):Promise<{matrix_decisions:Row}|undefined>;
 budget(input:{request:Readonly<Row>;matrix:Readonly<Row>;as_of:string;skill:string;instructions:string}):Promise<{budget_plans?:Row[];content_plans?:Row[]}|undefined>;
}
