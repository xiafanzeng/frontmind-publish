// Regression source only; no tests were executed for this delivery.
import {expect,it} from 'vitest';
import {normalizeRecommendations,recommendationKey} from './recommendations';
import {contentResourceIdentity} from './PlanningDetails';
import type {BudgetPlan,Candidate,ContentPlan,ContentPlanItem,MatrixResult} from './types';
const item={candidate_id:'c',resource_id:'resource-a',offer_id:'offer-a',publication_spec:{format:'图文'},quantity:1,purpose:'standard',content_tasks:[]} as ContentPlanItem;
const content={schema_version:'content-planning/1.0',kind:'quoted_content_plan',strategy:'旧内容组合',items:[item]} as ContentPlan;
const formal={strategy:'旧正式组合',items:[{...item,resource_id:'resource-b',offer_id:'offer-b',article_id:'article-1',version:'1'}],details:[{unit_price:'30.00',known_cost:'30.00',cost:'30.00',unknown_reasons:[]}],explanation:null,known_total_cost:'30.00',unknown_items:[],errors:[]} as unknown as BudgetPlan;
const result={matrix:{candidates:[]},content_plans:[content],budget_plans:[formal]} as unknown as MatrixResult;
it('combines historical records into one list while retaining original mutation and cart owners',()=>{
 const values=normalizeRecommendations(result);expect(values).toHaveLength(2);expect(values[0]).toMatchObject({legacy_kind:'content',source_index:0});expect(values[1]).toMatchObject({legacy_kind:'formal',source_index:0,formal_plan:formal});
});
it('prefers native recommendations and keeps historical arrays after a legacy edit',()=>{
 expect(normalizeRecommendations({...result,recommendations:[]})).toHaveLength(2);
 expect(normalizeRecommendations({...result,recommendations:[],content_plans:[],budget_plans:[]})).toEqual([]);
 const native={...content,kind:'recommendation',schema_version:'recommendation/1.0',recommendation_id:'native'} as ContentPlan;
 expect(normalizeRecommendations({...result,recommendations:[native]})).toEqual([{...native,source_index:0}]);
});
it('keeps a draft owner across quantity/quote refreshes while separating combinations and specs',()=>{
 expect(recommendationKey(content,0)).toBe(recommendationKey({...content,items:[{...item,quantity:3,unit_price:'40.00'}]},0));
 expect(recommendationKey(content,0)).not.toBe(recommendationKey(content,1));expect(recommendationKey(content,0)).not.toBe(recommendationKey({...content,items:[{...item,publication_spec:'视频'}]},0));
});
it('reads the selected real account and specification, never another same-name account',()=>{
 const candidate={candidate_id:'c',resource_id:null,attributes:{source_name:'同名媒体'},catalog_matches:[{resource_id:'resource-a',source_name:'同名媒体',account_id:'甲账号',offers:[{offer_id:'offer-a',publication_spec:{format:'图文'}}]},{resource_id:'resource-b',source_name:'同名媒体',account_id:'乙账号',offers:[{offer_id:'offer-b',publication_spec:'视频'}]}]} as unknown as Candidate;
 expect(contentResourceIdentity(item,candidate).account).toBe('甲账号');expect(contentResourceIdentity({...item,offer_id:'offer-b'},candidate).account).toBeUndefined();
});
