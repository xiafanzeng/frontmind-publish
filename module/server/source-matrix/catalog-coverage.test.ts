import { expect, it, vi } from 'vitest';
import { loadPlannerCatalog, reloadPlannerCatalog, publisherPlannerCatalogRows, PLANNER_CATALOG_PAGE_SIZE } from '../publisher-source-matrix-catalog.js';
import { createCatalogReservoir, authorityBasis } from './candidate-ranking.js';
import { createDecisionAdapter, PROMPT_CANDIDATE_BATCH_SIZE } from './decisions.js';
import { runPlanner } from './planner.js';
import type { Row } from './common.js';
import { priceRecommendationItems } from './recommendation-pricing.js';
import { validateDecisions } from './matrix.js';

const now='2026-11-09T00:00:00Z';
const task={industry:'半导体',questions:[{question_id:'q',text:'芯片制造工艺如何选择'}],regions:['广东'],manuscripts:[{article_id:'a',version:'v',title:'芯片制造工艺',content_excerpt:'芯片制造设备与工艺材料'}]};
const resource=(index:number):Row=>({id:String(index).padStart(5,'0'),name:'目录媒体'+index,external_resource_id:'provider-'+index,price:'1990000',media_kind:'news',taxonomy:index===801?'半导体':'体育',description:index===801?'芯片制造设备与工艺材料':'体育赛事报道',area:'广东',raw_payload:{}});
function database(rows:Row[],failPage=0){
 let call=0;const execute=vi.fn(async()=>{if(call++===0)return [[{upper_id:rows.at(-1)?.id??null,total:rows.length}]];if(failPage===call-1)throw new Error('db unavailable');return [rows.slice((call-2)*PLANNER_CATALOG_PAGE_SIZE,(call-1)*PLANNER_CATALOG_PAGE_SIZE)];});
 return {execute} as any;
}
it('scans every keyset page and admits a requirement-relevant resource beyond the old first800',async()=>{
 const db=database(Array.from({length:801},(_,index)=>resource(index+1))),result=await loadPlannerCatalog(db,'owner','project',{task});
 expect(result.coverage).toMatchObject({status:'complete',scanned_resources:801,total_resources:801,pages:3});
 expect(result.catalog.some(row=>row.resource_id==='00801')).toBe(true);
 expect(result.coverage.shortlist_by_role.industry[0]).toBe('resource:00801');
 expect(result.coverage.retained_resources).toBeLessThanOrEqual(120);expect(db.execute).toHaveBeenCalledTimes(4);
});
it('keeps a failed later page incomplete and refuses to call AI with that catalogue',async()=>{
 const result=await loadPlannerCatalog(database(Array.from({length:801},(_,index)=>resource(index+1)),2),'owner','project',{task});
 expect(result.coverage.status).toBe('incomplete');expect(result.coverage.scanned_resources).toBe(400);
 const request={task,catalog:result.catalog,catalog_coverage:result.coverage},prepared=runPlanner(request,undefined,'matrix',undefined,now),send=vi.fn();
 const decision=await createDecisionAdapter(send).matrix({request,prepared,as_of:now,skill:'test',instructions:''});
 expect(send).not.toHaveBeenCalled();expect(runPlanner(request,decision,'matrix',undefined,now).matrix.status).toBe('needs_ai_decisions');
});
it('records an elapsed scan deadline without misreporting an empty completed catalogue',async()=>{
 const db=database([]),result=await loadPlannerCatalog(db,'owner','project',{task,deadline:Date.now()-1});
 expect(result.coverage).toMatchObject({status:'incomplete',reason:'catalog_scan_deadline'});expect(db.execute).not.toHaveBeenCalled();
});
it('refreshes saved exact identities in bounded batches rather than rescanning all resources',async()=>{
 const db={execute:vi.fn(async()=>[[]])} as any;
 await reloadPlannerCatalog(db,'owner','project',Array.from({length:401},(_,index)=>'r'+index));
 expect(db.execute).toHaveBeenCalledTimes(3);
});
it('distinguishes role qualification from preferences and never uses names as authority evidence',()=>{
 expect(authorityBasis({name:'政府新闻网'})).toEqual([]);
 const reservoir=createCatalogReservoir(task,3);
 reservoir.offer([{resource_id:'unrelated',source_name:'广泛媒体',publication_status:'available',taxonomy:'生活',media_intro:'生活消费内容',region_coverage:['广东']}]);
 reservoir.offer([{resource_id:'blocked',source_name:'芯片媒体',publication_status:'available',industry:'半导体',supports_images:false}]);
 const output=reservoir.finish();expect(output.eligible_by_role.regional).toBe(1);expect(output.catalog.some(row=>row.resource_id==='unrelated')).toBe(true);
 const hard=createCatalogReservoir({...task,requirements:{images:true}},3);hard.offer([{resource_id:'blocked',publication_status:'available',industry:'半导体',supports_images:false}]);expect(hard.finish().catalog).toEqual([]);
});
function matrixInput(count:number){
 const request:Row={task,catalog:Array.from({length:count},(_,index)=>({resource_id:'r'+index,source_name:'芯片行业媒体'+index,industry:'半导体',publication_status:'available'}))};
 return {request,prepared:runPlanner(request,undefined,'matrix',undefined,now),as_of:now,skill:'test',instructions:''};
}
function batchDecisions(payload:Row):Row{
 const items=payload.candidates.map((candidate:Row,index:number)=>({candidate_id:candidate.candidate_id,primary_role:'industry',auxiliary_roles:[],matched_questions:['q'],selection:'recommended',reason_summary:'真实行业字段与当前芯片稿件相符',reason_details:[],unconfirmed_items:[],references:[{type:'attribute',path:candidate.attribute_paths[0]+'.industry'}],layer_rank:index+1,ranking_reason:'按真实行业和稿件主题比较'}));
 return {matrix_decisions:{items,fit_order:items.map((item:Row)=>item.candidate_id),excluded_candidates:[]}};
}
it('reviews every retained candidate beyond120 in bounded batches and merges continuous per-layer ranks',async()=>{
 const input=matrixInput(145),sizes:number[]=[];
 const decisions=await createDecisionAdapter(async messages=>{const payload=JSON.parse(messages[1]!.content);sizes.push(payload.candidates.length);return batchDecisions(payload);}).matrix(input);
 const result=runPlanner(input.request,decisions,'matrix',undefined,now);
 expect(sizes.every(size=>size<=PROMPT_CANDIDATE_BATCH_SIZE)).toBe(true);expect(sizes.reduce((sum,size)=>sum+size,0)).toBe(145);
 expect(result.matrix.coverage.model).toMatchObject({status:'complete',reviewed_candidates:145,classified_candidates:145,unprocessed_candidates:0});
 expect(result.matrix.layers.find((layer:Row)=>layer.role==='industry').candidate_ids).toHaveLength(145);
 expect(result.matrix.candidates.map((candidate:Row)=>candidate.layer_rank)).toEqual(Array.from({length:145},(_,index)=>index+1));
});
it('never treats partial new review metadata as a completed matrix or an empty suitable pool',()=>{
 const input=matrixInput(2),payload={candidates:[{candidate_id:'resource:r0',attribute_paths:['catalog[0]']}]},decision=batchDecisions(payload);
 decision.matrix_decisions.reviewed_candidate_ids=['resource:r0'];
 const result=runPlanner(input.request,decision,'matrix',undefined,now);
 /* Isolation semantics: the reviewed candidate stays attached (partial), the
  * unreviewed sibling is explicitly unprocessed — never complete, never empty. */
 expect(result.matrix.status).toBe('partial');
 expect(result.matrix.coverage.model).toMatchObject({status:'partial',classified_candidates:1,unprocessed_candidates:1});
 expect(result.matrix.layers.find((layer:Row)=>layer.role==='industry').status).toBe('populated');
 expect(result.matrix.layers.find((layer:Row)=>layer.role==='industry').classified_count).toBe(1);
 expect(result.limitations).toContain('model_classification_partial');
});
it('retains the previous successful batch count after a later provider failure',async()=>{
 const input=matrixInput(30);let calls=0;
 const decision=await createDecisionAdapter(async messages=>{if(++calls===2)throw new Error('provider_timeout');return batchDecisions(JSON.parse(messages[1]!.content));}).matrix(input);
 const result=runPlanner(input.request,decision,'matrix',undefined,now);
 /* A transient provider failure is retried once for the failed batch only;
  * successful batches are never re-run and never lost. */
 const reviewed=PROMPT_CANDIDATE_BATCH_SIZE*2;
 expect(result.matrix.status).toBe('partial');
 expect(result.matrix.coverage.model).toMatchObject({status:'partial',reviewed_candidates:reviewed,classified_candidates:reviewed,unprocessed_candidates:30-reviewed,reason:'provider_timeout'});
 expect(result.matrix.candidates.filter((candidate:Row)=>candidate.semantic_decision_validated)).toHaveLength(reviewed);
});

