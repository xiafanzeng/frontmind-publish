import { describe, expect, it, vi } from 'vitest';
import type { IndustryCommonQuery, IndustryErrorStatus, IndustryResponse } from '../../contracts/industry-source.js';
import type { IndustryEndpoint } from './industry-query.js';
import { loadMatrixIndustryContext, type MatrixIndustryContextInput } from './matrix-industry-context.js';

const node = (scopeId = '9007199254740993', label = '汽车') => ({ id: 'node-' + scopeId, scopeId, label, scopeType: 'CATEGORY', children: [] });
const filters = () => ({ models: [{ value: 'real-model', label: '供应商模型' }], minDate: '2026-10-15', maxDate: '2026-11-06', industryTree: [node()], sourceTypes: ['新闻资讯'] });
const data = () => ({ sourceTypeDistribution: [{ code: 'news', name: '新闻资讯', citationCount: '9007199254740993' }], publishTimeDistribution: [{ code: 'recent', name: '近期', contentCount: '7' }] });
const input = (): MatrixIndustryContextInput => ({ industryId: 'industry-auto', industryName: '汽车', identity: 'authenticated-owner-project-actor', environment: { FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN: 'test-server-only-token' } });
const selection = (patch: Partial<IndustryCommonQuery> = {}): IndustryCommonQuery => ({ periodType: 'DAY', date: '2026-11-06', scopeType: 'CATEGORY', scopeId: '9007199254740993', modelCode: 'real-model', ...patch });
function fixture(options: { filters?: unknown; data?: unknown; failure?: { endpoint: IndustryEndpoint; status: IndustryErrorStatus }; fetchedAt?: string } = {}) {
  const query = vi.fn(async (endpoint: IndustryEndpoint, _query: URLSearchParams, _identity: string, _token: string): Promise<IndustryResponse<unknown>> => {
    if (options.failure?.endpoint === endpoint) return { status: options.failure.status, message: 'private-upstream-message-test-secret', httpStatus: 502, retryable: false };
    if (endpoint !== 'filters' && endpoint !== 'distributions') throw new Error('Billed endpoints are forbidden in this bridge');
    return { status: 'ok', source: 'molizhishu-public-industry', fetchedAt: options.fetchedAt ?? '2026-11-07T01:00:00.000Z', data: endpoint === 'filters' ? options.filters ?? filters() : options.data ?? data() };
  });
  return { query };
}

