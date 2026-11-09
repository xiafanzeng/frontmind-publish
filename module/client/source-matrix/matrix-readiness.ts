import type {MatrixResult} from './types';

export const matrixRoles=['authority','industry','regional','supplement','exploration'] as const;

/** The heading and table share assignment rules; a raw pool is never a layer. */
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

export function matrixReadiness(matrix:MatrixResult['matrix'],taskState?:string) {
 const complete=matrix.status==='complete';
 /* A validated subset is viewable and usable: partial keeps every decided
  * candidate visible with real counts; the coverage stays explicit. */
 const partial=matrix.status==='partial';
 const coverage=matrix.coverage?.model;
 const unprocessedCount=(coverage?.unprocessed_candidates??0)+(coverage?.failed_candidates??0);
 const decidedCount=complete||partial?matrixCandidateGroups(matrix).reduce((sum,group)=>sum+group.items.length,0):null;
 const message=complete?'':taskState==='running'?'正在生成推荐分层…':taskState==='cancelled'?'生成已取消，可重新生成矩阵。':matrix.status==='invalid_decisions'?(coverage?.reason==='run_interrupted'?'生成进程中断，结果未保存；请重新生成矩阵。':'推荐分层未通过校验，请重新生成矩阵。'):partial?`推荐分层部分完成：已验证 ${decidedCount??0} 项，另有 ${unprocessedCount} 项未完成；可直接基于已验证候选生成组合，或重试未完成项。`:'推荐分层未完成，请重新生成矩阵。';
 return {complete,partial,unprocessedCount,poolCount:matrix.candidates.length,classifiedCount:decidedCount,message};
}
