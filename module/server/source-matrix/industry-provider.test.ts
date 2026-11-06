import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeIndustryData, parseIndustryJson } from './industry-codec.js';
import { IndustrySourceProvider } from './industry-provider.js';

const now = Date.UTC(2026, 10, 6, 8);
const query = () => new URLSearchParams('periodType=MONTH&date=2026-10-01&scopeType=ALL&modelCode=all&pageSize=10&requestId=11111111-1111-4111-8111-111111111111');
const page = { items: [{ code: '示例媒体', name: '示例媒体', citationCount: 12 }], pageSize: 10, total: 1, totalCitations: 12, snapshotToken: 'opaque-session', nextCursor: null, expiresAt: now + 120000 };
const response = (data: unknown = page) => new Response(JSON.stringify({ success: true, code: 200, data }), { status: 200 });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('industry lossless and allowlisted payloads', () => {
  it('preserves large numeric tokens without modifying quoted text or converting missing fields to zero', () => {
    const raw = '{"success":true,"code":200,"data":{"items":[{"code":"9007199254740993","name":"媒体","citationCount":9007199254740993}],"pageSize":10,"total":1,"totalCitations":9007199254740993,"snapshotToken":"s","nextCursor":null,"expiresAt":1793952000000,"privateToken":"must-not-leave-server"}}';
    const parsed = parseIndustryJson(raw) as { data: unknown };
    const decoded = decodeIndustryData('media-ranking', parsed.data);
    expect(decoded).toMatchObject({ items: [{ code: '9007199254740993', citationCount: '9007199254740993' }], totalCitations: '9007199254740993' });
    expect(JSON.stringify(decoded)).not.toContain('privateToken');
    expect(() => decodeIndustryData('media-ranking', { ...page, total: undefined })).toThrow();
    expect(() => decodeIndustryData('media-ranking', { ...page, total: 9007199254740992 })).toThrow();
  });
  it('retains each distribution denominator and the supplied percentage text', () => {
    const distributions = { sourceTypeDistribution: [{ code: '新闻资讯', name: '新闻资讯', citationCount: 12 }], publishTimeDistribution: [{ code: 'UNKNOWN', name: '未知', contentCount: 3 }] };
    expect(decodeIndustryData('distributions', distributions)).toEqual({ sourceTypeDistribution: [{ code: '新闻资讯', name: '新闻资讯', citationCount: '12' }], publishTimeDistribution: [{ code: 'UNKNOWN', name: '未知', contentCount: '3' }] });
    const data = { ...page, items: [{ sequence: 1, linkId: 'link-1', title: null, media: '媒体', sourceType: '新闻资讯', url: null, icon: null, publishTime: null, citationCount: 6, citationRatio: '60.00' }] };
    expect(decodeIndustryData('contents', data)).toMatchObject({ items: [{ title: 'link-1', citationRatio: '60.00', url: null }] });
  });
});

