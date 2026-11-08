import { expect,it } from 'vitest';
import { runPlanner } from './planner.js';
import { compactCandidates } from './decisions.js';
import { prepareExportResearch,researchCatalog } from './export-research.js';
import { normalizeRecommendationDecisions,verifyContentPlans } from './content-plans.js';
import type { Row } from './common.js';
const now='2026-10-26T10:00:00+08:00';
const offer:Row={resource_id:'r',source_name:'可信媒体',industry:'软件',publication_status:'available',offer_id:'o',publication_spec:'text',repeat_allowed:true,pricing:{kind:'unit',amount:'100.00',currency:'CNY',quoted_at:'2026-01-01T00:00:00Z',valid_until:'2027-01-01T00:00:00Z',mandatory_fees:[{basis:'unit',amount:'10.00'},{basis:'item',amount:'5.00'}]}};
const request=():Row=>({tenant_id:'t',task_id:'task',brand_id:'brand',task:{industry:'软件',questions:[{question_id:'q',text:'如何选择测试服务'}]},catalog:[structuredClone(offer)],budget:{currency:'CNY',total_cap:'3000'},publication_intent:'new_articles'});
const md={items:[{candidate_id:'resource:r',primary_role:'industry',selection:'recommended',auxiliary_roles:[],matched_questions:['q'],references:[{type:'attribute',path:'catalog[0].industry'}],reason_summary:'目录行业与采购问题相关',reason_details:['目录行业是属性依据'],unconfirmed_items:[],media_intro:'软件行业媒体',content_direction:'面向采购者说明测试方法与验收材料。',layer_rank:1,ranking_reason:'行业与目标问题直接相关'}],fit_order:['resource:r']};
const plan=():Row=>({strategy:'方法与案例',reason_summary:'两篇承担不同内容任务',items:[{candidate_id:'resource:r',resource_id:'r',offer_id:'o',publication_spec:'text',quantity:2,quantity_mode:'new_articles',content_tasks:['测试方法说明','验收案例'],purpose:'standard',quantity_reason:'方法与案例各一篇'}],explanation:{objective:'帮助采购者比较服务',selection_logic:['专业媒体承接技术细节'],content_allocation:[{candidate_id:'resource:r',responsibility:'技术解释',content_angle:'方法与案例'}],tradeoffs:['缺少大众传播'],excluded_candidates:[],fit_conditions:['需准备可公开案例'],verification_items:['逐篇绑定稿件和冻结版本']}});
function matrix(r:Row){return runPlanner(r,{matrix_decisions:md},'matrix',undefined,now);}
it('prices content quantities with all fees without fabricating manuscripts',()=>{
 const r=request(),out=verifyContentPlans([plan()],matrix(r),r,now).plans[0]!;
 expect(out.total_cost).toBe('225.00');expect(out.total_remaining).toBe('2775.00');expect(out.budget_feasible).toBe(true);
 expect(out.ready_to_publish).toBe(false);expect(out.cart_eligible).toBe(false);expect(out.items[0]).not.toHaveProperty('article_id');
});
it('keeps missing fees, expired quotes and partial cost unknown',()=>{
 for(const change of [(r:Row)=>delete r.catalog[0].pricing.mandatory_fees,(r:Row)=>r.catalog[0].pricing.valid_until='2025-01-01T00:00:00Z']){const r=request();change(r);const out=verifyContentPlans([plan()],matrix(r),r,now).plans[0]!;expect(out.total_cost).toBeNull();expect(out.budget_feasible).toBeNull();if(r.catalog[0].pricing.valid_until==='2025-01-01T00:00:00Z'){expect(out.known_total_cost).toBeNull();expect(out.total_remaining).toBeNull();}else{expect(out.known_total_cost).toBe('200.00');expect(out.total_remaining).toBe('2800.00');expect(out.remaining_is_estimate).toBe(true);}}
});
it('applies quantity limits, optional unit limits and exploration within total cap',()=>{
 const r=request();r.catalog[0].max_quantity=1;expect(verifyContentPlans([plan()],matrix(r),r,now).plans[0]!.unknown_items.length).toBeGreaterThan(0);
 delete r.catalog[0].max_quantity;r.budget.unit_price_max='100';expect(verifyContentPlans([plan()],matrix(r),r,now).plans[0]!.errors.map((x:Row)=>x.code)).toContain('unit_price_above_max');
 delete r.budget.unit_price_max;r.budget.total_cap='200';r.budget.exploration_enabled=true;r.budget.exploration_cap='100';const p=plan();p.items[0].purpose='exploration';const out=verifyContentPlans([p],matrix(r),r,now).plans[0]!;
 expect(out.errors.map((x:Row)=>x.code)).toEqual(expect.arrayContaining(['total_cap_exceeded','exploration_cap_exceeded']));expect(out.budget_feasible).toBe(false);
});
it('does not turn a content plan into formal repeated publications without explicit intent',()=>{
 const r=request();r.task.manuscripts=[{article_id:'a',version:'v1'}];r.catalog[0].manuscript_checks=[{article_id:'a',version:'v1',status:'pass'}];
 const m=matrix(r),choice={strategy:'重复',reason_summary:'明确重复',items:[{article_id:'a',version:'v1',resource_id:'r',offer_id:'o',publication_spec:'text',quantity:2,purpose:'standard'}]};
 const no=runPlanner(r,{budget_plans:[choice]},'budget',m,now);expect(no.budget_plans[0].errors.map((x:Row)=>x.code)).toContain('repeat_publication_not_authorized');
 const yes=runPlanner({...r,publication_intent:'repeat_existing_article'},{budget_plans:[choice]},'budget',m,now);expect(yes.budget_plans[0].total_cost).toBe('225.00');expect(yes.budget_plans[0].execution_recommended).toBe(true);
 choice.items[0]!.article_id='invented';const unbound=runPlanner({...r,publication_intent:'repeat_existing_article'},{budget_plans:[choice]},'budget',m,now);expect(unbound.budget_plans[0].budget_feasible).toBe(false);expect(unbound.budget_plans[0].errors.map((x:Row)=>x.code)).toContain('undeclared_manuscript');
});
it('preserves matrix ordering across quote, quantity and cart changes and caps all choices at three',()=>{
 const r=request(),m=matrix(r);r.catalog[0].pricing.amount='120';r.selected_items=[];
 const out=runPlanner(r,{content_plans:[plan()]},'budget',m,now);expect(out.matrix_version).toBe(m.matrix_version);expect(out.matrix.fit_order).toEqual(m.matrix.fit_order);expect(out.content_plans[0].total_cost).toBe('265.00');expect(out.report.content_plans).toEqual(out.content_plans);
 const p=plan();p.items[0].quantity=3;p.items[0].content_tasks.push('FAQ');expect(runPlanner(r,{content_plans:[p]},'budget',out,now).matrix_version).toBe(m.matrix_version);
 const four=[1,2,3,4].map(quantity=>{const x=plan();x.items[0].quantity=quantity;return x;});expect(runPlanner(r,{content_plans:four},'budget',m,now).status).toBe('invalid_decisions');
});
it('rejects unknown candidates, injected prices and ambiguous unconfirmed research mappings',()=>{
 const r=request(),m=matrix(r),p=plan();p.items[0].price='1';expect(verifyContentPlans([p],m,r,now).errors.length).toBeGreaterThan(0);
 delete p.items[0].price;p.items[0].candidate_id='unreviewed';expect(verifyContentPlans([p],m,r,now).errors.length).toBeGreaterThan(0);
 p.items[0].candidate_id='resource:r';p.items[0].resource_id='other';expect(verifyContentPlans([p],m,r,now).errors.map(x=>x.code)).toContain('resource_mapping_requires_confirmation');
});
it('keeps locked formal publications visible rather than dropping them for a content estimate',()=>{
 const r=request();r.selected_items=[{article_id:'a',version:'v1',resource_id:'r',offer_id:'o',publication_spec:'text',quantity:1,purpose:'standard',locked:true}];
 const out=verifyContentPlans([plan()],matrix(r),r,now).plans[0]!;expect(out.retained_locked_items).toEqual(r.selected_items);expect(out.budget_feasible).toBeNull();
});
it('adapts all export groups without creating citation or account facts and excludes prices from AI matrix input',()=>{
 const r=request(),batch={sourceSha256:'a'.repeat(64),records:[{id:'row2',sourceSheet:'详细表',sourceRow:2,mediaName:'来源',mediaUrl:'https://example.org',title:'软件测试方法',model:'模型',url:'https://example.org/a'},{id:'row3',sourceSheet:'详细表',sourceRow:3,mediaName:'来源',mediaUrl:'https://example.org',title:'软件测试方法',model:'模型',url:'https://example.org/a'}]};
 const o=prepareExportResearch(batch,r.task);expect(o.raw_rows).toBe(2);expect(o.exact_citation_count).toBeNull();expect(o.groups[0].raw_observations[0]).toHaveProperty('locator_key');expect(o.groups[0].raw_observations[0]).not.toHaveProperty('evidence_id');
 r.catalog.push(...researchCatalog(o,r.catalog));const prepared=runPlanner(r,undefined,'matrix',undefined,now),input=compactCandidates(r,prepared);
 expect(input).toHaveLength(2);expect(JSON.stringify(input)).not.toContain('100.00');expect(JSON.stringify(input)).not.toContain('3000');expect(input.some(x=>x.attributes.data_kind==='raw_brand_observation_context')).toBe(true);
});

