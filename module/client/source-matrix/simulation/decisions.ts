import type { Row } from './kernel/common.js';
import { priceItems, verifyPlan } from './kernel/budget.js';
import { parseMoney } from './kernel/contracts.js';

export interface AttributeReference {type:'attribute';path:string}
export interface EvidenceReference {type:'evidence';evidence_id:string}
export interface AggregateReference {type:'aggregate';aggregate_id:string;usage:'industry_context'}
export interface MatrixDecision {
  candidate_id:string;primary_role:'authority'|'industry'|'regional'|'supplement'|'exploration';auxiliary_roles:string[];
  matched_questions:string[];references:Array<AttributeReference|EvidenceReference|AggregateReference>;
  reason_summary:string;reason_details:string[];unconfirmed_items:string[];selection:'recommended'|'alternative';
  supplemental_value?:string;supplemental_to?:string[];exploration_hypothesis?:string;verification_items?:string[];
}
export interface MatrixDecisions {items:MatrixDecision[];fit_order:string[]}
export interface PublicationItem {
  article_id:string;version:string;resource_id:string;offer_id:string;
  publication_spec:string;quantity:number;purpose:'standard'|'exploration';
}
export interface BudgetDecision {strategy:string;reason_summary:string;items:PublicationItem[]}
/** Exactly the adapter's whitelisted payload. Provenance is carried outside decisions. */
export interface SimulatedDecisionPayload {matrix_decisions?:MatrixDecisions;budget_plans?:BudgetDecision[]}

