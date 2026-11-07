import { expect, it } from 'vitest';
import { runPlanner } from './planner.js';
import { type Row } from './common.js';

const now = '2026-11-07T08:00:00Z';
function request(): Row {
  const query = { periodType: 'DAY', date: '2026-11-06', scopeType: 'CATEGORY', scopeId: '42', modelCode: 'model-a' };
  const aggregate = { aggregate_id: 'industry-aggregate-1', source_id: 'molizhishu-public-industry', source_type: 'external_data', data_version: 'distribution-1', unit: 'citation_count', count: '9007199254740993', aggregate_scope: 'industry_distribution', dimension: 'source_type', bucket: { code: 'news', name: '新闻' }, scope: { industry: '测试行业', ...query }, applicability: { kind: 'industry_context', industry: '测试行业' } };
  return { tenant_id: 'tenant', task_id: 'task', brand_id: 'brand', task: { industry_id: 'i', industry: '测试行业', questions: [{ question_id: 'q', text: '稿件对应问题' }], industry_context: { status: 'ok', source: 'molizhishu-public-industry', industry_id: 'i', industry_name: '测试行业', query, fetched_at: now, data_version: 'distribution-1', aggregates: [aggregate], limitations: [] } }, catalog: [{ resource_id: 'r', source_name: '真实媒体', industry: '测试行业', publication_status: 'available' }] };
}
const decision = () => ({ matrix_decisions: { items: [{ candidate_id: 'resource:r', primary_role: 'industry', auxiliary_roles: [], matched_questions: ['q'], references: [{ type: 'attribute', path: 'catalog[0].industry' }, { type: 'aggregate', aggregate_id: 'industry-aggregate-1', usage: 'industry_context' }], reason_summary: '稿件与媒体属性适配，行业分布仅提供宏观参考', reason_details: [], unconfirmed_items: [], selection: 'recommended' }], fit_order: ['resource:r'] } });

it('allows scoped global distribution references without creating media or per-media evidence', () => {
  const out = runPlanner(request(), decision(), 'matrix', undefined, now);
  expect(out.status).toBe('complete');
  expect(out.matrix.candidates).toHaveLength(1);
  expect(out.matrix.candidates[0]).toMatchObject({ resource_id: 'r', aggregate_ids: [], industry_aggregate_ids: ['industry-aggregate-1'], evidence_ids: [] });
  expect(out.source_analysis.external_aggregates).toEqual([]);
  expect(out.industry_context.aggregates[0].count).toBe('9007199254740993');
  expect(out.report.industry_context).toEqual(out.scope.input_snapshot.task.industry_context);
});

it('stores frozen text once in the task and records only global references actually used by each candidate', () => {
  const r=request();r.task.manuscripts=[{article_id:'a',version:'v1',content_hash:'h',content_excerpt:'当前授权冻结正文',content_excerpt_truncated:false,content_source:'authorized_frozen_plain_text'}];
  const prepared=runPlanner(r,undefined,'matrix',undefined,now);
  expect(prepared.matrix.candidates[0].industry_aggregate_ids).toEqual([]);
  expect(prepared.matrix.candidates[0].manuscripts[0]).not.toHaveProperty('content_excerpt');
  expect(prepared.scope.task.manuscripts[0].content_excerpt).toBe('当前授权冻结正文');
  const d=decision();d.matrix_decisions.items[0]!.references.splice(1);
  expect(runPlanner(r,d,'matrix',undefined,now).matrix.candidates[0].industry_aggregate_ids).toEqual([]);
});

it('rejects wrong scope, invented aggregates, changed units and duplicate aggregate IDs', () => {
  for (const mutate of [
    (r: Row) => { r.task.industry_context.aggregates[0].scope.scopeId = '99'; },
    (r: Row) => { r.task.industry_context.aggregates[0].unit = 'content_count'; },
    (r: Row) => { r.task.industry_context.industry_id = 'other'; },
    (r: Row) => { r.task.industry_context.aggregates.push(structuredClone(r.task.industry_context.aggregates[0])); },
  ]) {
    const r = request(); mutate(r);
    expect(runPlanner(r, decision(), 'matrix', undefined, now).status).toBe('invalid_input');
  }
  const d = decision(); d.matrix_decisions.items[0]!.references[1]!.aggregate_id = 'invented';
  expect(runPlanner(request(), d, 'matrix', undefined, now).status).toBe('invalid_decisions');
});

it('retains failure limitations and never treats missing distribution as zero evidence', () => {
  const r = request();
  r.task.industry_context = { status: 'mapping_unavailable', industry_id: 'i', industry_name: '测试行业', source: 'molizhishu-public-industry', message: '行业映射尚未确认', aggregates: [], limitations: ['industry_mapping_unavailable'] };
  const d = decision(); d.matrix_decisions.items[0]!.references.splice(1);
  const out = runPlanner(r, d, 'matrix', undefined, now);
  expect(out.status).toBe('complete');
  expect(out.limitations).toContain('industry_mapping_unavailable');
  expect(out.matrix.candidates[0].industry_aggregate_ids).toEqual([]);
  expect(out.report.industry_context.status).toBe('mapping_unavailable');
});

it('requires aggregate references rather than disguising distribution counts as attributes', () => {
  for (const path of ['task.industry_context', 'task.industry_context.aggregates[0].count']) {
    const d = decision(); d.matrix_decisions.items[0]!.references = [{ type: 'attribute', path }];
    expect(runPlanner(request(), d, 'matrix', undefined, now).errors.map((error: Row) => error.code)).toContain('industry_context_requires_aggregate_reference');
  }
});

it('keeps the saved distribution for budget replay and invalidates changed scope or data', () => {
  const r = request(), first = runPlanner(r, decision(), 'matrix', undefined, now);
  const budget = { ...r, budget: { currency: 'CNY', total_cap: '100' } };
  expect(runPlanner(budget, undefined, 'budget', first, now).matrix_version).toBe(first.matrix_version);
  const changed = structuredClone(budget); changed.task.industry_context.aggregates[0].count = '1';
  expect(runPlanner(changed, undefined, 'budget', first, now).status).toBe('stale_matrix');
});
