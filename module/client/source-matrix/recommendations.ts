import type {BudgetPlan,ContentPlan,ContentPlanItem,Json,MatrixResult} from './types';

export interface Recommendation extends ContentPlan {source_index:number;legacy_kind?:'content'|'formal';formal_plan?:BudgetPlan}
const object=(value:Json):Record<string,Json>=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const stable=(value:Json):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
/** Quantity edits and refreshed quotes keep the same local owner; names never bind prices. */
export function recommendationKey(plan:ContentPlan,index:number):string {
 return JSON.stringify([index,plan.items.map(item=>[item.candidate_id,item.resource_id,item.offer_id,stable(item.publication_spec),item.purpose])]);
}
/** Old persisted tasks are read in place. Only new responses own recommendations. */
export function normalizeRecommendations(result:MatrixResult|null|undefined):Recommendation[] {
 if(!result)return [];
 if(Array.isArray(result.recommendations)&&(result.recommendations.length>0||!(result.content_plans?.length||result.budget_plans?.length)))return result.recommendations.slice(0,3).map((plan,index)=>({...plan,source_index:index}));
 const content=(result.content_plans??[]).map((plan,index):Recommendation=>({...plan,source_index:index,legacy_kind:'content'}));
 const formal=(result.budget_plans??[]).map((plan,index):Recommendation=>{
  const items:ContentPlanItem[]=plan.items.map((raw,itemIndex)=>{
   const row=object(raw),detail=plan.details?.[itemIndex],candidate=result.matrix.candidates.find(value=>row.candidate_id?value.candidate_id===row.candidate_id:!!row.resource_id&&value.resource_id===row.resource_id);
   return {candidate_id:typeof row.candidate_id==='string'?row.candidate_id:candidate?.candidate_id??'',resource_id:typeof row.resource_id==='string'?row.resource_id:null,offer_id:typeof row.offer_id==='string'?row.offer_id:null,publication_spec:row.publication_spec??null,quantity:Number(row.quantity),quantity_mode:'repeat_article',purpose:typeof row.purpose==='string'?row.purpose:'standard',content_tasks:[],unit_price:detail?.unit_price??null,cost:detail?.cost??null,known_cost:detail?.known_cost??null,pricing_status:detail?.unknown_reasons?.length?'incomplete':'known',pricing_kind:detail?.pricing_kind,currency:detail?.currency??plan.currency,mandatory_fees:detail?.mandatory_fees,unknown_reasons:detail?.unknown_reasons??[]};
  });
  return {...plan,schema_version:'recommendation/1.0',kind:'recommendation',explanation:plan.explanation??null,items,total_articles:items.every(item=>Number.isSafeInteger(item.quantity)&&item.quantity>0)?items.reduce((sum,item)=>sum+item.quantity,0):0,ready_to_publish:false,execution_recommended:false,source_index:index,legacy_kind:'formal',formal_plan:plan};
 });
 const seen=new Set<string>();
 return [...content,...formal].filter(plan=>{const key=JSON.stringify(plan.items.map(item=>[item.candidate_id,item.resource_id,item.offer_id,stable(item.publication_spec),item.quantity,item.purpose]).sort());if(seen.has(key))return false;seen.add(key);return true;}).slice(0,3);
}
