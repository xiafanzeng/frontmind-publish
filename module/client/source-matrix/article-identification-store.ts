import type { IdentificationContext, IdentificationContextResponse, IdentificationField, IdentificationFieldKey, IdentificationFields, IdentifyArticleRequest, IdentifyArticleResponse, IdentificationProvenance, IdentificationIndustrySuggestion } from '../../shared/article-identification';
import { matrixApi } from './api';

export const identificationFieldKeys: IdentificationFieldKey[] = ['product', 'industry', 'audience', 'questions'];
export type IdentificationValues = Record<IdentificationFieldKey, string>;
export interface IdentificationHydrationOptions {
  /** Only persisted explicit-clear metadata may claim an empty saved field. */
  explicitEmpty?: IdentificationFieldKey[];
  provenance?: unknown;
  /** Trusted saved-value remaps; a manual edit always wins. */
  replaceSaved?: IdentificationFieldKey[];
}
export interface IdentificationIndustryCatalog { ids: readonly string[]; version: string }
export type IdentificationStatus = 'no_article' | 'loading' | 'ready' | 'not_configured' | 'identifying' | 'complete' | 'partial' | 'unidentified' | 'failed';
export type IdentificationOrigin = IdentificationField['source'] | 'manual' | 'saved';
export interface IdentificationFieldState {
  value: string;
  origin: IdentificationOrigin;
  edited: boolean;
  evidence?: string;
  candidate?: string;
  suggestion?: IdentificationField;
  reason?: IdentificationField['reason'];
  canonicalId?: string;
  savedEmpty?: boolean;
  /** Saved state must not replace true content provenance. */
  saved?: boolean;
  suggestions?: IdentificationIndustrySuggestion[];
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
  /** Genuine shared recognition, independent of later recommendation-form edits. */
  readonly recognizedIndustry?: IdentificationField | null;
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
  industryCatalog?: { ids: Set<string>; version: string };
};
type PendingHydration = { values: Partial<IdentificationValues>; id: string; options?: IdentificationHydrationOptions };
type RecognitionState = { response?: IdentifyArticleResponse; operation?: Promise<IdentifyArticleResponse>; updatedAt: number };
const SESSION_PREFIX = 'frontmind:article-identification:v1:';
export const IDENTIFICATION_SESSION_TTL = 6 * 60 * 60 * 1000;
const MAX_RECORDS = 24;
const SESSION_SCHEMA = 2;
const fieldReasons = new Set<NonNullable<IdentificationField['reason']>>(['missing', 'invalid_format', 'empty', 'too_long', 'industry_not_in_catalog', 'catalog_unavailable', 'ambiguous_industry', 'evidence_not_verbatim', 'inferred_from_article', 'unsupported_product', 'catalog_changed']);
function safeReason(reason: unknown): IdentificationField['reason'] { return typeof reason === 'string' && fieldReasons.has(reason as NonNullable<IdentificationField['reason']>) ? reason as IdentificationField['reason'] : undefined; }
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
  complete: '识别完成，请核对以下信息。', partial: '部分识别完成，其余字段仍待填写。',
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
function snapshot(fields: IdentificationSnapshot['fields'], status: IdentificationStatus, context: IdentificationContext | null, scopeToken: string, message = messages[status], persisted = false, recognizedIndustry: IdentificationField | null = null): IdentificationSnapshot {
  return { fields, values: valuesOf(fields), status, message, context, scopeToken, hasManualChanges: identificationFieldKeys.some(key => fields[key].edited), persisted, recognizedIndustry };
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
    && (value.candidate === undefined || typeof value.candidate === 'string' && value.candidate.length <= 12000)
    && (value.canonicalId === undefined || typeof value.canonicalId === 'string' && value.canonicalId.length <= 12000)
    && (value.suggestions === undefined || Array.isArray(value.suggestions) && value.suggestions.length <= 5 && value.suggestions.every(item => item && typeof item.id === 'string' && item.id.length <= 128 && typeof item.name === 'string' && item.name.length <= 500));
}
function validFields(fields: IdentificationFields): boolean { return !!fields && identificationFieldKeys.every(key => validField(fields[key])); }
function publicField(field: IdentificationField): IdentificationField { return { value: field.value, source: field.source, evidence: field.evidence, candidate: field.candidate, canonicalId: field.canonicalId, reason: safeReason(field.reason), suggestions: field.suggestions?.map(item => ({ ...item })) }; }
function publicFields(fields: IdentificationFields): IdentificationFields { return { product: publicField(fields.product), industry: publicField(fields.industry), audience: publicField(fields.audience), questions: publicField(fields.questions) }; }
function checkedIndustry(record: RecordState, incoming: IdentificationField): IdentificationField {
  const suggestions = record.industryCatalog ? incoming.suggestions?.filter(item => record.industryCatalog!.ids.has(item.id)) : incoming.suggestions;
  incoming = { ...incoming, suggestions };
  if (incoming.value === null) return incoming;
  const canonical = incoming.canonicalId ?? incoming.value;
  if (!record.industryCatalog || canonical === null) return incoming;
  if (record.industryCatalog.ids.has(canonical)) return { ...incoming, value: canonical, canonicalId: canonical };
  return { value: null, source: 'unidentified', candidate: incoming.candidate ?? incoming.value ?? undefined, reason: 'catalog_changed' };
}
function applyField(record: RecordState, key: IdentificationFieldKey, raw: IdentificationField) {
  const incoming = key === 'industry' ? checkedIndustry(record, raw) : raw;
  const current = record.fields[key];
  if (current.edited || current.saved || current.origin === 'saved') {
    record.fields[key] = { ...current, candidate: incoming.candidate, reason: safeReason(incoming.reason), suggestion: incoming.value !== null && incoming.value !== current.value ? { ...incoming, reason: safeReason(incoming.reason) } : undefined };
  } else {
    record.fields[key] = { value: incoming.value ?? '', origin: incoming.source, edited: false, evidence: incoming.evidence, candidate: incoming.candidate, canonicalId: incoming.canonicalId, reason: safeReason(incoming.reason), suggestions: incoming.suggestions };
  }
}
function applyFields(record: RecordState, fields: IdentificationFields, metadataOnly = false) {
  for (const key of identificationFieldKeys) {
    const incoming = fields[key];
    if (metadataOnly && incoming.value === null) continue;
    applyField(record, key, incoming);
  }
}
function sessionStorageOrNull(): Storage | null { try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; } }

