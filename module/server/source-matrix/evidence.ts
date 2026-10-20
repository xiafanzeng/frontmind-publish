import { calendarDay, clone, equal, stableJson, unique, type Row } from './common.js';
const scopeFields=['tenant_id','question_id','platform','model','model_version','period'];
export function normalizeUrl(v:unknown,config:Row={}):string|null {
  if(typeof v!=='string')return null;
  try {const u=new URL(v);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
    // URL validates the host; preserve the supplied path, semantic query and fragment.
    const parts=/^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(#.*)?$/i.exec(v);if(!parts)return null;
    const query=new URLSearchParams(parts[4]??'');for(const k of config.tracking_parameters??[])query.delete(k);
    const encoded=query.toString();return `${parts[1]!.toLowerCase()}://${parts[2]!.toLowerCase()}${parts[3]??''}${encoded?'?'+encoded:''}${parts[5]??''}`;
  }catch{return null;}
}
export function domain(r:Row):string {
  try {return r.citation_url||r.url?new URL(r.citation_url||r.url).hostname.toLowerCase().replace(/\.$/,''):typeof r.domain==='string'?r.domain.toLowerCase().replace(/\.$/,''):'';}catch{return '';}
}
export function matchIdentity(s:Row,r:Row,c:Row):Row {
  const ids=s.evidence_ids??(s.evidence_id?[s.evidence_id]:[]), result=(relation:string)=>({relation,evidence_ids:relation==='none'?[]:clone(ids)});
  if(s.source_type==='supplier_claim'||s.data_kind==='aggregate')return result('none');
  if(s.status==='identity_conflict')return result('unverified');
  const sd=domain(s),rd=domain(r);
  for(const f of ['account_id','channel_id','source_identity'])if(s[f]&&r[f]&&s[f]!==r[f])return result('unverified');
  const conflict=!!(sd&&rd&&sd!==rd);
  for(const m of c.confirmed_account_mappings??[])if(s.account_id&&s.account_id===m.account_id&&r.resource_id&&r.resource_id===m.resource_id&&sd&&sd===m.domain)return result(conflict?'unverified':'exact');
  const missing=['account_id','channel_id','source_name','source_identity'].some(f=>r[f]&&!s[f]);
  const names=[s.source_name,r.source_name];
  const alias=sd===rd&&(c.confirmed_aliases??[]).some((a:Row)=>a.domain===sd&&names.every(n=>n&&a.names?.includes(n)));
  const specific=!missing&&(!r.source_name||s.source_name===r.source_name||alias);
  const su=normalizeUrl(s.citation_url||s.url,c),ru=normalizeUrl(r.citation_url||r.url,c);
  if(su&&su===ru)return result(specific?'exact':'unverified');
  const platform=(c.platform_domains??[]).some((root:string)=>sd&&rd&&[sd,rd].every(d=>d===root||d.endsWith('.'+root)));
  if(conflict&&!platform)return result('unverified');
  const account=['account_id','channel_id','source_identity'].every(f=>!r[f]||s[f]===r[f]);
  if(sd&&sd===rd&&account&&specific&&((names[0]&&names[0]===names[1])||alias||((c.independent_domains??[]).includes(sd)&&!missing)))return result('exact');
  return result(platform?'platform_related':'unverified');
}
function recordScope(r:Row):Row {return Object.fromEntries(scopeFields.map(f=>[f,Object.hasOwn(r,f)?r[f]:r.scope?.[f]??null]));}
function identity(r:Row):Row {return {source_name:r.source_name??null,account_id:r.account_id??null,channel_id:r.channel_id??null,source_identity:r.source_identity??null,domain:domain(r)};}
function contentAge(details:Row[],scope:Row):Row {
  const out:Row={status:'missing_period_end',buckets:null,pending:[]};
  if(!scope.period?.end)return out;
  let end:number;try{end=calendarDay(scope.period.end);}catch{return {...out,status:'invalid_period_end'};}
  const intervals:Row[]=scope.content_age_intervals??[{label:'0–7',min_days:0,max_days:7},{label:'8–30',min_days:8,max_days:30},{label:'31–365',min_days:31,max_days:365},{label:'366–1095',min_days:366,max_days:1095},{label:'1096+',min_days:1096,max_days:null}];
  const buckets:Record<string,number>=Object.fromEntries(intervals.map(i=>[i.label,0]));
  for(const d of details){
    const values=unique(d.records.map((r:Row)=>r.published_at??null));let reason:string|null=null;
    if(values.length>1)reason='conflicting_publication_dates';else if(!values[0])reason='missing_publication_date';
    else {try {const days=end-calendarDay(values[0]);
      if(days<0)reason='future_publication_date';else {const hits=intervals.filter(i=>days>=i.min_days&&(i.max_days===null||days<=i.max_days));if(hits.length===1)buckets[hits[0]!.label]=(buckets[hits[0]!.label]??0)+1;else reason='invalid_interval_assignment';}
    }catch{reason='invalid_publication_date';}}
    if(reason)out.pending.push({reason,evidence_ids:d.evidence_ids,published_at_values:values});
  }
  const valid=Object.values(buckets).some(Boolean);
  return {...out,status:valid?'configured':'no_valid_publication_dates',reference_date:scope.period.end,buckets:valid?buckets:null,unknown_count:out.pending.length};
}
export function analyzeEvidence(records:Row[],scope:Row={},config:Row={}):Row {
  const aggregates:Row[]=[],unknown:Row[]=[],claims:Row[]=[],excluded:Row[]=[],details:Row[]=[];
  const seen=new Map<string,Row>(),groups=new Map<string,Row>(),identities=new Map<string,Row>();
  for(const original of records){const r=clone(original),values=recordScope(r);
    const context=r.data_kind==='aggregate'&&r.applicability?.kind==='industry_context';
    if((context?['tenant_id']:scopeFields).some(f=>f in scope&&values[f]!==null&&!equal(values[f],scope[f]))){excluded.push(r);continue;}
    if(r.source_type==='supplier_claim'){claims.push(r);continue;}
    if(r.data_kind==='aggregate'){aggregates.push(r);continue;}
    const url=normalizeUrl(r.citation_url,config),complete=r.data_kind==='detail'&&r.answer_record_id&&url&&scopeFields.every(f=>values[f]!==null&&values[f]!=='');
    const sk=stableJson(values);if(!groups.has(sk))groups.set(sk,{scope:values,citations:[],unknown_records:[]});const g=groups.get(sk)!;
    const ident=identity(r),ik=stableJson([values,ident]);if(!identities.has(ik))identities.set(ik,{scope:values,identity:ident,domain:ident.domain,records:[],citations:[],evidence_ids:[],status:'complete'});const row=identities.get(ik)!;
    row.records.push(r);if(r.evidence_id&&!row.evidence_ids.includes(r.evidence_id))row.evidence_ids.push(r.evidence_id);
    if(!complete){unknown.push(r);g.unknown_records.push(r);row.status='incomplete';continue;}
    const key=stableJson([values,r.answer_record_id,url]);
    if(!seen.has(key)){const d={scope:values,normalized_url:url,domain:domain(r),record:r,records:[],identity_variants:[],evidence_ids:[],status:'complete'};seen.set(key,d);details.push(d);g.citations.push(d);}
    const d=seen.get(key)!;d.records.push(r);if(!d.identity_variants.some((x:Row)=>equal(x,ident)))d.identity_variants.push(ident);
    if(d.identity_variants.length>1)d.status='identity_conflict';
    if(r.evidence_id&&!d.evidence_ids.includes(r.evidence_id))d.evidence_ids.push(r.evidence_id);
    if(!row.citations.includes(d))row.citations.push(d);
  }
  const rollups:Row[]=[];
  for(const g of groups.values()){
    const total=g.citations.length&&!g.unknown_records.length?g.citations.length:null;
    Object.assign(g,{total_citations:total,known_detail_count:g.citations.length});
    for(const host of unique<string>([...g.citations.map((d:Row)=>d.domain),...g.unknown_records.map(domain)]).sort()){
      const matching=g.citations.filter((d:Row)=>d.domain===host);rollups.push({scope:g.scope,domain:host,count:total===null?null:matching.length,share:total?matching.length/total:null,citations:matching});
    }
  }
  for(const row of identities.values()){
    const total=groups.get(stableJson(row.scope))!.total_citations;
    row.count=total!==null&&row.status==='complete'?row.citations.length:null;row.share=total&&row.count!==null?row.count/total:null;
    if(row.citations.some((d:Row)=>d.status==='identity_conflict'))row.status='identity_conflict';
  }
  const exact=!!details.length&&!unknown.length;
  return {scope:clone(scope),actual_sources:[...identities.values()],domain_rollups:rollups,detail_citations:details,groups:[...groups.values()],total_citations:exact&&groups.size===1?details.length:null,combined_summary:{scope_groups:groups.size,known_detail_count:details.length,total_citations:exact?details.length:null,share:null},known_detail_count:details.length,status:exact?'complete':unknown.length?'incomplete':'no_detail_data',unknown_records:unknown,external_aggregates:aggregates,supplier_claims:claims,excluded_records:excluded,content_age:contentAge(details,scope),data_quality:{exact_count_available:exact,aggregate_reconciliation:'not_performed'}};
}
