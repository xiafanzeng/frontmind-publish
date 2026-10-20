import { clone,equal,issue,object,rows,stableJson,timestamp,unique,type Row,type Issue } from './common.js';
import { amounts,money,precision,validateBudget } from './contracts.js';
const identity=['article_id','version','resource_id','publication_spec','quantity'];
export const publicationKey=(r:Row,quantity=true)=>stableJson(Object.fromEntries((quantity?identity:identity.slice(0,-1)).map(k=>[k,r[k]??null])));
function validRows(value:unknown):value is Row[] {
  return rows(value)&&value.every(r=>['resource_id','offer_id','purpose','article_id','version'].every(k=>r[k]==null||typeof r[k]==='string')&&(r.publication_spec==null||typeof r.publication_spec==='string'||object(r.publication_spec)));
}
function invalid(path:string):Row {
 const out:Row={items:[],details:[],unknown_items:[{path,reasons:['invalid_type']}],errors:[issue('invalid_type',path)],currency:null,complete:false,budget_feasible:false,ready_to_publish:false,status:'estimate',is_estimate:true};
 amounts(out,Object.fromEntries(['total_cost','exploration_cost','known_total_cost','known_exploration_cost','total_cap','exploration_cap','total_remaining','exploration_remaining'].map(k=>[k,null])),'');return out;
}
export function priceItems(items:Row[],catalog:Row[],asOf:string):Row {
  if(!validRows(items))return invalid('items');if(!validRows(catalog))return invalid('catalog');
  for(const c of catalog)if(c.pricing!=null&&(!object(c.pricing)||(c.pricing.currency!=null&&typeof c.pricing.currency!=='string')||(c.pricing.included_items!=null&&!validRows(c.pricing.included_items))))return invalid('catalog.pricing');
  const errors:Issue[]=[],dedup=new Map<string,Row>();
  for(const original of items){const row=clone(original),key=publicationKey(row),prior=dedup.get(key);
    if(prior){if(!equal([prior.offer_id,prior.purpose],[row.offer_id,row.purpose]))errors.push(issue('conflicting_publication','items'));prior.locked=!!(prior.locked||row.locked);}else dedup.set(key,row);}
  const chosen=[...dedup.values()],details:Row[]=[],unknown:Row[]=[],currencies=new Set<string>(),charged=new Set<string>();
  let total=0n,exploration=0n;
  for(const [index,row] of chosen.entries()){
    const reasons:string[]=[],q=Number.isSafeInteger(row.quantity)&&row.quantity>0?BigInt(row.quantity):null;
    if(q===null)reasons.push('quantity_required_positive_integer');
    if(identity.slice(0,-1).some(k=>row[k]==null||row[k]===''||equal(row[k],{})))reasons.push('publication_identity_incomplete');
    if(!['standard','exploration'].includes(row.purpose))reasons.push('purpose_required');
    const matches=unique(catalog.filter(o=>row.offer_id&&o.offer_id===row.offer_id&&o.resource_id===row.resource_id)),offer=matches.length===1?matches[0]!:{};
    if(matches.length!==1)reasons.push('offer_missing_or_ambiguous');
    if(!equal(offer.publication_spec,row.publication_spec))reasons.push('offer_spec_mismatch');
    if('allowed_purposes' in offer){const a=offer.allowed_purposes;if(!Array.isArray(a)||!a.length||a.some(x=>!['standard','exploration'].includes(x)))reasons.push('allowed_purposes_invalid');else if(!a.includes(row.purpose))reasons.push('purpose_not_allowed');}
    const p:Row=object(offer.pricing)?offer.pricing:{},currency=p.currency;
    if(typeof currency==='string'&&precision[currency]!==undefined)currencies.add(currency);else reasons.push('currency_unknown');
    try{if(!(timestamp(p.quoted_at)<=timestamp(asOf)&&timestamp(asOf)<=timestamp(p.valid_until)))reasons.push('quote_not_valid');}catch{reasons.push('quote_dates_unknown');}
    const kind=p.kind,pack=kind==='package',base=money(kind==='range'?p.upper_bound:p.amount,currency),lower=kind==='range'?money(p.lower_bound,currency):base;
    if(base===null)reasons.push('price_unknown');
    if(kind==='range'&&'lower_bound' in p&&(lower===null||base===null||lower>base))reasons.push('range_bounds_invalid');
    if(!['unit','range','package'].includes(kind))reasons.push('pricing_rule_unknown');
    if(pack){const group=chosen.filter(r=>r.offer_id===row.offer_id);
      if(unique(group.map(r=>r.resource_id)).length!==1||catalog.some(o=>o.offer_id===row.offer_id&&o.resource_id!==row.resource_id))reasons.push('package_cross_resource_unresolved');
      if(!rows(p.included_items)||!p.included_items.length||!equal(p.included_items.map(r=>publicationKey(r)).sort(),group.map(r=>publicationKey(r)).sort()))reasons.push('package_members_unresolved');
      if(unique(group.map(r=>r.purpose)).length!==1)reasons.push('package_purpose_allocation_unknown');
    }
    const multiplier=pack?1n:q;let known=base!==null&&multiplier!==null?base*multiplier:0n;
    if(!Array.isArray(p.mandatory_fees))reasons.push('mandatory_fees_unknown');
    for(const fee of Array.isArray(p.mandatory_fees)?p.mandatory_fees:[]){
      if(!object(fee)){reasons.push('mandatory_fee_unknown');continue;}
      const amount=money(fee.amount,currency),multiple=fee.basis==='item'?1n:fee.basis==='unit'&&!pack?q:null;
      if(amount===null||multiple===null)reasons.push('mandatory_fee_unknown');else known+=amount*multiple;
    }
    if(reasons.some(r=>['quote_not_valid','quote_dates_unknown','offer_spec_mismatch','package_members_unresolved','pricing_rule_unknown','package_cross_resource_unresolved'].includes(r)))known=0n;
    if(pack){if(charged.has(row.offer_id))known=0n;charged.add(row.offer_id);}
    const detail:Row={item:clone(row),currency:currency??null,unknown_reasons:reasons,cost_basis:kind==='range'?'confirmed_upper_bound':'exact'};
    amounts(detail,{cost:reasons.length?null:known,known_cost:known,lower_cost:!reasons.length&&base!==null&&lower!==null&&multiplier!==null?known-(base-lower)*multiplier:null},currency);details.push(detail);
    if(reasons.length){unknown.push({item:clone(row),reasons});for(const reason of reasons)if(['quantity_required_positive_integer','purpose_required'].includes(reason))errors.push(issue(reason,`items[${index}]`));}
    total+=known;if(row.purpose==='exploration')exploration+=known;
  }
  const currency=currencies.size===1?[...currencies][0]!:null;
  if(currencies.size>1)errors.push(issue('multiple_currencies','items'));
  const complete=!!chosen.length&&!errors.length&&!unknown.length,out:Row={items:chosen,details,unknown_items:unknown,errors,currency,complete,status:complete?'complete':'estimate',is_estimate:!complete||details.some(d=>d.cost_basis==='confirmed_upper_bound')};
  amounts(out,{total_cost:complete?total:null,exploration_cost:!errors.length&&!unknown.some(x=>x.item.purpose==='exploration')?exploration:null,known_total_cost:currencies.size<=1?total:null,known_exploration_cost:currencies.size<=1?exploration:null},currency??'');
  return out;
}
const minor=(v:unknown):bigint|null=>typeof v==='string'&&/^-?\d+$/.test(v)?BigInt(v):null;
export function verifyPlan(plan:Row,matrix:Row,r:Row,asOf:string):Row {
  const errors:Issue[]=[],selected:Row[]=r.selected_items??r.task.selected_items??[];
  if(!validRows(selected)||!validRows(plan.items))return invalid('items');
  const locked=selected.filter(x=>x.locked===true);let choices:Row[]=clone(plan.items);
  choices=choices.filter(row=>{if(locked.some(s=>publicationKey(s,false)===publicationKey(row,false))&&!locked.some(s=>publicationKey(s)===publicationKey(row))){errors.push(issue('locked_selection_changed','items'));return false;}return true;});
  for(const trusted of selected){const related=choices.filter(x=>publicationKey(x,!!trusted.locked)===publicationKey(trusted,!!trusted.locked));
    for(const x of related)if(x.offer_id!==trusted.offer_id)errors.push(issue('selected_offer_changed','items'));
    if(trusted.locked){
      if(!related.length)errors.push(issue('locked_selection_removed','items','锁定项已保留，请明确包含锁定发布项'));
      if(related.some(x=>x.offer_id!==trusted.offer_id||x.purpose!==trusted.purpose))errors.push(issue('locked_selection_changed','items'));
      choices=choices.filter(x=>publicationKey(x)!==publicationKey(trusted));choices.push(clone(trusted));
    }else if(trusted.purpose==='exploration')for(const x of related)if(x.purpose!=='exploration'){errors.push(issue('exploration_relabel','items'));x.purpose='exploration';}
  }
  const candidates:Row[]=matrix.matrix.candidates,catalog:Row[]=r.catalog??[],out=priceItems(choices,catalog,asOf);errors.push(...out.errors);
  const prechecks:Row[]=[];
  out.items.forEach((row:Row,i:number)=>{
    const c=candidates.find(c=>c.resource_id&&c.resource_id===row.resource_id);
    if(!c)errors.push(issue('outside_matrix',`items[${i}]`));else if(c.channel_status!=='eligible')errors.push(issue('channel_not_eligible',`items[${i}]`));
    const checks:Row[]=(c?.manuscript_checks??[]).filter((x:Row)=>x.article_id===row.article_id&&x.version===row.version);
    const status=checks.some(x=>x.status==='failed')?'failed':checks.length&&checks.every(x=>x.status==='passed')?'passed':'needs_manuscript_check';
    prechecks.push({article_id:row.article_id,version:row.version,resource_id:row.resource_id,status});
  });
  const b:Row|undefined=r.budget,currency=b?.currency??out.currency??'',caps:Record<string,bigint|null>={};
  if(b){errors.push(...validateBudget(b));for(const k of ['total_cap','exploration_cap','unit_price_min','unit_price_max'])caps[k]=money(b[k],currency);
    if(out.currency&&out.currency!==currency)errors.push(issue('currency_mismatch','budget'));
    if(out.items.some((x:Row)=>x.purpose==='exploration')&&(b.exploration_enabled!==true||!(caps.exploration_cap&&caps.exploration_cap>0n)))errors.push(issue('exploration_not_enabled','budget'));
    if((caps.unit_price_min!==null||caps.unit_price_max!==null)&&catalog.some(o=>o.pricing?.kind==='package'&&out.items.some((x:Row)=>x.offer_id===o.offer_id)))errors.push(issue('package_unit_limit_unresolved','budget'));
    for(const d of out.details){const cost=minor(d.cost_minor),q=Number.isSafeInteger(d.item.quantity)&&d.item.quantity>0?BigInt(d.item.quantity):null;if(cost===null||q===null)continue;
      if(caps.unit_price_min!=null){const lower=minor(d.lower_cost_minor);if(lower===null)errors.push(issue('unit_price_min_unresolved','items'));else if(lower<caps.unit_price_min*q)errors.push(issue('unit_price_below_min','items'));}
      if(caps.unit_price_max!=null&&cost>caps.unit_price_max*q)errors.push(issue('unit_price_above_max','items'));
    }
  }
  for(const k of ['total','exploration']){const cost=minor(out['known_'+k+'_cost_minor']),cap=caps[k+'_cap'];if(cost!==null&&cap!=null&&cost>cap)errors.push(issue(k+'_cap_exceeded','budget.'+k+'_cap'));}
  const packageIds=catalog.filter(o=>o.pricing?.kind==='package').map(o=>o.offer_id),lockedPackageIds=out.items.filter((x:Row)=>x.locked&&packageIds.includes(x.offer_id)).map((x:Row)=>x.offer_id),lockedDetails:Row[]=out.details.filter((d:Row)=>d.item.locked||lockedPackageIds.includes(d.item.offer_id)),lockedUnknown=lockedDetails.some(d=>d.unknown_reasons.length);
  const lockedTotal=lockedDetails.reduce((n,d)=>n+(minor(d.known_cost_minor)??0n),0n),lockedExploration=lockedDetails.filter(d=>d.item.purpose==='exploration').reduce((n,d)=>n+(minor(d.known_cost_minor)??0n),0n);
  if(out.currency===currency&&((caps.total_cap!=null&&lockedTotal>caps.total_cap)||(caps.exploration_cap!=null&&lockedExploration>caps.exploration_cap)))errors.push(issue('locked_selection_conflict','selected_items'));
  const feasible=!!b&&out.complete&&!errors.length,manuscript=prechecks.some(c=>c.status==='failed')?'failed':prechecks.length&&prechecks.every(c=>c.status==='passed')?'passed':'needs_manuscript_check';
  Object.assign(out,{errors,matrix_version:matrix.matrix_version,budget_feasible:feasible,manuscript_checks:prechecks,manuscript_status:manuscript,ready_to_publish:feasible&&manuscript==='passed',status:!b?'needs_budget':feasible?'budget_feasible':!out.complete?'estimate':'no_feasible_plan'});
  const balances:Record<string,bigint|null>={};for(const k of ['total','exploration']){const cost=minor(out[k+'_cost_minor']),cap=caps[k+'_cap']??null;balances[k+'_cap']=cap;balances[k+'_remaining']=cap!==null&&cost!==null&&!lockedUnknown&&out.currency===currency?cap-cost:null;}amounts(out,balances,currency);
  out.semantic_pending=out.items.filter((x:Row)=>!candidates.some(c=>c.resource_id===x.resource_id&&c.semantic_decision_validated&&['recommended','alternative'].includes(c.selection)&&c.matched_questions.length)).map((x:Row)=>({code:'matrix_decision_required',resource_id:x.resource_id,locked:!!x.locked,message:'保留发布项及费用，需补齐第一阶段适配判断'}));
  out.semantic_ready=!!out.items.length&&!out.semantic_pending.length;out.execution_recommended=out.ready_to_publish&&out.semantic_ready;
  return out;
}