describe('industry transport and request identity', () => {
  it('coalesces concurrent retries and returns a cached result for the same authenticated operation', async () => {
    let release: (value: Response) => void = () => { throw new Error('not started'); };
    const transport = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const provider = new IndustrySourceProvider(transport as typeof fetch, () => now);
    const first = provider.query('media-ranking', query(), 'actor-project-A', 'server-only-test-token');
    const second = provider.query('media-ranking', query(), 'actor-project-A', 'server-only-test-token');
    expect(transport).toHaveBeenCalledOnce();
    release(response());
    expect(await first).toMatchObject({ status: 'ok', source: 'molizhishu-public-industry' });
    expect(await second).toEqual(await first);
    await provider.query('media-ranking', query(), 'actor-project-A', 'server-only-test-token');
    expect(transport).toHaveBeenCalledOnce();
  });
  it('does not share cache across authenticated scopes or server token rotations', async () => {
    const transport = vi.fn(async () => response());
    const provider = new IndustrySourceProvider(transport as typeof fetch, () => now);
    await provider.query('media-ranking', query(), 'actor-project-A', 'server-token-A');
    await provider.query('media-ranking', query(), 'actor-project-B', 'server-token-A');
    await provider.query('media-ranking', query(), 'actor-project-A', 'server-token-B');
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('rejects reuse of an operation ID with different parameters or another endpoint', async () => {
    const transport = vi.fn(async () => response());
    const provider = new IndustrySourceProvider(transport as typeof fetch, () => now);
    await provider.query('media-ranking', query(), 'scope', 'server-token');
    const changed = query(); changed.set('pageSize', '20');
    expect(await provider.query('media-ranking', changed, 'scope', 'server-token')).toMatchObject({ status: 'invalid_input', httpStatus: 400 });
    expect(await provider.query('contents', query(), 'scope', 'server-token')).toMatchObject({ status: 'invalid_input', httpStatus: 400 });
    expect(transport).toHaveBeenCalledOnce();
  });
  it('retries a transport failure only when explicitly asked, preserving the exact operation', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new TypeError('network with secret')).mockResolvedValueOnce(response());
    const provider = new IndustrySourceProvider(transport as typeof fetch, () => now);
    expect(await provider.query('media-ranking', query(), 'scope', 'server-token')).toMatchObject({ status: 'upstream_error', retryable: true });
    expect(transport).toHaveBeenCalledOnce();
    expect(await provider.query('media-ranking', query(), 'scope', 'server-token')).toMatchObject({ status: 'ok' });
    expect(transport.mock.calls[0]![0]).toBe(transport.mock.calls[1]![0]);
    expect(transport.mock.calls[0]![1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer server-token' } });
  });
  it('does not reissue a known expired operation or a cached result past expiry', async () => {
    let clock = now;
    const transport = vi.fn(async () => response());
    const provider = new IndustrySourceProvider(transport as typeof fetch, () => clock);
    await provider.query('media-ranking', query(), 'scope', 'server-token');
    clock += 120001;
    expect(await provider.query('media-ranking', query(), 'scope', 'server-token')).toMatchObject({ status: 'session_expired', retryable: false });
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each([
    [200, 500, 'Token失效', 'unauthorized', 401],
    [400, 400, '参数错误', 'invalid_input', 400],
    [403, 403, '无权访问', 'forbidden', 403],
    [403, 403, '行业信源使用权益已到期', 'entitlement_required', 403],
    [409, 409, 'snapshotToken 无效', 'session_expired', 409],
    [429, 429, '查询次数已用完', 'quota_exhausted', 429],
    [500, 500, '内部错误 token=private-secret', 'upstream_error', 502],
  ])('preserves business failure semantics for HTTP %s / code %s', async (httpStatus, code, message, status, expectedHttp) => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ success: false, code, message }), { status: Number(httpStatus) }));
    const provider = new IndustrySourceProvider(transport as typeof fetch, () => now);
    const result = await provider.query('media-ranking', query(), 'scope', 'server-token');
    expect(result).toMatchObject({ status, httpStatus: expectedHttp });
    expect(JSON.stringify(result)).not.toContain('private-secret');
  });
  it('rejects invalid success data instead of returning an empty successful list', async () => {
    const transport = vi.fn(async () => response({ ...page, items: null }));
    const provider = new IndustrySourceProvider(transport as typeof fetch, () => now);
    expect(await provider.query('media-ranking', query(), 'scope', 'server-token')).toMatchObject({ status: 'invalid_response', retryable: false });
  });
  it('preserves an HTTP failure even when the upstream body is empty', async () => {
    const transport = vi.fn(async () => new Response(null, { status: 429 }));
    const provider = new IndustrySourceProvider(transport as typeof fetch, () => now);
    expect(await provider.query('media-ranking', query(), 'scope', 'server-token')).toMatchObject({ status: 'quota_exhausted', httpStatus: 429 });
  });
  it.each([
    [429, 'null', 'quota_exhausted'],
    [403, '[]', 'forbidden'],
    [400, '"invalid query"', 'invalid_input'],
  ])('retains HTTP %s semantics when the error body is valid non-object JSON', async (httpStatus, body, status) => {
    const transport = vi.fn(async () => new Response(String(body), { status: Number(httpStatus) }));
    const provider = new IndustrySourceProvider(transport as typeof fetch, () => now);
    expect(await provider.query('media-ranking', query(), 'scope', 'server-token')).toMatchObject({ status, httpStatus });
  });
  it('bounds response size and request time without automatic replacement operations', async () => {
    const oversized = vi.fn(async () => new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024) } }));
    expect(await new IndustrySourceProvider(oversized as typeof fetch, () => now).query('filters', new URLSearchParams(), 'scope', 'server-token')).toMatchObject({ status: 'invalid_response' });
    vi.useFakeTimers();
    const pending = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const result = new IndustrySourceProvider(pending as typeof fetch, () => now).query('filters', new URLSearchParams(), 'scope', 'server-token');
    await vi.advanceTimersByTimeAsync(15001);
    expect(await result).toMatchObject({ status: 'timeout', retryable: true });
    expect(pending).toHaveBeenCalledOnce();
  });
});
