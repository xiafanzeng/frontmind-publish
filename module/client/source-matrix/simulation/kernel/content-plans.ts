import { clone,digest,equal,issue,object,rows,stableJson,strings,text,unique,type Row } from './common.js';
import { amounts,money,validateBudget } from './contracts.js';
import { minorAmount,priceRecommendationItems,resolveRecommendationItem } from './recommendation-pricing.js';

const planFields=new Set(['strategy','reason_summary','items','explanation']);
const itemFields=new Set(['candidate_id','resource_id','offer_id','publication_spec','quantity','quantity_mode','content_tasks','purpose','quantity_reason']);
const arrayExplanation=['selection_logic','tradeoffs','fit_conditions','verification_items'];
export function explanationErrors(value:unknown,selected:string[],all:string[]):Row[] {
 const path='recommendations.explanation';
 if(!object(value))return [issue('explanation_required',path)];
 const errors:Row[]=[];
 if(Object.keys(value).some(k=>!['objective',...arrayExplanation,'content_allocation','excluded_candidates'].includes(k))||!text(value.objective))errors.push(issue('invalid_explanation',path));
 for(const key of arrayExplanation)if(!strings(value[key])||!value[key].length||!value[key].every(text))errors.push(issue('invalid_explanation',path+'.'+key));
 if(!rows(value.content_allocation)||value.content_allocation.some((x:Row)=>Object.keys(x).some(k=>!['candidate_id','responsibility','content_angle'].includes(k))||!selected.includes(x.candidate_id)||!text(x.responsibility)||!text(x.content_angle))||!equal((value.content_allocation??[]).map((x:Row)=>x.candidate_id).sort(),[...selected].sort()))errors.push(issue('allocation_must_cover_selected',path));
 if(!rows(value.excluded_candidates)||value.excluded_candidates.some((x:Row)=>Object.keys(x).some(k=>!['candidate_id','reason'].includes(k))||!all.includes(x.candidate_id)||selected.includes(x.candidate_id)||!text(x.reason))||new Set((value.excluded_candidates??[]).map((x:Row)=>x.candidate_id)).size!==(value.excluded_candidates??[]).length)errors.push(issue('invalid_excluded_candidate',path));
 return errors;
}

/** Project old saved results into recommendation decisions without mutating
 * snapshots or converting their frozen publications into execution permission. */
