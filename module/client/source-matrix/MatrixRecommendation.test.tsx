// @vitest-environment jsdom
// Regression source only. Execution is intentionally left to the integrating checkout.
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BudgetRecommendations,CatalogResourceChoice,MatrixRecommendation,differentPlans} from './MatrixRecommendation';
import {formalItemDetail,mandatoryFeeText,planQuantity,samePublicationSpec} from './PlanningDetails';
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
it('shows three semantic candidates first and expands the rest without changing their order',()=>{
 const entries=['D','B','A','C'].map(id=>({...candidate(id,'industry'),media_intro:'专业软件技术媒体',content_direction:'本次采购问答选题'}));
 const extended={...result,matrix:{...result.matrix,candidates:entries,fit_order:['B','C','A','D'],layers:[{role:'industry',display_name:'行业核心',status:'complete',candidate_ids:entries.map(item=>item.candidate_id),auxiliary_candidate_ids:[]}]}};
 render(<MatrixRecommendation result={extended} highlightedPlan={null} mediaFor={()=>undefined} isSelected={()=>false} issue={()=>''} onToggle={vi.fn()} onDetails={vi.fn()} onMediaDetails={vi.fn()} onLayer={vi.fn()}/>);
 expect(screen.getAllByRole('heading',{level:4}).map(node=>node.textContent)).toEqual(['B','C','A']);
 expect(screen.queryByText('本次采购问答选题')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'更多候选（1）'}));
 expect(screen.getAllByRole('heading',{level:4}).map(node=>node.textContent)).toEqual(['B','C','A','D']);
 expect(screen.getByRole('button',{name:'收起候选'}).getAttribute('aria-expanded')).toBe('true');
});
it('does not auto-select the cheapest same-name resource and preserves explicit quote identity',()=>{
 const change=vi.fn(),research={...candidate('research','industry'),catalog_matches:[{resource_id:'account-a',source_name:'同名媒体',account_id:'账号甲',identity_relation:'suggested' as const,offers:[{offer_id:'a',publication_spec:'图文',pricing:{amount:'100.00',currency:'CNY'}}]},{resource_id:'account-b',source_name:'同名媒体',account_id:'账号乙',identity_relation:'suggested' as const,offers:[{offer_id:'b',publication_spec:'视频',pricing:{amount:'50.00',currency:'CNY'}}]}]};
 render(<CatalogResourceChoice candidate={research} onChange={change}/>);
 const select=screen.getByRole('combobox') as HTMLSelectElement;
 expect(select.value).toBe('');expect(change).not.toHaveBeenCalled();
 fireEvent.change(select,{target:{value:'1'}});
 expect(change).toHaveBeenCalledWith({candidate_id:'research',resource_id:'account-b',offer_id:'b',publication_spec:'视频'});
 expect(screen.getByText(/不证明该具体账号曾被引用/)).toBeTruthy();
});
it('shows the selected quotation instead of an unrelated lower offer, and never turns missing fees into zero',()=>{
 const row=plan('A','quote-2'),media={...candidate('media','industry'),resource_id:'A',offers:[{offer_id:'quote-1',publication_spec:{channel:'news'},pricing:{kind:'unit',amount:'10.00',currency:'CNY',mandatory_fees:[]}},{offer_id:'quote-2',publication_spec:{channel:'news'},pricing:{kind:'unit',amount:'40.00',currency:'CNY'}}]};
 expect(formalItemDetail(row,0,[media]).unit).toBe('CNY 40.00');
 expect(mandatoryFeeText(formalItemDetail(row,0,[media]).fees)).toBe('待确认');
 expect(mandatoryFeeText([])).toBe('无必要附加费（已确认）');
 expect(planQuantity([{quantity:3},{quantity:2}])).toBe(5);expect(planQuantity([{quantity:null}])).toBeNull();
 expect(samePublicationSpec({channel:'news',region:'全国'},{region:'全国',channel:'news'})).toBe(true);
 expect(formalItemDetail(row,0,[{...media,offers:[...media.offers,media.offers[1]!]}]).offer).toBeUndefined();
});
it('requires an explicit formal quantity review before a changed plan can be applied',async()=>{
 const update=vi.fn(async()=>true),apply=vi.fn(),value=plan('A');
 const media={...candidate('media','industry'),resource_id:'A'};
 render(<BudgetRecommendations plans={[value]} candidates={[media]} selectedIndex={0} onSelect={vi.fn()} onApply={apply} onDetails={vi.fn()} onUpdate={update} disabled={false} stale={false}><p>预算输入</p></BudgetRecommendations>);
 fireEvent.change(screen.getByLabelText('media正式发布篇数'),{target:{value:'3'}});
 expect((screen.getByRole('button',{name:'加入本组合'}) as HTMLButtonElement).disabled).toBe(true);
 expect(update).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'复核正式方案篇数'}));
 await waitFor(()=>expect(update).toHaveBeenCalledWith(value,[{item_index:0,candidate_id:'media',quantity:3}]));
 expect(apply).not.toHaveBeenCalled();
});
