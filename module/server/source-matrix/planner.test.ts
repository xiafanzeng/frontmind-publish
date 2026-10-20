import { expect,it } from 'vitest';
import { runPlanner } from './planner.js';
import { priceItems } from './budget.js';
const now='2026-10-20T00:00:00Z';
const item={article_id:'a',version:'v',resource_id:'r',offer_id:'o',publication_spec:'text',quantity:2,purpose:'standard'};
const catalog={resource_id:'r',offer_id:'o',source_name:'测试媒体',industry:'测试行业',publication_status:'available',publication_spec:'text',manuscript_checks:[{article_id:'a',version:'v',status:'pass'}],pricing:{kind:'unit',amount:'100',currency:'CNY',quoted_at:'2026-10-01T00:00:00Z',valid_until:'2026-10-30T00:00:00Z',mandatory_fees:[{amount:'10',basis:'unit'},{amount:'5',basis:'item'}]}};
const request=()=>({tenant_id:'t',task_id:'task',brand_id:'b',task:{industry:'测试行业',questions:[{question_id:'q',text:'测试问题'}],manuscripts:[{article_id:'a',version:'v'}]},catalog:[structuredClone(catalog)]});
const md={items:[{candidate_id:'resource:r',primary_role:'industry',auxiliary_roles:[],matched_questions:['q'],references:[{type:'attribute',path:'catalog[0].industry'}],reason_summary:'适配所声明行业',reason_details:[],unconfirmed_items:[],selection:'recommended'}],fit_order:['resource:r']};
const plans=[{strategy:'显式投放',reason_summary:'支持任务问题',items:[item]}];
it('does not invent model decisions and keeps five possibly empty layers',()=>{
 const out=runPlanner(request(),undefined,'matrix',undefined,now);expect(out.status).toBe('needs_ai_decisions');expect(out.matrix.fit_order).toEqual([]);expect(out.matrix.layers).toHaveLength(5);
});
it('rejects model facts, wrong evidence scopes and unsupported roles',()=>{
 const d=structuredClone(md);Object.assign(d.items[0]!,{price:'0'});expect(runPlanner(request(),{matrix_decisions:d},'matrix',undefined,now).status).toBe('invalid_decisions');
 const regional=structuredClone(md);regional.items[0]!.primary_role='regional';expect(runPlanner(request(),{matrix_decisions:regional},'matrix',undefined,now).errors.map((e:any)=>e.code)).toContain('regional_not_applicable');
});
it('prices exact publications and includes every mandatory fee',()=>{
 expect(priceItems([item,item],[catalog],now).total_cost).toBe('225.00');
 const missing=structuredClone(catalog);delete (missing.pricing as any).mandatory_fees;
 expect(priceItems([item],[missing],now).total_cost).toBeNull();
 expect(priceItems([item],[catalog],'2026-11-01T00:00:00Z').complete).toBe(false);
});
it('reuses semantic snapshot after quote changes but invalidates changed facts or binding',()=>{
 const r=request(),first=runPlanner(r,{matrix_decisions:md},'matrix',undefined,now);
 const current={...r,budget:{currency:'CNY',total_cap:'1000'}};current.catalog[0]!.pricing.amount='200';
 const out=runPlanner(current,{budget_plans:plans},'budget',first,now);
 expect(out.status).toBe('complete');expect(out.budget_plans[0].total_cost).toBe('425.00');expect(out.matrix_version).toBe(first.matrix_version);expect(out.plan_version).not.toBe(first.plan_version);expect(out.plan_id).toBe(first.plan_id);expect(out.report.plan_version).toBe(out.plan_version);
 expect(runPlanner({...current,tenant_id:'other'},{budget_plans:plans},'budget',first,now).status).toBe('stale_matrix');
 current.catalog[0]!.industry='变更';expect(runPlanner(current,{budget_plans:plans},'budget',first,now).status).toBe('stale_matrix');
});
it('charges exploration against both caps and cannot relabel trusted purposes',()=>{
 const r={...request(),budget:{currency:'CNY',total_cap:'200',exploration_cap:'100',exploration_enabled:true},selected_items:[{...item,purpose:'exploration',locked:true}]};
 const first=runPlanner(r,{matrix_decisions:md},'matrix',undefined,now),out=runPlanner(r,{budget_plans:plans},'budget',first,now).budget_plans[0];
 expect(out.items[0].purpose).toBe('exploration');expect(out.total_cost).toBe('225.00');expect(out.exploration_cost).toBe('225.00');expect(out.errors.map((e:any)=>e.code)).toEqual(expect.arrayContaining(['total_cap_exceeded','exploration_cap_exceeded','locked_selection_conflict']));expect(out.execution_recommended).toBe(false);
});
it('deduplicates strategies and rejects more than three combinations and injected locks',()=>{
 const r={...request(),budget:{currency:'CNY',total_cap:'1000'}},first=runPlanner(r,{matrix_decisions:md},'matrix',undefined,now);
 expect(runPlanner(r,{budget_plans:[...plans,...plans]},'budget',first,now).budget_plans).toHaveLength(1);
 expect(runPlanner(r,{budget_plans:[1,2,3,4].map(quantity=>({...plans[0],items:[{...item,quantity}]}))},'budget',first,now).status).toBe('invalid_decisions');
 expect(runPlanner(r,{budget_plans:[{...plans[0],items:[{...item,locked:true}]}]},'budget',first,now).errors[0].code).toBe('untrusted_item_field');
});
it('keeps budget and preflight readiness independent',()=>{
 const r={...request(),budget:{currency:'CNY',total_cap:'1000'}};r.catalog[0]!.manuscript_checks=[];
 const first=runPlanner(r,{matrix_decisions:md},'matrix',undefined,now),out=runPlanner(r,{budget_plans:plans},'budget',first,now).budget_plans[0];
 expect(out.budget_feasible).toBe(true);expect(out.manuscript_status).toBe('needs_manuscript_check');expect(out.ready_to_publish).toBe(false);expect(out.execution_recommended).toBe(false);
});
it('never converts currencies or treats unknown fees as zero',()=>{
 const usd={...catalog,resource_id:'r2',offer_id:'o2',pricing:{...catalog.pricing,currency:'USD'}};
 const out=priceItems([item,{...item,resource_id:'r2',offer_id:'o2'}],[catalog,usd],now);expect(out.currency).toBeNull();expect(out.total_cost).toBeNull();
});
it('uses an upper bound only as an estimate and requires a lower bound for unit minima',()=>{
 const r:any={...request(),budget:{currency:'CNY',total_cap:'1000',unit_price_min:'50'}};r.catalog[0].pricing={...catalog.pricing,kind:'range',upper_bound:'100'};
 const first=runPlanner(r,{matrix_decisions:md},'matrix',undefined,now),out=runPlanner(r,{budget_plans:plans},'budget',first,now).budget_plans[0];expect(out.is_estimate).toBe(true);expect(out.errors.map((e:any)=>e.code)).toContain('unit_price_min_unresolved');
});
it('rejects naive timestamps and malformed nested input without throwing',()=>{
 expect(runPlanner(request(),undefined,'matrix',undefined,'2026-10-20T00:00:00').status).toBe('invalid_input');
 const r:any=request();r.catalog[0].hard_conditions='wrong';expect(runPlanner(r,undefined,'matrix',undefined,now).status).toBe('invalid_input');
});
it('rebinds positional catalog references after equivalent offer insertion',()=>{
 const r=request(),first=runPlanner(r,{matrix_decisions:md},'matrix',undefined,now),extra={...structuredClone(catalog),offer_id:'o-new'};
 const current={...r,catalog:[extra,...r.catalog],budget:{currency:'CNY',total_cap:'1000'}},out=runPlanner(current,{budget_plans:plans},'budget',first,now);
 expect(out.status).toBe('complete');expect(out.matrix.fit_order).toEqual(first.matrix.fit_order);expect(out.snapshot.matrix_decisions.items[0].references[0].path).toBe('catalog[0].industry');
});
it('retains conflicting supplier facts as pending regardless of row order',()=>{
 const r=request(),changed={...structuredClone(catalog),offer_id:'other',industry:'冲突'};
 const a=runPlanner({...r,catalog:[catalog,changed]},undefined,'matrix',undefined,now),b=runPlanner({...r,catalog:[changed,catalog]},undefined,'matrix',undefined,now);
 expect(a.matrix_version).toBe(b.matrix_version);expect(a.matrix.candidates[0].channel_status).toBe('pending');expect(a.matrix.candidates[0].attributes.industry).toBeUndefined();
});
it('treats aggregate provenance separately and rejects supplier or zero observations as positive support',()=>{
 const r:any=request();r.catalog[0].domain='example.org';
 const agg={data_kind:'aggregate',aggregate_id:'ag',source_type:'external_data',source_id:'dataset',data_version:'v1',unit:'mentions',scope:{industry:'测试行业'},applicability:{kind:'industry_context',industry:'测试行业'},source_name:'测试媒体',domain:'example.org',count:3};
 r.citations=[agg];const d=structuredClone(md);d.items[0]!.references=[{type:'aggregate',aggregate_id:'ag',usage:'industry_context'} as any];
 const good=runPlanner(r,{matrix_decisions:d},'matrix',undefined,now);expect(good.status).toBe('complete');expect(good.source_analysis.known_detail_count).toBe(0);expect(good.matrix.candidates[0].evidence_ids).toEqual([]);
 r.citations[0].count=0;expect(runPlanner(r,{matrix_decisions:d},'matrix',undefined,now).status).toBe('invalid_decisions');
 r.citations[0].count=3;r.citations[0].source_type='supplier_claim';expect(runPlanner(r,{matrix_decisions:d},'matrix',undefined,now).status).toBe('invalid_decisions');
});
it('keeps package identity exact, charges once and never splits cross-resource packages',()=>{
 const second={...item,article_id:'a2',quantity:1},p={...catalog,pricing:{...catalog.pricing,kind:'package',amount:'300',mandatory_fees:[{amount:'5',basis:'item'}],included_items:[item,second]}};
 const out=priceItems([item,second],[p],now);expect(out.total_cost).toBe('305.00');expect(out.details[1].cost).toBe('0.00');
 expect(priceItems([item],[p],now).total_cost).toBeNull();
 expect(priceItems([item,second],[p,{...p,resource_id:'r2'}],now).complete).toBe(false);
});
it('enforces trusted offer purpose restrictions and preserves omitted locks',()=>{
 const r={...request(),budget:{currency:'CNY',total_cap:'1000'},selected_items:[{...item,locked:true}]};
 (r.catalog[0]! as any).allowed_purposes=['exploration'];
 const first=runPlanner(r,{matrix_decisions:md},'matrix',undefined,now),out=runPlanner(r,{budget_plans:[{...plans[0],items:[]}]},'budget',first,now).budget_plans[0];
 expect(out.items[0].locked).toBe(true);expect(out.errors.map((e:any)=>e.code)).toContain('locked_selection_removed');expect(out.unknown_items[0].reasons).toContain('purpose_not_allowed');
});
it('validates evidence questions and exploration roles without guessing',()=>{
 const r:any=request();r.catalog[0].domain='example.org';r.citations=[{data_kind:'detail',evidence_id:'e',tenant_id:'t',question_id:'other',platform:'p',model:'m',model_version:'v',period:{end:'2026-10-01'},answer_record_id:'answer',citation_url:'https://example.org/a',source_name:'测试媒体'}];
 const d=structuredClone(md);d.items[0]!.references=[{type:'evidence',evidence_id:'e'} as any];
 expect(runPlanner(r,{matrix_decisions:d},'matrix',undefined,now).errors.map((e:any)=>e.code)).toContain('invalid_evidence_reference');
 d.items[0]!.primary_role='exploration';expect(runPlanner(r,{matrix_decisions:d},'matrix',undefined,now).errors.map((e:any)=>e.code)).toEqual(expect.arrayContaining(['missing_hypothesis','missing_verification']));
});
it('does not let an undecided resource or a supplied readiness field become execution advice',()=>{
 const other={...structuredClone(catalog),resource_id:'r2',offer_id:'o2'},r={...request(),catalog:[catalog,other],budget:{currency:'CNY',total_cap:'1000'}};
 const first=runPlanner(r,{matrix_decisions:md},'matrix',undefined,now),out=runPlanner(r,{budget_plans:[{strategy:'显式选未判断项',reason_summary:'待补适配',items:[{...item,resource_id:'r2',offer_id:'o2'}]}]},'budget',first,now).budget_plans[0];
 expect(out.total_cost).toBe('225.00');expect(out.budget_feasible).toBe(true);expect(out.ready_to_publish).toBe(true);expect(out.semantic_ready).toBe(false);expect(out.execution_recommended).toBe(false);
});
it('rejects typed publication identity errors instead of accepting a model fact',()=>{
 const r={...request(),budget:{currency:'CNY',total_cap:'1000'}},first=runPlanner(r,{matrix_decisions:md},'matrix',undefined,now);
 expect(runPlanner(r,{budget_plans:[{...plans[0],items:[{...item,article_id:12}]}]},'budget',first,now).status).toBe('invalid_input');
});
