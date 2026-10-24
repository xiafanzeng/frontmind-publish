import { httpBatchLink, httpLink, splitLink, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";

/** Accepts both the module router and a router mounted under `publisher`. */
export function isPublisherCatalogRead(operation: { type: string; path: string }) {
  return operation.type === "query" && (
    operation.path === "publisher.media.list" ||
    operation.path === "publisher.media.facets" ||
    operation.path === "media.list" ||
    operation.path === "media.facets"
  );
}

/**
 * Use as the terminating link after any host auth/scope/path links. Each media
 * list/facet query gets its own HTTP response, so full-catalog aggregation and
 * article loading cannot hold up the first media page in a shared batch.
 *
 * Accepts the existing httpBatchLink configuration. The same endpoint, fetch
 * implementation and transformer apply to both branches. Header callbacks get
 * a one-operation opList for dedicated requests. Host scoped fetch/cancellation
 * behavior must be passed here;
 * this helper neither caches private data nor changes request authorization.
 */
export function createPublisherTransportLink<TRouter extends AnyRouter>(
  options: Parameters<typeof httpBatchLink<TRouter>>[0],
): TRPCLink<TRouter> {
  const headers = options.headers;
  return splitLink<TRouter>({
    condition: isPublisherCatalogRead,
    true: httpLink<TRouter>({
      ...options,
      headers: typeof headers === "function"
        ? ({ op }) => headers({ opList: [op] })
        : headers,
    }),
    false: httpBatchLink<TRouter>(options),
  });
}
