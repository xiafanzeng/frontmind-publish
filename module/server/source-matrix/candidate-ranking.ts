import { normalizeMatrixRegion } from '../../shared/matrix-requirements.js';
import { equal, list, object, roles, type Row } from './common.js';

/** These are retrieval limits, never catalogue or classification coverage claims. */
export const CATALOG_CANDIDATES_PER_LAYER = 24;
const values = (v: unknown): string[] => list(v).flatMap(s => s.split(/[、,，;；\n|/]+/u)).map(s => s.trim()).filter(Boolean);
const normalized = (v: unknown) => values(v).map(normalizeMatrixRegion);
export function regionalApplicable(task: Row): boolean {
  return normalized(task.regions).some(value => !['全国','全国范围','不限','nationwide'].includes(value));
}
export function catalogChannelChecks(row: Row, task: Row): { fail: string[]; pending: string[] } {
  const fail: string[] = [], pending: string[] = [];
  if (['unavailable','inactive','closed','not_for_sale','suspended'].includes(row.publication_status)) fail.push('publication_unavailable');
  else if (row.publication_status !== 'available') pending.push('publication_status_unknown');
  const checks: Record<string,string> = { formats:'supported_formats', links:'supports_links', images:'supports_images', video:'supports_video', tables:'supports_tables' };
  for (const [key, expected] of Object.entries(task.requirements ?? {})) {
    if (expected === null || expected === false || equal(expected, []) || equal(expected, {})) continue;
    const attribute = checks[key], actual = attribute ? row[attribute] : null;
    if (!attribute || actual == null) pending.push('unknown_requirement:' + key);
    else if (key === 'formats' ? !list(expected).every(item => list(actual).includes(item)) : !equal(actual, expected)) fail.push('unsupported:' + key);
  }
  if (row.allowed_industries != null && !list(row.allowed_industries).includes(task.industry)) fail.push('industry_not_allowed');
  if (list(row.prohibited_industries).includes(task.industry)) fail.push('industry_prohibited');
  const regions = normalized(task.regions);
  if (regionalApplicable(task) && row.restricted_regions != null && !regions.every(region => normalized(row.restricted_regions).includes(region))) fail.push('region_not_allowed');
  for (const condition of row.hard_conditions ?? []) {
    if (!object(condition)) pending.push('invalid_hard_condition');
    else if (condition.status === 'fail') fail.push(condition.rule_id ?? 'hard_condition_failed');
    else if (condition.status !== 'pass') pending.push(condition.rule_id ?? 'hard_condition_unknown');
  }
  return { fail, pending };
}
/** Provider metadata is a traceable statement, not independently verified authority.
 * A media name, citation count, or an industry distribution alone is insufficient. */
export function authorityBasis(attributes: Row): string[] {
  const fields: string[] = [];
  if (attributes.authority_verified === true && values(attributes.authority_evidence).length) fields.push('authority_evidence');
  const official = /政府|政务|党报|党刊|央媒|中央媒体|中央新闻|国家通讯社|官方机构|学术期刊|学术机构|科研机构|government|public institution|academic journal/iu;
  for (const key of ['authority_type','taxonomy','media_type','authentication_description','media_intro','description']) {
    if (typeof attributes[key] === 'string' && official.test(attributes[key])) fields.push(key);
  }
  if (typeof attributes.domain === 'string' && /(?:^|\.)gov\.cn$|(?:^|\.)edu\.cn$|(?:^|\.)gov$/iu.test(attributes.domain.trim())) fields.push('domain');
  return [...new Set(fields)];
}
/** Token overlap only retrieves possible matches. It never assigns final roles,
 * invents a media score, or turns a preference into a publication hard condition. */
