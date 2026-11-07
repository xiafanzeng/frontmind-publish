import { afterEach, expect, it, vi } from 'vitest';
import { BRAND_DATA_BATCHES, brandCitationRecords } from './brand-data.js';
import { compactCandidates, createDecisionAdapter, createEnvDecisionAdapter, environmentChatEndpoint } from './decisions.js';
import { SOURCE_MATRIX_INSTRUCTIONS, SOURCE_MATRIX_SKILL } from './instructions.js';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const platform = { FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'fixture-server-key', FRONTMIND_SOURCE_MATRIX_LLM_MODEL: 'configured-model', FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: 'https://api.xty.app/v1', FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: 'https://api.xty.app/v1' };
const matrixInput = { request: { task: {}, catalog: [] }, prepared: {}, as_of: '2026-11-07T00:00:00Z', skill: SOURCE_MATRIX_SKILL, instructions: SOURCE_MATRIX_INSTRUCTIONS };
const envelope = (content: unknown, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content }, ...extra }] }), { headers: { 'Content-Type': 'application/json' } });

it('preserves yihang sample provenance and honest unknown dates', () => {
  const batch = BRAND_DATA_BATCHES[0]!;
  expect(BRAND_DATA_BATCHES).toHaveLength(1);
  expect(batch.sourceFile).toBe('一航软件-信源分析-20260913-214944.xlsx');
  expect(batch.sourceSha256).toBe('639e43735887ff20852f99aa4bc643853259dbd7f44aba163598064720a60e0d');
  expect(batch.recordCount).toBe(502);
  expect(batch.period).toEqual({ start: '2026-09-07', end: '2026-09-13' });
  const records = brandCitationRecords(batch.id);
  expect(records).toHaveLength(502);
  expect(records[0]).toMatchObject({ data_kind: 'detail', source_type: 'observation', published_at: null, quality: { missing_answer_id: true, missing_publication_date: true } });
  expect(String(records[0]!.evidence_id)).toMatch(/^sample:/);
  expect(records.filter(record => record.published_at !== null)).toHaveLength(0);
  const filtered = brandCitationRecords(batch.id, ['通义千问-手机版']);
  expect(filtered).toHaveLength(49);
  expect(new Set(filtered.map(record => record.scope.platform))).toEqual(new Set(['通义千问-手机版']));
  expect(records.filter(record => record.source_name === null)).toHaveLength(3);
});

