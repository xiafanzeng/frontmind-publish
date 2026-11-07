// @vitest-environment jsdom
// Source-only regression cases. Execution is reserved for the final ZCode merge.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IndustryContent, IndustryMedia, IndustryPage } from '../../../contracts/industry-source';
import { IndustryRequestError, type industryRequest, type IndustryQuery } from './industry-source-client';
import { CitationExportSession, citationExportCsv, citationExportStatus, downloadCitationCsv } from './industry-source-export';
import { defaultSelection, type IndustryState } from './industry-source-store';

const common = { periodType: 'MONTH' as const, date: '2026-10-01', scopeType: 'ALL' as const, modelCode: 'all' };
const media = (code = 'm1'): IndustryMedia => ({ code, name: `媒体 ${code}`, citationCount: '1' });
const content = (index: number): IndustryContent => ({ sequence: String(index), linkId: `c${index}`, title: `标题 ${index}`, media: '真实媒体', sourceType: '新闻资讯', citationCount: '9007199254740993', citationRatio: '33.3300', url: 'https://example.com/article', icon: null, publishTime: null });
const page = <T,>(items: T[], total: number, pageSize: number, nextCursor: string | null = null): IndustryPage<T> => ({ items, total: String(total), totalCitations: '9223372036854775807', pageSize, snapshotToken: `session-${pageSize}`, nextCursor, expiresAt: String(Date.now() + 600_000) });
const ok = (data: unknown) => ({ status: 'ok' as const, source: 'molizhishu-public-industry' as const, fetchedAt: '2026-11-07T00:00:00Z', data });
const section = <T,>(data: T) => ({ data, loading: false, error: null, fetchedAt: '2026-11-07T00:00:00Z' });
function state(total = 1): IndustryState {
  return { common: { ...common }, selection: { ...defaultSelection }, mediaSize: 50, contentSize: 20, blocked: null,
    filters: section({ models: [{ value: 'all', label: '全部模型' }], industryTree: [], sourceTypes: ['新闻资讯'], minDate: '2026-09-01', maxDate: '2026-11-07' }),
    media: section(page([media()], 1, 50)), contents: section(page(Array.from({ length: Math.min(total, 20) }, (_, i) => content(i + 1)), total, 20, total > 20 ? 'page-ui-2' : null)),
    distributions: section({ sourceTypeDistribution: [], publishTimeDistribution: [] }),
  };
}
function transport(fn: (query: IndustryQuery, signal: AbortSignal) => unknown) {
  return vi.fn(async (_endpoint: string, query: IndustryQuery, signal: AbortSignal) => await fn(query, signal)) as unknown as typeof industryRequest;
}
const signal = () => new AbortController().signal;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('bounded isolated citation export', () => {
  it('disables unresolved, failed, blocked and wholly empty entry states', () => {
    const initial = state();
    expect(citationExportStatus(initial).available).toBe(true);
    expect(citationExportStatus({ ...initial, contents: { ...initial.contents, loading: true } }).available).toBe(false);
    expect(citationExportStatus({ ...initial, media: { ...initial.media, data: null } }).available).toBe(false);
    expect(citationExportStatus({ ...initial, contents: { ...initial.contents, error: { status: 'timeout', message: '超时', httpStatus: 504, retryable: true } } }).available).toBe(false);
    expect(citationExportStatus({ ...initial, blocked: { status: 'quota_exhausted', message: '额度不足', httpStatus: 429, retryable: false } }).available).toBe(false);
    expect(citationExportStatus({ ...state(0), media: section(page([], 0, 50)) }).available).toBe(false);
  });

  it('uses a complete matching valid cache without querying and snapshots row strings', async () => {
    const initial = state(), request = transport(() => { throw new Error('must not request'); });
    const session = new CitationExportSession(initial, initial.common!, initial.selection, request);
    const result = await session.collect(signal());
    expect(request).not.toHaveBeenCalled();
    expect(result.contents.items).toEqual(initial.contents.data!.items);
    expect(result.contents.items[0]).not.toBe(initial.contents.data!.items[0]);
    initial.contents.data!.items[0]!.title = 'later';
    expect(result.contents.items[0]!.title).toBe('标题 1');
    expect(result.media!.items).toHaveLength(1);
  });

  it('uses an independent pageSize=100 snapshot, retaining filters and leaving the 20-row UI untouched', async () => {
    const initial = state(25); initial.selection = { media: 'm1', sourceType: '新闻资讯', sortBy: 'citationCount', sortOrder: 'asc' };
    const request = transport(query => {
      expect(query).toMatchObject({ ...common, pageSize: 100, media: 'm1', sourceType: '新闻资讯', sortBy: 'citationCount', sortOrder: 'asc' });
      expect(query.cursor).toBeUndefined(); expect(query.snapshotToken).toBeUndefined();
      return ok(page(Array.from({ length: 25 }, (_, i) => content(i + 1)), 25, 100));
    });
    const result = await new CitationExportSession(initial, initial.common!, initial.selection, request).collect(signal());
    expect(request).toHaveBeenCalledTimes(1); expect(result.contents.items).toHaveLength(25);
    expect(initial.contents.data!.items).toHaveLength(20); expect(initial.contents.data!.nextCursor).toBe('page-ui-2');
  });

  it('stops exactly at 1000 rows even when the real total and cursor continue', async () => {
    const initial = state(1001); let index = 0;
    const request = transport(query => {
      expect(query.pageSize).toBe(100);
      if (index) { expect(query.cursor).toBe(`next-${index}`); expect(query.snapshotToken).toBe('session-100'); }
      const items = Array.from({ length: 100 }, (_, i) => content(index * 100 + i + 1)); index += 1;
      return ok(page(items, 1001, 100, `next-${index}`));
    });
    const result = await new CitationExportSession(initial, initial.common!, initial.selection, request).collect(signal());
    expect(request).toHaveBeenCalledTimes(10); expect(result.contents.items).toHaveLength(1000);
    expect(result.contents.total).toBe('1001'); expect(result.contents.nextCursor).toBe('next-10');
    expect(citationExportCsv(result, '全部行业', '全部媒体')).toContain('引用内容前 1000 条，非全量');
    expect(initial.contents.data!.items).toHaveLength(20);
  });

  it('does not fetch a ranking or reuse rows when export common conditions differ', async () => {
    const initial = state(), changed = { ...common, modelCode: 'another-model' };
    const request = transport(query => { expect(query.modelCode).toBe('another-model'); return ok(page([content(1)], 1, 100)); });
    const result = await new CitationExportSession(initial, changed, initial.selection, request).collect(signal());
    expect(request).toHaveBeenCalledTimes(1); expect(result.media).toBeNull();
    expect(citationExportCsv(result, '另一个模型', '全部媒体')).not.toContain('"媒体排行"');
  });

  it('rejects zero results without offering an empty download', async () => {
    const initial = state(0), request = transport(() => { throw new Error('must not request'); });
    await expect(new CitationExportSession(initial, initial.common!, initial.selection, request).collect(signal())).rejects.toThrow('没有引用内容');
    expect(request).not.toHaveBeenCalled();
  });

  it('retains the exact failed operation for a manual retry, without recollecting successful pages', async () => {
    const initial = state(150), queries: IndustryQuery[] = []; let fail = true;
    const request = transport(query => {
      queries.push({ ...query });
      if (query.cursor && fail) throw new IndustryRequestError({ status: 'timeout', message: '导出超时', httpStatus: 504, retryable: true });
      return ok(query.cursor ? page(Array.from({ length: 50 }, (_, i) => content(i + 101)), 150, 100) : page(Array.from({ length: 100 }, (_, i) => content(i + 1)), 150, 100, 'next'));
    });
    const session = new CitationExportSession(initial, initial.common!, initial.selection, request);
    await expect(session.collect(signal())).rejects.toThrow('导出超时'); expect(session.canRetry).toBe(true);
    fail = false; const result = await session.collect(signal());
    expect(queries).toHaveLength(3); expect(queries[2]).toEqual(queries[1]);
    expect(result.contents.items).toHaveLength(150); expect(initial.contents.data!.items).toHaveLength(20);
  });

  it('does not reuse a failed request ID after its 600s window or across the quota month', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T15:59:00Z'));
    const initial = state(25), request = transport(() => { throw new IndustryRequestError({ status: 'timeout', message: '超时', httpStatus: 504, retryable: true }); });
    const session = new CitationExportSession(initial, initial.common!, initial.selection, request);
    await expect(session.collect(signal())).rejects.toThrow(); expect(session.canRetry).toBe(true);
    vi.setSystemTime(new Date('2026-10-31T16:00:00Z')); expect(session.canRetry).toBe(false);
    await expect(session.collect(signal())).rejects.toThrow('不能继续'); expect(request).toHaveBeenCalledTimes(1);
  });

  it('settles cancellation during a pending request and never reads the next page', async () => {
    const initial = state(150), controller = new AbortController();
    let finish!: (value: unknown) => void;
    const request = transport(() => new Promise(resolve => { finish = resolve; }));
    const task = new CitationExportSession(initial, initial.common!, initial.selection, request).collect(controller.signal);
    controller.abort(); await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    finish(ok(page(Array.from({ length: 100 }, (_, i) => content(i + 1)), 150, 100, 'next')));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation from a progress update at the exact completion boundary', async () => {
    const initial = state(), controller = new AbortController();
    const session = new CitationExportSession(initial, initial.common!, initial.selection);
    await expect(session.collect(controller.signal, () => controller.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each(['duplicate-row', 'repeated-cursor', 'changed-total', 'early-terminal', 'expired'])('rejects %s without a partial file', async scenario => {
    const initial = state(150);
    const request = transport(query => {
      if (!query.cursor) return ok(page(Array.from({ length: 100 }, (_, i) => content(i + 1)), 150, 100, 'next'));
      const response = page(Array.from({ length: 50 }, (_, i) => content(i + 101)), 150, 100);
      if (scenario === 'duplicate-row') response.items[0] = content(1);
      if (scenario === 'repeated-cursor') response.nextCursor = 'next';
      if (scenario === 'changed-total') response.total = '151';
      if (scenario === 'early-terminal') response.items.pop();
      if (scenario === 'expired') response.expiresAt = String(Date.now() - 1);
      return ok(response);
    });
    await expect(new CitationExportSession(initial, initial.common!, initial.selection, request).collect(signal())).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('stops at a quota failure and never starts fresh requests automatically', async () => {
    const initial = state(150), request = transport(() => { throw new IndustryRequestError({ status: 'quota_exhausted', message: '共享额度不足', httpStatus: 429, retryable: false }); });
    const session = new CitationExportSession(initial, initial.common!, initial.selection, request);
    await expect(session.collect(signal())).rejects.toThrow('共享额度不足'); expect(session.canRetry).toBe(false);
    await expect(session.collect(signal())).rejects.toThrow('不能继续'); expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects a short-page stream rather than silently returning fewer than the requested top 1000', async () => {
    const initial = state(1500); let index = 0;
    const request = transport(() => { index += 1; return ok(page([content(index)], 1500, 100, `next-${index}`)); });
    await expect(new CitationExportSession(initial, initial.common!, initial.selection, request).collect(signal())).rejects.toThrow('10 页');
    expect(request).toHaveBeenCalledTimes(10);
  });
});

describe('bounded citation CSV', () => {
  it('protects formulas, Chinese, original links, int64 values and unscaled content ratios', async () => {
    const initial = state();
    initial.contents.data!.items[0] = { ...content(1), title: ' =SUM(1,2),"中文"', sequence: '9007199254740993' };
    initial.media.data!.totalCitations = '3';
    const result = await new CitationExportSession(initial, initial.common!, initial.selection).collect(signal());
    const csv = citationExportCsv(result, '全部行业', '全部媒体');
    expect(csv.startsWith('\uFEFF')).toBe(true); expect(csv).toContain('\r\n');
    expect(csv).toContain('"\' =SUM(1,2),""中文"""');
    expect(csv).toContain('"\'9007199254740993"'); expect(csv).toContain('https://example.com/article');
    expect(csv).toContain('"33.3300"'); expect(csv).toContain('"33.33"');
    expect(csv).toContain('前 1 个媒体，最多 50 个'); expect(csv).not.toContain('完整引用数据');
  });

  it('downloads the existing BOM CSV format and revokes its URL', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:export'), revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('FrontMind-行业信源引用数据.csv'); expect(this.href).toBe('blob:export');
    });
    downloadCitationCsv('\uFEFF"中文"'); expect(click).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull(); vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:export');
  });
});
