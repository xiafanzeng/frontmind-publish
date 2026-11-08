import { useCallback } from 'react';
import type { MediaRules } from '../server/providers/kol/media-rules';
import { usePublishingWorkspaceKey } from './host';
import { mediaReadError } from './mediaReadError';
import { usePartialBatchRead } from './usePartialBatchRead';

const api = '/api/modules/publish/media-requirements';

export async function rulesRequest<T>(path: string, signal?: AbortSignal, input?: unknown): Promise<T> {
  const response = await fetch(api + path, { credentials: 'same-origin', signal, ...(input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(mediaReadError(body?.message, '媒体资料暂时不可用，请重试或联系管理员。')), { cause: body });
  return body as T;
}

type MarketRulesState = {
  key: string;
  rules: Record<string, MediaRules>;
  ready: boolean;
  error: string;
  loading: boolean;
};
const messages = { timeout: '媒体要求读取超时，请重试。', failure: '投稿要求暂时无法读取，请重试。' };
type RuleRecord = { id: string; rules: MediaRules };

/** Read authenticated catalogue evidence without importing the media-library UI.
 * `revision` identifies the caller's current draft/catalogue/refresh scope, while
 * `owner` invalidates data when the host changes gateway/account in-place. These
 * are request boundaries, not a claim that the endpoint returns a frozen quote.
 */
export function useMarketRules(ids: string[], revision = '', owner?: unknown): MarketRulesState & { reload: () => void; completedIds?: string[]; failedIds?: string[] } {
  const workspace = usePublishingWorkspaceKey();
  const key = JSON.stringify([workspace, revision]);
  const load = useCallback(async (batch: string[], signal: AbortSignal) => {
    // The endpoint keeps its authenticated runtime check; no serial /status read.
    const data = await rulesRequest<{ items: RuleRecord[] }>('?ids=' + encodeURIComponent(batch.join(',')), signal);
    const wanted = new Set(batch);
    if (!Array.isArray(data.items) || data.items.some(item => !wanted.has(item.id) || !item.rules) ||
      new Set(data.items.map(item => item.id)).size !== data.items.length) throw new Error(messages.failure);
    return data.items;
  }, []);
  const batch = usePartialBatchRead(ids, key, owner, load, messages);
  const wanted = new Set(ids);
  const completed = new Set(batch.completedIds);
  // Missing/inactive rows stay absent; success never fabricates default rules.
  const rules = Object.fromEntries(batch.items.filter(item => wanted.has(item.id) && completed.has(item.id)).map(item => [item.id, item.rules]));
  return { key, rules, ready: ids.length > 0 && batch.ready, loading: batch.loading,
    error: batch.error ? mediaReadError(batch.error, messages.failure) : '', reload: batch.retry,
    completedIds: batch.completedIds, failedIds: batch.failedIds };
}