it('requires an explicit model and matching platform allowlist without guessing defaults', () => {
  expect(createEnvDecisionAdapter({})).toBeUndefined();
  expect(createEnvDecisionAdapter({ FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'fixture-key' })).toBeUndefined();
  for (const missing of ['FRONTMIND_SOURCE_MATRIX_LLM_MODEL', 'FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS']) {
    expect(createEnvDecisionAdapter({ ...platform, [missing]: '' })).toBeUndefined();
  }
  expect(createEnvDecisionAdapter({ ...platform, FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: 'https://other.invalid/v1' })).toBeUndefined();
  expect(createEnvDecisionAdapter({ ...platform, FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' })).toBeUndefined();
});

it('normalizes platform root, v1 and complete endpoint once, including allowlist roots', () => {
  for (const base of ['https://api.xty.app', 'https://api.xty.app/', 'https://api.xty.app/v1/', 'https://api.xty.app/v1/chat/completions/']) {
    expect(environmentChatEndpoint({ FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: base })).toBe('https://api.xty.app/v1/chat/completions');
    expect(createEnvDecisionAdapter({ ...platform, FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: base, FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: base })?.identify).toBeTypeOf('function');
  }
  for (const base of ['http://api.xty.app/v1', 'https://user@api.xty.app/v1', 'https://api.xty.app/v1?key=x', 'https://api.xty.app/v1/../v1', 'https://api.xty.app.evil.invalid/v1']) {
    expect(() => environmentChatEndpoint({ FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: base })).toThrow('endpoint_not_allowed');
  }
});

it('sends configured platform Bearer and parses a complete fenced JSON response', async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const fetchMock = vi.fn(async (_url: unknown, _init: RequestInit) => envelope(fence + 'json\n{"matrix_decisions":{"items":[],"fit_order":[]}}\n' + fence));
  vi.stubGlobal('fetch', fetchMock);
  expect(await createEnvDecisionAdapter(platform)!.matrix(matrixInput)).toBeUndefined();
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe('https://api.xty.app/v1/chat/completions');
  expect(init.redirect).toBe('error'); expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture-server-key' });
  expect(JSON.parse(String(init.body)).model).toBe('configured-model');
  expect(String(init.body)).toContain(SOURCE_MATRIX_SKILL);
});

it('rejects HTTP errors, refusal, incomplete, empty, oversized and malformed output safely', async () => {
  const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  const adapter = createEnvDecisionAdapter(platform)!;
  await expect(adapter.matrix(matrixInput)).rejects.toThrow('llm_http_503');
  const cases: Array<[Response, string]> = [
    [envelope('{}', { message: { content: '{}', refusal: 'refused' } }), 'provider_refused'],
    [envelope('{}', { finish_reason: 'content_filter' }), 'provider_refused'],
    [envelope('{}', { finish_reason: 'length' }), 'provider_incomplete_response'],
    [envelope(''), 'provider_empty_response'],
    [envelope('prefix {"matrix_decisions":{}} trailing'), 'provider_invalid_response'],
    [envelope('[]'), 'provider_invalid_response'],
    [new Response('{not-json'), 'provider_invalid_response'],
    [new Response('', { headers: { 'content-length': '2000001' } }), 'provider_response_too_large'],
  ];
  for (const [response, error] of cases) { fetchMock.mockResolvedValueOnce(response); await expect(adapter.matrix(matrixInput)).rejects.toThrow(error); }
  fetchMock.mockRejectedValueOnce(new Error('private upstream details'));
  await expect(adapter.matrix(matrixInput)).rejects.toThrow('provider_invalid_response');
});

it('aborts platform requests at the bounded deadline', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })));
  const check = expect(createEnvDecisionAdapter(platform)!.matrix(matrixInput)).rejects.toThrow('provider_timeout');
  await vi.advanceTimersByTimeAsync(240_000); await check;
});

it('includes complete frozen content and aggregate provenance without turning buckets into candidates', async () => {
  const aggregate = { aggregate_id: 'industry:type:news', source_id: 'molizhishu', data_version: 'snapshot-v1', unit: 'citation_count', count: '9223372036854775807', scope: { industry: 'retail', modelCode: 'm', periodType: 'WEEK', date: '2026-11-01' }, applicability: { kind: 'industry_context', industry: 'retail' }, aggregate_scope: 'industry_distribution', dimension: 'source_type', bucket: 'news' };
  const specific = { aggregate_id: 'media-summary', identity_relation: 'exact', record: { aggregate_id: 'media-summary', source_id: 'report', unit: 'mentions', data_version: 'v1', scope: { industry: 'retail' }, count: 3 } };
  const industry_context = { status: 'ready', message: '真实分布', source: 'molizhishu', industry_id: 'retail', industry_name: '零售', query: { scopeId: '123', modelCode: 'm', periodType: 'WEEK', date: '2026-11-01' }, fetched_at: '2026-11-07T00:00:00Z', data_version: 'snapshot-v1', aggregates: [aggregate], limitations: [], source_type_distribution: [], publish_time_distribution: [] };
  const manuscripts = [{ article_id: 'article-1', version: 'v2', content_excerpt: '已授权冻结稿件正文片段', content_excerpt_truncated: true, content_source: 'frozen_article_version' }];
  const request = { task: { industry: 'retail', manuscripts, industry_context, model_connection: { revision: 'legacy' }, model_source: 'user' } };
  const prepared = { matrix: { candidates: [{ candidate_id: 'resource:r1', attributes: { source_name: '真实目录媒体' }, aggregate_ids: ['media-summary'], aggregate_matches: [specific], industry_aggregate_ids: [aggregate.aggregate_id] }] } };
  const compact = compactCandidates(request, prepared)[0]!;
  expect(compact.aggregate_matches).toEqual([specific]);
  expect(compact).not.toHaveProperty('industry_aggregate_ids'); expect(compact).not.toHaveProperty('industry_aggregates');
  const send = vi.fn(async (_messages: any) => ({ matrix_decisions: { items: [], fit_order: [] } }));
  await createDecisionAdapter(send).matrix({ ...matrixInput, request, prepared });
  const messages = send.mock.calls[0]![0], payload = JSON.parse(messages[1].content);
  expect(payload.task.industry_context).toEqual(industry_context); expect(payload.task.manuscripts).toEqual(manuscripts);
  expect(payload.task).not.toHaveProperty('model_connection'); expect(payload.task).not.toHaveProperty('model_source');
  expect(payload.candidates).toHaveLength(1); expect(messages[0].content).toContain('不是媒体名称、账号、渠道或可购买候选');
});

