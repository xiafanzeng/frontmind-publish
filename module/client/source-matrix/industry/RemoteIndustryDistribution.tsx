import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { IndustryCommonQuery, IndustryFailure, IndustryFilters, IndustryPeriod, IndustryScopeNode } from '../../../contracts/industry-source';
import { usePublisherGateway } from '../../PublishingContext';
import { usePublishingWorkspaceKey } from '../../host';
import { safeSourceUrl } from './distribution';
import { integerText, ratioText, totalOf } from './industry-source-client';
import { defaultSelection, industryStoreFor, type ContentSelection, type IndustrySourceStore, type ListKind } from './industry-source-store';
import './industry-distribution.css';

type ScopeOption = { value: string; label: string };
function scopes(nodes: IndustryScopeNode[], depth = 0): ScopeOption[] {
  return nodes.flatMap(node => [{ value: node.scopeId, label: `${'　'.repeat(depth)}${node.label}` }, ...scopes(node.children, depth + 1)]);
}
const PERIODS: Array<{ value: IndustryPeriod; label: string }> = [{ value: 'MONTH', label: '按月' }, { value: 'WEEK', label: '按周' }, { value: 'DAY', label: '按日' }, { value: 'ALL', label: '全部时间' }];
const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const normalizeDate = (period: IndustryPeriod, value: string): string => {
  if (period === 'MONTH') return value.slice(0, 7) + '-01';
  if (period !== 'WEEK') return value;
  const day = new Date(value + 'T00:00:00Z'); day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
};

