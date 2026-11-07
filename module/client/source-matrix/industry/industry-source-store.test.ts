// Regression source only; deliberately not executed in this source-only delivery.
import { describe, expect, it, vi } from 'vitest';
import type { IndustryFilters, IndustryFailure } from '../../../contracts/industry-source';
import { IndustryRequestError, integerText, ratioText, totalOf, type industryRequest, type IndustryEndpoint, type IndustryQuery } from './industry-source-client';
import { defaultSelection, IndustrySourceStore, industryStoreFor } from './industry-source-store';

const filters: IndustryFilters = { models: [{ value: 'all', label: '全部模型' }, { value: 'doubao_api', label: '豆包' }], minDate: '2026-09-01', maxDate: '2026-10-29', industryTree: [], sourceTypes: ['新闻资讯'] };
const page = (endpoint: IndustryEndpoint, next: string | null = null) => ({ items: endpoint === 'media-ranking' ? [{ code: '媒体原名', name: '媒体原名', citationCount: '9' }] : [{ sequence: '1', linkId: 'content-1', title: '内容', url: null, icon: null, media: '媒体原名', sourceType: '新闻资讯', publishTime: null, citationCount: '6', citationRatio: '60.00' }], pageSize: endpoint === 'media-ranking' ? 50 : 20, total: '3', totalCitations: '10', snapshotToken: endpoint + '-session', nextCursor: next, expiresAt: String(Date.now() + 600_000) });
const ok = (data: unknown) => ({ status: 'ok' as const, source: 'molizhishu-public-industry' as const, fetchedAt: '2026-11-06T12:00:00Z', data });
function harness(override?: (endpoint: IndustryEndpoint, query: IndustryQuery) => unknown) {
  const calls: Array<{ endpoint: IndustryEndpoint; query: IndustryQuery }> = [];
  const mock = vi.fn(async (endpoint: IndustryEndpoint, query: IndustryQuery) => {
    calls.push({ endpoint, query: { ...query } });
    const custom = override?.(endpoint, query);
    if (custom !== undefined) return await custom;
    return ok(endpoint === 'filters' ? filters : endpoint === 'distributions' ? { sourceTypeDistribution: [], publishTimeDistribution: [] } : page(endpoint));
  });
  return { calls, store: new IndustrySourceStore(mock as unknown as typeof industryRequest) };
}
async function settled(store: IndustrySourceStore) { await vi.waitFor(() => { const state = store.getSnapshot(); expect(state.filters.loading || state.media.loading || state.contents.loading || state.distributions.loading).toBe(false); }); }
const error = (status: IndustryFailure['status'], httpStatus: number, retryable = false) => new IndustryRequestError({ status, httpStatus, message: status, retryable });

