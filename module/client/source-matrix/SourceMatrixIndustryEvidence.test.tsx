// @vitest-environment jsdom
// Source-only display regressions. Execute only in the final integrated workspace.
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {RecommendationReason} from './MatrixRecommendation';
import {Report,referencedIndustryAggregates} from './SourceMatrixPresentation';
import {matrixDemo} from './demo';
import type {Candidate,Json,MatrixResult} from './types';

HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
afterEach(cleanup);
const aggregate=(id:string,name:string):Json=>({aggregate_id:id,aggregate_scope:'industry_distribution',source_id:'synthetic-public-provider',source_type:'external_data',data_version:'frozen-v1',unit:'citation_count',count:'9007199254740993',dimension:'source_type',bucket:{code:id,name},scope:{industry:'真实行业',scopeType:'CATEGORY',scopeId:'42',periodType:'DAY',date:'2026-10-28',modelCode:'public-model'}});
function fixture(status='partial'):{result:MatrixResult;candidate:Candidate}{
 const candidate:Candidate={...matrixDemo.result.matrix.candidates[0]!,candidate_id:'candidate-display',attributes:{source_name:'展示测试媒体'},evidence_ids:[],aggregate_ids:['media-aggregate'],industry_aggregate_ids:['global-used','global-unused'],references:[{type:'aggregate',aggregate_id:'global-used',usage:'industry_context'},{type:'aggregate',aggregate_id:'global-used',usage:'industry_context'},{type:'aggregate',aggregate_id:'global-disallowed',usage:'industry_context'}]};
 const result:MatrixResult={...matrixDemo.result,scope:{...matrixDemo.result.scope,task:{industry:'真实行业',industry_context:{status,message:'仅类型分布完整',industry_name:'真实行业',query:{scopeType:'CATEGORY',scopeId:'42',periodType:'DAY',date:'2026-10-28',modelCode:'public-model'},fetched_at:'2026-11-07T00:00:00Z',data_version:'frozen-v1',limitations:['发布时间分布缺失'],aggregates:[aggregate('global-used','实际引用桶'),aggregate('global-unused','未引用可用桶'),aggregate('global-disallowed','不属于候选的桶')]}}},source_analysis:{...matrixDemo.result.source_analysis,known_detail_count:7,detail_citations:[],external_aggregates:[{aggregate_id:'media-aggregate',name:'媒体关联汇总'}]},matrix:{status:'complete',candidates:[candidate],layers:[{role:'industry',display_name:'行业核心',status:'populated',candidate_ids:[candidate.candidate_id],auxiliary_candidate_ids:[]}],fit_order:[candidate.candidate_id]},budget_plans:[],content_plans:[]};
 return {result,candidate};
}
it('resolves only actual cited and candidate-declared global buckets from the frozen snapshot',()=>{
 const {result,candidate}=fixture();expect(referencedIndustryAggregates(result,candidate)).toEqual([aggregate('global-used','实际引用桶')]);
 expect(referencedIndustryAggregates(result,{...candidate,references:[]})).toEqual([]);
 expect(referencedIndustryAggregates(result,{...candidate,industry_aggregate_ids:[]})).toEqual([]);
 expect(referencedIndustryAggregates(null,candidate)).toEqual([]);
});
it('keeps global industry references separate from media-associated evidence in the reason dialog',()=>{
 const {result,candidate}=fixture();render(<RecommendationReason candidate={candidate} result={result} onClose={vi.fn()}/>);
 expect(screen.getByText(/实际引用证据 0 项 · 媒体关联行业依据 1 项 · 实际引用行业整体分布 1 项/)).toBeTruthy();
 expect(screen.getByRole('heading',{name:'行业整体分布参考（非该媒体引用）'})).toBeTruthy();
 expect(screen.getByText('实际引用桶')).toBeTruthy();expect(screen.getByText('媒体关联汇总')).toBeTruthy();
 expect(screen.queryByText('未引用可用桶')).toBeNull();expect(screen.queryByText('不属于候选的桶')).toBeNull();
});
it('reports snapshot status, range, timestamp, version and limitations without merging citation totals',()=>{
 const {result}=fixture();render(<Report result={result}/>);
 expect(screen.getByText(/引用记录 7 条；媒体关联行业依据 1 条/)).toBeTruthy();
 expect(screen.getByText(/状态：行业数据不完整/)).toBeTruthy();expect(screen.getByText(/行业范围 ID：42/)).toBeTruthy();
 expect(screen.getByText(/2026-10-28/)).toBeTruthy();expect(screen.getAllByText(/frozen-v1/).length).toBeGreaterThan(0);
 expect(screen.getByText('发布时间分布缺失')).toBeTruthy();expect(screen.getByText(/候选实际引用行业整体统计 1 项/)).toBeTruthy();
 expect(screen.getByText(/实际引用桶/)).toBeTruthy();expect(screen.queryByText(/未引用可用桶/)).toBeNull();
});
it('reports missing industry evidence as unavailable without inventing a range or zero observations',()=>{
 const {result}=fixture();result.scope.task.industry_context={status:'mapping_unavailable',message:'行业映射未确认',query:null,fetched_at:null,data_version:null,aggregates:[],limitations:['请核对行业']};
 render(<Report result={result}/>);expect(screen.getByText(/行业依据暂不可用/)).toBeTruthy();expect(screen.getByText(/行业范围 ID：未提供/)).toBeTruthy();
 expect(screen.queryByText(/状态：已结合真实行业分布/)).toBeNull();expect(screen.getByText('请核对行业')).toBeTruthy();
});
