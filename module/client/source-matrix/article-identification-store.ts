import type { IdentificationContext, IdentificationContextResponse, IdentificationField, IdentificationFieldKey, IdentificationFields, IdentifyArticleRequest, IdentifyArticleResponse } from '../../shared/article-identification';
import { matrixApi } from './api';

export const identificationFieldKeys: IdentificationFieldKey[] = ['product', 'industry', 'audience', 'questions'];
export type IdentificationValues = Record<IdentificationFieldKey, string>;
export type IdentificationStatus = 'no_article' | 'loading' | 'ready' | 'not_configured' | 'identifying' | 'complete' | 'partial' | 'unidentified' | 'failed';
export type IdentificationOrigin = IdentificationField['source'] | 'manual' | 'saved';
export interface IdentificationFieldState {
  value: string;
  origin: IdentificationOrigin;
  edited: boolean;
  evidence?: string;
  candidate?: string;
  suggestion?: IdentificationField;
}
export interface IdentificationSnapshot {
  values: IdentificationValues;
  fields: Record<IdentificationFieldKey, IdentificationFieldState>;
  status: IdentificationStatus;
  message: string;
  context: IdentificationContext | null;
  scopeToken: string;
  hasManualChanges: boolean;
  /** True only after the current authenticated values were saved in this tab. */
  persisted: boolean;
}
export type IdentificationTransport = <T>(path: string, signal: AbortSignal, body?: unknown) => Promise<T>;
export interface IdentificationRoute {
  workspace: string;
  articleVersionId: string;
  draftId?: string;
  formScope?: string;
  connectionEpoch?: string | number;
}
type RecordState = {
  context: IdentificationContext;
  workspace: string;
  formScope: string;
  fields: IdentificationSnapshot['fields'];
  status: IdentificationStatus;
  attempted: boolean;
  hydrations: string[];
  updatedAt: number;
  persisted?: boolean;
  operation?: Promise<void>;
  latestFields?: IdentificationFields;
  errorMessage?: string;
};
type PendingHydration = { values: IdentificationValues; id: string };
const SESSION_PREFIX = 'frontmind:article-identification:v1:';
export const IDENTIFICATION_SESSION_TTL = 6 * 60 * 60 * 1000;
const MAX_RECORDS = 24;
let nextGatewayIdentity = 0;
const emptyFields = (): IdentificationSnapshot['fields'] => ({
  product: { value: '', origin: 'unidentified', edited: false },
  industry: { value: '', origin: 'unidentified', edited: false },
  audience: { value: '', origin: 'unidentified', edited: false },
  questions: { value: '', origin: 'unidentified', edited: false },
});
const valuesOf = (fields: IdentificationSnapshot['fields']): IdentificationValues => ({ product: fields.product.value, industry: fields.industry.value, audience: fields.audience.value, questions: fields.questions.value });
const messages: Record<IdentificationStatus, string> = {
  no_article: '请先选择稿件，可继续手动填写。', loading: '正在读取稿件信息…', ready: '可根据当前稿件识别投放要求。',
  not_configured: 'AI 识别暂未配置，可先手动填写。', identifying: '正在根据当前稿件识别…',
  complete: '识别完成，请核对稿件信息和 AI 建议。', partial: '部分识别完成，其余字段仍待填写。',
  unidentified: '未识别出可安全填写的内容，请手动填写。', failed: '识别失败，已保留填写内容，可重试。',
};
// The existing matrixApi exposes only Error(message). Accept only exact public
// messages emitted by our identification route; never echo arbitrary upstream text.
const publicFailureMessages = new Set([
  'AI 识别超时，请稍后重试；已填写内容会保留。',
  'AI 连接认证失败，请联系管理员或检查当前模型连接。',
  '当前 AI 连接没有使用该模型的权限。',
  'AI 服务额度暂不可用，可先手动填写。',
  'AI 请求过于频繁，请稍后重试。',
  '配置的 AI 模型暂不可用，请检查模型连接。',
  'AI 服务不支持当前识别协议，请检查模型连接。',
  '模型未能处理这篇稿件，可手动填写或稍后重试。',
  'AI 返回内容超出限制，未采用该结果，请重试。',
  'AI 未完成本次识别，未采用不完整结果，请重试。',
  'AI 返回格式无效，未采用该结果，请重试。',
  'AI 未返回识别内容，请重试或手动填写。',
  'AI 识别暂不可用，请稍后重试；已填写内容会保留。',
  'AI 识别暂未配置，可先手动填写。',
  '当前冻结版本正文为空，请先确认稿件内容。',
  '稿件超出本次全文识别的 60,000 字符限制，尚未分析；请手动填写。',
  '当前稿件或版本不可用，请重新选择已授权稿件。',
  '当前工作区或身份已变化，请重新读取稿件。',
  '稿件内容或标题已变化，请重新读取当前版本。',
  '稿件或版本权限已变化，本次结果未采用，请重新读取。',
  'AI 连接已变化，请重新读取后识别。',
  'AI 连接已变化，本次结果未采用，请重新识别。',
  '行业选项暂不可用，可先手动填写其他内容。',
  '请选择有效稿件及明确版本。',
  '识别请求无效，请重新读取当前稿件。',
  '需要已授权企业项目',
]);
function safeFailureMessage(error: unknown, fallback: string, timedOut = false) {
  if (timedOut) return 'AI 识别超时，请稍后重试；已填写内容会保留。';
  return error instanceof Error && publicFailureMessages.has(error.message) ? error.message : fallback;
}
function snapshot(fields: IdentificationSnapshot['fields'], status: IdentificationStatus, context: IdentificationContext | null, scopeToken: string, message = messages[status], persisted = false): IdentificationSnapshot {
  return { fields, values: valuesOf(fields), status, message, context, scopeToken, hasManualChanges: identificationFieldKeys.some(key => fields[key].edited), persisted };
}
export const emptyIdentificationSnapshot = snapshot(emptyFields(), 'no_article', null, '');
function contextKey(context: IdentificationContext, workspace: string) {
  return JSON.stringify([workspace, context.scopeKey, context.articleId, context.articleVersionId, context.contentDigest, context.connection.mode, context.connection.revision]);
}
function recordKey(context: IdentificationContext, workspace: string, formScope: string) { return JSON.stringify([contextKey(context, workspace), formScope]); }
function sameArticle(left: IdentificationContext, right: IdentificationContext) { return left.scopeKey === right.scopeKey && left.articleId === right.articleId && left.articleVersionId === right.articleVersionId && left.contentDigest === right.contentDigest; }
function validContext(value: IdentificationContext, versionId: string): boolean {
  return !!value && value.articleVersionId === versionId && ['scopeKey', 'articleId', 'articleVersionId', 'contentDigest', 'title'].every(key => typeof value[key as keyof IdentificationContext] === 'string')
    && !!value.scopeKey && !!value.articleId && !!value.contentDigest && Number.isInteger(value.versionNumber)
    && !!value.connection && typeof value.connection.available === 'boolean' && typeof value.connection.revision === 'string'
    && ['host', 'user', 'environment', 'none'].includes(value.connection.mode);
}
function validField(value: IdentificationField): boolean {
  return !!value && (value.value === null || typeof value.value === 'string' && value.value.length <= 12000)
    && ['article', 'inferred', 'unidentified'].includes(value.source)
    && (value.source !== 'unidentified' || value.value === null)
    && (value.evidence === undefined || typeof value.evidence === 'string' && value.evidence.length <= 12000)
    && (value.candidate === undefined || typeof value.candidate === 'string' && value.candidate.length <= 12000);
}
function validFields(fields: IdentificationFields): boolean { return !!fields && identificationFieldKeys.every(key => validField(fields[key])); }
function applyFields(record: RecordState, fields: IdentificationFields, metadataOnly = false) {
  for (const key of identificationFieldKeys) {
    const current = record.fields[key], incoming = fields[key];
    if (metadataOnly && incoming.value === null) continue;
    if (current.edited || current.origin === 'saved') {
      record.fields[key] = { ...current, candidate: incoming.candidate, suggestion: incoming.value !== null && incoming.value !== current.value ? { ...incoming } : undefined };
    } else {
      record.fields[key] = { value: incoming.value ?? '', origin: incoming.source, edited: false, evidence: incoming.evidence, candidate: incoming.candidate };
    }
  }
}
function sessionStorageOrNull(): Storage | null { try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; } }

