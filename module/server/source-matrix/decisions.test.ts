import { afterEach, expect, it, vi } from 'vitest';
import { BRAND_DATA_BATCHES, brandCitationRecords } from './brand-data.js';
import { createEnvDecisionAdapter } from './decisions.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('exposes the yihang batch metadata with its file fingerprint and model list', () => {
  expect(BRAND_DATA_BATCHES).toHaveLength(1);
  const batch = BRAND_DATA_BATCHES[0]!;
  expect(batch.sourceFile).toBe('一航软件-信源分析-20260913-214944.xlsx');
  expect(batch.sourceSha256).toBe('639e43735887ff20852f99aa4bc643853259dbd7f44aba163598064720a60e0d');
  expect(batch.recordCount).toBe(502);
  expect(batch.period).toEqual({ start: '2026-09-07', end: '2026-09-13' });
  expect(batch.models).toEqual(['百度文心-手机版', '百度文心-网页版', '通义千问-手机版', '通义千问-网页版']);
});

it('maps every exported row into a planner citation with honest unknowns, and filters by platform', () => {
  const records = brandCitationRecords(BRAND_DATA_BATCHES[0]!.id);
  expect(records).toHaveLength(502);
  const first = records[0]!;
  expect(first.data_kind).toBe('detail');
  expect(first.source_type).toBe('observation');
  expect(String(first.evidence_id)).toMatch(/^sample:/);
  expect(first.published_at).toBeNull(); // 引用日期不得冒充发布时间
  expect(first.quality).toMatchObject({ missing_answer_id: true, missing_publication_date: true });
  expect(records.filter(record => record.published_at !== null)).toHaveLength(0);
  const filtered = brandCitationRecords(BRAND_DATA_BATCHES[0]!.id, ['通义千问-手机版']);
  expect(filtered).toHaveLength(49);
  expect(new Set(filtered.map(record => record.scope.platform))).toEqual(new Set(['通义千问-手机版']));
  // 空名称行保留 null，不补造媒体名
  expect(records.filter(record => record.source_name === null)).toHaveLength(3);
});

it('keeps the env adapter disabled without a server key', () => {
  expect(createEnvDecisionAdapter({})).toBeUndefined();
  expect(createEnvDecisionAdapter({ FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: 'https://example.invalid' })).toBeUndefined();
});

it('parses model decisions through the OpenAI-compatible seam and stays kernel-validated downstream', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '```json\n{"matrix_decisions":{"items":[],"fit_order":[]}}\n```' } }] }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  const adapter = createEnvDecisionAdapter({ FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'server-only' })!;
  expect(adapter).toBeTruthy();
  const decisions = await adapter.matrix({ request: { task: {}, catalog: [] }, prepared: {}, as_of: '2026-10-25T00:00:00Z', skill: 'skill', instructions: 'instructions' });
  expect(decisions).toEqual({ matrix_decisions: { items: [], fit_order: [] } });
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(String(url)).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
  const headers = init.headers as Record<string, string>;
  expect(headers.Authorization).toBe('Bearer server-only');
  expect((init.body as string)).toContain('信源矩阵语义决策器');
  fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"budget_plans":[{"strategy":"稳健","reason_summary":"覆盖核心层","items":[]}]}' } }] }) }));
  const budget = await adapter.budget({ request: { budget: { currency: 'CNY', total_cap: '3000' }, task: { manuscripts: [] } }, matrix: { matrix: { candidates: [] } }, as_of: '2026-10-25T00:00:00Z', skill: 'skill', instructions: 'instructions' });
  expect(budget).toEqual({ budget_plans: [{ strategy: '稳健', reason_summary: '覆盖核心层', items: [] }] });
});

it('surfaces model transport failures as errors so the route records decision_adapter_unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
  const adapter = createEnvDecisionAdapter({ FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'k' })!;
  await expect(adapter.matrix({ request: { task: {}, catalog: [] }, prepared: {}, as_of: 'x', skill: 's', instructions: 'i' })).rejects.toThrow('llm_http_503');
});
