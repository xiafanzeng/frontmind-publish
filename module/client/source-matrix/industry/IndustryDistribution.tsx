import { useEffect, useId, useMemo, useState } from 'react';
import type { SourceDistributionBatch, SourceDistributionResponse } from '../../../contracts/source-distribution';
import { matrixApi } from '../api';
import { UNKNOWN, contentGroups, defaultFilter, filterRecords, mediaKey, mediaRanking, percentageText, periodEnd, publicationDistribution, safeSourceUrl, typeDistribution, uniqueBatches, validDay, type ContentGroup, type DistributionFilter, type DistributionSlice } from './distribution';
import './industry-distribution.css';

type ViewState = DistributionFilter & { media: string; page: number; sort: string };
const PAGE_SIZE = 10;
const PARAMS = { industry: 'smIndustry', model: 'smModel', month: 'smMonth', start: 'smStart', end: 'smEnd', dateMode: 'smDateMode', media: 'smMedia', page: 'smPage', sort: 'smSort' } as const;
const SORTS = ['count-desc', 'count-asc', 'title', 'cited-desc'];

function readView(batches: SourceDistributionBatch[]): ViewState {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search), base = defaultFilter(batches);
  const value = (key: keyof typeof PARAMS, fallback = '') => params.get(PARAMS[key]) ?? fallback;
  const page = Number(value('page', '1'));
  return { industry: value('industry'), model: value('model'), month: value('month', base.month), start: value('start'), end: value('end'), dateMode: value('dateMode') === 'range' ? 'range' : 'month', media: value('media'), page: Number.isSafeInteger(page) && page > 0 ? page : 1, sort: SORTS.includes(value('sort')) ? value('sort') : 'count-desc' };
}

function writeView(state: ViewState) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const key of Object.keys(PARAMS) as (keyof typeof PARAMS)[]) {
    const value = String(state[key]);
    if (value || key === 'month') url.searchParams.set(PARAMS[key], value); else url.searchParams.delete(PARAMS[key]);
  }
  // Preserve the owning route's task, draft, version, workspace and hash.
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
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
  const invalidRange = view.dateMode === 'range' && (!!view.start && !validDay(view.start) || !!view.end && !validDay(view.end) || !!view.start && !!view.end && view.start > view.end);
  const rows = useMemo(() => invalidRange ? [] : filterRecords(sourceBatches, view), [sourceBatches, view.industry, view.model, view.month, view.start, view.end, view.dateMode, invalidRange]);
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
  const scopeLabel = view.dateMode === 'month' ? view.month || '全部已导入日期' : `${view.start || '最早已导入日期'} 至 ${view.end || '最晚已导入日期'}`;

  if (loading) return <section className="sm-industry sm-industry-status" role="status" aria-busy="true"><strong>正在读取行业信源分布…</strong><p>读取完成后显示当前授权数据的范围和统计口径。</p></section>;
  if (error) return <section className="sm-industry sm-industry-status" role="alert"><strong>暂时无法查看行业信源分布</strong><p>{error}</p>{onRetry && <button type="button" className="button secondary" onClick={onRetry}>重新读取</button>}</section>;
  if (!sourceBatches.length) return <section className="sm-industry sm-industry-status" role="status"><strong>暂无已导入的行业信源数据</strong><p>数据接入后可按行业、模型和日期查看；未导入不代表从未被引用。</p>{onRetry && <button type="button" className="button secondary" onClick={onRetry}>重新读取</button>}</section>;

  return <div className="sm-industry">
    <form className="sm-industry-filters" noValidate onSubmit={event => event.preventDefault()}>
      <label htmlFor={id + '-industry'}>行业<select id={id + '-industry'} value={view.industry} onChange={e => update({ industry: e.target.value, media: '' })}><option value="">全部行业 · 当前已导入</option>{industries.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label htmlFor={id + '-model'}>模型<select id={id + '-model'} value={view.model} onChange={e => update({ model: e.target.value, media: '' })}><option value="">全部模型</option>{models.map(model => <option key={model} value={model}>{model === UNKNOWN ? '模型未知' : model}</option>)}</select></label>
      <label htmlFor={id + '-date-mode'}>引用日期<select id={id + '-date-mode'} value={view.dateMode} onChange={e => update({ dateMode: e.target.value === 'range' ? 'range' : 'month', media: '' })}><option value="month">按月</option><option value="range">日期范围</option></select></label>
      {view.dateMode === 'month' ? <label htmlFor={id + '-month'}>月份<input id={id + '-month'} type="month" value={view.month} onChange={e => update({ month: e.target.value, media: '' })} /></label> : <><label htmlFor={id + '-start'}>开始日期<input id={id + '-start'} type="date" value={view.start} aria-invalid={invalidRange || undefined} aria-describedby={invalidRange ? id + '-date-error' : undefined} onChange={e => update({ start: e.target.value, media: '' })} /></label><label htmlFor={id + '-end'}>结束日期<input id={id + '-end'} type="date" value={view.end} aria-invalid={invalidRange || undefined} aria-describedby={invalidRange ? id + '-date-error' : undefined} onChange={e => update({ end: e.target.value, media: '' })} /></label></>}
      <button className="button secondary" type="button" onClick={() => update({ ...defaultFilter(sourceBatches), media: '', sort: 'count-desc' })}>重置筛选</button>
      {invalidRange && <p id={id + '-date-error'} className="sm-industry-error" role="alert">请填写有效日期，且开始日期不能晚于结束日期。</p>}
    </form>
    <p className="sm-industry-caption">{sourceBatches.map(b => b.label).join('、')} · 引用日期 {scopeLabel} · 全部行业仅包含当前已导入数据</p>
    <div className="sm-industry-summary" aria-live="polite"><div><small>媒体分组</small><strong>{rank.length.toLocaleString('zh-CN')}</strong><span>按媒体名称＋媒体 URL</span></div><div><small>内容 URL</small><strong>{urls.toLocaleString('zh-CN')}</strong><span>按原内容 URL 去重</span></div><div><small>原始导出引用记录</small><strong>{rows.length.toLocaleString('zh-CN')}</strong><span>保留文件中的重复明细行</span></div></div>
    <section className="sm-industry-card"><header className="sm-industry-card-heading"><div><h2>引用信源</h2><p>排行与内容占比均以当前行业、模型、引用日期范围的 {rows.length.toLocaleString('zh-CN')} 条记录为分母；选择媒体只筛内容表。</p></div></header>
      {!rows.length ? <div className="sm-industry-empty" role="status"><strong>{invalidRange ? '请先修正日期范围' : '当前筛选暂无导出记录'}</strong><p>可调整行业、模型或引用日期，或重置筛选。无记录的占比显示为“—”。</p></div> : <div className="sm-industry-sources"><aside className="sm-industry-ranking" aria-label="媒体引用排行"><div className="sm-industry-ranking-heading"><h3>媒体排行</h3><button type="button" className="link small" onClick={() => update({ media: '' })} disabled={!selected}>全部媒体</button></div><ol>{rank.map((group, index) => <li key={group.key}><button type="button" aria-pressed={selected?.key === group.key} onClick={() => update({ media: selected?.key === group.key ? '' : group.key })}><span className="sm-industry-rank">{index + 1}</span><span className="sm-industry-media"><strong>{group.name || group.domain}</strong><small>{group.domain}</small></span><span className="sm-industry-rank-count"><strong>{group.count}</strong><small>{percentageText(group.share)}</small></span></button></li>)}</ol></aside>
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
