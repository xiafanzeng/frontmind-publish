import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import type { PublisherGateway } from "../gateway";
import { MediaMark, PublishingConfirmDialog, PublishingError, PublishingLoading, PublishingPage } from "../components/PublishingUi";
import { usePublishingChoice } from "../components/PublishingConversation";
import PublishingFlowSteps, { flowStagesForMode } from "../components/PublishingFlowSteps";
import { formatPublishingMoney, type PublicationBatch, type PublicationDraft, type PublicationPreflight, type PublisherSubmitInput } from "../types";
import { usePublishingFlow, usePublishingSummary, usePublishingOperationScope, publishingTaskUrl } from "../PublishingFlowContext";
import { readPublishingBatch, withPublishingBatch } from "../batchPublishing";
import { reviewBatchNeedsAttention, reviewBatchTotals, submitReviewBatch, type ReviewBatchProgress } from "../reviewBatch";
import { publisherSubmitIdempotencyKey } from "../queryState";
import "../publishing.review-batch.css";

const REFRESHABLE_CATALOG_BLOCKERS = new Set([
  "CATALOG_CHANGED", "PRICE_CHANGED", "MEDIA_KIND_CHANGED", "MEDIA_METADATA_CHANGED",
  "MEDIA_CAPABILITY_CHANGED", "TITLE_LIMIT_CHANGED",
]);
type ReviewGroup = { draftId: string; excluded: boolean; preflight?: PublicationPreflight; draft?: PublicationDraft; batch?: PublicationBatch; error?: Error };
type ReviewSession = {
  progress: ReviewBatchProgress;
  acceptedIds: Record<string, string>;
  estimatedBalance?: bigint;
};
// Task values persist only IDs and exact outstanding requests, never article HTML.
// Keep standalone receipts through in-app navigation within the same gateway.
const sessions = new WeakMap<PublisherGateway, Map<string, ReviewSession>>();
function restoreSession(saved: string, ids: string[]): ReviewSession {
  const session: ReviewSession = { progress: { accepted: {}, requests: {} }, acceptedIds: {} };
  try {
    const value = JSON.parse(saved) as { acceptedBatchIds?: Record<string, string>; requests?: Record<string, PublisherSubmitInput> };
    for (const id of ids) {
      const accepted = value.acceptedBatchIds?.[id];
      if (typeof accepted === "string" && accepted) session.acceptedIds[id] = accepted;
      const request = value.requests?.[id];
      if (!accepted && request?.draftId === id && typeof request.preflightRevision === "string" &&
        typeof request.quoteFingerprint === "string" && request.acknowledged === true &&
        request.idempotencyKey === publisherSubmitIdempotencyKey(id, request.quoteFingerprint)) session.progress.requests[id] = request;
    }
  } catch { /* A missing presentation value starts a fresh review. */ }
  return session;
}
const groupTitle = (group: ReviewGroup) => group.preflight?.article.title ?? group.draft?.articleTitle ?? group.draftId;
const refreshable = (value: PublicationPreflight) => [...(value.blockerCodes ?? []), ...value.items.flatMap(item => item.blockerCodes ?? [])].some(code => REFRESHABLE_CATALOG_BLOCKERS.has(code));
const batchStatus = (batch: PublicationBatch) => ({queued:"排队中", processing:"发布处理中", success:"发布成功", failed:"发布失败", partial_success:"部分发布成功", action_required:"待处理"})[batch.status] ?? "已受理";

export default function PublishingReviewPage(props: {
  draftId: string; onSubmitted?: (batchId: string) => void; onRevise?: () => void;
}) {
  const search = useSearch();
  const flow = usePublishingFlow();
  const batch = readPublishingBatch(props.draftId, search);
  const identity = JSON.stringify([batch.draftIds, batch.excludedDraftIds, flow?.scopeKey, flow?.taskId]);
  // Task values arrive after the host mounts its provider. Do not create/cache
  // an empty progress session, or persist over saved receipts, before hydration.
  if (flow?.pending) return <div className="publishing-review-page"><PublishingPage title="发布预检与确认" description="正在恢复本次投放进度。" busy><PublishingLoading label="正在恢复稿件与已受理批次…" /></PublishingPage></div>;
  return <ReviewContent key={identity} {...props} {...batch} />;
}

