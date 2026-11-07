import { ArrowDown, ArrowUp, Folder, ListFilter } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@frontmind/module-ui/components/ui/dropdown-menu';
import type { IndustryFailure } from '../../../contracts/industry-source';
import { safeSourceUrl } from './distribution';
import { integerText, ratioText } from './industry-source-client';
import { citationExportStatus } from './industry-source-export';
import { IndustryExportDialog } from './IndustryExportDialog';
import type { ContentSelection, IndustrySourceStore, IndustryState, ListKind } from './industry-source-store';

type Props = { id: string; store: IndustrySourceStore; state: IndustryState; ready: boolean; commonLabel: string; panelMessage: string };

function CitationState({ kind, loading, error, message, retry }: {
  kind: ListKind; loading: boolean; error: IndustryFailure | null; message: string; retry?: () => void;
}) {
  if (loading) return <div className="sm-citation-state" role="status">
    {kind === 'media' ? <p>加载媒体引用数据中...</p> : <><span className="sm-citation-spinner" aria-hidden="true"/><span className="sr">加载内容明细中...</span></>}
  </div>;
  if (error) return <div className="sm-citation-state is-error" role="alert">
    <p>{kind === 'media' ? '媒体排行加载失败，请稍后重试' : '内容明细加载失败，请稍后重试'}</p>
    {retry && <button type="button" className="button secondary sm-citation-retry" onClick={retry}>重新加载</button>}
  </div>;
  return <div className="sm-citation-state" role="status"><p>{message}</p></div>;
}

function mediaPercent(count: string, total: string | undefined): string {
  // A zero/unknown denominator is not evidence of a measured zero percent.
  if (!total || !/^\d+$/.test(total) || BigInt(total) <= 0n || !/^\d+$/.test(count)) return '—';
  return `${ratioText(count, total)}%`;
}

