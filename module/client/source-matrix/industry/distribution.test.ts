// Regression source only. Not executed in this source-only delivery.
import { describe, expect, it } from 'vitest';
import type { SourceDistributionBatch, SourceDistributionRecord } from '../../../contracts/source-distribution';
import { EMPTY_FILTER, UNKNOWN, contentGroups, defaultFilter, filterRecords, mediaKey, mediaRanking, percentageText, periodEnd, publicationDistribution, typeDistribution, uniqueBatches, validDay } from './distribution';
import { YIHANG_SOURCE_BATCH, YIHANG_SOURCE_PROVENANCE } from './yihang';

describe('offline source-distribution export and aggregation', () => {
  const all = filterRecords([YIHANG_SOURCE_BATCH], EMPTY_FILTER);
  it('preserves all export rows and reconciles each summary separately', () => {
    expect(all).toHaveLength(502);
    expect(mediaRanking(all)).toHaveLength(61);
    expect(contentGroups(all).filter(c => c.url)).toHaveLength(114);
    expect((YIHANG_SOURCE_PROVENANCE.sheets as Array<{ name: string }>).map(s => s.name)).toEqual(['媒体统计', '内容统计', '详细表格', '字段说明']);
    expect(YIHANG_SOURCE_PROVENANCE.reconciliation).toMatchObject({ records: 502, contentUrls: 114, mediaGroups: 61, uniqueSevenFieldRows: 216, additionalIdenticalRows: 286, mediaSummaryCount: 502, contentSummaryCount: 502 });
    expect(all.every(record => record.sourceRow !== null && record.sourceRow >= 2 && record.sourceRow <= 503 && record.sourceSheet === '详细表格')).toBe(true);
  });
  it('keeps the exact name + URL grouping and content URL identity', () => {
    const rank = mediaRanking(all), contents = contentGroups(all);
    expect(rank[0]).toMatchObject({ name: '北京九运百行文化传播有限公司', domain: 'm.360189.com', count: 71 });
    expect(rank.find(group => group.name === '爱企查')?.count).toBe(65);
    expect(contents.find(content => content.title === '软件测试公司有哪些')?.count).toBe(20);
    expect(new Set(all.map(record => record.title)).size).toBe(111);
    expect(all.filter(record => record.mediaName === null)).toHaveLength(3);
    expect(all.filter(record => record.mediaName === null).every(record => record.mediaUrl?.includes('m.tiantianshoumi.com'))).toBe(true);
  });
  it('filters exact model labels, citation date and unclassified industry together', () => {
    expect(defaultFilter([YIHANG_SOURCE_BATCH]).month).toBe('2026-09');
    const cases = [['百度文心-手机版', 118], ['百度文心-网页版', 282], ['通义千问-网页版', 53], ['通义千问-手机版', 49]] as const;
    for (const [model, count] of cases) expect(filterRecords([YIHANG_SOURCE_BATCH], { ...EMPTY_FILTER, model })).toHaveLength(count);
    expect(filterRecords([YIHANG_SOURCE_BATCH], { ...EMPTY_FILTER, dateMode: 'range', start: '2026-09-12', end: '2026-09-12' })).toHaveLength(262);
    expect(filterRecords([YIHANG_SOURCE_BATCH], { ...EMPTY_FILTER, dateMode: 'range', start: '2026-09-13', end: '2026-09-13' })).toHaveLength(240);
    expect(filterRecords([YIHANG_SOURCE_BATCH], { ...EMPTY_FILTER, industry: UNKNOWN, model: '百度文心-手机版', month: '2026-09' })).toHaveLength(118);
    expect(filterRecords([YIHANG_SOURCE_BATCH], { ...EMPTY_FILTER, month: '2026-10' })).toHaveLength(0);
    expect(filterRecords([YIHANG_SOURCE_BATCH], { ...EMPTY_FILTER, industry: 'not-imported' })).toHaveLength(0);
  });
  it('keeps current-filter denominator after a media click', () => {
    const rank = mediaRanking(all), selected = all.filter(r => mediaKey(r) === rank[0]?.key);
    expect(selected).toHaveLength(71);
    expect(contentGroups(selected, all.length).every(c => c.share === c.count / 502)).toBe(true);
    expect(rank[0]?.share).toBe(71 / 502);
    expect(percentageText(rank[0]?.share ?? null)).toBe('14.14%');
    expect(percentageText(null)).toBe('—');
  });
  it('deduplicates file batches only, never identical export rows', () => {
    const repeated = { ...YIHANG_SOURCE_BATCH, id: 'another-import-id', sourceSha256: YIHANG_SOURCE_BATCH.sourceSha256.toUpperCase() };
    expect(uniqueBatches([YIHANG_SOURCE_BATCH, repeated])).toHaveLength(1);
    expect(filterRecords([YIHANG_SOURCE_BATCH, repeated], EMPTY_FILTER)).toHaveLength(502);
    const otherFile = { ...YIHANG_SOURCE_BATCH, sourceSha256: 'b'.repeat(64) };
    expect(filterRecords([YIHANG_SOURCE_BATCH, otherFile], EMPTY_FILTER)).toHaveLength(1004);
  });
  it('does not infer type, publication, industry or citation-event identity', () => {
    expect(YIHANG_SOURCE_BATCH.industryId).toBeNull();
    expect(YIHANG_SOURCE_BATCH.industryName).toBeNull();
    expect(all.every(r => r.mediaType === null && r.publishedAt === null && r.contentStatus === '未监控')).toBe(true);
    expect(typeDistribution(all)).toEqual([{ key: '未知', label: '未知', count: 502, share: 1 }]);
    expect(publicationDistribution(contentGroups(all), '2026-09-13').find(s => s.key === 'unknown')).toMatchObject({ count: 114, share: 1 });
    expect(typeDistribution([])).toEqual([]);
    expect(publicationDistribution([], null).every(s => s.count === 0 && s.share === null)).toBe(true);
    expect(all.some(r => 'answerId' in r)).toBe(false);
  });
});