function ReviewContent({ draftId, draftIds, excludedDraftIds, onSubmitted, onRevise }: {
  draftId: string; draftIds: string[]; excludedDraftIds: string[];
  onSubmitted?: (batchId: string) => void; onRevise?: () => void;
}) {
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const [, navigate] = useLocation();
  const routeSearch = useSearch();
  const batchKey = JSON.stringify([draftIds, excludedDraftIds]);
  const operationScope = usePublishingOperationScope(batchKey);
  const progressKey = "publishingBatchReview:" + draftIds.join(",");
  const [savedProgress, , acceptSavedProgress] = usePublishingChoice(progressKey);
  const sessionKey = publishingTaskUrl("/", flow?.taskId) + ":" + (flow?.scopeKey ?? "") + ":" + batchKey;
  const session = useMemo(() => {
    let cache = sessions.get(gateway);
    if (!cache) { cache = new Map(); sessions.set(gateway, cache); }
    let value = cache.get(sessionKey);
    if (!value) { value = restoreSession(savedProgress, draftIds); cache.set(sessionKey, value); }
    return value;
    // A session owns mutable receipts; later value saves must not reset them.
  }, [gateway, sessionKey]);
  const activeIds = draftIds.filter(id => !excludedDraftIds.includes(id));
  const [acknowledged, setAcknowledged] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [refreshingCatalog, setRefreshingCatalog] = useState<string>();
  const [submitError, setSubmitError] = useState("");
  const [, redraw] = useState(0);
  const submitLock = useRef(false);
  const currentSession = useRef(session);
  currentSession.current = session;
  const load = useCallback(async (signal: AbortSignal) => {
    const groups = await Promise.all(draftIds.map(async (id): Promise<ReviewGroup> => {
      const excluded = excludedDraftIds.includes(id);
      try {
      if (session.acceptedIds[id]) {
        const [draft, batch] = await Promise.all([gateway.getDraft(id, signal), gateway.getBatch(session.acceptedIds[id], signal)]);
        if (!signal.aborted) session.progress.accepted[id] = batch;
        return {draftId:id, excluded, draft, batch};
      }
      if (excluded || session.progress.requests[id]) return {draftId:id, excluded, draft:await gateway.getDraft(id, signal)};
      return {draftId:id, excluded, preflight:await gateway.preflightDraft(id, signal)};
      } catch (reason) {
        return {draftId:id, excluded, batch:session.progress.accepted[id], error:reason instanceof Error ? reason : new Error("本稿预检读取失败，请重试。")};
      }
    }));
    if (!signal.aborted && groups.some(group => group.preflight)) session.estimatedBalance = undefined;
    return {session, groups};
  }, [gateway, session, batchKey]);
  const query = usePublisherQuery(load);
  const groups = query.data?.session === session ? query.data.groups : [];
  const pending = groups.filter(group => !group.excluded && !session.acceptedIds[group.draftId]);
  const pendingPreflights = pending.flatMap(group => group.preflight ? [group.preflight] : []);
  const totals = reviewBatchTotals(pendingPreflights);
  const publishMediaCount = new Set(pendingPreflights.flatMap(value => value.items.filter(item => !item.blockers.length).map(item => item.media.id))).size;
  const acceptedCount = activeIds.filter(id => Boolean(session.acceptedIds[id])).length;
  const unknownIds = activeIds.filter(id => Boolean(session.progress.requests[id]));
  const allAccepted = activeIds.length > 0 && acceptedCount === activeIds.length;
  const attention = Object.values(session.progress.accepted).some(reviewBatchNeedsAttention);
  const live = pendingPreflights.some(value => value.mode === "live");
  const available = session.estimatedBalance ?? totals.available;
  const globalBlocked = pendingPreflights.some(value => value.blockers.length > 0);
  const insufficient = available !== undefined && available < totals.publishTotal;
  const busy = query.loading || query.refreshing || submitting || Boolean(refreshingCatalog);
  const canPublish = groups.length === draftIds.length && !groups.some(group => group.error) && !query.error && !busy && !attention && !globalBlocked && !insufficient && totals.passedCount > 0;
  const canRecover = unknownIds.length > 0 && !busy && !attention && !query.error && !groups.some(group => group.error);
  const blockedCount = pendingPreflights.reduce((count, value) => count + value.blockers.length + value.items.filter(item => item.blockers.length).length, 0);
  const persist = async () => {
    for (const [id, batch] of Object.entries(session.progress.accepted)) session.acceptedIds[id] = batch.id;
    const saved = JSON.stringify({acceptedBatchIds:session.acceptedIds, requests:session.progress.requests});
    if (currentSession.current === session) { acceptSavedProgress(saved); redraw(value => value + 1); }
    await flow?.saveValues?.({
      [progressKey]:saved, batchDraftIds:draftIds, excludedDraftIds,
      publishingBatchReviewPending:activeIds.some(id => !session.acceptedIds[id] || !session.progress.accepted[id] || reviewBatchNeedsAttention(session.progress.accepted[id])),
    });
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    void persistRef.current().catch(reason => setSubmitError(reason instanceof Error ? reason.message : "发布进度保存失败，请重试。"));
  }, [session, query.data]);
  usePublishingSummary({title:"费用与发布状态", items:[
    {label:"稿件", value:draftIds.length + " 篇 · 已受理 " + acceptedCount + " 篇"},
    {label:"待发布组合", value:totals.passedCount + " 项"},
    {label:"待预占费用", value:formatPublishingMoney(totals.publishTotal.toString())},
    {label:"预检结果", value:unknownIds.length ? unknownIds.length + " 篇待确认受理结果" : allAccepted ? "全部发布请求已受理" : blockedCount ? blockedCount + " 项待处理" : "等待确认发布"},
  ], note:submitError || undefined});

  const submit = async () => {
    if (submitLock.current || !acknowledged || (!canPublish && !canRecover)) return;
    const operationCurrent = operationScope();
    const isCurrent = () => operationCurrent() && currentSession.current === session;
    submitLock.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      await submitReviewBatch({
        // Recover only already dispatched requests. Remaining drafts get a new
        // review/confirmation after recovery, including after a page restore.
        gateway, groups:unknownIds.length ? pending.filter(group => Boolean(session.progress.requests[group.draftId])) : pending,
        progress:session.progress, isCurrent,
        onProgress:persist,
        onPreflight:(_id, value) => { session.estimatedBalance = BigInt(value.wallet.availableTenThousandths); if (isCurrent()) redraw(value => value + 1); },
        onAccepted:async (_id, batch) => {
          if (session.estimatedBalance !== undefined) session.estimatedBalance -= BigInt(batch.totalTenThousandths);
          const accepted = Object.values(session.progress.accepted);
          const batchResources = [...new Map([
            ...(flow?.resources ?? []).filter(resource => resource.kind === "publication_batch").map(resource => [resource.id, resource] as const),
            ...accepted.map(value => [value.id, {kind:"publication_batch" as const, id:value.id}] as const),
          ]).values()];
          await flow?.record({
            id:"submitted:" + batch.id, label:"发布请求已受理",
            detail:accepted.length + " 篇稿件已受理 · 各批次结果由发布服务更新",
            resources:batchResources,
            outputRefs:accepted.map(value => ({resource:{kind:"publication_batch" as const, id:value.id, label:value.articleTitle || "已受理发布批次"}, sourceStepId:"submitted:" + value.id})),
          }).catch(() => undefined);
          if (isCurrent()) redraw(value => value + 1);
        },
      });
      if (!isCurrent()) return;
      setDialogOpen(false);
      setAcknowledged(false);
      if (draftIds.length === 1 && session.progress.accepted[draftId]) {
        const batch = session.progress.accepted[draftId];
        onSubmitted ? onSubmitted(batch.id) : navigate(publishingTaskUrl("/publishing/publications/" + batch.id + "?submitted=1", flow?.taskId));
      } else query.reload();
    } catch (reason) {
      if (!isCurrent()) return;
      const unknown = Object.keys(session.progress.requests).length > 0;
      setSubmitError((reason instanceof Error ? reason.message : "发布请求未能提交") + (unknown ? " 受理结果尚未确认，后续稿件已暂停；重试只会核实原请求。" : Object.keys(session.progress.accepted).length ? " 已受理批次已保留，后续稿件尚未提交。" : ""));
      setDialogOpen(false);
      if (!unknown) { setAcknowledged(false); session.estimatedBalance = undefined; query.reload(); }
    } finally {
      submitLock.current = false;
      if (isCurrent()) setSubmitting(false);
    }
  };
  const acceptCatalogChanges = async (group: ReviewGroup) => {
    if (!group.preflight || busy || unknownIds.length) return;
    const isCurrent = operationScope();
    setRefreshingCatalog(group.draftId);
    setSubmitError("");
    setAcknowledged(false);
    try {
      await gateway.refreshDraftMedia(group.draftId, group.preflight.draftRevision);
      if (isCurrent()) { session.estimatedBalance = undefined; query.reload(); }
    } catch (reason) { if (isCurrent()) setSubmitError(reason instanceof Error ? reason.message : "目录快照刷新失败"); }
    finally { if (isCurrent()) setRefreshingCatalog(undefined); }
  };
  const reviseIds = acceptedCount ? activeIds.filter(id => !session.acceptedIds[id]) : draftIds;
  const contextualPath = (path: string, replacements: Record<string, string> = {}) => {
    const params = new URLSearchParams(routeSearch);
    for (const [name, value] of Object.entries(replacements)) params.set(name, value);
    return path + (params.size ? "?" + params.toString() : "");
  };
  const reviseHref = publishingTaskUrl(withPublishingBatch(contextualPath("/publishing/drafts/" + encodeURIComponent(reviseIds[0] ?? draftId) + "/titles"), reviseIds, acceptedCount ? [] : excludedDraftIds), flow?.taskId);
  const reviseArticleIds = reviseIds.map(id => {
    const group = groups.find(value => value.draftId === id);
    return group?.preflight?.article.id ?? group?.draft?.articleId;
  });
  const bodyEditHref = (group: ReviewGroup) => {
    // The editor restores actual article units, not draft references. Never
    // turn a multi-draft fix into a one-article editor by guessing missing IDs.
    if (!group.preflight || reviseArticleIds.some(id => !id)) return undefined;
    const url = new URL(contextualPath("/publishing/articles/" + encodeURIComponent(group.preflight.article.id) + "/edit", {
      draftId:group.draftId, mode:group.preflight.titleMode ?? "per_media", from:"review",
    }), window.location.origin);
    url.searchParams.delete("batchArticle");
    for (const id of reviseArticleIds) if (id) url.searchParams.append("batchArticle", id);
    return publishingTaskUrl(withPublishingBatch(url.pathname + url.search, reviseIds, acceptedCount ? [] : excludedDraftIds), flow?.taskId);
  };
  // Both title configuration and review are explicit pages in this route flow,
  // including single-title drafts; retain all four workflow stages.
  const stages = flowStagesForMode(draftIds.length > 1 ? "batch" : "per_media");
  return <div className="publishing-review-page">
    <PublishingPage title="发布预检与确认" description="按稿件核对冻结版本、媒体标题与费用，再确认本次发布。" busy={busy}>
      {!flow ? <PublishingFlowSteps stages={stages} doneCount={stages.length - 1} activeIndex={stages.length - 1} /> : null}
      {query.loading ? <PublishingLoading label="正在逐稿刷新价格与发布门禁…" /> : null}
      {query.error ? <PublishingError error={query.error} onRetry={query.reload} /> : null}
      {groups.length ? <div className="publishing-review-layout">
        <section className="publishing-panel publishing-review-fees" aria-label="费用与预算核验">
          <header className="publishing-review-fees-head"><h2>费用与预算核验</h2></header>
          <dl className="publishing-money-summary">
            <div><dt>软文媒体小计</dt><dd>{totals.news.count} 项 · {formatPublishingMoney(totals.news.amount.toString())}</dd></div>
            <div><dt>自媒体小计</dt><dd>{totals.selfMedia.count} 项 · {formatPublishingMoney(totals.selfMedia.amount.toString())}</dd></div>
            <div><dt>预计总价</dt><dd className="is-total">{formatPublishingMoney(totals.publishTotal.toString())}</dd></div>
            <div><dt>{session.estimatedBalance !== undefined && acceptedCount ? "预计可用余额" : "可用余额"}</dt><dd>{available === undefined ? "待核验" : formatPublishingMoney(available.toString())}</dd></div>
            <div><dt>本次待预占</dt><dd>{formatPublishingMoney(totals.publishTotal.toString())}</dd></div>
            <div className="publishing-money-after"><dt>预占后预计可用</dt><dd>{available === undefined ? "待核验" : formatPublishingMoney((available - totals.publishTotal).toString())}</dd></div>
          </dl>
          <p className="publishing-review-cost-note">两类小计包含待提交稿件的全部已选媒体；预计总价仅计入通过内容检查的组合。同一家媒体用于两篇稿件时计为两项。已取消稿件与已受理批次不重复计费。</p>
          {draftIds.length > 1 ? <p className="publishing-review-cost-note">各稿件将逐篇提交；中途失败或结果待核实时会停止后续提交，已受理批次会保留。每稿提交前重新核验余额，账户余额以服务端结果为准。</p> : null}
          {busy || query.error ? <p className="publishing-review-cost-note" role="status">{query.error ? "预检未能更新，当前显示上一次金额，请重试。" : "正在更新，请等待预检或提交完成。"}</p> : null}
          {insufficient ? <p className="publishing-form-error" role="alert">可用余额不足以覆盖本次全部待提交组合，请调整媒体后重新预检。</p> : null}
          {allAccepted ? <p className="publishing-notice is-success" role="status"><CheckCircle2 size={18} />全部 {acceptedCount} 篇稿件的发布请求已受理，请在下方查看各批次结果。</p> : <label className="publishing-acknowledgement">
            <input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />
            <span>{unknownIds.length ? "我已确认重试核实原发布请求；核实后将重新预检并确认剩余稿件。" : live ? "我已确认向 " + totals.passedCount + " 项稿件与媒体组合真实投稿。成功后扣款；明确拒稿或失败自动退回；状态未知时金额继续冻结等待对账。" : "我已确认以 Preview 模拟方式提交 " + totals.passedCount + " 项稿件与媒体组合。本次不会联系供应商或产生真实费用。"}</span>
          </label>}
          {submitError ? <p className="publishing-form-error" role="alert">{submitError}</p> : null}
          {attention ? <p className="publishing-form-error" role="status">已受理批次有待核实结果，后续稿件暂停提交。请查看该批次并刷新结果后继续。</p> : null}
          {unknownIds.length ? <p className="publishing-form-error" role="status">有 {unknownIds.length} 篇稿件的请求待确认。核实前暂停修改标题和刷新目录；刷新受理状态也会保留原提交请求。</p> : null}
        </section>
        <div className="publishing-review-main">
          {groups.map((group, index) => {
            const preflight = group.preflight;
            const batch = session.progress.accepted[group.draftId] ?? group.batch;
            const uncertain = Boolean(session.progress.requests[group.draftId]);
            const title = groupTitle(group);
            const items = preflight?.items ?? group.draft?.items ?? [];
            const groupTotals = reviewBatchTotals(preflight && !batch ? [preflight] : []);
            const blockers = preflight ? [...new Set([...preflight.blockers, ...preflight.items.flatMap(item => item.blockers.map(message => item.media.name + "：" + message))])] : [];
            const previewId = "publishing-frozen-preview-" + index;
            return <section key={group.draftId} className="publishing-review-draft-group" aria-label={"稿件 " + (index + 1) + "：" + title}>
              {group.error ? <PublishingError error={group.error} onRetry={query.reload} /> : null}
              <section className="publishing-panel publishing-frozen-article">
                <span className="publishing-file-icon"><FileCheck2 size={22} /></span>
                <div><strong>{title}</strong><span>{preflight ? preflight.article.wordCount.toLocaleString("zh-CN") + " 字 · " + preflight.article.imageCount + " 张图片" : group.excluded ? "全部媒体已取消，本稿不参与本次发布" : uncertain ? "受理结果待确认" : "发布请求已受理"}</span></div>
                <span className="publishing-version-pill">版本 <b>v{preflight?.article.version ?? group.draft?.articleVersion}</b></span>
                <code>{(preflight?.article.hash ?? group.draft?.articleVersionHash ?? "").slice(0, 12)}</code>
                {preflight ? <button className="publishing-button publishing-button-secondary" type="button" aria-controls={previewId} aria-expanded={expanded.has(group.draftId)} onClick={() => setExpanded(current => {const next=new Set(current); next.has(group.draftId) ? next.delete(group.draftId) : next.add(group.draftId); return next;})}><ExternalLink size={15} />{expanded.has(group.draftId) ? "收起冻结正文" : "查看冻结正文"}</button> : null}
              </section>
              {preflight && expanded.has(group.draftId) ? <section id={previewId} className="publishing-panel publishing-frozen-preview" aria-label={title + "冻结正文预览"}><header><div><h2>{title}</h2><p>不可变版本 v{preflight.article.version} · {preflight.article.hash}</p></div><span>{preflight.article.imageCount} 张冻结图片</span></header><div className="publishing-frozen-preview-body" dangerouslySetInnerHTML={{__html:preflight.article.bodyHtml}} /></section> : null}
              {group.excluded ? <div className="publishing-panel publishing-review-group-status"><strong>本稿未纳入发布</strong><p>已取消全部媒体，不执行预检、不校验标题，也不产生本次费用。返回标题页可重新勾选。</p></div> : batch ? <div className="publishing-panel publishing-review-group-status" role="status">
                <strong>发布请求已受理 · {batchStatus(batch)}</strong><p>{batch.itemCount} 项 · {formatPublishingMoney(batch.totalTenThousandths)} · 批次 {batch.id}</p>
                <Link className="publishing-button publishing-button-secondary" href={publishingTaskUrl("/publishing/publications/" + encodeURIComponent(batch.id), flow?.taskId)}>查看本稿发布结果<ExternalLink size={15} /></Link>
                <ul className="publishing-review-receipts">{batch.items.map(item => <li key={item.id}><strong>{item.media.name}</strong><span>{item.title}</span><span>{({queued:"排队中",submitting:"正在提交",processing:"处理中",success:"发布成功",failed:"发布失败",auth_blocked:"授权待处理",submission_unknown:"结果待核实",action_required:"待处理"})[item.status]}</span>{item.resultUrl ? <a href={item.resultUrl} target="_blank" rel="noreferrer">查看发布链接</a> : null}</li>)}</ul>
              </div> : uncertain && !preflight ? <div className="publishing-panel publishing-review-group-status"><strong>发布请求待确认</strong><p>将使用原请求核实受理结果；本稿尚未计作发布成功。</p><ul>{items.map(item => <li key={item.media.id}>{item.media.name} · {item.title}</li>)}</ul></div> : preflight ? <>
                <section className="publishing-panel publishing-review-table" aria-labelledby={"publishing-review-results-" + index}>
                  <header className="publishing-review-results-head"><h2 id={"publishing-review-results-" + index}>发布内容检查结果</h2><p className="publishing-review-counts">通过 <strong>{groupTotals.passedCount}</strong> · 不通过 <strong>{groupTotals.failedCount}</strong> · 本稿待预占 <strong>{formatPublishingMoney(groupTotals.publishTotal.toString())}</strong>
                    {groupTotals.failedCount ? <span className="publishing-review-excluded">未纳入本次发布：{groupTotals.failedCount} 项 · {formatPublishingMoney(groupTotals.excludedTotal.toString())}</span> : null}
                    {groupTotals.failedCount && groupTotals.passedCount ? <span className="publishing-review-partial">部分发布：未通过组合将先移出本稿发布草稿</span> : null}</p></header>
                  <div className="publishing-review-head publishing-review-row"><span>媒体</span><span>{preflight.titleMode === "single" ? "统一标题" : "独立标题"}</span><span>冻结单价</span><span>内容检查</span><span>状态</span></div>
                  {preflight.items.map(item => <div className="publishing-review-row" key={group.draftId + ":" + item.media.id}>
                    <span className="publishing-media-name"><MediaMark name={item.media.shortName} id={item.media.id} logoUrl={item.media.logoUrl} logoSource={item.media.logoSource} logoResolutionStatus={item.media.logoResolutionStatus} /><span><strong>{item.media.name}</strong><small>FrontMind 媒体号：{item.media.id}</small><span className="publishing-kind-chip">{item.media.kind === "self_media" ? "自媒体" : "软文媒体"}</span></span></span>
                    <span data-label="发布标题">{item.title}</span><strong data-label="冻结单价">{formatPublishingMoney(item.priceTenThousandths)}</strong><span data-label="内容检查">{item.media.capability === "text" ? "仅纯文字" : item.media.capability === "image" ? "支持图片" : "图片待验证"}</span>
                    <span data-label="状态">{item.blockers.length ? <span className="publishing-status is-danger">未通过</span> : <span className="publishing-status is-success"><CheckCircle2 size={14} />通过</span>}</span>
                    {item.warnings.length ? <p className="publishing-row-warning"><AlertTriangle size={15} />{item.warnings.join("；")}</p> : null}
                  </div>)}
                </section>
                {preflight.warnings.length ? <div className="publishing-notice is-warning"><AlertTriangle size={21} /><div><strong>有 {preflight.warnings.length} 项内容提示</strong><p>{[...new Set(preflight.warnings)].join("；")}</p></div></div> : null}
                {blockers.length ? <div className="publishing-notice is-danger" role="alert"><AlertTriangle size={21} /><div><strong>{preflight.blockers.length || !groupTotals.passedCount ? "本稿当前不能发布" : "本稿部分组合未通过"}</strong><p>{blockers.join("；")}</p>
                  {refreshable(preflight) ? <button className="publishing-button publishing-button-secondary" type="button" disabled={busy || Boolean(unknownIds.length)} onClick={() => acceptCatalogChanges(group)}>{refreshingCatalog === group.draftId ? "正在刷新目录快照…" : "接受本稿当前目录并重新预检"}</button> : null}
                  {!unknownIds.length && !submitting && bodyEditHref(group) ? <Link className="publishing-row-fix" href={bodyEditHref(group)!}>修改本稿正文</Link> : null}
                </div></div> : null}
              </> : null}
            </section>;
          })}
        </div>
        <footer className="publishing-workflow-footer">
          {unknownIds.length || submitting ? <button type="button" className="publishing-button publishing-button-secondary" disabled><ArrowLeft size={16} />返回修改标题</button> : !allAccepted ? onRevise && !acceptedCount ? <button type="button" className="publishing-button publishing-button-secondary" onClick={onRevise}><ArrowLeft size={16} />返回修改标题</button> : <Link className="publishing-button publishing-button-secondary" href={reviseHref}><ArrowLeft size={16} />{acceptedCount ? "修改待提交稿件" : "返回修改标题"}</Link> : <span role="status">已受理批次将继续更新结果</span>}
          {!allAccepted || attention ? <div className="publishing-confirm-actions">
            <button type="button" className="publishing-button publishing-button-secondary" disabled={busy} onClick={() => {setAcknowledged(false); session.estimatedBalance=undefined; query.reload();}}>{unknownIds.length ? "刷新受理状态" : "一键预检"}</button>
            {!allAccepted ? <button type="button" className="publishing-button publishing-button-accent" disabled={!acknowledged || (!canPublish && !canRecover)} onClick={() => unknownIds.length ? void submit() : setDialogOpen(true)}>{submitting ? "正在提交…" : unknownIds.length ? "重试确认受理结果" : (live ? "确认发布" : "模拟发布") + " " + totals.passedCount + " 项"}</button> : null}
          </div> : null}
        </footer>
      </div> : null}
      <PublishingConfirmDialog inline={Boolean(flow)} open={dialogOpen} title={live ? "这是一次真实投稿" : "确认 Preview 模拟发布"}
        description={(live ? "提交后将按逐稿预检快照预占余额，供应商可能立即接单，已创建的外部订单不保证可以撤回。" : "只生成确定性 Mock 批次，不会请求外部供应商。") + (draftIds.length > 1 ? "各稿件逐篇提交，中途失败将保留已受理批次并停止后续稿件。" : "") + (totals.failedCount ? "本次仅提交通过预检的 " + totals.passedCount + " 项，未通过的 " + totals.failedCount + " 项不提交。" : "")}
        confirmLabel={(live ? "提交并预占" : "确认模拟发布") + " " + formatPublishingMoney(totals.publishTotal.toString())} busy={submitting} wide onCancel={() => setDialogOpen(false)} onConfirm={submit}>
        <div className="publishing-dialog-facts"><p><span>待提交稿件</span><strong>{pending.filter(group => group.preflight?.items.some(item => !item.blockers.length)).length} 篇</strong></p><p><span>投稿媒体（去重）</span><strong>{publishMediaCount} 家</strong></p><p><span>投稿组合</span><strong>{totals.passedCount} 项</strong></p><p><span>运行模式</span><strong>{live ? "真实发布" : "PREVIEW"}</strong></p></div>
        <div className="publishing-live-confirmation">
          {pending.filter(group => group.preflight?.items.some(item => !item.blockers.length)).map(group => {const value=group.preflight!; return <section className="publishing-review-confirm-group" key={group.draftId}>
            <h3>{value.article.title} · v{value.article.version}</h3><p>冻结版本 {value.article.hash}</p>
            <div className="publishing-live-article" dangerouslySetInnerHTML={{__html:value.article.bodyHtml}} />
            <h4>最终图片</h4>{value.article.images.length ? <ul className="publishing-live-images">{value.article.images.map((image,index) => <li key={image.id}>{image.previewUrl || image.sourceUrl ? <img src={image.previewUrl ?? image.sourceUrl} alt={image.altText} /> : null}<span><strong>图片 {index+1}</strong><small>{image.altText || "未填写 Alt 文本"}</small><code>{image.id}</code></span></li>)}</ul> : <p className="publishing-live-empty">本冻结版本不含图片</p>}
            <h4>本次投稿媒体、资源 ID 与逐项报价</h4><ul className="publishing-live-media-list">{value.items.filter(item => !item.blockers.length).map(item => <li key={item.media.id}><span><strong>{item.media.name}</strong><span className="publishing-kind-chip">{item.media.kind === "self_media" ? "自媒体" : "软文媒体"}</span><small>资源 ID：{item.media.externalResourceId ?? item.media.id}</small><small>标题：{item.title}</small></span><b>{formatPublishingMoney(item.priceTenThousandths)}</b></li>)}</ul>
          </section>;})}
          <p className={"publishing-live-irrevocable" + (live ? "" : " is-preview")}><AlertTriangle size={17} />{live ? "提交可能立即创建供应商订单；最终公开发布后不保证能够撤回。" : "Preview 只生成 Mock 结果，不会创建供应商订单。"}</p>
        </div>
        {!flow ? <p className="publishing-dialog-security"><ShieldCheck size={16} />{live ? "浏览器不会接触供应商凭据，提交由服务端统一执行。" : "Preview 不会发起任何供应商网络请求。"}</p> : null}
      </PublishingConfirmDialog>
    </PublishingPage>
  </div>;
}

