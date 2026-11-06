// Regression source only. Not executed in this source-only delivery.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { industryRequest } from './industry-source-client';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('industry client transport failures', () => {
  it('keeps a network reset during body streaming retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new TypeError('body connection reset'); } })));
    await expect(industryRequest('contents', { requestId: '01234567-89ab-cdef-0123-456789abcdef' }, new AbortController().signal)).rejects.toMatchObject({ failure: { status: 'upstream_error', retryable: true } });
  });
  it('distinguishes malformed JSON from a body transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad JSON'); } })));
    await expect(industryRequest('filters', {}, new AbortController().signal)).rejects.toMatchObject({ failure: { status: 'invalid_response', retryable: false } });
  });
  it('keeps a timeout while reading the body retryable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init: RequestInit) => ({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => { init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); }) })));
    const pending = expect(industryRequest('contents', { requestId: '01234567-89ab-cdef-0123-456789abcdef' }, new AbortController().signal)).rejects.toMatchObject({ failure: { status: 'timeout', retryable: true } });
    await vi.advanceTimersByTimeAsync(25_000); await pending;
  });
  it('does not treat HTTP 200 business failure as success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'unauthorized', httpStatus: 401, message: '连接凭据无效。', retryable: false }) })));
    await expect(industryRequest('filters', {}, new AbortController().signal)).rejects.toMatchObject({ failure: { status: 'unauthorized', retryable: false } });
  });
});
