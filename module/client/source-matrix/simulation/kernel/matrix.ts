import { normalizeMatrixRegion, normalizeMatrixTargetPlatform } from '../../../../shared/matrix-requirements.js';
import { clone,digest,equal,identityFields,issue,list,object,priceFields,roles,rows,semantic,stableJson,strings,text,unique,type Issue,type Row } from './common.js';
import { domain,matchIdentity } from './evidence.js';
import { candidateCatalogMatches } from './export-research.js';
import { industryContextAggregates } from './industry-context-evidence.js';
import { catalogChannelChecks as channel, createCandidateRanker, regionalApplicable } from './candidate-ranking.js';
import { attachIndustryRanking, normalizeMediaName } from './industry-ranking-match.js';
const decisionFields=new Set('candidate_id outlet_key topic_fit form_fit audience_fit selection_reason primary_role auxiliary_roles matched_questions references reason_summary reason_details unconfirmed_items selection supplemental_value supplemental_to exploration_hypothesis verification_items media_intro content_direction layer_rank ranking_reason decision_basis'.split(' '));
/** 2026.11.10-web.1 stage-1 contract: the model recommends up to 20 deduplicated
 * media acquisition outlets with per-item basis instead of five-layer roles.
 * Legacy role fields stay readable so saved snapshots still validate. */
