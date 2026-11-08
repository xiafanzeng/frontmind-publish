import { useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import type { IndustryCommonQuery, IndustryFailure, IndustryFilters, IndustryScopeNode } from '../../../contracts/industry-source';
import { usePublisherGateway } from '../../PublishingContext';
import { usePublishingWorkspaceKey } from '../../host';
import { IndustryCitationSources } from './IndustryCitationSources';
import { IndustryDateSelect } from './IndustryDateSelect';
import { formatIndustryDate, normalizeIndustryDateValue } from './industry-date';
import { integerText, ratioText, totalOf } from './industry-source-client';
import { useIndustryCatalog } from './useIndustryCatalog';
import { defaultSelection, industryStoreFor, type ContentSelection, type IndustrySourceStore } from './industry-source-store';
import './industry-distribution.css';

export interface ArticleIndustryBridge {
  /** Stable article/version/digest ownership; never a task or tab identity. */
  scopeKey: string;
  recognitionPending: boolean;
  /** False while the selected article still lacks its authorized context. */
  contextReady?: boolean;
  suggestedIndustryId?: string | null;
}
export interface RemoteIndustryDistributionProps { article?: ArticleIndustryBridge; selectedIndustry?: { id: string; onChange: (id: string) => void } }

type ScopeOption = { value: string; label: string };
function scopes(nodes: IndustryScopeNode[], depth = 0): ScopeOption[] {
  return nodes.flatMap(node => [{ value: node.scopeId, label: `${'　'.repeat(depth)}${node.label}` }, ...scopes(node.children, depth + 1)]);
}
export function readIndustryView(filters: IndustryFilters, articleScope?: string) {
  const params = new URLSearchParams(window.location.search), rawPeriod = params.get('siPeriod');
  const selectedDate = normalizeIndustryDateValue(rawPeriod ?? 'MONTH', params.get('siDate') ?? undefined, filters.minDate, filters.maxDate);
  // Called after filters resolve; a missing maxDate is gated by the store before any list query.
  const { periodType, date } = selectedDate ?? { periodType: 'MONTH' as const, date: undefined };
  const scopeId = params.get('siScope') ?? '';
  const sameOwner = !params.has('siArticle') || params.get('siArticle') === articleScope;
  const validScope = sameOwner && scopes(filters.industryTree).some(option => option.value === scopeId);
  const savedModel = params.get('siModel') ?? 'all';
  const modelCode = filters.models.some(model => model.value === savedModel) ? savedModel : filters.models.find(model => model.value === 'all')?.value ?? filters.models[0]?.value ?? '';
  const common: IndustryCommonQuery = { periodType, ...(date ? { date } : {}), scopeType: validScope ? 'CATEGORY' : 'ALL', ...(validScope ? { scopeId } : {}), modelCode };
  const sourceType = params.get('siType') ?? '';
  const selection: ContentSelection = { media: sameOwner ? params.get('siMedia') ?? '' : '', sourceType: sameOwner && filters.sourceTypes.includes(sourceType) ? sourceType : '', sortBy: 'citationCount', sortOrder: params.get('siOrder') === 'asc' ? 'asc' : 'desc' };
  return { common, selection };
}
function saveIndustryView(common: IndustryCommonQuery, selection: ContentSelection, mode: 'replace' | 'push' = 'replace', article?: ArticleIndustryBridge, manualScope = false) {
  const url = new URL(window.location.href);
  const values = { siArticle: article?.scopeKey, siManual: article && manualScope ? '1' : undefined, siPeriod: common.periodType, siDate: common.date, siScope: common.scopeId, siModel: common.modelCode, siMedia: selection.media, siType: selection.sourceType, siSort: selection.sortBy, siOrder: selection.sortOrder };
  for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  const target = url.pathname + url.search + url.hash;
  if (target === window.location.pathname + window.location.search + window.location.hash) return;
  if (mode === 'push') window.history.pushState(window.history.state, '', target);
  else window.history.replaceState(window.history.state, '', target);
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

export function RemoteIndustryDistribution({ article, selectedIndustry }: RemoteIndustryDistributionProps = {}) {
  const gateway = usePublisherGateway(), workspace = usePublishingWorkspaceKey();
  const catalog = useIndustryCatalog(gateway, workspace);
  const store = useMemo(() => industryStoreFor(gateway, workspace, article?.scopeKey), [gateway, workspace, article?.scopeKey]);
  useEffect(() => { store.receiveCatalog(catalog); }, [store, catalog.catalog, catalog.error, catalog.loading]);
  // A changed scope gets a fresh component and form state before it can paint any old result.
  return <IndustrySourcePanel key={store.identity} store={store} article={article} selectedIndustry={selectedIndustry} catalogOptions={catalog.industries}/>;
}

export function IndustrySourcePanel({ store, article, selectedIndustry, catalogOptions }: RemoteIndustryDistributionProps & { store: IndustrySourceStore; catalogOptions?: Array<{ id: string; label: string }> }) {
  const contextReady = article?.contextReady !== false;
  const id = useId(), state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const filters = state.filters.data, options = useMemo(() => catalogOptions?.map(option => ({ value: option.id, label: option.label })) ?? scopes(filters?.industryTree ?? []), [filters, catalogOptions]);
  const initialView = (available: IndustryFilters) => {
    const view = readIndustryView(available, article?.scopeKey);
    if (selectedIndustry && (!article?.recognitionPending || store.hasManualScope)) {
      const scopeId = selectedIndustry.id;
      return { common: { ...view.common, scopeType: scopeId ? 'CATEGORY' as const : 'ALL' as const, scopeId: scopeId || undefined }, selection: view.common.scopeId === scopeId ? view.selection : { ...defaultSelection } };
    }
    if (!article) return view;
    // URL scope/media belongs to its article only. Unrelated model/date remain untouched.
    const params = new URLSearchParams(window.location.search);
    if (params.get('siArticle') === article.scopeKey && params.get('siManual') === '1') return view;
    return { common: { ...view.common, scopeType: 'ALL' as const, scopeId: undefined }, selection: { ...defaultSelection } };
  };
  useEffect(() => { store.setContextReady(contextReady); }, [store, contextReady]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (article && params.get('siArticle') === article.scopeKey && params.get('siManual') === '1') store.markManualScope();
    store.start(article || selectedIndustry ? undefined : readIndustryView, { deferInitialization: Boolean(article || selectedIndustry) });
  }, [store, Boolean(article)]);
  useEffect(() => {
    const current = store.getSnapshot(), available = current.filters.data;
    // A successful connection recheck may introduce the first usable date after an empty initial response.
    // Read the live store so initial loading and StrictMode cannot start the same query twice.
    if (!contextReady || current.common || current.blocked || current.filters.loading || !available
      || !normalizeIndustryDateValue('MONTH', undefined, available.minDate, available.maxDate) || article?.recognitionPending && !store.hasManualScope) return;
    if (catalogOptions && !catalogOptions.length && available.industryTree.length) return;
    const initial = initialView(available);
    if (article && new URLSearchParams(window.location.search).get('siArticle') === article.scopeKey && new URLSearchParams(window.location.search).get('siManual') === '1') store.markManualScope();
    const recognized = !selectedIndustry && !store.hasManualScope && article?.suggestedIndustryId && options.some(option => option.value === article.suggestedIndustryId) ? article.suggestedIndustryId : undefined;
    store.apply(recognized ? { ...initial.common, scopeType: 'CATEGORY', scopeId: recognized } : initial.common, initial.selection);
  }, [store, filters, state.common, state.blocked, state.filters.loading, contextReady, article?.recognitionPending, article?.suggestedIndustryId, selectedIndustry?.id, options]);
  useEffect(() => {
    // An explicit later identification retry may resolve a previously unknown industry.
    // Only scope changes; unrelated dates/models and every manual scope choice survive.
    const current = store.getSnapshot(), industry = article?.suggestedIndustryId;
    if (selectedIndustry || !contextReady || !article || article.recognitionPending || !industry || store.hasManualScope || current.blocked || current.filters.loading
      || !current.common || current.common.scopeId === industry || !options.some(option => option.value === industry)) return;
    store.apply({ ...current.common, scopeType: 'CATEGORY', scopeId: industry }, defaultSelection);
  }, [store, article?.recognitionPending, article?.suggestedIndustryId, options, state.common, state.blocked, state.filters.loading, contextReady, selectedIndustry]);
  useEffect(() => {
    const current = store.getSnapshot(), scopeId = selectedIndustry?.id;
    // The shared form owns the effective industry, including an explicit clear.
    // apply() aborts and clears the previous industry's requests before starting this one.
    if (!selectedIndustry || !contextReady || article?.recognitionPending && !store.hasManualScope || !current.common || current.blocked || current.filters.loading
      || (current.common.scopeId ?? '') === scopeId || scopeId && !options.some(option => option.value === scopeId)) return;
    store.apply({ ...current.common, scopeType: scopeId ? 'CATEGORY' : 'ALL', scopeId: scopeId || undefined }, defaultSelection);
  }, [store, selectedIndustry?.id, contextReady, article?.recognitionPending, state.common, state.blocked, state.filters.loading, options]);
  useEffect(() => {
    if ((!selectedIndustry || (state.common?.scopeId ?? '') === selectedIndustry.id) && state.common && store.getSnapshot().common === state.common && store.getSnapshot().selection === state.selection) saveIndustryView(state.common, state.selection, 'replace', article, store.hasManualScope);
  }, [store, state.common, state.selection, article?.scopeKey, selectedIndustry?.id]);
  useEffect(() => {
    const restore = () => {
      const current = store.getSnapshot(), currentFilters = current.filters.data;
      if (!contextReady || !currentFilters?.maxDate) return;
      if (article && new URLSearchParams(window.location.search).get('siArticle') !== article.scopeKey) return;
      if (current.blocked) { if (current.common) saveIndustryView(current.common, current.selection, 'replace', article, store.hasManualScope); return; }
      const restored = readIndustryView(currentFilters, article?.scopeKey);
      // Normalize legacy URLs even when they resolve to the already-applied query.
      if (article) store.markManualScope();
      selectedIndustry?.onChange(restored.common.scopeId ?? '');
      saveIndustryView(restored.common, restored.selection, 'replace', article, store.hasManualScope);
      store.apply(restored.common, restored.selection);
    };
    window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore);
  }, [store, article?.scopeKey, contextReady, selectedIndustry?.onChange]);
  const displayedCommon = state.common ?? (filters ? initialView(filters).common : null);
  const selectedDate = normalizeIndustryDateValue(displayedCommon?.periodType ?? 'MONTH', displayedCommon?.date, filters?.minDate ?? null, filters?.maxDate ?? null);
  const invalidScope = Boolean(state.common?.scopeId && filters && !options.some(option => option.value === state.common!.scopeId));
  const controlsReady = contextReady && Boolean(selectedDate && filters && !state.filters.loading), waiting = Boolean(article?.recognitionPending && !state.common);
  const scopeMatchesForm = !selectedIndustry || (state.common?.scopeId ?? '') === selectedIndustry.id;
  const ready = controlsReady && Boolean(state.common) && !invalidScope && scopeMatchesForm, blocked = state.blocked !== null;
  const busy = state.media.loading || state.contents.loading;
  const initializeAfterCheck = !state.common && state.blocked?.status !== 'quota_exhausted';
  const commonLabel = state.common ? `${state.common.scopeType === 'ALL' ? '全部行业' : options.find(option => option.value === state.common!.scopeId)?.label.trim() ?? '原行业已失效，请重新选择'} · ${filters?.models.find(model => model.value === state.common!.modelCode)?.label ?? state.common.modelCode} · ${selectedDate ? formatIndustryDate(selectedDate) : '暂无可选周期'}` : '查询条件尚未就绪';
  const apply = (patch: Partial<IndustryCommonQuery>) => {
    const current = store.getSnapshot();
    if (!contextReady || !controlsReady || current.blocked || !filters) return;
    const base = current.common ?? initialView(filters).common;
    const merged = { ...base, ...patch };
    const date = normalizeIndustryDateValue(merged.periodType, merged.date, filters!.minDate, filters!.maxDate);
    if (!date) return;
    const common: IndustryCommonQuery = { ...date, scopeType: merged.scopeId ? 'CATEGORY' : 'ALL', ...(merged.scopeId ? { scopeId: merged.scopeId } : {}), modelCode: merged.modelCode };
    if (Object.prototype.hasOwnProperty.call(patch, 'scopeId')) { if (article) store.markManualScope(); selectedIndustry?.onChange(common.scopeId ?? ''); }
    if (current.common && common.periodType === current.common.periodType && common.date === current.common.date && common.scopeId === current.common.scopeId && common.modelCode === current.common.modelCode) { saveIndustryView(common, current.selection, 'replace', article, store.hasManualScope); return; }
    saveIndustryView(common, defaultSelection, 'push', article, store.hasManualScope);
    store.apply(common, defaultSelection);
  };
  const panelMessage = !contextReady ? '稿件授权上下文尚未就绪，暂不查询行业数据。' : invalidScope ? '原行业已失效，请重新选择。' : waiting && controlsReady ? '正在识别稿件行业，完成后加载；也可手动选择行业。' : !ready ? state.filters.loading ? '正在读取筛选项…' : filters ? '暂无可选执行日期' : '行业信源尚未就绪' : '暂无匹配数据';
  const distribution = ready && !state.distributions.error && !state.distributions.loading ? state.distributions.data : null;
  const typeSlices = distribution?.sourceTypeDistribution.map(item => ({ code: item.code, name: item.name, count: item.citationCount })) ?? null;
  const timeSlices = distribution ? [
    ...TIME_BUCKETS.map(([code, name]) => ({ code, name, count: distribution.publishTimeDistribution.find(item => item.code === code)?.contentCount ?? '0' })),
    ...distribution.publishTimeDistribution.filter(item => !TIME_BUCKETS.some(([code]) => code === item.code)).map(item => ({ code: item.code, name: item.name, count: item.contentCount })),
  ] : null;
  const chartMessage = state.distributions.loading ? '正在读取分布…' : state.distributions.error ? '分布读取失败' : panelMessage;

  return <div className="sm-industry sm-industry-remote" aria-busy={state.filters.loading}>
    <form className="sm-industry-filters sm-remote-filter-row" noValidate onSubmit={event => event.preventDefault()}>
      <label htmlFor={`${id}-industry`}>行业<select id={`${id}-industry`} disabled={!controlsReady || blocked} value={waiting && !store.hasManualScope ? '__pending__' : displayedCommon?.scopeId ?? ''} onChange={event => apply({ scopeType: event.target.value ? 'CATEGORY' : 'ALL', scopeId: event.target.value || undefined })}><option value="__pending__" disabled hidden>等待稿件行业识别…</option><option value="">全部行业</option>{invalidScope && <option value={state.common!.scopeId} disabled>原行业已失效，请重新选择</option>}{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label htmlFor={`${id}-model`}>模型<select id={`${id}-model`} disabled={!controlsReady || blocked || waiting || invalidScope} value={displayedCommon?.modelCode ?? 'all'} onChange={event => apply({ modelCode: event.target.value })}>{filters?.models.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select></label>
      <div className="sm-remote-filter-date"><label htmlFor={`${id}-date`}>日期</label><IndustryDateSelect id={`${id}-date`} value={selectedDate ?? { periodType: 'MONTH', date: '' }} minDate={filters?.minDate ?? null} maxDate={filters?.maxDate ?? null} disabled={!controlsReady || blocked || waiting || invalidScope} onChange={next => apply(next)}/></div>
    </form>
    {(state.filters.loading || !ready || blocked) && <div className="sm-industry-notice" role={state.filters.error && state.filters.error.status !== 'configuration_required' || blocked && state.blocked?.status !== 'configuration_required' ? 'alert' : 'status'}><div><strong>{state.filters.loading ? '正在读取行业筛选项…' : state.blocked?.message ?? state.filters.error?.message ?? (!contextReady ? '稿件授权上下文尚未就绪，暂不查询行业数据。' : invalidScope ? '原行业已失效，请重新选择。' : waiting && controlsReady ? '正在识别稿件行业，完成后加载；也可手动选择行业。' : '当前尚无可选执行日期，暂不查询行业数据。')}</strong>{blocked && <p>{initializeAfterCheck ? '连接恢复后将加载默认条件，并使用共享查询额度。' : '请先处理连接、权限或额度问题，再重新检查连接；检查本身不会查询媒体和内容列表。'}</p>}{state.filters.error && state.filters.error.status !== state.blocked?.status && <p>连接检查：{state.filters.error.message}</p>}</div>{(!waiting || blocked) && !state.filters.loading && <button type="button" className="button secondary" onClick={() => void store.checkAccess()}>{initializeAfterCheck ? '重新检查并加载' : '重新检查连接'}</button>}{state.blocked?.status === 'quota_exhausted' && filters?.maxDate && <button type="button" className="button secondary" disabled={busy || !contextReady || invalidScope} onClick={() => store.resumeAfterResolution()}>额度恢复后重新查询</button>}</div>}
    <IndustryCitationSources id={id} store={store} state={state} ready={ready} commonLabel={commonLabel} panelMessage={panelMessage}/>
    <section className="sm-industry-card sm-industry-distribution-section" aria-labelledby={`${id}-distribution`}><header className="sm-industry-card-heading"><h2 id={`${id}-distribution`}>信源分布</h2><p>范围：{commonLabel}。不随内容的媒体、类型或排序变化；各图使用各自统计分母。</p></header><FailureNotice error={state.distributions.error} retry={ready ? () => void store.retryDistributions() : undefined}/><div className="sm-industry-distributions"><section className="sm-industry-card"><header className="sm-industry-card-heading"><h3>类型分布</h3></header><SourceDonut title="媒体类型分布" slices={typeSlices} unit="次引用" pending={chartMessage}/></section><section className="sm-industry-card"><header className="sm-industry-card-heading"><h3>时间分布</h3></header><SourceDonut title="内容发布时间分布" slices={timeSlices} unit="项内容" pending={chartMessage}/></section></div><p className="sm-industry-chart-note">发布时间区间相对于数据源当前时间计算，未知包含缺失或未来日期。获取于 {when(state.distributions.fetchedAt)}；源端统计存在缓存，不保证实时更新。</p></section>
  </div>;
}
