import type { IndustryCommonQuery, IndustryContent, IndustryMedia, IndustryPage } from '../../../contracts/industry-source';
import type { ContentSelection, IndustrySourceStore, IndustryState, ListKind } from './industry-source-store';

type CitationRow = IndustryMedia | IndustryContent;
type ReadablePage<T> = Readonly<Omit<IndustryPage<T>, 'items'> & { items: readonly Readonly<T>[] }>;
type ExportPage<T> = ReadablePage<T> & { readonly fetchedAt: string | null };
export interface CitationExportSnapshot {
  readonly common: Readonly<IndustryCommonQuery>;
  readonly selection: Readonly<ContentSelection>;
  readonly media: ExportPage<IndustryMedia>;
  readonly contents: ExportPage<IndustryContent>;
  readonly exportedAt: string;
}

const lanes = ['media', 'contents'] as const;
const label = (kind: ListKind) => kind === 'media' ? '媒体' : '内容';
const invalid = (message: string) => new Error(`${message}未生成导出文件。`);
const cancelled = () => { const error = new Error('导出已取消。'); error.name = 'AbortError'; return error; };
const identity = (item: Readonly<CitationRow>, kind: ListKind): string => kind === 'media' ? (item as IndustryMedia).code : (item as IndustryContent).linkId;

function integer(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(value)) throw invalid('返回的数量格式无效，');
  const number = BigInt(value);
  if (number > 9223372036854775807n) throw invalid('返回的数量超出有效范围，');
  return number;
}
function token(value: unknown): value is string { return typeof value === 'string' && value.length <= 4096 && value.trim().length > 0; }

/** Counts remain strings; no int64 count is ever converted through Number. */
function validatePage(page: ReadablePage<CitationRow>, kind: ListKind, expectedSize: number, inspectRows = true): bigint {
  if (!Number.isInteger(page.pageSize) || page.pageSize < 1 || page.pageSize > 100 || page.pageSize !== expectedSize) throw invalid(`${label(kind)}分页大小发生变化，`);
  const total = integer(page.total); integer(page.totalCitations);
  // An Array cannot represent a larger complete result. This is not a row truncation limit.
  if (total > 4294967295n) throw invalid(`${label(kind)}记录总数超过浏览器数组容量，请缩小筛选范围后重试；`);
  if (!token(page.snapshotToken) || !(page.nextCursor === null || token(page.nextCursor)) || integer(page.expiresAt) === 0n) throw invalid(`${label(kind)}分页会话或游标无效，`);
  if (!Array.isArray(page.items)) throw invalid(`${label(kind)}记录格式无效，`);
  const loaded = BigInt(page.items.length);
  if (loaded > total || (page.nextCursor === null && loaded !== total) || (page.nextCursor !== null && loaded >= total)) throw invalid(`${label(kind)}记录数量与完整分页结果不一致，`);
  if (inspectRows) {
    const unique = new Set<string>();
    for (const row of page.items) {
      if (!row || typeof row !== 'object') throw invalid(`${label(kind)}记录格式无效，`);
      const key = identity(row, kind);
      if (typeof key !== 'string' || !key.trim() || unique.has(key)) throw invalid(`${label(kind)}记录标识缺失或重复，`);
      unique.add(key); integer(row.citationCount);
      if (kind === 'contents') integer((row as IndustryContent).sequence);
    }
  }
  return total;
}

function requireReady(state: IndustryState) {
  if (state.blocked) throw invalid(`${state.blocked.message} `);
  if (!state.common) throw invalid('请先完成当前查询，');
  for (const kind of lanes) {
    const section = state[kind];
    if (section.error) throw invalid(`${section.error.message} `);
    if (section.loading || !section.data) throw invalid(`请等待${label(kind)}数据加载完成，`);
    validatePage(section.data, kind, kind === 'media' ? state.mediaSize : state.contentSize);
  }
}