describe('industry source request lifecycle', () => {
  it('uses the latest available month and starts once across duplicate mounts', async () => {
    const { calls, store } = harness(); store.start(); store.start(); await settled(store);
    expect(calls.map(call => call.endpoint)).toEqual(['filters', 'media-ranking', 'contents', 'distributions']);
    const media = calls.find(call => call.endpoint === 'media-ranking')!.query;
    expect(media).toMatchObject({ periodType: 'MONTH', date: '2026-10-01', scopeType: 'ALL', modelCode: 'all', pageSize: 50 });
    expect(media.requestId).toMatch(/^[a-zA-Z0-9-]{16,64}$/);
    const contents = calls.find(call => call.endpoint === 'contents')!.query;
    expect(contents).toMatchObject({ pageSize: 20, sortBy: 'citationCount', sortOrder: 'desc' });
    expect(contents.requestId).not.toBe(media.requestId);
    expect(calls.find(call => call.endpoint === 'distributions')!.query).not.toHaveProperty('requestId');
  });
  it('does not query lists or distributions when maxDate is null', async () => {
    const { calls, store } = harness(endpoint => endpoint === 'filters' ? ok({ ...filters, maxDate: null }) : undefined);
    store.start(); await settled(store); expect(calls).toHaveLength(1); expect(store.getSnapshot().common).toBeNull();
  });
  it('retries the exact failed operation without adding a first-page session', async () => {
    let attempts = 0;
    const { calls, store } = harness(endpoint => { if (endpoint === 'contents' && attempts++ === 0) throw error('timeout', 504, true); });
    store.start(); await settled(store); store.retry('contents'); await settled(store);
    const contents = calls.filter(call => call.endpoint === 'contents');
    expect(contents).toHaveLength(2); expect(contents[1]!.query).toEqual(contents[0]!.query); expect(contents[1]!.query).not.toHaveProperty('snapshotToken');
    store.refresh(); await settled(store); expect(calls.filter(call => call.endpoint === 'contents')[2]!.query.requestId).not.toBe(contents[0]!.query.requestId);
  });
  it('keeps media and content cursors separate and stops repeated cursor chains', async () => {
    const { calls, store } = harness((endpoint) => endpoint === 'media-ranking' || endpoint === 'contents' ? ok(page(endpoint, endpoint + '-cursor')) : undefined);
    store.start(); await settled(store); store.more('media'); await settled(store);
    const requests = calls.filter(call => call.endpoint === 'media-ranking');
    expect(requests[1]!.query).toMatchObject({ snapshotToken: 'media-ranking-session', cursor: 'media-ranking-cursor' });
    expect(requests[1]!.query.requestId).not.toBe(requests[0]!.query.requestId);
    expect(calls.filter(call => call.endpoint === 'contents')).toHaveLength(1);
    expect(store.getSnapshot().media.error?.status).toBe('session_expired');
    expect(store.getSnapshot().media.data).toBeNull();
  });
  it('clears all accumulated lane data on 409 and requires explicit fresh restart', async () => {
    let expired = true;
    const { calls, store } = harness((endpoint, query) => {
      if (endpoint === 'contents' && query.cursor && expired) throw error('session_expired', 409);
      return endpoint === 'contents' ? ok(page(endpoint, 'next-content')) : undefined;
    });
    store.start(); await settled(store); store.more('contents'); await settled(store);
    expect(store.getSnapshot().contents.data).toBeNull(); expect(calls.filter(call => call.endpoint === 'contents')).toHaveLength(2);
    store.retry('contents'); expect(calls.filter(call => call.endpoint === 'contents')).toHaveLength(2);
    expired = false; store.restart('contents'); await settled(store);
    const restarted = calls.filter(call => call.endpoint === 'contents')[2]!.query;
    expect(restarted).not.toHaveProperty('cursor'); expect(restarted).not.toHaveProperty('snapshotToken');
  });
  it('does not infer recovered quota from a successful free filters request', async () => {
    let exhausted = true;
    const { calls, store } = harness(endpoint => { if (endpoint === 'media-ranking' && exhausted) throw error('quota_exhausted', 429); });
    store.start(); await settled(store); const before = calls.length;
    store.refresh(); store.more('contents'); store.retry('media'); expect(calls).toHaveLength(before);
    await store.checkAccess(); expect(store.getSnapshot().blocked?.status).toBe('quota_exhausted');
    expect(calls).toHaveLength(before + 1);
    exhausted = false; store.resumeAfterResolution(); await settled(store); expect(store.getSnapshot().blocked).toBeNull();
  });
  it('reconciles a different restored query on remount without rerunning unchanged queries', async () => {
    const { calls, store } = harness(); store.start(); await settled(store);
    const same = () => ({ common: store.getSnapshot().common!, selection: { ...defaultSelection } });
    store.start(same); await settled(store); expect(calls).toHaveLength(4);
    store.start(() => ({ common: { ...store.getSnapshot().common!, modelCode: 'doubao_api' }, selection: { ...defaultSelection } }));
    await settled(store); expect(calls).toHaveLength(7); expect(store.getSnapshot().common?.modelCode).toBe('doubao_api');
  });
  it('queries only contents when selection or sorting changes and ignores equivalent selections', async () => {
    const { calls, store } = harness(); store.start(); await settled(store);
    const selection = { ...defaultSelection, media: '媒体原名', sourceType: '新闻资讯', sortOrder: 'asc' as const };
    store.selectContent(selection); await settled(store);
    store.selectContent({ ...selection }); store.apply({ ...store.getSnapshot().common! }, { ...selection });
    expect(calls).toHaveLength(5);
    expect(calls.filter(call => call.endpoint === 'media-ranking')).toHaveLength(1);
    expect(calls.filter(call => call.endpoint === 'distributions')).toHaveLength(1);
    expect(calls[4]!.query).toMatchObject({ pageSize: 20, media: '媒体原名', sourceType: '新闻资讯', sortBy: 'citationCount', sortOrder: 'asc' });
    expect(calls[4]!.query).not.toHaveProperty('cursor');
    expect(store.getSnapshot().mediaSize).toBe(50);
    expect(store.getSnapshot().contentSize).toBe(20);
  });
  it('discards a late content response after a newer media selection settles', async () => {
    let releaseOld!: (result: unknown) => void;
    const pending = new Promise(resolve => { releaseOld = resolve; });
    const { calls, store } = harness((endpoint, query) => {
      if (endpoint === 'contents' && query.media === 'old-media') return pending;
      if (endpoint === 'contents' && query.media === 'new-media') return ok({ ...page(endpoint), items: [{ sequence: '1', linkId: 'new-link', title: '最新媒体内容', url: null, icon: null, media: '新媒体', sourceType: '新闻资讯', publishTime: null, citationCount: '2', citationRatio: '20.00' }] });
      return undefined;
    });
    store.start(); await settled(store);
    store.selectContent({ ...defaultSelection, media: 'old-media' });
    store.selectContent({ ...defaultSelection, media: 'new-media' });
    await settled(store);
    releaseOld(ok({ ...page('contents'), items: [{ sequence: '1', linkId: 'old-link', title: '旧媒体内容', url: null, icon: null, media: '旧媒体', sourceType: '新闻资讯', publishTime: null, citationCount: '6', citationRatio: '60.00' }] }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getSnapshot().selection.media).toBe('new-media');
    expect(store.getSnapshot().contents.data?.items.map(item => item.linkId)).toEqual(['new-link']);
    expect(calls.filter(call => call.endpoint === 'media-ranking')).toHaveLength(1);
    expect(calls.filter(call => call.endpoint === 'contents')).toHaveLength(3);
  });
  it('discards a late common-query response after another model replaces the query', async () => {
    let releaseOld!: (result: unknown) => void;
    const pending = new Promise(resolve => { releaseOld = resolve; });
    const { store } = harness((endpoint, query) => endpoint === 'media-ranking' && query.modelCode === 'all' ? pending : undefined);
    store.start();
    await vi.waitFor(() => expect(store.getSnapshot().common?.modelCode).toBe('all'));
    store.apply({ ...store.getSnapshot().common!, modelCode: 'doubao_api' });
    await settled(store);
    const latest = store.getSnapshot().media.data;
    releaseOld(ok({ ...page('media-ranking'), items: [{ code: 'stale', name: '旧模型媒体', citationCount: '999' }] }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getSnapshot().common?.modelCode).toBe('doubao_api');
    expect(store.getSnapshot().media.data).toBe(latest);
    expect(store.getSnapshot().media.data?.items.some(item => item.code === 'stale')).toBe(false);
  });
  it('keeps quota suspension through a failed and then successful free connection check', async () => {
    let failFreeCheck = false;
    const { calls, store } = harness(endpoint => {
      if (endpoint === 'filters' && failFreeCheck) throw error('upstream_error', 502, true);
      if (endpoint === 'media-ranking') throw error('quota_exhausted', 429);
    });
    store.start(); await settled(store);
    const chargedBefore = calls.filter(call => call.endpoint === 'media-ranking' || call.endpoint === 'contents').length;
    failFreeCheck = true; await store.checkAccess();
    expect(store.getSnapshot().filters.error?.status).toBe('upstream_error');
    expect(store.getSnapshot().blocked?.status).toBe('quota_exhausted');
    failFreeCheck = false; await store.checkAccess();
    expect(store.getSnapshot().filters.error).toBeNull();
    expect(store.getSnapshot().blocked?.status).toBe('quota_exhausted');
    store.refresh(); store.more('contents');
    expect(calls.filter(call => call.endpoint === 'media-ranking' || call.endpoint === 'contents')).toHaveLength(chargedBefore);
  });
  it('does not silently turn an aged failed request into a new charged query', async () => {
    const { calls, store } = harness(endpoint => { if (endpoint === 'contents') throw error('timeout', 504, true); });
    store.start(); await settled(store); const count = calls.length;
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001);
    try { store.retry('contents'); expect(calls).toHaveLength(count); expect(store.getSnapshot().contents.error?.status).toBe('session_expired'); }
    finally { now.mockRestore(); }
  });
  it.each(['contents', 'distributions'] as const)('keeps quota suspension when an in-flight %s request later fails with authorization', async endpoint => {
    let rejectLater!: (reason: unknown) => void;
    const pending = new Promise<never>((_, reject) => { rejectLater = reject; });
    const { calls, store } = harness(current => {
      if (current === 'media-ranking') throw error('quota_exhausted', 429);
      if (current === endpoint) return pending;
    });
    store.start();
    await vi.waitFor(() => expect(store.getSnapshot().blocked?.status).toBe('quota_exhausted'));
    rejectLater(error('forbidden', 403)); await settled(store);
    expect(store.getSnapshot().blocked?.status).toBe('quota_exhausted');
    const chargedBefore = calls.filter(call => call.endpoint === 'media-ranking' || call.endpoint === 'contents').length;
    await store.checkAccess(); store.refresh(); store.restart('contents');
    expect(store.getSnapshot().blocked?.status).toBe('quota_exhausted');
    expect(calls.filter(call => call.endpoint === 'media-ranking' || call.endpoint === 'contents')).toHaveLength(chargedBefore);
  });
  it('uses gateway identity as well as workspace identity', () => {
    const first = {}, second = {};
    expect(industryStoreFor(first, 1)).toBe(industryStoreFor(first, 1));
    expect(industryStoreFor(first, 1)).not.toBe(industryStoreFor(second, 1));
    expect(industryStoreFor(first, 1)).not.toBe(industryStoreFor(first, 2));
  });
});

describe('industry integer and ratio presentation', () => {
  it('preserves int64 and computes each denominator without floating-point rounding', () => {
    expect(integerText('9007199254740993')).toBe('9,007,199,254,740,993');
    expect(totalOf(['9007199254740993', '2'])).toBe('9007199254740995');
    expect(ratioText('6', '10')).toBe('60.00');
    expect(ratioText('1', '3')).toBe('33.33');
    expect(ratioText('0', '0')).toBe('0.00');
  });
});