it('bounds budget context but retains explicit candidates beyond the ranked top slots and exact prices',async()=>{
 const input=matrixInput(90),catalog=input.request.catalog.map((row:Row,index:number)=>({...row,offer_id:null,publication_spec:null,pricing:{kind:'unit',amount:index+'.25',currency:'CNY',quoted_at:null,valid_until:null,mandatory_fees:null}}));
 const candidates=input.prepared.matrix.candidates.map((candidate:Row,index:number)=>({...candidate,semantic_decision_validated:true,selection:'recommended',primary_role:'industry',layer_rank:index+1}));
 let payload:Row={};await createDecisionAdapter(async messages=>{payload=JSON.parse(messages[1]!.content);return {recommendations:[]};}).budget({request:{...input.request,catalog,resource_selections:[{candidate_id:'resource:r89',resource_id:'r89',offer_id:null,publication_spec:null}]},matrix:{matrix_version:'v',matrix:{candidates}},as_of:now,skill:'test',instructions:''});
 expect(payload.candidate_scope).toMatchObject({eligible_candidates:90,included_candidates:7,omitted_candidates_are_not_rejected:true});
 expect(payload.selectable_candidates.find((candidate:Row)=>candidate.candidate_id==='resource:r89').offers[0].pricing.amount).toBe('89.25');
 expect(payload.selectable_candidates.every((candidate:Row)=>candidate.offers.every((offer:Row)=>offer.offer_id===null))).toBe(true);
});
it('preserves original research record reference indices across model batches',async()=>{
 const input=matrixInput(1),records=Array.from({length:60},(_,index)=>({material_id:'m'+index,source_name:'真实资料'+index}));
 input.request.task={...input.request.task,research_materials:{records}};input.prepared.matrix.candidates[0].attributes.research_material_ids=['m59'];
 let payload:Row={};await createDecisionAdapter(async messages=>{payload=JSON.parse(messages[1]!.content);return batchDecisions(payload);}).matrix(input);
 expect(payload.research_records[0].reference_path).toBe('task.research_materials.records[59]');expect(payload.research_records[0].record.material_id).toBe('m59');
});