/** Memory is gateway-scoped; persisted state is never read before fresh server authorization. */
export class ArticleIdentificationStore {
  private readonly identity = ++nextGatewayIdentity;
  private records = new Map<string, RecordState>();
  private routes = new Map<string, ArticleIdentificationRouteStore>();
  constructor(readonly transport: IdentificationTransport = matrixApi, private readonly storage: () => Storage | null = sessionStorageOrNull, readonly now: () => number = Date.now) {}
  route(route: IdentificationRoute) {
    const key = JSON.stringify([route.workspace, route.articleVersionId, route.draftId ?? '', route.connectionEpoch ?? 0, route.formScope ?? '']);
    let entry = this.routes.get(key);
    if (!entry) { entry = new ArticleIdentificationRouteStore(this, route, JSON.stringify([this.identity, key])); this.routes.set(key, entry); }
    // Never evict an active route or its in-flight work.
    if (this.routes.size > MAX_RECORDS) for (const [oldKey, old] of this.routes) { if (oldKey !== key && !old.active && !old.pending) this.routes.delete(oldKey); if (this.routes.size <= MAX_RECORDS) break; }
    return entry;
  }
  record(context: IdentificationContext, workspace: string, formScope = ''): RecordState {
    const key = recordKey(context, workspace, formScope);
    let record = this.records.get(key);
    if (record && this.now() - record.updatedAt > IDENTIFICATION_SESSION_TTL && !record.operation) { this.records.delete(key); record = undefined; }
    if (!record) {
      const restored = this.restore(key, context, workspace, formScope);
      record = restored ?? { context, workspace, formScope, fields: emptyFields(), status: 'ready', attempted: false, hydrations: [], updatedAt: this.now() };
      // A new model connection invalidates AI outputs, not the user's same-article input.
      const previous = !restored ? [...this.records.values()].reverse().find(item => item.workspace === workspace && item.formScope === formScope && sameArticle(item.context, context) && this.now() - item.updatedAt <= IDENTIFICATION_SESSION_TTL) ?? this.restorePreviousConnection(context, workspace, formScope) : undefined;
      if (previous) {
        for (const field of identificationFieldKeys) if (previous.fields[field].edited || previous.fields[field].origin === 'saved') record.fields[field] = { ...previous.fields[field], suggestion: undefined, candidate: undefined };
        record.hydrations = [...previous.hydrations];
      }
      this.records.set(key, record);
    }
    record.context = context;
    if (this.records.size > MAX_RECORDS) for (const [oldKey, old] of this.records) { if (oldKey !== key && !old.operation && ![...this.routes.values()].some(route => route.active && route.record === old)) this.records.delete(oldKey); if (this.records.size <= MAX_RECORDS) break; }
    return record;
  }
  changed(record: RecordState, workspace: string) {
    record.updatedAt = this.now();
    record.persisted = this.persist(recordKey(record.context, workspace, record.formScope), record);
    for (const route of this.routes.values()) if (route.record === record) route.refresh();
  }
  private restore(key: string, context: IdentificationContext, workspace: string, formScope: string): RecordState | null {
    const storage = this.storage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(SESSION_PREFIX + key); if (!raw) return null;
      const value = JSON.parse(raw) as RecordState & { key?: string };
      if (value.key !== key || !Number.isFinite(value.updatedAt) || value.updatedAt > this.now() || this.now() - value.updatedAt > IDENTIFICATION_SESSION_TTL
        || typeof value.attempted !== 'boolean' || !Array.isArray(value.hydrations) || !value.hydrations.every(id => typeof id === 'string')
        || !['ready', 'complete', 'partial', 'unidentified', 'failed', 'identifying'].includes(value.status)
        || !value.fields || !identificationFieldKeys.every(field => {
          const item = value.fields[field];
          return item && typeof item.value === 'string' && item.value.length <= 12000 && typeof item.edited === 'boolean'
            && ['article', 'inferred', 'unidentified', 'manual', 'saved'].includes(item.origin)
            && (item.evidence === undefined || typeof item.evidence === 'string') && (item.candidate === undefined || typeof item.candidate === 'string')
            && (item.suggestion === undefined || validField(item.suggestion));
        })) { storage.removeItem(SESSION_PREFIX + key); return null; }
      return { context, workspace, formScope, fields: value.fields, attempted: value.attempted, hydrations: value.hydrations.slice(-24), updatedAt: value.updatedAt, status: value.status === 'identifying' ? 'failed' : value.status, errorMessage: typeof value.errorMessage === 'string' && publicFailureMessages.has(value.errorMessage) ? value.errorMessage : undefined };
    } catch { return null; }
  }
  private restorePreviousConnection(context: IdentificationContext, workspace: string, formScope: string) {
    try {
      const storage = this.storage(); if (!storage) return null;
      const expected = [workspace, context.scopeKey, context.articleId, context.articleVersionId, context.contentDigest];
      let latest: RecordState | null = null;
      // Only inspect a previous connection after its authenticated article identity matches.
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key?.startsWith(SESSION_PREFIX)) keys.push(key.slice(SESSION_PREFIX.length)); }
      for (const key of keys) {
        try {
          const tuple = JSON.parse(key) as unknown[];
          if (!Array.isArray(tuple) || tuple[1] !== formScope || typeof tuple[0] !== 'string') continue;
          const identity = JSON.parse(tuple[0]) as unknown[];
          if (!Array.isArray(identity) || expected.some((value, index) => value !== identity[index])) continue;
          const restored = this.restore(key, context, workspace, formScope);
          if (restored && (!latest || restored.updatedAt > latest.updatedAt)) latest = restored;
        } catch { /* Ignore a malformed unrelated session entry. */ }
      }
      return latest;
    } catch { return null; }
  }
  private persist(key: string, record: RecordState): boolean {
    try {
      const storage = this.storage(); if (!storage) return false;
      storage.setItem(SESSION_PREFIX + key, JSON.stringify({ key, fields: record.fields, attempted: record.attempted, hydrations: record.hydrations.slice(-24), updatedAt: record.updatedAt, status: record.status, errorMessage: record.errorMessage }));
      const entries: Array<{ key: string; updatedAt: number }> = [];
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index); if (!name?.startsWith(SESSION_PREFIX)) continue;
        try { const value = JSON.parse(storage.getItem(name) ?? '{}') as { updatedAt?: number }; entries.push({ key: name, updatedAt: value.updatedAt ?? 0 }); } catch { entries.push({ key: name, updatedAt: 0 }); }
      }
      entries.sort((a, b) => b.updatedAt - a.updatedAt);
      entries.forEach((entry, index) => { if (index >= MAX_RECORDS || this.now() - entry.updatedAt > IDENTIFICATION_SESSION_TTL) storage.removeItem(entry.key); });
      return true;
    } catch { return false; /* Storage restrictions never prevent manual input or identification. */ }
  }
  async identify(record: RecordState, route: IdentificationRoute) {
    if (record.operation || !record.context.connection.available) return record.operation;
    const expected = contextKey(record.context, route.workspace), context = record.context;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 120_000);
    record.attempted = true; record.status = 'identifying'; record.errorMessage = undefined;
    // Set operation before notifying subscribers, so a second caller joins it.
    record.operation = Promise.resolve().then(async () => {
      try {
        const body: IdentifyArticleRequest = { article_version_id: context.articleVersionId, ...(route.draftId ? { draft_id: route.draftId } : {}), content_digest: context.contentDigest, connection_revision: context.connection.revision };
        const response = await this.transport<IdentifyArticleResponse>('/matrix/identify', abort.signal, body);
        if (abort.signal.aborted || !validContext(response.context, context.articleVersionId) || contextKey(response.context, route.workspace) !== expected || !response.context.connection.available
          || !validFields(response.fields) || !['complete', 'partial', 'unidentified'].includes(response.status)) throw new Error('invalid_identification_response');
        record.latestFields = response.fields; applyFields(record, response.fields); record.status = response.status;
      } catch (error) { record.status = 'failed'; record.errorMessage = safeFailureMessage(error, messages.failed, abort.signal.aborted); }
      finally { clearTimeout(timeout); record.operation = undefined; this.changed(record, route.workspace); }
    });
    this.changed(record, route.workspace);
    return record.operation;
  }
  adoptFormScope(source: RecordState, workspace: string, nextScope: string) {
    const key = recordKey(source.context, workspace, nextScope);
    if (source.formScope === nextScope || this.records.has(key)) return;
    const fields = emptyFields();
    for (const field of identificationFieldKeys) fields[field] = { ...source.fields[field], suggestion: source.fields[field].suggestion ? { ...source.fields[field].suggestion } : undefined };
    const next: RecordState = { context: source.context, workspace, formScope: nextScope, fields, status: source.status, attempted: source.attempted, hydrations: [...source.hydrations], updatedAt: this.now(), latestFields: source.latestFields, errorMessage: source.errorMessage };
    this.records.set(key, next);
    if (source.operation) next.operation = source.operation.then(() => {
      if (source.latestFields && source.status !== 'failed') applyFields(next, source.latestFields);
      next.status = source.status; next.errorMessage = source.errorMessage; next.operation = undefined; this.changed(next, workspace);
    });
    this.changed(next, workspace);
  }
}

