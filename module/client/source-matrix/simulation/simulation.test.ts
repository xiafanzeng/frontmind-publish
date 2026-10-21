// Source-only regression cases for ZCode; not executed in this handoff round.
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './kernel/hash.js';
import { sha256Hex as nodeSha256Hex } from '../../../server/domain/hash.js';
import { runPlanner as serverPlanner } from '../../../server/source-matrix/planner.js';
import { defaultInput, generateSimulationData, SIMULATION_AS_OF, SIMULATION_SEED } from './data';
import { applySimulationBudget, buildSimulationMatrix, exportSimulation } from './pipeline';
import { simulatedMatrixDecisions } from './decisions';
import { analyzeEvidence } from './kernel/evidence.js';
import { prepareCandidates } from './kernel/matrix.js';
import { priceItems } from './kernel/budget.js';

const budget={currency:'CNY',total_cap:'10000',exploration_enabled:true,exploration_cap:'1500'};
describe('deterministic simulated input and actual kernel computation',()=>{
  it('keeps 224 distinct media, 7 industries and 35 edge cases reproducible',()=>{
    const a=generateSimulationData(),b=generateSimulationData(SIMULATION_SEED);
    expect(a).toEqual(b);
    expect(new Set(a.catalog.map(x=>x.resource_id)).size).toBe(224);
    expect(new Set(a.recommendations.map(x=>x.industry)).size).toBe(7);
    expect(new Set(a.catalog.filter(x=>x.simulation_edge).map(x=>x.resource_id)).size).toBe(35);
    expect(new Set(a.evidenceTemplates.map(x=>x.usage))).toEqual(new Set(['detail_evidence','industry_context','supplier_claim']));
  });
  it('matches node SHA-256 for empty, padding boundaries, Unicode and bytes',()=>{
    for(const x of ['', 'abc', 'a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'模拟媒体🌱',new Uint8Array([0,1,127,128,255])])expect(sha256Hex(x)).toBe(nodeSha256Hex(x));
  });
  it('produces the exact server matrix and budget results without changing trusted fields',()=>{
    const first=buildSimulationMatrix(defaultInput());
    expect(first.result.status).toBe('complete');
    expect(first.result).toEqual(serverPlanner(first.request,first.decisions,'matrix',undefined,SIMULATION_AS_OF));
    const second=applySimulationBudget(first,budget,[]);
    expect(second.result.status).toBe('complete');
    expect(second.result).toEqual(serverPlanner({...first.request,budget},{budget_plans:second.decisions.budget_plans},'budget',first.matrixSnapshot,SIMULATION_AS_OF));
    expect(second.result.matrix_version).toBe(first.result.matrix_version);
    expect(second.result.minimum_known_cost.status).toBe('unproven');
    expect(second.result.budget_plans.length).toBeLessThanOrEqual(3);
    expect(second.result.budget_plans.some((x:any)=>x.execution_recommended===true)).toBe(true);
    expect(second.result.budget_plans.some((x:any)=>x.errors.some((e:any)=>e.code==='multiple_currencies'))).toBe(true);
    expect(second.result.budget_plans.some((x:any)=>x.unknown_items.length>0)).toBe(true);
  });
  it('keeps prices and budgets out of first-stage content decisions',()=>{
    const first=buildSimulationMatrix(defaultInput()),request=structuredClone(first.request);
    request.budget={currency:'USD',total_cap:'1'};
    request.catalog.forEach((c:any)=>{c.pricing.amount='999999';});
    const prepared=prepareCandidates(request,analyzeEvidence(request.citations,request.scope,request.identity_config));
    expect(simulatedMatrixDecisions(request,prepared)).toEqual(first.decisions.matrix_decisions);
  });
  it('exposes real conservative identity, resource conflict and unknown paths',()=>{
    const r=buildSimulationMatrix(defaultInput()).result;
    expect(r.matrix.candidates.some((c:any)=>c.pending_conditions.includes('conflicting_resource_attributes'))).toBe(true);
    expect(r.source_analysis.detail_citations.some((c:any)=>c.status==='identity_conflict')).toBe(true);
    expect(r.source_analysis.unknown_records.length).toBeGreaterThan(0);
    expect(r.source_analysis.total_citations).toBeNull();
    expect(r.source_analysis.supplier_claims.length).toBeGreaterThan(0);
    expect(r.source_analysis.external_aggregates.length).toBeGreaterThan(0);
    expect(r.matrix.candidates.some((c:any)=>c.aggregate_ids.length>0)).toBe(true);
  });
  it('prices full packages once and rejects missing members through the kernel',()=>{
    const first=buildSimulationMatrix(defaultInput()),pack=first.request.catalog.find((c:any)=>c.pricing.kind==='package');
    const all=pack.pricing.included_items;
    const complete=priceItems(all,first.request.catalog,SIMULATION_AS_OF);
    expect(complete.complete).toBe(true);
    expect(complete.details[1].cost_minor).toBe('0');
    expect(priceItems(all.slice(0,1),first.request.catalog,SIMULATION_AS_OF).unknown_items[0].reasons).toContain('package_members_unresolved');
  });
  it('checks tiny/zero caps and both exploration/total caps without claiming feasibility',()=>{
    const first=buildSimulationMatrix(defaultInput());
    const tiny=applySimulationBudget(first,{...budget,total_cap:'0',exploration_cap:'0'},[]);
    expect(tiny.result.budget_plans.every((p:any)=>!p.execution_recommended)).toBe(true);
    expect(tiny.result.budget_plans.some((p:any)=>p.errors.some((e:any)=>e.code==='total_cap_exceeded'))).toBe(true);
    const exploration=applySimulationBudget(first,{...budget,exploration_cap:'1'},[]);
    expect(exploration.result.budget_plans.some((p:any)=>p.errors.some((e:any)=>e.code==='exploration_cap_exceeded'))).toBe(true);
  });
  it('keeps changed budgets out of the matrix version and preserves provenance on export',()=>{
    const first=buildSimulationMatrix(defaultInput());
    const a=applySimulationBudget(first,budget,[]),b=applySimulationBudget(first,{...budget,total_cap:'20000'},[]);
    expect(a.result.matrix_version).toBe(b.result.matrix_version);
    expect(a.result.plan_version).not.toBe(b.result.plan_version);
    const exported=exportSimulation(a);
    expect(exported.simulation.decisions_source).toBe('simulated');
    expect(exported.decisions.source).toBe('simulated');
    expect(exported.report).toEqual(a.result.report);
    expect(buildSimulationMatrix(defaultInput()).result).toEqual(first.result);
  });
});
