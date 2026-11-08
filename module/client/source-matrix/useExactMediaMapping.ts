import { useCallback } from 'react';
import type { PublisherGateway } from '../gateway';
import { usePublishingWorkspaceKey } from '../host';
import type { MediaFilters, MediaResource } from '../types';
import { usePartialBatchRead } from '../usePartialBatchRead';

const internalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const canonicalId = (id: string) => internalId.test(id) ? id.toLowerCase() : id;
const messages = { timeout: '媒体映射读取超时，请重试。', failure: '媒体映射读取失败，请重试。' };

/** Read every page before publishing: unseen pages must not hide ambiguity. */
export async function readExactMediaBatch(gateway: PublisherGateway, ids: string[], signal: AbortSignal): Promise<MediaResource[]> {
  const uniqueIds = [...new Set(ids.map(canonicalId))];
  const all: MediaResource[] = [];
  for (const internal of [true, false]) {
    const requested = uniqueIds.filter(id => internalId.test(id) === internal);
    if (!requested.length) continue;
    const wanted = new Set(requested);
    const membership = internal ? { mediaIds: requested } : { exactExternalResourceIds: requested };
    let pageNumber = 1, expectedTotal: number | undefined, expectedRevision: string | undefined;
    const collected = new Map<string, MediaResource>();
    // The current indexed, unique identities yield <=100 rows. The page cap
    // also fails closed for a broken/older adapter instead of looping forever.
    for (;;) {
      if (signal.aborted) throw new Error('媒体映射读取已取消');
      const filters: MediaFilters = { query: '', ...membership, page: pageNumber, pageSize: 100 };
      const page = await gateway.listMedia(filters, signal);
      if (signal.aborted) throw new Error('媒体映射读取已取消');
      if (!internal && page.exactResourceLookupVersion !== 1) throw new Error('媒体服务暂不支持资源编号精确读取，请更新服务后重试。');
      if (!Number.isSafeInteger(page.total) || page.total < 0 || !Number.isSafeInteger(page.pageSize) || page.pageSize < 1 || page.page !== pageNumber) {
        throw new Error('媒体目录分页信息无效，请重试。');
      }
      if (expectedTotal !== undefined && expectedTotal !== page.total) throw new Error('媒体目录已变化，请重新读取映射。');
      expectedTotal = page.total;
      const revision = page.catalog.activeRevision;
      if (expectedRevision !== undefined && expectedRevision !== revision) throw new Error('媒体目录已更新，请重新读取映射。');
      expectedRevision = revision;
      const previousCount = collected.size;
      for (const media of page.items) {
        const identity = internal ? canonicalId(media.id) : media.externalResourceId;
        if (!identity || !wanted.has(identity)) throw new Error('媒体服务返回了范围外资源，请更新服务后重试。');
        if (collected.has(media.id)) throw new Error('媒体目录返回重复资源身份，请重试。');
        collected.set(media.id, media);
      }
      if (collected.size > page.total) throw new Error('媒体目录分页数量不一致，请重试。');
      const hasMore = page.page * page.pageSize < page.total;
      if (!hasMore) {
        if (collected.size !== page.total) throw new Error('媒体目录分页读取不完整，请重试。');
        break;
      }
      if (collected.size === previousCount || pageNumber >= 100) throw new Error('媒体目录分页未完成，请重试。');
      pageNumber++;
    }
    all.push(...collected.values());
  }
  return all;
}

/** Only unique active exact matches can become purchasable catalogue records. */
export function uniqueMappedMedia(items: MediaResource[], resourceId: string | null): MediaResource | undefined {
  if (!resourceId) return undefined;
  const normalizedId = canonicalId(resourceId);
  const matches = new Map(items.filter(media => (
    internalId.test(normalizedId) ? canonicalId(media.id) === normalizedId : media.externalResourceId === normalizedId
  )).map(media => [media.id, media]));
  const match = matches.size === 1 ? matches.values().next().value : undefined;
  return match?.active ? match : undefined;
}

export function useExactMediaMapping(gateway: PublisherGateway, resourceIds: string[], revision: string, owner?: unknown) {
  const workspace = usePublishingWorkspaceKey();
  const load = useCallback((ids: string[], signal: AbortSignal) => readExactMediaBatch(gateway, ids, signal), [gateway]);
  const normalizedIds = resourceIds.map(canonicalId);
  const batch = usePartialBatchRead(normalizedIds, JSON.stringify([workspace, revision]), owner ?? gateway, load, messages);
  const wanted = new Set(normalizedIds);
  const completed = new Set(batch.completedIds);
  // Keep inactive matches as evidence in items, but never resolve one for use.
  const items = [...new Map(batch.items.filter(media => wanted.has(canonicalId(media.id)) || !!media.externalResourceId && wanted.has(media.externalResourceId)).map(media => [media.id, media])).values()];
  const mediaForResource = (id: string | null) => id && completed.has(canonicalId(id)) ? uniqueMappedMedia(items, id) : undefined;
  return {
    items, loading: batch.loading, ready: batch.ready, error: batch.error,
    requestedCount: batch.requestedCount, completedCount: batch.completedIds.length,
    // Input identities, not distinct media records: two requested aliases may
    // resolve to one record while research-only candidates do not count.
    mappedCount: [...wanted].filter(id => !!mediaForResource(id)).length,
    failedCount: batch.failedIds.length,
    mediaForResource, retry: batch.retry,
  };
}
