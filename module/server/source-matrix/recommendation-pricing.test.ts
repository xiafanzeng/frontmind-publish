import { expect,it } from 'vitest';
import { priceItems } from './budget.js';
import { priceRecommendationItems,resolveRecommendationItem } from './recommendation-pricing.js';
import type { Row } from './common.js';
const now='2026-11-09T00:00:00Z';
const item:Row={candidate_id:'resource:r',resource_id:'r',offer_id:null,publication_spec:null,quantity:3,purpose:'standard'};
const catalog:Row={resource_id:'r',source_name:'同名媒体',publication_status:'available',offer_id:null,publication_spec:null,quote_status:'terms_unconfirmed',pricing:{kind:'unit',amount:'0.10',currency:'CNY',quoted_at:null,valid_until:null,mandatory_fees:null}};
it('estimates a unique real catalogue price without inventing offer or specification ids',()=>{
 const out=priceRecommendationItems([item],[catalog],now),detail=out.details[0];
 expect(detail.unit_price).toBe('0.10');expect(detail.base_cost).toBe('0.30');expect(detail.known_cost).toBe('0.30');expect(detail.cost).toBeNull();expect(detail.known_mandatory_cost).toBeNull();
 expect(out.known_total_cost).toBe('0.30');expect(out.total_cost_known).toBe(false);expect(detail.item.offer_id).toBeNull();expect(detail.scope_notes).toContain('quote_dates_unknown');
 expect(priceItems([item],[catalog],now,false).complete).toBe(false);
});
it('charges each known fee on its real basis while preserving unknown fee scope',()=>{
 const row=structuredClone(catalog);row.pricing.mandatory_fees=[{basis:'unit',amount:'0.20'},{basis:'item',amount:'1.00'},{basis:'unknown',amount:'5.00'}];
 const detail=priceRecommendationItems([item],[row],now).details[0];
 expect(detail.base_cost).toBe('0.30');expect(detail.known_mandatory_cost).toBe('1.60');expect(detail.known_cost).toBe('1.90');expect(detail.cost).toBeNull();expect(detail.scope_notes).toContain('unresolved_fees_not_included');
 row.pricing.mandatory_fees.pop();expect(priceRecommendationItems([item],[row],now).total_cost).toBe('1.90');
});
it('rejects expired and future quotes even when the other date is missing',()=>{
 for(const date of [{valid_until:'2026-11-01T00:00:00Z'},{quoted_at:'2026-12-01T00:00:00Z'}]){
  const row={...catalog,pricing:{...catalog.pricing,...date}},out=priceRecommendationItems([item],[row],now);
  expect(out.known_total_cost).toBeNull();expect(out.details[0].unit_price).toBeNull();expect(out.details[0].unknown_reasons).toContain('quote_not_valid');
 }
});
it('never mixes currencies and never borrows a same-name resource price',()=>{
 const second={...catalog,resource_id:'other',pricing:{...catalog.pricing,currency:'USD',amount:'999.99'}};
 const out=priceRecommendationItems([item,{...item,resource_id:'other'}],[catalog,second],now);
 expect(out.currency).toBeNull();expect(out.known_total_cost).toBeNull();expect(out.errors[0].code).toBe('multiple_currencies');
 expect(priceRecommendationItems([item],[second],now).details[0].base_cost).toBeNull();
});
it('resolves only a unique priced exact resource mapping and honors explicit specifications',()=>{
 const candidate={resource_id:'r'},one={...catalog,offer_id:'a',publication_spec:'text'},two={...catalog,offer_id:'b',publication_spec:'video'},request={catalog:[one,two]};
 expect(resolveRecommendationItem(item,candidate,request,now).reason).toBe('offer_missing_or_ambiguous');
 const resolved=resolveRecommendationItem({...item,publication_spec:'text'},candidate,request,now);
 expect(resolved.item.offer_id).toBe('a');expect(resolved.item.publication_spec).toBe('text');
 expect(resolveRecommendationItem({...item,resource_id:'other'},candidate,request,now).error).toBe('resource_mapping_requires_confirmation');
});
it('keeps range bounds and an exact package estimate without manufacturing a unit price',()=>{
 const ranged={...catalog,pricing:{...catalog.pricing,kind:'range',lower_bound:'0.05',upper_bound:'0.10',mandatory_fees:[]}};
 expect(priceRecommendationItems([item],[ranged],now).details[0].lower_cost).toBe('0.15');
 const packaged={...catalog,offer_id:'pack',publication_spec:'text',pricing:{...catalog.pricing,kind:'package',amount:'9.00',mandatory_fees:[{basis:'item',amount:'1.00'}],included_items:[{resource_id:'r',publication_spec:'text',quantity:3,purpose:'standard'}]}},chosen={...item,offer_id:'pack',publication_spec:'text'};
 const out=priceRecommendationItems([chosen],[packaged],now);expect(out.total_cost).toBe('10.00');expect(out.details[0].unit_price).toBeNull();
 expect(priceRecommendationItems([{...chosen,quantity:2}],[packaged],now).known_total_cost).toBeNull();
});

it('does not add a foreign-currency fee and retains a proven known lower bound',()=>{
 const row={...catalog,pricing:{...catalog.pricing,mandatory_fees:[{basis:'item',amount:'1.00',currency:'USD'}]}};
 const detail=priceRecommendationItems([item],[row],now).details[0];
 expect(detail.known_cost).toBe('0.30');expect(detail.cost).toBeNull();expect(detail.lower_cost).toBe('0.30');expect(detail.unknown_reasons).toContain('mandatory_fee_currency_mismatch');
});
