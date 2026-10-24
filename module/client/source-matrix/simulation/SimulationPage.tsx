/** Workbook-backed research preview. No synthetic catalog, decisions, quotes or live writes. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { projectWorkspaceUrl } from '../../host';
import type { SourceDistributionRecord } from '../../../contracts/source-distribution';
import { IndustryDistribution } from '../industry/IndustryDistribution';
import { YIHANG_SOURCE_BATCH } from '../industry/yihang';
import { MediaCartFooter, MediaDialog, MediaShell } from '../MediaMarket';
import './sample.css';

type MatrixView = 'matrix' | 'analysis' | 'industry' | 'report';
type SampleSource = { id: string; name: string; domain: string; records: SourceDistributionRecord[] };
const layers = [
  ['权威参考层', '品牌背景与专业参考'], ['行业核心层', '行业知识与目标问题'],
  ['地域覆盖层', '地区范围与目标受众'], ['覆盖补充层', '补充尚未覆盖的信息'],
  ['探索验证层', '待验证的增量价值'],
] as const;
function safeUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined; }
  catch { return undefined; }
}
function sampleSources(): SampleSource[] {
  const groups = new Map<string, SampleSource>();
  for (const row of YIHANG_SOURCE_BATCH.records) {
    // Workbook grouping is not a verified purchasable-media identity.
    const id = JSON.stringify([row.mediaName, row.mediaUrl]);
    let group = groups.get(id);
    if (!group) { group = { id, name: row.mediaName || row.mediaUrl || '名称未提供', domain: row.mediaUrl || '域名未提供', records: [] }; groups.set(id, group); }
    group.records.push(row);
  }
  return [...groups.values()].sort((a, b) => b.records.length - a.records.length || a.name.localeCompare(b.name, 'zh-CN'));
}

export default function SimulationPage({ view = 'analysis' }: { view?: MatrixView }) {
  const search = useSearch(), current = view === 'matrix' || view === 'report' ? 'matrix' : 'analysis';
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [detail, setDetail] = useState<SampleSource | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const openDetail = (source: SampleSource) => { detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDetail(source); };
  useEffect(() => { if (!detail) detailTrigger.current?.focus({ preventScroll: true }); }, [detail]);
  const sources = useMemo(sampleSources, []);
  const filtered = useMemo(() => sources.filter(source => `${source.name} ${source.domain}`.toLocaleLowerCase('zh-CN').includes(query.trim().toLocaleLowerCase('zh-CN'))), [sources, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 12)), currentPage = Math.min(page, pageCount);
  const href = (tab: 'analysis' | 'matrix') => { const params = new URLSearchParams(search); params.set('simulation', '1'); params.set('tab', tab); return projectWorkspaceUrl(`/publishing/source-matrix?${params}`) + (typeof window !== 'undefined' ? window.location.hash : ''); };
  useEffect(() => { document.title = `${current === 'analysis' ? '行业信源分布' : '信源矩阵推荐'} · 一航软件样本 · FrontMind`; }, [current]);
  return <MediaShell title="信源矩阵" note="一航软件样本 · 2026-09-07 至 2026-09-13 · 原始导出记录，仅供分析研究"
    dialogs={<MediaDialog open={!!detail} title={detail ? `${detail.name} · 样本依据` : '样本依据'} confirmLabel="关闭" onCancel={() => setDetail(null)} onConfirm={() => setDetail(null)} footer={<button className="button primary" type="button" onClick={() => setDetail(null)}>关闭</button>}>
      {detail && <div className="sm-sample-evidence">
        <p>该来源出现在当前导出样本中；这不证明该来源可售、当前稿件已被引用，或未来会被引用。</p>
        <dl><dt>原始来源分组</dt><dd>{detail.name} · {detail.domain}</dd><dt>原始导出引用记录</dt><dd>{detail.records.length} 条</dd><dt>身份与推荐角色</dt><dd>具体账号、可售资源与分层均待确认</dd></dl>
        <p className="small muted">下列行号仅用于追溯。重复行原样保留，不能据此断言是不同回答。</p>
        <div className="table-wrap"><table><thead><tr><th>原始位置</th><th>引用日期 / 模型</th><th>问题 / 内容</th></tr></thead><tbody>{detail.records.map(record => <tr key={record.id}><td>{record.sourceSheet} · 第 {record.sourceRow} 行</td><td>{record.citedAt || '未知'}<br />{record.model || '未知'}</td><td>{record.question || '未提供'}<br />{safeUrl(record.url) ? <a href={safeUrl(record.url)} target="_blank" rel="noopener noreferrer">{record.title || record.url}</a> : record.title || '标题未提供'}</td></tr>)}</tbody></table></div>
      </div>}
    </MediaDialog>}>
    <nav className="x-matrix-nav" aria-label="信源矩阵子板块">
      <Link href={href('analysis')} className={current === 'analysis' ? 'active' : ''} aria-current={current === 'analysis' ? 'page' : undefined}>行业信源分布</Link>
      <Link href={href('matrix')} className={current === 'matrix' ? 'active' : ''} aria-current={current === 'matrix' ? 'page' : undefined}>信源矩阵推荐</Link>
    </nav>
    {current === 'analysis' ? <IndustryDistribution batches={[YIHANG_SOURCE_BATCH]} /> : <div className="sm-sample">
      <div className="sm-sample-context"><strong>一航软件样本</strong><span>行业：未分类</span><span>目标问题：第三方软件测试机构推荐</span></div>
      <div className="sm-sample-columns">
        <section className="sm-sample-matrix" aria-label="完整信源矩阵">
          <h2>完整信源矩阵</h2><p className="small muted">当前样本缺少行业确认、具体资源身份与适配判断；先保留全部来源，等待可信数据补充后分层。</p>
          {layers.map(([name, purpose]) => <section className="sm-sample-layer" key={name}><div><h3>{name}</h3><p>{purpose}</p></div><span>暂无已验证候选</span></section>)}
          <section className="sm-sample-research">
            <div className="sm-sample-research-head"><div><h2>尚未分层的样本来源</h2><p className="small muted">{sources.length} 个媒体分组 · 按原始导出引用次数排列，非适配排名</p></div><label className="sm-sample-search">搜索样本来源<div><input aria-label="搜索样本来源" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="名称或域名" />{query && <button type="button" aria-label="清空来源搜索" onClick={event => { setQuery(''); setPage(1); event.currentTarget.parentElement?.querySelector('input')?.focus(); }}>清空</button>}</div></label></div>
            <div className="sm-sample-cards">{filtered.slice((currentPage - 1) * 12, currentPage * 12).map(source => <article className="sm-sample-source" key={source.id}><h3>{source.name}</h3><p className="small muted">{source.domain}</p><p>样本记录 {source.records.length} 条</p><p className="small muted">仅供研究 · 角色待确认 · 待询价</p><button className="link" type="button" onClick={() => openDetail(source)}>查看样本依据</button></article>)}</div>
            {!filtered.length && <p className="x-empty" role="status">没有匹配的样本来源，请调整或清空搜索。</p>}
            {filtered.length > 0 && <div className="sm-sample-pagination"><button type="button" className="button secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span aria-live="polite">第 {currentPage} / {pageCount} 页 · {filtered.length} 个分组</span><button type="button" className="button secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
          </section>
        </section>
        <aside className="sm-sample-budget panel panel-pad" aria-label="组合推荐"><h2>组合推荐</h2><p>先完成来源适配，再根据预算选择组合。</p><dl><dt>可售资源匹配</dt><dd>待确认</dd><dt>报价与附加费</dt><dd>待询价</dd><dt>稿件版本与预检</dt><dd>未提供</dd></dl><p className="small muted">此文件仅包含历史引用数据，暂不能核算发布组合。切换真实模式后，可使用已配置行业与真实报价生成推荐。</p><button type="button" className="button primary" disabled>生成组合推荐</button></aside>
      </div>
    </div>}
    <MediaCartFooter count={0} researchNotice="样本没有可售资源或报价，不加入发布购物车。真实购物车保留不变，切回真实模式查看。" />
  </MediaShell>;
}
