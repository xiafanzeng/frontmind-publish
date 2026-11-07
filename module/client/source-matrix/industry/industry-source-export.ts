import type { IndustryCommonQuery, IndustryContent, IndustryMedia, IndustryPage } from '../../../contracts/industry-source';
import { IndustryRequestError, industryRequest, newIndustryRequestId, ratioText, type IndustryQuery } from './industry-source-client';
import type { ContentSelection, IndustryState } from './industry-source-store';

export const CITATION_EXPORT_LIMIT = 1000;
const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_PAGES = 10;
type CitationRow = IndustryMedia | IndustryContent;
type ExportPage<T> = Readonly<Omit<IndustryPage<T>, 'items'> & { items: readonly Readonly<T>[]; fetchedAt: string | null }>;
export interface CitationExportSnapshot {
  readonly common: Readonly<IndustryCommonQuery>;
  readonly selection: Readonly<ContentSelection>;
  /** Only an already available, matching first-50 ranking; never fetched for export. */
  readonly media: ExportPage<IndustryMedia> | null;
  readonly contents: ExportPage<IndustryContent>;
  readonly exportedAt: string;
}
export type CitationExportProgress = { loaded: number; target: number; requests: number };
type Operation = { query: IndustryQuery; createdAt: number };
const invalid = (message: string) => new Error(`${message}未生成导出文件。`);
const cancelled = () => { const error = new Error('导出已取消。'); error.name = 'AbortError'; return error; };
const month = (time: number) => new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
export const sameExportCommon = (a: IndustryCommonQuery | null, b: IndustryCommonQuery | null) => Boolean(a && b && a.periodType === b.periodType && a.date === b.date && a.scopeType === b.scopeType && a.scopeId === b.scopeId && a.modelCode === b.modelCode);
const sameSelection = (a: ContentSelection, b: ContentSelection) => a.media === b.media && a.sourceType === b.sourceType && a.sortBy === b.sortBy && a.sortOrder === b.sortOrder;
function integer(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(value)) throw invalid('返回的数量格式无效，');
  const result = BigInt(value);
  if (result > 9223372036854775807n) throw invalid('返回的数量超出有效范围，');
  return result;
}
const token = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096 && value.trim().length > 0;
function validatePage(page: IndustryPage<CitationRow> | ExportPage<CitationRow>, kind: 'media' | 'contents', size: number): bigint {
  if (!page || !Number.isInteger(page.pageSize) || page.pageSize !== size || size < 1 || size > 100) throw invalid('分页大小发生变化，');
  const total = integer(page.total); integer(page.totalCitations);
  if (!token(page.snapshotToken) || !(page.nextCursor === null || token(page.nextCursor)) || integer(page.expiresAt) === 0n || !Array.isArray(page.items)) throw invalid('分页会话或记录格式无效，');
  if (BigInt(page.items.length) > total) throw invalid('记录数超过真实总数，');
  const keys = new Set<string>();
  for (const row of page.items) {
    if (!row || typeof row !== 'object') throw invalid('记录格式无效，');
    const key = kind === 'media' ? (row as IndustryMedia).code : (row as IndustryContent).linkId;
    if (!token(key) || keys.has(key)) throw invalid('记录标识缺失或重复，');
    keys.add(key); integer(row.citationCount);
    if (kind === 'contents') {
      const content = row as IndustryContent;
      integer(content.sequence);
      if (typeof content.title !== 'string' || typeof content.media !== 'string' || typeof content.sourceType !== 'string' || typeof content.citationRatio !== 'string'
        || !/^\d+(?:\.\d+)?$/.test(content.citationRatio) || ![content.url, content.icon, content.publishTime].every(value => value === null || typeof value === 'string')) throw invalid('内容字段无效，');
    } else if (typeof (row as IndustryMedia).name !== 'string') throw invalid('媒体字段无效，');
  }
  return total;
}
const validSession = (page: IndustryPage<CitationRow>) => integer(page.expiresAt) > BigInt(Date.now());
const copyPage = <T extends CitationRow,>(page: IndustryPage<T>, fetchedAt: string | null, limit: number): ExportPage<T> => Object.freeze({ ...page, items: Object.freeze(page.items.slice(0, limit).map(row => Object.freeze({ ...row } as T))), fetchedAt });

