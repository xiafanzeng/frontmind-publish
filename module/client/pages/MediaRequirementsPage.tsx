import { useEffect, useRef, useState } from "react";
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
  return <main className="publishing-page publishing-requirements">
    <header><div><h1>媒体要求</h1><p>软文街官方 API 发布备注 · 稿件预检</p></div><Link href={projectWorkspaceUrl("/publishing")}>返回工作台</Link></header>
    <section className="requirements-panel" aria-label="规则来源">
      <p>当前展示已采集的官方目录档案缓存；实时连接状态需点击更新确认。未提及不等于不限；字符按 Unicode 字符计数，含空白及标点。自然语言未确认计数口径时需人工复核。</p>
      <div className="requirements-actions"><label>官方目录页码 <input value={collectPage} inputMode="numeric" onChange={e => setCollectPage(e.target.value)} disabled={busy}/></label>
        <button type="button" disabled={busy || loading} onClick={collect}>从官方 API 更新该页</button>
        <button type="button" disabled={busy || loading} onClick={() => setRevision(x => x + 1)}>刷新档案</button></div>
    </section>
    <div className="requirements-feedback" aria-live="polite">{error && <p role="alert">{error}</p>}{notice && <p>{notice}</p>}{loading && <p>正在读取媒体规则…</p>}{busy && <p>正在处理，请稍候…</p>}</div>
    {!loading && !error && catalog?.items.length === 0 && <p>暂无已同步媒体档案，请管理员完成官方目录同步后刷新。</p>}
    <section className="requirements-market" aria-label="媒体列表" aria-busy={loading}>
      {catalog?.items.map(media => <article className="requirements-market-row" key={media.id} data-selected={selected?.id === media.id}>
        <label><input type="radio" name="requirements-media" checked={selected?.id === media.id} disabled={busy} onChange={() => setSelected(media)}/><strong>{media.name}</strong><small>媒体编号 {media.externalResourceId}</small></label>
        <div><strong>¥{(Number(media.price) / 10000).toFixed(2)}</strong><small>档案参考价</small></div>
        <div>{media.rules.rules.map(rule => <span className="requirements-tag" key={rule.field}>{fieldNames[rule.field]}：{stateNames[rule.state]}{rule.max !== undefined ? ` ${rule.exclusive ? "<" : "≤"}${rule.max}` : ""}</span>)}
          <details><summary title={media.rules.rawRemark || "官方备注为空，限制未知"}>完整发布备注</summary><p>{media.rules.rawRemark || "官方备注为空，限制未知"}</p><small>采集时间：{media.rules.collectedAt} · 来源：{media.rules.source}</small></details></div>
      </article>)}
    </section>
    <nav className="requirements-actions" aria-label="媒体分页"><button disabled={page <= 1 || loading || busy} onClick={() => setPage(x => x - 1)}>上一页</button><span>第 {page} 页 · 每页最多 25 条</span><button disabled={!catalog?.hasMore || loading || busy} onClick={() => setPage(x => x + 1)}>下一页</button></nav>
    <section className="requirements-panel requirements-edit" aria-label="稿件预检输入">
      <h2>目标媒体要求与稿件</h2><p>{selected ? `目标媒体：${selected.name}` : "请先选择媒体"}。原始规则保留于档案；在此修正实际稿件后复检。</p>
      <label>稿件文件名<input value={fileName} disabled={busy} onChange={e => setFileName(e.target.value)} maxLength={200}/></label>
      <label>实际发布标题<input ref={titleRef} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} maxLength={1000}/><small>{Array.from(title).length} 字符</small></label>
      <label>正文纯文本<textarea ref={bodyRef} value={body} disabled={busy} onChange={e => setBody(e.target.value)} maxLength={2000000}/><small>{Array.from(body).length} 字符，请粘贴实际稿件正文。</small></label>
      <div className="requirements-actions"><label>实际图片数<input id="requirements-images" inputMode="numeric" value={images} disabled={busy} onChange={e => setImages(e.target.value)}/></label><label>实际链接数<input id="requirements-links" inputMode="numeric" value={links} disabled={busy} onChange={e => setLinks(e.target.value)}/></label></div>
      <p>图片和链接数量由你核对实际稿件填写；本页不读取或修改其他页面的稿件。</p>
      <button type="button" disabled={!selected || busy || loading} onClick={check}>执行预检</button>
    </section>
    {result && <section className="requirements-panel" aria-live="polite"><h2>预检结果：{statusNames[result.status]} ({result.status})</h2>
      <div className="requirements-table"><table><thead><tr><th>文件</th><th>检查项 / 实际值</th><th>规则与原文</th><th>状态</th><th>修复操作</th></tr></thead><tbody>{result.items.map((item, index) => <tr key={index}><td>{fileName || "待检稿件"}</td><td>{fieldNames[item.field] ?? item.field}：{item.actual}</td><td>{typeof item.rule === "string" ? item.rule : `${stateNames[item.rule.state]}${item.rule.max !== undefined ? ` ${item.rule.exclusive ? "<" : "≤"}${item.rule.max}` : ""}`}<p>{item.evidence.join("；") || "官方规则未明确"}</p></td><td>{statusNames[item.status]}<small>{item.status}</small></td><td>{item.status !== "pass" && <button type="button" onClick={() => fix(item.field)}>返回修正 / 核对</button>}</td></tr>)}</tbody></table></div>
      <p>自动预检不替代媒体人工审核；此结果仅用于本页输入稿件，不提交订单。</p>
    </section>}
    <aside className="requirements-panel requirements-rollback"><h2>修正与回退</h2><p>编辑标题、正文、图片数、链接数或更换媒体后，原预检结果自动失效。修正后执行预检，保留稿件输入以便复核。</p><button type="button" disabled={busy} onClick={() => { setResult(undefined); titleRef.current?.focus(); }}>返回稿件输入并重新检查</button></aside>
  </main>;
}