describe('matrix free industry context', () => {
  it('uses only free endpoints with the distribution view latest-month/model defaults and authenticated provider scope', async () => {
    const provider = fixture(), request = input();
    const result = await loadMatrixIndustryContext(request, provider);
    expect(result.status).toBe('ok');
    expect(provider.query.mock.calls.map(call => call[0])).toEqual(['filters', 'distributions']);
    expect(provider.query.mock.calls[0]![1].toString()).toBe('');
    expect(Object.fromEntries(provider.query.mock.calls[1]![1])).toEqual(selection({periodType:'MONTH',date:'2026-11-01'}));
    expect(provider.query.mock.calls[1]!.slice(2)).toEqual([request.identity, request.environment.FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN]);
    expect(result.query).toEqual(selection({periodType:'MONTH',date:'2026-11-01'}));
    expect(result.provenance.default_selection).toBe(true);
    expect(result.provenance.filters.fetched_at).toBe('2026-11-07T01:00:00.000Z');
    expect(JSON.stringify(result)).not.toContain('test-server-only-token');
  });
  it('defaults to the supplier all-model option only when it is explicitly available', async () => {
    const available={...filters(),models:[...filters().models,{value:'all',label:'全部模型'}]};
    const result=await loadMatrixIndustryContext(input(),fixture({filters:available}));
    expect(result.query).toEqual(selection({periodType:'MONTH',date:'2026-11-01',modelCode:'all'}));
  });
  it('uses canonical scope identity despite duplicate labels or stale configured aliases', async () => {
    const provider=fixture({filters:{...filters(),industryTree:[node('201'),node('202')]}});
    const result=await loadMatrixIndustryContext({...input(),industryId:'201',configuredScopeId:'202'},provider);
    expect(result.status).toBe('ok');expect(result.query.scopeId).toBe('201');
    expect(result.provenance.scope.mapping).toBe('canonical_scope');
    expect(provider.query.mock.calls.map(call=>call[0])).toEqual(['filters','distributions']);
    expect(provider.query.mock.calls[1]![1].get('scopeId')).toBe('201');
  });
  it('never moves a missing canonical scope to a similarly named category', async () => {
    const provider=fixture({filters:{...filters(),industryTree:[node('202')]}});
    const result=await loadMatrixIndustryContext({...input(),industryId:'201',configuredScopeId:'202'},provider);
    expect(result.status).toBe('mapping_unavailable');expect(provider.query).toHaveBeenCalledTimes(1);
    expect(result.aggregates).toEqual([]);
  });
  it('preserves int64 strings, separate count units and industry-only applicability without media identity', async () => {
    const result = await loadMatrixIndustryContext(input(), fixture());
    expect(result.source_type_distribution[0].citationCount).toBe('9007199254740993');
    expect(result.publish_time_distribution[0].contentCount).toBe('7');
    expect(result.aggregates).toHaveLength(2);
    expect(result.aggregates[0]).toMatchObject({ count: '9007199254740993', unit: 'citation_count', dimension: 'source_type', source_type: 'external_data', source_id: 'molizhishu-public-industry:distributions', aggregate_scope: 'industry_distribution', bucket: { code: 'news', name: '新闻资讯' }, scope: { industry: '汽车', industry_id: 'industry-auto', ...selection({periodType:'MONTH',date:'2026-11-01'}) }, applicability: { kind: 'industry_context', industry: '汽车' } });
    expect(result.aggregates[1]).toMatchObject({ count: '7', unit: 'content_count', dimension: 'publish_time' });
    for (const row of result.aggregates) {
      expect(row.data_version).toBe(result.data_version);
      for (const key of ['source_name', 'domain', 'account_id', 'channel_id', 'source_identity', 'resource_id', 'offer_id', 'ratio', 'percentage', 'brand']) expect(row).not.toHaveProperty(key);
    }
    expect(result.limitations.join(' ')).toContain('未查询媒体排名');
  });
  it('does not fetch when supplier configuration or authenticated identity is absent', async () => {
    const provider = fixture();
    expect((await loadMatrixIndustryContext({ ...input(), environment: {} }, provider)).status).toBe('configuration_required');
    expect((await loadMatrixIndustryContext({ ...input(), identity: '' }, provider)).status).toBe('mapping_unavailable');
    expect(provider.query).not.toHaveBeenCalled();
  });
  it('rejects invalid token configuration without reflecting it in the snapshot', async () => {
    const provider = fixture(), request = input();
    request.environment.FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN = 'invalid secret';
    const result = await loadMatrixIndustryContext(request, provider);
    expect(result.status).toBe('configuration_required');
    expect(provider.query).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('invalid secret');
  });
  it('requires a unique name mapping and never falls back to all industries', async () => {
    for (const industryTree of [[], [node('1'), node('2')], [node('1', '旅游')]]) {
      const provider = fixture({ filters: { ...filters(), industryTree } });
      const result = await loadMatrixIndustryContext(input(), provider);
      expect(result.status).toBe('mapping_unavailable');
      expect(result.query).toBeNull(); expect(result.aggregates).toEqual([]);
      expect(provider.query).toHaveBeenCalledTimes(1);
    }
  });
  it('accepts an explicit trusted alias mapping only to a unique real supplier node', async () => {
    const provider = fixture({ filters: { ...filters(), industryTree: [node('1'), node('2')] } });
    expect((await loadMatrixIndustryContext({ ...input(), configuredScopeId: '2' }, provider)).status).toBe('ok');
    expect((await loadMatrixIndustryContext({ ...input(), configuredScopeId: 'missing' }, fixture())).status).toBe('mapping_unavailable');
    const aliased = await loadMatrixIndustryContext({ ...input(), configuredScopeId: '1' }, fixture({ filters: { ...filters(), industryTree: [node('1', '汽车服务')] } }));
    expect(aliased.status).toBe('ok');
    expect(aliased.provenance.scope).toMatchObject({industry_name:'汽车',scope_name:'汽车服务',mapping:'configured_scope'});
    expect(aliased.aggregates[0].scope.supplier_industry_name).toBe('汽车服务');
    expect((await loadMatrixIndustryContext(input(), fixture({ filters: { ...filters(), industryTree: [node('1'), { ...node('1'), id: 'duplicate-scope' }] } }))).status).toBe('mapping_unavailable');
  });
  it.each([
    { scopeType: 'ALL', scopeId: undefined }, { scopeId: '2' }, { modelCode: 'invented-model' },
    { date: '2026-11-07' }, { date: '2026-10-14' }, { date: '2026-02-30' },
    { periodType: 'WEEK', date: '2026-11-03' }, { periodType: 'MONTH', date: '2026-11-02' },
    { periodType: 'WEEK', date: '2026-10-05' }, { periodType: 'MONTH', date: '2026-09-01' },
    { periodType: 'ALL', date: '2026-11-06' }, { periodType: 'CUSTOM' },
  ])('rejects mismatched or unverified selection %j before reading distributions', async patch => {
    const provider = fixture(), result = await loadMatrixIndustryContext({ ...input(), selection: selection(patch as Partial<IndustryCommonQuery>) }, provider);
    expect(result.status).toBe('invalid_selection');
    expect(provider.query).toHaveBeenCalledTimes(1); expect(result.aggregates).toEqual([]);
  });
  it('rejects added browser statistics or untrusted keys instead of including them as evidence', async () => {
    const provider = fixture();
    const untrusted = { ...selection(), citationCount: '100000', source_name: 'fabricated-media' } as IndustryCommonQuery;
    const result = await loadMatrixIndustryContext({ ...input(), selection: untrusted }, provider);
    expect(result.status).toBe('invalid_selection');
    expect(provider.query).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('fabricated-media');
  });
  it.each([
    selection({ periodType: 'WEEK', date: '2026-10-12' }),
    selection({ periodType: 'MONTH', date: '2026-10-01' }),
    selection({ periodType: 'WEEK', date: '2026-11-02' }),
    selection({ periodType: 'ALL', date: undefined }),
  ])('keeps canonical periods that overlap the actual supplier range: %j', async query => {
    const result = await loadMatrixIndustryContext({ ...input(), selection: query }, fixture());
    expect(result.status).toBe('ok'); expect(result.query).toEqual(query);
    expect(result.provenance.default_selection).toBe(false);
  });
  it.each([{ minDate: null }, { maxDate: null }, { models: [] }])('does not invent missing supplier defaults: %j', async patch => {
    const provider = fixture({ filters: { ...filters(), ...patch } });
    const result = await loadMatrixIndustryContext(input(), provider);
    expect(result.status).toBe('insufficient_filters'); expect(provider.query).toHaveBeenCalledTimes(1);
  });
  it('keeps empty, partial and genuine zero observations distinct', async () => {
    const empty = await loadMatrixIndustryContext(input(), fixture({ data: { sourceTypeDistribution: [], publishTimeDistribution: [] } }));
    expect(empty.status).toBe('empty'); expect(empty.aggregates).toEqual([]); expect(empty.data_version).toMatch(/^industry-/);
    const partial = await loadMatrixIndustryContext(input(), fixture({ data: { ...data(), publishTimeDistribution: [] } }));
    expect(partial.status).toBe('partial'); expect(partial.aggregates).toHaveLength(1); expect(partial.publish_time_distribution).toEqual([]);
    const zero = await loadMatrixIndustryContext(input(), fixture({ data: { sourceTypeDistribution: [{ code: 'news', name: '新闻资讯', citationCount: '0' }], publishTimeDistribution: [{ code: 'recent', name: '近期', contentCount: '0' }] } }));
    expect(zero.status).toBe('ok'); expect(zero.aggregates.map((row: { count: string }) => row.count)).toEqual(['0', '0']);
  });
  it.each(['filters', 'distributions'] as const)('retains provider failure semantics and stage for %s without raw error text', async endpoint => {
    const result = await loadMatrixIndustryContext(input(), fixture({ failure: { endpoint, status: 'entitlement_required' } }));
    expect(result.status).toBe('entitlement_required'); expect(result.failed_stage).toBe(endpoint);
    expect(result.source_type_distribution).toBeNull(); expect(result.publish_time_distribution).toBeNull();
    expect(result.aggregates).toEqual([]); expect(result.data_version).toBeNull();
    expect(JSON.stringify(result)).not.toContain('private-upstream-message-test-secret');
  });
  it('converts unexpected transport rejection to a safe unavailable snapshot', async () => {
    const provider = { query: vi.fn(async (): Promise<IndustryResponse<unknown>> => { throw new Error('private-transport-secret'); }) };
    const result = await loadMatrixIndustryContext(input(), provider);
    expect(result.status).toBe('upstream_error'); expect(result.failed_stage).toBe('filters');
    expect(JSON.stringify(result)).not.toContain('private-transport-secret');
  });
  it.each([
    { sourceTypeDistribution: undefined, publishTimeDistribution: [] },
    { ...data(), sourceTypeDistribution: [{ code: 'news', name: '新闻资讯' }] },
    { ...data(), sourceTypeDistribution: [{ code: 'news', name: '新闻资讯', citationCount: 9007199254740992 }] },
    { ...data(), sourceTypeDistribution: [data().sourceTypeDistribution[0], data().sourceTypeDistribution[0]] },
  ])('rejects malformed or ambiguous observations instead of empty success', async malformed => {
    const result = await loadMatrixIndustryContext(input(), fixture({ data: malformed }));
    expect(result.status).toBe('invalid_response'); expect(result.aggregates).toEqual([]);
    expect(result.source_type_distribution).toBeNull(); expect(result.data_version).toBeNull();
  });
  it('versions query/data deterministically while preserving the separate retrieval time', async () => {
    const first = await loadMatrixIndustryContext(input(), fixture());
    const later = await loadMatrixIndustryContext(input(), fixture({ fetchedAt: '2026-11-07T02:00:00.000Z' }));
    expect(first.data_version).toBe(later.data_version); expect(first.aggregates).toEqual(later.aggregates);
    expect(first.fetched_at).not.toBe(later.fetched_at);
    const changedQuery = await loadMatrixIndustryContext({ ...input(), selection: selection({ date: '2026-11-05' }) }, fixture());
    const changedData = await loadMatrixIndustryContext(input(), fixture({ data: { ...data(), publishTimeDistribution: [{ code: 'recent', name: '近期', contentCount: '8' }] } }));
    expect(changedQuery.data_version).not.toBe(first.data_version);
    expect(changedData.data_version).not.toBe(first.data_version);
    expect(changedQuery.aggregates[0].aggregate_id).not.toBe(first.aggregates[0].aggregate_id);
  });
});