/** The entry remains disabled while either lane is unresolved or blocked. */
export function citationExportStatus(state: IndustryState): { available: boolean } {
  try {
    if (state.blocked || !state.common) return { available: false };
    for (const kind of ['media', 'contents'] as const) {
      const lane = state[kind];
      if (lane.loading || lane.error || !lane.data) return { available: false };
      validatePage(lane.data, kind, kind === 'media' ? state.mediaSize : state.contentSize);
    }
    return { available: integer(state.media.data!.total) + integer(state.contents.data!.total) > 0n };
  } catch { return { available: false }; }
}

/**
 * One explicit export owns separate paging state. Nothing is appended to the UI store.
 * A partial 20-row cache cannot be continued with pageSize 100: start a separate
 * 100-row snapshot instead. Complete matching caches can be exported without a call.
 * A failed operation is retained for an explicit same-ID retry (600 s / same month).
 */
export class CitationExportSession {
  readonly common: Readonly<IndustryCommonQuery>;
  readonly selection: Readonly<ContentSelection>;
  private media: ExportPage<IndustryMedia> | null = null;
  private completeCache: ExportPage<IndustryContent> | null = null;
  private completed: CitationExportSnapshot | null = null;
  private page: IndustryPage<IndustryContent> | null = null;
  private items: IndustryContent[] = [];
  private seenIds = new Set<string>();
  private seenCursors = new Set<string>();
  private pending: Operation | null = null;
  private fetchedAt: string | null = null;
  private pages = 0;
  private busy = false;
  private failure: unknown = null;
  constructor(state: IndustryState, common: IndustryCommonQuery, selection: ContentSelection, private readonly transport: typeof industryRequest = industryRequest) {
    if (state.blocked) throw new IndustryRequestError(state.blocked);
    this.common = Object.freeze({ ...common }); this.selection = Object.freeze({ ...selection });
    if (sameExportCommon(state.common, common) && state.media.data && !state.media.loading && !state.media.error) {
      const page = state.media.data;
      validatePage(page, 'media', state.mediaSize);
      if (validSession(page)) this.media = copyPage(page, state.media.fetchedAt, 50);
    }
    if (sameExportCommon(state.common, common) && sameSelection(state.selection, selection) && state.contents.data && !state.contents.loading && !state.contents.error) {
      const page = state.contents.data, total = validatePage(page, 'contents', state.contentSize);
      if (validSession(page) && BigInt(page.items.length) === total && page.nextCursor === null && total <= BigInt(CITATION_EXPORT_LIMIT)) this.completeCache = copyPage(page, state.contents.fetchedAt, CITATION_EXPORT_LIMIT);
    }
  }
  get canRetry(): boolean {
    return this.failure instanceof IndustryRequestError && this.failure.failure.retryable && Boolean(this.pending)
      && Date.now() - this.pending!.createdAt < 600_000 && month(this.pending!.createdAt) === month(Date.now());
  }
  get hasFailed(): boolean { return this.failure !== null; }
  private snapshot(contents: ExportPage<IndustryContent>): CitationExportSnapshot {
    if (!contents.items.length) throw invalid('当前导出条件没有引用内容，');
    this.completed = Object.freeze({ common: this.common, selection: this.selection, media: this.media, contents, exportedAt: new Date().toISOString() });
    return this.completed;
  }
  private request(operation: Operation, signal: AbortSignal): ReturnType<typeof industryRequest<IndustryPage<IndustryContent>>> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const abort = () => { controller.abort(); cleanup(); reject(cancelled()); };
      const timer = setTimeout(() => {
        controller.abort(); cleanup();
        reject(new IndustryRequestError({ status: 'timeout', message: '等待导出分页超时，可重试本次请求。', httpStatus: 504, retryable: true }));
      }, 75_000);
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      this.transport<IndustryPage<IndustryContent>>('contents', operation.query, controller.signal).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }
  async collect(signal: AbortSignal, progress?: (value: CitationExportProgress) => void): Promise<CitationExportSnapshot> {
    if (signal.aborted) throw cancelled();
    if (this.busy) throw invalid('导出正在进行，');
    if (this.failure && !this.canRetry) throw invalid('本次导出会话不能继续，请重新导出；');
    this.busy = true;
    try {
      // A local download failure may retry the already complete file without another paid query.
      if (this.completed) return this.completed;
      if (this.completeCache) {
        if (integer(this.completeCache.expiresAt) <= BigInt(Date.now())) throw invalid('缓存会话已过期，请重新导出；');
        progress?.({ loaded: this.completeCache.items.length, target: this.completeCache.items.length, requests: 0 });
        if (signal.aborted) throw cancelled();
        return this.snapshot(this.completeCache);
      }
      while (true) {
        if (signal.aborted) throw cancelled();
        const previous = this.page;
        if (previous && integer(previous.expiresAt) <= BigInt(Date.now())) throw invalid('导出会话已过期，请重新导出；');
        if (!this.pending) {
          if (this.pages >= MAX_EXPORT_PAGES) throw invalid('接口返回的条数不足，无法在 10 页内取得完整的前 1000 条，请缩小范围；');
          if (previous && (!previous.nextCursor || this.seenCursors.has(previous.nextCursor))) throw invalid('分页游标重复或缺失，');
          this.pending = { query: { ...this.common, pageSize: EXPORT_PAGE_SIZE,
            ...(this.selection.media ? { media: this.selection.media } : {}), ...(this.selection.sourceType ? { sourceType: this.selection.sourceType } : {}),
            sortBy: this.selection.sortBy, sortOrder: this.selection.sortOrder,
            ...(previous ? { snapshotToken: previous.snapshotToken, cursor: previous.nextCursor! } : {}), requestId: newIndustryRequestId() }, createdAt: Date.now() };
        }
        const operation = this.pending;
        if (Date.now() - operation.createdAt >= 600_000 || month(operation.createdAt) !== month(Date.now())) throw invalid('本次请求的重试期限已过，请重新导出；');
        const result = await this.request(operation, signal);
        if (signal.aborted) throw cancelled();
        const page = result.data, total = validatePage(page, 'contents', EXPORT_PAGE_SIZE);
        if (page.items.length > EXPORT_PAGE_SIZE || page.items.length === 0 && total > 0n) throw invalid('分页没有有效记录，');
        if (integer(page.expiresAt) <= BigInt(Date.now())) throw invalid('导出会话已过期，请重新导出；');
        if (previous && (page.snapshotToken !== previous.snapshotToken || page.total !== previous.total || page.totalCitations !== previous.totalCitations)) throw invalid('导出会话或统计口径发生变化，');
        if (page.nextCursor && (page.nextCursor === operation.query.cursor || this.seenCursors.has(page.nextCursor))) throw invalid('分页游标重复，');
        for (const row of page.items) if (this.seenIds.has(row.linkId)) throw invalid('不同分页出现重复内容，');
        const loaded = this.items.length + page.items.length;
        if (BigInt(loaded) > total || loaded > CITATION_EXPORT_LIMIT || page.nextCursor === null && BigInt(loaded) !== total || page.nextCursor !== null && BigInt(loaded) >= total) throw invalid('分页数量与真实总数不一致，');
        // Commit only after the entire response has passed validation.
        page.items.forEach(row => this.seenIds.add(row.linkId));
        if (operation.query.cursor) this.seenCursors.add(String(operation.query.cursor));
        this.items.push(...page.items); this.page = page; this.fetchedAt = result.fetchedAt; this.pending = null; this.failure = null; this.pages += 1;
        const target = total > BigInt(CITATION_EXPORT_LIMIT) ? CITATION_EXPORT_LIMIT : Number(total);
        progress?.({ loaded, target, requests: this.pages });
        if (signal.aborted) throw cancelled();
        if (loaded === target) return this.snapshot(copyPage({ ...page, items: this.items }, this.fetchedAt, CITATION_EXPORT_LIMIT));
        if (!page.nextCursor) throw invalid('分页提前结束，');
      }
    } catch (error) {
      this.failure = error;
      throw error;
    } finally { this.busy = false; }
  }
}

