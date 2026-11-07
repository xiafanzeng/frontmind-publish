// @vitest-environment jsdom
// Regression source only; deliberately not executed in this source-only delivery.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IndustryContent, IndustryFilters, IndustryMedia, IndustryPage } from '../../../contracts/industry-source';
import { IndustryRequestError, type industryRequest, type IndustryEndpoint, type IndustryQuery } from './industry-source-client';
import { citationExportCsv, citationExportStatus, collectCitationExport, downloadCitationCsv } from './industry-source-export';
import { IndustrySourceStore } from './industry-source-store';

const filters: IndustryFilters = { models: [{ value: 'all', label: '全部模型' }], minDate: '2026-09-01', maxDate: '2026-10-29', industryTree: [], sourceTypes: ['新闻资讯'] };
const media = (code: string): IndustryMedia => ({ code, name: `媒体 ${code}`, citationCount: '9007199254740993' });
const content = (linkId: string): IndustryContent => ({ sequence: '9007199254740993', linkId, title: `内容 ${linkId}`, url: null, icon: null, media: '媒体原名', sourceType: '新闻资讯', publishTime: null, citationCount: '9007199254740993', citationRatio: '33.3300' });
const page = <T,>(items: T[], total: string, nextCursor: string | null = null, lane: 'media' | 'contents' = 'media'): IndustryPage<T> => ({ items, total, totalCitations: '9007199254740997', pageSize: lane === 'media' ? 10 : 20, snapshotToken: `${lane}-session`, nextCursor, expiresAt: String(Date.now() + 600_000) });
const ok = (data: unknown) => ({ status: 'ok' as const, source: 'molizhishu-public-industry' as const, fetchedAt: '2026-11-07T00:00:00Z', data });
type Override = (endpoint: IndustryEndpoint, query: IndustryQuery) => unknown;
function harness(override?: Override) {
  const calls: Array<{ endpoint: IndustryEndpoint; query: IndustryQuery }> = [];
  const transport = async (endpoint: IndustryEndpoint, query: IndustryQuery) => {
    calls.push({ endpoint, query: { ...query } });
    const custom = override?.(endpoint, query);
    if (custom !== undefined) return await custom;
    return ok(endpoint === 'filters' ? filters : endpoint === 'distributions' ? { sourceTypeDistribution: [], publishTimeDistribution: [] } : endpoint === 'media-ranking' ? page([media('m1')], '1') : page([content('c1')], '1', null, 'contents'));
  };
  return { calls, store: new IndustrySourceStore(transport as unknown as typeof industryRequest) };
}
async function settled(store: IndustrySourceStore) {
  await vi.waitFor(() => { const s = store.getSnapshot(); expect(s.filters.loading || s.media.loading || s.contents.loading || s.distributions.loading).toBe(false); });
}
async function ready(override?: Override) { const result = harness(override); result.store.start(); await settled(result.store); return result; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const signal = () => new AbortController().signal;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('complete citation collection', () => {
  it('keeps unknown or failed lists unavailable and accepts one known empty lane', async () => {
    const idle = new IndustrySourceStore().getSnapshot();
    expect(citationExportStatus(idle)).toEqual({ available: false, additionalPages: '—' });
    const { store } = await ready(endpoint => endpoint === 'media-ranking' ? ok(page([], '0')) : undefined);
    expect(citationExportStatus(store.getSnapshot())).toEqual({ available: true, additionalPages: '0' });
    const state = store.getSnapshot();
    expect(citationExportStatus({ ...state, contents: { ...state.contents, loading: true } }).available).toBe(false);
    expect(citationExportStatus({ ...state, contents: { ...state.contents, error: { status: 'timeout', message: '超时', httpStatus: 504, retryable: true } } }).available).toBe(false);
    expect(citationExportStatus({ ...state, contents: { ...state.contents, data: page([], '0', null, 'contents') } }).available).toBe(false);
  });

  it('collects every remaining page in order using the original sessions, then copies the result', async () => {
    const { store, calls } = await ready((endpoint, query) => {
      if (endpoint === 'media-ranking') return ok(query.cursor === 'm-next-2' ? page([media('m3')], '3') : query.cursor ? page([media('m2')], '3', 'm-next-2') : page([media('m1')], '3', 'm-next-1'));
      if (endpoint === 'contents') return ok(query.cursor ? page([content('c2')], '2', null, 'contents') : page([content('c1')], '2', 'c-next', 'contents'));
    });
    expect(citationExportStatus(store.getSnapshot())).toEqual({ available: true, additionalPages: '2' });
    const result = await collectCitationExport(store, signal());
    expect(result.media.items.map(row => row.code)).toEqual(['m1', 'm2', 'm3']);
    expect(result.contents.items.map(row => row.linkId)).toEqual(['c1', 'c2']);
    expect(calls.filter(call => call.query.cursor).map(call => [call.endpoint, call.query.cursor, call.query.snapshotToken])).toEqual([
      ['media-ranking', 'm-next-1', 'media-session'], ['media-ranking', 'm-next-2', 'media-session'], ['contents', 'c-next', 'contents-session'],
    ]);
    expect(calls.filter(call => (call.endpoint === 'media-ranking' || call.endpoint === 'contents') && !call.query.cursor)).toHaveLength(2);
    expect(result.common).not.toBe(store.getSnapshot().common);
    expect(result.selection).not.toBe(store.getSnapshot().selection);
    expect(result.media.items[0]).not.toBe(store.getSnapshot().media.data!.items[0]);
    store.getSnapshot().media.data!.items[0]!.name = 'later mutation';
    expect(result.media.items[0]!.name).toBe('媒体 m1');
    expect(store.attached).toBe(false);
  });

  it('does not download partial rows after failure and leaves the exact retry operation available', async () => {
    let failed = true;
    const { store, calls } = await ready((endpoint, query) => {
      if (endpoint !== 'media-ranking') return;
      if (!query.cursor) return ok(page([media('m1')], '2', 'm-next'));
      if (failed) throw new IndustryRequestError({ status: 'timeout', message: '分页超时', httpStatus: 504, retryable: true });
      return ok(page([media('m2')], '2'));
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(collectCitationExport(store, signal()).then(snapshot => downloadCitationCsv(citationExportCsv(snapshot, '全部行业', '全部媒体')))).rejects.toThrow('分页超时');
    expect(click).not.toHaveBeenCalled();
    expect(calls.filter(call => call.query.cursor)).toHaveLength(1);
    expect(store.getSnapshot().media.error?.retryable).toBe(true);
    failed = false; store.retry('media'); await settled(store);
    const attempts = calls.filter(call => call.query.cursor);
    expect(attempts).toHaveLength(2); expect(attempts[1]!.query).toEqual(attempts[0]!.query);
  });

  it('stops when filters change while a page is pending', async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    const { store, calls } = await ready((endpoint, query) => endpoint === 'media-ranking' ? query.cursor ? pending.promise : ok(page([media('m1')], '2', 'm-next')) : undefined);
    const task = collectCitationExport(store, signal());
    const rejected = expect(task).rejects.toThrow(/筛选|查询/);
    store.selectContent({ ...store.getSnapshot().selection, media: 'changed' });
    await rejected;
    pending.resolve(ok(page([media('m2')], '2'))); await settled(store);
    expect(calls.filter(call => call.query.cursor)).toHaveLength(1);
    expect(store.attached).toBe(false);
  });

  it('stops immediately at a quota block and does not query the remaining lane', async () => {
    const { store, calls } = await ready((endpoint, query) => {
      if (endpoint === 'contents') return ok(page([content('c1')], '2', 'c-next', 'contents'));
      if (endpoint !== 'media-ranking') return;
      if (query.cursor) throw new IndustryRequestError({ status: 'quota_exhausted', message: '查询额度不足', httpStatus: 429, retryable: false });
      return ok(page([media('m1')], '2', 'm-next'));
    });
    await expect(collectCitationExport(store, signal())).rejects.toThrow('查询额度不足');
    expect(store.getSnapshot().blocked?.status).toBe('quota_exhausted');
    expect(calls.filter(call => call.query.cursor).map(call => call.endpoint)).toEqual(['media-ranking']);
  });

  it('rejects a refresh with identical filter values between page completion and export', async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    const { store } = await ready((endpoint, query) => endpoint === 'media-ranking' ? query.cursor ? pending.promise : ok(page([media('m1')], '2', 'm-next')) : undefined);
    let refreshed = false;
    const unsubscribe = store.subscribe(() => {
      if (!refreshed && !store.getSnapshot().media.loading && store.getSnapshot().media.data?.items.length === 2) { refreshed = true; store.refresh(); }
    });
    try {
      const task = collectCitationExport(store, signal());
      const rejected = expect(task).rejects.toThrow(/查询|会话/);
      pending.resolve(ok(page([media('m2')], '2')));
      await rejected; expect(refreshed).toBe(true); await settled(store);
    } finally { unsubscribe(); }
  });

  it.each(['media', 'contents'] as const)('rejects a %s page size change without mixing sessions', async kind => {
    const pending = deferred<ReturnType<typeof ok>>();
    const { store } = await ready((endpoint, query) => endpoint === 'media-ranking' ? query.cursor ? pending.promise : ok(page([media('m1')], '2', 'm-next')) : undefined);
    const task = collectCitationExport(store, signal());
    const rejected = expect(task).rejects.toThrow(/查询|分页|会话/);
    store.setPageSize(kind, 50); await rejected;
    pending.resolve(ok(page([media('m2')], '2'))); await settled(store);
  });

  it('settles an abort immediately and never starts the next lane', async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    const { store, calls } = await ready((endpoint, query) => endpoint === 'media-ranking' ? query.cursor ? pending.promise : ok(page([media('m1')], '2', 'm-next')) : endpoint === 'contents' ? ok(page([content('c1')], '2', 'c-next', 'contents')) : undefined);
    const controller = new AbortController();
    const task = collectCitationExport(store, controller.signal);
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected;
    expect(store.attached).toBe(false);
    expect(calls.filter(call => call.endpoint === 'contents')).toHaveLength(1);
    pending.resolve(ok(page([media('m2')], '2'))); await settled(store);
  });

  it('does not request a page for an already-aborted export', async () => {
    const { store, calls } = await ready(endpoint => endpoint === 'media-ranking' ? ok(page([media('m1')], '2', 'm-next')) : undefined);
    const controller = new AbortController(); controller.abort();
    await expect(collectCitationExport(store, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.filter(call => call.query.cursor)).toHaveLength(0);
  });

  it.each([
    ['a repeated cursor', () => page([media('m2')], '3', 'm-next')],
    ['no new identity', () => page([media('m1')], '3', 'different-next')],
    ['an early terminal cursor', () => page([media('m2')], '3')],
    ['a changed total', () => page([media('m2')], '4', 'different-next')],
    ['changed citation totals', () => ({ ...page([media('m2')], '3', 'different-next'), totalCitations: '7' })],
    ['an empty cursor', () => page([media('m2')], '3', '')],
    ['a changed snapshot', () => ({ ...page([media('m2')], '3', 'different-next'), snapshotToken: 'new-session' })],
  ] as const)('rejects %s instead of producing an incomplete file', async (_name, nextPage) => {
    const { store, calls } = await ready((endpoint, query) => endpoint === 'media-ranking' ? ok(query.cursor ? nextPage() : page([media('m1')], '3', 'm-next')) : undefined);
    await expect(collectCitationExport(store, signal())).rejects.toThrow();
    expect(calls.filter(call => call.query.cursor)).toHaveLength(1);
  });

  it('rejects a cursor cycle before it could request the same page again', async () => {
    const { store, calls } = await ready((endpoint, query) => endpoint === 'media-ranking' ? ok(query.cursor === 'second' ? page([media('m3')], '4', 'first') : query.cursor === 'first' ? page([media('m2')], '4', 'second') : page([media('m1')], '4', 'first')) : undefined);
    await expect(collectCitationExport(store, signal())).rejects.toThrow(/游标|分页/);
    expect(calls.filter(call => call.query.cursor).map(call => call.query.cursor)).toEqual(['first', 'second']);
  });

  it.each(['NaN', '-1', '1.5', '9223372036854775807'])('rejects an invalid or unrepresentable total %s before a paid page', async total => {
    const { store, calls } = await ready(endpoint => endpoint === 'media-ranking' ? ok(page([media('m1')], total, 'next')) : undefined);
    expect(citationExportStatus(store.getSnapshot()).available).toBe(false);
    await expect(collectCitationExport(store, signal())).rejects.toThrow();
    expect(calls.filter(call => call.query.cursor)).toHaveLength(0);
  });

  it('rejects an expired unfinished session without creating a replacement query', async () => {
    const { store, calls } = await ready(endpoint => endpoint === 'media-ranking' ? ok({ ...page([media('m1')], '2', 'next'), expiresAt: '1' }) : undefined);
    expect(citationExportStatus(store.getSnapshot()).available).toBe(true);
    await expect(collectCitationExport(store, signal())).rejects.toThrow(/过期|失效/);
    expect(calls.filter(call => call.query.cursor)).toHaveLength(0);
  });

  it('does not hang if the store stops notifying while a request is pending', async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    const { store } = await ready((endpoint, query) => endpoint === 'media-ranking' ? query.cursor ? pending.promise : ok(page([media('m1')], '2', 'next')) : undefined);
    vi.useFakeTimers();
    const task = collectCitationExport(store, signal());
    const rejected = expect(task).rejects.toThrow(/超时/);
    store.dispose(); await vi.advanceTimersByTimeAsync(75_000); await rejected;
    pending.resolve(ok(page([media('m2')], '2')));
  });
});

