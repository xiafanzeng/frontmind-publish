// Regression source only. Not executed in this source-only delivery.
import { describe, expect, it, vi } from 'vitest';
import type { IndustryCatalogResponse } from '../../../shared/industry-catalog';
import { IndustryRequestError } from './industry-source-client';
import { IndustryCatalogStore, industryCatalogFor, requestIndustryCatalog } from './useIndustryCatalog';

const catalog: IndustryCatalogResponse = {
  status: 'configured', catalogVersion: 'v1', legacyMappings: [], brand_data_batches: [],
  industries: [{ id: '101', scopeId: '101', name: '工业软件', label: '　工业软件', path: ['制造业', '工业软件'], depth: 1 }],
  filters: { models: [{ value: 'all', label: '全部模型' }], industryTree: [], sourceTypes: [], minDate: null, maxDate: '2026-10-29' },
};
describe('one canonical catalog for both page branches', () => {
  it('shares in-flight reads and returns complete identity/label metadata without a query side effect', async () => {
    let finish!: (value: IndustryCatalogResponse) => void;
    const transport = vi.fn(() => new Promise<IndustryCatalogResponse>(resolve => { finish = resolve; }));
    const store = new IndustryCatalogStore(transport);
    const first = store.load(), second = store.load(), filterRead = store.filters(); store.start();
    expect(first).toBe(second); expect(transport).toHaveBeenCalledTimes(1);
    finish(catalog); await first; expect((await filterRead).data).toBe(catalog.filters);
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: null, catalog });
    expect(store.getSnapshot().catalog!.industries[0]!.label).toBe('　工业软件');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('keeps a real failure until an explicit retry, including a failed shared filters consumer', async () => {
    const failure = { status: 'forbidden' as const, httpStatus: 403, retryable: false, message: '无行业目录权限。' };
    const transport = vi.fn().mockRejectedValueOnce(new IndustryRequestError(failure)).mockResolvedValue(catalog);
    const store = new IndustryCatalogStore(transport);
    await expect(store.load()).rejects.toMatchObject({ failure });
    await expect(store.filters()).rejects.toMatchObject({ failure });
    expect(transport).toHaveBeenCalledTimes(1); expect(store.getSnapshot().error).toEqual(failure);
    await store.load(true); expect(store.getSnapshot().error).toBeNull(); expect(transport).toHaveBeenCalledTimes(2);
  });
  it('does not turn configuration-required into an empty successful catalog', async () => {
    const store = new IndustryCatalogStore(async () => ({ ...catalog, status: 'configuration_required', industries: [], filters: null, message: '尚未配置真实目录。' }));
    await store.load(); await expect(store.filters()).rejects.toMatchObject({ failure: { status: 'configuration_required' } });
    expect(store.getSnapshot().error?.message).toBe('尚未配置真实目录。');
  });
  it('isolates the authenticated gateway and workspace, without tying catalog identity to an article', () => {
    const first = {}, second = {};
    expect(industryCatalogFor(first, 1)).toBe(industryCatalogFor(first, 1));
    expect(industryCatalogFor(first, 1)).not.toBe(industryCatalogFor(first, 2));
    expect(industryCatalogFor(first, 1)).not.toBe(industryCatalogFor(second, 1));
  });
  it('retains authenticated module fetch and rejects malformed catalog responses', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'configured', industries: [] }) }));
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(requestIndustryCatalog(new AbortController().signal)).rejects.toMatchObject({ failure: { status: 'invalid_response' } });
      expect(fetcher.mock.calls[0]).toMatchObject(['/api/modules/publish/industries', { credentials: 'same-origin', cache: 'no-store' }]);
    } finally { vi.unstubAllGlobals(); }
  });
});
