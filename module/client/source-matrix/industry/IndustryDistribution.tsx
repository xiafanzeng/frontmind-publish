import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SourceDistributionBatch, SourceDistributionResponse } from '../../../contracts/source-distribution';
import { matrixApi } from '../api';
import { UNKNOWN, contentGroups, defaultFilter, filterRecords, mediaKey, mediaRanking, percentageText, periodEnd, periodsFor, periodRange, publicationDistribution, safeSourceUrl, typeDistribution, uniqueBatches, validDay, type ContentGroup, type DistributionFilter, type DistributionSlice, type PeriodGranularity, type PeriodOption } from './distribution';
import './industry-distribution.css';

type ViewState = DistributionFilter & { media: string; page: number; sort: string };
const PAGE_SIZE = 10;
const PARAMS = { industry: 'smIndustry', model: 'smModel', granularity: 'smGranularity', period: 'smPeriod', media: 'smMedia', page: 'smPage', sort: 'smSort' } as const;
const SORTS = ['count-desc', 'count-asc', 'title', 'cited-desc'];
const GRANULARITIES: Array<{ key: PeriodGranularity; label: string }> = [{ key: 'day', label: '按日' }, { key: 'week', label: '按周' }, { key: 'month', label: '按月' }];

function readView(batches: SourceDistributionBatch[]): ViewState {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search), base = defaultFilter(batches);
  const value = (key: keyof typeof PARAMS, fallback = '') => params.get(PARAMS[key]) ?? fallback;
  const page = Number(value('page', '1'));
  const rawGranularity = value('granularity') as PeriodGranularity;
  const granularity: PeriodGranularity = ['day', 'week', 'month'].includes(rawGranularity) ? rawGranularity : base.granularity;
  const periods = periodsFor(batches, granularity, value('industry'));
  const period = periods.some(option => option.value === value('period')) ? value('period') : periods[0]?.value ?? '';
  return { industry: value('industry'), model: value('model'), granularity, period, media: value('media'), page: Number.isSafeInteger(page) && page > 0 ? page : 1, sort: SORTS.includes(value('sort')) ? value('sort') : 'count-desc' };
}

function writeView(state: ViewState) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const key of Object.keys(PARAMS) as (keyof typeof PARAMS)[]) {
    const value = String(state[key]);
    if (value) url.searchParams.set(PARAMS[key], value); else url.searchParams.delete(PARAMS[key]);
  }
  // Preserve the owning route's task, draft, version, workspace and hash.
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

/** 图2 日期控件：单一复合下拉，同一弹层切换按日/按周/按月并选择周期。 */
function PeriodSelect({ id, granularity, period, periods, onSelect }: { id: string; granularity: PeriodGranularity; period: string; periods: PeriodOption[]; onSelect: (next: { granularity: PeriodGranularity; period: string }) => void }) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), popover = useRef<HTMLDivElement>(null);
  const selectedLabel = periods.find(option => option.value === period)?.label ?? (period || '全部日期');
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    const onClick = (event: MouseEvent) => { if (popover.current && !popover.current.contains(event.target as Node) && trigger.current !== event.target) setOpen(false); };
    document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onClick);
    popover.current?.querySelector<HTMLButtonElement>('li button')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);
  return <div className="sm-date-select" onKeyDown={event => { if (event.key === 'Escape' && open) { setOpen(false); trigger.current?.focus(); } }}>
    <span className="sm-date-label" aria-hidden="true">日期</span>
    <button ref={trigger} id={id + '-date'} type="button" className="sm-date-trigger" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {GRANULARITIES.find(item => item.key === granularity)?.label} · {selectedLabel}<span aria-hidden="true">▾</span>
    </button>
    {open && <div ref={popover} className="sm-date-popover" role="dialog" aria-label="选择日期周期">
      <div className="sm-date-granularity" role="tablist" aria-label="日期粒度">{GRANULARITIES.map(item => <button key={item.key} type="button" role="tab" aria-selected={granularity === item.key} className={granularity === item.key ? 'active' : ''} onClick={() => onSelect({ granularity: item.key, period: '' })}>{item.label}</button>)}</div>
      <ul>{periods.length ? periods.map(option => <li key={option.value}><button type="button" aria-pressed={option.value === period} className={option.value === period ? 'active' : ''} onClick={() => { onSelect({ granularity, period: option.value }); setOpen(false); trigger.current?.focus(); }}><span className="sm-date-option-label">{option.label}</span><span className="sm-date-option-range">{option.start} 至 {option.end}</span><span className="sm-date-option-count">{option.count} 条</span>{option.value === period && <span aria-hidden="true" className="sm-date-check">✓</span>}</button></li>) : <li className="sm-date-empty">当前范围没有可选周期</li>}</ul>
      <p className="sm-date-note">周期由已导入数据的引用日期归纳；按周为周一至周日。切换粒度后默认选择最近周期。</p>
    </div>}
  </div>;
}