describe('citation CSV content and download', () => {
  it('exports two clearly scoped sections and preserves nulls, quotes, line breaks and integer strings', async () => {
    const { store } = await ready(endpoint => endpoint === 'contents' ? ok(page([{ ...content('c1'), title: '含"引号",\n第二行', media: '媒体,名称' }], '1', null, 'contents')) : undefined);
    const csv = citationExportCsv(await collectCitationExport(store, signal()), '全部行业 / 全部模型', '全部媒体');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"媒体排行"\r\n');
    expect(csv).toContain('"内容明细"\r\n');
    expect(csv).toContain('"全部行业 / 全部模型"');
    expect(csv).toContain('"媒体记录总数","1"');
    expect(csv).toContain('"内容记录总数","1"');
    expect(csv).toContain('"9007199254740997"');
    expect(csv).toContain('"1","m1","媒体 m1","9007199254740993"');
    expect(csv).toContain('"9007199254740993","c1","含""引号"",\n第二行","","","媒体,名称","新闻资讯","","9007199254740993","33.3300"');
    expect(csv).not.toContain('undefined'); expect(csv).not.toContain('media-session');
  });

  it.each(['=HYPERLINK("https://example.test")', '+SUM(1,1)', '-1+1', '@SUM(1,1)', ' \t=1+1', '\r\n=1+1'])('neutralizes formula-like text %j in both labels and rows', async value => {
    const { store } = await ready(endpoint => endpoint === 'contents' ? ok(page([{ ...content('c1'), title: value }], '1', null, 'contents')) : undefined);
    const csv = citationExportCsv(await collectCitationExport(store, signal()), value, value);
    expect(csv).toContain('"\'' + value.replace(/"/g, '""') + '"');
    expect(csv).not.toContain(',"' + value.replace(/"/g, '""') + '",');
  });

  it('refuses serialization if a caller supplies an incomplete snapshot', async () => {
    const { store } = await ready(); const result = await collectCitationExport(store, signal());
    expect(() => citationExportCsv({ ...result, media: { ...result.media, total: '2' } }, '', '')).toThrow(/完整|数量/);
    expect(() => citationExportCsv({ ...result, contents: { ...result.contents, nextCursor: 'still-more' } }, '', '')).toThrow(/完整|分页/);
  });

  it('downloads a BOM CSV using the existing object URL pattern and revokes the URL', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:citation-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    downloadCitationCsv('\uFEFF"完整数据"\r\n');
    expect(clicked[0]?.download).toBe('FrontMind-行业信源完整引用数据.csv');
    expect(clicked[0]?.href).toBe('blob:citation-export');
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(document.querySelector('a[download]')).toBeNull();
    await vi.runAllTimersAsync(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:citation-export');
  });
});
