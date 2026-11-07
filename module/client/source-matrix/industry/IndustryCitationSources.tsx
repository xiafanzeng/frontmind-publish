import { Folder } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { IndustryFailure } from '../../../contracts/industry-source';
import { PublishingConfirmDialog } from '../../components/PublishingUi';
import { safeSourceUrl } from './distribution';
import { integerText } from './industry-source-client';
import { citationExportCsv, citationExportStatus, collectCitationExport, downloadCitationCsv } from './industry-source-export';
import type { ContentSelection, IndustrySourceStore, IndustryState, ListKind } from './industry-source-store';

type Props = { id: string; store: IndustrySourceStore; state: IndustryState; ready: boolean; commonLabel: string; panelMessage: string };
type ExportRequest = { state: IndustryState; commonLabel: string; mediaLabel: string; additionalPages: string };

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

/** Only the remote citation region; query controls, charts and store semantics stay with their owners. */
export function IndustryCitationSources({ id, store, state, ready, commonLabel, panelMessage }: Props) {
  const [typeDraft, setTypeDraft] = useState(state.selection.sourceType);
  const [sortDraft, setSortDraft] = useState(`${state.selection.sortBy}:${state.selection.sortOrder}`);
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const blocked = state.blocked !== null;
  const { media, contents } = state;
  const mediaReady = Boolean(media.data && !media.loading && !media.error);
  const contentsReady = Boolean(contents.data && !contents.loading && !contents.error);
  const exportStatus = citationExportStatus(state);
  const mediaLabel = state.selection.media
    ? media.data?.items.find(item => item.code === state.selection.media)?.name || contents.data?.items[0]?.media || state.selection.media
    : '全部媒体';

  useEffect(() => {
    setTypeDraft(state.selection.sourceType);
    setSortDraft(`${state.selection.sortBy}:${state.selection.sortOrder}`);
  }, [state.selection]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; exportController.current?.abort(); };
  }, [store]);
  useEffect(() => {
    setExportError('');
    setExportRequest(null);
  }, [state.common, state.selection]);

  // A confirmation applies to exactly the settled pages it described, not to a later query.
  const requestMatches = (request: ExportRequest) => {
    const current = store.getSnapshot(), captured = request.state;
    return current.common === captured.common && current.selection === captured.selection
      && current.media.data === captured.media.data && current.contents.data === captured.contents.data
      && current.mediaSize === captured.mediaSize && current.contentSize === captured.contentSize
      && citationExportStatus(current).available;
  };
  const runExport = async (request: ExportRequest) => {
    if (exportController.current) return;
    setExportRequest(null);
    if (!requestMatches(request)) { setExportError('查询结果已变化，请重新点击导出。'); return; }
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportError('');
    try {
      const snapshot = await collectCitationExport(store, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      const current = store.getSnapshot();
      if (current.common !== request.state.common || current.selection !== request.state.selection
        || current.mediaSize !== request.state.mediaSize || current.contentSize !== request.state.contentSize
        || current.media.loading || current.contents.loading || current.media.error || current.contents.error || current.blocked
        || current.media.data?.snapshotToken !== snapshot.media.snapshotToken || current.contents.data?.snapshotToken !== snapshot.contents.snapshotToken
        || current.media.data?.total !== snapshot.media.total || current.contents.data?.total !== snapshot.contents.total
        || current.media.data?.totalCitations !== snapshot.media.totalCitations || current.contents.data?.totalCitations !== snapshot.contents.totalCitations) {
        throw new Error('查询结果已变化，请重新导出。未生成导出文件。');
      }
      downloadCitationCsv(citationExportCsv(snapshot, request.commonLabel, request.mediaLabel));
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setExportError(error instanceof Error ? error.message : '导出未完成，请稍后重试。');
    } finally {
      if (exportController.current === controller) exportController.current = null;
      if (mounted.current) setExporting(false);
    }
  };
  const requestExport = () => {
    if (!exportStatus.available || exportController.current) return;
    const request = { state, commonLabel, mediaLabel, additionalPages: exportStatus.additionalPages };
    setExportError('');
    if (!requestMatches(request)) { setExportError('查询结果已变化，请重新点击导出。'); return; }
    if (request.additionalPages !== '0') setExportRequest(request);
    else void runExport(request);
  };
  const selectMedia = (mediaCode: string) => {
    if (!exporting && !blocked) store.selectContent({ ...state.selection, media: mediaCode });
  };
  const retry = (kind: ListKind) => {
    const lane = state[kind];
    if (blocked || exporting || lane.loading || !lane.error) return undefined;
    return () => lane.error!.retryable ? store.retry(kind) : store.restart(kind);
  };
  const count = (kind: ListKind, field: 'total' | 'totalCitations') => {
    const lane = state[kind];
    return lane.data && !lane.loading && !lane.error ? integerText(lane.data[field]) : '—';
  };
  const pagination = (kind: ListKind) => {
    const lane = state[kind];
    if (!lane.data || lane.loading || lane.error || blocked || lane.data.items.length === 0) return null;
    return <nav className="sm-industry-pagination" aria-label={kind === 'media' ? '媒体排行分页' : '引用内容分页'}>
      <span>已加载 {lane.data.items.length} / {integerText(lane.data.total)} 项</span>
      <label>每页<select aria-label={kind === 'media' ? '媒体每页数量' : '内容每页数量'} disabled={exporting} value={kind === 'media' ? state.mediaSize : state.contentSize} onChange={event => store.setPageSize(kind, Number(event.target.value))}>
        {[10, 20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>
      <button type="button" className="button secondary" disabled={exporting || lane.data.nextCursor === null} onClick={() => store.more(kind)}>{lane.data.nextCursor === null ? '已到末尾' : '加载更多'}</button>
    </nav>;
  };

  return <><section className="sm-industry-card sm-citation" aria-labelledby={`${id}-sources`}>
    <header className="sm-citation-heading">
      <h2 id={`${id}-sources`}><Folder size={18} strokeWidth={2} aria-hidden="true"/>引用信源</h2>
      <div className="sm-citation-actions">
        {exporting && <button type="button" className="link small" onClick={() => exportController.current?.abort()}>取消导出</button>}
        <button type="button" className="button secondary sm-citation-export" disabled={exporting || !exportStatus.available} aria-busy={exporting} onClick={requestExport}>{exporting ? '导出中' : '导出'}</button>
      </div>
      <span className="sr" role="status">{exporting ? '正在准备完整引用信源文件' : ''}</span>
      {exportError && <div className="sm-citation-export-error" role="alert"><span>{exportError}</span><button type="button" className="link small" aria-label="关闭导出提示" onClick={() => setExportError('')}>关闭</button></div>}
    </header>
    <div className="sm-citation-panels">
      <aside className="sm-citation-panel" aria-label="媒体引用排行" aria-busy={media.loading}>
        <header className="sm-citation-panel-heading">
          <h3>媒体排行</h3>
          <p>媒体 {count('media', 'total')} 个 / 引用 {count('media', 'totalCitations')} 次</p>
        </header>
        <div className="sm-citation-body">
          {mediaReady ? <>
            {state.selection.media && <div className="sm-citation-toolbar"><button type="button" className="link small" disabled={blocked || exporting || contents.loading} onClick={() => selectMedia('')}>全部媒体</button></div>}
            {media.data!.items.length ? <ol className="sm-citation-ranking">{media.data!.items.map((item, index) => <li key={item.code}>
              <button type="button" disabled={blocked || exporting || contents.loading} aria-pressed={state.selection.media === item.code} onClick={() => selectMedia(state.selection.media === item.code ? '' : item.code)}>
                <span className="sm-industry-rank">{index + 1}</span><span className="sm-industry-media"><strong>{item.name}</strong></span><span className="sm-citation-rank-count">{integerText(item.citationCount)}<span className="sr"> 次引用</span></span>
              </button>
            </li>)}</ol> : <CitationState kind="media" loading={false} error={null} message="当前范围暂无媒体"/>}
            {pagination('media')}
          </> : <CitationState kind="media" loading={media.loading || state.filters.loading} error={media.error} message={blocked ? '暂不可用，请先处理上方提示' : panelMessage} retry={retry('media')}/>}
        </div>
      </aside>
      <section className="sm-citation-panel" aria-labelledby={`${id}-contents`} aria-busy={contents.loading}>
        <header className="sm-citation-panel-heading">
          <h3 id={`${id}-contents`} title={`内容明细 - ${mediaLabel}`}>内容明细 - {mediaLabel}</h3>
          <p>内容 {count('contents', 'total')} 条 / 引用 {count('contents', 'totalCitations')} 次</p>
        </header>
        <div className="sm-citation-body">
          {contentsReady ? <>
            <form className="sm-remote-content-filters sm-citation-toolbar" noValidate onSubmit={event => {
              event.preventDefault();
              if (exporting || blocked) return;
              const [sortBy, sortOrder] = sortDraft.split(':') as [ContentSelection['sortBy'], ContentSelection['sortOrder']];
              store.selectContent({ ...state.selection, sourceType: typeDraft, sortBy, sortOrder });
            }}>
              <label htmlFor={`${id}-type`}>信源类型<select id={`${id}-type`} disabled={!ready || blocked || exporting} value={typeDraft} onChange={event => setTypeDraft(event.target.value)}><option value="">全部类型</option>{state.filters.data?.sourceTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
              <label htmlFor={`${id}-sort`}>排序<select id={`${id}-sort`} disabled={!ready || blocked || exporting} value={sortDraft} onChange={event => setSortDraft(event.target.value)}><option value="citationCount:desc">引用次数从多到少</option><option value="citationCount:asc">引用次数从少到多</option><option value="publishTime:desc">发布时间从新到旧</option><option value="publishTime:asc">发布时间从旧到新</option></select></label>
              <button type="submit" className="button secondary" disabled={!ready || blocked || exporting}>应用内容筛选</button>
              {state.selection.media && <button type="button" className="link small" disabled={blocked || exporting} onClick={() => selectMedia('')}>返回全部媒体</button>}
            </form>
            {contents.data!.items.length ? <div className="sm-industry-table-wrap sm-citation-table"><table>
              <caption className="sr">公共行业引用内容；占比使用当前内容筛选的总引用次数。打开链接将前往原内容。</caption>
              <thead><tr><th scope="col">序号</th><th scope="col">内容标题 / 原文</th><th scope="col">媒体名称</th><th scope="col">媒体类型</th><th scope="col" aria-sort={state.selection.sortBy === 'citationCount' ? state.selection.sortOrder === 'asc' ? 'ascending' : 'descending' : 'none'}>引用次数</th><th scope="col">引用占比</th></tr></thead>
              <tbody>{contents.data!.items.map(item => <tr key={item.linkId}>
                <td>{integerText(item.sequence)}</td>
                <td>{safeSourceUrl(item.url) ? <a className="sm-industry-title" href={safeSourceUrl(item.url)} target="_blank" rel="noopener noreferrer">{item.title || item.linkId}<span aria-label="在新窗口打开原文"> ↗</span></a> : <strong className="sm-industry-title">{item.title || item.linkId}</strong>}</td>
                <td>{item.media}</td><td>{item.sourceType}</td><td>{integerText(item.citationCount)}</td><td>{item.citationRatio}%</td>
              </tr>)}</tbody>
            </table></div> : <CitationState kind="contents" loading={false} error={null} message="当前筛选暂无内容"/>}
            {pagination('contents')}
          </> : <CitationState kind="contents" loading={contents.loading || state.filters.loading} error={contents.error} message={blocked ? '暂不可用，请先处理上方提示' : panelMessage} retry={retry('contents')}/>}
        </div>
      </section>
    </div>
  </section>
    <div className="monitoring-module sm-citation-dialog-host"><div className="publishing-page">
      <PublishingConfirmDialog open={Boolean(exportRequest)} title="导出完整引用信源" description={`预计还需读取 ${exportRequest?.additionalPages ?? '—'} 页，每页使用一次共享查询额度。继续后将读取剩余结果并导出完整 CSV；取消导出只会停止后续读取，已发起的查询仍会使用额度。`} confirmLabel="继续导出" confirmDisabled={!exportRequest || !requestMatches(exportRequest)} onCancel={() => setExportRequest(null)} onConfirm={() => { if (exportRequest) void runExport(exportRequest); }}/>
    </div></div>
  </>;
}
