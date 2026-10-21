import { issue, object, rows, text, type Issue, type Row, timestamp } from './common.js';
export const precision:Record<string,number>=Object.assign(Object.create(null),{CNY:2,USD:2,EUR:2,JPY:0});
export function parseMoney(value:unknown,currency:string):bigint {
  const p=precision[currency];
  if(p===undefined) throw new Error('Unsupported currency');
  if(typeof value!=='string' && !(typeof value==='number' && Number.isSafeInteger(value))) throw new Error('Amount must be decimal string or safe integer');
  const s=String(value); if(!/^\d+(?:\.\d+)?$/.test(s)) throw new Error('Amount must be nonnegative plain decimal');
  const [whole='0',fraction='']=s.split('.'); if(fraction.length>p) throw new Error('Amount exceeds currency precision');
  return BigInt(whole)*10n**BigInt(p)+BigInt(fraction.padEnd(p,'0')||'0');
}
export function money(value:unknown,currency:string):bigint|null {try{return parseMoney(value,currency);}catch{return null;}}
export function formatted(v:bigint|null,currency:string):string|null {
  if(v===null||precision[currency]===undefined) return null;
  const p=precision[currency]!,scale=10n**BigInt(p),sign=v<0n?'-':'';v=v<0n?-v:v;
  return sign+(v/scale).toString()+(p?'.'+(v%scale).toString().padStart(p,'0'):'');
}
/** Minor-unit fields are strings to avoid JSON number precision loss. */
export function amounts(out:Row,values:Record<string,bigint|null>,currency:string) {
  for(const [k,v] of Object.entries(values)){out[k]=formatted(v,currency);out[k+'_minor']=v===null?null:v.toString();}
}
export function validateBudget(b:unknown):Issue[] {
  if(!object(b)) return [issue('invalid_type','budget')];
  const errors:Issue[]=[], parsed:Record<string,bigint>={};
  if(typeof b.currency!=='string'||precision[b.currency]===undefined) errors.push(issue('invalid_currency','budget.currency'));
  for(const k of ['total_cap','exploration_cap','unit_price_min','unit_price_max']) {
    if(!(k in b)){if(k==='total_cap') errors.push(issue('required','budget.'+k));continue;}
    if(precision[b.currency]!==undefined) {try{parsed[k]=parseMoney(b[k],b.currency);}catch(e){errors.push(issue('invalid_money','budget.'+k,String(e)));}}
  }
  if('exploration_enabled' in b && typeof b.exploration_enabled!=='boolean')errors.push(issue('invalid_type','budget.exploration_enabled'));
  if(parsed.exploration_cap!==undefined&&parsed.total_cap!==undefined&&parsed.exploration_cap>parsed.total_cap)errors.push(issue('exploration_cap_exceeds_total','budget.exploration_cap'));
  if(parsed.unit_price_min!==undefined&&parsed.unit_price_max!==undefined&&parsed.unit_price_min>parsed.unit_price_max)errors.push(issue('invalid_price_range','budget.unit_price_max'));
  return errors;
}
export function validateRequest(r:unknown,stage:string,asOf:string):Issue[] {
  const errors:Issue[]=[];
  if(!['matrix','budget'].includes(stage))errors.push(issue('invalid_stage','stage'));
  try{timestamp(asOf);}catch{errors.push(issue('invalid_type','as_of','必须显式提供带时区时间'));}
  if(!object(r))return [...errors,issue('invalid_type','$')];
  if(!object(r.task))errors.push(issue('invalid_type','task'));
  else {
    if(!text(r.task.industry))errors.push(issue('required','task.industry'));
    if(!rows(r.task.questions)||!r.task.questions.length)errors.push(issue('required','task.questions'));
    else r.task.questions.forEach((q,i)=>{for(const f of ['question_id','text'])if(!text(q[f]))errors.push(issue('required',`task.questions[${i}].${f}`));});
    for(const f of ['manuscripts','selected_items'])if(f in r.task&&!rows(r.task[f]))errors.push(issue('invalid_type','task.'+f));
    for(const f of ['requirements','manuscript'])if(f in r.task&&!object(r.task[f]))errors.push(issue('invalid_type','task.'+f));
  }
  for(const f of ['catalog','citations','industry_recommendations','selected_items'])if(f in r&&!rows(r[f]))errors.push(issue('invalid_type',f));
  for(const f of ['scope','identity_config'])if(f in r&&!object(r[f]))errors.push(issue('invalid_type',f));
  if('budget' in r)errors.push(...validateBudget(r.budget));else if(stage==='budget')errors.push(issue('required','budget'));
  return errors;
}

/** Validate known nested structures; unknown keys remain data and never become defaults. */
export function validateNested(r:Row):Issue[] {
 const out:Issue[]=[],check=(ok:boolean,path:string)=>{if(!ok)out.push(issue('invalid_type',path));};
 const arrayRows=(v:unknown,path:string)=>check(rows(v),path);
 for(const [i,c] of (r.catalog??[]).entries()){
  const p=`catalog[${i}]`;
  for(const f of ['resource_id','offer_id','source_name','domain','account_id','channel_id','source_identity'])if(c[f]!=null)check(typeof c[f]==='string',p+'.'+f);
  if(c.pricing!=null){check(object(c.pricing),p+'.pricing');if(object(c.pricing)){
   if(c.pricing.included_items!=null)arrayRows(c.pricing.included_items,p+'.pricing.included_items');
   if(c.pricing.mandatory_fees!=null)check(Array.isArray(c.pricing.mandatory_fees),p+'.pricing.mandatory_fees');
  }}
  for(const f of ['hard_conditions','manuscript_checks'])if(f in c)arrayRows(c[f],p+'.'+f);
  for(const f of ['regions','region_coverage','supported_formats','allowed_industries','prohibited_industries','restricted_regions'])if(c[f]!=null)check(typeof c[f]==='string'||(Array.isArray(c[f])&&c[f].every((x:unknown)=>typeof x==='string')),p+'.'+f);
 }
 for(const [i,c] of (r.citations??[]).entries()){
  if(c.scope!=null)check(object(c.scope),`citations[${i}].scope`);
  if(c.applicability!=null)check(object(c.applicability),`citations[${i}].applicability`);
 }
 const cfg=r.identity_config??{};
 for(const f of ['confirmed_account_mappings','confirmed_aliases'])if(f in cfg)arrayRows(cfg[f],'identity_config.'+f);
 for(const f of ['platform_domains','independent_domains','tracking_parameters'])if(f in cfg)check(Array.isArray(cfg[f])&&cfg[f].every((x:unknown)=>typeof x==='string'),'identity_config.'+f);
 if(cfg.confirmed_aliases&&rows(cfg.confirmed_aliases))for(const a of cfg.confirmed_aliases)check(Array.isArray(a.names)&&a.names.every((x:unknown)=>typeof x==='string'),'identity_config.confirmed_aliases.names');
 if(r.scope?.content_age_intervals!=null){const a=r.scope.content_age_intervals;check(rows(a)&&a.every((x:Row)=>typeof x.label==='string'&&Number.isInteger(x.min_days)&&x.min_days>=0&&(x.max_days===null||(Number.isInteger(x.max_days)&&x.max_days>=x.min_days))),'scope.content_age_intervals');}
 return out;
}