function csvCell(value: string | null | undefined): string {
  let text = value ?? '';
  // CSV quoting does not prevent formulas or Excel's 15-digit numeric coercion.
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text) || /^\d{16,}$/.test(text) || /^0\d+$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function citationExportCsv(snapshot: CitationExportSnapshot, commonLabel: string, mediaLabel: string): string {
  const { common, selection, media, contents } = snapshot;
  const total = validatePage(contents, 'contents', contents.pageSize);
  const target = total > BigInt(CITATION_EXPORT_LIMIT) ? CITATION_EXPORT_LIMIT : Number(total);
  if (!target || contents.items.length !== target || total <= BigInt(CITATION_EXPORT_LIMIT) && contents.nextCursor !== null) throw invalid('导出数量不完整，');
  const rows: Array<Array<string | null | undefined>> = [
    ['行业信源引用数据'], ['导出时间', snapshot.exportedAt], ['共同筛选范围', commonLabel],
    ['周期', common.periodType], ['日期', common.date], ['行业范围类型', common.scopeType], ['行业范围标识', common.scopeId], ['模型标识', common.modelCode],
    ['导出边界', total > BigInt(CITATION_EXPORT_LIMIT) ? '引用内容前 1000 条，非全量' : `当前条件下的 ${target} 条引用内容（上限 1000 条）`],
    ['大整数', '超过 15 位的数字及前导零标识用文本前缀保护精度'],
  ];
  if (media) {
    validatePage(media, 'media', media.pageSize);
    rows.push([], ['媒体排行'], ['范围', `共同筛选范围下已缓存的前 ${media.items.length} 个媒体，最多 50 个；不应用内容媒体、类型与排序筛选`],
      ['媒体记录总数', media.total], ['媒体引用总次数', media.totalCitations], ['数据读取时间', media.fetchedAt],
      ['序号', '媒体原始标识', '媒体名称', '引用次数', '引用占比（%）'],
      ...media.items.map((row, index) => [String(index + 1), row.code, row.name, row.citationCount, integer(media.totalCitations) > 0n ? ratioText(row.citationCount, media.totalCitations) : '—']));
  }
  rows.push([], ['内容明细'], ['范围', '共同筛选范围及以下内容筛选'], ['媒体筛选', mediaLabel], ['媒体原始标识', selection.media], ['来源类型', selection.sourceType || '全部类型'], ['排序字段', selection.sortBy], ['排序方向', selection.sortOrder],
    ['内容记录总数', contents.total], ['本文件内容条数', String(contents.items.length)], ['内容引用总次数', contents.totalCitations], ['数据读取时间', contents.fetchedAt],
    ['序号', '内容原始标识', '标题', '原始链接', '图标链接', '媒体', '来源类型', '发布时间', '引用次数', '引用占比（%）'],
    ...contents.items.map(row => [row.sequence, row.linkId, row.title, row.url, row.icon, row.media, row.sourceType, row.publishTime, row.citationCount, row.citationRatio]));
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function downloadCitationCsv(csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement('a'); anchor.href = url; anchor.download = 'FrontMind-行业信源引用数据.csv'; anchor.hidden = true;
    document.body.appendChild(anchor); anchor.click();
  } finally { anchor?.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
