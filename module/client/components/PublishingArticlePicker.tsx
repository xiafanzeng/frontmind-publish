import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@frontmind/module-ui/components/ui/dialog";
import { usePublisherGateway } from "../PublishingContext";
import { usePublishingFlow, usePublishingOperationScope } from "../PublishingFlowContext";
import { usePublishingWorkspaceKey } from "../host";
import type { PublisherGateway } from "../gateway";
import type { ArticleDetail, ArticleStatus, ArticleSummary } from "../types";
import "./publishing.article-picker.css";

export type PublishingArticlePickerProps = {
  open: boolean;
  onClose: () => void;
  /** Receives complete details. The parent owns guarded navigation/append and closing. */
  onSelect: (articles: ArticleDetail[]) => void | Promise<void>;
  multiple?: boolean;
  excludedIds?: readonly string[];
  disabled?: boolean;
  trigger?: HTMLButtonElement;
};

const statusLabels: Record<ArticleStatus, string> = {
  draft: "草稿", frozen: "已冻结", importing: "导入中", import_failed: "导入失败",
};
const portalTokens = ["--publishing-surface", "--publishing-ink", "--publishing-muted", "--publishing-line", "--publishing-purple", "--publishing-purple-dark", "--publishing-purple-soft", "--publishing-focus", "--publishing-radius"];
const unavailableReason = (article: ArticleSummary, excluded: ReadonlySet<string>) =>
  excluded.has(article.id) ? "已在当前批量中" : article.status === "importing" ? "导入完成后可选择" : article.status === "import_failed" ? "导入失败，请先重新导入" : "";
const updatedLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "更新时间未知" : date.toLocaleString("zh-CN", { hour12: false });
};
type ListState = { gateway: PublisherGateway; scope: string; loading: boolean; articles: ArticleSummary[]; error?: string };

