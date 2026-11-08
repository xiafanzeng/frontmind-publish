import { digest, equal, type Row } from './common.js';

interface RecommendationIndustry { industryId: string; brandId: string; dataset: Row }

/** Stable planner identity only; this does not create a brand, media or dataset row. */
export function liveIndustryInput(canonicalId: string): RecommendationIndustry {
 return {industryId:canonicalId,brandId:'canonical-industry-'+digest({industry_id:canonicalId}),dataset:{}};
}
export function liveInputIdentity(industry: RecommendationIndustry): Row {
 return {kind:'canonical_live',version:1,brand_id:industry.brandId};
}
/** Keep a saved live task independent of subsequent legacy configuration changes.
 * Existing tasks retain their original local lookup and immutable snapshot identity. */
export async function savedIndustryInput(task: {industryId:string;brandId?:string;task:Row}, repository: {industry(id:string):Promise<RecommendationIndustry|undefined>}): Promise<RecommendationIndustry|undefined> {
 const marker=task.task?.recommendation_input;
 if(marker===undefined)return repository.industry(task.industryId);
 if(typeof task.task?.industry_id!=='string')return undefined;
 const industry=liveIndustryInput(task.task.industry_id);
 if(task.industryId!==industry.industryId||task.brandId!==industry.brandId||!equal(marker,liveInputIdentity(industry)))return undefined;
 return industry;
}
