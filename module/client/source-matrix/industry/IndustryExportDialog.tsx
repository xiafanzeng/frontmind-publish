import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@frontmind/module-ui/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@frontmind/module-ui/components/ui/popover';
import type { IndustryCommonQuery, IndustryScopeNode } from '../../../contracts/industry-source';
import { IndustryDateSelect } from './IndustryDateSelect';
import { formatIndustryDate, isIndustryDateValueAvailable, normalizeIndustryDateValue } from './industry-date';
import { IndustryRequestError, industryRequest, integerText, newIndustryRequestId } from './industry-source-client';
import type { IndustryMedia, IndustryPage } from '../../../contracts/industry-source';
import { CitationExportSession, citationExportCsv, downloadCitationCsv, sameExportCommon, type CitationExportProgress } from './industry-source-export';
import type { ContentSelection, IndustrySourceStore, IndustryState } from './industry-source-store';
import './industry-export-dialog.css';

type Props = { store: IndustrySourceStore; state: IndustryState; onClose: () => void };
type Option = { value: string; label: string };
function scopeOptions(nodes: IndustryScopeNode[], depth = 0): Option[] {
  return nodes.flatMap(node => [{ value: node.scopeId, label: `${'　'.repeat(depth)}${node.label}` }, ...scopeOptions(node.children, depth + 1)]);
}
function MediaSelect({ id, options, value, onChange, disabled, range }: { id: string; options: Option[]; value: string; onChange: (value: string) => void; disabled: boolean; range: string }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const choices = [{ value: '', label: '全部媒体' }, ...options].filter(option => !option.value || option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selected = options.find(option => option.value === value)?.label ?? '全部媒体';
  return <Popover modal open={open} onOpenChange={next => { setOpen(next); if (next) setSearch(''); }}>
    <PopoverTrigger asChild><button id={id} type="button" className="sm-export-select-trigger" disabled={disabled} aria-label="媒体名称"><span>{selected}</span><ChevronDown size={16} aria-hidden="true"/></button></PopoverTrigger>
    <PopoverContent aria-label="选择媒体" className="sm-export-media-popover" align="start" collisionPadding={16}>
      <label className="sm-export-media-search"><Search size={16} aria-hidden="true"/><input aria-label="搜索当前媒体选项" placeholder="搜索当前选项" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); list.current?.querySelector<HTMLButtonElement>('button')?.focus(); } }}/></label>
      <p className="sm-export-media-range">{range}</p>
      <div ref={list} className="sm-export-media-options" role="listbox" aria-label="可选媒体" onKeyDown={event => {
        const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
        if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
      }}>{choices.map(option => <button type="button" role="option" aria-selected={value === option.value} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{value === option.value && <Check size={16} aria-hidden="true"/>}</button>)}</div>
    </PopoverContent>
  </Popover>;
}

/** Only mounted while open. Changing conditions reads one media-ranking page so the
 * media picker keeps offering the current conditions' top media. */