it('generates one canonical list and keeps quantity edits independent of article advice',()=>{
 const r=request(),p=plan();p.items[0].content_tasks=['补充当前稿件方法段落的验收依据'];
 const first=runPlanner(r,{recommendations:[p]},'budget',matrix(r),now);
 expect(first.status).toBe('complete');expect(first.recommendations[0].total_cost).toBe('225.00');expect(first.budget_plans).toEqual([]);expect(first.content_plans).toEqual([]);
 p.items[0].quantity=3;const next=runPlanner(r,{recommendations:[p]},'budget',first,now);
 expect(next.recommendations[0].total_cost).toBe('335.00');expect(next.recommendations[0].total_articles).toBe(3);expect(next.recommendations[0].recommendation_id).toBe(first.recommendations[0].recommendation_id);
 expect(next.recommendations[0].items[0].content_tasks).toEqual(p.items[0].content_tasks);expect(next.report.recommendations).toEqual(next.recommendations);
});
it('deduplicates real configurations even if titles and article advice differ',()=>{
 const r=request(),one=plan(),two=plan();two.strategy='另一标题';two.items[0].content_tasks=['另一个描述'];
 const out=runPlanner(r,{recommendations:[one,two]},'budget',matrix(r),now);
 expect(out.recommendations).toHaveLength(1);expect(out.recommendation_warnings[0].code).toBe('duplicate_recommendation_omitted');
});
it('uses known partial costs to detect over-budget recommendations',()=>{
 const r=request();delete r.catalog[0].pricing.mandatory_fees;r.budget.total_cap='150';
 const out=verifyContentPlans([plan()],matrix(r),r,now).plans[0]!;
 expect(out.total_cost).toBeNull();expect(out.known_total_cost).toBe('200.00');expect(out.total_remaining).toBe('-50.00');expect(out.errors.map((e:Row)=>e.code)).toContain('total_cap_exceeded');expect(out.budget_feasible).toBe(false);
});
it('recalculates legacy content and formal decisions without rewriting saved rows',()=>{
 const r=request(),m=matrix(r),legacy={...m,content_plans:[{...plan(),content_plan_id:'legacy'}],budget_plans:[{strategy:'旧正式组合',reason_summary:'保留原记录',items:[{article_id:'a',version:'v1',resource_id:'r',offer_id:'o',publication_spec:'text',quantity:1,purpose:'standard'}]}]};
 const before=JSON.stringify(legacy),normalized=normalizeRecommendationDecisions(legacy);
 expect(normalized).toHaveLength(2);expect(normalized[1].items[0].candidate_id).toBe('resource:r');expect(normalized[1].items[0]).not.toHaveProperty('article_id');expect(JSON.stringify(legacy)).toBe(before);
});