/** Memory is gateway-scoped; persisted state is never read before fresh server authorization. */
export class ArticleIdentificationStore {
  private readonly identity = ++nextGatewayIdentity;
  private records = new Map<string, RecordState>();
  /** Model output is article-owned; editable requirements remain task-owned. */
  private recognitions = new Map<string, RecognitionState>();
  private routes = new Map<string, ArticleIdentificationRouteStore>();
  constructor(readonly transport: IdentificationTransport = matrixApi, private readonly storage: () => Storage | null = sessionStorageOrNull, readonly now: () => number = Date.now) {}
  private boundRecognitions(keep: string) {
    if (this.recognitions.size > MAX_RECORDS) for (const [key, entry] of this.recognitions) { if (key !== keep && !entry.operation) this.recognitions.delete(key); if (this.recognitions.size <= MAX_RECORDS) break; }
  }
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
        for (const field of identificationFieldKeys) if (previous.fields[field].edited || previous.fields[field].saved || previous.fields[field].origin === 'saved') record.fields[field] = { ...previous.fields[field], suggestion: undefined, candidate: undefined };
        record.hydrations = [...previous.hydrations];
      }
      this.records.set(key, record);
    }
    record.context = context;
    const recognitionKey = contextKey(context, workspace);
    if (!this.recognitions.has(recognitionKey)) {
      const ownRecognition = record.attempted && record.latestFields && ['complete', 'partial'].includes(record.status) && identificationFieldKeys.some(field => record!.latestFields![field].value !== null)
        ? { response: { context, fields: publicFields(record.latestFields), status: record.status as 'complete' | 'partial' }, updatedAt: record.updatedAt } : null;
      const recognized = ownRecognition ?? this.restoreRecognition(context, workspace);
      if (recognized) { this.recognitions.set(recognitionKey, recognized); this.boundRecognitions(recognitionKey); }
    }
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
      const value = JSON.parse(raw) as RecordState & { key?: string; schema?: number };
      if (value.key !== key || !Number.isFinite(value.updatedAt) || value.updatedAt > this.now() || this.now() - value.updatedAt > IDENTIFICATION_SESSION_TTL
        || typeof value.attempted !== 'boolean' || !Array.isArray(value.hydrations) || !value.hydrations.every(id => typeof id === 'string')
        || !['ready', 'complete', 'partial', 'unidentified', 'failed', 'identifying'].includes(value.status)
        || value.latestFields !== undefined && !validFields(value.latestFields)
        || !value.fields || !identificationFieldKeys.every(field => {
          const item = value.fields[field];
          return item && typeof item.value === 'string' && item.value.length <= 12000 && typeof item.edited === 'boolean'
            && ['article', 'inferred', 'unidentified', 'manual', 'saved'].includes(item.origin)
            && (item.evidence === undefined || typeof item.evidence === 'string') && (item.candidate === undefined || typeof item.candidate === 'string')
            && (item.suggestion === undefined || validField(item.suggestion))
            && (item.savedEmpty === undefined || typeof item.savedEmpty === 'boolean')
            && (item.saved === undefined || typeof item.saved === 'boolean')
            && (item.suggestions === undefined || validField({ value: null, source: 'unidentified', suggestions: item.suggestions }))
            && (item.canonicalId === undefined || typeof item.canonicalId === 'string');
        })) { storage.removeItem(SESSION_PREFIX + key); return null; }
      let repairedEmpty = false;
      for (const key of identificationFieldKeys) {
        const field = value.fields[key];
        field.reason = safeReason(field.reason);
        if (field.suggestion) field.suggestion.reason = safeReason(field.suggestion.reason);
        // v1 hydration claimed every absent/empty task value as saved. Explicit
        // edits (including clears) and the new savedEmpty marker stay protected.
        if (field.origin === 'saved' && !field.edited && !field.value.trim() && field.savedEmpty !== true) {
          const suggested = field.suggestion;
          value.fields[key] = suggested?.value != null ? { value: suggested.value, origin: suggested.source, edited: false, evidence: suggested.evidence, candidate: suggested.candidate, canonicalId: suggested.canonicalId, reason: safeReason(suggested.reason) } : { value: '', origin: 'unidentified', edited: false };
          repairedEmpty = true;
        }
      }
      return { context, workspace, formScope, fields: value.fields, latestFields: value.latestFields ? publicFields(value.latestFields) : undefined, attempted: repairedEmpty ? false : value.attempted, hydrations: value.schema === SESSION_SCHEMA ? value.hydrations.slice(-96) : [], updatedAt: value.updatedAt, status: value.status === 'identifying' ? 'failed' : value.status, errorMessage: typeof value.errorMessage === 'string' && publicFailureMessages.has(value.errorMessage) ? value.errorMessage : undefined };
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
  private restoreRecognition(context: IdentificationContext, workspace: string): RecognitionState | null {
    try {
      const storage = this.storage(); if (!storage) return null;
      const expected = contextKey(context, workspace), keys: string[] = [];
      for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key?.startsWith(SESSION_PREFIX)) keys.push(key.slice(SESSION_PREFIX.length)); }
      let latest: RecognitionState | null = null;
      // This runs only after fresh server authorization. Match every context
      // dimension, then read only genuine model fields from another task.
      for (const key of keys) {
        try {
          const tuple = JSON.parse(key) as unknown[];
          if (!Array.isArray(tuple) || tuple[0] !== expected || typeof tuple[1] !== 'string') continue;
          const restored = this.restore(key, context, workspace, tuple[1]);
          if (!restored?.attempted || !restored.latestFields || !['complete', 'partial'].includes(restored.status) || !identificationFieldKeys.some(field => restored.latestFields![field].value !== null)) continue;
          if (!latest || restored.updatedAt > latest.updatedAt) latest = { response: { context, fields: publicFields(restored.latestFields), status: restored.status as 'complete' | 'partial' }, updatedAt: restored.updatedAt };
        } catch { /* Ignore unrelated or malformed cache keys. */ }
      }
      return latest;
    } catch { return null; }
  }
  private persist(key: string, record: RecordState): boolean {
    try {
      const storage = this.storage(); if (!storage) return false;
      storage.setItem(SESSION_PREFIX + key, JSON.stringify({ schema: SESSION_SCHEMA, key, fields: record.fields, latestFields: record.latestFields ? publicFields(record.latestFields) : undefined, attempted: record.attempted, hydrations: record.hydrations.slice(-96), updatedAt: record.updatedAt, status: record.status, errorMessage: record.errorMessage }));
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
  private recognize(context: IdentificationContext, route: IdentificationRoute, fresh: boolean): Promise<IdentifyArticleResponse> {
    const key = contextKey(context, route.workspace), existing = this.recognitions.get(key);
    if (existing?.operation) return existing.operation;
    if (!fresh && existing?.response && this.now() - existing.updatedAt <= IDENTIFICATION_SESSION_TTL) return Promise.resolve(existing.response);
    // Explicit re-identification bypasses a prior success; a failed/unknown new
    // attempt must never be stored as a fabricated successful recognition.
    const entry: RecognitionState = { updatedAt: this.now() };
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 120_000);
    entry.operation = Promise.resolve().then(async () => {
      const body: IdentifyArticleRequest = { article_version_id: context.articleVersionId, ...(route.draftId ? { draft_id: route.draftId } : {}), content_digest: context.contentDigest, connection_revision: context.connection.revision };
      const response = await this.transport<IdentifyArticleResponse>('/matrix/identify', abort.signal, body);
      if (abort.signal.aborted || !validContext(response.context, context.articleVersionId) || contextKey(response.context, route.workspace) !== key || !response.context.connection.available
        || !validFields(response.fields) || !['complete', 'partial', 'unidentified'].includes(response.status)) throw new Error('invalid_identification_response');
      const accepted = { ...response, fields: publicFields(response.fields) };
      if (response.status !== 'unidentified' && identificationFieldKeys.some(field => response.fields[field].value !== null)) entry.response = accepted;
      entry.updatedAt = this.now();
      return accepted;
    }).catch(error => { throw new Error(safeFailureMessage(error, messages.failed, abort.signal.aborted)); }).finally(() => { clearTimeout(timeout); entry.operation = undefined; });
    this.recognitions.set(key, entry);
    this.boundRecognitions(key);
    return entry.operation;
  }
  async identify(record: RecordState, route: IdentificationRoute, fresh = false) {
    if (record.operation || !record.context.connection.available) return record.operation;
    const context = record.context;
    record.attempted = true; record.status = 'identifying'; record.errorMessage = undefined;
    // Set operation before notifying subscribers, so a second caller joins it.
    record.operation = Promise.resolve().then(async () => {
      try {
        const response = await this.recognize(context, route, fresh);
        record.context = response.context; record.latestFields = publicFields(response.fields); applyFields(record, response.fields);
        record.status = response.status === 'complete' && response.fields.industry.value !== null && checkedIndustry(record, response.fields.industry).value === null ? 'partial' : response.status;
      } catch (error) { record.status = 'failed'; record.errorMessage = safeFailureMessage(error, messages.failed); }
      finally { record.operation = undefined; this.changed(record, route.workspace); }
    });
    this.changed(record, route.workspace);
    return record.operation;
  }
  adoptFormScope(source: RecordState, workspace: string, nextScope: string) {
    const key = recordKey(source.context, workspace, nextScope);
    if (source.formScope === nextScope || this.records.has(key)) return;
    const fields = emptyFields();
    for (const field of identificationFieldKeys) fields[field] = { ...source.fields[field], suggestion: source.fields[field].suggestion ? { ...source.fields[field].suggestion } : undefined };
    const next: RecordState = { context: source.context, workspace, formScope: nextScope, fields, status: source.status, attempted: source.attempted, hydrations: [...source.hydrations], updatedAt: this.now(), latestFields: source.latestFields, errorMessage: source.errorMessage, industryCatalog: source.industryCatalog };
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
  private hydrations: PendingHydration[] = [];
  private industryCatalog: IdentificationIndustryCatalog | null = null;
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
        this.verified = false; this.automatic = false; this.edits = {}; this.hydrations = [];
        this.state = snapshot(emptyFields(), this.route.articleVersionId ? 'loading' : 'no_article', null, this.token);
      }
    };
  };
  refresh() {
    if (!this.active || !this.verified || !this.record) return;
    const record = this.record;
    const status = record.context.connection.available ? record.status : 'not_configured';
    const industry = record.fields.industry;
    const legacyRecognition = !industry.edited && (industry.origin === 'article' || industry.origin === 'inferred') && industry.value
      ? { value: industry.value, source: industry.origin, evidence: industry.evidence, canonicalId: industry.canonicalId, reason: industry.reason } as IdentificationField
      : industry.suggestion;
    const recognizedIndustry = record.latestFields?.industry ?? legacyRecognition;
    this.state = snapshot({ ...record.fields }, status, record.context, this.token, status === 'failed' ? record.errorMessage : undefined, record.persisted === true, recognizedIndustry ? publicField(recognizedIndustry) : null);
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
        if (this.industryCatalog) this.applyIndustryCatalog(this.industryCatalog);
        for (const hydration of this.hydrations) this.applyHydration(hydration);
        for (const key of identificationFieldKeys) if (this.edits[key] !== undefined) this.record.fields[key] = { ...this.record.fields[key], value: this.edits[key]!, origin: 'manual', edited: true, saved: undefined, evidence: undefined, savedEmpty: undefined, canonicalId: undefined, reason: undefined, candidate: undefined, suggestion: undefined, suggestions: undefined };
        this.edits = {}; this.hydrations = [];
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
      this.record.fields[key] = { ...this.record.fields[key], value, origin: 'manual', edited: true, saved: undefined, evidence: undefined, savedEmpty: undefined, canonicalId: undefined, reason: undefined, candidate: undefined, suggestion: undefined, suggestions: undefined };
      this.owner.changed(this.record, this.route.workspace);
    } else {
      this.edits[key] = value;
      this.state = snapshot({ ...this.state.fields, [key]: { value, origin: 'manual', edited: true } }, this.state.status, null, this.token, this.state.message); this.emit();
    }
  };
  hydrate = (values: Partial<IdentificationValues>, hydrationId: string, options?: IdentificationHydrationOptions) => {
    if (!this.active || !hydrationId) return;
    if (!this.verified || !this.record) { this.hydrations.push({ values: { ...values }, id: hydrationId, options }); return; }
    if (this.applyHydration({ values, id: hydrationId, options })) this.owner.changed(this.record, this.route.workspace);
  };
  private applyHydration({ values, id, options }: PendingHydration) {
    if (!this.record) return false;
    let changed = false;
    for (const key of identificationFieldKeys) {
      const value = values[key], stamp = JSON.stringify([id, key]);
      if (typeof value !== 'string' || this.record.hydrations.includes(stamp) || this.record.fields[key].edited || this.edits[key] !== undefined) continue;
      const explicitEmpty = options?.explicitEmpty?.includes(key) === true && !value.trim();
      // An absent, historical or unresolved empty is not a saved user choice.
      // In particular, a late missing-industry hydration cannot erase AI output.
      if (!value.trim() && !explicitEmpty && !readIdentificationProvenance(options?.provenance, key, value)?.explicitEmpty) continue;
      const current = this.record.fields[key];
      if (current.savedEmpty === true) continue;
      if ((current.saved || current.origin === 'saved') && !options?.replaceSaved?.includes(key)) continue;
      const metadata = readIdentificationProvenance(options?.provenance, key, value);
      const sameKnownValue = current.value === value && (current.origin === 'article' || current.origin === 'inferred' || current.origin === 'manual');
      this.record.fields[key] = { value, origin: metadata?.origin ?? (sameKnownValue ? current.origin : 'saved'), edited: metadata?.protected === true, saved: true, savedEmpty: explicitEmpty || metadata?.explicitEmpty || undefined,
        suggestion: current.value && current.value !== value && (current.origin === 'article' || current.origin === 'inferred') ? { value: current.value, source: current.origin, evidence: current.evidence, canonicalId: current.canonicalId, reason: current.reason } : current.suggestion };
      this.record.hydrations.push(stamp);
      changed = true;
    }
    return changed;
  }
  /** Root supplies only trusted, non-ambiguous legacy identity mappings. */
  remapIndustry = (fromId: string, toId: string) => {
    if (!this.active || !this.verified || !this.record || !fromId || !toId || fromId === toId) return;
    const field = this.record.fields.industry;
    let changed = false;
    if (field.value === fromId) { this.record.fields.industry = { ...field, value: toId, canonicalId: toId }; changed = true; }
    const suggestion = this.record.fields.industry.suggestion;
    if (suggestion && (suggestion.value === fromId || suggestion.canonicalId === fromId)) { this.record.fields.industry = { ...this.record.fields.industry, suggestion: { ...suggestion, value: toId, canonicalId: toId } }; changed = true; }
    const latest = this.record.latestFields?.industry;
    if (latest && (latest.value === fromId || latest.canonicalId === fromId)) { this.record.latestFields = { ...this.record.latestFields!, industry: { ...latest, value: toId, canonicalId: toId } }; changed = true; }
    if (changed) this.owner.changed(this.record, this.route.workspace);
  };
  setIndustryCatalog = (catalog: IdentificationIndustryCatalog) => {
    this.industryCatalog = { ids: [...catalog.ids], version: catalog.version };
    if (!this.active || !this.verified || !this.record) return;
    const previous = this.record.industryCatalog;
    if (previous?.version === catalog.version && previous.ids.size === catalog.ids.length && catalog.ids.every(id => previous.ids.has(id))) return;
    this.applyIndustryCatalog(this.industryCatalog); this.owner.changed(this.record, this.route.workspace);
  };
  private applyIndustryCatalog(catalog: IdentificationIndustryCatalog) {
    if (!this.record) return;
    this.record.industryCatalog = { ids: new Set(catalog.ids), version: catalog.version };
    const field = this.record.fields.industry;
    // Revalidate AI output and suggestions, while leaving manual/saved text for
    // the owning page's explicit identity migration or user confirmation.
    if (!field.edited && !field.saved && field.origin !== 'saved' && field.value) {
      applyField(this.record, 'industry', { value: field.value, source: field.origin === 'article' ? 'article' : 'inferred', evidence: field.evidence, candidate: field.candidate, canonicalId: field.canonicalId, reason: field.reason });
      if (!this.record.fields.industry.value && this.record.status === 'complete') this.record.status = 'partial';
    }
    this.record.fields.industry = { ...this.record.fields.industry, suggestions: field.suggestions?.filter(item => catalog.ids.includes(item.id)) };
    const suggestion = this.record.fields.industry.suggestion;
    if (suggestion && checkedIndustry(this.record, suggestion).value === null) this.record.fields.industry = { ...this.record.fields.industry, suggestion: undefined, candidate: suggestion.candidate ?? suggestion.value ?? undefined, reason: 'catalog_changed' };
    // A directory arriving after a failed/empty load can make a prior result
    // usable again; apply only this field and keep manual ownership intact.
    const latest = this.record.latestFields?.industry;
    if (latest?.value && checkedIndustry(this.record, latest).value !== null && !this.record.fields.industry.value && !this.record.fields.industry.edited && !this.record.fields.industry.saved && this.record.fields.industry.origin !== 'saved') applyField(this.record, 'industry', latest);
  }
  identify = async () => {
    if (!this.active) return;
    if (this.manualOperation) return this.manualOperation;
    this.manualOperation = Promise.resolve().then(async () => {
      // Every explicit retry/re-identification rereads authorization, digest and
      // connection revision. A 409 therefore cannot keep retrying a stale body.
      await this.loadContext();
      if (!this.active || !this.verified || !this.record) return;
      await this.owner.identify(this.record, this.route, true);
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
    if (key === 'industry' && checkedIndustry(this.record, suggested).value === null) return;
    this.record.fields[key] = { value: suggested.value, origin: suggested.source, edited: true, evidence: suggested.evidence, candidate: suggested.candidate, canonicalId: suggested.canonicalId, reason: safeReason(suggested.reason) };
    this.owner.changed(this.record, this.route.workspace);
  };
  adoptIndustry = (id: string) => {
    if (!this.active || !this.verified || !this.record || !this.industryCatalog?.ids.includes(id)) return false;
    const field = this.record.fields.industry;
    if (field.value === id) return true;
    if (field.value || field.edited || field.saved || !field.suggestions?.some(option => option.id === id)) return false;
    this.record.fields.industry = { value: id, canonicalId: id, origin: 'inferred', edited: true };
    this.owner.changed(this.record, this.route.workspace);
    return true;
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

export function readIdentificationProvenance(input: unknown, key: IdentificationFieldKey, value: string): IdentificationProvenance[IdentificationFieldKey] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const entry = (input as Record<string, unknown>)[key];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
  const row = entry as Record<string, unknown>;
  if (row.value !== value || !['article', 'inferred', 'manual'].includes(String(row.origin))) return;
  return { value, origin: row.origin as 'article' | 'inferred' | 'manual', protected: row.protected === true || row.origin === 'manual', explicitEmpty: row.explicitEmpty === true && !value.trim() };
}
export function identificationProvenance(fields: IdentificationSnapshot['fields']): IdentificationProvenance {
  const result: IdentificationProvenance = {};
  for (const key of identificationFieldKeys) {
    const field = fields[key];
    if (field.origin === 'article' || field.origin === 'inferred' || field.origin === 'manual') result[key] = {
      value: key === 'questions' ? field.value.split('\n').map(value => value.trim()).filter(Boolean).join('\n') : field.value,
      origin: field.origin, protected: field.edited, explicitEmpty: !field.value.trim() && field.edited || undefined,
    };
  }
  return result;
}
