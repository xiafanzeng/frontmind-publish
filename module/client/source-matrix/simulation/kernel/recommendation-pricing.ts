import { clone,equal,issue,object,rows,text,timestamp,unique,type Row } from './common.js';
import { amounts,money,precision } from './contracts.js';

export const minorAmount=(value:unknown):bigint|null=>typeof value==='string'&&/^-?\d+$/.test(value)?BigInt(value):null;

/** Recommendation estimates never authorize orders. Formal priceItems/verifyPlan
 * retain their strict quote dates, publication identity and manuscript guards. */
export function priceRecommendationItems(items:Row[],catalog:Row[],asOf:string):Row {
 const details:Row[]=[],unknown:Row[]=[],errors:Row[]=[],currencies=new Set<string>();
 let total=0n,exploration=0n,knownCount=0,explorationKnownCount=0;
 for(const [index,item] of items.entries()){
  const reasons:string[]=[],notes:string[]=[],q=Number.isSafeInteger(item.quantity)&&item.quantity>0&&item.quantity<=100?BigInt(item.quantity):null;
  if(q===null)reasons.push('quantity_required_positive_integer');
  const matches=unique(catalog.filter(row=>text(item.resource_id)&&row.resource_id===item.resource_id&&(row.offer_id??null)===(item.offer_id??null)&&equal(row.publication_spec??null,item.publication_spec??null)));
  const offer:Row=matches.length===1?matches[0]!:{};
  if(matches.length!==1)reasons.push('offer_missing_or_ambiguous');
  if(offer.publication_status!=='available')reasons.push('channel_not_eligible');
  if(!['standard','exploration'].includes(item.purpose))reasons.push('purpose_required');
  for(const field of ['min_quantity','max_quantity'])if(field in offer&&(!Number.isSafeInteger(offer[field])||offer[field]<1))reasons.push('quantity_limit_invalid');
  if(q!==null&&((Number.isSafeInteger(offer.min_quantity)&&item.quantity<offer.min_quantity)||(Number.isSafeInteger(offer.max_quantity)&&item.quantity>offer.max_quantity)))reasons.push('quantity_out_of_range');
  if('allowed_purposes' in offer){const allowed=offer.allowed_purposes;if(!Array.isArray(allowed)||!allowed.length||allowed.some(x=>!['standard','exploration'].includes(x)))reasons.push('allowed_purposes_invalid');else if(!allowed.includes(item.purpose))reasons.push('purpose_not_allowed');}
  const pricing:Row=object(offer.pricing)?offer.pricing:{},currency=typeof pricing.currency==='string'&&precision[pricing.currency]!==undefined?pricing.currency:null;
  if(currency)currencies.add(currency);else reasons.push('currency_unknown');
  const dates:Record<string,number>={};
  for(const field of ['quoted_at','valid_until']){
   if(pricing[field]==null||pricing[field]===''){notes.push('quote_dates_unknown');continue;}
   try{dates[field]=timestamp(pricing[field]);}catch{reasons.push('quote_dates_invalid');}
  }
  const now=timestamp(asOf);
  if((dates.quoted_at!==undefined&&now<dates.quoted_at)||(dates.valid_until!==undefined&&now>dates.valid_until)||(dates.quoted_at!==undefined&&dates.valid_until!==undefined&&dates.quoted_at>dates.valid_until)||['expired','invalid','inactive','unavailable'].includes(offer.quote_status))reasons.push('quote_not_valid');
  if(offer.offer_id==null)notes.push('catalog_price_estimate');
  if(offer.publication_spec==null)notes.push('publication_spec_unconfirmed');
  const kind=pricing.kind,unit=money(kind==='range'?pricing.upper_bound:pricing.amount,currency??''),lower=kind==='range'?money(pricing.lower_bound,currency??''):unit;
  if(unit===null)reasons.push('price_unknown');
  if(!['unit','range','package'].includes(kind))reasons.push('pricing_rule_unknown');
  if(kind==='range'&&'lower_bound' in pricing&&(lower===null||unit===null||lower>unit))reasons.push('range_bounds_invalid');
  // Estimate a package only when its explicit members all identify this exact
  // resource/spec and sum to the requested quantity. No synthetic unit price.
  const pack=kind==='package',members=pricing.included_items;
  if(pack){
   const exactMembers=rows(members)&&members.length>0&&members.every(member=>member.resource_id===item.resource_id&&equal(member.publication_spec,item.publication_spec)&&Number.isSafeInteger(member.quantity)&&member.quantity>0&&member.purpose===item.purpose);
   if(!exactMembers||members.reduce((sum:number,member:Row)=>sum+member.quantity,0)!==item.quantity)reasons.push('package_members_unresolved');
   if(catalog.some(row=>row.offer_id===offer.offer_id&&row.resource_id!==offer.resource_id))reasons.push('package_cross_resource_unresolved');
  }
  const multiplier=pack?1n:q,baseBlocked=reasons.length>0,base=!baseBlocked&&unit!==null&&multiplier!==null?unit*multiplier:null;
  let fees=0n,feeCount=0;
  const chargedFees:Row[]=[];
  if(!Array.isArray(pricing.mandatory_fees)){reasons.push('mandatory_fees_unknown');notes.push('mandatory_fees_not_included');}
  for(const fee of Array.isArray(pricing.mandatory_fees)?pricing.mandatory_fees:[]){
   if(!object(fee)){reasons.push('mandatory_fee_unknown');notes.push('unresolved_fees_not_included');continue;}
   if(fee.currency!=null&&fee.currency!==currency){reasons.push('mandatory_fee_currency_mismatch');notes.push('unresolved_fees_not_included');continue;}
   const amount=money(fee.amount,currency??''),multiple=fee.basis==='item'?1n:fee.basis==='unit'&&!pack?q:null;
   if(amount===null||multiple===null){reasons.push('mandatory_fee_unknown');notes.push('unresolved_fees_not_included');continue;}
   if(!baseBlocked){fees+=amount*multiple;feeCount++;const actual:Row={...clone(fee)};amounts(actual,{cost:amount*multiple},currency!);chargedFees.push(actual);}
  }
  const known=base===null?null:base+fees,complete=known!==null&&!reasons.length;
  const detail:Row={item:clone(item),currency,unknown_reasons:unique(reasons),scope_notes:unique(notes),is_estimate:true,total_cost_known:complete,price_source:offer.quote_status==='terms_unconfirmed'||offer.offer_id==null?'catalog':'quote',pricing_kind:kind??null,cost_basis:kind==='range'?'confirmed_upper_bound':offer.quote_status==='terms_unconfirmed'||offer.offer_id==null?'catalog_estimate':'exact',mandatory_fees:clone(pricing.mandatory_fees??null),known_mandatory_fees:chargedFees,pricing_status:known===null?'unconfirmed':complete?'priced':'partial'};
  amounts(detail,{unit_price:baseBlocked||kind==='package'?null:unit,base_cost:base,known_mandatory_cost:base!==null&&(feeCount>0||Array.isArray(pricing.mandatory_fees)&&pricing.mandatory_fees.length===0)?fees:null,known_cost:known,cost:complete?known:null,lower_cost:known!==null&&lower!==null&&multiplier!==null?lower*multiplier+fees:null},currency??'');
  details.push(detail);
  if(reasons.length)unknown.push({candidate_id:item.candidate_id,item:clone(item),reasons:unique(reasons)});
  if(q===null)errors.push(issue('quantity_required_positive_integer',`items[${index}]`));
  if(known!==null){total+=known;knownCount++;if(item.purpose==='exploration'){exploration+=known;explorationKnownCount++;}}
 }
 const currency=currencies.size===1?[...currencies][0]!:null,complete=!!items.length&&!unknown.length&&currencies.size===1;
 if(currencies.size>1)errors.push(issue('multiple_currencies','items'));
 const out:Row={items:clone(items),details,unknown_items:unknown,errors,currency,complete,total_cost_known:complete,is_estimate:true};
 const hasExploration=items.some(item=>item.purpose==='exploration'),explorationComplete=!unknown.some(row=>row.item.purpose==='exploration');
 amounts(out,{total_cost:complete?total:null,known_total_cost:currency&&knownCount?total:null,exploration_cost:currency&&explorationComplete?exploration:null,known_exploration_cost:currency&&(!hasExploration||explorationKnownCount)?exploration:null},currency??'');
 return out;
}

