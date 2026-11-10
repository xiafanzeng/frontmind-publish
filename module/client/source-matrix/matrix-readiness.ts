import type {Candidate,MatrixResult} from './types';

export const matrixRoles=['authority','industry','regional','supplement','exploration'] as const;

/** 2026.11.10-web.1 result shape: an ordered ≤20 deduplicated outlet selection. */
export function hasSuggestions(matrix:MatrixResult['matrix']):boolean {
 return Array.isArray(matrix.suggestions?.selected_candidate_ids);
}

/** The stage-1 deliverable view: the ≤20 selected outlets in recommendation
 * order, the remaining evaluated candidates (候选清单), and supplier ranking
 * names that matched no catalogue resource (reference-only 信源参考). */
export function suggestionGroups(matrix:MatrixResult['matrix']) {
 const selectedIds=matrix.suggestions?.selected_candidate_ids??[];
 const selectedSet=new Set(selectedIds);
 const byId=new Map(matrix.candidates.map(candidate=>[candidate.candidate_id,candidate]));
 const selected=selectedIds.flatMap(id=>{const candidate=byId.get(id);return candidate?[candidate]:[];});
 const others=matrix.candidates.filter(candidate=>!selectedSet.has(candidate.candidate_id)&&candidate.semantic_decision_validated);
 return {selected,others,target:matrix.suggestions?.target_count??20,unmatched:matrix.industry_ranking?.unmatched??[],rankingStatus:matrix.industry_ranking?.status??null,rankingMessage:matrix.industry_ranking?.message??null,matchedRankCount:matrix.industry_ranking?.matched_count??0};
}

/** Legacy five-layer grouping for results saved before 2026.11.10-web.1 and the
 * bundled demo sample; new results render through suggestionGroups instead. */
export function matrixCandidateGroups(matrix:MatrixResult['matrix']) {
 const rank=new Map(matrix.fit_order.map((id,index)=>[id,index]));
 const assigned=new Set<string>();
 const decided=matrix.status==='complete'||matrix.status==='partial';
 return matrixRoles.map(role=>{
  const layer=matrix.layers.find(value=>value.role===role);
  const layerRank=new Map((layer?.candidate_ids??[]).map((id,index)=>[id,index]));
  // Current server lists are independently ranked per layer. Archives retain fit_order.
  const hasLayerRanking=matrix.candidates.some(candidate=>candidate.primary_role===role&&candidate.layer_rank!=null);
  const ordered=[...matrix.candidates].sort((a,b)=>hasLayerRanking?(layerRank.get(a.candidate_id)??Infinity)-(layerRank.get(b.candidate_id)??Infinity)||(a.layer_rank??Infinity)-(b.layer_rank??Infinity):(rank.get(a.candidate_id)??Infinity)-(rank.get(b.candidate_id)??Infinity));
  const layerResources=new Set<string>();
  const items=decided?ordered.filter(candidate=>{
   if(assigned.has(candidate.candidate_id)||!(candidate.primary_role===role||!candidate.primary_role&&layer?.candidate_ids.includes(candidate.candidate_id)))return false;
   if(candidate.resource_id&&layerResources.has(candidate.resource_id))return false;
   assigned.add(candidate.candidate_id);if(candidate.resource_id)layerResources.add(candidate.resource_id);return true;
  }):[];
  const state=layer?.status==='failed'?'failed':layer?.status==='incomplete'?'incomplete':layer?.status==='loading'||matrix.coverage?.model?.status==='pending'?'loading':layer?.status==='not_applicable'?'not_applicable':matrix.coverage?.catalog?.status==='failed'||matrix.coverage?.model?.status==='failed'?'failed':matrix.coverage?.catalog?.status==='incomplete'||matrix.coverage?.model?.status==='incomplete'?'incomplete':'complete';
  const defaultGap=state==='failed'?'本层候选读取失败，请重新生成。':state==='loading'?'正在读取本层候选…':state==='incomplete'?'本层候选数据尚未完整，不能判断是否没有合适媒体。':state==='not_applicable'?'当前投放要求不适用本层。':'没有符合本层条件的候选。';
  return {role,items,state,gap:layer?.reason_summary||defaultGap};
 });
}

/** Selectable/inclusion counts work in both shapes: suggestions first, legacy layers otherwise. */
export function selectableCandidates(matrix:MatrixResult['matrix']):Candidate[] {
 if(hasSuggestions(matrix)){const groups=suggestionGroups(matrix);return [...groups.selected,...groups.others];}
 return matrixCandidateGroups(matrix).flatMap(group=>group.items);
}

export function matrixReadiness(matrix:MatrixResult['matrix'],taskState?:string) {
 const complete=matrix.status==='complete';
 /* A validated subset is viewable and usable: partial keeps every decided
  * candidate visible with real counts; the coverage stays explicit. */
 const partial=matrix.status==='partial';
 const coverage=matrix.coverage?.model;
 const unprocessedCount=(coverage?.unprocessed_candidates??0)+(coverage?.failed_candidates??0);
 const decidedCount=complete||partial?selectableCandidates(matrix).length:null;
 const selectedCount=hasSuggestions(matrix)?(matrix.suggestions?.selected_candidate_ids.length??0):null;
 const message=complete?'':taskState==='running'?'正在生成媒体渠道推荐…':taskState==='cancelled'?'生成已取消，可重新生成矩阵。':matrix.status==='invalid_decisions'?(coverage?.reason==='run_interrupted'?'生成进程中断，结果未保存；请重新生成矩阵。':'媒体渠道推荐未通过校验，请重新生成矩阵。'):partial?`媒体推荐部分完成：已验证 ${decidedCount??0} 项，另有 ${unprocessedCount} 项未完成；可直接基于已验证候选生成组合，或重试未完成项。`:'媒体渠道推荐未完成，请重新生成矩阵。';
 return {complete,partial,unprocessedCount,poolCount:matrix.candidates.length,classifiedCount:decidedCount,selectedCount,message};
}
