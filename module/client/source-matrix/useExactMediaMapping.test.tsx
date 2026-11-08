// @vitest-environment jsdom
// Regression source only; execution belongs to the final integration handoff.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublisherGateway } from '../gateway';
import type { MediaList, MediaResource } from '../types';
import { readExactMediaBatch, uniqueMappedMedia, useExactMediaMapping } from './useExactMediaMapping';

vi.mock('../host', () => ({ usePublishingWorkspaceKey: () => 'workspace-1' }));
const uuid = '00000000-0000-4000-8000-000000000001';
const media = (externalResourceId: string, id = `media-${externalResourceId}`, active = true) => ({
  id, externalResourceId, name: externalResourceId, active, priceTenThousandths: '10000',
} as MediaResource);
const page = (items: MediaResource[], total = items.length, number = 1, size = 100) => ({
  items, total, page: number, pageSize: size, exactResourceLookupVersion: 1,
  catalog: { activeRevision: 'catalog-1' },
} as MediaList);
const gatewayFor = (listMedia: PublisherGateway['listMedia']) => ({ listMedia } as PublisherGateway);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
afterEach(() => cleanup());

describe('exact media identity reads', () => {
  it('loads UUIDs directly and external IDs exactly, without fuzzy search or name matching', async () => {
    const list = vi.fn<PublisherGateway['listMedia']>().mockResolvedValueOnce(page([media('ext-a', uuid)]))
      .mockResolvedValueOnce(page([media('ext-b')]));
    const controller = new AbortController();
    const items = await readExactMediaBatch(gatewayFor(list), [uuid, 'ext-b', uuid], controller.signal);
    expect(items).toHaveLength(2);
    expect(list.mock.calls[0]).toEqual([{ query: '', mediaIds: [uuid], page: 1, pageSize: 100 }, controller.signal]);
    expect(list.mock.calls[1]).toEqual([{ query: '', exactExternalResourceIds: ['ext-b'], page: 1, pageSize: 100 }, controller.signal]);
    expect(list.mock.calls.every(([filters]) => !filters.batchQuery)).toBe(true);
  });

  it('reads all pages before rejecting an ambiguous identity, including an inactive duplicate', async () => {
    const first = media('shared', 'internal-a');
    const second = media('shared', 'internal-b', false);
    const list = vi.fn<PublisherGateway['listMedia']>().mockResolvedValueOnce(page([first], 2, 1, 1))
      .mockResolvedValueOnce(page([second], 2, 2, 1));
    const items = await readExactMediaBatch(gatewayFor(list), ['shared'], new AbortController().signal);
    expect(list).toHaveBeenCalledTimes(2);
    expect(uniqueMappedMedia(items, 'shared')).toBeUndefined();
    expect(uniqueMappedMedia([second], 'shared')).toBeUndefined();
    expect(uniqueMappedMedia([first, first], 'shared')).toBe(first);
  });

  it('fails closed for an unsupported exact contract, extra records and truncated pagination', async () => {
    for (const response of [
      { ...page([media('ext-a')]), exactResourceLookupVersion: undefined },
      page([media('unrequested')]),
      page([], 1),
    ]) {
      const list = vi.fn<PublisherGateway['listMedia']>().mockResolvedValue(response);
      await expect(readExactMediaBatch(gatewayFor(list), ['ext-a'], new AbortController().signal)).rejects.toBeInstanceOf(Error);
    }
  });

  it('rejects a changed catalogue revision instead of mixing paginated identities', async () => {
    const list = vi.fn<PublisherGateway['listMedia']>().mockResolvedValueOnce(page([media('ext-a')], 2, 1, 1))
      .mockResolvedValueOnce({ ...page([media('ext-b')], 2, 2, 1), catalog: { activeRevision: 'catalog-2' } } as MediaList);
    await expect(readExactMediaBatch(gatewayFor(list), ['ext-a', 'ext-b'], new AbortController().signal)).rejects.toThrow('目录已更新');
  });
});