/** Fill missing selection fields only when an exact trusted resource mapping
 * leaves one eligible priced catalogue record. Names/domains are never keys. */
export function resolveRecommendationItem(item:Row,candidate:Row,request:Row,asOf:string):Row {
 const selected=(request.resource_selections??[]).find((row:Row)=>row.candidate_id===item.candidate_id);
 const allowed=new Set([candidate.resource_id,...(candidate.catalog_matches??[]).filter((row:Row)=>row.identity_relation==='confirmed').map((row:Row)=>row.resource_id),selected?.resource_id].filter(text));
 if(item.resource_id&&!allowed.has(item.resource_id))return {error:'resource_mapping_requires_confirmation'};
 if(selected&&['resource_id','offer_id','publication_spec'].some(field=>item[field]!=null&&!equal(item[field],selected[field])))return {error:'selected_resource_changed'};
 const requested={...clone(item),...(selected?Object.fromEntries(['resource_id','offer_id','publication_spec'].map(field=>[field,selected[field]??null])):{})};
 let options=unique<Row>((request.catalog??[]).filter((row:Row)=>allowed.has(row.resource_id)&&(!requested.resource_id||row.resource_id===requested.resource_id)&&(requested.offer_id==null||row.offer_id===requested.offer_id)&&(requested.publication_spec==null||equal(row.publication_spec,requested.publication_spec))));
 const exact=options.filter(row=>row.resource_id===requested.resource_id&&(row.offer_id??null)===(requested.offer_id??null)&&equal(row.publication_spec??null,requested.publication_spec??null));
 if(exact.length===1)options=exact;
 else if(!selected&&(requested.offer_id==null||requested.publication_spec==null)){
  options=options.filter(row=>priceRecommendationItems([{...requested,resource_id:row.resource_id,offer_id:row.offer_id??null,publication_spec:row.publication_spec??null}],[row],asOf).details[0]?.base_cost!==null);
 }
 if(options.length!==1)return {item:{...requested,resource_id:requested.resource_id??null,offer_id:requested.offer_id??null,publication_spec:requested.publication_spec??null},reason:'offer_missing_or_ambiguous'};
 const offer=options[0]!;
 return {item:{...requested,resource_id:offer.resource_id,offer_id:offer.offer_id??null,publication_spec:clone(offer.publication_spec??null)}};
}
