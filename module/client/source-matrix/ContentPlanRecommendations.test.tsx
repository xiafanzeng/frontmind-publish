// @vitest-environment jsdom
// Test source only; run against the final integrated checkout.
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ContentPlanRecommendations} from './ContentPlanRecommendations';
import type {Candidate,ContentPlan} from './types';
afterEach(cleanup);
const candidate:Candidate={candidate_id:'c1',resource_id:null,attributes:{source_name:'专业来源'},offers:[],primary_role:'industry',auxiliary_roles:[],selection:'recommended',matched_questions:[],channel_status:'research_only',manuscript_status:'needs_manuscript_check',hard_failures:[],pending_conditions:[],evidence_relation:'unverified',evidence_ids:[],aggregate_ids:[]};
const plan:ContentPlan={schema_version:'content-planning/1.0',strategy:'采购问答',reason_summary:'围绕不同采购问题分配内容',explanation:null,kind:'research_content_plan',items:[{candidate_id:'c1',resource_id:null,offer_id:null,publication_spec:null,quantity:2,quantity_mode:'new_articles',quantity_reason:'两个不同问题分别展开',content_tasks:['资质核验','服务比较'],purpose:'standard',unit_price:null,cost:null,known_cost:null,pricing_status:'unconfirmed',mandatory_fees:null}],total_articles:2,currency:'CNY',known_total_cost:null,total_cost:null,total_remaining:null,total_cap:'3000.00',budget_feasible:null,ready_to_publish:false,execution_recommended:false,unknown_items:[{reasons:['price_unknown']}],errors:[]};
function mount(options:{stale?:boolean;value?:ContentPlan}={}) {const update=vi.fn(async()=>true);render(<ContentPlanRecommendations plans={[options.value??plan]} candidates={[candidate]} selectedIndex={0} onSelect={vi.fn()} onDetails={vi.fn()} onUpdate={update} disabled={false} stale={options.stale??false}><p>预算表单</p></ContentPlanRecommendations>);return update;}
it('edits suggested quantities only after explicit recalculation and never exposes a cart action',async()=>{
 const update=mount();fireEvent.change(screen.getByLabelText('专业来源建议篇数'),{target:{value:'3'}});
 expect(update).not.toHaveBeenCalled();expect(screen.getByText(/下方费用仍是上次复核结果/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'加入本组合'})).toBeNull();expect(screen.getByText('完整费用未知，尚不能确认预算可行')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'按修改篇数重新核算'}));
 await waitFor(()=>expect(update).toHaveBeenCalledWith(0,[{item_index:0,candidate_id:'c1',quantity:3}]));
});
it('rejects fractional quantities and prevents stale plans from recalculating',()=>{
 const update=mount();fireEvent.change(screen.getByLabelText('专业来源建议篇数'),{target:{value:'1.5'}});fireEvent.click(screen.getByRole('button',{name:'按修改篇数重新核算'}));
 expect(screen.getByRole('alert').textContent).toContain('正整数');expect(update).not.toHaveBeenCalled();cleanup();
 mount({stale:true});expect((screen.getByLabelText('专业来源建议篇数') as HTMLInputElement).disabled).toBe(true);
});
it('never multiplies a package price by the requested article count',()=>{
 mount({value:{...plan,items:[{...plan.items[0],pricing_kind:'package',unit_price:null,cost:'500.00',mandatory_fees:[]}],total_cost:'500.00',known_total_cost:'500.00',total_remaining:'2500.00',budget_feasible:true,kind:'quoted_content_plan'}});
 expect(screen.getByText('套餐计价（不拆算单价）')).toBeTruthy();expect(screen.queryByText(/500.00 ×/)).toBeNull();
 expect(screen.getByText('附加费：无必要附加费（已确认）')).toBeTruthy();expect(screen.queryByRole('button',{name:'加入本组合'})).toBeNull();
});