export function readIndustryView(filters: IndustryFilters) {
  const params = new URLSearchParams(window.location.search), rawPeriod = params.get('siPeriod');
  const periodType = PERIODS.find(period => period.value === rawPeriod)?.value ?? 'MONTH';
  const savedDate = params.get('siDate') ?? '', fallbackDate = filters.maxDate?.slice(0, 7) + '-01';
  const date = validDate(savedDate) ? normalizeDate(periodType, savedDate) : fallbackDate;
  const scopeId = params.get('siScope') ?? '';
  const validScope = scopes(filters.industryTree).some(option => option.value === scopeId);
  const savedModel = params.get('siModel') ?? 'all';
  const modelCode = filters.models.some(model => model.value === savedModel) ? savedModel : 'all';
  const common: IndustryCommonQuery = { periodType, ...(periodType !== 'ALL' ? { date } : {}), scopeType: validScope ? 'CATEGORY' : 'ALL', ...(validScope ? { scopeId } : {}), modelCode };
  const sourceType = params.get('siType') ?? '';
  const selection: ContentSelection = { media: params.get('siMedia') ?? '', sourceType: filters.sourceTypes.includes(sourceType) ? sourceType : '', sortBy: params.get('siSort') === 'publishTime' ? 'publishTime' : 'citationCount', sortOrder: params.get('siOrder') === 'asc' ? 'asc' : 'desc' };
  return { common, selection };
}
function saveIndustryView(common: IndustryCommonQuery, selection: ContentSelection) {
  const url = new URL(window.location.href);
  const values = { siPeriod: common.periodType, siDate: common.date, siScope: common.scopeId, siModel: common.modelCode, siMedia: selection.media, siType: selection.sourceType, siSort: selection.sortBy, siOrder: selection.sortOrder };
  for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
function when(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚未取得'; }
const COLORS = ['var(--brand,#2563eb)', 'var(--plum,#3e3e3e)', 'var(--x-good,#20815b)', 'var(--x-warning,#aa7227)', 'var(--muted,#737991)', '#707070', '#bbc0ce'];
const TIME_BUCKETS = [
  ['ONE_DAY', '1天内'], ['ONE_WEEK', '1周内'], ['ONE_MONTH', '1月内'], ['ONE_YEAR', '1年内'],
  ['ONE_TO_THREE_YEARS', '超过1年至3年'], ['OVER_THREE_YEARS', '3年以上'], ['UNKNOWN', '未知'],
] as const;
type Slice = { code: string; name: string; count: string };
function SourceDonut({ title, slices, unit, pending }: { title: string; slices: Slice[] | null; unit: string; pending: string }) {
  const total = slices ? totalOf(slices.map(slice => slice.count)) : null;
  let start = 0;
  const segments = (slices ?? []).flatMap((slice, index) => {
    const share = total ? Number(ratioText(slice.count, total)) : 0;
    const end = Math.min(100, start + share), color = slice.code === 'UNKNOWN' ? '#bbc0ce' : COLORS[index % COLORS.length]!;
    const segment = BigInt(slice.count) > 0n ? `${color} ${start}% ${end}%` : null; start = end;
    return segment ? [segment] : [];
  });
  return <div className="sm-industry-chart"><div className="sm-industry-ring" role="img" aria-label={`${title}，${total === null ? pending : total === '0' ? '无数据' : slices!.map(slice => `${slice.name} ${integerText(slice.count)}${unit} ${ratioText(slice.count, total)}%`).join('；')}`} style={{ background: total !== null && BigInt(total) > 0n && segments.length ? `conic-gradient(${segments.join(',')})` : 'var(--line,#e6e8f1)' }}><div><strong title={total ?? undefined}>{total === null ? '—' : integerText(total)}</strong><span>{unit}</span></div></div><div className="sm-industry-legend-area">{!slices && <p className="sm-industry-chart-state">{pending}</p>}<ul className="sm-industry-legend">{slices ? slices.map((slice, index) => <li key={slice.code}><span className="sm-industry-dot" aria-hidden="true" style={{ background: slice.code === 'UNKNOWN' ? '#bbc0ce' : COLORS[index % COLORS.length] }}/><span>{slice.name}</span><strong>{integerText(slice.count)}</strong><span>{ratioText(slice.count, total!)}%</span></li>) : <li><span className="sm-industry-dot sm-industry-dot-empty" aria-hidden="true"/><span>数据尚未取得</span><strong>—</strong><span>—</span></li>}</ul>{slices?.length === 0 && <p>当前范围暂无数据</p>}</div></div>;
}
function FailureNotice({ error, retry, restart }: { error: IndustryFailure | null; retry?: () => void; restart?: () => void }) {
  if (!error) return null;
  return <div className="sm-industry-notice sm-remote-error" role={error.status === 'configuration_required' ? 'status' : 'alert'}><p>{error.message}</p>{error.retryable && retry && <button type="button" className="button secondary" onClick={retry}>重试本次查询</button>}{error.status === 'session_expired' && restart && <button type="button" className="button secondary" onClick={restart}>从首屏重新查询</button>}</div>;
}

export function RemoteIndustryDistribution() {
  const gateway = usePublisherGateway(), workspace = usePublishingWorkspaceKey();
  const store = useMemo(() => industryStoreFor(gateway, workspace), [gateway, workspace]);
  // A changed scope gets a fresh component and form state before it can paint any old result.
  return <IndustrySourcePanel key={store.identity} store={store}/>;
}

export function IndustrySourcePanel({ store }: { store: IndustrySourceStore }) {
  const id = useId(), state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [draft, setDraft] = useState<IndustryCommonQuery>({ periodType: 'MONTH', scopeType: 'ALL', modelCode: 'all' });
  const [formError, setFormError] = useState(''), [typeDraft, setTypeDraft] = useState(''), [sortDraft, setSortDraft] = useState('citationCount:desc');
  const filters = state.filters.data, options = useMemo(() => scopes(filters?.industryTree ?? []), [filters]);
  useEffect(() => { store.start(readIndustryView); }, [store]);
  useEffect(() => { if (!state.common && filters?.maxDate) setDraft({ periodType: 'MONTH', date: filters.maxDate.slice(0, 7) + '-01', scopeType: 'ALL', modelCode: 'all' }); }, [store, filters, state.common]);
  useEffect(() => {
    if (state.common && store.getSnapshot().common === state.common && store.getSnapshot().selection === state.selection) {
      setDraft(state.common); saveIndustryView(state.common, state.selection);
    }
  }, [store, state.common, state.selection]);
  useEffect(() => { setTypeDraft(state.selection.sourceType); setSortDraft(`${state.selection.sortBy}:${state.selection.sortOrder}`); }, [store, state.selection]);
  useEffect(() => {
    const restore = () => { const currentFilters = store.getSnapshot().filters.data; if (currentFilters?.maxDate) { const restored = readIndustryView(currentFilters); store.apply(restored.common, restored.selection); } };
    window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore);
  }, [store]);
  const ready = Boolean(filters?.maxDate), blocked = state.blocked !== null;
  const busy = state.media.loading || state.contents.loading;
  const commonLabel = state.common ? `${options.find(option => option.value === state.common!.scopeId)?.label.trim() ?? '全部行业'} · ${filters?.models.find(model => model.value === state.common!.modelCode)?.label ?? state.common.modelCode} · ${PERIODS.find(period => period.value === state.common!.periodType)?.label}${state.common.date ? ' ' + state.common.date : ''}` : '查询条件尚未就绪';
  const apply = () => {
    if (!filters || !ready) return;
    if (draft.periodType !== 'ALL' && (!draft.date || !validDate(draft.date))) { setFormError('请选择有效日期。'); return; }
    setFormError('');
    const common: IndustryCommonQuery = { periodType: draft.periodType, ...(draft.periodType !== 'ALL' ? { date: normalizeDate(draft.periodType, draft.date!) } : {}), scopeType: draft.scopeId ? 'CATEGORY' : 'ALL', ...(draft.scopeId ? { scopeId: draft.scopeId } : {}), modelCode: draft.modelCode };
    store.apply(common, defaultSelection);
  };
  const select = (media: string) => store.selectContent({ ...state.selection, media });
  const panelMessage = !ready ? state.filters.loading ? '正在读取筛选项…' : filters ? '暂无可选执行日期' : '行业信源尚未就绪' : '暂无匹配数据';
  const media = state.media.data, contents = state.contents.data;
  const distribution = !state.distributions.error && !state.distributions.loading ? state.distributions.data : null;
  const typeSlices = distribution?.sourceTypeDistribution.map(item => ({ code: item.code, name: item.name, count: item.citationCount })) ?? null;
  const timeSlices = distribution ? [
    ...TIME_BUCKETS.map(([code, name]) => ({ code, name, count: distribution.publishTimeDistribution.find(item => item.code === code)?.contentCount ?? '0' })),
    ...distribution.publishTimeDistribution.filter(item => !TIME_BUCKETS.some(([code]) => code === item.code)).map(item => ({ code: item.code, name: item.name, count: item.contentCount })),
  ] : null;
  const chartMessage = state.distributions.loading ? '正在读取分布…' : state.distributions.error ? '分布读取失败' : panelMessage;
  const pageControls = (kind: ListKind) => {
    const lane = state[kind];
    return <nav className="sm-industry-pagination" aria-label={kind === 'media' ? '媒体排行分页' : '引用内容分页'}>
      <span>{lane.data ? `已加载 ${lane.data.items.length} / ${integerText(lane.data.total)} 项` : '数量尚未取得'}</span>
      <label>每页<select aria-label={kind === 'media' ? '媒体每页数量' : '内容每页数量'} disabled={!ready || blocked || lane.loading} value={kind === 'media' ? state.mediaSize : state.contentSize} onChange={event => store.setPageSize(kind, Number(event.target.value))}>{[10, 20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <button type="button" className="button secondary" disabled={!lane.data || lane.data.nextCursor === null || lane.loading || Boolean(lane.error) || blocked} onClick={() => store.more(kind)}>{lane.loading ? '正在读取…' : lane.data?.nextCursor === null ? '已到末尾' : '加载更多'}</button>
    </nav>;
  };

  return <div className="sm-industry sm-industry-remote" aria-busy={state.filters.loading}>
    <form className="sm-industry-filters" noValidate onSubmit={event => { event.preventDefault(); apply(); }}>
      <label htmlFor={`${id}-industry`}>行业<select id={`${id}-industry`} disabled={!ready || blocked} value={draft.scopeId ?? ''} onChange={event => setDraft({ ...draft, scopeType: event.target.value ? 'CATEGORY' : 'ALL', scopeId: event.target.value || undefined })}><option value="">全部行业</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label htmlFor={`${id}-model`}>模型<select id={`${id}-model`} disabled={!ready || blocked} value={draft.modelCode} onChange={event => setDraft({ ...draft, modelCode: event.target.value })}>{!filters?.models.some(model => model.value === 'all') && <option value="all">全部模型</option>}{filters?.models.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select></label>
      <label htmlFor={`${id}-period`}>日期范围<select id={`${id}-period`} disabled={!ready || blocked} value={draft.periodType} onChange={event => setDraft({ ...draft, periodType: event.target.value as IndustryPeriod })}>{PERIODS.map(period => <option key={period.value} value={period.value}>{period.label}</option>)}</select></label>
      <label htmlFor={`${id}-date`}>执行日期（北京时间）<input id={`${id}-date`} type="date" disabled={!ready || blocked || draft.periodType === 'ALL'} value={draft.date ?? ''} aria-invalid={Boolean(formError)} aria-describedby={formError ? `${id}-error` : undefined} onChange={event => setDraft({ ...draft, date: event.target.value })}/></label>
      <button type="submit" className="button" disabled={!ready || blocked || busy}>查询</button>
      <button type="button" className="button secondary" disabled={!state.common || blocked || busy} onClick={() => store.refresh()}>刷新当前结果</button>
      {formError && <p id={`${id}-error`} className="sm-industry-error" role="alert">{formError}</p>}
    </form>
    <p className="sm-industry-caption">公共行业信源 · {commonLabel}。按周为周一至周日，按月为自然月。每次新的媒体或内容查询（含翻页、空结果）使用一次共享查询额度。</p>
    {(state.filters.loading || !ready || blocked) && <div className="sm-industry-notice" role={state.filters.error && state.filters.error.status !== 'configuration_required' || blocked && state.blocked?.status !== 'configuration_required' ? 'alert' : 'status'}><div><strong>{state.filters.loading ? '正在读取行业筛选项…' : state.blocked?.message ?? state.filters.error?.message ?? '当前尚无可选执行日期，暂不查询行业数据。'}</strong>{blocked && <p>请先处理连接、权限或额度问题，再重新检查连接；检查本身不会查询媒体和内容列表。</p>}{state.filters.error && state.filters.error.status !== state.blocked?.status && <p>连接检查：{state.filters.error.message}</p>}</div>{!state.filters.loading && <button type="button" className="button secondary" onClick={() => void store.checkAccess()}>重新检查连接</button>}{state.blocked?.status === 'quota_exhausted' && filters?.maxDate && <button type="button" className="button secondary" disabled={busy} onClick={() => store.resumeAfterResolution()}>额度恢复后重新查询</button>}</div>}
    <section className="sm-industry-card" aria-labelledby={`${id}-sources`}><header className="sm-industry-card-heading"><h2 id={`${id}-sources`}>引用信源</h2><p>行业引用来源不代表可购买媒体；可发布资源与报价仍由现有媒体库确认。</p></header>
      <div className="sm-industry-sources"><aside className="sm-industry-ranking" aria-label="媒体引用排行" aria-busy={state.media.loading}><div className="sm-industry-ranking-heading"><h3>媒体排行</h3><button type="button" className="link small" disabled={!state.selection.media || blocked || state.contents.loading} onClick={() => select('')}>全部媒体</button></div>
        <FailureNotice error={state.media.error} retry={() => store.retry('media')} restart={() => store.restart('media')}/>
        {media && <p className="sm-industry-caption">共 {integerText(media.totalCitations)} 次引用 · 获取于 {when(state.media.fetchedAt)}{state.media.error ? '（保留上次结果，本次读取失败）' : ''}</p>}
        {media?.items.length ? <ol>{media.items.map((item, index) => <li key={item.code}><button type="button" disabled={blocked || state.contents.loading} aria-pressed={state.selection.media === item.code} onClick={() => select(state.selection.media === item.code ? '' : item.code)}><span className="sm-industry-rank">{index + 1}</span><span className="sm-industry-media"><strong>{item.name}</strong></span><span className="sm-industry-rank-count"><strong>{integerText(item.citationCount)}</strong><small>次引用</small></span></button></li>)}</ol> : <div className="sm-industry-panel-empty"><strong>{state.media.loading ? '正在读取媒体排行…' : state.media.error ? '媒体排行暂不可用' : panelMessage}</strong></div>}{pageControls('media')}
      </aside><div className="sm-industry-content" aria-busy={state.contents.loading}><header className="sm-industry-content-heading"><div><h3>内容明细 - {state.selection.media || '全部媒体'}</h3></div>{state.selection.media && <button type="button" className="link small" disabled={blocked || state.contents.loading} onClick={() => select('')}>返回全部媒体</button>}</header>
        <form className="sm-remote-content-filters" noValidate onSubmit={event => { event.preventDefault(); const [sortBy, sortOrder] = sortDraft.split(':') as [ContentSelection['sortBy'], ContentSelection['sortOrder']]; store.selectContent({ ...state.selection, sourceType: typeDraft, sortBy, sortOrder }); }}>
          <label htmlFor={`${id}-type`}>信源类型<select id={`${id}-type`} disabled={!ready || blocked} value={typeDraft} onChange={event => setTypeDraft(event.target.value)}><option value="">全部类型</option>{filters?.sourceTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
          <label htmlFor={`${id}-sort`}>排序<select id={`${id}-sort`} disabled={!ready || blocked} value={sortDraft} onChange={event => setSortDraft(event.target.value)}><option value="citationCount:desc">引用次数从多到少</option><option value="citationCount:asc">引用次数从少到多</option><option value="publishTime:desc">发布时间从新到旧</option><option value="publishTime:asc">发布时间从旧到新</option></select></label><button type="submit" className="button secondary" disabled={!ready || blocked || state.contents.loading}>应用内容筛选</button>
        </form>
        <FailureNotice error={state.contents.error} retry={() => store.retry('contents')} restart={() => store.restart('contents')}/>
        {contents && <p className="sm-industry-caption">当前内容范围共 {integerText(contents.totalCitations)} 次引用 · 获取于 {when(state.contents.fetchedAt)}{state.contents.error ? '（保留上次结果，本次读取失败）' : ''}</p>}
        <div className="sm-industry-table-wrap"><table><caption className="sr">公共行业引用内容；占比使用当前内容筛选的总引用次数。打开链接将前往原内容。</caption><thead><tr><th scope="col">序号</th><th scope="col">内容标题 / 原文</th><th scope="col">媒体名称</th><th scope="col">媒体类型</th><th scope="col" aria-sort={state.selection.sortBy === 'citationCount' ? state.selection.sortOrder === 'asc' ? 'ascending' : 'descending' : 'none'}>引用次数</th><th scope="col">引用占比</th></tr></thead><tbody>{contents?.items.length ? contents.items.map(item => <tr key={item.linkId}><td>{integerText(item.sequence)}</td><td>{safeSourceUrl(item.url) ? <a className="sm-industry-title" href={safeSourceUrl(item.url)} target="_blank" rel="noopener noreferrer">{item.title || item.linkId}<span aria-label="在新窗口打开原文"> ↗</span></a> : <strong className="sm-industry-title">{item.title || item.linkId}</strong>}<span className="sm-industry-content-status">发布时间：{item.publishTime ?? '未知'}</span>{!item.url && <span className="sm-industry-content-status">原文链接未提供</span>}</td><td>{item.media}</td><td>{item.sourceType}</td><td>{integerText(item.citationCount)}</td><td>{item.citationRatio}%</td></tr>) : <tr><td colSpan={6}><div className="sm-industry-panel-empty" role="status"><strong>{state.contents.loading ? '正在读取内容明细…' : state.contents.error ? '内容明细暂不可用' : contents ? '当前筛选暂无内容' : panelMessage}</strong></div></td></tr>}</tbody></table></div>{pageControls('contents')}
      </div></div>
    </section>
    <section className="sm-industry-card sm-industry-distribution-section" aria-labelledby={`${id}-distribution`}><header className="sm-industry-card-heading"><h2 id={`${id}-distribution`}>信源分布</h2><p>范围：{commonLabel}。不随内容的媒体、类型或排序变化；各图使用各自统计分母。</p></header><FailureNotice error={state.distributions.error} retry={() => void store.retryDistributions()}/><div className="sm-industry-distributions"><section className="sm-industry-card"><header className="sm-industry-card-heading"><h3>类型分布</h3></header><SourceDonut title="媒体类型分布" slices={typeSlices} unit="次引用" pending={chartMessage}/></section><section className="sm-industry-card"><header className="sm-industry-card-heading"><h3>时间分布</h3></header><SourceDonut title="内容发布时间分布" slices={timeSlices} unit="项内容" pending={chartMessage}/></section></div><p className="sm-industry-chart-note">发布时间区间相对于数据源当前时间计算，未知包含缺失或未来日期。获取于 {when(state.distributions.fetchedAt)}；源端统计存在缓存，不保证实时更新。</p></section>
  </div>;
}