it('aggregates distinct legacy frozen articles into one exact planned resource configuration',()=>{
 const r=request(),m=matrix(r),publication={resource_id:'r',offer_id:'o',publication_spec:'text',quantity:1,purpose:'standard'},legacy={...m,budget_plans:[{strategy:'历史多稿',reason_summary:'不同稿件采用同一媒体',items:[{...publication,article_id:'a',version:'v1'},{...publication,article_id:'b',version:'v2',quantity:2}],explanation:{...plan().explanation,content_allocation:[{candidate_id:'resource:r',responsibility:'方法解释',content_angle:'方法段落'},{candidate_id:'resource:r',responsibility:'案例说明',content_angle:'案例段落'}]}}]};
 const before=JSON.stringify(legacy),normalized=normalizeRecommendationDecisions(legacy),out=verifyContentPlans(normalized,m,r,now);
 expect(normalized[0].items).toHaveLength(1);expect(normalized[0].items[0].quantity).toBe(3);expect(normalized[0].explanation.content_allocation).toHaveLength(1);expect(normalized[0].explanation.content_allocation[0].responsibility).toBe('方法解释；案例说明');
 expect(out.errors).toEqual([]);expect(out.plans[0].total_articles).toBe(3);expect(out.plans[0].total_cost).toBe('335.00');expect(JSON.stringify(legacy)).toBe(before);
});
it('preserves separate specs for one candidate and uses one explanation allocation',()=>{
 const r=request();r.catalog.push({...structuredClone(offer),offer_id:'video-offer',publication_spec:'video'});const m=matrix(r),publication={resource_id:'r',quantity:1,purpose:'standard'},legacy={...m,budget_plans:[{strategy:'历史不同规格',reason_summary:'沿用两种真实规格',items:[{...publication,article_id:'a',version:'v1',offer_id:'o',publication_spec:'text'},{...publication,article_id:'b',version:'v2',offer_id:'video-offer',publication_spec:'video',quantity:2}]}]};
 const normalized=normalizeRecommendationDecisions(legacy),out=verifyContentPlans(normalized,m,r,now);
 expect(normalized[0].items).toHaveLength(2);expect(normalized[0].explanation.content_allocation).toHaveLength(1);expect(out.errors).toEqual([]);expect(out.plans[0].items.map((item:Row)=>item.publication_spec)).toEqual(['text','video']);expect(out.plans[0].total_articles).toBe(3);
});
it('does not truncate an oversized aggregate or silently coalesce native recommendation rows',()=>{
 const r=request(),m=matrix(r),publication={resource_id:'r',offer_id:'o',publication_spec:'text',quantity:60,purpose:'standard'},legacy={...m,budget_plans:[{strategy:'历史大量稿件',reason_summary:'保留计划总量',items:[{...publication,article_id:'a',version:'v1'},{...publication,article_id:'b',version:'v1'}]}]},normalized=normalizeRecommendationDecisions(legacy);
 expect(normalized[0].items[0].quantity).toBe(120);expect(verifyContentPlans(normalized,m,r,now).errors.map((error:Row)=>error.code)).toContain('quantity_limit_exceeded');
 const native=plan();native.items.push({...native.items[0]});const retained=normalizeRecommendationDecisions({...m,recommendations:[native]});expect(retained[0].items).toHaveLength(2);expect(verifyContentPlans(retained,m,r,now).errors.map((error:Row)=>error.code)).toContain('duplicate_resource_selection');
});
it('reports the actual generated count without inventing candidate or quote shortages',()=>{
 const r=request(),out=runPlanner(r,{recommendations:[plan()]},'budget',matrix(r),now);
 expect(out.recommendation_limit_reason).toBe('本次生成 1 个不同组合，可调整要求后重新生成。');
});