const COLORS = ['var(--brand,#b33467)', 'var(--plum,#4c1467)', 'var(--x-good,#20815b)', 'var(--x-warning,#aa7227)', 'var(--muted,#737991)', '#7c5689', '#bbc0ce'];
function Donut({ slices, total, unit, title }: { slices: DistributionSlice[]; total: number; unit: string; title: string }) {
  let start = 0;
  const segments = slices.flatMap((slice, index) => {
    const end = start + (slice.share ?? 0) * 100, color = slice.key === 'unknown' || slice.label === '未知' ? '#bbc0ce' : COLORS[index % COLORS.length]!;
    const segment = slice.count > 0 ? `${color} ${start}% ${end}%` : null;
    start = end;
    return segment ? [segment] : [];
  });
  return <div className="sm-industry-chart"><div className="sm-industry-ring" role="img" aria-label={`${title}，${total ? slices.map(s => `${s.label} ${s.count}${unit} ${percentageText(s.share)}`).join('；') : '无数据'}`} style={{ background: total ? `conic-gradient(${segments.join(',')})` : 'var(--line,#e6e8f1)' }}><div><strong>{total.toLocaleString('zh-CN')}</strong><span>{unit}</span></div></div><ul className="sm-industry-legend">{slices.map((slice, index) => <li key={slice.key}><span className="sm-industry-dot" aria-hidden="true" style={{ background: slice.key === 'unknown' || slice.label === '未知' ? '#bbc0ce' : COLORS[index % COLORS.length] }} /><span>{slice.label}</span><strong>{slice.count.toLocaleString('zh-CN')}</strong><span>{percentageText(slice.share)}</span></li>)}</ul></div>;
}

function ContentTrace({ content }: { content: ContentGroup }) {
  const [open, setOpen] = useState(false);
  return <details className="sm-industry-trace" onToggle={event => setOpen(event.currentTarget.open)}><summary>查看 {content.records.length} 条导出记录</summary>{open && <ul>{content.records.map((record, index) => <li key={record.sourceSha256 + ':' + record.id + ':' + index}><strong>{record.sourceFile ?? '来源文件未提供'} · {record.sourceSheet ?? '工作表未知'} · {record.sourceRow === null ? '行号未知' : `第 ${record.sourceRow} 行`}</strong><span>引用日期：{record.citedAt ?? '未知'} · 模型：{record.model ?? '未知'}</span><span>监控问题：{record.question ?? '未知'}</span><span>媒体原值：{record.mediaName ?? '（名称为空）'} · {record.mediaUrl ?? '（媒体 URL 为空）'}</span><span>标题原值：{record.title ?? '（为空）'}</span><span>内容 URL：{record.url ?? '（为空）'}</span><span>类型：{record.mediaType ?? '未知'} · 发布时间：{record.publishedAt ?? '未知'} · 内容状态：{record.contentStatus ?? '未知'}</span></li>)}</ul>}</details>;
}