const sameIndustry=(c:Row,r:Row)=>c.attributes.industry===r.task.industry||c.recommendation_basis?.some((x:Row)=>x.industry===r.task.industry);
const confirmedMatches=(c:Row):Row[]=>(c.identity_matches??[]).filter((m:Row)=>m.relation==='exact'&&['tenant_id','question_id','platform','model','model_version','period'].every(k=>m.scope?.[k]!=null));
const evidenceCount=(c:Row)=>new Set(confirmedMatches(c).flatMap(m=>m.evidence_ids)).size;
function contentScore(c:Row,r:Row) {
  return (sameIndustry(c,r)?100:0)+evidenceCount(c)*5+(c.attributes.verified===true?2:0);
}
/** Content decisions deliberately ignore all prices and budget fields. */
export function simulatedMatrixDecisions(request:Row,prepared:Row):MatrixDecisions {
  const ranked=[...prepared.candidates].sort((a,b)=>contentScore(b,request)-contentScore(a,request)||a.candidate_id.localeCompare(b.candidate_id));
  const base=ranked.find(c=>sameIndustry(c,request)&&c.channel_status==='eligible'&&c.evidence_relation==='exact');
  const questions:string[]=request.task.questions.map((q:Row)=>q.question_id);
  const regions:string[]=request.task.regions;
  const regional=regions.length>0&&!regions.includes('全国')&&!regions.includes('nationwide');
  const items:MatrixDecision[]=ranked.map(c=>{
    const refs:MatrixDecision['references']=[];
    const path:string|undefined=c.attribute_paths.find((p:string)=>p.startsWith('catalog['));
    if(path&&c.attributes.source_name)refs.push({type:'attribute',path:path+'.source_name'});
    else refs.push({type:'attribute',path:'task.industry'});
    for(const match of confirmedMatches(c)) {
      if(match.relation==='exact'&&questions.includes(match.scope?.question_id))for(const id of match.evidence_ids) {
        if(!refs.some(x=>x.type==='evidence'&&x.evidence_id===id))refs.push({type:'evidence',evidence_id:id});
      }
    }
    for(const id of c.aggregate_ids)refs.push({type:'aggregate',aggregate_id:id,usage:'industry_context'});
    const aligned=sameIndustry(c,request),edge=c.attributes.simulation_edge;
    let role:MatrixDecision['primary_role']='industry';
    if(c.candidate_id===base?.candidate_id)role='industry';
    else if(edge==='identity_conflict'||edge==='unknown'||!c.resource_id)role='exploration';
    else if(regional&&regions.some(x=>(c.attributes.regions??[]).includes(x)))role='regional';
    else if(aligned&&evidenceCount(c)>=3&&c.attributes.verified===true)role='authority';
    else if(!aligned)role=base?'supplement':'exploration';
    const decision:MatrixDecision={
      candidate_id:c.candidate_id,primary_role:role,auxiliary_roles:[],matched_questions:questions,references:refs,
      selection:aligned?'recommended':'alternative',
      reason_summary:`模拟启发式：${aligned?'匹配目标行业':'跨行业备选'}；身份明确的明细证据 ${evidenceCount(c)} 条；${c.aggregate_ids.length} 条行业汇总依据。`,
      reason_details:[`内容适配分 ${contentScore(c,request)}（行业匹配、明细依据、模拟认证属性）`,'金额不参与内容矩阵排序；行业汇总仅用于行业语境，供应商声明不充当明细证据。'],
      unconfirmed_items:[...c.pending_conditions,...(c.evidence_relation!=='exact'?['证据身份关系仍需核实']:[])],
    };
    if(role==='supplement') {decision.supplemental_value='提供跨行业应用场景对照，不能替代目标行业依据';decision.supplemental_to=[base.candidate_id];}
    if(role==='exploration') {decision.exploration_hypothesis='小范围验证该来源与目标问题是否相关';decision.verification_items=['核实来源账号身份','确认实际稿件、报价和引用范围'];}
    return decision;
  });
  return {items,fit_order:items.map(x=>x.candidate_id)};
}
function itemsFor(c:Row,purpose:PublicationItem['purpose'],request:Row):PublicationItem[] {
  const offers:Row[]=c.offers;
  const offer=offers.find(o=>o.offer_id&&!o.offer_id.startsWith('sim-conflict-'));
  if(!offer)return [];
  const make=(m:Row):PublicationItem=>({article_id:m.article_id,version:m.version,resource_id:offer.resource_id,offer_id:offer.offer_id,publication_spec:offer.publication_spec,quantity:1,purpose});
  return offer.pricing?.kind==='package'?request.task.manuscripts.map(make):[make(request.task.manuscripts[0])];
}
/** Heuristics propose items. Kernel pricing and verification decide every amount/status. */
export function simulatedBudgetPlans(request:Row,matrix:Row,asOf:string,selectedIds:string[]):BudgetDecision[] {
  const candidates:Row[]=matrix.matrix.candidates.filter((c:Row)=>c.resource_id&&c.offers.length);
  const measured=candidates.map(c=>({c,items:itemsFor(c,c.primary_role==='exploration'?'exploration':'standard',request)})).map(x=>({...x,price:priceItems(x.items,request.catalog,asOf)}));
  const known=measured.filter(x=>x.c.channel_status==='eligible'&&x.price.complete&&x.price.currency===request.budget.currency&&sameIndustry(x.c,request));
  const cost=(x:typeof measured[number]):bigint=>BigInt(x.price.total_cost_minor??'0');
  const cap=BigInt(matrixBudgetMinor(request.budget.total_cap,request.budget.currency));
  // Scores only rank proposals; no score or model field can set a computed kernel status.
  const score=(x:typeof measured[number])=>contentScore(x.c,request)+(selectedIds.includes(x.c.candidate_id)?200:0);
  const cheapest=[...known].sort((a,b)=>Number(selectedIds.includes(b.c.candidate_id))-Number(selectedIds.includes(a.c.candidate_id))||(cost(a)<cost(b)?-1:cost(a)>cost(b)?1:a.c.candidate_id.localeCompare(b.c.candidate_id)));
  const fit=[...known].sort((a,b)=>{
    const affinity=(x:typeof measured[number])=>score(x)+(cost(x)<=cap?10:0);
    return affinity(b)-affinity(a)||(cost(a)<cost(b)?-1:cost(a)>cost(b)?1:a.c.candidate_id.localeCompare(b.c.candidate_id));
  });
  function propose(order:typeof known,limit:number,explore:boolean):PublicationItem[] {
    let chosen:PublicationItem[]=[];
    for(const x of order) {
      if(x.items[0]?.purpose==='exploration'&&(!explore||request.budget.exploration_enabled!==true))continue;
      const next=[...chosen,...x.items];
      const checked=verifyPlan({items:next},matrix,request,asOf);
      if(checked.budget_feasible)chosen=next;
      if(new Set(chosen.map(x=>x.resource_id)).size>=limit)break;
    }
    // Preserve an actual failing proposal under a too-small cap, instead of claiming feasibility.
    if(!chosen.length&&order.length)chosen=order[0]!.items;
    return chosen;
  }
  const economical=propose(cheapest.filter(x=>x.items[0]?.purpose==='standard'),3,false);
  let content=propose(fit.filter(x=>x.items[0]?.purpose==='standard'),5,false);
  if(request.budget.exploration_enabled===true) {
    const trial=fit.find(x=>x.items[0]?.purpose==='exploration'&&!content.some(y=>y.resource_id===x.c.resource_id));
    if(trial)content=[...content,...trial.items]; // Kernel checks both caps, including the exploration sub-cap.
  }
  const boundary=measured.filter(x=>sameIndustry(x.c,request)&&['missing_price','unknown','attribute_conflict','identity_conflict'].includes(x.c.attributes.simulation_edge)).slice(0,4);
  const foreign=measured.find(x=>sameIndustry(x.c,request)&&x.price.currency&&x.price.currency!==request.budget.currency);
  const pack=measured.find(x=>sameIndustry(x.c,request)&&x.c.offers[0]?.pricing?.kind==='package');
  const edgeItems=[...boundary.flatMap(x=>x.items),...(foreign?.items??[]),...(pack?.items??[])];
  return [
    {strategy:'经济适配',reason_summary:'模拟决策：优先预算偏好与同币种已知报价，按内核试算保留至多三家；不足时保留失败提案供查看原因。',items:economical},
    {strategy:'内容覆盖',reason_summary:'模拟决策：行业匹配、身份明确的证据数量与价格适配共同排序；探索项另由内核校验双预算上限。',items:content},
    {strategy:'边界观察（诊断提案）',reason_summary:'模拟决策：故意提交缺失报价、属性冲突、未知条件、混合币种和完整套餐，观察内核拒绝或待确认原因；这不是可采购组合。',items:edgeItems},
  ];
}
// Adapter uses the kernel's money parser even for heuristic ranking, never floating-point money.
function matrixBudgetMinor(amount:string,currency:string) {return parseMoney(amount,currency).toString();}