it('preserves all saved recommendation slots when an explicit quantity edit makes two configurations equal',()=>{
 const r=request(),m=matrix(r),choices=[2,3,4].map((quantity,index)=>{const p=plan();p.strategy='组合'+(index+1);p.items[0].quantity=quantity;return p;}),saved=runPlanner(r,{recommendations:choices},'budget',m,now);
 const edits=normalizeRecommendationDecisions(saved);edits[0].items[0].quantity=3;
 const editing={...r,quantity_edits:{plan_kind:'recommendation',plan_index:0,items:[{item_index:0,candidate_id:'resource:r',quantity:3}]}},out=runPlanner(editing,{recommendations:edits},'budget',saved,now);
 expect(out.status).toBe('complete');expect(out.recommendations.map((p:Row)=>p.items[0].quantity)).toEqual([3,3,4]);expect(out.recommendations.map((p:Row)=>p.recommendation_id)).toEqual(saved.recommendations.map((p:Row)=>p.recommendation_id));expect(out.recommendation_limit_reason).toContain('已保留原有组合位置');
 const nextEdits=normalizeRecommendationDecisions(out);nextEdits[2].items[0].quantity=5;
 const next=runPlanner({...r,quantity_edits:{plan_kind:'recommendation',plan_index:2,items:[{item_index:0,candidate_id:'resource:r',quantity:5}]}},{recommendations:nextEdits},'budget',out,now);
 expect(next.recommendations.map((p:Row)=>p.items[0].quantity)).toEqual([3,3,5]);expect(next.recommendations[2].recommendation_id).toBe(saved.recommendations[2].recommendation_id);
});
it('keeps normal generation deduplication and rejects a model-supplied edit bypass',()=>{
 const r=request(),m=matrix(r),duplicate=[plan(),plan()],edit={plan_kind:'recommendation',plan_index:0,items:[{item_index:0,candidate_id:'resource:r',quantity:2}]};
 expect(runPlanner(r,{recommendations:duplicate},'budget',m,now).recommendations).toHaveLength(1);
 expect(runPlanner(r,{recommendations:duplicate,quantity_edits:edit},'budget',m,now).status).toBe('invalid_input');
 expect(runPlanner({...r,quantity_edits:{...edit,items:[{...edit.items[0],candidate_id:'other'}]}},{recommendations:duplicate},'budget',m,now).recommendations).toHaveLength(1);
});
