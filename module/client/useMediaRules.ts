import { useCallback, useEffect, useState } from 'react';
import type { MediaRules } from '../server/providers/kol/media-rules';
import { usePublishingWorkspaceKey } from './host';
import { mediaReadError } from './mediaReadError';

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

/** Read authenticated catalogue evidence without importing the media-library UI.
 * `revision` identifies the caller's current draft/catalogue/refresh scope, while
 * `owner` invalidates data when the host changes gateway/account in-place. These
 * are request boundaries, not a claim that the endpoint returns a frozen quote.
 */
export function useMarketRules(ids: string[], revision = '', owner?: unknown): MarketRulesState & { reload: () => void } {
  const workspace = usePublishingWorkspaceKey();
  const idsKey = [...new Set(ids)].sort().join(',');
  const key = `${workspace}:${revision}:${idsKey}`;
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken(value => value + 1), []);
  const [state, setState] = useState<MarketRulesState & { reloadToken: number; owner: unknown }>({ key: '', reloadToken: 0, owner, rules: {}, ready: false, error: '', loading: true });

  useEffect(() => {
    if (!idsKey) {
      setState({ key, reloadToken, owner, rules: {}, ready: false, error: '', loading: false });
      return;
    }
    const abort = new AbortController();
    let active = true;
    const current = () => active && !abort.signal.aborted;
    setState({ key, reloadToken, owner, rules: {}, ready: false, error: '', loading: true });
    const timeout = setTimeout(() => {
      if (!current()) return;
      abort.abort();
      setState({ key, reloadToken, owner, rules: {}, ready: false, error: '媒体要求读取超时，请重试。', loading: false });
    }, 20_000);
    // The endpoint checks the same authenticated runtime capability. Do not add
    // a serial /status round trip or reuse rules across owners/workspaces.
    void Promise.resolve().then(async () => {
      if (!current()) return;
      const items: Array<{ id: string; rules: MediaRules }> = [];
      const all = idsKey.split(',');
      for (let i = 0; i < all.length; i += 100) {
        const data = await rulesRequest<{ items: Array<{ id: string; rules: MediaRules }> }>('?ids=' + encodeURIComponent(all.slice(i, i + 100).join(',')), abort.signal);
        if (!current()) return;
        items.push(...data.items);
      }
      if (current()) {
        clearTimeout(timeout);
        // Missing/inactive catalogue rows intentionally remain absent. A caller
        // must not replace them with an "unknown" rule or a default title cap.
        setState({ key, reloadToken, owner, rules: Object.fromEntries(items.map(item => [item.id, item.rules])), ready: true, error: '', loading: false });
      }
    }).catch(error => {
      if (!current()) return;
      clearTimeout(timeout);
      setState({ key, reloadToken, owner, rules: {}, ready: false, error: mediaReadError(error, '投稿要求暂时无法读取，请重试。'), loading: false });
    });
    return () => { active = false; clearTimeout(timeout); abort.abort(); };
  }, [key, idsKey, reloadToken, owner]);

  // Hide a previous scope/attempt/owner synchronously, before its effect cleanup.
  const visible = state.key === key && state.reloadToken === reloadToken && state.owner === owner
    ? state
    : { key, rules: {}, ready: false, error: '', loading: Boolean(idsKey) };
  return { ...visible, reload };
}
