// @vitest-environment jsdom
// Test source only; run against the final integrated checkout.
import {useState} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ContentPlanRecommendations,type QuantityChange} from './ContentPlanRecommendations';
import type {Candidate,ContentPlan} from './types';
import {Report} from './SourceMatrixPresentation';
import {matrixDemo} from './demo';
afterEach(cleanup);
const candidate:Candidate={candidate_id:'c1',resource_id:'resource-1',attributes:{source_name:'专业媒体'},offers:[],primary_role:'industry',auxiliary_roles:[],selection:'recommended',matched_questions:[],channel_status:'eligible',manuscript_status:'needs_manuscript_check',hard_failures:[],pending_conditions:[],evidence_relation:'unverified',evidence_ids:[],aggregate_ids:[]};
const plan:ContentPlan={schema_version:'recommendation/1.0',recommendation_id:'rec-1',strategy:'行业覆盖',reason_summary:'用真实行业媒体覆盖当前问题',explanation:null,kind:'recommendation',items:[{candidate_id:'c1',resource_id:'resource-1',offer_id:'offer-1',publication_spec:'图文',quantity:2,quantity_mode:'new_articles',quantity_reason:'结合预算安排投放次数',content_tasks:['将标题聚焦当前产品的适用场景'],purpose:'standard',unit_price:'100.00',base_cost:'200.00',cost:null,known_cost:'200.00',pricing_status:'partial',price_source:'catalog',mandatory_fees:null,unknown_reasons:['mandatory_fees_unknown']}],total_articles:2,currency:'CNY',known_total_cost:'200.00',total_cost:null,total_remaining:'2800.00',total_cap:'3000.00',budget_feasible:null,ready_to_publish:false,execution_recommended:false,unknown_items:[{reasons:['mandatory_fees_unknown']}],errors:[]};
function mount(options:{stale?:boolean;values?:ContentPlan[];save?:(index:number,changes:QuantityChange[])=>Promise<boolean>}={}) {
 const update=vi.fn(options.save??(async()=>true));
 function Harness(){const [plans,setPlans]=useState(options.values??[plan]),[index,setIndex]=useState(0);return <ContentPlanRecommendations plans={plans} candidates={[candidate]} selectedIndex={index} onSelect={setIndex} onDetails={vi.fn()} onUpdate={async(selected,changes)=>{const ok=await update(selected,changes);if(ok)setPlans(current=>current.map((entry,i)=>i===selected?{...entry,items:entry.items.map((item,n)=>({...item,quantity:changes[n]!.quantity,base_cost:'300.00',known_cost:'300.00'})),total_articles:changes.reduce((sum,item)=>sum+item.quantity,0),known_total_cost:'300.00',total_remaining:'2700.00'}:entry));return ok;}} disabled={false} stale={options.stale??false}><p>预算表单</p></ContentPlanRecommendations>;}
 render(<Harness/>);return update;
}
it('automatically refreshes quantities, row totals and budget without a recalculation button',async()=>{
 const update=mount();fireEvent.change(screen.getByLabelText('专业媒体建议篇数'),{target:{value:'3'}});
 expect(screen.queryByRole('button',{name:/重新核算/})).toBeNull();expect(screen.queryByText('CNY 200.00')).toBeNull();
 expect(screen.getByText('预计总价').parentElement?.textContent).toContain('正在更新');
 await waitFor(()=>expect(update).toHaveBeenCalledWith(0,[{item_index:0,candidate_id:'c1',quantity:3}]));
 await waitFor(()=>expect(screen.getByText('预计总价').parentElement?.textContent).toContain('CNY 300.00'));
 expect(screen.getByText('预算余量 / 超额').parentElement?.textContent).toContain('2700.00');
 expect(screen.queryByText('研究来源')).toBeNull();expect(screen.queryByText(/每篇为不同内容/)).toBeNull();expect(screen.queryByRole('button',{name:'加入本组合'})).toBeNull();
});
it.each(['','-1','1.5','0','101','abc'])('preserves invalid quantity %s and gives an inline range error',value=>{
 const update=mount();fireEvent.change(screen.getByLabelText('专业媒体建议篇数'),{target:{value}});
 expect((screen.getByLabelText('专业媒体建议篇数') as HTMLInputElement).value).toBe(value);expect(screen.getByRole('alert').textContent).toContain('1–100');expect(update).not.toHaveBeenCalled();
 expect(screen.getByText('预计总价').parentElement?.textContent).toContain('请修正篇数');
});
it('retains a separate draft per combination and never sends it to another combination',async()=>{
 const second={...plan,recommendation_id:'rec-2',strategy:'费用控制',items:[{...plan.items[0]!,quantity:1}],total_articles:1};
 const update=mount({values:[plan,second]});fireEvent.change(screen.getByLabelText('专业媒体建议篇数'),{target:{value:'4'}});
 fireEvent.click(screen.getByRole('button',{name:/组合 2/}));expect((screen.getByLabelText('专业媒体建议篇数') as HTMLInputElement).value).toBe('1');
 fireEvent.click(screen.getByRole('button',{name:/组合 1/}));expect((screen.getByLabelText('专业媒体建议篇数') as HTMLInputElement).value).toBe('4');
 await waitFor(()=>expect(update).toHaveBeenCalledWith(0,[{item_index:0,candidate_id:'c1',quantity:4}]));expect(update).toHaveBeenCalledTimes(1);
});
it('keeps the target combination visible when an earlier save completes after switching',async()=>{
 let resolve!:(value:boolean)=>void;const response=new Promise<boolean>(done=>{resolve=done;});
 const second={...plan,recommendation_id:'rec-2',strategy:'地域覆盖',items:[{...plan.items[0]!,quantity:1}],total_articles:1};
 const update=mount({values:[plan,second],save:async()=>response});fireEvent.change(screen.getByLabelText('专业媒体建议篇数'),{target:{value:'3'}});
 await waitFor(()=>expect(update).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:/组合 2/}));resolve(true);
 await waitFor(()=>expect((screen.getByLabelText('专业媒体建议篇数') as HTMLInputElement).value).toBe('1'));
 expect(screen.getByText('预计总价').parentElement?.textContent).toContain('200.00');
});
it('shows known base price even with unknown fees, without inventing zero fees',()=>{
 mount();expect(screen.getByText(/100.00 × 2 篇/)).toBeTruthy();expect(screen.getByText('预计总价').parentElement?.textContent).toContain('200.00');
 expect(screen.getByText('未确认的必要附加费未计入预计费用')).toBeTruthy();expect(screen.queryByText(/附加费.*0元/)).toBeNull();
});
it('prevents stale plans from editing and never multiplies a package price by quantity',()=>{
 mount({stale:true,values:[{...plan,items:[{...plan.items[0]!,pricing_kind:'package',unit_price:null,base_cost:null,cost:'500.00',known_cost:'500.00',mandatory_fees:[],unknown_reasons:[]}],known_total_cost:'500.00',total_cost:'500.00'}]});
 expect((screen.getByLabelText('专业媒体建议篇数') as HTMLInputElement).disabled).toBe(true);expect(screen.getByText('套餐计价（不拆算单价）')).toBeTruthy();expect(screen.queryByText(/500.00 ×/)).toBeNull();
});