export function normalizeRecommendationDecisions(previous:Row):Row[] {
 const canonical=rows(previous.recommendations)?previous.recommendations:null;
 const source:{plan:Row;legacyFormal:boolean}[]=canonical?.length?canonical.map(plan=>({plan,legacyFormal:false})):[...(rows(previous.content_plans)?previous.content_plans:[]).map(plan=>({plan,legacyFormal:false})),...(rows(previous.budget_plans)?previous.budget_plans:[]).map(plan=>({plan,legacyFormal:true}))];
 const candidates:Row[]=previous.matrix?.candidates??[],quantityMode=previous.quantity_mode==='repeat_article'?'repeat_article':'new_articles';
 return source.map(({plan,legacyFormal})=>{
  const original=object(plan.decisions)?plan.decisions:plan;
  let items:Row[]=(rows(original.items)?original.items:[]).map(item=>{
   const candidate=candidates.find(c=>c.resource_id&&c.resource_id===item.resource_id),id=item.candidate_id??candidate?.candidate_id;
   return Object.fromEntries(Object.entries({...item,candidate_id:id,quantity_mode:item.quantity_mode??quantityMode,content_tasks:strings(item.content_tasks)?item.content_tasks:[],quantity_reason:text(item.quantity_reason)?item.quantity_reason:'沿用已保存组合的计划数量'}).filter(([key])=>itemFields.has(key)));
  });
  if(legacyFormal){
   // Frozen articles become planned quantities only for legacy formal records.
   // Preserve exact supplier/spec/purpose boundaries and reject oversized totals
   // later instead of truncating, splitting or changing any saved publication.
   const grouped=new Map<string,Row>(),aggregated:Row[]=[];
   for(const item of items){
    if(!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100){aggregated.push(item);continue;}
    const key=stableJson([item.resource_id,item.offer_id??null,item.publication_spec??null,item.purpose]),existing=grouped.get(key);
    if(existing){existing.quantity+=item.quantity;existing.content_tasks=unique([...existing.content_tasks,...item.content_tasks]);}
    else{grouped.set(key,item);aggregated.push(item);}
   }
   items=aggregated;
  }
  const selected=unique<string>(items.map(item=>item.candidate_id));
  const allocations=selected.map(candidate_id=>({candidate_id,responsibility:'沿用历史资源配置',content_angle:'当前稿件修改建议尚未生成'}));
  const explanation=object(original.explanation)?clone(original.explanation):{objective:original.reason_summary??'沿用历史组合',selection_logic:['沿用历史组合已保存的真实媒体配置'],content_allocation:allocations,tradeoffs:['历史记录没有完整的组合取舍说明'],excluded_candidates:[],fit_conditions:['按当前目录重新估算'],verification_items:['后续发布仍需核验实际稿件与供应商条款']};
  if(legacyFormal){
   const saved=rows(explanation.content_allocation)?explanation.content_allocation:[];
   explanation.content_allocation=allocations.map(fallback=>{
    const related=saved.filter(row=>row.candidate_id===fallback.candidate_id),responsibilities=unique(related.map(row=>row.responsibility).filter(text)),angles=unique(related.map(row=>row.content_angle).filter(text));
    return {candidate_id:fallback.candidate_id,responsibility:responsibilities.length?responsibilities.join('；'):fallback.responsibility,content_angle:angles.length?angles.join('；'):fallback.content_angle};
   });
  }
  return {strategy:original.strategy??'历史组合',reason_summary:original.reason_summary??'沿用历史资源配置并按当前目录重新估算',items,explanation};
 });
}