it('preserves explicit inactive quote states in recommendation context without altering formal adapter defaults',()=>{
 for(const quote_status of ['expired','invalid','inactive','unavailable']){
  const resource={id:'r',name:'真实媒体',externalResourceId:'provider-r',priceTenThousandths:'500000',catalogRevision:null,rawPayload:{publisher_offers_v1:[{offer_id:'offer',publication_spec:'standard',quote_status,pricing:{kind:'unit',amount:'50.00',currency:'CNY',quoted_at:null,valid_until:null,mandatory_fees:[]}}]}};
  expect(publisherPlannerCatalogRows(resource)[0]!.quote_status).toBe('provider_terms');
  const rows=publisherPlannerCatalogRows(resource,true);expect(rows[0]!.quote_status).toBe(quote_status);
  const priced=priceRecommendationItems([{candidate_id:'resource:r',resource_id:'r',offer_id:'offer',publication_spec:'standard',quantity:1,purpose:'standard'}],rows,now);
  expect(priced.details[0].base_cost).toBeNull();expect(priced.details[0].unknown_reasons).toContain('quote_not_valid');
 }
});
it('keeps a budget-compatible resource beyond the first six priced candidates and forwards the real planning objective',async()=>{
 const input=matrixInput(9),catalog=input.request.catalog.map((row:Row,index:number)=>({...row,offer_id:null,publication_spec:null,pricing:{kind:'unit',amount:index<6?'1000.00':index===6?'50.00':index===7?'30.00':'10.00',currency:index===7?'USD':'CNY',quoted_at:null,valid_until:null,mandatory_fees:[]}}));
 const candidates=input.prepared.matrix.candidates.map((candidate:Row,index:number)=>({...candidate,semantic_decision_validated:true,selection:'recommended',primary_role:'industry',layer_rank:index+1}));
 const request={...input.request,task:{...input.request.task,product:'芯片制造设备',audience:'工厂工程师',hours:'24'},catalog,budget:{currency:'CNY',total_cap:'100.00',unit_price_min:'40.00',unit_price_max:'60.00'}};
 let payload:Row={};await createDecisionAdapter(async messages=>{payload=JSON.parse(messages[1]!.content);return {recommendations:[]};}).budget({request,matrix:{matrix_version:'v',matrix:{candidates}},as_of:now,skill:'test',instructions:''});
 const ids=payload.selectable_candidates.map((candidate:Row)=>candidate.candidate_id);
 expect(ids).toContain('resource:r6');expect(ids.slice(0,3)).toEqual(['resource:r0','resource:r1','resource:r2']);expect(ids).not.toContain('resource:r7');
 expect(payload.planning_objective).toMatchObject({industry:'半导体',product:'芯片制造设备',audience:'工厂工程师',regions:['广东'],hours:'24',questions:[{question_id:'q',text:'芯片制造工艺如何选择'}]});
});
it('includes known mandatory fees when choosing budget alternatives instead of ranking by the base price alone',async()=>{
 const input=matrixInput(10),catalog=input.request.catalog.map((row:Row,index:number)=>({...row,offer_id:null,publication_spec:null,pricing:{kind:'unit',amount:index<6?'1000.00':index===6?'50.00':String(10*index),currency:'CNY',quoted_at:null,valid_until:null,mandatory_fees:index===6?[{amount:'90.00',basis:'unit'}]:[]}}));
 const candidates=input.prepared.matrix.candidates.map((candidate:Row,index:number)=>({...candidate,semantic_decision_validated:true,selection:'recommended',primary_role:'industry',layer_rank:index+1}));
 let payload:Row={};await createDecisionAdapter(async messages=>{payload=JSON.parse(messages[1]!.content);return {recommendations:[]};}).budget({request:{...input.request,catalog,budget:{currency:'CNY',total_cap:'100.00'}},matrix:{matrix_version:'v',matrix:{candidates}},as_of:now,skill:'test',instructions:''});
 expect(payload.selectable_candidates.map((candidate:Row)=>candidate.candidate_id)).toEqual(['resource:r0','resource:r1','resource:r2','resource:r7','resource:r8','resource:r9']);
});
function observedAuthority(host='agency.gov.cn',question='q'){
 const scope={tenant_id:'tenant',question_id:question,platform:'platform',model:'model',model_version:'v',period:{start:'2026-11-01',end:'2026-11-09'}};
 const request:Row={task:{industry:'半导体',questions:[{question_id:'q',text:'芯片问题'},{question_id:'other',text:'其他问题'}]},catalog:[],citations:[{evidence_id:'official-evidence',source_type:'observation',data_kind:'detail',source_name:'政府机构来源',answer_record_id:'answer',citation_url:'https://'+host+'/statement',scope}]};
 const prepared=runPlanner(request,undefined,'matrix',undefined,now),candidate=prepared.matrix.candidates[0];
 const item={candidate_id:candidate.candidate_id,primary_role:'authority',auxiliary_roles:[],matched_questions:['q'],selection:'recommended',reason_summary:'实际观察记录的官方域名提供权威参考',reason_details:[],unconfirmed_items:[],references:[{type:'evidence',evidence_id:'official-evidence'}]};
 return {request,prepared,decision:{matrix_decisions:{items:[item],fit_order:[candidate.candidate_id],reviewed_candidate_ids:[candidate.candidate_id]}}};
}
it('allows exact complete official-domain observation evidence without inventing a catalogue attribute path',()=>{
 for(const host of ['agency.gov.cn','university.edu.cn']){
  const input=observedAuthority(host);expect(input.prepared.matrix.candidates[0].attribute_paths).toEqual([]);
  expect(runPlanner(input.request,input.decision,'matrix',undefined,now).matrix.status).toBe('complete');
 }
});
it('rejects name-only, different-question and non-exact observed authority claims',()=>{
 for(const input of [observedAuthority('ordinary.example'),observedAuthority('agency.gov.cn','other')]){
  const result=runPlanner(input.request,input.decision,'matrix',undefined,now);expect(result.errors.some((error:Row)=>error.code==='authority_evidence_unconfirmed')).toBe(true);
 }
 const incomplete=observedAuthority();delete incomplete.request.citations[0].answer_record_id;expect(runPlanner(incomplete.request,incomplete.decision,'matrix',undefined,now).errors.some((error:Row)=>error.code==='authority_evidence_unconfirmed')).toBe(true);
 const input=observedAuthority(),candidate=structuredClone(input.prepared.matrix.candidates[0]);candidate.identity_matches[0].relation='platform_related';candidate.evidence_relation='platform_related';
 expect(validateDecisions(input.decision.matrix_decisions,{candidates:[candidate],industry_aggregate_ids:[],require_role_evidence:true},input.request).some(error=>error.code==='authority_evidence_unconfirmed')).toBe(true);
});

it('retains a lower-ranked candidate explicitly added in the matrix through selection_preferences alone',async()=>{
 const input=matrixInput(90),candidates=input.prepared.matrix.candidates.map((candidate:Row,index:number)=>({...candidate,semantic_decision_validated:true,selection:'recommended',primary_role:'industry',layer_rank:index+1}));
 let payload:Row={};await createDecisionAdapter(async messages=>{payload=JSON.parse(messages[1]!.content);return {recommendations:[]};}).budget({request:{...input.request,selection_preferences:['resource:r89']},matrix:{matrix_version:'v',matrix:{candidates}},as_of:now,skill:'test',instructions:''});
 expect(payload.selectable_candidates.map((candidate:Row)=>candidate.candidate_id)).toEqual(['resource:r0','resource:r1','resource:r2','resource:r89']);
 expect(payload.selection_preferences).toEqual(['resource:r89']);expect(payload.resource_selections).toEqual([]);expect(payload.selected_items).toEqual([]);
});