export function IndustryDistribution({ batches, loading = false, error, onRetry }: { batches: SourceDistributionBatch[]; loading?: boolean; error?: string | null; onRetry?: () => void }) {
  const id = useId(), sourceBatches = useMemo(() => uniqueBatches(batches), [batches]);
  const [savedView, setSavedView] = useState<ViewState | null>(null);
  const view = savedView ?? readView(sourceBatches);
  useEffect(() => {
    const onPopState = () => setSavedView(readView(sourceBatches));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [sourceBatches]);
  function update(patch: Partial<ViewState>, reset = true) {
    const next = { ...view, ...(reset ? { page: 1 } : {}), ...patch };
    setSavedView(next); writeView(next);
  }
  const periodOptions = useMemo(() => periodsFor(sourceBatches, view.granularity, view.industry), [sourceBatches, view.granularity, view.industry]);
  const rows = useMemo(() => filterRecords(sourceBatches, view), [sourceBatches, view]);
  const rank = useMemo(() => mediaRanking(rows), [rows]);
  const selected = rank.find(group => group.key === view.media);
  const fullContents = useMemo(() => contentGroups(rows), [rows]);
  const selectedRows = selected ? rows.filter(record => mediaKey(record) === selected.key) : rows;
  const contents = contentGroups(selectedRows, rows.length);
  const sorted = [...contents].sort((a, b) => view.sort === 'count-asc' ? a.count - b.count || a.key.localeCompare(b.key, 'zh-CN') : view.sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') || a.key.localeCompare(b.key, 'zh-CN') : view.sort === 'cited-desc' ? (b.records.map(r => r.citedAt ?? '').sort().at(-1) ?? '').localeCompare(a.records.map(r => r.citedAt ?? '').sort().at(-1) ?? '') || b.count - a.count : b.count - a.count || a.key.localeCompare(b.key, 'zh-CN'));
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE)), page = Math.min(view.page, pages), shown = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const industries = [...new Map(sourceBatches.map(b => [b.industryId ?? UNKNOWN, b.industryName ?? (b.industryId ? '行业名称未提供' : '未分类')])).entries()];
  const models = [...new Set(sourceBatches.flatMap(b => b.records.map(r => r.model ?? UNKNOWN)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const end = periodEnd(sourceBatches, view), types = typeDistribution(rows), times = publicationDistribution(fullContents, end), urls = fullContents.filter(c => c.url).length;
  const missingUrls = fullContents.filter(c => !c.url).reduce((n, c) => n + c.count, 0);
  const range = periodRange(view), scopeLabel = range ? `${range.start} 至 ${range.end}` : '全部已导入日期';

  if (loading) return <section className="sm-industry sm-industry-status" role="status" aria-busy="true"><strong>正在读取行业信源分布…</strong><p>读取完成后显示当前授权数据的范围和统计口径。</p></section>;
  if (error) return <section className="sm-industry sm-industry-status" role="alert"><strong>暂时无法查看行业信源分布</strong><p>{error}</p>{onRetry && <button type="button" className="button secondary" onClick={onRetry}>重新读取</button>}</section>;
  if (!sourceBatches.length) return <section className="sm-industry sm-industry-status" role="status"><strong>暂无已导入的行业信源数据</strong><p>数据接入后可按行业、模型和日期查看；未导入不代表从未被引用。</p>{onRetry && <button type="button" className="button secondary" onClick={onRetry}>重新读取</button>}</section>;

  return <div className="sm-industry">
    <form className="sm-industry-filters" noValidate onSubmit={event => event.preventDefault()}>
      <label htmlFor={id + '-industry'}>行业<select id={id + '-industry'} value={view.industry} onChange={e => update({ industry: e.target.value, media: '' })}><option value="">全部行业</option>{industries.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label htmlFor={id + '-model'}>模型<select id={id + '-model'} value={view.model} onChange={e => update({ model: e.target.value, media: '' })}><option value="">全部模型</option>{models.map(model => <option key={model} value={model}>{model === UNKNOWN ? '模型未知' : model}</option>)}</select></label>
      <PeriodSelect id={id} granularity={view.granularity} period={view.period} periods={periodOptions} onSelect={next => update({ granularity: next.granularity, period: next.period || periodsFor(sourceBatches, next.granularity, view.industry)[0]?.value || view.period, media: '' })} />
    </form>
    <p className="sm-industry-caption">{sourceBatches.map(b => b.label).join('、')} · 引用日期 {scopeLabel}</p>
    <section className="sm-industry-card"><header className="sm-industry-card-heading"><div><h2>引用信源</h2><p>媒体 {rank.length.toLocaleString('zh-CN')} · 内容 {urls.toLocaleString('zh-CN')} · 引用 {rows.length.toLocaleString('zh-CN')} 条记录 · 排行与内容占比以当前筛选为分母；选择媒体只筛内容表。</p></div></header>
      {!rows.length ? <div className="sm-industry-empty" role="status"><strong>当前筛选暂无导出记录</strong><p>可调整行业、模型或日期周期。无记录的占比显示为“—”。</p></div> : <div className="sm-industry-sources"><aside className="sm-industry-ranking" aria-label="媒体引用排行"><div className="sm-industry-ranking-heading"><h3>媒体排行</h3><button type="button" className="link small" onClick={() => update({ media: '' })} disabled={!selected}>全部媒体</button></div><ol>{rank.map((group, index) => <li key={group.key}><button type="button" aria-pressed={selected?.key === group.key} onClick={() => update({ media: selected?.key === group.key ? '' : group.key })}><span className="sm-industry-rank">{index + 1}</span><span className="sm-industry-media"><strong>{group.name || group.domain}</strong><small>{group.domain}</small></span><span className="sm-industry-rank-count"><strong>{group.count}</strong><small>{percentageText(group.share)}</small></span></button></li>)}</ol></aside>
        <div className="sm-industry-content"><header className="sm-industry-content-heading"><div><h3>引用内容</h3><p>{selected ? `${selected.name || selected.domain} · ${selected.domain}` : '全部媒体'} · {contents.length} 项内容{selected && ' · 占比仍按全筛选范围计算'}</p></div>{selected && <button type="button" className="link small" onClick={() => update({ media: '' })}>返回全部媒体</button>}<label htmlFor={id + '-sort'}>排序<select id={id + '-sort'} value={view.sort} onChange={e => update({ sort: e.target.value })}><option value="count-desc">引用次数从多到少</option><option value="count-asc">引用次数从少到多</option><option value="title">内容标题</option><option value="cited-desc">最近引用日期</option></select></label></header>
          <div className="sm-industry-table-wrap"><table><caption className="sr">当前筛选的引用内容；点击记录可追溯原工作表行，打开链接将前往原内容。</caption><thead><tr><th scope="col">序号</th><th scope="col">内容标题 / 原文</th><th scope="col">媒体名称</th><th scope="col">媒体类型</th><th scope="col" aria-sort={view.sort === 'count-desc' ? 'descending' : view.sort === 'count-asc' ? 'ascending' : 'none'}><button type="button" onClick={() => update({ sort: view.sort === 'count-desc' ? 'count-asc' : 'count-desc' })}>引用次数 {view.sort === 'count-desc' ? '↓' : view.sort === 'count-asc' ? '↑' : '↕'}</button></th><th scope="col">引用占比</th></tr></thead><tbody>{shown.map((content, index) => <tr key={content.key}><td>{(page - 1) * PAGE_SIZE + index + 1}</td><td>{safeSourceUrl(content.url) ? <a className="sm-industry-title" href={safeSourceUrl(content.url)} target="_blank" rel="noopener noreferrer">{content.title}<span aria-label="在新窗口打开原文"> ↗</span></a> : <strong className="sm-industry-title">{content.title}</strong>}<span className="sm-industry-content-status">{content.status}</span>{!content.url && <span className="sm-industry-content-status">缺内容 URL · 保留原始行</span>}<ContentTrace content={content}/></td><td>{content.media}</td><td>{content.type}</td><td>{content.count}</td><td>{percentageText(content.share)}</td></tr>)}</tbody></table></div>
          <nav className="sm-industry-pagination" aria-label="引用内容分页"><span>共 {sorted.length} 项 · 第 {page} / {pages} 页 · 每页 {PAGE_SIZE} 项</span><button type="button" className="button secondary" disabled={page <= 1} onClick={() => update({ page: page - 1 }, false)}>上一页</button><button type="button" className="button secondary" disabled={page >= pages} onClick={() => update({ page: page + 1 }, false)}>下一页</button></nav>
        </div></div>}
    </section>
    <div className="sm-industry-distributions"><section className="sm-industry-card"><header className="sm-industry-card-heading"><div><h2>类型分布</h2><p>统计单位：全筛选范围的引用记录 · 分母 {rows.length} 条</p></div></header><Donut title="媒体类型分布" slices={types} total={rows.length} unit="条记录"/>{types.some(s => s.label === '未知') && <p className="sm-industry-chart-note">未提供可信媒体类型的记录计入未知，不按名称、域名或文章标题猜测分类。</p>}</section><section className="sm-industry-card"><header className="sm-industry-card-heading"><div><h2>发布时间分布</h2><p>统计单位：全筛选范围的去重内容 URL · 分母 {urls} 项</p></div></header><Donut title="内容发布时间分布" slices={times} total={urls} unit="项内容"/><p className="sm-industry-chart-note">基准日：{end ?? '未知'}（所选统计期间末日）。按日差互斥分组；发布时间缺失、冲突或晚于基准日计入未知。引用日期不作为发布时间。{missingUrls > 0 && ` ${missingUrls} 条缺内容 URL 的记录不纳入此图。`}</p></section></div>
    <details className="sm-industry-provenance"><summary>数据范围、原始文件与限制</summary><p>以上数字描述导出数据构成，不代表 AI 回答引用率、未来引用概率或媒体采购资格。媒体选中不改变两张分布图的全筛选范围。</p>{sourceBatches.map(batch => <div key={batch.sourceSha256}><strong>{batch.label} · {batch.sourceFile ?? '文件名未提供'}</strong><p>原统计区间：{batch.period.start ?? '未知'} 至 {batch.period.end ?? '未知'} · 原始记录 {batch.records.length} 条</p><p>版本：{batch.version}<br/>SHA-256：{batch.sourceSha256}</p><ul>{batch.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>)}{batches.length > sourceBatches.length && <p>已按文件指纹忽略 {batches.length - sourceBatches.length} 个重复批次，保留每个原始文件内的全部明细行。</p>}</details>
  </div>;
}

export function LiveIndustryDistribution() {
  const [reload, setReload] = useState(0), [state, setState] = useState<{ batches: SourceDistributionBatch[]; loading: boolean; error: string | null }>({ batches: [], loading: true, error: null });
  useEffect(() => {
    const controller = new AbortController(); let current = true, timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    setState({ batches: [], loading: true, error: null });
    void matrixApi<SourceDistributionResponse>('/source-distribution', controller.signal).then(response => {
      if (!current) return;
      if (response.status !== 'ready' || !Array.isArray(response.batches)) { setState({ batches: [], loading: false, error: response.message || '当前授权范围暂无可查看的行业信源数据，请稍后重新读取。' }); return; }
      setState({ batches: response.batches, loading: false, error: null });
    }).catch(() => {
      if (current) setState({ batches: [], loading: false, error: timedOut ? '读取超时，请重新读取。' : '行业信源数据读取失败，请稍后重新读取。' });
    }).finally(() => window.clearTimeout(timer));
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [reload]);
  return <IndustryDistribution {...state} onRetry={() => setReload(value => value + 1)}/>;
}
