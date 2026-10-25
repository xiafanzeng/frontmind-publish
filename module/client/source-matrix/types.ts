export type Json = null|boolean|number|string|Json[]|{[key:string]:Json};
export type EvidenceScope=Record<string,Json>;
export interface Issue {code:string;path:string;message:string}
export interface Offer {offer_id?:string;publication_spec?:Json;pricing?:{kind?:string;amount?:string|number;upper_bound?:string|number;currency?:string}}
export interface Candidate {
 candidate_id:string;resource_id:string|null;attributes:Record<string,Json>;offers:Offer[];primary_role:string|null;auxiliary_roles:string[];selection:string;matched_questions:string[];reason_summary?:string;reason_details?:string[];unconfirmed_items?:string[];references?:Json[];channel_status:string;manuscript_status:string;hard_failures:string[];pending_conditions:string[];evidence_relation:string;evidence_ids:string[];aggregate_ids:string[];
}
export interface Analysis {
 status:string;known_detail_count:number;total_citations:number|null;groups:Array<{scope:EvidenceScope;known_detail_count:number;total_citations:number|null}>;
 actual_sources:Array<{scope:EvidenceScope;identity:Record<string,Json>;status:string;domain:string;count:number|null;share:number|null;evidence_ids:string[]}>;
 domain_rollups:Array<{scope:EvidenceScope;domain:string;count:number|null;share:number|null}>;
 detail_citations:Array<{scope:EvidenceScope;normalized_url:string;evidence_ids:string[];status:string;record:Record<string,Json>}>;
 external_aggregates:Json[];supplier_claims:Json[];unknown_records:Json[];content_age:Json;
}
export interface BudgetPlan {
 details?:Array<{item:Json;currency:string|null;cost:string|null;known_cost:string|null;unknown_reasons:string[]}>;
 strategy:string;reason_summary:string;status:string;currency:string|null;total_cost:string|null;exploration_cost:string|null;known_total_cost:string|null;total_cap:string|null;total_remaining:string|null;exploration_remaining:string|null;exploration_cap?:string|null;budget_feasible:boolean;manuscript_status:string;ready_to_publish:boolean;execution_recommended:boolean;is_estimate:boolean;unknown_items:Json[];items:Json[];errors:Issue[];semantic_pending:Json[];
}
export interface MatrixResult {
 status:string;plan_id:string;plan_version:string;matrix_version:string;as_of:string;
 scope:{task:Record<string,Json>;evidence_scope:EvidenceScope};
 matrix:{status:string;candidates:Candidate[];layers:Array<{role:string;display_name:string;status:string;candidate_ids:string[];auxiliary_candidate_ids:string[];reason_summary?:string}>;fit_order:string[]};
 source_analysis:Analysis;budget_plans:BudgetPlan[];limitations:string[];warnings:Issue[];errors:Issue[];minimum_known_cost:Json;
}
export interface TaskResponse {task_id?:string;state?:string;result?:MatrixResult|null;status?:string;message?:string;errors?:Issue[]}
/** Server-verified binding recorded inside result.scope.task.binding. */
export interface ServerBinding {draft_id:string|null;article_version_id:string;article_id:string;version_number:number;content_hash:string;article_title:string;fingerprint:string;bound_at?:string}
export interface ApplyPlanDiff {
 status:'ok';task_id:string;plan_index:number;draft:{id:string;revision:number};
 additions:Array<{mediaResourceId:string;name:string;externalResourceId:string;priceTenThousandths:string;offerId:string|null;publicationSpec:Json;purpose:string|null;reason:string|null}>;
 alreadySelected:Array<{mediaResourceId:string;name:string;reason:string}>;
 skipped:Array<{key:string;reason:string}>;
 overLimit:boolean;mergedCount:number;knownTotalTenThousandths:string|null;pendingPriced:number;
}
