import { clone,digest,equal,issue,object,rows,semantic,stableJson,text,timestamp,unique,type Row } from './common.js';
import { amounts } from './contracts.js';
import { validateNested,validateRequest } from './contracts.js';
import { analyzeEvidence } from './evidence.js';
import { assembleMatrix } from './matrix.js';
import { verifyPlan } from './budget.js';
const binding=(r:Row)=>Object.fromEntries(['tenant_id','task_id','brand_id'].map(k=>[k,r[k]??null]));
const fail=(status:string,errors:Row[]):Row=>({schema_version:'1.0',status,errors,budget_plans:[]});
function rebind(md:Row,old:Row,current:Row):Row {
  const d=clone(md);for(const item of d.items??[])for(const ref of item.references??[]){
    if(ref.type!=='attribute'||typeof ref.path!=='string')continue;const m=/^catalog\[(\d+)\](.*)$/.exec(ref.path);if(!m)continue;
    const original=old.catalog?.[Number(m[1])];if(!original?.resource_id)throw new Error('snapshot_reference_unavailable');
    const i=(current.catalog??[]).findIndex((x:Row)=>x.resource_id===original.resource_id&&equal(semantic(x),semantic(original)));
    if(i<0)throw new Error('snapshot_reference_unavailable');ref.path=`catalog[${i}]${m[2]}`;
  }return d;
}
function minimum(r:Row,out:Row):Row {
  const currency=r.budget?.currency??'',result:Row={status:'unproven',scope:'unique_candidate_offer_and_declared_publications',currency:currency||null,reason:'requires_unique_candidate_offer_and_complete_declared_publications',items:[]};
  amounts(result,{total_cost:null,funding_gap:null},currency);
  const candidates=out.matrix.candidates.filter((c:Row)=>c.resource_id),offers=unique<Row>(r.catalog??[]),plans:Row[]=out.budget_plans,p=plans[0];
  if(candidates.length!==1||offers.length!==1||plans.length!==1||!p)return result;
  const declared:Row[]=r.task.manuscripts?.length?r.task.manuscripts:[r.task.manuscript??{}];
  if(offers[0]!.pricing?.kind!=='unit'||!p.complete||!p.semantic_ready||candidates[0].channel_status!=='eligible'||p.items.some((x:Row)=>!declared.some(m=>m.article_id===x.article_id&&m.version===x.version))||p.errors.some((e:Row)=>!['total_cap_exceeded','exploration_cap_exceeded','locked_selection_conflict'].includes(e.code))||p.currency!==currency||p.total_cap_minor===null)return result;
  const cost=BigInt(p.total_cost_minor),cap=BigInt(p.total_cap_minor);Object.assign(result,{status:'confirmed_for_declared_publications',reason:'仅证明唯一候选和报价下所列声明发布项，不证明整个任务覆盖或全局最低',items:clone(p.items)});amounts(result,{total_cost:cost,funding_gap:cost>cap?cost-cap:0n},currency);return result;
}
/** Pure, offline trusted validator. No adapter, network, SQL, timers or publishing. */
export function runPlanner(request:Row,decisions:Row|undefined,stage:'matrix'|'budget',previous:Row|undefined,asOf:string):Row {
  const errors=validateRequest(request,stage,asOf);if(errors.length)return fail('invalid_input',errors);
  const nested=validateNested(request);if(nested.length)return fail('invalid_input',nested);
  const r=clone(request),d=clone(decisions??{});
  if(!object(d)||Object.keys(d).some(k=>!['matrix_decisions','budget_plans'].includes(k)))return fail('invalid_input',[issue('unknown_field','decisions')]);
  try{
    const analysis=analyzeEvidence(r.citations??[],r.scope??{},r.identity_config??{});let md:Row=d.matrix_decisions??{};
    if(stage==='budget'){
      if(!previous)return fail('needs_matrix',[issue('matrix_required','previous_matrix')]);
      const s=previous.snapshot,fresh=assembleMatrix(r,analysis,{});
      if(!object(s)||!equal(s.binding,binding(r))||fresh.matrix_version!==previous.matrix_version||(s.expires_at&&timestamp(asOf)>timestamp(s.expires_at)))return fail('stale_matrix',[issue('stale_matrix','previous_matrix','任务、证据、身份、媒体属性或预检已变更，请重建矩阵')]);
      if(d.matrix_decisions!==undefined&&!equal(d.matrix_decisions,s.matrix_decisions))return fail('invalid_decisions',[issue('matrix_decisions_changed','decisions.matrix_decisions')]);
      if(!object(previous.scope?.input_snapshot))return fail('stale_matrix',[issue('snapshot_input_required','previous_matrix')]);
      try{md=rebind(s.matrix_decisions,previous.scope.input_snapshot,r);}catch{return fail('stale_matrix',[issue('snapshot_reference_unavailable','previous_matrix')]);}
    }
    const out=assembleMatrix(r,analysis,md);
    if(out.errors.some((e:Row)=>e.code==='invalid_type'))return fail('invalid_input',out.errors);
    out.stage=stage;out.as_of=asOf;out.snapshot={binding:binding(r),matrix_decisions:clone(md),generated_at:asOf};
    if(stage==='budget'&&previous?.snapshot.expires_at)out.snapshot.expires_at=previous.snapshot.expires_at;
    out.scope.input_snapshot=clone(r);out.scope.generated_at=asOf;out.selected_items=clone(r.selected_items??r.task.selected_items??[]);
    if(stage==='budget'&&out.matrix.status==='complete'){
      const submitted=d.budget_plans??[],uniquePlans=new Map<string,Row>(),planErrors:Row[]=[];
      if(!rows(submitted))return fail('invalid_input',[issue('invalid_type','decisions.budget_plans')]);
      for(const [i,p] of submitted.entries()){
        if(!rows(p.items))return fail('invalid_input',[issue('invalid_type',`budget_plans[${i}].items`)]);
        if(Object.keys(p).some(k=>!['strategy','reason_summary','items','coverage','gaps','tradeoffs','unconfirmed_items'].includes(k)))planErrors.push(issue('untrusted_plan_field',`budget_plans[${i}]`));
        if(!text(p.strategy)||!text(p.reason_summary))planErrors.push(issue('missing_plan_reason',`budget_plans[${i}]`));
        for(const item of p.items)if(Object.keys(item).some(k=>!['article_id','version','resource_id','offer_id','publication_spec','quantity','purpose'].includes(k)))planErrors.push(issue('untrusted_item_field',`budget_plans[${i}].items`));
        const key=stableJson(unique<string>(p.items.map(stableJson)).sort());if(!uniquePlans.has(key))uniquePlans.set(key,p);
      }
      if(uniquePlans.size>3)planErrors.push(issue('too_many_plans','budget_plans'));
      if(planErrors.length){out.status='invalid_decisions';out.errors.push(...planErrors);}else{
        out.budget_plans=[...uniquePlans.values()].map(p=>({...verifyPlan(p,out,r,asOf),...Object.fromEntries(['strategy','reason_summary','coverage','gaps','tradeoffs','unconfirmed_items'].filter(k=>k in p).map(k=>[k,clone(p[k])]))}));
        if(out.budget_plans.some((p:Row)=>p.errors.some((e:Row)=>e.code==='invalid_type')))return fail('invalid_input',out.budget_plans.flatMap((p:Row)=>p.errors));
        out.status=!r.budget?'needs_budget':!uniquePlans.size?'needs_budget_plans':'complete';
      }
    }
    out.warnings=r.budget?.exploration_enabled===true&&!('exploration_cap' in r.budget)?[issue('exploration_cap_required','budget.exploration_cap','探索投放需要显式正子额度；普通方案仍可校验')]:[];
    out.minimum_known_cost=minimum(r,out);
    out.plan_id='plan-'+digest(r.task_id?binding(r):{...binding(r),task:semantic(r.task)});
    out.plan_version='plan-version-'+digest({request:r,decisions:md,plans:out.budget_plans,status:out.status,matrix_version:out.matrix_version});
    out.report=Object.fromEntries(['status','plan_id','plan_version','matrix_version','scope','source_analysis','matrix','budget_plans','limitations','warnings','minimum_known_cost','errors'].map(k=>[k,clone(out[k])]));
    return out;
  }catch{return fail('invalid_input',[issue('invalid_structure','request','嵌套字段不符合契约，未接纳部分结果')]);}
}