/** Selection is read-only: no save, freeze, copy, task creation or implicit close. */
export default function PublishingArticlePicker({ open, onClose, onSelect, multiple = false, excludedIds = [], disabled = false, trigger }: PublishingArticlePickerProps) {
  const gateway = usePublisherGateway();
  const workspaceKey = usePublishingWorkspaceKey();
  const flow = usePublishingFlow();
  const scope = `${workspaceKey}:${flow?.taskId ?? "standalone"}`;
  const operationScope = usePublishingOperationScope(`article-picker:${scope}`);
  const inputId = useId();
  const search = useRef<HTMLInputElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | undefined>(undefined);
  const request = useRef(0);
  const detailRequest = useRef<AbortController | null>(null);
  const submitLock = useRef(false);
  const [portalStyle, setPortalStyle] = useState<CSSProperties>({});
  const [list, setList] = useState<ListState>({ gateway, scope, loading: true, articles: [] });
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ArticleStatus | "all">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "reading" | "applying">("idle");
  const [selectionError, setSelectionError] = useState<string>();
  const excludedKey = JSON.stringify([...new Set(excludedIds)].sort());
  const excluded = useMemo<ReadonlySet<string>>(() => new Set<string>(JSON.parse(excludedKey)), [excludedKey]);
  const current = useRef({ gateway, scope, open, multiple, excludedKey, disabled, onSelect });
  current.current = { gateway, scope, open, multiple, excludedKey, disabled, onSelect };

  const invalidateSelection = useCallback(() => {
    request.current += 1;
    detailRequest.current?.abort();
    detailRequest.current = null;
    submitLock.current = false;
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const opener = trigger ?? (document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined);
    if (!opener) return;
    lastTrigger.current = opener;
    const computed = getComputedStyle(opener);
    const properties: Record<string, string> = { fontFamily: computed.fontFamily };
    for (const token of portalTokens) {
      const value = computed.getPropertyValue(token).trim();
      if (value) properties[token] = value;
    }
    setPortalStyle(properties as CSSProperties);
  }, [open, trigger]);

  useEffect(() => {
    invalidateSelection();
    setSelectedIds([]);
    setSelectionError(undefined);
    setPhase("idle");
    setQuery("");
    setStatus("all");
    return invalidateSelection;
  }, [open, gateway, scope, multiple, invalidateSelection]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const inScope = operationScope();
    let alive = true;
    const valid = () => alive && inScope() && current.current.open && current.current.gateway === gateway && current.current.scope === scope;
    setList({ gateway, scope, loading: true, articles: [] });
    const timeout = setTimeout(() => {
      if (!valid()) return;
      controller.abort();
      alive = false;
      setList({ gateway, scope, loading: false, articles: [], error: "读取稿件列表超时，请重试。" });
    }, 20_000);
    // The gateway already follows every cursor page; do not truncate or repaginate here.
    void gateway.listArticles(controller.signal).then((articles) => {
      if (!valid() || controller.signal.aborted) return;
      clearTimeout(timeout);
      setList({ gateway, scope, loading: false, articles });
      setSelectedIds((ids) => ids.filter((id) => articles.some((article) => article.id === id && !unavailableReason(article, excluded))));
    }).catch(() => {
      if (!valid() || controller.signal.aborted) return;
      clearTimeout(timeout);
      setList({ gateway, scope, loading: false, articles: [], error: "读取稿件列表失败，请重试。" });
    });
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [open, gateway, scope, reload, operationScope]);

  // Exclusion/permission changes invalidate an in-flight selection before its callback.
  useEffect(() => {
    invalidateSelection();
    setPhase("idle");
    setSelectedIds((ids) => ids.filter((id) => !excluded.has(id)));
  }, [excludedKey, disabled, invalidateSelection]);

  const visible = list.gateway === gateway && list.scope === scope ? list : { loading: true, articles: [], error: undefined };
  const articles = visible.articles;
  const filtered = articles.filter((article) => (status === "all" || article.status === status) && `${article.title} ${article.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const busy = phase !== "idle";
  const selected = selectedIds.filter((id) => articles.some((article) => article.id === id && !unavailableReason(article, excluded)));

  const close = () => {
    // Once handed to the parent's guarded transition, let that transition settle.
    if (phase === "applying") return;
    invalidateSelection();
    setPhase("idle");
    onClose();
  };

  const confirm = async () => {
    if (submitLock.current || busy || disabled || visible.loading || visible.error || !selected.length || (!multiple && selected.length !== 1)) return;
    submitLock.current = true;
    const token = ++request.current;
    const controller = new AbortController();
    detailRequest.current = controller;
    const inScope = operationScope();
    const valid = () => inScope() && request.current === token && !controller.signal.aborted && current.current.open && current.current.gateway === gateway && current.current.scope === scope && current.current.multiple === multiple && current.current.excludedKey === excludedKey && !current.current.disabled;
    setPhase("reading");
    setSelectionError(undefined);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const startReadTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (!valid()) return;
        invalidateSelection();
        setPhase("idle");
        setSelectionError("读取稿件详情超时，请重试。");
      }, 20_000);
    };
    startReadTimeout();
    try {
      // Recheck membership/status after the user's selection; summaries never stand in for content.
      const latest = await gateway.listArticles(controller.signal);
      if (!valid()) return;
      setList({ gateway, scope, loading: false, articles: latest });
      for (const id of selected) {
        const summary = latest.find((article) => article.id === id);
        if (!summary || unavailableReason(summary, excluded)) throw new Error("所选稿件已不可用，请重新选择。");
      }
      const details: ArticleDetail[] = [];
      for (const id of selected) {
        startReadTimeout();
        const article = await gateway.getArticle(id, controller.signal);
        if (!valid()) return;
        if (article.id !== id || unavailableReason(article, excluded)) throw new Error("所选稿件当前无法编辑，请重新选择。");
        details.push(article);
      }
      if (!valid()) return;
      clearTimeout(timeout);
      setPhase("applying");
      await current.current.onSelect(details);
      // Parent decides whether a cancelled navigation leaves the picker open.
      if (valid()) setPhase("idle");
    } catch (reason) {
      if (!valid()) return;
      setPhase("idle");
      setSelectionError(reason instanceof Error && reason.message.startsWith("所选稿件") ? reason.message : "无法载入所选稿件，请重试；稿件可能已删除或访问权限已变化。");
    } finally {
      clearTimeout(timeout);
      if (request.current === token) {
        submitLock.current = false;
        detailRequest.current = null;
      }
    }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent className="publishing-article-picker" overlayClassName="publishing-article-picker-overlay" showCloseButton={false} style={portalStyle}
      onOpenAutoFocus={(event) => { event.preventDefault(); search.current?.focus({ preventScroll: true }); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); if (lastTrigger.current?.isConnected) lastTrigger.current.focus({ preventScroll: true }); }}
      onEscapeKeyDown={(event) => { if (phase === "applying") event.preventDefault(); }}
      onPointerDownOutside={(event) => { if (phase === "applying") event.preventDefault(); }}>
      <header className="publishing-article-picker-header">
        <div><DialogTitle className="publishing-article-picker-title">{multiple ? "选择稿件并追加" : "选择稿件"}</DialogTitle>
          <DialogDescription className="publishing-article-picker-description">{multiple ? "可选择多篇稿件追加到当前批量，已加入的稿件和未保存卡片将保留。" : "选择一篇已有稿件继续编辑；切换后会离开当前稿件。"}</DialogDescription></div>
        <button type="button" className="publishing-article-picker-button" aria-label="关闭选择稿件" disabled={phase === "applying"} onClick={close}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="publishing-article-picker-filters">
        <label className="publishing-article-picker-search"><Search size={16} aria-hidden="true" /><input ref={search} type="search" aria-label="搜索稿件标题或 ID" placeholder="搜索标题或 ID" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="清空稿件搜索" disabled={busy} onClick={() => { setQuery(""); search.current?.focus(); }}><X size={16} aria-hidden="true" /></button>}</label>
        <label className="publishing-article-picker-status">状态<select aria-label="稿件状态" value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as ArticleStatus | "all")}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="publishing-article-picker-scroll" role={multiple ? "group" : "radiogroup"} aria-label={multiple ? "可追加稿件" : "可编辑稿件"} aria-busy={visible.loading || busy}>
        {visible.loading ? <p className="publishing-article-picker-message" role="status">正在读取稿件列表…</p> : visible.error ? <div className="publishing-article-picker-message" role="alert"><p>{visible.error}</p><button type="button" className="publishing-article-picker-button" onClick={() => setReload((value) => value + 1)}>重试列表</button></div> : !articles.length ? <p className="publishing-article-picker-message" role="status">暂无稿件，请先上传文档或撰写稿件。</p> : !filtered.length ? <p className="publishing-article-picker-message" role="status">没有匹配的稿件，请调整搜索或状态筛选。</p> : filtered.map((article) => {
          const reason = unavailableReason(article, excluded);
          const id = `${inputId}-${article.id}`;
          return <label key={article.id} className={`publishing-article-picker-row${selected.includes(article.id) ? " is-selected" : ""}${reason ? " is-unavailable" : ""}`}>
            <input type={multiple ? "checkbox" : "radio"} name={`${inputId}-article`} aria-label={`${article.title || "未命名稿件"}（ID：${article.id}）`} aria-describedby={reason ? `${id}-reason` : undefined} checked={selected.includes(article.id)} disabled={busy || disabled || Boolean(reason)} onChange={(event) => { setSelectionError(undefined); setSelectedIds((ids) => multiple ? event.target.checked ? [...new Set([...ids, article.id])] : ids.filter((value) => value !== article.id) : [article.id]); }} />
            <span className="publishing-article-picker-row-content"><strong>{article.title || "未命名稿件"}</strong><span className="publishing-article-picker-id">ID：{article.id}</span><span className="publishing-article-picker-meta">{statusLabels[article.status]} · {article.currentVersion > 0 ? `当前版本 v${article.currentVersion}` : "尚无冻结版本"} · 更新于 {updatedLabel(article.updatedAt)}</span>{reason && <span id={`${id}-reason`} className="publishing-article-picker-reason">{reason}</span>}</span>
          </label>;
        })}
      </div>
      <footer className="publishing-article-picker-footer">
        <div className="publishing-article-picker-feedback">{selectionError ? <p role="alert">{selectionError}</p> : <p role="status">{phase === "reading" ? "正在读取完整稿件，可取消…" : phase === "applying" ? multiple ? "正在追加稿件…" : "正在切换稿件…" : `已选择 ${selected.length} 篇稿件`}</p>}</div>
        <div className="publishing-article-picker-actions"><button type="button" className="publishing-article-picker-button" disabled={phase === "applying"} onClick={close}>取消</button><button type="button" className="publishing-article-picker-button is-primary" disabled={busy || disabled || visible.loading || Boolean(visible.error) || !selected.length} onClick={() => { void confirm(); }}>{selectionError ? "重试载入" : multiple ? "追加所选稿件" : "使用此稿件"}</button></div>
      </footer>
    </DialogContent>
  </Dialog>;
}
