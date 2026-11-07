import type { IndustryCommonQuery, IndustryContent, IndustryContentQuery, IndustryDistributions, IndustryFailure, IndustryFilters, IndustryListQuery, IndustryMedia, IndustryPage, IndustrySuccess } from '../../../contracts/industry-source';
import { industryCatalogFor, type IndustryCatalogSnapshot } from './useIndustryCatalog';
import { IndustryRequestError, industryRequest, newIndustryRequestId, type IndustryEndpoint, type IndustryQuery } from './industry-source-client';

export type ContentSelection = { media: string; sourceType: string; sortBy: 'citationCount' | 'publishTime'; sortOrder: 'asc' | 'desc' };
export const defaultSelection: ContentSelection = { media: '', sourceType: '', sortBy: 'citationCount', sortOrder: 'desc' };
type Section<T> = { data: T | null; loading: boolean; error: IndustryFailure | null; fetchedAt: string | null };
export type ListKind = 'media' | 'contents';
type Operation = { query: IndustryListQuery | IndustryContentQuery; append: boolean; generation: number; createdAt: number };
export interface IndustryState {
  filters: Section<IndustryFilters>;
  common: IndustryCommonQuery | null;
  selection: ContentSelection;
  media: Section<IndustryPage<IndustryMedia>>;
  contents: Section<IndustryPage<IndustryContent>>;
  distributions: Section<IndustryDistributions>;
  mediaSize: number;
  contentSize: number;
  blocked: IndustryFailure | null;
}
const empty = <T,>(): Section<T> => ({ data: null, loading: false, error: null, fetchedAt: null });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const asFailure = (error: unknown): IndustryFailure => error instanceof IndustryRequestError ? error.failure : { status: 'upstream_error', message: '行业信源读取失败，请重试本次查询。', httpStatus: 502, retryable: true };
const blockedStatuses = new Set(['configuration_required', 'unauthorized', 'forbidden', 'entitlement_required', 'quota_exhausted']);
const queryRecord = (query: object): IndustryQuery => ({ ...query } as IndustryQuery);
type Transport = <T>(endpoint: IndustryEndpoint, query: IndustryQuery, signal: AbortSignal) => Promise<IndustrySuccess<T>>;
let nextStoreIdentity = 0;