export function verifyRecommendations(submitted:unknown,matrix:Row,request:Row,asOf:string):{plans:Row[];errors:Row[];warnings:Row[]} {
 if(!rows(submitted))return {plans:[],errors:[issue('invalid_type','recommendations')],warnings:[]};
 if(submitted.length>3)return {plans:[],errors:[issue('too_many_plans','recommendations')],warnings:[]};
 // Only the HTTP edit adapter sets this request-owned marker after reading the
 // saved decisions. Model envelopes cannot supply it. Preserve existing slots
 // when an intentional quantity edit makes two configurations temporarily equal.
 const edit=request.quantity_edits,editItems=object(edit)&&Number.isSafeInteger(edit.plan_index)&&edit.plan_index>=0?submitted[edit.plan_index]?.items:undefined;
 const preserveEditSlots=object(edit)&&['recommendation','content'].includes(edit.plan_kind)&&rows(editItems)&&rows(edit.items)&&edit.items.length>0&&edit.items.every(change=>Number.isSafeInteger(change.item_index)&&change.item_index>=0&&Number.isSafeInteger(change.quantity)&&change.quantity>=1&&change.quantity<=100&&editItems[change.item_index]?.candidate_id===change.candidate_id&&editItems[change.item_index]?.quantity===change.quantity);
 const candidates:Row[]=matrix.matrix?.candidates??[],selectable=candidates.filter(c=>c.semantic_decision_validated&&['recommended','alternative'].includes(c.selection)),all=selectable.map(c=>c.candidate_id),errors:Row[]=[],warnings:Row[]=[],plans:Row[]=[],seen=new Set<string>();
 for(const [index,plan] of submitted.entries()){
  const start=errors.length,path=`recommendations[${index}]`;
  if(Object.keys(plan).some(k=>!planFields.has(k))||!text(plan.strategy)||!text(plan.reason_summary)||!rows(plan.items)||!plan.items.length){errors.push(issue('invalid_content_plan',path));continue;}
  const ids=unique<string>(plan.items.map((item:Row)=>item.candidate_id));
  errors.push(...explanationErrors(plan.explanation,ids,all));
  const unknown:Row[]=[],outItems:Row[]=[];
  for(const [i,item] of plan.items.entries()){
   const p=path+`.items[${i}]`,candidate=selectable.find(c=>c.candidate_id===item.candidate_id);
   if(Object.keys(item).some(k=>!itemFields.has(k))||!candidate){errors.push(issue('untrusted_content_item',p));continue;}
   if(Number.isSafeInteger(item.quantity)&&item.quantity>100){errors.push(issue('quantity_limit_exceeded',p+'.quantity','单个媒体规格的计划数量最多 100 篇；历史正式方案可继续使用原入口分别处理'));continue;}
   if(['resource_id','offer_id'].some(key=>item[key]!=null&&!text(item[key]))||(item.publication_spec!=null&&!text(item.publication_spec)&&!object(item.publication_spec))||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100||!['standard','exploration'].includes(item.purpose)||!text(item.quantity_reason)||!strings(item.content_tasks)||!item.content_tasks.every(text)){errors.push(issue('invalid_content_quantity',p));continue;}
   const expected=request.publication_intent==='repeat_existing_article'?'repeat_article':'new_articles';
   if(item.quantity_mode!==expected){errors.push(issue('quantity_intent_mismatch',p));continue;}
   const resolved=resolveRecommendationItem(item,candidate,request,asOf);
   if(resolved.error){errors.push(issue(resolved.error,p));continue;}
   const row=resolved.item,actual=candidates.find(c=>c.resource_id&&c.resource_id===row.resource_id);
   if(resolved.reason)unknown.push({candidate_id:item.candidate_id,reasons:[resolved.reason]});
   if(!actual||actual.channel_status!=='eligible')unknown.push({candidate_id:item.candidate_id,reasons:['channel_conditions_unconfirmed']});
   if(candidate.channel_status==='ineligible'||candidate.hard_failures?.length)unknown.push({candidate_id:item.candidate_id,reasons:['channel_not_eligible']});
   outItems.push(row);
  }
  if(errors.length!==start)continue;
  const identities=outItems.map(item=>stableJson([item.resource_id??'candidate:'+item.candidate_id,item.publication_spec??null]));
  if(new Set(identities).size!==identities.length){errors.push(issue('duplicate_resource_selection',path));continue;}
  const configuration=outItems.map(item=>({resource_id:item.resource_id??item.candidate_id,publication_spec:item.publication_spec??null,quantity:item.quantity,purpose:item.purpose,quantity_mode:item.quantity_mode})).sort((a,b)=>stableJson(a).localeCompare(stableJson(b)));
  const distinct=stableJson(configuration);
  if(seen.has(distinct)){
   if(!preserveEditSlots){warnings.push(issue('duplicate_recommendation_omitted',path,'相同媒体、规格和篇数的重复组合已合并'));continue;}
   warnings.push(issue('matching_recommendations_after_edit',path,'篇数调整后部分组合配置相同，已保留原有组合位置'));
  }seen.add(distinct);
  const pricing=priceRecommendationItems(outItems,request.catalog??[],asOf),planErrors:Row[]=[...pricing.errors],budget=request.budget,currency=pricing.currency??budget?.currency??'';
  if(budget)planErrors.push(...validateBudget(budget));
  const sameCurrency=!!pricing.currency&&(!budget||pricing.currency===budget.currency);
  if(pricing.currency&&budget&&pricing.currency!==budget.currency)planErrors.push(issue('currency_mismatch',path));
  const totalCap=sameCurrency?money(budget?.total_cap,currency):null,exploreCap=sameCurrency?money(budget?.exploration_cap,currency):null,total=minorAmount(pricing.known_total_cost_minor),explore=minorAmount(pricing.known_exploration_cost_minor);
  const unitMin=sameCurrency?money(budget?.unit_price_min,currency):null,unitMax=sameCurrency?money(budget?.unit_price_max,currency):null;
  if((unitMin!==null||unitMax!==null)&&pricing.details.some((detail:Row)=>detail.pricing_kind==='package'))planErrors.push(issue('package_unit_limit_unresolved',path));
  for(const detail of pricing.details){const cost=minorAmount(detail.known_cost_minor),lower=minorAmount(detail.lower_cost_minor),quantity=BigInt(detail.item.quantity);
   if(unitMin!==null){if(lower===null)planErrors.push(issue('unit_price_min_unresolved',path));else if(lower<unitMin*quantity)planErrors.push(issue('unit_price_below_min',path));}
   if(unitMax!==null&&cost!==null&&cost>unitMax*quantity)planErrors.push(issue('unit_price_above_max',path));
  }
  if(totalCap!==null&&total!==null&&total>totalCap)planErrors.push(issue('total_cap_exceeded',path));
  if(outItems.some(item=>item.purpose==='exploration')){if(budget?.exploration_enabled!==true||exploreCap===null||exploreCap<=0n)planErrors.push(issue('exploration_not_enabled',path));else if(explore!==null&&explore>exploreCap)planErrors.push(issue('exploration_cap_exceeded',path));}
  const locked=(request.selected_items??request.task?.selected_items??[]).filter((item:Row)=>item.locked===true),complete=pricing.complete&&!unknown.length&&!locked.length,feasible=complete&&!!budget&&!planErrors.length;
  const decisions={...clone(plan),items:clone(outItems)},planOut:Row={schema_version:'recommendation/1.0',kind:'recommendation',strategy:plan.strategy,reason_summary:plan.reason_summary,explanation:clone(plan.explanation),items:outItems.map((item,i)=>{
   const detail=pricing.details[i],offer=(request.catalog??[]).find((row:Row)=>row.resource_id===item.resource_id&&(row.offer_id??null)===(item.offer_id??null)&&equal(row.publication_spec??null,item.publication_spec??null));
   return {...item,...Object.fromEntries(Object.entries(detail??{}).filter(([key])=>key!=='item')),source_name:offer?.source_name??null,account_id:offer?.account_id??null,channel_id:offer?.channel_id??null};
  }),total_articles:outItems.reduce((sum,item)=>sum+item.quantity,0),currency:pricing.currency,is_estimate:true,total_cost_known:pricing.complete,remaining_is_estimate:!pricing.complete,known_total_cost:pricing.known_total_cost,known_total_cost_minor:pricing.known_total_cost_minor,total_cost:pricing.total_cost,total_cost_minor:pricing.total_cost_minor,exploration_cost:pricing.exploration_cost,exploration_cost_minor:pricing.exploration_cost_minor,known_exploration_cost:pricing.known_exploration_cost,known_exploration_cost_minor:pricing.known_exploration_cost_minor,budget_feasible:planErrors.length?false:complete?feasible:null,ready_to_publish:false,execution_recommended:false,cart_eligible:false,status:planErrors.length?'over_budget_or_invalid':feasible?'quoted_within_budget':'estimate',unknown_items:[...pricing.unknown_items,...unknown],errors:planErrors,retained_locked_items:clone(locked),scope_notes:unique([...pricing.details.flatMap((detail:Row)=>detail.scope_notes),...(locked.length?['locked_publications_require_separate_order_verification']:[])]),matrix_version:matrix.matrix_version,quantity_mode:request.publication_intent==='repeat_existing_article'?'repeat_article':'new_articles',decisions};
  // A partial balance is the budget minus known costs, never a claim that
  // unresolved fees are zero. Known over-budget costs remain visible.
  amounts(planOut,{total_cap:totalCap,total_remaining:total!==null&&totalCap!==null?totalCap-total:null,known_total_remaining:total!==null&&totalCap!==null?totalCap-total:null,exploration_cap:exploreCap,exploration_remaining:explore!==null&&exploreCap!==null?exploreCap-explore:null},currency);
  planOut.recommendation_id='recommendation-'+digest({matrix_version:matrix.matrix_version,index:plans.length,configuration:configuration.map(({quantity,...identity})=>identity).sort((a,b)=>stableJson(a).localeCompare(stableJson(b)))});
  planOut.content_plan_id=planOut.recommendation_id;plans.push(planOut);
 }
 return errors.length?{plans:[],errors,warnings}:{plans,errors,warnings};
}

/** Compatibility entry point for saved content-plan routes and callers. */
export const verifyContentPlans=verifyRecommendations;
