import { runPlanner } from './kernel/planner.js';
import { prepareCandidates } from './kernel/matrix.js';
import { analyzeEvidence } from './kernel/evidence.js';
import type { Row } from './kernel/common.js';
import type { MatrixResult } from '../types';
import { simulatedMatrixDecisions, simulatedBudgetPlans, type SimulatedDecisionPayload } from './decisions';
import { generateSimulationData, simulationRequest, SIMULATION_AS_OF, SIMULATION_NOTICE, SIMULATION_SEED, type SimulationInput, type SimulationBudget } from './data';

export { runPlanner } from './kernel/planner.js';
export interface SimulationProvenance {
  mode:'simulated';decisions_source:'simulated';data_source:'simulated';seed:number;as_of:string;notice:string;
}
export const provenance:SimulationProvenance={mode:'simulated',decisions_source:'simulated',data_source:'simulated',seed:SIMULATION_SEED,as_of:SIMULATION_AS_OF,notice:SIMULATION_NOTICE};
export interface SimulationRun {
  request:Row;matrixSnapshot:Row;result:Row;
  decisions:SimulatedDecisionPayload;simulation:SimulationProvenance;
}
export function buildSimulationMatrix(input:SimulationInput):SimulationRun {
  const request=simulationRequest(input,generateSimulationData());
  const analysis=analyzeEvidence(request.citations,request.scope,request.identity_config);
  const prepared=prepareCandidates(request,analysis);
  const decisions:SimulatedDecisionPayload={matrix_decisions:simulatedMatrixDecisions(request,prepared)};
  const result=runPlanner(request,decisions,'matrix',undefined,SIMULATION_AS_OF);
  return {request,matrixSnapshot:result,result,decisions,simulation:provenance};
}
export function applySimulationBudget(run:SimulationRun,budget:SimulationBudget,selectedIds:string[]):SimulationRun {
  const request={...structuredClone(run.request),budget:structuredClone(budget)};
  const decisions:SimulatedDecisionPayload={budget_plans:simulatedBudgetPlans(request,run.matrixSnapshot,SIMULATION_AS_OF,selectedIds)};
  const result=runPlanner(request,decisions,'budget',run.matrixSnapshot,SIMULATION_AS_OF);
  return {...run,result,decisions:{matrix_decisions:run.decisions.matrix_decisions,...decisions}};
}
/** Conversion is view-only. No result field is invented or patched by this boundary. */
export function presentSimulation(run:SimulationRun):MatrixResult|null {
  return run.result.matrix&&run.result.source_analysis?run.result as MatrixResult:null;
}
export function exportSimulation(run:SimulationRun) {
  return {simulation:run.simulation,decisions:{source:'simulated',payload:run.decisions},result:run.result,report:run.result.report};
}