const topicFits=new Set(['direct','related','weak']),formFits=new Set(['same','adaptable','rebuild']),audienceFits=new Set(['direct','adjacent','unclear']);
export const SUGGESTION_TARGET_COUNT=20;
export function outletKeyOf(candidate:Row):string {
  const decided=typeof candidate.outlet_key==='string'&&candidate.outlet_key.trim()?candidate.outlet_key.trim():'';
  if(decided)return normalizeMediaName(decided)||decided.toLowerCase();
  const attributes=candidate.attributes??{};
  return normalizeMediaName(attributes.domain??attributes.source_name??attributes.name??candidate.resource_id??candidate.candidate_id);
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
  // Frozen text belongs to the shared task, not to every catalogue candidate.
  const manuscriptIdentities=manuscripts.map(({content_excerpt:_excerpt,content_excerpt_truncated:_truncated,content_source:_source,...metadata})=>metadata);
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
          matches.push({relation,source_status:source.status,evidence_ids:record.evidence_id?[record.evidence_id]:record.evidence_ids??[],scope:clone(source.scope),source_index:j});}
      }
    });
    candidates.push({candidate_id:cid,resource_id:common.resource_id??null,attributes:common,attribute_variants:variants,conflicting_attributes:conflicts,attribute_paths:group.map(g=>`catalog[${g.index}]`),offers:group.filter(g=>g.row.offer_id).map(g=>clone(g.row)),channel_status:!common.resource_id?'research_only':fail.length?'ineligible':pending.length?'pending':'eligible',hard_failures:fail,pending_conditions:pending,...manuscriptChecks(manuscripts,group.map(g=>g.row)),manuscripts:clone(manuscriptIdentities),evidence_relation:['exact','platform_related','unverified'].find(r=>matches.some(m=>m.relation===r))??'none',identity_matches:matches,evidence_ids:unique(matches.flatMap(m=>m.evidence_ids)),recommendation_basis:[]});
  }
  (request.industry_recommendations??[]).forEach((rec:Row,i:number)=>{
    const c=candidates.find(c=>rec.resource_id&&c.resource_id===rec.resource_id);
    if(c){c.recommendation_basis.push(clone(rec));c.attribute_paths.push(`industry_recommendations[${i}]`);}
    else candidates.push({candidate_id:'recommendation:'+(rec.recommendation_id??i),resource_id:null,attributes:clone(rec),attribute_paths:[`industry_recommendations[${i}]`],offers:[],channel_status:'research_only',hard_failures:[],pending_conditions:['unverified_publication_channel'],manuscript_status:'needs_manuscript_check',manuscript_checks:[],manuscripts:clone(manuscriptIdentities),evidence_relation:'none',identity_matches:[],evidence_ids:[],recommendation_basis:[clone(rec)]});
  });
  actual.forEach((s,i)=>{if(matched.has(i))return;const relation=s.status==='identity_conflict'?'unverified':'exact';candidates.push({candidate_id:'observed:'+digest([s.scope,s.identity,s.evidence_ids]),resource_id:null,attributes:clone(s.identity),attribute_paths:[],offers:[],channel_status:'research_only',hard_failures:[],pending_conditions:['no_confirmed_publication_channel'],manuscript_status:'needs_manuscript_check',manuscript_checks:[],manuscripts:clone(manuscriptIdentities),evidence_relation:relation,identity_matches:[{relation,source_status:s.status,evidence_ids:clone(s.evidence_ids),scope:clone(s.scope)}],evidence_ids:clone(s.evidence_ids),recommendation_basis:[]});});
  const aggregates:Row[]=analysis.external_aggregates;
  const industryAggregates=industryContextAggregates(task);
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
    // Shared sector buckets are not identity matches and do not create sources.
    c.industry_aggregate_ids=[];
  }
  /* Supplier media ranking (billed top-20) attaches by exact normalized name to
   * real catalogue resources only; unmatched names stay a reference list. */
  const ranking=attachIndustryRanking(candidates,task.industry_context?.media_ranking);
  const version={task:semantic(task),analysis,catalog:unique<string>((request.catalog??[]).map((r:Row)=>stableJson(semantic(r)))).sort(),industry_recommendations:request.industry_recommendations??[],identity_config:request.identity_config??{},source_mappings:request.source_mappings??[]};
  const targetPlatforms:string[]=task.target_platforms??[];
  const targetObserved=!targetPlatforms.length||(analysis.detail_citations??[]).some((entry:Row)=>targetPlatforms.includes(normalizeMatrixTargetPlatform(typeof entry.scope?.platform==='string'?entry.scope.platform:''))&&task.questions.some((question:Row)=>question.question_id===entry.scope?.question_id));
  const rankingSnapshot=object(task.industry_context?.media_ranking)?task.industry_context.media_ranking:null;
  return {matrix_version:'matrix-'+digest(version),candidates,industry_aggregate_ids:industryAggregates.map(a=>a.aggregate_id),
    industry_ranking:rankingSnapshot?{status:rankingSnapshot.status??null,message:rankingSnapshot.message??null,source:task.industry_context?.source??null,query:rankingSnapshot.query??null,fetched_at:rankingSnapshot.fetched_at??null,matched_count:ranking.matched.size,matched_candidate_ids:[...ranking.matched.keys()],unmatched:ranking.unmatched}:null,
    limitations:unique([...['product','audience','regions'].filter(k=>!task[k]).map(k=>'missing_'+k),...(!candidates.length?['no_source_data_configured']:[]),...(task.industry_context?.limitations??[]),...(!targetObserved?['目标平台引用依据待核验；现有资料不能证明本次投放将被收录或引用。']:[]),...((task.manuscripts??[]).some((m:Row)=>m.content_excerpt_truncated)?['manuscript_content_excerpt_truncated']:[])])};
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
  for(const k of Object.keys(d))if(!['items','fit_order','selected_media','excluded_candidates','reviewed_candidate_ids','review_error','ranking_method','failed_candidates','unprocessed_candidate_ids'].includes(k))err('untrusted_field','decisions.'+k);
  if(!rows(d.items??[]))return [...errors,issue('invalid_type','decisions.items')];
  const items:Row[]=d.items??[],byId=new Map<string,Row>(p.candidates.map((c:Row)=>[c.candidate_id,c])),questions=(r.task.questions??[]).map((q:Row)=>q.question_id),validPaths=paths(semantic({task:r.task,catalog:r.catalog??[],industry_recommendations:r.industry_recommendations??[]})),seen:string[]=[];
  items.forEach((item,i)=>{
    const path=`decisions.items[${i}]`,c=byId.get(item.candidate_id);
    const legacy=typeof item.primary_role==='string';
    for(const f of ['candidate_id','reason_summary','selection','selection_reason','media_intro','content_direction','outlet_key','primary_role','ranking_reason'])if(f in item&&(typeof item[f]!=='string'||!item[f].trim()))err('invalid_type',path+'.'+f);
    if('layer_rank' in item&&(!Number.isSafeInteger(item.layer_rank)||item.layer_rank<1))err('invalid_type',path+'.layer_rank');
    for(const f of ['auxiliary_roles','matched_questions','reason_details','unconfirmed_items','verification_items','supplemental_to'] as const)if(f in item&&!strings(item[f]))err('invalid_type',path+'.'+f);
    if('decision_basis' in item&&!['ai','rule'].includes(String(item.decision_basis)))err('invalid_type',path+'.decision_basis');
    if('references' in item&&!rows(item.references))err('invalid_type',path+'.references');
    for(const k of Object.keys(item))if(!decisionFields.has(k))err('untrusted_field',path+'.'+k);
    if(!c){err('unknown_candidate',path);return;}
    if(seen.includes(item.candidate_id))err('duplicate_candidate',path);seen.push(item.candidate_id);
    if(!legacy&&item.decision_basis!=='rule'){
      /* Rule-fallback items carry no semantic fit labels by design: their
       * reason states the selection was program-generated without model
       * review, and inventing direct/related labels would be fabrication. */
      if(!text(item.outlet_key))err('missing_outlet_key',path);
      if(!topicFits.has(String(item.topic_fit)))err('invalid_type',path+'.topic_fit');
      if(!formFits.has(String(item.form_fit)))err('invalid_type',path+'.form_fit');
      if(!audienceFits.has(String(item.audience_fit)))err('invalid_type',path+'.audience_fit');
    }
    if(!['recommended','alternative'].includes(item.selection))err('invalid_selection',path);
    const matched=strings(item.matched_questions)?item.matched_questions:[];
    if(!matched.length||matched.some((x:string)=>!questions.includes(x)))err('unknown_question',path+'.matched_questions');
    if(!text(item.reason_summary))err('missing_reason',path);
    for(const f of ['reason_details','unconfirmed_items'])if(!strings(item[f]))err('invalid_type',path+'.'+f);
    const refs:Row[]=rows(item.references)?item.references:[];if(!refs.length)err('missing_references',path+'.references');
    refs.forEach((ref,j)=>{
      const rp=`${path}.references[${j}]`,expected=ref.type==='attribute'?['type','path']:ref.type==='aggregate'?['type','aggregate_id','usage']:['type','evidence_id'];
      if(!equal(Object.keys(ref).sort(),expected.sort()))err('invalid_reference',rp);
      if(ref.type==='attribute'){
        const a=ref.path,allow=typeof a==='string'&&(a.startsWith('task.')||c.attribute_paths.some((p:string)=>a===p||a.startsWith(p+'.'))),m=typeof a==='string'?/^catalog\[(\d+)\](?:\.([^.[\]]+))?/.exec(a):null;
        const conflict=m&&(c.conflicting_attributes??[]).length&&(!m[1]||c.conflicting_attributes.includes(m[1]));
        if(!allow||!Object.hasOwn(validPaths,a)||conflict)err('invalid_attribute_reference',rp);
        if(typeof a==='string'&&(a==='task.industry_context'||a.startsWith('task.industry_context.')))err('industry_context_requires_aggregate_reference',rp);
        if(typeof a==='string'&&a.split(/[.\[\]]+/).some(x=>priceFields.has(x)))err('price_reference',rp);
      }else if(ref.type==='evidence'){
        if(!c.evidence_ids.includes(ref.evidence_id)||!c.identity_matches.some((m:Row)=>m.evidence_ids.includes(ref.evidence_id)&&matched.includes(m.scope?.question_id)))err('invalid_evidence_reference',rp);
      }else if(ref.type==='aggregate'){
        if(ref.usage!=='industry_context'||![...c.aggregate_ids,...(p.industry_aggregate_ids??[])].includes(ref.aggregate_id))err('invalid_aggregate_reference',rp);
      }else err('invalid_reference_type',rp);
    });
    if(!legacy&&(p.require_role_evidence===true||d.reviewed_candidate_ids!==undefined)&&(c.hard_failures?.length||c.channel_status==='ineligible'))err('candidate_hard_ineligible',path);
    /* Legacy role rules stay enforced only for legacy-shaped items so old
     * snapshots replay unchanged; the new contract has no roles at all. */
    if(legacy){
      const aux=strings(item.auxiliary_roles??[])?item.auxiliary_roles??[]:[];
      const all=[item.primary_role,...aux];if(all.some(x=>!Object.hasOwn(roles,x))||unique(all).length!==all.length)err('invalid_roles',path);
      if(all.includes('regional')&&!regionalApplicable(r.task))err('regional_not_applicable',path);
    }
  });
  /* Stage-1 deliverable: an ordered, deduplicated selection of at most 20
   * outlets. Membership/eligibility is kernel-checked; ordering is the model's. */
  if(d.selected_media!==undefined){
    const chosen=strings(d.selected_media)?d.selected_media:[];
    const outletSeen=new Set<string>();
    if(unique(chosen).length!==chosen.length)err('duplicate_selected_media','decisions.selected_media');
    if(chosen.length>SUGGESTION_TARGET_COUNT)err('too_many_selected_media','decisions.selected_media',`最多推荐${SUGGESTION_TARGET_COUNT}个媒体渠道`);
    chosen.forEach((id,i)=>{
      const item=items.find((row:Row)=>row.candidate_id===id);
      if(!item){err('unknown_selected_media',`decisions.selected_media[${i}]`);return;}
      if(item.selection!=='recommended')err('selected_media_not_recommended',`decisions.selected_media[${i}]`);
      if(String(item.topic_fit)==='weak')err('selected_media_weak_topic',`decisions.selected_media[${i}]`,'弱相关渠道不能凑数入选');
      const outlet=outletKeyOf({...item,attributes:byId.get(id)?.attributes??{}});
      if(outletSeen.has(outlet))err('duplicate_selected_outlet',`decisions.selected_media[${i}]`,'同一实际媒体载体不能重复占推荐名额');
      outletSeen.add(outlet);
      if(!text(item.selection_reason))err('missing_selection_reason',`decisions.items[${items.indexOf(item)}]`,'入选媒体须写明相较其余候选的推荐依据');
    });
    if(!errors.some(error=>error.path.startsWith('decisions.selected_media'))){
      if(!equal([...chosen].sort(),[...(d.fit_order??[])].filter((id:string)=>chosen.includes(id)).sort()))err('invalid_fit_order','decisions.fit_order','fit_order 须覆盖全部已入选媒体');
    }
  }
  const excluded:Row[]=rows(d.excluded_candidates)?d.excluded_candidates:[];
  if(d.excluded_candidates!==undefined&&!rows(d.excluded_candidates))err('invalid_type','decisions.excluded_candidates');
  const excludedIds=new Set<string>();
  excluded.forEach((entry,index)=>{
    const path=`decisions.excluded_candidates[${index}]`;
    if(!equal(Object.keys(entry).sort(),['candidate_id','reason'])||!text(entry.reason)||!byId.has(entry.candidate_id))err('invalid_excluded_candidate',path);
    if(seen.includes(entry.candidate_id)||excludedIds.has(entry.candidate_id))err('duplicate_candidate',path);excludedIds.add(entry.candidate_id);
  });
  /* Per-candidate failures are recorded evidence, not a global verdict: the
   * kernel validates accepted items strictly and keeps failed work visible. */
  const failedCandidates:Row[]=rows(d.failed_candidates)?d.failed_candidates:[];
  if(d.failed_candidates!==undefined&&!rows(d.failed_candidates))err('invalid_type','decisions.failed_candidates');
  const failedIds=new Set<string>();
  failedCandidates.forEach((entry,index)=>{
    const path=`decisions.failed_candidates[${index}]`;
    if(!byId.has(entry.candidate_id))err('unknown_candidate',path);
    if(failedIds.has(entry.candidate_id)||seen.includes(entry.candidate_id)||excludedIds.has(entry.candidate_id))err('duplicate_candidate',path);
    failedIds.add(entry.candidate_id);
    if(!Array.isArray(entry.errors))err('invalid_type',path+'.errors');
  });
  if(d.unprocessed_candidate_ids!==undefined&&(!strings(d.unprocessed_candidate_ids)||d.unprocessed_candidate_ids.some((id:string)=>!byId.has(id)||seen.includes(id)||excludedIds.has(id)||failedIds.has(id))))err('invalid_type','decisions.unprocessed_candidate_ids');
  if(d.reviewed_candidate_ids!==undefined&&(!strings(d.reviewed_candidate_ids)||unique(d.reviewed_candidate_ids).length!==d.reviewed_candidate_ids.length||d.reviewed_candidate_ids.some((id:string)=>!byId.has(id)||!seen.includes(id)&&!excludedIds.has(id)&&!failedIds.has(id))))err('invalid_review_coverage','decisions.reviewed_candidate_ids');
  if(d.review_error!==undefined&&!text(d.review_error))err('invalid_type','decisions.review_error');
  if(d.ranking_method!==undefined&&!['task_attributes_then_batch_semantic_order','suggestion_order'].includes(d.ranking_method))err('invalid_type','decisions.ranking_method');
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
  const p=prepareCandidates(r,a),catalog=clone(r.catalog_coverage??{status:'unknown',total_resources:null,scanned_resources:null,reason:'legacy_coverage_unavailable'});
  const knownIds=new Set(p.candidates.map((candidate:Row)=>candidate.candidate_id));
  const allItems:Row[]=(rows(d.items)?d.items:[]).filter((item:Row)=>knownIds.has(item.candidate_id));
  const excluded:Row[]=(rows(d.excluded_candidates)?d.excluded_candidates:[]).filter((entry:Row)=>knownIds.has(entry.candidate_id)&&text(entry.reason));
  const errors=validateDecisions(d,p,r);
  /* The kernel stays the single authority: an item that fails validation is
   * demoted to a failed candidate with its evidence preserved, so invalid work
   * never displays — but its valid siblings survive. Envelope-contract
   * violations (untrusted fields, invalid types) still reject the submission. */
  const envelopeErrors:Issue[]=[];const itemFailure=new Map<string,Issue[]>();
  for(const error of errors){
    const match=/^decisions\.items\[(\d+)\]/.exec(error.path);
    if(match){const row=(d.items??[])[Number(match[1])],id=row?String(row.candidate_id??''):'';if(id&&knownIds.has(id)){const list=itemFailure.get(id)??[];list.push(error);itemFailure.set(id,list);}else envelopeErrors.push(error);continue;}
    if(/^decisions\.excluded_candidates\[/.test(error.path)||/^decisions\.selected_media\[/.test(error.path)||['candidate_outside_batch','batch_candidates_unreviewed','invalid_fit_order','invalid_layer_ranks','layer_rank_order_mismatch','invalid_review_coverage','duplicate_selected_media','duplicate_selected_outlet','too_many_selected_media','unknown_selected_media','selected_media_not_recommended','selected_media_weak_topic','missing_selection_reason'].includes(error.code))continue;
    envelopeErrors.push(error);
  }
  const items=allItems.filter(item=>!itemFailure.has(String(item.candidate_id)));
  const failedMap=new Map<string,Row>();
  for(const entry of (rows(d.failed_candidates)?d.failed_candidates:[]).filter((entry:Row)=>knownIds.has(entry.candidate_id)))failedMap.set(String(entry.candidate_id),entry);
  for(const [id,list] of itemFailure)if(!failedMap.has(id))failedMap.set(id,{candidate_id:id,errors:list,raw:(d.items??[]).find((row:Row)=>String(row.candidate_id)===id)});
  const failedCandidates=[...failedMap.values()];
  /* Failed-candidate evidence stays visible in the result diagnosis instead of
   * poisoning the validated remainder. */
  for(const entry of failedCandidates)for(const itemError of Array.isArray(entry.errors)?entry.errors:[])errors.push(itemError as Issue);
  const unprocessedList=unique<string>((strings(d.unprocessed_candidate_ids)?d.unprocessed_candidate_ids:[]).filter(id=>knownIds.has(id)));
  const decisionIds=new Set(items.map(item=>String(item.candidate_id)));
  const excludedIds=new Set(excluded.map(entry=>String(entry.candidate_id)));
  const failedIds=new Set(failedCandidates.map(entry=>String(entry.candidate_id)));
  /* Counted outcomes are decided, excluded-with-reason and failed; every other
   * candidate is unprocessed. A missing id never silently becomes an exclusion. */
  const accounted=new Set<string>([...decisionIds,...excludedIds,...failedIds]);
  const unprocessedTotal=Math.max(0,p.candidates.length-accounted.size);
  const decidedCount=items.length;
  const catalogIncomplete=['failed','incomplete'].includes(catalog.status);
  const modelStatus=decidedCount>0?(failedIds.size+unprocessedTotal>0?'partial':'complete'):(failedIds.size>0?'failed':unprocessedTotal>0?'incomplete':'pending');
  /* A valid subset is viewable and usable: partial matrices keep every
  * validated decision attached with an explicit coverage limitation. */
  const attach=!catalogIncomplete&&envelopeErrors.length===0&&decidedCount>0;
  const status=envelopeErrors.length>0?'invalid_decisions':!attach?(decidedCount===0&&failedIds.size>0?'invalid_decisions':'needs_ai_decisions'):(failedIds.size+unprocessedTotal>0?'partial':'complete');
  let candidates:Row[]=p.candidates;const order:string[]=attach?d.fit_order??[]:[];
  candidates=candidates.map(c=>{const decision=attach?d.items?.find((x:Row)=>x.candidate_id===c.candidate_id):null;const merged={...c,primary_role:null,auxiliary_roles:[],selection:'undecided',matched_questions:[],...(decision??{})};return {...merged,outlet_key:outletKeyOf(merged),industry_aggregate_ids:decision?unique<string>((decision.references??[]).filter((ref:Row)=>ref.type==='aggregate'&&p.industry_aggregate_ids.includes(ref.aggregate_id)).map((ref:Row)=>ref.aggregate_id)):merged.industry_aggregate_ids??[],semantic_decision_validated:!!decision};});
  const decidedById=new Map(candidates.map(c=>[String(c.candidate_id),c]));
  /* Stage-1 deliverable: at most 20 deduplicated outlets in recommendation
   * order. Explicit model selection wins; legacy or partial envelopes derive a
   * labelled fallback order so saved tasks and resumes stay usable. */
  const explicitSelection=strings(d.selected_media)?d.selected_media:[];
  const droppedSelected=explicitSelection.filter(id=>!decidedById.get(id)?.semantic_decision_validated);
  let selectedIds=explicitSelection.filter(id=>decidedById.get(id)?.semantic_decision_validated);
  let selectionBasis=explicitSelection.length?'semantic':'derived';
  if(attach&&explicitSelection.length&&!selectedIds.length)selectionBasis='derived';
  if(!selectedIds.length&&attach){
    const outletSeen=new Set<string>();
    selectedIds=[];
    for(const id of order){
      const candidate=decidedById.get(id);
      if(!candidate||candidate.selection!=='recommended')continue;
      if(String(candidate.topic_fit)==='weak')continue;
      const outlet=String(candidate.outlet_key);
      if(outletSeen.has(outlet))continue;
      outletSeen.add(outlet);selectedIds.push(id);
      if(selectedIds.length>=SUGGESTION_TARGET_COUNT)break;
    }
  }
  const selectedSet=new Set(selectedIds);
  const ranker=createCandidateRanker(r.task),coverage={catalog,model:{status:modelStatus,shortlisted_candidates:p.candidates.length,reviewed_candidates:Math.min(p.candidates.length,accounted.size),classified_candidates:decidedCount,ai_classified_candidates:items.filter(item=>item.decision_basis!=='rule').length,rule_classified_candidates:items.filter(item=>item.decision_basis==='rule').length,selected_candidates:selectedIds.length,selected_target:SUGGESTION_TARGET_COUNT,selection_basis:selectionBasis,excluded_candidates:excluded.length,failed_candidates:failedIds.size,unprocessed_candidates:unprocessedTotal,batches_are_bounded:true,reason:d.review_error??null},ranking_method:d.ranking_method??'legacy_semantic_order'};
  const legacy=items.some(item=>typeof item.primary_role==='string'&&item.primary_role);
  const fitRank=new Map<string,number>(order.map((id,index)=>[id,index]));
  if(selectedIds.length)candidates.sort((a,b)=>{const sa=selectedSet.has(a.candidate_id)?selectedIds.indexOf(a.candidate_id):SUGGESTION_TARGET_COUNT+1,sb=selectedSet.has(b.candidate_id)?selectedIds.indexOf(b.candidate_id):SUGGESTION_TARGET_COUNT+1;return sa-sb||(fitRank.get(a.candidate_id)??order.length)-(fitRank.get(b.candidate_id)??order.length);});
  else if(order.length)candidates.sort((a,b)=>(fitRank.get(a.candidate_id)??order.length)-(fitRank.get(b.candidate_id)??order.length));
  /* Program-owned dedup guard: a later duplicate outlet can never occupy two
   * of the ≤20 recommendation slots even if envelope checks were bypassed. */
  const dedupSeen=new Set<string>();selectedIds=selectedIds.filter(id=>{const outlet=String(decidedById.get(id)?.outlet_key??id);if(dedupSeen.has(outlet))return false;dedupSeen.add(outlet);return true;});
  const suggestions={target_count:SUGGESTION_TARGET_COUNT,dedup:'outlet_key',basis:selectionBasis,selected_candidate_ids:selectedIds};
  const layers=Object.entries(roles).map(([role,display_name])=>{
    const members=candidates.filter(c=>c.primary_role===role).sort((a,b)=>(a.layer_rank??Infinity)-(b.layer_rank??Infinity)||(fitRank.get(a.candidate_id)??Infinity)-(fitRank.get(b.candidate_id)??Infinity));
    const available=catalog.eligible_by_role?.[role]??p.candidates.filter((candidate:Row)=>ranker(candidate).eligible[role]).length;
    const pending=failedIds.size+unprocessedTotal>0;
    const state=role==='regional'&&!regionalApplicable(r.task)?'not_applicable':catalog.status==='failed'?'failed':members.length?'populated':catalogIncomplete||pending?'incomplete':'empty';
    const reason=state==='not_applicable'?'本轮未指定局部地域，地域覆盖层不适用。':state==='failed'?'候选读取或分层请求失败，请重试。':state==='incomplete'?'候选尚未完整读取或审阅，暂不能判断本层是否有合适资源。':members.length>=3?'':members.length?`本轮排序候选审阅后，本层仅保留${members.length}个符合条件的资源。`:available===0?'完整目录属性筛选未找到满足本层必要条件的资源。':'本轮排序候选均已审阅，尚无满足本层要求的资源；其他目录条目未经过模型分类。';
    return {role,display_name,status:state,reason_summary:reason,available_count:available,classified_count:members.length,candidate_ids:members.map(c=>c.candidate_id),auxiliary_candidate_ids:candidates.filter(c=>c.auxiliary_roles.includes(role)).map(c=>c.candidate_id)};
  });
  const selectionLimitations:string[]=[];
  if(attach&&selectionBasis==='semantic'&&selectedIds.length<SUGGESTION_TARGET_COUNT){
    const eligibleOutlets=new Set(candidates.filter(c=>c.semantic_decision_validated&&c.selection==='recommended'&&String(c.topic_fit)!=='weak').map(c=>String(c.outlet_key)));
    if(eligibleOutlets.size>selectedIds.length)selectionLimitations.push(`本次推荐 ${selectedIds.length} 个媒体渠道，另有 ${eligibleOutlets.size-selectedIds.length} 个合格独立载体未入选；可重新生成补足至 ${SUGGESTION_TARGET_COUNT} 个。`);
  }
  if(droppedSelected.length)selectionLimitations.push(`${droppedSelected.length} 个模型入选媒体未通过校验，已按已验证顺序保留其余推荐。`);
  void unprocessedList;
  return {schema_version:'1.0',matrix_version:p.matrix_version,status,source_analysis:clone(a),data_quality:clone(a.data_quality),scope:{task:clone(r.task),evidence_scope:clone(a.scope)},matrix:{status,candidates,layers:legacy?layers:[],fit_order:order,coverage_kind:'semantic_relevance',coverage,suggestions,industry_ranking:p.industry_ranking},research_only:candidates.filter(c=>c.channel_status==='research_only'),pending_items:candidates.filter(c=>c.pending_conditions.length||c.manuscript_status==='needs_manuscript_check').map(c=>({candidate_id:c.candidate_id,conditions:c.pending_conditions,manuscript_status:c.manuscript_status})),limitations:unique([...p.limitations,...selectionLimitations,...(catalogIncomplete?['catalog_scan_incomplete']:[]),...(modelStatus==='incomplete'?['model_classification_incomplete']:[]),...(status==='partial'?['model_classification_partial']:[])]),errors,budget_plans:[]};
}