it('persists a debounced edit even when the user immediately switches away',async()=>{
 const second={...plan,recommendation_id:'rec-2',strategy:'地域覆盖',items:[{...plan.items[0]!,quantity:1}],total_articles:1};
 const update=mount({values:[plan,second]});fireEvent.change(screen.getByLabelText('专业媒体建议篇数'),{target:{value:'4'}});fireEvent.click(screen.getByRole('button',{name:/组合 2/}));
 await waitFor(()=>expect(update).toHaveBeenCalledWith(0,[{item_index:0,candidate_id:'c1',quantity:4}]));
 expect((screen.getByLabelText('专业媒体建议篇数') as HTMLInputElement).value).toBe('1');
 fireEvent.click(screen.getByRole('button',{name:/组合 1/}));expect((screen.getByLabelText('专业媒体建议篇数') as HTMLInputElement).value).toBe('4');
});

it('exports the same single combination chapter and known estimate as the live panel',()=>{
 render(<Report result={{...matrixDemo.result,recommendations:[plan],content_plans:[],budget_plans:[],matrix:{...matrixDemo.result.matrix,candidates:[candidate],layers:[]}}}/>);
 expect(screen.getByRole('heading',{name:'三、组合推荐'})).toBeTruthy();expect(screen.queryByRole('heading',{name:/内容规划|正式发布方案/})).toBeNull();
 expect(screen.getByText(/总篇数 2；预计总价 CNY 200.00/)).toBeTruthy();expect(screen.getByText('未确认的必要附加费未计入预计费用')).toBeTruthy();
});
