import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { PublisherGateway } from "./gateway";

const PublishingGatewayContext = createContext<PublisherGateway | null>(null);

export function PublishingGatewayProvider({
  gateway,
  children,
}: {
  gateway: PublisherGateway;
  children: ReactNode;
}) {
  return (
    <PublishingGatewayContext.Provider value={gateway}>
      {children}
    </PublishingGatewayContext.Provider>
  );
}

export function usePublisherGateway() {
  const gateway = useContext(PublishingGatewayContext);
  if (!gateway) throw new Error("PublishingGatewayProvider is missing");
  return gateway;
}

export type PublisherQueryState<T> = {
  data?: T;
  error?: Error;
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
};

// Gateways belong to one authenticated enterprise scope. Never share cached
// private data between gateways, even when two pages use the same cache key.
const queryCache = new WeakMap<
  PublisherGateway,
  Map<string, { data: unknown }>
>();

/**
 * V7：作废查询缓存（可按前缀过滤）。删除稿件、重新识别覆盖等改变稿件集合的
 * 操作后调用，避免其他页面（管理稿件/工作台/编辑器）继续读旧列表。
 */
export function invalidatePublisherQueries(
  gateway: PublisherGateway,
  keyPrefix?: string,
) {
  const entries = queryCache.get(gateway);
  if (!entries) return;
  if (!keyPrefix) {
    entries.clear();
    return;
  }
  for (const key of Array.from(entries.keys())) {
    if (key.startsWith(keyPrefix)) entries.delete(key);
  }
}

export function usePublisherQuery<T>(
  load: (signal: AbortSignal) => Promise<T>,
  cacheKey?: string,
): PublisherQueryState<T> {
  const gateway = useContext(PublishingGatewayContext);
  const cached =
    gateway && cacheKey !== undefined
      ? queryCache.get(gateway)?.get(cacheKey)
      : undefined;
  const [state, setState] = useState<{
    gateway: PublisherGateway | null;
    cacheKey?: string;
    data?: T;
    error?: Error;
    loading: boolean;
    refreshing: boolean;
  }>({
    gateway,
    cacheKey,
    data: cached?.data as T | undefined,
    loading: !cached,
    refreshing: Boolean(cached),
  });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const cached =
      gateway && cacheKey !== undefined
        ? queryCache.get(gateway)?.get(cacheKey)
        : undefined;
    let alive = true;
    setState((current) => {
      const sameScope =
        current.gateway === gateway && current.cacheKey === cacheKey;
      const data =
        cacheKey !== undefined
          ? (cached?.data as T | undefined)
          : sameScope
            ? current.data
            : undefined;
      return {
        gateway,
        cacheKey,
        data,
        loading: data === undefined,
        refreshing: data !== undefined,
      };
    });
    const timeout = setTimeout(() => {
      if (!alive) return;
      controller.abort();
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: new Error("请求超时，请重试。"),
      }));
    }, 20_000);
    void Promise.resolve()
      .then(() => {
        if (!alive || controller.signal.aborted) return undefined;
        return load(controller.signal);
      })
      .then((data) => {
        if (alive && !controller.signal.aborted) {
          clearTimeout(timeout);
          if (gateway && cacheKey !== undefined) {
            let entries = queryCache.get(gateway);
            if (!entries) {
              entries = new Map();
              queryCache.set(gateway, entries);
            }
            entries.set(cacheKey, { data });
          }
          setState({
            gateway,
            cacheKey,
            data,
            loading: false,
            refreshing: false,
          });
        }
      })
      .catch((reason: unknown) => {
        clearTimeout(timeout);
        if (!alive || controller.signal.aborted) return;
        const error = reason instanceof Error ? reason : new Error("请求失败");
        setState((current) => ({
          ...current,
          error,
          loading: false,
          refreshing: false,
        }));
      });
    return () => {
      alive = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [load, reloadToken, gateway, cacheKey]);

  // Effects run after render. Mask the old scope during that first render too,
  // so switching enterprises never paints another enterprise's overview.
  const visible =
    state.gateway === gateway && state.cacheKey === cacheKey
      ? state
      : {
          data: cached?.data as T | undefined,
          error: undefined,
          loading: !cached,
          refreshing: Boolean(cached),
        };
  return {
    data: visible.data,
    error: visible.error,
    loading: visible.loading,
    refreshing: visible.refreshing,
    reload: () => setReloadToken((value) => value + 1),
  };
}