describe('partial exact mapping request scopes', () => {
  it('preserves successful batches and retries only the failed input identities', async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `ext-${String(index).padStart(3, '0')}`);
    let failed = false;
    const list = vi.fn<PublisherGateway['listMedia']>(async filters => {
      const requested = filters.exactExternalResourceIds!;
      if (requested.includes('ext-100') && !failed) { failed = true; throw new Error('batch failed'); }
      return page(requested.map(id => media(id)));
    });
    const gateway = gatewayFor(list);
    const view = renderHook(() => useExactMediaMapping(gateway, ids, 'matrix-1'));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current).toMatchObject({ ready: false, requestedCount: 201, completedCount: 101, mappedCount: 101, failedCount: 100 });
    expect(view.result.current.mediaForResource('ext-000')?.id).toBe('media-ext-000');
    expect(view.result.current.mediaForResource('ext-100')).toBeUndefined();
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(list).toHaveBeenCalledTimes(4);
    expect(list.mock.calls.at(-1)?.[0].exactExternalResourceIds).toEqual(ids.slice(100, 200));
    expect(view.result.current).toMatchObject({ completedCount: 201, mappedCount: 201, failedCount: 0 });
  });

  it('deduplicates an 822-ID scope, bounds concurrency and reports known missing identities honestly', async () => {
    const ids = Array.from({ length: 822 }, (_, index) => `ext-${String(index).padStart(3, '0')}`);
    const pending: Array<{ filters: Parameters<PublisherGateway['listMedia']>[0]; response: ReturnType<typeof deferred<MediaList>> }> = [];
    let active = 0, maximum = 0;
    const list = vi.fn<PublisherGateway['listMedia']>(async filters => {
      active++; maximum = Math.max(active, maximum);
      const response = deferred<MediaList>(); pending.push({ filters, response });
      try { return await response.promise; } finally { active--; }
    });
    const gateway = gatewayFor(list);
    const view = renderHook(() => useExactMediaMapping(gateway, [...ids, ids[0]!], 'matrix-1'));
    await waitFor(() => expect(pending).toHaveLength(3));
    for (let index = 0; index < 9; index++) {
      await waitFor(() => expect(pending.length).toBeGreaterThan(index));
      const request = pending[index]!;
      // A successful empty read is known missing, not a failed/unknown count.
      await act(async () => request.response.resolve(page([])));
    }
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(maximum).toBe(3);
    expect(list).toHaveBeenCalledTimes(9);
    expect(view.result.current).toMatchObject({ requestedCount: 822, completedCount: 822, mappedCount: 0, failedCount: 0 });
  });

  it('hides a previous owner immediately and ignores its late response', async () => {
    const old = deferred<MediaList>(), fresh = deferred<MediaList>();
    const list = vi.fn<PublisherGateway['listMedia']>().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const gateway = gatewayFor(list);
    const firstOwner = {}, secondOwner = {};
    const view = renderHook(({ owner }) => useExactMediaMapping(gateway, ['ext-a'], 'matrix-1', owner), { initialProps: { owner: firstOwner } });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    view.rerender({ owner: secondOwner });
    expect(view.result.current.items).toEqual([]);
    expect(list.mock.calls[0]?.[1]?.aborted).toBe(true);
    await act(async () => fresh.resolve(page([media('ext-a', 'new')])));
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => old.resolve(page([media('ext-a', 'old')])));
    expect(view.result.current.mediaForResource('ext-a')?.id).toBe('new');
  });

  it('does no request for a known empty identity scope', () => {
    const list = vi.fn<PublisherGateway['listMedia']>();
    const gateway = gatewayFor(list);
    const view = renderHook(() => useExactMediaMapping(gateway, [], 'matrix-empty'));
    expect(view.result.current).toMatchObject({ ready: true, requestedCount: 0, completedCount: 0, mappedCount: 0, failedCount: 0 });
    expect(list).not.toHaveBeenCalled();
  });

  it('does not carry a successful identity across a new matrix revision', async () => {
    const fresh = deferred<MediaList>();
    const list = vi.fn<PublisherGateway['listMedia']>().mockResolvedValueOnce(page([media('ext-a', 'old')]))
      .mockReturnValueOnce(fresh.promise);
    const gateway = gatewayFor(list), owner = {};
    const view = renderHook(({ revision }) => useExactMediaMapping(gateway, ['ext-a'], revision, owner), { initialProps: { revision: 'matrix-1' } });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    view.rerender({ revision: 'matrix-2' });
    expect(view.result.current.items).toEqual([]);
    expect(view.result.current.mediaForResource('ext-a')).toBeUndefined();
    await act(async () => fresh.resolve(page([media('ext-a', 'new')])));
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.mediaForResource('ext-a')?.id).toBe('new');
  });
});
