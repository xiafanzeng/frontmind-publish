import {describe,expect,it} from 'vitest';
import {hasSuggestions,matrixCandidateGroups,matrixReadiness,suggestionGroups} from './matrix-readiness';
import type {Candidate,MatrixResult} from './types';

const candidate=(id:string,role:string|null)=>({candidate_id:id,primary_role:role} as Candidate);
const matrix=(status:string)=>({status,candidates:[candidate('a','authority'),candidate('b',null),candidate('c',null)],layers:[{role:'industry',candidate_ids:['b']}],fit_order:['b','a']} as MatrixResult['matrix']);

describe('matrix readiness and counts',()=>{
 it('keeps a running candidate pool distinct from completed recommendations',()=>{
  expect(matrixReadiness(matrix('needs_ai_decisions'),'running')).toMatchObject({complete:false,poolCount:3,classifiedCount:null,message:'正在生成媒体渠道推荐…'});
 });
 it('does not turn failed semantic validation into five confirmed empty layers',()=>{
  expect(matrixReadiness(matrix('invalid_decisions'),'completed')).toMatchObject({complete:false,classifiedCount:null,message:'媒体渠道推荐未通过校验，请重新生成矩阵。'});
  expect(matrixCandidateGroups(matrix('invalid_decisions')).every(group=>!group.items.length)).toBe(true);
 });
 it('counts exactly the same primary-layer assignment that the table renders',()=>{
  const value=matrix('complete');
  expect(matrixCandidateGroups(value).flatMap(group=>group.items.map(item=>item.candidate_id))).toEqual(['a','b']);
  expect(matrixReadiness(value,'completed')).toMatchObject({complete:true,poolCount:3,classifiedCount:2,message:''});
 });
 it('a failed or cancelled generation is not still described as running',()=>{
  expect(matrixReadiness(matrix('needs_ai_decisions'),'failed').message).toBe('媒体渠道推荐未完成，请重新生成矩阵。');
  expect(matrixReadiness(matrix('needs_ai_decisions'),'cancelled').message).toBe('生成已取消，可重新生成矩阵。');
 });
 it('reports a real completed empty matrix as zero and never duplicates a primary candidate',()=>{
  const value=matrix('complete');value.candidates=[];value.layers=[];
  expect(matrixReadiness(value,'completed').classifiedCount).toBe(0);
  value.candidates=[candidate('a','authority')];value.layers=[{role:'industry',candidate_ids:['a']} as MatrixResult['matrix']['layers'][number]];
  expect(matrixCandidateGroups(value).flatMap(group=>group.items)).toHaveLength(1);
 });
});

it('exposes the ≤20 ordered outlet selection with the remaining candidate list',()=>{
 const value={status:'complete',candidates:[candidate('a',null),candidate('b',null),candidate('c',null)].map(item=>({...item,semantic_decision_validated:true})),layers:[],fit_order:['a','b','c'],suggestions:{target_count:20,dedup:'outlet_key',basis:'semantic',selected_candidate_ids:['b','a']},industry_ranking:{status:'ok',message:null,source:null,query:null,fetched_at:null,matched_count:1,matched_candidate_ids:['c'],unmatched:[{rank:3,code:null,name:'未匹配媒体',citation_count:'12'}]}} as unknown as MatrixResult['matrix'];
 expect(matrixReadiness(value,'completed')).toMatchObject({complete:true,poolCount:3,classifiedCount:3,selectedCount:2});
 expect(hasSuggestions(value)).toBe(true);
 const groups=suggestionGroups(value);
 expect(groups.selected.map(item=>item.candidate_id)).toEqual(['b','a']);
 expect(groups.others.map(item=>item.candidate_id)).toEqual(['c']);
 expect(groups.unmatched).toHaveLength(1);
});

it('uses the real per-layer order and removes duplicate candidate identities',()=>{
 const value={...matrix('complete'),candidates:[{...candidate('a','industry'),layer_rank:2},{...candidate('b','industry'),layer_rank:1},{...candidate('b','industry'),layer_rank:1}],fit_order:['a','b'],layers:[{role:'industry',candidate_ids:['b','a'],status:'populated'}]} as MatrixResult['matrix'];
 expect(matrixCandidateGroups(value).find(group=>group.role==='industry')?.items.map(item=>item.candidate_id)).toEqual(['b','a']);
});
it('distinguishes failed, incomplete, loading and completed empty layers',()=>{
 for(const [status,state] of [['failed','failed'],['incomplete','incomplete'],['loading','loading'],['empty','complete']]){
  const value={...matrix('complete'),candidates:[],layers:[{role:'industry',candidate_ids:[],status}]} as unknown as MatrixResult['matrix'];
  expect(matrixCandidateGroups(value).find(group=>group.role==='industry')).toMatchObject({state,items:[]});
 }
});
