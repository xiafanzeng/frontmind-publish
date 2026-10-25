import savedDemo from '../../server/source-matrix/demo/yihang-demo.json';
import type {Candidate,Json,MatrixResult} from './types';

/** This public, offline-generated snapshot is not a server task or a saleable plan. */
export interface ResearchCombination {
 combination_id:string;strategy:string;reason_summary:string;candidate_ids:string[];
 purpose_by_candidate:Record<string,string>;usage_by_candidate:Record<string,'reference'|'publication_research'>;coverage:string[];gaps:string[];tradeoffs:string[];unconfirmed_items:string[];
 status:'research_draft';currency:'CNY';total_cap:string;exploration_cap:string|null;
 total_cost:null;total_remaining:null;budget_feasible:null;ready_to_publish:false;execution_recommended:false;
 errors:Array<{code:string;path:string;message:string}>;
}
export interface SavedMatrixDemo {
 schemaVersion:1;generatedAt:string;research_revision:string;
 source:{file:string;sha256:string;period:{start:string;end:string};recordCount:number;groupCount:number;contentUrlCount:number;models?:string[]};
 assumptions:Array<{field:string;label:string;value:Json}>;
 form:{product:string;industry:string;region:string;audience:string;publicationHours:string;materialRequirement:string;brandDataBatchId:string;platforms:string[];questions:string[];budget:string;explorationEnabled:boolean;explorationCap:string};
 result:MatrixResult;research_combinations:ResearchCombination[];
}
export const matrixDemo=savedDemo as unknown as SavedMatrixDemo;
export function assumptionName(item:SavedMatrixDemo['assumptions'][number]) {
 return ({product:'品牌 / 产品',industry:'目标行业',audience:'目标受众',regions:'覆盖地区',questions:'目标问题',budget:'投放预算',requirements:'时效与素材要求'} as Record<string,string>)[item.field]??item.label;
}
export interface DemoFormState {industryLabel:string;product:string;audience:string;regions:string;questions:string;hours:string;assetKind:string;samplePlatform:string;brandData:string}
const lines=(value:string,separator:string)=>value.split(separator).map(item=>item.trim()).filter(Boolean);
export function demoSemanticKey(value:DemoFormState) {
 return JSON.stringify([value.industryLabel.trim(),value.product.trim(),value.audience.trim(),lines(value.regions,'、'),lines(value.questions,'\n'),value.hours.trim(),value.assetKind,value.samplePlatform,value.brandData]);
}
export function demoInitialForm(demo:SavedMatrixDemo):DemoFormState {
 const form=demo.form;
 return {industryLabel:form.industry,product:form.product,audience:form.audience,regions:form.region,questions:form.questions.join('\n'),hours:String(form.publicationHours??''),assetKind:form.materialRequirement,samplePlatform:form.platforms.length===1?form.platforms[0]??'':'',brandData:form.brandDataBatchId};
}
export function demoBudgetMatches(demo:SavedMatrixDemo,value:{currency:string;total:string;enabled:boolean;exploration:string;min:string;max:string}) {
 const sameAmount=(left:string,right:string)=>/^\d+(?:\.\d{1,2})?$/.test(left)&&Number(left)===Number(right);
 return value.currency==='CNY'&&sameAmount(value.total,demo.form.budget)&&value.enabled===demo.form.explorationEnabled&&(!value.enabled||sameAmount(value.exploration,demo.form.explorationCap))&&!value.min.trim()&&!value.max.trim();
}
export function researchMembers(combination:ResearchCombination|undefined,candidates:Candidate[]) {
 if(!combination)return [];
 const byId=new Map(candidates.map(candidate=>[candidate.candidate_id,candidate]));
 return [...new Set(combination.candidate_ids)].flatMap(id=>{const candidate=byId.get(id);return candidate?[candidate]:[];});
}
