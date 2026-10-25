// @vitest-environment jsdom
// Regression source only. Execution is intentionally left to the integrating checkout.
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BudgetRecommendations,MatrixRecommendation,differentPlans} from './MatrixRecommendation';
import type {BudgetPlan,Candidate,MatrixResult} from './types';
afterEach(cleanup);
const candidate=(id:string,role:string|null):Candidate=>({candidate_id:id,resource_id:null,attributes:{source_name:id},offers:[],primary_role:role,auxiliary_roles:['supplement'],selection:'recommended',matched_questions:['q1'],reason_summary:'适配当前目标问题',channel_status:'research_only',manuscript_status:'needs_manuscript_check',hard_failures:[],pending_conditions:[],evidence_relation:'platform_related',evidence_ids:[],aggregate_ids:[]});
const plan=(resource:string,offer='quote-1'):BudgetPlan=>({strategy:resource,reason_summary:'当前矩阵内的组合',status:'complete',currency:'CNY',total_cost:'100.00',exploration_cost:'0.00',known_total_cost:'100.00',total_cap:'200.00',total_remaining:'100.00',exploration_remaining:'0.00',budget_feasible:true,manuscript_status:'needs_manuscript_check',ready_to_publish:false,execution_recommended:false,is_estimate:false,unknown_items:[],items:[{resource_id:resource,offer_id:offer,article_id:'article',version:'1',quantity:1,purpose:'standard',publication_spec:{channel:'news'}}],errors:[],semantic_pending:[]});
const result={matrix_version:'matrix-1',matrix:{status:'complete',candidates:[candidate('A','authority'),candidate('B','authority'),candidate('research',null)],layers:[{role:'authority',candidate_ids:['A','B']},{role:'supplement',candidate_ids:['A']}],fit_order:['B','A','research']}} as MatrixResult;
it('shows all five layers and hides undecided candidates instead of a research list',()=>{
 render(<MatrixRecommendation result={result} highlightedPlan={null} mediaFor={()=>undefined} isSelected={()=>false} issue={()=>''} onToggle={vi.fn()} onDetails={vi.fn()} onMediaDetails={vi.fn()} onLayer={vi.fn()}/>);
 expect(screen.getByRole('heading',{name:'权威参考层'})).toBeTruthy();expect(screen.getByRole('heading',{name:'探索验证层'})).toBeTruthy();
 expect(screen.getAllByText('暂无合适候选；当前依据不足，保留本层缺口。')).toHaveLength(4);
 // 无主层决定的候选不再进入页面（需求：删除未分层列表）
 expect(screen.getAllByRole('heading',{level:4}).map(node=>node.textContent)).toEqual(['B','A']);
 expect(screen.queryByText('待判断与研究候选')).toBeNull();
 expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.getAllByRole('button',{name:'查看推荐理由'})).toHaveLength(2);
});
it('keeps quotation identity when comparing combinations and limits to three distinct combinations',()=>{
 const first=plan('A'),duplicate=structuredClone(first),anotherQuote=plan('A','quote-2'),second=plan('B'),fourth=plan('C');
 expect(differentPlans([first,duplicate,anotherQuote,second,fourth])).toEqual([first,anotherQuote,second]);
});
it('switching a combination only requests comparison; it never applies or toggles cart items',()=>{
 const compare=vi.fn(),apply=vi.fn();
 render(<BudgetRecommendations plans={[plan('A'),plan('B')]} candidates={result.matrix.candidates} selectedIndex={0} onSelect={compare} onApply={apply} onDetails={vi.fn()} disabled={false} stale={false}><p>预算输入</p></BudgetRecommendations>);
 fireEvent.click(screen.getByRole('button',{name:/组合 2/}));expect(compare).toHaveBeenCalledWith(1);expect(apply).not.toHaveBeenCalled();
 expect(screen.getByText(/待预检 \/ 不可直接执行/)).toBeTruthy();
});
