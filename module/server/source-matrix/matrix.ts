import { clone,digest,equal,identityFields,issue,list,object,priceFields,roles,rows,semantic,stableJson,strings,text,unique,type Issue,type Row } from './common.js';
import { domain,matchIdentity } from './evidence.js';
import { candidateCatalogMatches } from './export-research.js';
const decisionFields=new Set('candidate_id primary_role auxiliary_roles matched_questions references reason_summary reason_details unconfirmed_items selection supplemental_value supplemental_to exploration_hypothesis verification_items media_intro content_direction layer_rank ranking_reason'.split(' '));
function channel(r:Row,t:Row):Row {
  const fail:string[]=[],pending:string[]=[];
  if(['unavailable','inactive','closed','not_for_sale','suspended'].includes(r.publication_status))fail.push('publication_unavailable');else if(r.publication_status!=='available')pending.push('publication_status_unknown');
  const checks:Record<string,string>={formats:'supported_formats',links:'supports_links',images:'supports_images',video:'supports_video',tables:'supports_tables'};
  for(const [k,expected] of Object.entries(t.requirements??{})){
    if(expected===null||expected===false||equal(expected,[])||equal(expected,{}))continue;
    const attr=checks[k],actual=attr?r[attr]:null;
    if(!attr||actual===undefined||actual===null)pending.push('unknown_requirement:'+k);
    else if(k==='formats'?!list(expected).every(x=>list(actual).includes(x)):!equal(actual,expected))fail.push('unsupported:'+k);
  }
  if(r.allowed_industries!=null&&!list(r.allowed_industries).includes(t.industry))fail.push('industry_not_allowed');
  if(list(r.prohibited_industries).includes(t.industry))fail.push('industry_prohibited');
  const regions=list(t.regions);
  if(regions.length&&!equal(regions,['nationwide'])&&r.restricted_regions!=null&&!regions.every(x=>list(r.restricted_regions).includes(x)))fail.push('region_not_allowed');
  for(const check of r.hard_conditions??[]){if(!object(check))pending.push('invalid_hard_condition');else if(check.status==='fail')fail.push(check.rule_id??'hard_condition_failed');else if(check.status!=='pass')pending.push(check.rule_id??'hard_condition_unknown');}
  return {fail,pending};
}
function manuscriptChecks(manuscripts:Row[],catalog:Row[]):Row {
  const checks=manuscripts.map(m=>{
    const matches=catalog.flatMap(r=>r.manuscript_checks??[]).filter(c=>m.article_id&&m.version&&c.article_id===m.article_id&&c.version===m.version);
    const states=unique(matches.map(c=>c.status));return {article_id:m.article_id,version:m.version,status:states.includes('fail')?'failed':equal(states,['pass'])?'passed':'needs_manuscript_check',checks:clone(matches)};
  });
  return {manuscript_status:checks.some(c=>c.status==='failed')?'failed':checks.length&&checks.every(c=>c.status==='passed')?'passed':'needs_manuscript_check',manuscript_checks:checks};
}
export function prepareCandidates(request:Row,analysis:Row):Row {
  const task=request.task,manuscripts:Row[]=task.manuscripts?.length?task.manuscripts:object(task.manuscript)&&Object.keys(task.manuscript).length?[task.manuscript]:[];
  const grouped=new Map<string,Array<{index:number;row:Row}>>(),candidates:Row[]=[],actual:Row[]=analysis.actual_sources,matched=new Set<number>();
  (request.catalog??[]).forEach((row:Row,index:number)=>{const cid=row.resource_id?'resource:'+row.resource_id:row.candidate_key?'research:'+row.candidate_key:'unverified_offer:'+index;if(!grouped.has(cid))grouped.set(cid,[]);grouped.get(cid)!.push({index,row});});
  for(const [cid,group] of grouped){
    const variants:Row[]=unique(group.map(g=>semantic(g.row))).sort((a,b)=>stableJson(a).localeCompare(stableJson(b)));
    const fields=unique(variants.flatMap(Object.keys)).sort(),common:Row=Object.create(null),conflicts:string[]=[];
    for(const f of fields){if(variants.every(r=>f in r&&equal(r[f],variants[0]![f])))common[f]=clone(variants[0]![f]);else conflicts.push(f);}
    const checks=group.map(g=>channel(g.row,task)),fail=unique<string>(checks.flatMap(c=>c.fail)).sort(),pending=unique<string>(checks.flatMap(c=>c.pending)).sort();
    if(conflicts.length)pending.push('conflicting_resource_attributes');
    const identityConflict=identityFields.some(f=>conflicts.includes(f)),matches:Row[]=[];
    actual.forEach((source,j)=>{
      for(const record of source.records??[{...source.identity,evidence_ids:source.evidence_ids}]){
        const observed={...record,status:source.status};
        const related=variants.map(v=>({v,result:matchIdentity(observed,v,request.identity_config??{})})).filter(x=>(domain(observed)&&domain(observed)===domain(x.v))||['exact','platform_related'].includes(x.result.relation));
        if(related.length){const relation=identityConflict?'unverified':['exact','platform_related','unverified','none'].find(r=>related.some(x=>x.result.relation===r));if(relation==='exact')matched.add(j);
          matches.push({relation,evidence_ids:record.evidence_id?[record.evidence_id]:record.evidence_ids??[],scope:clone(source.scope),source_index:j});}
      }
    });
    candidates.push({candidate_id:cid,resource_id:common.resource_id??null,attributes:common,attribute_variants:variants,conflicting_attributes:conflicts,attribute_paths:group.map(g=>`catalog[${g.index}]`),offers:group.filter(g=>g.row.offer_id).map(g=>clone(g.row)),channel_status:!common.resource_id?'research_only':fail.length?'ineligible':pending.length?'pending':'eligible',hard_failures:fail,pending_conditions:pending,...manuscriptChecks(manuscripts,group.map(g=>g.row)),manuscripts:clone(manuscripts),evidence_relation:['exact','platform_related','unverified'].find(r=>matches.some(m=>m.relation===r))??'none',identity_matches:matches,evidence_ids:unique(matches.flatMap(m=>m.evidence_ids)),recommendation_basis:[]});
  }
  (request.industry_recommendations??[]).forEach((rec:Row,i:number)=>{
    const c=candidates.find(c=>rec.resource_id&&c.resource_id===rec.resource_id);
    if(c){c.recommendation_basis.push(clone(rec));c.attribute_paths.push(`industry_recommendations[${i}]`);}
    else candidates.push({candidate_id:'recommendation:'+(rec.recommendation_id??i),resource_id:null,attributes:clone(rec),attribute_paths:[`industry_recommendations[${i}]`],offers:[],channel_status:'research_only',hard_failures:[],pending_conditions:['unverified_publication_channel'],manuscript_status:'needs_manuscript_check',manuscript_checks:[],manuscripts:clone(manuscripts),evidence_relation:'none',identity_matches:[],evidence_ids:[],recommendation_basis:[clone(rec)]});
  });
  actual.forEach((s,i)=>{if(matched.has(i))return;const relation=s.status==='identity_conflict'?'unverified':'exact';candidates.push({candidate_id:'observed:'+digest([s.scope,s.identity,s.evidence_ids]),resource_id:null,attributes:clone(s.identity),attribute_paths:[],offers:[],channel_status:'research_only',hard_failures:[],pending_conditions:['no_confirmed_publication_channel'],manuscript_status:'needs_manuscript_check',manuscript_checks:[],manuscripts:clone(manuscripts),evidence_relation:relation,identity_matches:[{relation,evidence_ids:clone(s.evidence_ids),scope:clone(s.scope)}],evidence_ids:clone(s.evidence_ids),recommendation_basis:[]});});
  const aggregates:Row[]=analysis.external_aggregates;
  for(const c of candidates){
    c.catalog_matches=candidateCatalogMatches(c,request.catalog??[],request.source_mappings??[]);
    c.aggregate_matches=[];
    for(const a of aggregates){
      const complete=text(a.aggregate_id)&&aggregates.filter(x=>x.aggregate_id===a.aggregate_id).length===1&&a.source_type==='external_data'&&['source_id','data_version','unit'].every(f=>text(a[f]))&&typeof a.count==='number'&&Number.isFinite(a.count)&&a.count>0&&a.scope?.industry===task.industry&&a.applicability?.kind==='industry_context'&&a.applicability.industry===task.industry;
      if(!complete||identityFields.some(f=>c.conflicting_attributes?.includes(f)))continue;
      const identity=Object.fromEntries(identityFields.filter(f=>f in a).map(f=>[f,a[f]]));
      if(matchIdentity(identity,c.attributes,request.identity_config??{}).relation==='exact')c.aggregate_matches.push({aggregate_id:a.aggregate_id,identity_relation:'exact',applicability:'industry_context',record:clone(a),detail_status:'汇总来源，暂无逐条证据'});
    }
    c.aggregate_ids=c.aggregate_matches.map((a:Row)=>a.aggregate_id);
  }
  const version={task:semantic(task),analysis,catalog:unique<string>((request.catalog??[]).map((r:Row)=>stableJson(semantic(r)))).sort(),industry_recommendations:request.industry_recommendations??[],identity_config:request.identity_config??{},source_mappings:request.source_mappings??[]};
  return {matrix_version:'matrix-'+digest(version),candidates,limitations:[...['product','audience','regions'].filter(k=>!task[k]).map(k=>'missing_'+k),...(!candidates.length?['no_source_data_configured']:[])]};
}
function paths(v:any,prefix='',out:Row={}):Row {
  if(object(v))for(const [k,x] of Object.entries(v))paths(x,prefix?prefix+'.'+k:k,out);
  else if(Array.isArray(v))v.forEach((x,i)=>paths(x,`${prefix}[${i}]`,out));
  if(v!==undefined&&v!==null&&v!==''&&!equal(v,[])&&!equal(v,{}))out[prefix]=v;
  return out;
}
export function validateDecisions(d:Row,p:Row,r:Row):Issue[] {
  const errors:Issue[]=[],err=(c:string,path:string,message?:string)=>errors.push(issue(c,path,message));
  if(!object(d))return [issue('invalid_type','decisions.matrix_decisions')];
  for(const k of Object.keys(d))if(!['items','fit_order'].includes(k))err('untrusted_field','decisions.'+k);
  if(!rows(d.items??[]))return [...errors,issue('invalid_type','decisions.items')];
  const items:Row[]=d.items??[],byId=new Map<string,Row>(p.candidates.map((c:Row)=>[c.candidate_id,c])),questions=r.task.questions.map((q:Row)=>q.question_id),validPaths=paths(semantic({task:r.task,catalog:r.catalog??[],industry_recommendations:r.industry_recommendations??[]})),seen:string[]=[];
  items.forEach((item,i)=>{
    const path=`decisions.items[${i}]`,c=byId.get(item.candidate_id);
    for(const f of ['primary_role','candidate_id','reason_summary','selection','supplemental_value','exploration_hypothesis','media_intro','content_direction','ranking_reason'])if(f in item&&(typeof item[f]!=='string'||!item[f].trim()))err('invalid_type',path+'.'+f);
    if('layer_rank' in item&&(!Number.isSafeInteger(item.layer_rank)||item.layer_rank<1))err('invalid_type',path+'.layer_rank');
    for(const f of ['auxiliary_roles','matched_questions','reason_details','unconfirmed_items','verification_items','supplemental_to'])if(f in item&&!strings(item[f]))err('invalid_type',path+'.'+f);
    if('references' in item&&!rows(item.references))err('invalid_type',path+'.references');
    for(const k of Object.keys(item))if(!decisionFields.has(k))err('untrusted_field',path+'.'+k);
    if(!c){err('unknown_candidate',path);return;}
    if(seen.includes(item.candidate_id))err('duplicate_candidate',path);seen.push(item.candidate_id);
    const aux=strings(item.auxiliary_roles??[])?item.auxiliary_roles??[]:[];
    if(!strings(item.auxiliary_roles??[]))err('invalid_type',path+'.auxiliary_roles');
    const all=[item.primary_role,...aux];if(all.some(x=>!Object.hasOwn(roles,x))||unique(all).length!==all.length)err('invalid_roles',path);
    const matched=strings(item.matched_questions)?item.matched_questions:[];
    if(!matched.length||matched.some((x:string)=>!questions.includes(x)))err('unknown_question',path+'.matched_questions');
    if(!text(item.reason_summary))err('missing_reason',path);
    if(!['recommended','alternative'].includes(item.selection))err('invalid_selection',path);
    for(const f of ['reason_details','unconfirmed_items'])if(!strings(item[f]))err('invalid_type',path+'.'+f);
    const refs:Row[]=rows(item.references)?item.references:[];if(!refs.length)err('missing_references',path+'.references');
    refs.forEach((ref,j)=>{
      const rp=`${path}.references[${j}]`,expected=ref.type==='attribute'?['type','path']:ref.type==='aggregate'?['type','aggregate_id','usage']:['type','evidence_id'];
      if(!equal(Object.keys(ref).sort(),expected.sort()))err('invalid_reference',rp);
      if(ref.type==='attribute'){
        const a=ref.path,allow=typeof a==='string'&&(a.startsWith('task.')||c.attribute_paths.some((p:string)=>a===p||a.startsWith(p+'.'))),m=typeof a==='string'?/^catalog\[\d+\](?:\.([^.[\]]+))?/.exec(a):null;
        const conflict=m&&(c.conflicting_attributes??[]).length&&(!m[1]||c.conflicting_attributes.includes(m[1]));
        if(!allow||!Object.hasOwn(validPaths,a)||conflict)err('invalid_attribute_reference',rp);
        if(typeof a==='string'&&a.split(/[.\[\]]+/).some(x=>priceFields.has(x)))err('price_reference',rp);
      }else if(ref.type==='evidence'){
        if(!c.evidence_ids.includes(ref.evidence_id)||!c.identity_matches.some((m:Row)=>m.evidence_ids.includes(ref.evidence_id)&&matched.includes(m.scope?.question_id)))err('invalid_evidence_reference',rp);
      }else if(ref.type==='aggregate'){
        if(ref.usage!=='industry_context'||!c.aggregate_ids.includes(ref.aggregate_id))err('invalid_aggregate_reference',rp);
      }else err('invalid_reference_type',rp);
    });
    if(all.includes('regional')){
      const regions=list(r.task.regions),coverage=list(c.attributes.regions??c.attributes.region_coverage);
      if(!regions.length||equal(regions,['nationwide']))err('regional_not_applicable',path);
      if(['regions','region_coverage'].some(k=>c.conflicting_attributes?.includes(k))||!regions.some(x=>coverage.includes(x)))err('regional_coverage_unconfirmed',path);
    }
    if(all.includes('supplement')){
      if(!text(item.supplemental_value))err('missing_increment',path);
      if(!strings(item.supplemental_to)||!item.supplemental_to.length||item.supplemental_to.some((id:string)=>id===item.candidate_id||!items.some(x=>x.candidate_id===id&&['authority','industry','regional'].includes(x.primary_role))))err('invalid_supplement_base',path);
    }
    if(all.includes('exploration')){
      if(!text(item.exploration_hypothesis))err('missing_hypothesis',path);
      if(!strings(item.verification_items)||!item.verification_items.length||!item.verification_items.every(text))err('missing_verification',path);
    }
  });
  if(!strings(d.fit_order??[])||unique(d.fit_order??[]).length!==(d.fit_order??[]).length||!equal([...(d.fit_order??[])].sort(),[...seen].sort()))err('invalid_fit_order','decisions.fit_order');
  if(items.some(item=>'layer_rank' in item||'ranking_reason' in item)){
    for(const role of Object.keys(roles)){
      const members=items.filter(item=>item.primary_role===role),ranked=members.map(item=>item.layer_rank).sort((a,b)=>a-b);
      if(members.some(item=>!text(item.ranking_reason))||!equal(ranked,members.map((_,i)=>i+1)))err('invalid_layer_ranks','decisions.items','每层序号须完整连续，且提供排序理由');
      const ordered=(d.fit_order??[]).filter((id:string)=>members.some(item=>item.candidate_id===id));
      if(!equal(ordered,[...members].sort((a,b)=>a.layer_rank-b.layer_rank).map(item=>item.candidate_id)))err('layer_rank_order_mismatch','decisions.fit_order');
    }
  }
  return errors;
}
export function assembleMatrix(r:Row,a:Row,d:Row={}):Row {
  const p=prepareCandidates(r,a),errors=validateDecisions(d,p,r),missing=!d.items?.length,status=errors.length?'invalid_decisions':missing?'needs_ai_decisions':'complete';
  let candidates:Row[]=p.candidates;const order:string[]=status==='complete'?d.fit_order:[];
  candidates=candidates.map(c=>{const decision=status==='complete'?d.items.find((x:Row)=>x.candidate_id===c.candidate_id):null;return {...c,primary_role:null,auxiliary_roles:[],selection:'undecided',matched_questions:[],...(decision??{}),semantic_decision_validated:!!decision};});
  if(order.length)candidates.sort((a,b)=>(order.includes(a.candidate_id)?order.indexOf(a.candidate_id):order.length)-(order.includes(b.candidate_id)?order.indexOf(b.candidate_id):order.length));
  const layers=Object.entries(roles).map(([role,display_name])=>({role,display_name,status:candidates.some(c=>c.primary_role===role)?'populated':'empty',candidate_ids:candidates.filter(c=>c.primary_role===role).map(c=>c.candidate_id),auxiliary_candidate_ids:candidates.filter(c=>c.auxiliary_roles.includes(role)).map(c=>c.candidate_id)}));
  return {schema_version:'1.0',matrix_version:p.matrix_version,status,source_analysis:clone(a),data_quality:clone(a.data_quality),scope:{task:clone(r.task),evidence_scope:clone(a.scope)},matrix:{status,candidates,layers,fit_order:order,coverage_kind:'semantic_relevance'},research_only:candidates.filter(c=>c.channel_status==='research_only'),pending_items:candidates.filter(c=>c.pending_conditions.length||c.manuscript_status==='needs_manuscript_check').map(c=>({candidate_id:c.candidate_id,conditions:c.pending_conditions,manuscript_status:c.manuscript_status})),limitations:p.limitations,errors,budget_plans:[]};
}