export function citationExportStatus(state: IndustryState): { available: boolean; additionalPages: string } {
  try {
    requireReady(state);
    let remainingPages = 0n, totalRows = 0n;
    for (const kind of lanes) {
      const page = state[kind].data!;
      const total = integer(page.total), remaining = total - BigInt(page.items.length), size = BigInt(page.pageSize);
      remainingPages += (remaining + size - 1n) / size;
      totalRows += total;
    }
    return { available: totalRows > 0n, additionalPages: remainingPages.toString() };
  } catch { return { available: false, additionalPages: '—' }; }
}

/**
 * Completes the already-open sessions through the store's public paging method.
 * The caller confirms additional quota first. Abort stops collection, while any
 * already-issued operation remains owned by the store (including its retry ID).
 */
export async function collectCitationExport(store: IndustrySourceStore, signal: AbortSignal): Promise<CitationExportSnapshot> {
  if (signal.aborted) throw cancelled();
  const initial = store.getSnapshot(); requireReady(initial);
  const common = initial.common!, selection = initial.selection;
  const commonCopy = Object.freeze({ ...common }), selectionCopy = Object.freeze({ ...selection });
  const commonKey = JSON.stringify(commonCopy), selectionKey = JSON.stringify(selectionCopy);
  const initialPages = { media: initial.media.data!, contents: initial.contents.data! };
  const sizes = { media: initial.mediaSize, contents: initial.contentSize };
  const seen = { media: new Set<string>(), contents: new Set<string>() };
  let failure: Error | null = null;
  const waiter: { wake: (() => void) | null } = { wake: null };

  const assertLive = () => {
    if (failure) throw failure;
    if (signal.aborted) throw cancelled();
    const current = store.getSnapshot();
    if (current.common !== common || current.selection !== selection || JSON.stringify(current.common) !== commonKey || JSON.stringify(current.selection) !== selectionKey || current.mediaSize !== sizes.media || current.contentSize !== sizes.contents) throw invalid('查询筛选或分页设置已变化，请重新导出；');
    if (current.blocked) throw invalid(`${current.blocked.message} `);
    for (const kind of lanes) {
      const section = current[kind], captured = initialPages[kind], page = section.data;
      if (section.error) throw invalid(`${section.error.message} `);
      if (!page || page.snapshotToken !== captured.snapshotToken || page.pageSize !== captured.pageSize) throw invalid(`${label(kind)}查询会话已变化，请重新导出；`);
      if (page.total !== captured.total || page.totalCitations !== captured.totalCitations) throw invalid(`${label(kind)}查询总数发生变化，请重新查询后导出；`);
      validatePage(page, kind, sizes[kind], false);
    }
    return current;
  };
  // Observe every intermediate update: refresh/restart may clear a lane and then
  // restore identical values before an awaiting collector gets its next turn.
  const observe = () => {
    try { assertLive(); } catch (error) { failure ??= error instanceof Error ? error : invalid('导出查询已失效，'); }
    waiter.wake?.();
  };
  const unsubscribe = store.subscribe(observe);
  signal.addEventListener('abort', observe, { once: true });

  const waitForPage = async (kind: ListKind) => {
    const deadline = Date.now() + 75_000;
    while (assertLive()[kind].loading) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw invalid('等待分页响应超时，请等待本次查询结束后重试；');
      await new Promise<void>((resolve, reject) => {
        const changed = () => { clearTimeout(timer); if (waiter.wake === changed) waiter.wake = null; resolve(); };
        // The transport owns a 70 s timeout. This also settles a disposed store
        // that cannot notify again; it does not retry or replace its operation.
        const timer = setTimeout(() => { if (waiter.wake === changed) waiter.wake = null; reject(invalid('等待分页响应超时，请等待本次查询结束后重试；')); }, remaining);
        waiter.wake = changed;
        if (failure || signal.aborted || !store.getSnapshot()[kind].loading) changed();
      });
    }
  };

  try {
    assertLive();
    for (const kind of lanes) {
      // Every successful request must add at least one unique row. This finite
      // bound follows the captured total and never silently truncates the export.
      let remainingRequests = integer(initialPages[kind].total) - BigInt(initialPages[kind].items.length);
      while (true) {
        const before = assertLive()[kind].data!;
        validatePage(before, kind, sizes[kind]);
        if (before.nextCursor === null) break;
        if (integer(before.expiresAt) <= BigInt(Date.now())) throw invalid(`${label(kind)}查询会话已过期，请重新查询后导出；`);
        if (seen[kind].has(before.nextCursor) || remainingRequests <= 0n) throw invalid(`${label(kind)}分页游标重复或未能完成，`);
        seen[kind].add(before.nextCursor); remainingRequests -= 1n;
        store.more(kind);
        await waitForPage(kind);
        const after = assertLive()[kind].data!;
        validatePage(after, kind, sizes[kind]);
        const added = after.items.length - before.items.length;
        if (after === before || added <= 0 || added > before.pageSize) throw invalid(`${label(kind)}分页没有有效进展，`);
        for (let index = 0; index < before.items.length; index += 1) {
          if (JSON.stringify(before.items[index]) !== JSON.stringify(after.items[index])) throw invalid(`${label(kind)}已加载记录发生变化，请重新查询后导出；`);
        }
      }
    }
    const finalState = assertLive();
    // Object.freeze widens a generic spread to an index signature; keep the row type explicit.
    const copyRow = <T extends CitationRow,>(row: T): Readonly<T> => Object.freeze({ ...row } as T);
    const copyPage = <T extends CitationRow,>(page: IndustryPage<T>, fetchedAt: string | null): ExportPage<T> => Object.freeze({ ...page, items: Object.freeze(page.items.map(row => copyRow(row))), fetchedAt });
    return Object.freeze({ common: commonCopy, selection: selectionCopy, media: copyPage(finalState.media.data!, finalState.media.fetchedAt), contents: copyPage(finalState.contents.data!, finalState.contents.fetchedAt), exportedAt: new Date().toISOString() });
  } finally {
    unsubscribe(); signal.removeEventListener('abort', observe); waiter.wake?.(); waiter.wake = null;
  }
}