it('keeps one shared industry snapshot with 120 candidates instead of repeating global records or IDs', async () => {
  const aggregate = { aggregate_id: 'global-only-once', source_id: 'molizhishu', data_version: 'version-only-once', unit: 'citation_count', count: '100', scope: { industry: 'retail' }, applicability: { kind: 'industry_context', industry: 'retail' }, aggregate_scope: 'industry_distribution', dimension: 'source_type', bucket: 'news' };
  const request = { task: { industry_context: { status: 'ready', aggregates: [aggregate] }, manuscripts: [{ content_excerpt: 'frozen-body-only-once', content_excerpt_truncated: false }] } };
  const prepared = { matrix: { candidates: Array.from({ length: 120 }, (_, index) => ({ candidate_id: 'resource:' + index, attributes: { source_name: 'Media ' + index }, aggregate_matches: [], industry_aggregate_ids: [aggregate.aggregate_id] })) } };
  const send = vi.fn(async (_messages: any) => ({ matrix_decisions: { items: [], fit_order: [] } }));
  await createDecisionAdapter(send).matrix({ ...matrixInput, request, prepared });
  const messages = send.mock.calls[0]![0], encoded = messages[1].content, payload = JSON.parse(encoded);
  expect(payload.candidates).toHaveLength(120);
  expect(payload.task.industry_context.aggregates).toEqual([aggregate]);
  expect(encoded.split('global-only-once')).toHaveLength(2);
  expect(encoded.split('version-only-once')).toHaveLength(2);
  expect(encoded.split('frozen-body-only-once')).toHaveLength(2);
  expect(payload.candidates.every((candidate: Record<string, unknown>) => !('industry_aggregate_ids' in candidate) && !('industry_aggregates' in candidate))).toBe(true);
  expect(messages[0].content).toContain('全部候选共享');
});

it('passes the saved industry snapshot to budget with at most three combined plans', async () => {
  const send = vi.fn(async (_messages: any) => ({ budget_plans: [], content_plans: [] }));
  const industry_context = { status: 'unavailable', message: '行业映射失败', aggregates: [], limitations: ['industry_unmapped'] };
  expect(await createDecisionAdapter(send).budget({ request: { task: { industry_context, manuscripts: [] } }, matrix: { matrix: { candidates: [] }, matrix_version: 'saved' }, as_of: 'x', skill: SOURCE_MATRIX_SKILL, instructions: SOURCE_MATRIX_INSTRUCTIONS })).toEqual({ budget_plans: [], content_plans: [] });
  const messages = send.mock.calls[0]![0], payload = JSON.parse(messages[1].content);
  expect(payload.industry_context).toEqual(industry_context); expect(payload.selectable_candidates).toEqual([]);
  expect(messages[0].content).toContain('两数组合计最多3套');
});
