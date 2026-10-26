import { clone,digest,equal,issue,object,rows,stableJson,strings,text,type Row } from './common.js';
import { amounts,money,validateBudget } from './contracts.js';
import { priceItems } from './budget.js';

const planFields=new Set(['strategy','reason_summary','items','explanation']);
const itemFields=new Set(['candidate_id','resource_id','offer_id','publication_spec','quantity','quantity_mode','content_tasks','purpose','quantity_reason']);
const arrayExplanation=['selection_logic','tradeoffs','fit_conditions','verification_items'];
export function explanationErrors(value:unknown,selected:string[],all:string[]):Row[] {
 const path='content_plans.explanation';
 if(!object(value))return [issue('explanation_required',path)];
 const errors:Row[]=[];
 if(Object.keys(value).some(k=>!['objective',...arrayExplanation,'content_allocation','excluded_candidates'].includes(k))||!text(value.objective))errors.push(issue('invalid_explanation',path));
 for(const key of arrayExplanation)if(!strings(value[key])||!value[key].length||!value[key].every(text))errors.push(issue('invalid_explanation',path+'.'+key));
 if(!rows(value.content_allocation)||value.content_allocation.some((x:Row)=>Object.keys(x).some(k=>!['candidate_id','responsibility','content_angle'].includes(k))||!selected.includes(x.candidate_id)||!text(x.responsibility)||!text(x.content_angle))||!equal((value.content_allocation??[]).map((x:Row)=>x.candidate_id).sort(),[...selected].sort()))errors.push(issue('allocation_must_cover_selected',path));
 if(!rows(value.excluded_candidates)||value.excluded_candidates.some((x:Row)=>Object.keys(x).some(k=>!['candidate_id','reason'].includes(k))||!all.includes(x.candidate_id)||selected.includes(x.candidate_id)||!text(x.reason))||new Set((value.excluded_candidates??[]).map((x:Row)=>x.candidate_id)).size!==(value.excluded_candidates??[]).length)errors.push(issue('invalid_excluded_candidate',path));
 return errors;
}

/** Versioned content/quote plans, separate from executable budget_plans. No
 * article ids are fabricated just to reuse the deterministic quote calculator. */