describe('publication age boundaries and missing identities', () => {
  const base: SourceDistributionRecord = { id: 'r', sourceSheet: null, sourceRow: null, citedAt: '2026-09-13', model: null, question: null, title: null, url: null, mediaName: null, mediaUrl: null, mediaType: null, publishedAt: null, contentStatus: null };
  function batch(records: SourceDistributionRecord[]): SourceDistributionBatch { return { id: 'b', label: 'fixture', version: 'v1', sourceFile: 'fixture.json', sourceSha256: 'a'.repeat(64), industryId: null, industryName: null, period: { start: null, end: '2026-09-13' }, records, limitations: [] }; }
  it('uses mutually exclusive day intervals and keeps future/conflicting/missing dates unknown', () => {
    const ages = [0, 1, 2, 7, 8, 30, 31, 365, 366, 1095, 1096, -1];
    const records: SourceDistributionRecord[] = ages.map((age, i) => ({ ...base, id: String(i), url: 'https://example.test/' + i, publishedAt: new Date(Date.parse('2026-09-13T00:00:00Z') - age * 86400000).toISOString().slice(0, 10) }));
    records.push({ ...base, id: 'missing', url: 'https://example.test/missing', publishedAt: null });
    const contents = contentGroups(filterRecords([batch(records)], EMPTY_FILTER));
    expect(publicationDistribution(contents, '2026-09-13').map(s => s.count)).toEqual([2, 2, 2, 2, 2, 1, 2]);
    expect(publicationDistribution(contents, '2026-09-13').reduce((sum, s) => sum + s.count, 0)).toBe(13);
    expect(periodEnd([batch(records)], { ...EMPTY_FILTER, month: '2026-09' })).toBe('2026-09-30');
    expect(periodEnd([batch(records)], { ...EMPTY_FILTER, dateMode: 'range', end: '2026-09-13' })).toBe('2026-09-13');
    expect(validDay('2026-02-30')).toBeNull();
  });
  it('never collapses absent URL rows into one invented content identity', () => {
    const rows = filterRecords([batch([{ ...base, id: 'one' }, { ...base, id: 'two' }])], EMPTY_FILTER);
    const contents = contentGroups(rows);
    expect(contents).toHaveLength(2);
    expect(contents.filter(c => c.url)).toHaveLength(0);
    expect(publicationDistribution(contents, '2026-09-13').every(s => s.share === null)).toBe(true);
  });
  it('keeps mixed missing or conflicting publication dates unknown', () => {
    const rows = filterRecords([batch([
      { ...base, id: 'one', url: 'https://example.test/mixed', publishedAt: '2026-09-12' },
      { ...base, id: 'two', url: 'https://example.test/mixed', publishedAt: null },
      { ...base, id: 'three', url: 'https://example.test/conflict', publishedAt: '2026-09-12' },
      { ...base, id: 'four', url: 'https://example.test/conflict', publishedAt: '2026-09-10' },
    ])], EMPTY_FILTER);
    const contents = contentGroups(rows);
    expect(contents.every(c => c.publishedAt === null)).toBe(true);
    expect(publicationDistribution(contents, '2026-09-13').find(s => s.key === 'unknown')?.count).toBe(2);
  });
});
