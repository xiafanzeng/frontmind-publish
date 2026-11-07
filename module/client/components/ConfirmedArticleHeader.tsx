import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import PublishingArticlePicker from './PublishingArticlePicker';
import { usePublisherGateway } from '../PublishingContext';
import { usePublishingOperationScope } from '../PublishingFlowContext';
import { requestWorkspaceNavigation, usePublishingWorkspaceKey } from '../host';
import { mediaReadError } from '../mediaReadError';
import { resolveLatestArticleSelection, type LatestArticleSelection } from '../latestArticleSelection';
import type { ArticleDetail } from '../types';
import './confirmed-article-header.css';

export type ConfirmedArticleRow = {
  id: string; title: string; version?: number; articleId?: string; versionId?: string; excluded?: boolean;
};
/** ArticleDetail is the current working copy. Consumers must read the exact
 * selected version on the server before analysis; never analyze article.bodyText. */
export type ConfirmedArticleSelection = LatestArticleSelection;
export type ConfirmedArticleHeaderProps = {
  rows: ConfirmedArticleRow[];
  selectedVersionId?: string;
  batch?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  retryLabel?: string;
  disabled?: boolean;
  onSelect: (selection: ConfirmedArticleSelection) => boolean | void | Promise<boolean | void>;
  /** Ask the page's existing unsaved-change guard before opening the picker. */
  onRequestSelect?: (open: () => void) => void;
  editHref?: string;
  onNavigate?: (href: string) => void;
};

/** Shared latest-article selection/header for matrix and library. A necessary
 * freeze uses the existing gateway; publication draft creation stays on its page. */
export function ConfirmedArticleHeader({ rows, selectedVersionId, batch = false, loading = false, error,
  onRetry, retryLabel = '重试读取稿件', disabled = false, onSelect, onRequestSelect, editHref, onNavigate }: ConfirmedArticleHeaderProps) {
  const gateway = usePublisherGateway();
  const workspace = usePublishingWorkspaceKey();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  const lock = useRef(false);
  const unavailable = useRef(disabled || batch); unavailable.current = disabled || batch;
  const context = JSON.stringify([workspace, params.get('operatorOwnerId'), params.get('enterpriseProjectId'), params.get('workbenchTask'), params.get('articleId'), selectedVersionId, batch, batch ? rows.map(row => row.id) : []]);
  const scope = useMemo(() => ({ gateway, context }), [gateway, context]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const operationScope = usePublishingOperationScope(`confirmed-article:${context}`);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const cancelRead = () => {
    requestNumber.current += 1;
    request.current?.abort();
    lock.current = false;
    setBusy(false);
  };
  useLayoutEffect(() => {
    cancelRead(); setPickerOpen(false);
    return () => { requestNumber.current += 1; request.current?.abort(); lock.current = false; };
  }, [scope]);
  useEffect(() => { if (disabled) { cancelRead(); setPickerOpen(false); } }, [disabled]);
  const closePicker = () => {
    cancelRead(); setPickerOpen(false);
  };
  const openPicker = () => {
    const owner = scope;
    const validScope = operationScope();
    const open = () => { if (validScope() && scopeRef.current === owner && !unavailable.current) setPickerOpen(true); };
    if (onRequestSelect) onRequestSelect(open); else open();
  };
  const chooseArticle = async (articles: ArticleDetail[]) => {
    const candidate = articles[0];
    if (!candidate || disabled || batch || lock.current) return;
    const owner = scope;
    const validScope = operationScope();
    const controller = new AbortController();
    const sequence = ++requestNumber.current;
    request.current?.abort(); request.current = controller;
    lock.current = true; setBusy(true);
    const valid = () => validScope() && scopeRef.current === owner && sequence === requestNumber.current && !controller.signal.aborted;
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (!valid()) return;
      timedOut = true; controller.abort();
    }, 20_000);
    try {
      const selection = await resolveLatestArticleSelection(gateway, candidate.id, { signal: controller.signal, isCurrent: valid });
      if (!valid()) return;
      clearTimeout(timeout);
      const applied = await onSelect(selection);
      if (valid() && applied !== false) setPickerOpen(false);
    } catch (reason) {
      if (timedOut) throw new Error('准备最新稿件超时，请重试。');
      if (valid()) throw new Error(mediaReadError(reason, '无法关联最新稿件，稿件可能已删除或访问权限已变化。请重试。'));
    } finally {
      clearTimeout(timeout);
      if (sequence === requestNumber.current) { lock.current = false; setBusy(false); request.current = null; }
    }
  };
  const go = (href: string) => onNavigate ? onNavigate(href) : requestWorkspaceNavigation(() => navigate(href));
  const summary = rows.length === 1 ? `${rows[0]!.title}${rows[0]!.version === undefined ? ' · 版本待确认' : ` · v${rows[0]!.version}`}`
    : rows.length > 1 ? `${rows.length} 篇稿件` : loading ? '正在读取稿件…' : '请选择稿件';
  return <section className="confirmed-article-header" aria-label="当前稿件与编辑入口">
    <div className="confirmed-article-main">
      {batch ? <details className="confirmed-article-batch"><summary><strong>当前稿件</strong><span>{summary}</span></summary>
        <ul aria-label="本批次稿件与版本">{rows.map(row => <li key={row.id}><strong>{row.title}</strong><small>{row.version === undefined ? '版本待确认' : `v${row.version}`}{row.excluded ? ' · 已从本批次排除' : ''}</small></li>)}</ul>
        <p className="small muted">批量稿件保持原分组；请返回编辑稿件调整。</p>
      </details> : <button ref={trigger} type="button" className="confirmed-article-trigger" aria-haspopup="dialog" aria-expanded={pickerOpen} disabled={disabled || busy}
        onClick={openPicker}><strong>当前稿件</strong><span title={summary}>{summary}</span><span aria-hidden="true">▾</span></button>}
      {error && <div className="confirmed-article-feedback" role={loading ? 'status' : 'alert'}><span>{error}</span>{onRetry && <button type="button" className="link" disabled={loading || disabled} onClick={onRetry}>{retryLabel}</button>}</div>}
    </div>
    {editHref && !error && !loading ? <Link className="button secondary confirmed-article-edit" href={editHref} onClick={event => { event.preventDefault(); if (!disabled) go(editHref); }} aria-disabled={disabled}>‹ 返回编辑稿件</Link>
      : <button type="button" className="button secondary confirmed-article-edit" disabled title={batch ? '当前批量稿件尚未读取完成' : '请先选择并读取有效稿件'}>‹ 返回编辑稿件</button>}
    <PublishingArticlePicker open={pickerOpen && !batch} onClose={closePicker} onSelect={chooseArticle} purpose="confirmed-version" allowCancelWhileApplying contextKey={context} disabled={disabled} trigger={trigger.current ?? undefined}/>
  </section>;
}