function csvCell(value: string | null | undefined): string {
  let text = value ?? '';
  // Quoting alone does not stop spreadsheet formulas, including those hidden
  // behind spaces or control characters. Apply this to metadata and row fields.
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function citationExportCsv(snapshot: CitationExportSnapshot, commonLabel: string, mediaLabel: string): string {
  for (const kind of lanes) {
    const page = snapshot[kind]; validatePage(page, kind, page.pageSize);
    if (page.nextCursor !== null) throw invalid(`${label(kind)}分页尚未完整，`);
  }
  const { common, selection, media, contents } = snapshot;
  const rows: Array<Array<string | null | undefined>> = [
    ['行业信源完整引用数据'], ['导出时间', snapshot.exportedAt], ['共同筛选范围', commonLabel],
    ['周期', common.periodType], ['日期', common.date], ['行业范围类型', common.scopeType], ['行业范围标识', common.scopeId], ['模型标识', common.modelCode],
    [], ['媒体排行'], ['范围', '共同筛选范围；不应用内容栏的媒体、来源类型和排序筛选'],
    ['媒体记录总数', media.total], ['媒体引用总次数', media.totalCitations], ['数据读取时间', media.fetchedAt],
    ['序号', '媒体原始标识', '媒体名称', '引用次数'],
    ...media.items.map((row, index) => [String(index + 1), row.code, row.name, row.citationCount]),
    [], ['内容明细'], ['范围', '共同筛选范围及以下内容筛选'], ['媒体筛选', mediaLabel], ['媒体原始标识', selection.media], ['来源类型', selection.sourceType], ['排序字段', selection.sortBy], ['排序方向', selection.sortOrder],
    ['内容记录总数', contents.total], ['内容引用总次数', contents.totalCitations], ['数据读取时间', contents.fetchedAt],
    ['序号', '内容原始标识', '标题', '原始链接', '图标链接', '媒体', '来源类型', '发布时间', '引用次数', '引用占比（%）'],
    ...contents.items.map(row => [row.sequence, row.linkId, row.title, row.url, row.icon, row.media, row.sourceType, row.publishTime, row.citationCount, row.citationRatio]),
  ];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCitationCsv(csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement('a'); anchor.href = url; anchor.download = 'FrontMind-行业信源完整引用数据.csv'; anchor.hidden = true;
    document.body.appendChild(anchor); anchor.click();
  } finally { anchor?.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
