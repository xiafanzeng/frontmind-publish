import type {MatrixResult} from './types';

export const matrixRoles=['authority','industry','regional','supplement','exploration'] as const;

/** The heading and table share assignment rules; a raw pool is never a layer. */
export function matrixCandidateGroups(matrix:MatrixResult['matrix']) {
 const rank=new Map(matrix.fit_order.map((id,index)=>[id,index]));
 const ordered=[...matrix.candidates].sort((a,b)=>(rank.get(a.candidate_id)??Infinity)-(rank.get(b.candidate_id)??Infinity));
 const assigned=new Set<string>();
 return matrixRoles.map(role=>{
  const layer=matrix.layers.find(value=>value.role===role);
  const items=matrix.status==='complete'?ordered.filter(candidate=>{
   if(assigned.has(candidate.candidate_id)||!(candidate.primary_role===role||!candidate.primary_role&&layer?.candidate_ids.includes(candidate.candidate_id)))return false;
   assigned.add(candidate.candidate_id);return true;
  }):[];
  return {role,items,gap:layer?.reason_summary};
 });
}

export function matrixReadiness(matrix:MatrixResult['matrix'],taskState?:string) {
 const complete=matrix.status==='complete';
 const message=complete?'':taskState==='running'?'正在生成推荐分层…':taskState==='cancelled'?'生成已取消，可重新生成矩阵。':matrix.status==='invalid_decisions'?'推荐分层未通过校验，请重新生成矩阵。':'推荐分层未完成，请重新生成矩阵。';
 return {complete,poolCount:matrix.candidates.length,classifiedCount:complete?matrixCandidateGroups(matrix).reduce((sum,group)=>sum+group.items.length,0):null,message};
}
