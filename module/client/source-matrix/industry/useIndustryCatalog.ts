import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { IndustryFailure, IndustryFilters, IndustrySuccess } from '../../../contracts/industry-source';
import type { IndustryCatalogResponse } from '../../../shared/industry-catalog';
import { IndustryRequestError } from './industry-source-client';

export interface IndustryCatalogSnapshot {
  catalog: IndustryCatalogResponse | null;
  loading: boolean;
  error: IndustryFailure | null;
}
export type CatalogTransport = (signal: AbortSignal) => Promise<IndustryCatalogResponse>;
const failure = (message: string, status: IndustryFailure['status'] = 'upstream_error', httpStatus = 502, retryable = true): IndustryFailure => ({ status, message, httpStatus, retryable });
const statuses = new Set(['configuration_required', 'unauthorized', 'forbidden', 'entitlement_required', 'quota_exhausted', 'invalid_input', 'upstream_error', 'invalid_response', 'timeout']);

/** Same authenticated module boundary as matrixApi; retain structured access failures. */
export const requestIndustryCatalog: CatalogTransport = async signal => {
  const response = await fetch('/api/modules/publish/industries', { credentials: 'same-origin', signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  let value: unknown;
  try { value = await response.json(); } catch { throw new IndustryRequestError(failure('行业目录响应无效，请重试。', 'invalid_response')); }
  const body = value as IndustryCatalogResponse & { httpStatus?: number; retryable?: boolean };
  if (!response.ok || !body || !['configured', 'configuration_required'].includes(body.status)) {
    throw new IndustryRequestError(failure(body?.message || '行业目录读取失败，请重试。', statuses.has(body?.status) ? body.status as IndustryFailure['status'] : 'upstream_error', body?.httpStatus ?? response.status, body?.retryable ?? response.status >= 500));
  }
  if (!Array.isArray(body.industries) || !Array.isArray(body.brand_data_batches) || !Array.isArray(body.legacyMappings)
    || body.industries.some(item => !item || typeof item.id !== 'string' || !item.id || item.id !== item.scopeId || typeof item.name !== 'string' || typeof item.label !== 'string' || !Array.isArray(item.path) || !item.path.every(part => typeof part === 'string') || !Number.isInteger(item.depth))
    || new Set(body.industries.map(item => item.id)).size !== body.industries.length
    || body.status === 'configured' && (!body.filters || !Array.isArray(body.filters.industryTree) || !Array.isArray(body.filters.models) || !Array.isArray(body.filters.sourceTypes))) {
    throw new IndustryRequestError(failure('行业目录数据不完整，请重试。', 'invalid_response'));
  }
  return body;
};

/** Catalog reads never initialize a billed distribution query. */
export class IndustryCatalogStore {
  private state: IndustryCatalogSnapshot = { catalog: null, loading: false, error: null };
  private listeners = new Set<() => void>();
  private request: Promise<IndustryCatalogResponse> | null = null;
  private controller: AbortController | null = null;
  constructor(private readonly transport: CatalogTransport = requestIndustryCatalog) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<IndustryCatalogSnapshot>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  load(retry = false): Promise<IndustryCatalogResponse> {
    if (this.request && (!retry || this.state.loading)) return this.request;
    this.controller = new AbortController();
    this.update({ loading: true, error: null });
    this.request = this.transport(this.controller.signal).then(catalog => {
      const error = catalog.status === 'configuration_required' ? failure(catalog.message || '行业目录尚未配置。', 'configuration_required', 503, false) : null;
      this.update({ catalog, loading: false, error }); return catalog;
    }).catch(error => {
      const classified = error instanceof IndustryRequestError ? error.failure : failure('行业目录读取失败，请重试。');
      this.update({ catalog: null, loading: false, error: classified }); throw new IndustryRequestError(classified);
    });
    return this.request;
  }
  start = () => { void this.load().catch(() => undefined); };
  retry = () => { void this.load(true).catch(() => undefined); };
  async filters(retry = false): Promise<IndustrySuccess<IndustryFilters>> {
    const catalog = await this.load(retry);
    if (!catalog.filters || catalog.status !== 'configured') throw new IndustryRequestError(this.state.error ?? failure('行业目录尚未配置。', 'configuration_required', 503, false));
    return { status: 'ok', data: catalog.filters, fetchedAt: new Date().toISOString(), source: 'molizhishu-public-industry' };
  }
}
const stores = new WeakMap<object, Map<number, IndustryCatalogStore>>();
export function industryCatalogFor(gateway: object, workspace: number) {
  let workspaces = stores.get(gateway); if (!workspaces) { workspaces = new Map(); stores.set(gateway, workspaces); }
  let store = workspaces.get(workspace); if (!store) { store = new IndustryCatalogStore(); workspaces.set(workspace, store); }
  return store;
}
const noIndustries: IndustryCatalogResponse['industries'] = [], noBatches: IndustryCatalogResponse['brand_data_batches'] = [], noMappings: IndustryCatalogResponse['legacyMappings'] = [];
export function useIndustryCatalog(gateway: object, workspace: number) {
  const store = useMemo(() => industryCatalogFor(gateway, workspace), [gateway, workspace]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(store.start, [store]);
  return { ...snapshot, industries: snapshot.catalog?.industries ?? noIndustries, brandBatches: snapshot.catalog?.brand_data_batches ?? noBatches,
    catalogVersion: snapshot.catalog?.catalogVersion ?? null, legacyMappings: snapshot.catalog?.legacyMappings ?? noMappings, retry: store.retry };
}