export function verifyContentPlans(submitted:unknown,matrix:Row,request:Row,asOf:string):{plans:Row[];errors:Row[]} {
 if(!rows(submitted))return {plans:[],errors:[issue('invalid_type','content_plans')]};
 if(submitted.length>3)return {plans:[],errors:[issue('too_many_plans','content_plans')]};
 const candidates:Row[]=matrix.matrix?.candidates??[],selectable=candidates.filter(c=>c.semantic_decision_validated&&['recommended','alternative'].includes(c.selection)),all=selectable.map(c=>c.candidate_id),errors:Row[]=[],plans:Row[]=[],seen=new Set<string>();
 for(const [index,plan] of submitted.entries()){
  const start=errors.length,path=`content_plans[${index}]`;
  if(Object.keys(plan).some(k=>!planFields.has(k))||!text(plan.strategy)||!text(plan.reason_summary)||!rows(plan.items)||!plan.items.length){errors.push(issue('invalid_content_plan',path));continue;}
  const ids=plan.items.map((x:Row)=>x.candidate_id);
  if(new Set(ids).size!==ids.length)errors.push(issue('duplicate_candidate',path));
  errors.push(...explanationErrors(plan.explanation,ids,all));
  const unknown:Row[]=[],pricedItems:Row[]=[],outItems:Row[]=[];
  for(const [i,item] of plan.items.entries()){
   const p=path+`.items[${i}]`,c=selectable.find(c=>c.candidate_id===item.candidate_id);
   if(Object.keys(item).some(k=>!itemFields.has(k))||!c){errors.push(issue('untrusted_content_item',p));continue;}
   if(!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100||!['standard','exploration'].includes(item.purpose)||!text(item.quantity_reason)||!strings(item.content_tasks)||!item.content_tasks.every(text)){errors.push(issue('invalid_content_quantity',p));continue;}
   const expected=request.publication_intent==='repeat_existing_article'?'repeat_article':'new_articles';
   if(item.quantity_mode!==expected){errors.push(issue('quantity_intent_mismatch',p));continue;}
   const chosen=(request.resource_selections??[]).find((choice:Row)=>choice.candidate_id===item.candidate_id);
   const explicitMatch=chosen&&chosen.resource_id===item.resource_id&&chosen.offer_id===item.offer_id&&equal(chosen.publication_spec,item.publication_spec);
   const confirmed=(c.catalog_matches??[]).some((m:Row)=>m.resource_id===item.resource_id&&m.identity_relation==='confirmed');
   if(item.resource_id&&item.resource_id!==c.resource_id&&!explicitMatch&&!confirmed){errors.push(issue('resource_mapping_requires_confirmation',p));continue;}
   if(chosen&&!explicitMatch){errors.push(issue('selected_resource_changed',p));continue;}
   const offers:Row[]=(request.catalog??[]).filter((o:Row)=>item.resource_id&&o.resource_id===item.resource_id&&o.offer_id===item.offer_id&&equal(o.publication_spec,item.publication_spec));
   if(item.resource_id&&(!text(item.resource_id)||!text(item.offer_id)||offers.length!==1)){unknown.push({candidate_id:item.candidate_id,reasons:['offer_missing_or_ambiguous']});}
   if(expected==='new_articles'&&item.content_tasks.length!==item.quantity)unknown.push({candidate_id:item.candidate_id,reasons:['content_tasks_incomplete','new_articles_need_individual_binding']});
   if(expected==='repeat_article'&&(!request.task?.manuscripts?.length||offers[0]?.repeat_allowed!==true))unknown.push({candidate_id:item.candidate_id,reasons:['repeat_publication_not_authorized']});
   if(c.channel_status==='ineligible'||c.hard_failures?.length)unknown.push({candidate_id:item.candidate_id,reasons:['channel_not_eligible']});
   if(item.resource_id){const actual=candidates.find(x=>x.resource_id===item.resource_id);if(!actual||actual.channel_status!=='eligible')unknown.push({candidate_id:item.candidate_id,reasons:['channel_conditions_unconfirmed']});}
   const row={...clone(item),resource_id:item.resource_id??null,offer_id:item.offer_id??null,publication_spec:clone(item.publication_spec??null)};
   pricedItems.push(row);outItems.push(row);
  }
  if(errors.length!==start)continue;
  const distinct=stableJson(plan.items.map((x:Row)=>({candidate_id:x.candidate_id,resource_id:x.resource_id??null,offer_id:x.offer_id??null,publication_spec:x.publication_spec??null,quantity:x.quantity,purpose:x.purpose,content_tasks:x.content_tasks})).sort((a:Row,b:Row)=>String(a.candidate_id).localeCompare(String(b.candidate_id))));
  if(seen.has(distinct)){errors.push(issue('duplicate_content_plan',path));continue;}seen.add(distinct);
  const pricing=priceItems(pricedItems,request.catalog??[],asOf,false),planErrors:Row[]=[...pricing.errors],budget=request.budget,currency=budget?.currency??pricing.currency??'';
  if(budget)planErrors.push(...validateBudget(budget));
  if(pricing.currency&&pricing.currency!==currency)planErrors.push(issue('currency_mismatch',path));
  const totalCap=money(budget?.total_cap,currency),exploreCap=money(budget?.exploration_cap,currency),total=pricing.total_cost_minor===null?null:BigInt(pricing.total_cost_minor),explore=pricing.exploration_cost_minor===null?null:BigInt(pricing.exploration_cost_minor);
  const unitMin=money(budget?.unit_price_min,currency),unitMax=money(budget?.unit_price_max,currency);
  if((unitMin!==null||unitMax!==null)&&(request.catalog??[]).some((o:Row)=>o.pricing?.kind==='package'&&outItems.some(x=>x.resource_id===o.resource_id&&x.offer_id===o.offer_id)))planErrors.push(issue('package_unit_limit_unresolved',path));
  for(const detail of pricing.details){const cost=detail.cost_minor===null?null:BigInt(detail.cost_minor),lower=detail.lower_cost_minor===null?null:BigInt(detail.lower_cost_minor),quantity=BigInt(detail.item.quantity);if(cost===null)continue;
   if(unitMin!==null){if(lower===null)planErrors.push(issue('unit_price_min_unresolved',path));else if(lower<unitMin*quantity)planErrors.push(issue('unit_price_below_min',path));}
   if(unitMax!==null&&cost>unitMax*quantity)planErrors.push(issue('unit_price_above_max',path));
  }
  if(totalCap!==null&&total!==null&&total>totalCap)planErrors.push(issue('total_cap_exceeded',path));
  if(outItems.some(x=>x.purpose==='exploration')){if(budget?.exploration_enabled!==true||exploreCap===null||exploreCap<=0n)planErrors.push(issue('exploration_not_enabled',path));else if(explore!==null&&explore>exploreCap)planErrors.push(issue('exploration_cap_exceeded',path));}
  const locked=(request.selected_items??[]).filter((x:Row)=>x.locked===true);
  if(locked.length)unknown.push({reasons:['locked_publications_require_formal_plan'],items:clone(locked)});
  const complete=pricing.complete&&!unknown.length,feasible=complete&&!!budget&&!planErrors.length;
  const planOut:Row={schema_version:'content-planning/1.0',kind:outItems.some(x=>x.resource_id)?'quoted_content_plan':'research_content_plan',strategy:plan.strategy,reason_summary:plan.reason_summary,explanation:clone(plan.explanation),items:outItems.map((item,i)=>({...item,...Object.fromEntries(['cost','known_cost','unit_price','mandatory_fees','pricing_kind','unknown_reasons','cost_basis'].map(k=>[k,clone(pricing.details[i]?.[k]??null)])),pricing_status:pricing.details[i]?.unknown_reasons?.length?'unconfirmed':'priced'})),total_articles:outItems.reduce((sum,x)=>sum+x.quantity,0),currency,known_total_cost:pricing.known_total_cost,known_total_cost_minor:pricing.known_total_cost_minor,total_cost:pricing.total_cost,total_cost_minor:pricing.total_cost_minor,exploration_cost:pricing.exploration_cost,budget_feasible:complete?feasible:null,ready_to_publish:false,execution_recommended:false,cart_eligible:false,status:!complete?'needs_confirmation':feasible?'quoted_within_budget':'over_budget_or_invalid',unknown_items:[...pricing.unknown_items,...unknown],errors:planErrors,retained_locked_items:clone(locked),matrix_version:matrix.matrix_version,quantity_mode:request.publication_intent==='repeat_existing_article'?'repeat_article':'new_articles',decisions:clone(plan)};
  amounts(planOut,{total_cap:totalCap,total_remaining:complete&&total!==null&&totalCap!==null?totalCap-total:null,exploration_cap:exploreCap,exploration_remaining:complete&&explore!==null&&exploreCap!==null?exploreCap-explore:null},currency);
  planOut.content_plan_id='content-plan-'+digest({matrix_version:matrix.matrix_version,decisions:plan});plans.push(planOut);
 }
 return errors.length?{plans:[],errors}:{plans,errors};
}
