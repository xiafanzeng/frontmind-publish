import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import PublishingArticlePicker from './PublishingArticlePicker';
import { usePublisherGateway } from '../PublishingContext';
import { usePublishingOperationScope } from '../PublishingFlowContext';
import { requestWorkspaceNavigation, usePublishingWorkspaceKey } from '../host';
import { mediaReadError } from '../mediaReadError';
import { MediaDialog } from '../source-matrix/MediaMarket';
import type { ArticleDetail, ArticleVersion } from '../types';
import './confirmed-article-header.css';

export type ConfirmedArticleRow = {
  id: string; title: string; version?: number; articleId?: string; versionId?: string; excluded?: boolean;
};
/** ArticleDetail is the current working copy. Consumers must read the exact
 * selected version on the server before analysis; never analyze article.bodyText. */
export type ConfirmedArticleSelection = { article: ArticleDetail; version: ArticleVersion };
export type ConfirmedArticleHeaderProps = {
  rows: ConfirmedArticleRow[];
  selectedVersionId?: string;
  batch?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  retryLabel?: string;
  disabled?: boolean;
  onSelect: (selection: ConfirmedArticleSelection) => void;
  editHref?: string;
  onNavigate?: (href: string) => void;
};

/** Shared read-only selection/header for matrix and library. Creating a draft
 * remains an explicit later media-selection operation owned by its page. */