export function IndustryExportDialog({ store, state, onClose }: Props) {
  const id = useId();
  const initial = useRef(state).current;
  const filters = initial.filters.data!;
  const [common, setCommon] = useState<IndustryCommonQuery>(() => ({ ...initial.common! }));
  const [media, setMedia] = useState(initial.selection.media);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [freshMedia, setFreshMedia] = useState<{ key: string; total: string; items: Option[] } | { key: string; failed: true } | null>(null);
  const [progress, setProgress] = useState<CitationExportProgress | null>(null);
  const session = useRef<CitationExportSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true), close = useRef(onClose); close.current = onClose;
  const opener = useRef(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const scopeChoices = scopeOptions(filters.industryTree);
  const originalCommon = initial.common!;
  const matchesOriginal = sameExportCommon(originalCommon, common);
  const commonKey = JSON.stringify(common);
  const freshList = !matchesOriginal && freshMedia && freshMedia.key === commonKey ? freshMedia : null;
  const freshOk = freshList && !('failed' in freshList) ? freshList : null;
  const freshItems = freshOk && freshOk.items.length ? freshOk : null;
  const mediaOptions: Option[] = matchesOriginal ? (initial.media.data?.items.slice(0, 50) ?? []).map(item => ({ value: item.code, label: item.name })) : freshItems ? freshItems.items : [];
  const hasAdditionalSelection = matchesOriginal && Boolean(initial.selection.media) && !mediaOptions.some(option => option.value === initial.selection.media);
  if (hasAdditionalSelection) {
    mediaOptions.push({ value: initial.selection.media, label: initial.contents.data?.items[0]?.media || initial.selection.media });
  }
  const mediaRange = matchesOriginal ? `当前条件前 50 个媒体；目录共 ${initial.media.data ? integerText(initial.media.data.total) : '—'} 个${hasAdditionalSelection ? '，另含当前选择' : ''}`
    : freshItems ? `当前条件前 50 个媒体；目录共 ${integerText(freshOk!.total)} 个`
    : freshList && 'failed' in freshList ? '当前条件的媒体列表读取失败，可选择全部媒体或稍后重试。'
    : '正在读取当前条件的媒体列表…';
  const selectedScope = common.scopeType === 'ALL' ? '全部行业' : scopeChoices.find(option => option.value === common.scopeId)?.label.trim() || '行业条件失效';
  const date = normalizeIndustryDateValue(common.periodType, common.date, filters.minDate, filters.maxDate);
  const validDate = Boolean(date && isIndustryDateValueAvailable(date, filters.minDate, filters.maxDate) && date.periodType === common.periodType && date.date === common.date);
  const valid = validDate && (common.scopeType === 'ALL' || scopeChoices.some(option => option.value === common.scopeId))
    && (common.modelCode === 'all' || filters.models.some(option => option.value === common.modelCode))
    && (!media || mediaOptions.some(option => option.value === media));
  const blocked = state.blocked !== null;

  useEffect(() => {
    if (matchesOriginal || blocked) return;
    const controller = new AbortController();
    let active = true;
    industryRequest<IndustryPage<IndustryMedia>>('media-ranking', { ...common, pageSize: 50, requestId: newIndustryRequestId() }, controller.signal)
      .then(result => { if (active) setFreshMedia({ key: commonKey, total: result.data.total, items: result.data.items.map(item => ({ value: item.code, label: item.name })) }); })
      .catch(() => { if (active) setFreshMedia({ key: commonKey, failed: true }); });
    return () => { active = false; controller.abort(); };
  }, [common, commonKey, matchesOriginal, blocked]);
  useEffect(() => {
    alive.current = true;
    const changed = () => {
      const current = store.getSnapshot();
      if (current.common !== initial.common || current.selection !== initial.selection) {
        controller.current?.abort(); close.current();
      } else if (current.blocked) controller.current?.abort();
    };
    const unsubscribe = store.subscribe(changed);
    changed();
    return () => { alive.current = false; controller.current?.abort(); unsubscribe(); };
  }, [store, initial]);

  const cancel = () => { controller.current?.abort(); close.current(); };
  const edit = (next: IndustryCommonQuery) => {
    if (controller.current || sameExportCommon(common, next)) return;
    setCommon(next);
    if (!sameExportCommon(originalCommon, next)) setMedia('');
    session.current = null; setError(''); setProgress(null);
  };
  const run = async () => {
    if (controller.current || !valid || blocked) return;
    const current = store.getSnapshot();
    if (current.common !== initial.common || current.selection !== initial.selection || current.blocked) { cancel(); return; }
    const selection: ContentSelection = { ...initial.selection, media };
    const operation = new AbortController(); controller.current = operation;
    setBusy(true); setError('');
    try {
      // Reusing a retryable session retains its exact failed request ID and cursor.
      if (!session.current || session.current.hasFailed && !session.current.canRetry) session.current = new CitationExportSession(current, common, selection);
      const result = await session.current.collect(operation.signal, value => { if (alive.current && !operation.signal.aborted) setProgress(value); });
      if (operation.signal.aborted || !alive.current) return;
      const latest = store.getSnapshot();
      if (latest.common !== initial.common || latest.selection !== initial.selection || latest.blocked) throw new Error('页面条件已变化，请重新导出。');
      const model = filters.models.find(option => option.value === common.modelCode)?.label ?? (common.modelCode === 'all' ? '全部模型' : common.modelCode);
      const commonLabel = `${selectedScope} · ${model} · ${date ? formatIndustryDate(date) : '—'}`;
      const mediaLabel = media ? mediaOptions.find(option => option.value === media)?.label || media : '全部媒体';
      downloadCitationCsv(citationExportCsv(result, commonLabel, mediaLabel));
      close.current();
    } catch (cause) {
      if (!operation.signal.aborted && alive.current) {
        setError(cause instanceof Error ? cause.message : '导出失败，请稍后重试。未生成导出文件。');
        if (cause instanceof IndustryRequestError) store.reportExportFailure(cause.failure);
      }
    } finally {
      if (controller.current === operation) controller.current = null;
      if (alive.current) setBusy(false);
    }
  };

  return <Dialog open onOpenChange={open => { if (!open) cancel(); }}>
    <DialogContent className="sm-export-dialog" overlayClassName="sm-export-overlay" showCloseButton={false} onCloseAutoFocus={event => {
      event.preventDefault();
      if (opener.current?.isConnected && !opener.current.matches(':disabled')) opener.current.focus();
    }}>
      <header className="sm-export-heading"><DialogTitle className="sm-export-title">导出数据</DialogTitle><button type="button" className="sm-export-close" aria-label="关闭导出数据" onClick={cancel}><X size={22} aria-hidden="true"/></button></header>
      <DialogDescription className="sm-export-sr">选择引用内容的导出条件；最多导出前 1000 条。取消不改变页面筛选。</DialogDescription>
      <div className="sm-export-body">
        <section className="sm-export-summary" aria-label="导出范围"><strong>引用信源</strong><div><span>{selectedScope}</span><span>{date ? formatIndustryDate(date) : '日期不可用'}</span></div></section>
        <div className="sm-export-fields">
          <label htmlFor={`${id}-scope`}>行业名称<select id={`${id}-scope`} value={common.scopeId ?? ''} disabled={busy || blocked} onChange={event => edit({ ...common, scopeType: event.target.value ? 'CATEGORY' : 'ALL', scopeId: event.target.value || undefined })}><option value="">全部行业</option>{scopeChoices.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label htmlFor={`${id}-model`}>监控模型<select id={`${id}-model`} value={common.modelCode} disabled={busy || blocked} onChange={event => edit({ ...common, modelCode: event.target.value })}>{!filters.models.some(option => option.value === 'all') && <option value="all">全部模型</option>}{filters.models.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <div className="sm-export-field"><label htmlFor={`${id}-media`}>媒体名称</label><MediaSelect id={`${id}-media`} options={mediaOptions} value={media} onChange={value => { if (value === media) return; setMedia(value); session.current = null; setError(''); setProgress(null); }} disabled={busy || blocked} range={mediaRange}/></div>
          <div className="sm-export-field"><label htmlFor={`${id}-date`}>起止时间</label>{date ? <IndustryDateSelect modal id={`${id}-date`} ariaLabel="起止时间" value={date} minDate={filters.minDate} maxDate={filters.maxDate} disabled={busy || blocked} onChange={value => edit({ ...common, ...value })}/> : <span>日期不可用</span>}</div>
        </div>
        <p className="sm-export-limit"><AlertTriangle size={18} aria-hidden="true"/>支持导出前 1000 条</p>
        <p className="sm-export-quota">未完整缓存时，最多读取 10 页内容，每页新查询使用一次共享查询额度；修改条件会按新条件读取一次媒体列表；重试沿用原请求。取消停止后续读取，已发出请求可能已使用额度。</p>
        {busy && <p role="status" className="sm-export-progress">{progress ? `已读取 ${progress.loaded} / ${progress.target} 条` : '正在读取导出数据...'}</p>}
        {(error || state.blocked?.message) && <p className="sm-export-error" role="alert">{error || state.blocked?.message}</p>}
        {!valid && <p className="sm-export-error" role="alert">当前导出条件已失效，请重新选择。</p>}
      </div>
      <footer className="sm-export-footer"><button type="button" className="sm-export-button" onClick={cancel}>{busy ? '取消导出' : '取消'}</button><button type="button" className="sm-export-button is-primary" disabled={busy || blocked || !valid} aria-busy={busy} onClick={() => { void run(); }}>{busy ? '导出中...' : error ? session.current?.canRetry ? '重试导出' : '重新导出' : '导出'}</button></footer>
    </DialogContent>
  </Dialog>;
}