function tokens(value: string): Set<string> {
  const result = new Set<string>();
  for (const part of value.toLowerCase().match(/[a-z0-9]{2,}|[\p{Script=Han}]+/gu) ?? []) {
    if (/^[a-z0-9]/u.test(part)) result.add(part);
    else for (let index = 0; index < part.length - 1; index++) result.add(part.slice(index,index+2));
  }
  return result;
}
const overlap = (query: Set<string>, content: Set<string>) => [...query].reduce((count, token) => count + (content.has(token) ? 1 : 0), 0);
export function createCandidateRanker(task: Row) {
  const industry = String(task.industry ?? '').trim().toLowerCase();
  const industryTokens = tokens(industry);
  const context = [task.product,task.audience,...(task.questions ?? []).map((q:Row) => q.text),...(task.manuscripts ?? []).flatMap((m:Row) => [m.title,m.article_title,String(m.content_excerpt ?? '').slice(0,4000)])].filter(v => typeof v === 'string').join(' ');
  const contextTokens = tokens(context), targetRegions = normalized(task.regions), targetPlatforms = values(task.target_platforms);
  return (candidate: Row) => {
    const attributes: Row = candidate.attributes ?? candidate;
    const checks = catalogChannelChecks(attributes, task);
    const hardFailures: string[] = candidate.hard_failures ?? checks.fail;
    const semantic = [attributes.industry,...values(attributes.industries),attributes.taxonomy,attributes.media_type,attributes.media_intro,attributes.description,attributes.source_name,attributes.name].filter(v => typeof v === 'string').join(' ').toLowerCase();
    const corpus = tokens(semantic), industryHits = overlap(industryTokens,corpus), contextHits = overlap(contextTokens,corpus);
    const taxonomy = [attributes.industry,...values(attributes.industries),attributes.taxonomy].filter(v => typeof v === 'string').join(' ').toLowerCase();
    const explicitIndustry = !!industry && taxonomy.includes(industry);
    const coverage = normalized(attributes.regions ?? attributes.region_coverage ?? attributes.area);
    const regionMatches = regionalApplicable(task) ? targetRegions.filter(region => coverage.includes(region)).length : 0;
    const platformMatches = targetPlatforms.some(platform => values(attributes.platform).includes(platform)) ? 1 : 0;
    const authority = authorityBasis(attributes);
    const relevant = explicitIndustry || industryHits > 0 || contextHits > 0;
    const enoughDescription = !!semantic.trim();
    const allowed = !hardFailures.length && candidate.channel_status !== 'ineligible';
    const eligible: Record<string,boolean> = {
      authority: allowed && authority.length > 0,
      industry: allowed && relevant,
      regional: allowed && regionalApplicable(task) && regionMatches > 0,
      supplement: allowed && enoughDescription,
      exploration: allowed && enoughDescription,
    };
    const evidence = (candidate.evidence_ids ?? []).length > 0 ? 1 : 0;
    const confidence = (candidate.pending_conditions ?? checks.pending).length === 0 ? 1 : 0;
    const relevance = [explicitIndustry ? 1 : 0,industryHits,contextHits,platformMatches,regionMatches,evidence,confidence];
    const rank: Record<string,number[]> = {
      authority: [authority.length > 0 ? 1 : 0,...relevance], industry: relevance,
      regional: [regionMatches,...relevance], supplement: [...relevance], exploration: [...relevance],
    };
    return { eligible, rank, hardFailures, authorityFields: authority };
  };
}
export function compareCandidateRanks(a: { rank: number[]; id: string }, b: { rank: number[]; id: string }): number {
  for (let index=0;index<Math.max(a.rank.length,b.rank.length);index++) {
    const difference=(b.rank[index] ?? 0)-(a.rank[index] ?? 0); if (difference) return difference;
  }
  return a.id.localeCompare(b.id);
}
/** The bounded reservoir is updated for every resource in every DB page. */
export function createCatalogReservoir(task: Row, perLayer = CATALOG_CANDIDATES_PER_LAYER) {
  const ranker=createCandidateRanker(task);
  const ranked: Record<string,Array<{id:string;rank:number[];rows:Row[]}>>=Object.fromEntries(Object.keys(roles).map(role=>[role,[]]));
  const eligibleByRole: Record<string,number>=Object.fromEntries(Object.keys(roles).map(role=>[role,0]));
  const excludedByReason: Record<string,number>={};
  return {
    offer(resourceRows:Row[]) {
      if (!resourceRows.length) return;
      const row=resourceRows[0]!,id=String(row.resource_id??''); if (!id) return;
      const result=ranker(row);
      for (const reason of result.hardFailures) excludedByReason[reason]=(excludedByReason[reason]??0)+1;
      for (const role of Object.keys(roles)) {
        if (!result.eligible[role]) continue;
        eligibleByRole[role]=(eligibleByRole[role]??0)+1;
        const entries=ranked[role]!; const item={id,rank:result.rank[role]!,rows:resourceRows};
        if (entries.length>=perLayer && compareCandidateRanks(item,entries[entries.length-1]!)>=0) continue;
        const existing=entries.findIndex(entry=>entry.id===id); if(existing>=0) entries.splice(existing,1);
        entries.push(item); entries.sort(compareCandidateRanks); if(entries.length>perLayer)entries.pop();
      }
    },
    finish() {
      const resources=new Map<string,Row[]>();
      for (const entries of Object.values(ranked)) for (const item of entries) resources.set(item.id,item.rows);
      return { catalog:[...resources.entries()].sort(([a],[b])=>a.localeCompare(b)).flatMap(([,rows])=>rows),shortlisted_resources:resources.size,eligible_by_role:eligibleByRole,excluded_by_reason:excludedByReason,
        shortlist_by_role:Object.fromEntries(Object.entries(ranked).map(([role,entries])=>[role,entries.map(entry=>'resource:'+entry.id)])) };
    },
  };
}
/** Review the entire retained pool; core candidates lead so later batches can
 * refer to real validated core anchors. This does not assign semantic roles. */
export function orderMatrixCandidates(task: Row, candidates: Row[]): Row[] {
  const ranker=createCandidateRanker(task), evaluated=candidates.map(candidate=>({candidate,result:ranker(candidate)}));
  const ordered:Row[]=[],seen=new Set<string>();
  const lists=Object.keys(roles).map(role=>evaluated.filter(item=>item.result.eligible[role]).map(item=>({id:item.candidate.candidate_id,rank:item.result.rank[role]!,candidate:item.candidate})).sort(compareCandidateRanks));
  for(let index=0;lists.some(items=>index<items.length);index++)for(const items of lists){const item=items[index];if(item&&!seen.has(item.id)){seen.add(item.id);ordered.push(item.candidate);}}
  for(const candidate of candidates)if(!seen.has(candidate.candidate_id)){seen.add(candidate.candidate_id);ordered.push(candidate);}
  return ordered;
}
export function mergeRankedDecisions(task:Row,candidates:Row[],items:Row[]):Row[] {
  const ranker=createCandidateRanker(task),byId=new Map(candidates.map(candidate=>[candidate.candidate_id,candidate]));
  return Object.keys(roles).flatMap(role=>items.filter(item=>item.primary_role===role).map((item,index)=>({item,index,id:item.candidate_id,rank:ranker(byId.get(item.candidate_id)??{}).rank[role]!})).sort((a,b)=>{
    for(let index=0;index<a.rank.length;index++){const difference=b.rank[index]!-a.rank[index]!;if(difference)return difference;}
    return a.index-b.index||a.id.localeCompare(b.id);
  }).map((entry,index)=>({...entry.item,layer_rank:index+1})));
}
