import { expect, it } from 'vitest';
import { DISTRIBUTION_LIMITS, readSourceDistribution } from './distribution.js';

const tenant = 'authorized-tenant';
const sha = 'a'.repeat(64);
const record = (id = 'row-1') => ({ id, sourceSheet: '明细', sourceRow: 2, citedAt: '2026-09-13', model: '模型-网页版', question: '问题', title: '内容', url: 'https://media.example/article', mediaName: '媒体', mediaUrl: 'https://media.example', mediaType: null, publishedAt: null, contentStatus: null });
const batch = () => ({ id: 'import-1', label: '行业导出', version: 'v1', sourceFile: 'export.xlsx', sourceSha256: sha, period: { start: '2026-09-07', end: '2026-09-13' }, records: [record()], limitations: [] });
const industry = (dataset: Record<string, unknown>) => ({ industryId: 'industry-a', name: '行业甲', dataset });

it('exports only analysis properties and derives industry from the authorized row', () => {
  const configured = batch();
  const input = industry({ source_distribution: { batches: [{ ...configured, tenant_id: tenant, catalog: ['private'], records: [{ ...record(), quote: 999, raw_payload: 'secret' }] }] }, catalog: [{ supplier: 'secret', price: 999 }], manuscripts: [{ text: 'private' }] });
  const result = readSourceDistribution([input], tenant);
  expect(result.status).toBe('ready');
  expect(result.batches[0]?.industryId).toBe('industry-a');
  expect(result.batches[0]?.records[0]).toEqual(record());
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(JSON.stringify(result)).not.toContain('private');
  expect(JSON.stringify(result)).not.toContain('quote');
});

it('retains repeated exported rows, nulls unknown dates/types and never infers publication dates', () => {
  const configured = batch();
  configured.records = [record(), { ...record('row-2'), publishedAt: null }];
  const result = readSourceDistribution([industry({ source_distribution: { batches: [configured] } })], tenant);
  expect(result.batches[0]?.records).toHaveLength(2);
  expect(result.batches[0]?.records.every(row => row.publishedAt === null && row.mediaType === null)).toBe(true);
});

it('does not treat unsafe links and invalid publication dates as known values', () => {
  const configured = { ...batch(), records: [{ ...record(), publishedAt: '2026-02-30', url: 'javascript:alert(1)' }] };
  const result = readSourceDistribution([industry({ source_distribution: { batches: [configured] } })], tenant);
  expect(result.batches[0]?.records[0]?.publishedAt).toBeNull();
  expect(result.batches[0]?.records[0]?.url).toBeNull();
  expect(result.batches[0]?.limitations.length).toBeGreaterThan(0);
});
it('preserves bare-domain media identity without inventing a URL protocol', () => {
  const configured = { ...batch(), records: [{ ...record(), mediaUrl: 'm.media.example' }, { ...record('row-2'), mediaUrl: 'another.media.example' }] };
  const result = readSourceDistribution([industry({ source_distribution: { batches: [configured] } })], tenant);
  expect(result.batches[0]?.records.map(row => row.mediaUrl)).toEqual(['m.media.example', 'another.media.example']);
});

it('converts only raw detail citations without claiming aggregate counts or event deduplication', () => {
  const detail = { data_kind: 'detail', tenant_id: tenant, citation_url: 'https://media.example/a', source_name: '媒体', model: '模型', collected_at: '2026-09-13', question_id: 'q-identifier' };
  const result = readSourceDistribution([industry({ citations: [detail, { ...detail }, { data_kind: 'aggregate', count: 1000 }, { ...detail, source_type: 'supplier_claim' }] })], tenant);
  expect(result.status).toBe('ready');
  expect(result.batches[0]?.records).toHaveLength(2);
  expect(result.batches[0]?.records[0]).toMatchObject({ citedAt: null, question: null, publishedAt: null, sourceRow: null });
  expect(result.batches[0]?.sourceFile).toBeNull();
  expect(result.batches[0]?.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
});
it('preserves declared legacy domains when media URLs are missing and never guesses them from content URLs', () => {
  const detail = { data_kind: 'detail', source_name: '同名媒体', citation_url: 'https://portal.example/article' };
  const result = readSourceDistribution([industry({ citations: [{ ...detail, domain: 'first.example' }, { ...detail, domain: 'second.example' }, { ...detail }] })], tenant);
  const rows = result.batches[0]?.records ?? [];
  expect(rows.map(row => row.mediaUrl)).toEqual(['first.example', 'second.example', null]);
  expect(new Set(rows.map(row => JSON.stringify([row.mediaName, row.mediaUrl]))).size).toBe(3);
});

it('never falls back to citations when an explicit distribution import is malformed', () => {
  const result = readSourceDistribution([industry({ source_distribution: { batches: [{ ...batch(), sourceSha256: 'unverified' }] }, citations: [{ data_kind: 'detail' }] })], tenant);
  expect(result).toMatchObject({ status: 'invalid_data', batches: [] });
});

it('deduplicates repeated file fingerprints and refuses conflicting rows under one fingerprint', () => {
  const imported = batch();
  const deduplicated = readSourceDistribution([industry({ source_distribution: { batches: [imported, { ...imported, id: 'second-import', version: 'v2' }] } })], tenant);
  expect(deduplicated.batches).toHaveLength(1);
  const conflicting = readSourceDistribution([industry({ source_distribution: { batches: [imported, { ...imported, records: [record('different')] }] } })], tenant);
  expect(conflicting).toMatchObject({ status: 'invalid_data', batches: [] });
});

it('does not expose a partial denominator when the response capacity is exceeded', () => {
  const configured = { ...batch(), records: Array.from({ length: DISTRIBUTION_LIMITS.records + 1 }, (_, index) => record(String(index))) };
  expect(readSourceDistribution([industry({ source_distribution: { batches: [configured] } })], tenant)).toMatchObject({ status: 'data_limit_exceeded', batches: [] });
  const tooManyIndustries = Array.from({ length: DISTRIBUTION_LIMITS.industries + 1 }, () => industry({}));
  expect(readSourceDistribution(tooManyIndustries, tenant)).toMatchObject({ status: 'data_limit_exceeded', batches: [] });
});

it('rejects embedded tenant mismatches and leaves an empty real project unconfigured', () => {
  expect(readSourceDistribution([industry({ citations: [{ data_kind: 'detail', tenant_id: 'other' }] })], tenant)).toMatchObject({ status: 'invalid_data', batches: [] });
  expect(readSourceDistribution([industry({})], tenant)).toMatchObject({ status: 'configuration_required', batches: [] });
  expect(readSourceDistribution([industry({ citations: [{ data_kind: 'aggregate', count: 502 }] })], tenant)).toMatchObject({ status: 'configuration_required', batches: [] });
  expect(readSourceDistribution([industry({ source_distribution: { batches: [{ ...batch(), records: [{ ...record(), tenant_id: 'other' }] }] } })], tenant)).toMatchObject({ status: 'invalid_data', batches: [] });
});
