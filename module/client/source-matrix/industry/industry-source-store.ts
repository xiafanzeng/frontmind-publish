import type { IndustryCommonQuery, IndustryContent, IndustryContentQuery, IndustryDistributions, IndustryFailure, IndustryFilters, IndustryListQuery, IndustryMedia, IndustryPage, IndustrySuccess } from '../../../contracts/industry-source';
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
  private state: IndustryState = { filters: empty(), common: null, selection: { ...defaultSelection }, media: empty(), contents: empty(), distributions: empty(), mediaSize: 10, contentSize: 20, blocked: null };
  private listeners = new Set<() => void>();
  private generations = { media: 0, contents: 0, distributions: 0 };
  private controllers: Partial<Record<ListKind | 'filters' | 'distributions', AbortController>> = {};
  private operations: Partial<Record<ListKind, Operation>> = {};
  private visited: Record<ListKind, Set<string>> = { media: new Set(), contents: new Set() };
  private started = false;
  constructor(private readonly transport: Transport = industryRequest) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get attached() { return this.listeners.size > 0; }
  private update(patch: Partial<IndustryState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private stickyBlock(failure: IndustryFailure): IndustryFailure {
    // Free endpoints cannot prove that billed-query quota has recovered, even after another failure.
    return this.state.blocked?.status === 'quota_exhausted' ? this.state.blocked : failure;
  }
  dispose() { for (const controller of Object.values(this.controllers)) controller?.abort(); this.listeners.clear(); }

  start(initial?: (filters: IndustryFilters) => { common: IndustryCommonQuery; selection: ContentSelection }) {
    if (this.started) {
      if (initial && this.state.filters.data?.maxDate) {
        const restored = initial(this.state.filters.data);
        this.apply(restored.common, restored.selection);
      }
      return;
    }
    this.started = true;
    void this.loadFilters(true, initial);
  }
  async checkAccess() { await this.loadFilters(false); }
  resumeAfterResolution() {
    if (!this.state.blocked || this.state.filters.loading || !this.state.filters.data?.maxDate) return;
    // An explicit user action, not evidence that the free filters request restored quota.
    this.update({ blocked: null });
    if (this.state.common) this.refresh();
  }
  private async loadFilters(initialize: boolean, initial?: (filters: IndustryFilters) => { common: IndustryCommonQuery; selection: ContentSelection }) {
    if (this.state.filters.loading) return;
    const controller = new AbortController(); this.controllers.filters = controller;
    this.update({ filters: { ...this.state.filters, loading: true, error: null } });
    try {
      const result = await this.transport<IndustryFilters>('filters', {}, controller.signal);
      if (controller.signal.aborted) return;
      const filters = result.data;
      const blocked = this.state.blocked?.status === 'quota_exhausted' ? this.state.blocked : null;
      this.update({ filters: { data: filters, loading: false, error: null, fetchedAt: result.fetchedAt }, blocked });
      if (!filters.maxDate) { this.clearQueries(); return; }
      if (initialize) {
        const restored = initial?.(filters);
        this.apply(restored?.common ?? { periodType: 'MONTH', date: filters.maxDate.slice(0, 7) + '-01', scopeType: 'ALL', modelCode: 'all' }, restored?.selection ?? defaultSelection, true);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = asFailure(error);
      this.update({ filters: { data: null, loading: false, error: failure, fetchedAt: null }, blocked: this.stickyBlock(failure) });
    }
  }
  private clearQueries() {
    for (const kind of ['media', 'contents', 'distributions'] as const) { this.generations[kind]++; this.controllers[kind]?.abort(); }
    this.operations = {};
    this.update({ common: null, media: empty(), contents: empty(), distributions: empty() });
  }
  apply(common: IndustryCommonQuery, selection: ContentSelection = defaultSelection, force = false) {
    if (this.state.blocked || !this.state.filters.data?.maxDate) return;
    if (!force && same(common, this.state.common)) { this.selectContent(selection); return; }
    this.clearQueries();
    this.update({ common: { ...common }, selection: { ...selection } });
    this.first('media'); this.first('contents'); void this.loadDistributions();
  }
  refresh() { if (this.state.common && !this.state.media.loading && !this.state.contents.loading) this.apply(this.state.common, this.state.selection, true); }
  selectContent(selection: ContentSelection) {
    if (this.state.blocked || !this.state.common || same(selection, this.state.selection)) return;
    this.generations.contents++; this.controllers.contents?.abort(); delete this.operations.contents;
    this.update({ selection: { ...selection }, contents: empty() });
    this.first('contents');
  }
  setPageSize(kind: ListKind, size: number) {
    if (this.state.blocked || !this.state.common || ![10, 20, 50, 100].includes(size)) return;
    if ((kind === 'media' ? this.state.mediaSize : this.state.contentSize) === size) return;
    this.generations[kind]++; this.controllers[kind]?.abort(); delete this.operations[kind];
    this.update({ [kind]: empty(), ...(kind === 'media' ? { mediaSize: size } : { contentSize: size }) });
    this.first(kind);
  }
  restart(kind: ListKind) {
    if (this.state.blocked || !this.state.common || this.state[kind].loading) return;
    this.generations[kind]++; this.controllers[kind]?.abort(); delete this.operations[kind];
    this.update({ [kind]: empty() }); this.first(kind);
  }
  retry(kind: ListKind) {
    const operation = this.operations[kind];
    if (this.state.blocked || this.state[kind].loading || !operation || !this.state[kind].error?.retryable) return;
    const month = (time: number) => new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
    if (Date.now() - operation.createdAt >= 600_000 || month(operation.createdAt) !== month(Date.now())) { this.expire(kind); return; }
    void this.loadList(kind, operation);
  }
  more(kind: ListKind) {
    const lane = this.state[kind], page = lane.data;
    if (this.state.blocked || lane.loading || lane.error || !page || page.nextCursor === null || !this.state.common) return;
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
    if (this.state.blocked || this.state[kind].loading) return;
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
  async retryDistributions() { if (this.state.common && !this.state.distributions.loading) await this.loadDistributions(); }
  private async loadDistributions() {
    const common = this.state.common; if (!common) return;
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

const scopedStores = new WeakMap<object, Map<number, IndustrySourceStore>>();
export function industryStoreFor(gateway: object, workspace: number): IndustrySourceStore {
  let stores = scopedStores.get(gateway);
  if (!stores) { stores = new Map(); scopedStores.set(gateway, stores); }
  let store = stores.get(workspace);
  if (!store) {
    for (const [key, value] of stores) if (stores.size >= 8 && !value.attached) { value.dispose(); stores.delete(key); }
    store = new IndustrySourceStore(); stores.set(workspace, store);
  }
  return store;
}