export function ConfirmedArticleHeader({ rows, selectedVersionId, batch = false, loading = false, error,
  onRetry, retryLabel = '重试读取稿件', disabled = false, onSelect, editHref, onNavigate }: ConfirmedArticleHeaderProps) {
  const gateway = usePublisherGateway();
  const workspace = usePublishingWorkspaceKey();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  const lock = useRef(false);
  const versionSelectId = useId();
  const context = JSON.stringify([workspace, params.get('operatorOwnerId'), params.get('enterpriseProjectId'), params.get('workbenchTask'), selectedVersionId, batch, rows.map(row => row.id)]);
  const scope = useMemo(() => ({ gateway, context }), [gateway, context]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const operationScope = usePublishingOperationScope(`confirmed-article:${context}`);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidate, setCandidate] = useState<ArticleDetail>();
  const [chosenVersion, setChosenVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const cancelRead = () => {
    requestNumber.current += 1;
    request.current?.abort();
    lock.current = false;
    setBusy(false);
  };
  useLayoutEffect(() => {
    cancelRead(); setPickerOpen(false); setCandidate(undefined); setFailure('');
    return () => { requestNumber.current += 1; request.current?.abort(); lock.current = false; };
  }, [scope]);
  useEffect(() => { if (disabled) { cancelRead(); setPickerOpen(false); setCandidate(undefined); } }, [disabled]);
  const closeVersions = () => {
    cancelRead(); setCandidate(undefined); setFailure('');
    trigger.current?.focus({ preventScroll: true });
  };
  const frozenVersions = candidate?.versions.filter(version => version.frozen) ?? [];
  const chooseArticle = (articles: ArticleDetail[]) => {
    const article = articles[0];
    if (!article || batch || disabled) return;
    setPickerOpen(false); setCandidate(article); setFailure('');
    const frozen = article.versions.filter(version => version.frozen);
    const current = frozen.find(version => version.id === selectedVersionId)
      ?? frozen.find(version => version.id === article.currentVersionId);
    setChosenVersion(current?.id ?? '');
  };
  const confirm = async () => {
    if (!candidate || !chosenVersion || disabled || batch || lock.current) return;
    const expected = candidate.versions.find(version => version.id === chosenVersion && version.frozen);
    if (!expected) return;
    const owner = scope;
    const validScope = operationScope();
    const controller = new AbortController();
    const sequence = ++requestNumber.current;
    request.current?.abort(); request.current = controller;
    lock.current = true; setBusy(true); setFailure('');
    const valid = () => validScope() && scopeRef.current === owner && sequence === requestNumber.current && !controller.signal.aborted;
    const timeout = setTimeout(() => {
      if (!valid()) return;
      cancelRead(); setFailure('读取确认版本超时，请重试。');
    }, 20_000);
    try {
      const [article, version] = await Promise.all([
        gateway.getArticle(candidate.id, controller.signal),
        gateway.getArticleVersion(chosenVersion, controller.signal),
      ]);
      if (!valid()) return;
      const member = article.versions.find(item => item.id === chosenVersion && item.frozen);
      if (article.id !== candidate.id || !member || version.id !== chosenVersion || !version.frozen ||
        version.hash !== member.hash || version.hash !== expected.hash || version.version !== member.version) {
        throw new Error('稿件或确认版本已失效，请重新选择。');
      }
      // Resolve details first. The page owns its unsaved-change guard and route.
      setCandidate(undefined);
      onSelect({ article, version });
      trigger.current?.focus({ preventScroll: true });
    } catch (reason) {
      if (valid()) setFailure(mediaReadError(reason, '无法读取确认版本，稿件可能已删除或访问权限已变化。请重试。'));
    } finally {
      clearTimeout(timeout);
      if (sequence === requestNumber.current) { lock.current = false; setBusy(false); request.current = null; }
    }
  };
  const go = (href: string) => onNavigate ? onNavigate(href) : requestWorkspaceNavigation(() => navigate(href));
  const summary = rows.length === 1 ? `${rows[0]!.title}${rows[0]!.version === undefined ? ' · 版本待确认' : ` · v${rows[0]!.version}`}`
    : rows.length > 1 ? `${rows.length} 篇稿件` : loading ? '正在读取稿件…' : '请选择已确认稿件';
  return <section className="confirmed-article-header" aria-label="当前稿件与编辑入口">
    <div className="confirmed-article-main">
      {batch ? <details className="confirmed-article-batch"><summary><strong>当前稿件</strong><span>{summary}</span></summary>
        <ul aria-label="本批次稿件与版本">{rows.map(row => <li key={row.id}><strong>{row.title}</strong><small>{row.version === undefined ? '版本待确认' : `v${row.version}`}{row.excluded ? ' · 已从本批次排除' : ''}</small></li>)}</ul>
        <p className="small muted">批量稿件保持原分组；请返回编辑稿件调整。</p>
      </details> : <button ref={trigger} type="button" className="confirmed-article-trigger" aria-haspopup="dialog" aria-expanded={pickerOpen || Boolean(candidate)} disabled={disabled}
        onClick={() => setPickerOpen(true)}><strong>当前稿件</strong><span title={summary}>{summary}</span><span aria-hidden="true">▾</span></button>}
      {error && <div className="confirmed-article-feedback" role={loading ? 'status' : 'alert'}><span>{error}</span>{onRetry && <button type="button" className="link" disabled={loading || disabled} onClick={onRetry}>{retryLabel}</button>}</div>}
    </div>
    {editHref && !error && !loading ? <Link className="button secondary confirmed-article-edit" href={editHref} onClick={event => { event.preventDefault(); if (!disabled) go(editHref); }} aria-disabled={disabled}>‹ 返回编辑稿件</Link>
      : <button type="button" className="button secondary confirmed-article-edit" disabled title={batch ? '当前批量稿件尚未读取完成' : '请先选择并读取有效稿件'}>‹ 返回编辑稿件</button>}
    <PublishingArticlePicker open={pickerOpen && !batch} onClose={() => setPickerOpen(false)} onSelect={chooseArticle} purpose="confirmed-version" contextKey={context} disabled={disabled} trigger={trigger.current ?? undefined}/>
    <MediaDialog open={Boolean(candidate)} title="选择已确认版本" confirmLabel={busy ? '正在读取版本…' : failure ? '重试选择版本' : '使用此版本'}
      onCancel={closeVersions} onConfirm={() => void confirm()} confirmDisabled={busy || !chosenVersion || !frozenVersions.length || disabled}>
      <div className="confirmed-article-versions">
        <p className="confirmed-article-full-title">{candidate?.title}</p>
        {frozenVersions.length ? <><label className="label" htmlFor={versionSelectId}>稿件版本</label><select id={versionSelectId} value={chosenVersion} disabled={busy} onChange={event => { setChosenVersion(event.target.value); setFailure(''); }}>
          <option value="">请选择已确认版本</option>{frozenVersions.map(version => <option key={version.id} value={version.id}>v{version.version}{version.id === candidate?.currentVersionId ? ' · 当前确认版本' : ' · 历史确认版本'}</option>)}
        </select><p className="small muted">使用所选确认版本，编辑工作副本不会改写该版本。</p></> : <p role="status">这篇稿件没有可用的确认版本，请返回编辑稿件完成确认。</p>}
        {busy && <p role="status">正在核对稿件与版本，可关闭取消…</p>}{failure && <p className="block-error" role="alert">{failure}</p>}
      </div>
    </MediaDialog>
  </section>;
}
