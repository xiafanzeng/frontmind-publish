import { useEffect, useRef, useState } from "react";
import { PublishingRemark } from "../components/PublishingRemark";
import { formatPublishingMoney } from "../types";
import { Link } from "wouter";
import { projectWorkspaceUrl, usePublishingWorkspaceKey } from "../host";
import type { MediaRules, RulePreflight } from "../../server/providers/kol/media-rules";
import "../publishing.requirements.css";

type Media = { id: string; externalResourceId: string; name: string; price: string; rules: MediaRules };
type Catalog = { items: Media[]; page: number; hasMore: boolean };
const api = "/api/modules/publish/media-requirements";
async function request<T>(path: string, input?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(api + path, { credentials: "same-origin", signal,
    ...(input === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? "媒体要求服务不可用，请重试。");
  return body as T;
}
const fieldNames: Record<string, string> = { title_chars: "标题字符", body_chars: "正文字符", images: "图片数量", links: "链接数量", editorial: "其他要求", article: "稿件内容" };
const statusNames = { pass: "通过", fail: "未通过", needs_review: "待人工复核" };
const stateNames = { constrained: "有限制", explicitly_unlimited: "明确不限", unknown: "未明确", conflict: "规则冲突" };

export default function MediaRequirementsPage() {
  const workspace = usePublishingWorkspaceKey();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState<Catalog>();
  const [selected, setSelected] = useState<Media>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fileName, setFileName] = useState("待检稿件");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState("0");
  const [links, setLinks] = useState("0");
  const [collectPage, setCollectPage] = useState("1");
  const [result, setResult] = useState<RulePreflight>();
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const requestScope = useRef(0);
  useEffect(() => {
    setTitle(""); setBody(""); setImages("0"); setLinks("0");
    setFileName("待检稿件"); setNotice(""); setResult(undefined); setBusy(false);
  }, [workspace]);
  useEffect(() => {
    const abort = new AbortController();
    const scope = ++requestScope.current;
    setLoading(true); setError(""); setCatalog(undefined); setSelected(undefined); setResult(undefined);
    request<Catalog>(`?page=${page}`, undefined, abort.signal).then(data => {
      if (requestScope.current !== scope) return;
      setCatalog(data); setSelected(data.items[0]);
    }).catch(error => { if (!abort.signal.aborted) setError(error.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => { abort.abort(); ++requestScope.current; };
  }, [page, revision, workspace]);
  useEffect(() => { setResult(undefined); }, [selected, title, body, images, links]);
  const check = async () => {
    if (!selected || busy) return;
    const imageCount = Number(images), linkCount = Number(links);
    if (!images.trim() || !links.trim() || ![imageCount, linkCount].every(x => Number.isInteger(x) && x >= 0 && x <= 10000)) {
      setError("图片和链接数量须为 0 至 10000 的整数。"); return;
    }
    setBusy(true); setError(""); setNotice("");
    const scope = requestScope.current;
    try {
      const next = await request<RulePreflight>("/preflight", { mediaId: selected.id, title, body, images: imageCount, links: linkCount });
      if (scope === requestScope.current) setResult(next);
    } catch (error) { if (scope === requestScope.current) setError(error instanceof Error ? error.message : "预检失败"); }
    finally { if (scope === requestScope.current) setBusy(false); }
  };
  const collect = async () => {
    if (busy) return;
    const value = Number(collectPage);
    if (!Number.isInteger(value) || value < 1 || value > 100000) { setError("请填写有效的官方目录页码。"); return; }
    setBusy(true); setError(""); setNotice(""); setResult(undefined);
    const scope = requestScope.current;
    try {
      const data = await request<{ collected: number; matched: number; pagination: { lastPage: number } }>("/collect", { page: value });
      if (scope !== requestScope.current) return;
      setNotice(`已采集官方目录第 ${value} 页，共 ${data.collected} 条，更新 ${data.matched} 个已有媒体档案。官方目录共 ${data.pagination.lastPage} 页。`);
      setRevision(x => x + 1);
    } catch (error) { if (scope === requestScope.current) setError(error instanceof Error ? error.message : "采集失败"); }
    finally { if (scope === requestScope.current) setBusy(false); }
  };
  const fix = (field: string) => {
    setResult(undefined);
    setNotice("请修正稿件实际内容或数量，完成后重新预检。其他媒体的稿件和订单不会在此页修改。");
    if (field === "title_chars") titleRef.current?.focus();
    else if (field === "body_chars" || field === "article") bodyRef.current?.focus();
    else (document.getElementById(`requirements-${field}`) ?? bodyRef.current)?.focus();
  };
  const visibleMedia = catalog?.items.filter(media => `${media.name} ${media.externalResourceId}`.toLocaleLowerCase("zh-CN").includes(filter.toLocaleLowerCase("zh-CN"))) ?? [];
  return <main className="publishing-page publishing-requirements">
    <header className="requirements-heading"><div><span className="requirements-kicker">发布前核对</span><h1>媒体要求与稿件预检</h1><p>查看官方发布备注，修正实际稿件，逐项核对后重新预检。</p></div><Link className="publishing-button publishing-button-secondary" href={projectWorkspaceUrl("/publishing")}>返回工作台</Link></header>
    <nav className="requirements-nav" aria-label="媒体市场导航"><Link href={projectWorkspaceUrl("/publishing/media")}>媒体市场</Link><span aria-current="page">媒体要求与预检</span></nav>
    <section className="requirements-panel requirements-source" aria-label="规则来源">
      <div><span className="requirements-kicker">规则来源</span><h2>软文街官方 API 档案</h2><p>当前展示已采集的官方目录缓存，实时连接状态需点击更新确认。未提及不等于不限；Unicode 字符计数含空白及标点，未确认口径时需人工复核。</p></div>
      <div className="requirements-actions"><label>官方目录页码<input value={collectPage} inputMode="numeric" onChange={e => setCollectPage(e.target.value)} disabled={busy}/></label><button type="button" disabled={busy || loading} onClick={collect}>从官方 API 更新该页</button><button type="button" disabled={busy || loading} onClick={() => setRevision(x => x + 1)}>刷新档案</button></div>
    </section>
    <div className="requirements-feedback" aria-live="polite">{error && <p role="alert">{error}</p>}{notice && <p>{notice}</p>}{loading && <p>正在读取媒体规则…</p>}{busy && <p>正在处理，请稍候…</p>}</div>
    <div className="requirements-layout"><div className="requirements-main">
    <section className="requirements-catalog" aria-label="媒体列表" aria-busy={loading}>
      <header className="requirements-section-heading"><div><span className="requirements-stage">01</span><h2>选择目标媒体</h2></div><label className="requirements-search"><span className="publishing-visually-hidden">筛选本页媒体</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="筛选本页媒体名称或编号"/>{filter && <button type="button" aria-label="清空本页媒体筛选" onClick={event => { setFilter(""); event.currentTarget.parentElement?.querySelector("input")?.focus(); }}>×</button>}</label></header>
      {!loading && !error && catalog?.items.length === 0 && <div className="requirements-empty"><strong>暂无已同步媒体档案</strong><p>请管理员完成官方目录同步后刷新，不会显示替代规则。</p></div>}
      {!loading && !!catalog?.items.length && !visibleMedia.length && <div className="requirements-empty"><strong>本页暂无匹配媒体</strong><p>清空筛选或翻页查看其他媒体；当前目标媒体不会因此改变。</p><button type="button" onClick={() => setFilter("")}>清空本页筛选</button></div>}
      <div className="requirements-market">{visibleMedia.map(media => <article className="requirements-market-row" key={media.id} data-selected={selected?.id === media.id}>
        <div className="requirements-identity"><span className="requirements-mark" aria-hidden="true">{media.name.slice(0, 1)}</span><div><h3>{media.name}</h3><small>媒体编号 {media.externalResourceId}</small><label className="requirements-radio"><input type="radio" name="requirements-media" checked={selected?.id === media.id} disabled={busy} onChange={() => setSelected(media)}/>{selected?.id === media.id ? "当前目标媒体" : "选择此媒体"}</label></div></div>
        <div className="requirements-price"><strong>{formatPublishingMoney(media.price)}</strong><small>档案参考价</small></div>
        <div className="requirements-facts"><div className="requirements-rule-tags">{media.rules.rules.map(rule => <span className="requirements-tag" key={rule.field}>{fieldNames[rule.field]}：{stateNames[rule.state]}{rule.max !== undefined ? ` ${rule.exclusive ? "<" : "≤"}${rule.max}` : ""}</span>)}</div><PublishingRemark text={media.rules.rawRemark}/><small>采集时间：{media.rules.collectedAt}</small><details><summary>查看原始来源</summary><p>来源：{media.rules.source}</p><p>{media.rules.rawRemark || "官方备注为空，限制未知"}</p></details></div>
      </article>)}</div>
    </section>
    <nav className="requirements-pagination" aria-label="媒体分页"><span>第 {page} 页 · 每页最多 25 条</span><div><button type="button" disabled={page <= 1 || loading || busy} onClick={() => setPage(x => x - 1)}>上一页</button><button type="button" disabled={!catalog?.hasMore || loading || busy} onClick={() => setPage(x => x + 1)}>下一页</button></div></nav>
    <section className="requirements-panel requirements-edit" id="requirements-edit" aria-label="稿件预检输入">
      <header className="requirements-section-heading"><div><span className="requirements-stage">02</span><h2>要求核对与稿件编辑</h2></div><span className="requirements-badge">官方要求只读</span></header>
      <p>{selected ? `目标媒体：${selected.name}` : "请先选择媒体"}。编辑下方实际稿件，不覆盖官方规则。</p>
      {selected && <dl className="requirements-rule-grid">{selected.rules.rules.map(rule => <div key={rule.field}><dt>{fieldNames[rule.field]}</dt><dd>{stateNames[rule.state]}{rule.max !== undefined ? ` · ${rule.exclusive ? "<" : "≤"} ${rule.max}` : ""}</dd></div>)}</dl>}
      <div className="requirements-edit-grid"><label>稿件文件名<input value={fileName} disabled={busy} onChange={e => setFileName(e.target.value)} maxLength={200}/></label><label>实际发布标题<input ref={titleRef} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} maxLength={1000}/><small>{Array.from(title).length} 字符</small></label></div>
      <label className="requirements-body">正文纯文本<textarea ref={bodyRef} value={body} disabled={busy} onChange={e => setBody(e.target.value)} maxLength={2000000}/><small>{Array.from(body).length} 字符，请粘贴实际稿件正文。</small></label>
      <div className="requirements-edit-grid"><label>实际图片数<input id="requirements-images" inputMode="numeric" value={images} disabled={busy} onChange={e => setImages(e.target.value)}/></label><label>实际链接数<input id="requirements-links" inputMode="numeric" value={links} disabled={busy} onChange={e => setLinks(e.target.value)}/></label></div>
      <footer className="requirements-edit-footer"><p>图片、链接数量由你按实际稿件核对填写。本页不修改其他页面的稿件。</p><button className="requirements-primary" type="button" disabled={!selected || busy || loading} onClick={check}>{busy ? "正在处理…" : "执行预检 →"}</button></footer>
    </section>
    {result && <section className="requirements-panel requirements-result" aria-live="polite"><header className="requirements-section-heading"><div><span className="requirements-stage">03</span><h2>预检结果与逐项修复</h2></div><span className={`requirements-state is-${result.status}`}>{statusNames[result.status]}</span></header>
      <div className="requirements-result-summary"><div><small>当前检查</small><strong>{result.items.length} 项</strong></div>{(["pass", "fail", "needs_review"] as const).map(status => <div key={status}><small>{statusNames[status]}</small><strong>{result.items.filter(item => item.status === status).length}</strong></div>)}</div>
      <div className="requirements-table"><table><thead><tr><th>稿件文件</th><th>检查项 / 实际值</th><th>规则与原文依据</th><th>校验状态</th><th>修复操作</th></tr></thead><tbody>{result.items.map((item, index) => <tr key={index}><td><strong>{fileName || "待检稿件"}</strong></td><td><strong>{fieldNames[item.field] ?? item.field}</strong><p>{item.actual}</p></td><td>{typeof item.rule === "string" ? item.rule : `${stateNames[item.rule.state]}${item.rule.max !== undefined ? ` ${item.rule.exclusive ? "<" : "≤"}${item.rule.max}` : ""}`}<p>{item.evidence.join("；") || "官方规则未明确"}</p></td><td><span className={`requirements-state is-${item.status}`}>{statusNames[item.status]}</span><small>{item.status}</small></td><td>{item.status !== "pass" ? <button type="button" onClick={() => fix(item.field)}>返回修正 / 核对 →</button> : <span className="requirements-check-pass">已通过</span>}</td></tr>)}</tbody></table></div>
      <p className="requirements-table-note">自动预检不替代媒体人工审核；结果仅用于本页输入，不提交订单。</p>
    </section>}
    <aside className="requirements-rollback"><span className="requirements-stage">↩</span><div><h2>修正后，回到这里重新检查</h2><p>编辑标题、正文、图片数、链接数或更换媒体后，原结果自动失效。稿件输入保留，修正后重新执行预检。</p></div><button type="button" disabled={busy} onClick={() => { setResult(undefined); titleRef.current?.focus(); }}>返回稿件输入</button></aside>
    </div><aside className="requirements-handoff" aria-label="当前预检摘要"><span className="requirements-kicker">当前目标</span><h2>{selected?.name ?? "尚未选择媒体"}</h2><dl><div><dt>档案规则</dt><dd>{selected ? `${selected.rules.rules.length} 项` : "待读取"}</dd></div><div><dt>稿件文件</dt><dd>{fileName || "待检稿件"}</dd></div><div><dt>标题 / 正文</dt><dd>{Array.from(title).length} / {Array.from(body).length} 字符</dd></div><div><dt>预检状态</dt><dd>{result ? statusNames[result.status] : "待重新预检"}</dd></div></dl><p>未配置、未知限制或规则冲突均需明确核对，不解释为“无限制”。本页不会自动下单。</p>{selected && <PublishingRemark text={selected.rules.rawRemark}/>}</aside></div>
  </main>;
}