/** A gateway-scoped store keeps the same operation across StrictMode and route remounts. */
export class IndustrySourceStore {
  readonly identity = ++nextStoreIdentity;
  private state: IndustryState = { filters: empty(), common: null, selection: { ...defaultSelection }, media: empty(), contents: empty(), distributions: empty(), mediaSize: 50, contentSize: 20, blocked: null };
  private listeners = new Set<() => void>();
  private generations = { media: 0, contents: 0, distributions: 0 };
  private controllers: Partial<Record<ListKind | 'filters' | 'distributions', AbortController>> = {};
  private operations: Partial<Record<ListKind, Operation>> = {};
  private visited: Record<ListKind, Set<string>> = { media: new Set(), contents: new Set() };
  private started = false;
  private manualScope = false;
  private contextReady = true;
  setContextReady(ready: boolean) { this.contextReady = ready; }
  private validScope(common: IndustryCommonQuery | null) {
    if (!common) return false;
    if (common.scopeType === 'ALL') return true;
    const contains = (nodes: IndustryFilters['industryTree']): boolean => nodes.some(node => node.scopeId === common.scopeId || contains(node.children));
    return Boolean(common.scopeId && this.state.filters.data && contains(this.state.filters.data.industryTree));
  }
  get hasInvalidScope() { return Boolean(this.state.common && this.state.filters.data && !this.validScope(this.state.common)); }
  private canQuery() { return this.contextReady && !this.state.filters.loading && !this.state.blocked && Boolean(this.state.filters.data?.maxDate) && this.validScope(this.state.common); }
  private invalidateRemovedScope() { if (this.hasInvalidScope) this.clearQueries(true); }
  constructor(private readonly transport: Transport = industryRequest,
    private readonly catalogFilters?: (retry: boolean) => Promise<IndustrySuccess<IndustryFilters>>,
    private readonly quotaBlocked?: (failure: IndustryFailure | null) => void) {}
  get hasManualScope() { return this.manualScope; }
  markManualScope() { this.manualScope = true; }
  syncQuotaBlock(failure: IndustryFailure | null) { if (failure || this.state.blocked?.status === 'quota_exhausted') this.update({ blocked: failure }); }
  /** A page-level retry updates the same catalog; it cannot itself start paid queries. */
  receiveCatalog(snapshot: IndustryCatalogSnapshot) {
    if (snapshot.loading) {
      if (!this.state.filters.loading) this.update({ filters: { ...this.state.filters, loading: true, error: null } });
      return;
    }
    if (!snapshot.catalog && !snapshot.error) return;
    const filters = snapshot.catalog?.filters ?? null;
    if (snapshot.error) {
      if (this.state.filters.error === snapshot.error) return;
      this.update({ filters: { data: null, loading: false, error: snapshot.error, fetchedAt: null }, blocked: this.stickyBlock(snapshot.error) });
      return;
    }
    if (filters && (this.state.filters.data !== filters || this.state.filters.loading || this.state.filters.error)) {
      this.update({ filters: { data: filters, loading: false, error: null, fetchedAt: new Date().toISOString() }, blocked: this.state.blocked?.status === 'quota_exhausted' ? this.state.blocked : null });
      if (!filters.maxDate) this.clearQueries(); else this.invalidateRemovedScope();
    }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get attached() { return this.listeners.size > 0; }
  private update(patch: Partial<IndustryState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private stickyBlock(failure: IndustryFailure): IndustryFailure {
    if (failure.status === 'quota_exhausted') this.quotaBlocked?.(failure);
    // Free endpoints cannot prove that billed-query quota has recovered, even after another failure.
    return this.state.blocked?.status === 'quota_exhausted' ? this.state.blocked : failure;
  }
  reportExportFailure(failure: IndustryFailure) {
    if (blockedStatuses.has(failure.status)) this.update({ blocked: this.stickyBlock(failure) });
  }
  dispose() { for (const controller of Object.values(this.controllers)) controller?.abort(); this.listeners.clear(); }

  start(initial?: (filters: IndustryFilters) => { common: IndustryCommonQuery; selection: ContentSelection }, options?: { deferInitialization?: boolean }) {
    if (this.started) {
      if (!options?.deferInitialization && initial && this.state.filters.data?.maxDate) {
        const restored = initial(this.state.filters.data);
        this.apply(restored.common, restored.selection);
      }
      return;
    }
    this.started = true;
    void this.loadFilters(!options?.deferInitialization, initial);
  }
  async checkAccess() { await this.loadFilters(false, undefined, true); }
  resumeAfterResolution() {
    if (!this.contextReady || !this.state.blocked || this.state.filters.loading || !this.state.filters.data?.maxDate) return;
    // An explicit user action, not evidence that the free filters request restored quota.
    this.quotaBlocked?.(null);
    this.update({ blocked: null });
    if (this.state.common) this.refresh();
  }
  private async loadFilters(initialize: boolean, initial?: (filters: IndustryFilters) => { common: IndustryCommonQuery; selection: ContentSelection }, recheck = false) {
    if (this.state.filters.loading) return;
    const controller = new AbortController(); this.controllers.filters = controller;
    this.update({ filters: { ...this.state.filters, loading: true, error: null } });
    try {
      const result = this.catalogFilters ? await this.catalogFilters(recheck) : await this.transport<IndustryFilters>('filters', {}, controller.signal);
      if (controller.signal.aborted) return;
      const filters = result.data;
      const blocked = this.state.blocked?.status === 'quota_exhausted' ? this.state.blocked : null;
      this.update({ filters: { data: filters, loading: false, error: null, fetchedAt: result.fetchedAt }, blocked });
      if (!filters.maxDate) { this.clearQueries(); return; }
      this.invalidateRemovedScope();
      if (initialize && !this.state.common) {
        const restored = initial?.(filters);
        this.apply(restored?.common ?? { periodType: 'MONTH', date: filters.maxDate.slice(0, 7) + '-01', scopeType: 'ALL', modelCode: 'all' }, restored?.selection ?? defaultSelection);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = asFailure(error);
      this.update({ filters: { data: null, loading: false, error: failure, fetchedAt: null }, blocked: this.stickyBlock(failure) });
    }
  }
  private clearQueries(preserveCommon = false) {
    for (const kind of ['media', 'contents', 'distributions'] as const) { this.generations[kind]++; this.controllers[kind]?.abort(); }
    this.operations = {};
    this.update({ ...(preserveCommon ? { selection: { ...defaultSelection } } : { common: null }), media: empty(), contents: empty(), distributions: empty() });
  }
  apply(common: IndustryCommonQuery, selection: ContentSelection = defaultSelection, force = false) {
    if (!this.contextReady || this.state.filters.loading || this.state.blocked || !this.state.filters.data?.maxDate || !this.validScope(common)) return;
    if (!force && same(common, this.state.common)) { this.selectContent(selection); return; }
    this.clearQueries();
    this.update({ common: { ...common }, selection: { ...selection } });
    this.first('media'); this.first('contents'); void this.loadDistributions();
  }
  refresh() { if (this.state.common && !this.state.media.loading && !this.state.contents.loading) this.apply(this.state.common, this.state.selection, true); }
  selectContent(selection: ContentSelection) {
    if (!this.canQuery() || !this.state.common || same(selection, this.state.selection)) return;
    this.generations.contents++; this.controllers.contents?.abort(); delete this.operations.contents;
    this.update({ selection: { ...selection }, contents: empty() });
    this.first('contents');
  }
  setPageSize(kind: ListKind, size: number) {
    if (!this.canQuery() || !this.state.common || ![10, 20, 50, 100].includes(size)) return;
    if ((kind === 'media' ? this.state.mediaSize : this.state.contentSize) === size) return;
    this.generations[kind]++; this.controllers[kind]?.abort(); delete this.operations[kind];
    this.update({ [kind]: empty(), ...(kind === 'media' ? { mediaSize: size } : { contentSize: size }) });
    this.first(kind);
  }
  restart(kind: ListKind) {
    if (!this.canQuery() || !this.state.common || this.state[kind].loading) return;
    this.generations[kind]++; this.controllers[kind]?.abort(); delete this.operations[kind];
    this.update({ [kind]: empty() }); this.first(kind);
  }
  retry(kind: ListKind) {
    const operation = this.operations[kind];
    if (!this.canQuery() || this.state[kind].loading || !operation || !this.state[kind].error?.retryable) return;
    const month = (time: number) => new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
    if (Date.now() - operation.createdAt >= 600_000 || month(operation.createdAt) !== month(Date.now())) { this.expire(kind); return; }
    void this.loadList(kind, operation);
  }
  more(kind: ListKind) {
    const lane = this.state[kind], page = lane.data;
    if (!this.canQuery() || lane.loading || lane.error || !page || page.nextCursor === null || !this.state.common) return;
    if (BigInt(page.expiresAt) <= BigInt(Date.now())) { this.expire(kind); return; }
    if (this.visited[kind].has(page.nextCursor)) { this.expire(kind); return; }
    this.visited[kind].add(page.nextCursor);
    const query = { ...this.baseQuery(kind), snapshotToken: page.snapshotToken, cursor: page.nextCursor, requestId: newIndustryRequestId() };
    void this.loadList(kind, { query, append: true, generation: this.generations[kind], createdAt: Date.now() });
  }
  private baseQuery(kind: ListKind): IndustryListQuery | IndustryContentQuery {
    const { common, selection } = this.state;
    const shared: IndustryListQuery = { ...common!, pageSize: kind === 'media' ? this.state.mediaSize : this.state.contentSize, requestId: newIndustryRequestId() };
    return kind === 'media' ? shared : { ...shared, ...(selection.media ? { media: selection.media } : {}), ...(selection.sourceType ? { sourceType: selection.sourceType } : {}), sortBy: selection.sortBy, sortOrder: selection.sortOrder };
  }
  private first(kind: ListKind) { this.visited[kind].clear(); void this.loadList(kind, { query: this.baseQuery(kind), append: false, generation: this.generations[kind], createdAt: Date.now() }); }
  private expire(kind: ListKind) {
    this.generations[kind]++; delete this.operations[kind];
    this.update({ [kind]: { ...empty(), error: { status: 'session_expired', httpStatus: 409, retryable: false, message: '查询会话已失效，请从首屏重新查询。重新查询会使用一次查询额度。' } } });
  }
  private async loadList(kind: ListKind, operation: Operation) {
    if (!this.canQuery() || this.state[kind].loading) return;
    const controller = new AbortController(); this.controllers[kind] = controller; this.operations[kind] = operation;
    this.update({ [kind]: { ...this.state[kind], loading: true, error: null } });
    try {
      const endpoint = kind === 'media' ? 'media-ranking' : 'contents';
      const result = await this.transport<IndustryPage<IndustryMedia | IndustryContent>>(endpoint, queryRecord(operation.query), controller.signal);
      if (controller.signal.aborted || operation.generation !== this.generations[kind]) return;
      const page = result.data;
      const previous = this.state[kind].data;
      if (operation.append && (!previous || previous.snapshotToken !== page.snapshotToken || previous.pageSize !== page.pageSize || page.nextCursor === operation.query.cursor)) { this.expire(kind); return; }
      const prior = operation.append ? previous?.items ?? [] : [];
      const identity = (item: IndustryMedia | IndustryContent) => 'linkId' in item ? item.linkId : item.code;
      const items = [...new Map([...prior, ...page.items].map(item => [identity(item), item])).values()];
      this.update({ [kind]: { data: { ...page, items }, loading: false, error: null, fetchedAt: result.fetchedAt } });
    } catch (error) {
      if (controller.signal.aborted || operation.generation !== this.generations[kind]) return;
      const failure = asFailure(error);
      if (failure.status === 'session_expired') { this.expire(kind); return; }
      this.update({ [kind]: { ...this.state[kind], loading: false, error: failure }, ...(blockedStatuses.has(failure.status) ? { blocked: this.stickyBlock(failure) } : {}) });
    }
  }
  async retryDistributions() { if (this.canQuery() && this.state.common && !this.state.distributions.loading) await this.loadDistributions(); }
  private async loadDistributions() {
    const common = this.state.common; if (!this.canQuery() || !common) return;
    const generation = this.generations.distributions, controller = new AbortController(); this.controllers.distributions = controller;
    this.update({ distributions: { ...this.state.distributions, loading: true, error: null } });
    try {
      const result = await this.transport<IndustryDistributions>('distributions', queryRecord(common), controller.signal);
      if (!controller.signal.aborted && generation === this.generations.distributions) this.update({ distributions: { data: result.data, error: null, loading: false, fetchedAt: result.fetchedAt } });
    } catch (error) {
      if (!controller.signal.aborted && generation === this.generations.distributions) {
        const failure = asFailure(error);
        this.update({ distributions: { data: null, error: failure, loading: false, fetchedAt: null }, ...(blockedStatuses.has(failure.status) && failure.status !== 'quota_exhausted' ? { blocked: this.stickyBlock(failure) } : {}) });
      }
    }
  }
}

type WorkspaceQueryStores = { stores: Map<string, IndustrySourceStore>; quota: IndustryFailure | null };
const scopedStores = new WeakMap<object, Map<number, WorkspaceQueryStores>>();
export function industryStoreFor(gateway: object, workspace: number, articleScope?: string): IndustrySourceStore {
  let workspaces = scopedStores.get(gateway);
  if (!workspaces) { workspaces = new Map(); scopedStores.set(gateway, workspaces); }
  let scope = workspaces.get(workspace);
  if (!scope) { scope = { stores: new Map(), quota: null }; workspaces.set(workspace, scope); }
  const stores = scope.stores, key = articleScope === undefined ? 'research' : 'article:' + articleScope;
  let store = stores.get(key);
  if (!store) {
    for (const [oldKey, value] of stores) if (stores.size >= 24 && !value.attached) { value.dispose(); stores.delete(oldKey); }
    const owner = scope, catalog = industryCatalogFor(gateway, workspace);
    store = new IndustrySourceStore(industryRequest, retry => catalog.filters(retry), failure => {
      owner.quota = failure;
      for (const peer of owner.stores.values()) peer.syncQuotaBlock(failure);
    });
    if (scope.quota) store.syncQuotaBlock(scope.quota);
    stores.set(key, store);
  }
  return store;
}