function MediaMark({ name, icon }: { name: string; icon?: string | null }) {
  const url = safeSourceUrl(icon ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className="sm-citation-media-mark" aria-hidden="true">
    {url && !failed ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : Array.from(name.trim())[0] || '—'}
  </span>;
}

/** Remote citations use bounded first pages. Scrolling never starts a request. */
export function IndustryCitationSources({ id, store, state, ready, panelMessage }: Props) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportButton = useRef<HTMLButtonElement>(null);
  const rankingScroll = useRef<HTMLOListElement>(null);
  const contentScroll = useRef<HTMLDivElement>(null);
  const contentPanel = useRef<HTMLElement>(null);
  const typeButton = useRef<HTMLButtonElement>(null), sortButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ button: 'type' | 'sort'; common: IndustryState['common']; selection: ContentSelection } | null>(null);
  const blocked = state.blocked !== null;
  const { media, contents } = state;
  const mediaReady = Boolean(ready && media.data && !media.loading && !media.error);
  const contentsReady = Boolean(ready && contents.data && !contents.loading && !contents.error);
  const exportStatus = citationExportStatus(state);
  const mediaLabel = state.selection.media
    ? media.data?.items.find(item => item.code === state.selection.media)?.name || contents.data?.items[0]?.media || state.selection.media
    : '全部媒体';

  useEffect(() => { if (!ready) setExportOpen(false); }, [ready]);
  useEffect(() => { if (rankingScroll.current) rankingScroll.current.scrollTop = 0; }, [media.data]);
  useEffect(() => { if (contentScroll.current) contentScroll.current.scrollTop = 0; }, [contents.data]);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (pending.common !== state.common || JSON.stringify(pending.selection) !== JSON.stringify(state.selection)) { pendingFocus.current = null; return; }
    if (contents.loading || !contents.data && !contents.error) return;
    pendingFocus.current = null;
    // The loading state removes the table. Restore the initiating control only if
    // focus was lost, and let the shared menu finish its own close-focus handling.
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const target = contents.error ? contentPanel.current?.querySelector<HTMLButtonElement>('.sm-citation-retry')
        : pending.button === 'type' ? typeButton.current : sortButton.current;
      target?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [contents.loading, contents.data, contents.error, state.common, state.selection]);
  const applyContent = (selection: ContentSelection, button: 'type' | 'sort') => {
    const current = store.getSnapshot();
    if (!ready || current.blocked || !current.common || JSON.stringify(current.selection) === JSON.stringify(selection)) return;
    pendingFocus.current = { button, common: current.common, selection };
    store.selectContent(selection);
  };
  const closeExport = () => { setExportOpen(false); exportButton.current?.focus(); };
  const selectMedia = (mediaCode: string) => {
    if (ready && !blocked) store.selectContent({ ...state.selection, media: mediaCode });
  };
  const retry = (kind: ListKind) => {
    const lane = state[kind];
    if (!ready || blocked || lane.loading || !lane.error) return undefined;
    return () => lane.error!.retryable ? store.retry(kind) : store.restart(kind);
  };
  const count = (kind: ListKind, field: 'total' | 'totalCitations') => {
    const lane = state[kind];
    return ready && lane.data && !lane.loading && !lane.error ? integerText(lane.data[field]) : '—';
  };
  const sortAscending = state.selection.sortOrder === 'asc';

  return <><section className="sm-industry-card sm-citation" aria-labelledby={`${id}-sources`}>
    <header className="sm-citation-heading">
      <h2 id={`${id}-sources`}><Folder size={18} strokeWidth={2} aria-hidden="true"/>引用信源</h2>
      <button ref={exportButton} type="button" className="button secondary sm-citation-export" disabled={!ready || !exportStatus.available} onClick={() => setExportOpen(true)}>导出</button>
    </header>
    <div className="sm-citation-panels">
      <aside className="sm-citation-panel" aria-label="媒体引用排行" aria-busy={media.loading}>
        <header className="sm-citation-panel-heading">
          <h3>媒体排行</h3>
          <p>媒体 {count('media', 'total')} 个 / 引用 {count('media', 'totalCitations')} 次</p>
        </header>
        <div className="sm-citation-body">
          {mediaReady ? <>
            {state.selection.media && <div className="sm-citation-toolbar"><button type="button" className="link small" disabled={blocked} onClick={() => selectMedia('')}>全部媒体</button></div>}
            {media.data!.items.length ? <ol ref={rankingScroll} className="sm-citation-ranking" tabIndex={0} aria-label="前50个媒体">{media.data!.items.slice(0, 50).map((item, index) => <li key={item.code}>
              <button type="button" disabled={blocked} aria-pressed={state.selection.media === item.code} onClick={() => selectMedia(state.selection.media === item.code ? '' : item.code)}>
                <span className={`sm-industry-rank${index < 3 ? ' is-leading' : ''}`}>{index + 1}</span>
                <span className="sm-industry-media"><strong title={item.name}>{item.name}</strong></span>
                <span className="sm-citation-rank-count"><strong>{integerText(item.citationCount)}<span className="sr"> 次引用</span></strong><span>{mediaPercent(item.citationCount, media.data!.totalCitations)}</span></span>
              </button>
            </li>)}</ol> : <CitationState kind="media" loading={false} error={null} message="当前范围暂无媒体"/>}
          </> : <CitationState kind="media" loading={media.loading || state.filters.loading} error={media.error} message={blocked ? '暂不可用，请先处理上方提示' : panelMessage} retry={retry('media')}/>}
        </div>
      </aside>
      <section ref={contentPanel} className="sm-citation-panel" aria-labelledby={`${id}-contents`} aria-busy={contents.loading}>
        <header className="sm-citation-panel-heading">
          <h3 id={`${id}-contents`} title={`内容明细 - ${mediaLabel}`}>内容明细 - {mediaLabel}</h3>
          <p>内容 {count('contents', 'total')} 条 / 引用 {count('contents', 'totalCitations')} 次</p>
        </header>
        <div className="sm-citation-body">
          {contentsReady ? <div ref={contentScroll} className="sm-industry-table-wrap sm-citation-table" tabIndex={0} aria-label="前20条引用内容"><table className={contents.data!.items.length ? undefined : 'is-empty'}>
            <caption className="sr">引用内容明细，最多前20条；内容占比沿用数据源返回值。</caption>
            <thead><tr>
              <th scope="col">序号</th><th scope="col">内容标题</th><th scope="col">媒体名称</th>
              <th scope="col">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button ref={typeButton} type="button" className={state.selection.sourceType ? 'is-filtered' : undefined} aria-label="筛选媒体类型" title={state.selection.sourceType || '全部类型'} disabled={!ready || blocked}>媒体类型<ListFilter size={14} aria-hidden="true"/></button></DropdownMenuTrigger>
                  <DropdownMenuContent className="sm-citation-type-menu" align="start" sideOffset={8}>
                    <DropdownMenuRadioGroup value={state.selection.sourceType} onValueChange={sourceType => applyContent({ ...state.selection, sourceType }, 'type')}>
                      <DropdownMenuRadioItem value="">全部类型</DropdownMenuRadioItem>
                      {state.filters.data?.sourceTypes.map(type => <DropdownMenuRadioItem key={type} value={type}>{type}</DropdownMenuRadioItem>)}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </th>
              <th scope="col" aria-sort={sortAscending ? 'ascending' : 'descending'}><button ref={sortButton} type="button" disabled={!ready || blocked} aria-label={`切换引用次数为${sortAscending ? '降序' : '升序'}`} onClick={() => applyContent({ ...state.selection, sortBy: 'citationCount', sortOrder: sortAscending ? 'desc' : 'asc' }, 'sort')}>引用次数{sortAscending ? <ArrowUp size={13} aria-hidden="true"/> : <ArrowDown size={13} aria-hidden="true"/>}</button></th>
              <th scope="col">引用占比</th>
            </tr></thead>
            <tbody>{contents.data!.items.length ? contents.data!.items.slice(0, 20).map(item => <tr key={item.linkId}>
              <td>{integerText(item.sequence)}</td>
              <td>{safeSourceUrl(item.url) ? <a className="sm-industry-title" title={item.title || item.linkId} href={safeSourceUrl(item.url)} target="_blank" rel="noopener noreferrer">{item.title || item.linkId}<span className="sr">（在新窗口打开原文）</span></a> : <strong className="sm-industry-title" title={item.title || item.linkId}>{item.title || item.linkId}</strong>}</td>
              <td><span className="sm-citation-media-cell"><MediaMark name={item.media} icon={item.icon}/><span title={item.media}>{item.media}</span></span></td>
              <td><span className="sm-citation-type-badge" data-type={item.sourceType} title={item.sourceType}>{item.sourceType || '—'}</span></td>
              <td>{integerText(item.citationCount)}</td><td>{item.citationRatio ? `${item.citationRatio}%` : '—'}</td>
            </tr>) : <tr><td colSpan={6}><CitationState kind="contents" loading={false} error={null} message="当前筛选暂无内容"/></td></tr>}</tbody>
          </table></div> : <CitationState kind="contents" loading={contents.loading || state.filters.loading} error={contents.error} message={blocked ? '暂不可用，请先处理上方提示' : panelMessage} retry={retry('contents')}/>}
        </div>
      </section>
    </div>
  </section>
    {exportOpen && ready && <IndustryExportDialog store={store} state={state} onClose={closeExport}/>}
  </>;
}