/** One route never paints another route's state, including the first render before effects. */
export class ArticleIdentificationRouteStore {
  record: RecordState | null = null;
  private listeners = new Set<() => void>();
  private mounts = 0;
  private verified = false;
  private contextOperation: Promise<void> | null = null;
  private manualOperation: Promise<void> | null = null;
  private automatic = false;
  private edits: Partial<IdentificationValues> = {};
  private hydration: PendingHydration | null = null;
  private state: IdentificationSnapshot;
  constructor(private readonly owner: ArticleIdentificationStore, readonly route: IdentificationRoute, readonly token: string) {
    this.state = snapshot(emptyFields(), route.articleVersionId ? 'loading' : 'no_article', null, token);
  }
  get active() { return this.mounts > 0; }
  get pending() { return !!this.contextOperation || !!this.record?.operation; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { for (const listener of this.listeners) listener(); }
  mount = () => {
    this.mounts++;
    if (!this.verified && !this.contextOperation && this.route.articleVersionId) void this.loadContext();
    return () => {
      this.mounts = Math.max(0, this.mounts - 1);
      if (!this.active) {
        // Authorization must be revalidated even when the same route is revisited.
        this.verified = false; this.automatic = false; this.edits = {}; this.hydration = null;
        this.state = snapshot(emptyFields(), this.route.articleVersionId ? 'loading' : 'no_article', null, this.token);
      }
    };
  };
  refresh() {
    if (!this.active || !this.verified || !this.record) return;
    const record = this.record;
    const status = record.context.connection.available ? record.status : 'not_configured';
    this.state = snapshot({ ...record.fields }, status, record.context, this.token, status === 'failed' ? record.errorMessage : undefined, record.persisted === true);
    this.emit();
  }
  setAutomatic = (enabled: boolean) => { this.automatic = enabled; this.maybeIdentify(); };
  private maybeIdentify() { if (this.active && this.verified && this.automatic && !this.manualOperation && this.record && !this.record.attempted && this.record.context.connection.available) void this.owner.identify(this.record, this.route); }
  private async loadContext() {
    if (this.contextOperation || !this.route.articleVersionId) return this.contextOperation;
    const fields = { ...this.state.fields };
    this.verified = false;
    for (const key of identificationFieldKeys) if (this.edits[key] !== undefined) fields[key] = { value: this.edits[key]!, origin: 'manual', edited: true };
    this.state = snapshot(fields, 'loading', null, this.token); this.emit();
    const query = new URLSearchParams({ article_version_id: this.route.articleVersionId });
    if (this.route.draftId) query.set('draft_id', this.route.draftId);
    this.contextOperation = Promise.resolve().then(async () => {
      const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 30_000);
      try {
        const response = await this.owner.transport<IdentificationContextResponse>('/matrix/identify/context?' + query.toString(), abort.signal);
        if (abort.signal.aborted || !validContext(response.context, this.route.articleVersionId) || !validFields(response.fields)
          || !['ready', 'not_configured'].includes(response.status) || (response.status === 'ready') !== response.context.connection.available) throw new Error('invalid_context');
        // Never expose a response resolved while this route is unmounted. The next
        // visit asks the server again; shared model work still retains its own owner.
        if (!this.active) return;
        this.record = this.owner.record(response.context, this.route.workspace, this.route.formScope); this.verified = true;
        applyFields(this.record, response.fields, true);
        if (this.hydration) this.applyHydration(this.hydration);
        for (const key of identificationFieldKeys) if (this.edits[key] !== undefined) this.record.fields[key] = { ...this.record.fields[key], value: this.edits[key]!, origin: 'manual', edited: true, evidence: undefined };
        this.edits = {}; this.hydration = null;
        this.owner.changed(this.record, this.route.workspace); this.maybeIdentify();
      } catch (error) {
        if (!this.active) return;
        this.verified = false;
        this.state = snapshot(this.state.fields, 'failed', null, this.token, safeFailureMessage(error, '稿件信息读取失败，请重试；已保留手动填写内容。', abort.signal.aborted)); this.emit();
      } finally { clearTimeout(timeout); this.contextOperation = null; }
    });
    return this.contextOperation;
  }
  setField = (key: IdentificationFieldKey, value: string) => {
    if (!this.active) return;
    if (this.verified && this.record) {
      this.record.fields[key] = { ...this.record.fields[key], value, origin: 'manual', edited: true, evidence: undefined };
      this.owner.changed(this.record, this.route.workspace);
    } else {
      this.edits[key] = value;
      this.state = snapshot({ ...this.state.fields, [key]: { value, origin: 'manual', edited: true } }, this.state.status, null, this.token, this.state.message); this.emit();
    }
  };
  hydrate = (values: IdentificationValues, hydrationId: string) => {
    if (!this.active || !hydrationId) return;
    if (!this.verified || !this.record) { this.hydration = { values: { ...values }, id: hydrationId }; return; }
    this.applyHydration({ values, id: hydrationId }); this.owner.changed(this.record, this.route.workspace);
  };
  private applyHydration({ values, id }: PendingHydration) {
    if (!this.record || this.record.hydrations.includes(id)) return;
    for (const key of identificationFieldKeys) if (!this.record.fields[key].edited && this.edits[key] === undefined) {
      const current = this.record.fields[key];
      this.record.fields[key] = { value: values[key], origin: 'saved', edited: false,
        suggestion: current.value && current.value !== values[key] && (current.origin === 'article' || current.origin === 'inferred') ? { value: current.value, source: current.origin, evidence: current.evidence } : current.suggestion };
    }
    this.record.hydrations.push(id);
  }
  identify = async () => {
    if (!this.active) return;
    if (this.manualOperation) return this.manualOperation;
    this.manualOperation = Promise.resolve().then(async () => {
      // Every explicit retry/re-identification rereads authorization, digest and
      // connection revision. A 409 therefore cannot keep retrying a stale body.
      await this.loadContext();
      if (!this.active || !this.verified || !this.record) return;
      await this.owner.identify(this.record, this.route);
    }).finally(() => { this.manualOperation = null; });
    return this.manualOperation;
  };
  retry = async () => {
    await this.identify();
  };
  adopt = (key: IdentificationFieldKey) => {
    if (!this.active || !this.verified || !this.record) return;
    const suggested = this.record.fields[key].suggestion; if (suggested?.value == null) return;
    // Adopting a suggestion is an explicit user choice and participates in leave protection.
    this.record.fields[key] = { value: suggested.value, origin: suggested.source, edited: true, evidence: suggested.evidence, candidate: suggested.candidate };
    this.owner.changed(this.record, this.route.workspace);
  };
  adoptFormScope = (nextScope: string) => {
    if (this.active && this.verified && this.record && nextScope) this.owner.adoptFormScope(this.record, this.route.workspace, nextScope);
  };
}

const gatewayStores = new WeakMap<object, ArticleIdentificationStore>();
export function articleIdentificationStoreFor(gateway: object) {
  let store = gatewayStores.get(gateway);
  if (!store) { store = new ArticleIdentificationStore(); gatewayStores.set(gateway, store); }
  return store;
}
