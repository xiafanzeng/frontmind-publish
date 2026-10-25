import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { MediaMark, PublishingConfirmDialog, PublishingError, PublishingLoading, PublishingPage } from "../components/PublishingUi";
import { usePublishingChoice } from "../components/PublishingConversation";
import PublishingFlowSteps, { flowStagesForMode } from "../components/PublishingFlowSteps";
import { formatPublishingMoney, type PublicationBatch, type PublicationDraft, type PublicationPreflight } from "../types";
import { usePublishingFlow, usePublishingSummary, usePublishingOperationScope, publishingTaskUrl } from "../PublishingFlowContext";
import { readPublishingBatch, withPublishingBatch } from "../batchPublishing";
import { reviewBatchNeedsAttention, reviewBatchTotals, submitReviewBatch } from "../reviewBatch";
import { clearResolvedReviewRequests, mergeReviewSessionReceipts, restoreReviewSession, reviewSessions } from "../reviewSession";
import { publishingTitleStage } from "../titleFlow";
import { preflightMatchesReviewDraft, reviewDraftContext, type ManualReviewCheck } from "../reviewPreflight";
import { usePreparationEntryScroll } from "../usePreparationEntryScroll";
import "../publishing.review-batch.css";

const REFRESHABLE_CATALOG_BLOCKERS = new Set([
  "CATALOG_CHANGED", "PRICE_CHANGED", "MEDIA_KIND_CHANGED", "MEDIA_METADATA_CHANGED",
  "MEDIA_CAPABILITY_CHANGED", "TITLE_LIMIT_CHANGED",
]);
type ReviewGroup = { draftId: string; excluded: boolean; preflight?: PublicationPreflight; draft?: PublicationDraft; batch?: PublicationBatch; error?: Error; check?: ManualReviewCheck };
const groupTitle = (group: ReviewGroup) => group.preflight?.article.title ?? group.draft?.articleTitle ?? group.draftId;
const refreshable = (value: PublicationPreflight) => [...(value.blockerCodes ?? []), ...value.items.flatMap(item => item.blockerCodes ?? [])].some(code => REFRESHABLE_CATALOG_BLOCKERS.has(code));
const batchStatus = (batch: PublicationBatch) => ({queued:"排队中", processing:"发布处理中", success:"发布成功", failed:"发布失败", partial_success:"部分发布成功", action_required:"待处理"})[batch.status] ?? "已受理";

export default function PublishingReviewPage(props: {
  draftId: string; onSubmitted?: (batchId: string) => void; onRevise?: (href: string) => void;
}) {
  const search = useSearch();
  const flow = usePublishingFlow();
  const batch = readPublishingBatch(props.draftId, search);
  const identity = JSON.stringify([batch.draftIds, batch.excludedDraftIds, flow?.scopeKey, flow?.taskId, search]);
  // Task values arrive after the host mounts its provider. Do not create/cache
  // an empty progress session, or persist over saved receipts, before hydration.
  if (flow?.pending) return <div className="publishing-review-page"><PublishingPage title="发布内容检查与费用核验" layout="review" busy><PublishingLoading label="正在恢复稿件与已受理批次…" /></PublishingPage></div>;
  return <ReviewContent key={identity} {...props} {...batch} />;
}

function ReviewContent({ draftId, draftIds, excludedDraftIds, onSubmitted, onRevise }: {
  draftId: string; draftIds: string[]; excludedDraftIds: string[];
  onSubmitted?: (batchId: string) => void; onRevise?: (href: string) => void;
}) {
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const [, navigate] = useLocation();
  const routeSearch = useSearch();
  const batchKey = JSON.stringify([draftIds, excludedDraftIds]);
  const operationScope = usePublishingOperationScope(batchKey);
  const progressKey = "publishingBatchReview:" + draftIds.join(",");
  const [savedProgress, , acceptSavedProgress] = usePublishingChoice(progressKey);
  const sessionPrefix = publishingTaskUrl("/", flow?.taskId) + ":" + (flow?.scopeKey ?? "") + ":";
  const sessionKey = sessionPrefix + batchKey;
  const session = useMemo(() => {
    let cache = reviewSessions.get(gateway);
    if (!cache) { cache = new Map(); reviewSessions.set(gateway, cache); }
    let value = cache.get(sessionKey);
    const restored = restoreReviewSession(gateway, sessionPrefix, draftIds, savedProgress, flow?.selections);
    if (!value) { value = restored; cache.set(sessionKey, value); }
    else mergeReviewSessionReceipts(value, restored, draftIds);
    return value;
    // A session owns mutable receipts; later value saves must not reset them.
  }, [gateway, sessionKey]);
  const activeIds = draftIds.filter(id => !excludedDraftIds.includes(id) || session.acceptedIds[id] || session.progress.requests[id]);
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
  const previousRequestKeys = useRef(Object.fromEntries(Object.entries(session.progress.requests).map(([id, request]) => [id, request.idempotencyKey])));
  const load = useCallback(async (signal: AbortSignal) => {
    const groups = await Promise.all(draftIds.map(async (id): Promise<ReviewGroup> => {
      // A URL exclusion cannot cancel an already dispatched request.
      const excluded = excludedDraftIds.includes(id) && !session.acceptedIds[id] && !session.progress.requests[id];
      try {
      if (session.acceptedIds[id]) {
        const [draft, batch] = await Promise.all([gateway.getDraft(id, signal), gateway.getBatch(session.acceptedIds[id], signal)]);
        if (!signal.aborted) session.progress.accepted[id] = batch;
        return {draftId:id, excluded, draft, batch};
      }
      // Reading a draft is deliberately separate from content preflight. A
      // restored view must never approve ordinary drafts on the user's behalf.
      const draft = await gateway.getDraft(id, signal);
      if (draft.id !== id) throw new Error("稿件身份无法恢复，请返回选择后重试。");
      return {draftId:id, excluded, draft};
      } catch (reason) {
        return {draftId:id, excluded, batch:session.progress.accepted[id], error:reason instanceof Error ? reason : new Error("本稿信息读取失败，请重试。")};
      }
    }));
    return {session, groups};
  }, [gateway, session, batchKey]);
  const query = usePublisherQuery(load);
  const metadata = query.data?.session === session ? query.data : undefined;
  const [checks, setChecks] = useState<{source: typeof metadata; values: Record<string, ManualReviewCheck>}>({source:undefined, values:{}});
  const [checking, setChecking] = useState(false);
  const checkRun = useRef(0);
  const checkController = useRef<AbortController | undefined>(undefined);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const checkLock = useRef(false);
  const currentMetadata = useRef(metadata);
  currentMetadata.current = metadata;
  const invalidateChecks = useCallback(() => {
    checkRun.current += 1;
    checkController.current?.abort();
    if (checkTimer.current !== undefined) clearTimeout(checkTimer.current);
    checkTimer.current = undefined;
    checkLock.current = false;
    setChecking(false);
    setChecks({source:undefined, values:{}});
    setAcknowledged(false);
    setDialogOpen(false);
    session.estimatedBalance = undefined;
  }, [session]);
  useEffect(() => {
    invalidateChecks();
    return () => { checkRun.current += 1; checkController.current?.abort(); if (checkTimer.current !== undefined) clearTimeout(checkTimer.current); checkLock.current = false; };
  }, [metadata, invalidateChecks]);
  const groups: ReviewGroup[] = (metadata?.groups ?? []).map(group => {
    const check = checks.source === metadata ? checks.values[group.draftId] : undefined;
    const current = group.draft && check?.context === reviewDraftContext(group.draft) ? check : undefined;
    return {...group, check:current, preflight:current?.phase === "complete" ? current.preflight : undefined};
  });
  const entryRef = usePreparationEntryScroll(`review:${sessionKey}`, Boolean(metadata && !query.loading && !query.refreshing || query.error));
  const reloadContext = () => { invalidateChecks(); query.reload(); };
  const reloadContextRef = useRef(reloadContext);
  reloadContextRef.current = reloadContext;
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => { if (event.persisted) reloadContextRef.current(); };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  const pending = groups.filter(group => !group.excluded && !session.acceptedIds[group.draftId]);
  const ordinary = pending.filter(group => !session.progress.requests[group.draftId]);
  const pendingPreflights = ordinary.flatMap(group => group.preflight ? [group.preflight] : []);
  const checksComplete = ordinary.length > 0 && ordinary.every(group => group.check?.phase === "complete" && Boolean(group.preflight));
  const totals = reviewBatchTotals(pendingPreflights);
  const selectedItems = ordinary.flatMap(group => group.preflight
    ? group.preflight.items.map(item => ({media:item.media, price:item.priceTenThousandths}))
    : (group.draft?.items ?? []).map(item => ({media:item.media, price:item.media.priceTenThousandths})));
  const selectedKind = (kind: string) => {
    const items = selectedItems.filter(item => item.media.kind === kind);
    const prices = items.map(item => item.price);
    return {count:items.length, amount:ordinary.every(group => group.draft) && prices.every(price => /^\d+$/.test(price)) ? prices.reduce((total, price) => total + BigInt(price), 0n) : undefined};
  };
  const selectedNews = selectedKind("news");
  const selectedSelfMedia = selectedKind("self_media");
  const waitingCount = ordinary.filter(group => !group.check).reduce((count, group) => count + (group.draft?.items.length ?? 0), 0);
  const checkingCount = ordinary.filter(group => group.check?.phase === "checking").reduce((count, group) => count + (group.draft?.items.length ?? 0), 0);
  const errorCount = ordinary.filter(group => group.check?.phase === "failed").reduce((count, group) => count + (group.draft?.items.length ?? 0), 0);
  const publishMediaCount = new Set(pendingPreflights.flatMap(value => value.items.filter(item => !item.blockers.length).map(item => item.media.id))).size;
  const acceptedCount = activeIds.filter(id => Boolean(session.acceptedIds[id])).length;
  const unknownIds = activeIds.filter(id => Boolean(session.progress.requests[id]));
  const allAccepted = activeIds.length > 0 && acceptedCount === activeIds.length;
  const hasOrdinaryItems = ordinary.some(group => Boolean(group.draft?.items.length));
  const uncheckedAmountLabel = unknownIds.length ? "受理结果待确认" : ordinary.length ? "待预检" : "无待预占";
  const attention = Object.values(session.progress.accepted).some(reviewBatchNeedsAttention);
  const live = pendingPreflights.some(value => value.mode === "live");
  const available = checksComplete ? session.estimatedBalance ?? totals.available : undefined;
  const globalBlocked = pendingPreflights.some(value => value.blockers.length > 0);
  const insufficient = checksComplete && available !== undefined && available < totals.publishTotal;
  const busy = query.loading || query.refreshing || checking || submitting || Boolean(refreshingCatalog);
  const canPublish = checksComplete && groups.length === draftIds.length && !groups.some(group => group.error) && !query.error && !busy && !attention && !unknownIds.length && !globalBlocked && !insufficient && totals.passedCount > 0;
  const canRecover = unknownIds.length > 0 && !busy && !attention && !query.error && !groups.some(group => group.error);
  const blockedCount = pendingPreflights.reduce((count, value) => count + value.blockers.length + value.items.filter(item => item.blockers.length).length, 0);
  const runPreflight = async () => {
    if (busy || checkLock.current || !metadata) return;
    if (unknownIds.length || attention) { reloadContext(); return; }
    const source = metadata;
    const targets = ordinary.filter(group => group.draft && !group.error);
    if (!targets.length) { reloadContext(); return; }
    invalidateChecks();
    const run = checkRun.current;
    const controller = new AbortController();
    checkController.current = controller;
    checkLock.current = true;
    setChecking(true);
    setSubmitError("");
    const scopeCurrent = operationScope();
    const isCurrent = () => run === checkRun.current && !controller.signal.aborted &&
      currentMetadata.current === source && currentSession.current === session && scopeCurrent();
    setChecks({source, values:Object.fromEntries(targets.map(group => [group.draftId,
      {context:reviewDraftContext(group.draft!), phase:"checking" as const}]))});
    const timeout = setTimeout(() => {
      if (!isCurrent()) return;
      controller.abort();
      checkRun.current += 1;
      checkLock.current = false;
      setChecking(false);
      setChecks(current => current.source !== source ? current : {...current, values:Object.fromEntries(
        Object.entries(current.values).map(([id, value]) => [id, value.phase === "checking" ?
          {...value, phase:"failed" as const, error:new Error("预检请求超时，请重试。")} : value]))});
    }, 20_000);
    checkTimer.current = timeout;
    try {
      await Promise.all(targets.map(async group => {
        const context = reviewDraftContext(group.draft!);
        try {
          // Re-read before and after the request: revisions, frozen versions,
          // titles and media changes invalidate this run rather than reusing it.
          const before = await gateway.getDraft(group.draftId, controller.signal);
          if (!isCurrent()) return;
          if (reviewDraftContext(before) !== context) {
            setSubmitError("稿件、标题或媒体选择已变化，请确认更新后的内容，再点击一键预检。");
            reloadContext();
            return;
          }
          const preflight = await gateway.preflightDraft(group.draftId, controller.signal);
          if (!isCurrent()) return;
          const after = await gateway.getDraft(group.draftId, controller.signal);
          if (!isCurrent()) return;
          if (reviewDraftContext(after) !== context || !preflightMatchesReviewDraft(after, preflight)) {
            setSubmitError("稿件版本或标题已变化，请确认更新后的内容，再点击一键预检。");
            reloadContext();
            return;
          }
          setChecks(current => current.source !== source ? current : {...current, values:{...current.values,
            [group.draftId]:{context, phase:"complete", preflight}}});
        } catch (reason) {
          if (!isCurrent()) return;
          const error = reason instanceof Error ? reason : new Error("本稿预检失败，请重试。");
          setChecks(current => current.source !== source ? current : {...current, values:{...current.values,
            [group.draftId]:{context, phase:"failed", error}}});
        }
      }));
    } finally {
      clearTimeout(timeout);
      if (checkTimer.current === timeout) checkTimer.current = undefined;
      if (isCurrent()) { checkLock.current = false; setChecking(false); }
    }
  };
  const persist = async () => {
    for (const [id, batch] of Object.entries(session.progress.accepted)) session.acceptedIds[id] = batch.id;
    const currentKeys=Object.fromEntries(Object.entries(session.progress.requests).map(([id, request]) => [id, request.idempotencyKey]));
    const resolved=Object.fromEntries(Object.entries(previousRequestKeys.current).filter(([id, key]) => currentKeys[id] !== key));
    const relatedUpdates=clearResolvedReviewRequests(gateway,sessionPrefix,resolved,flow?.selections);
    const saved = JSON.stringify({acceptedBatchIds:session.acceptedIds, requests:session.progress.requests});
    if (currentSession.current === session) { acceptSavedProgress(saved); redraw(value => value + 1); }
    await flow?.saveValues?.({
      ...relatedUpdates,
      [progressKey]:saved, batchDraftIds:draftIds, excludedDraftIds,
      ...(groups.length ? {publishingDraftTitleModes:Object.fromEntries(groups.flatMap(group => {
        const mode=group.preflight?.titleMode ?? group.draft?.titleMode;
        return mode === "single" || mode === "per_media" ? [[group.draftId, mode]] : [];
      }))} : {}),
      publishingBatchReviewPending:activeIds.some(id => !session.acceptedIds[id] || !session.progress.accepted[id] || reviewBatchNeedsAttention(session.progress.accepted[id])),
    });
    previousRequestKeys.current=currentKeys;
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    void persistRef.current().catch(reason => setSubmitError(reason instanceof Error ? reason.message : "发布进度保存失败，请重试。"));
  }, [session, query.data]);
  usePublishingSummary({title:"费用与发布状态", items:[
    {label:"稿件", value:draftIds.length + " 篇 · 已受理 " + acceptedCount + " 篇"},
    {label:"待发布组合", value:checksComplete ? totals.passedCount + " 项" : unknownIds.length ? "受理结果待确认" : hasOrdinaryItems ? "待预检" : "0 项"},
    {label:"待预占费用", value:checksComplete ? formatPublishingMoney(totals.publishTotal.toString()) : uncheckedAmountLabel},
    {label:"预检结果", value:unknownIds.length ? unknownIds.length + " 篇待确认受理结果" : allAccepted ? "全部发布请求已受理" : !checksComplete ? checking ? "预检中" : hasOrdinaryItems ? "请点击一键预检" : "未选择投放媒体" : blockedCount ? blockedCount + " 项待处理" : "等待确认发布"},
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
      } else reloadContext();
    } catch (reason) {
      if (!isCurrent()) return;
      const unknown = Object.keys(session.progress.requests).length > 0;
      setSubmitError((reason instanceof Error ? reason.message : "发布请求未能提交") + (unknown ? " 受理结果尚未确认，后续稿件已暂停；重试只会核实原请求。" : Object.keys(session.progress.accepted).length ? " 已受理批次已保留，后续稿件尚未提交。" : ""));
      setDialogOpen(false);
      if (!unknown) { setAcknowledged(false); session.estimatedBalance = undefined; reloadContext(); }
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
      if (isCurrent()) { session.estimatedBalance = undefined; reloadContext(); }
    } catch (reason) { if (isCurrent()) setSubmitError(reason instanceof Error ? reason.message : "目录快照刷新失败"); }
    finally { if (isCurrent()) setRefreshingCatalog(undefined); }
  };
  const reviseIds = acceptedCount ? activeIds.filter(id => !session.acceptedIds[id]) : draftIds;
  const reviseResources = reviseIds.map(id => {
    const group=groups.find(value=>value.draftId===id);
    return {draftId:id, articleId:group?.preflight?.article.id ?? group?.draft?.articleId,
      versionId:group?.preflight?.article.versionId ?? group?.draft?.articleVersionId};
  });
  const contextualPath = (path: string, replacements: Record<string, string> = {}) => {
    const params = new URLSearchParams(routeSearch);
    // A partial submission returns only the remaining manuscripts. Do not let
    // old article/version parameters re-add already accepted drafts upstream.
    if (acceptedCount && reviseResources.length) {
      params.delete("batchArticle");
      params.delete("batchArticleVersion");
      params.delete("articleVersion");
      params.delete("articleId");
      params.set("draftId", reviseResources[0]!.draftId);
      for (const resource of reviseResources) {
        if (resource.articleId) params.append("batchArticle", resource.articleId);
        if (resource.versionId) params.append("batchArticleVersion", resource.versionId);
      }
      if (reviseResources[0]!.versionId) params.set("articleVersion", reviseResources[0]!.versionId);
    }
    for (const [name, value] of Object.entries(replacements)) params.set(name, value);
    return path + (params.size ? "?" + params.toString() : "");
  };
  const reviseModes = reviseIds.map(id => {
    const group = groups.find(value => value.draftId === id);
    return {titleMode:group?.preflight?.titleMode ?? group?.draft?.titleMode};
  });
  const titleStage = publishingTitleStage(reviseModes);
  const modesKnown = Boolean(titleStage);
  const reviseStage = titleStage === "review" ? "media" : titleStage;
  const reviseHref = reviseStage ? publishingTaskUrl(withPublishingBatch(contextualPath(
    "/publishing/drafts/" + encodeURIComponent(reviseIds[0]!) + "/" + reviseStage,
    reviseStage === "media" ? {mode:"single"} : {},
  ), reviseIds, acceptedCount ? [] : excludedDraftIds), flow?.taskId) : undefined;
  const reviseLabel = acceptedCount ? "修改待提交稿件" : reviseStage === "media" ? "返回选择媒体" : "返回修改标题";
  const reviseArticleIds = reviseIds.map(id => {
    const group = groups.find(value => value.draftId === id);
    return group?.preflight?.article.id ?? group?.draft?.articleId;
  });
  const bodyEditHref = (group: ReviewGroup) => {
    // The editor restores actual article units, not draft references. Never
    // turn a multi-draft fix into a one-article editor by guessing missing IDs.
    if (!group.preflight || reviseArticleIds.some(id => !id)) return undefined;
    const url = new URL(contextualPath("/publishing/articles/" + encodeURIComponent(group.preflight.article.id) + "/edit", {
      draftId:group.draftId, mode:group.preflight.titleMode ?? group.draft?.titleMode ?? "per_media", from:"review",
    }), window.location.origin);
    url.searchParams.delete("batchArticle");
    for (const id of reviseArticleIds) if (id) url.searchParams.append("batchArticle", id);
    return publishingTaskUrl(withPublishingBatch(url.pathname + url.search, reviseIds, acceptedCount ? [] : excludedDraftIds), flow?.taskId);
  };
  // Read persisted draft modes, never infer a title stage from the number of manuscripts.
  const reviewStage = groups.length === draftIds.length
    ? publishingTitleStage(groups.map(group => ({titleMode:group.preflight?.titleMode ?? group.draft?.titleMode}))) : undefined;
  const stages = reviewStage ? flowStagesForMode(reviewStage === "review" ? "single" : "per_media") : undefined;
  return <div className="publishing-review-page" ref={entryRef}>
    <PublishingPage title="发布内容检查与费用核验" layout="review" busy={busy}>
      {!flow && stages ? <PublishingFlowSteps stages={stages} doneCount={stages.length - 1} activeIndex={stages.length - 1} /> : null}
      <div className="publishing-review-layout">
        <section className="publishing-review-main">
          <section className="publishing-panel publishing-review-table" aria-labelledby="publishing-content-check-heading">
            <header className="publishing-review-results-head">
              <div className="publishing-review-results-title">
                <h2 id="publishing-content-check-heading">发布内容检查</h2>
                {!allAccepted || attention ? <button type="button" className="publishing-button publishing-button-primary" disabled={busy || !hasOrdinaryItems && !unknownIds.length && !attention && !groups.some(group => group.error)} aria-busy={busy || undefined} onClick={() => void runPreflight()}>{checking ? "预检中…" : query.loading || query.refreshing ? "正在读取…" : unknownIds.length || attention ? "刷新受理状态" : "一键预检"}</button> : null}
              </div>
              {ordinary.length ? <p className="publishing-review-counts" role="status">
                {waitingCount ? <span>待预检 <strong>{waitingCount}</strong> 项 · </span> : null}
                {checkingCount ? <span>预检中 <strong>{checkingCount}</strong> 项 · </span> : null}
                {errorCount ? <span>预检失败 <strong>{errorCount}</strong> 项 · </span> : null}
                {pendingPreflights.length ? <span>通过 <strong>{totals.passedCount}</strong> · 不通过 <strong>{totals.failedCount}</strong></span> : null}
                {totals.failedCount ? <span className="publishing-review-excluded">未纳入本次发布：{totals.failedCount} 项 · {formatPublishingMoney(totals.excludedTotal.toString())}</span> : null}
                {totals.failedCount && totals.passedCount ? <span className="publishing-review-partial">部分发布：未通过组合将先移出对应稿件发布草稿</span> : null}
              </p> : null}
            </header>
            {query.loading ? <PublishingLoading label="正在恢复稿件、媒体与冻结版本…" /> : null}
            {query.error ? <PublishingError error={query.error} onRetry={reloadContext} /> : null}
            {groups.length ? <div className="publishing-review-head publishing-review-row"><span>媒体</span><span>发布标题</span><span>内容检查</span><span>状态</span></div> : null}
            {groups.map((group, index) => {
              const preflight = group.preflight;
              const batch = session.progress.accepted[group.draftId] ?? group.batch;
              const uncertain = Boolean(session.progress.requests[group.draftId]);
              const items = preflight?.items ?? group.draft?.items ?? [];
              const title = groupTitle(group);
              const version = preflight?.article.version ?? group.draft?.articleVersion;
              const groupTotals = reviewBatchTotals(preflight ? [preflight] : []);
              const previewId = "publishing-frozen-preview-" + index;
              const statusLabel = group.check?.phase === "checking" ? "预检中" : group.check?.phase === "failed" ? "预检失败" : "待预检";
              return <section key={group.draftId} className="publishing-review-draft-group" aria-label={"稿件 " + (index + 1) + "：" + title}>
                <div className="publishing-review-draft-row">
                  <span className="publishing-review-draft-index">稿件 {index + 1}</span><strong>{title}</strong>
                  <span>{version === undefined ? "版本待恢复" : "版本 v" + version}</span>
                  <button className="publishing-button publishing-button-secondary publishing-review-preview-toggle" type="button" disabled={!preflight} title={!preflight ? "完成预检后可查看对应冻结正文" : undefined} aria-controls={previewId} aria-expanded={Boolean(preflight && expanded.has(group.draftId))} onClick={() => setExpanded(current => {const next=new Set(current); next.has(group.draftId) ? next.delete(group.draftId) : next.add(group.draftId); return next;})}><ExternalLink size={15} />{preflight && expanded.has(group.draftId) ? "收起冻结正文" : "查看冻结正文"}</button>
                  {!preflight && !batch && !uncertain ? <small className="publishing-review-preview-note">完成预检后可查看</small> : null}
                  <span className="publishing-review-draft-counts">{group.excluded ? "未选择投放媒体" : batch ? "发布请求已受理" : uncertain ? "受理结果待确认" : preflight ? "通过 " + groupTotals.passedCount + " · 不通过 " + groupTotals.failedCount : statusLabel + " " + items.length + " 项"}</span>
                </div>
                {group.error ? <PublishingError error={group.error} onRetry={reloadContext} /> : null}
                {preflight && expanded.has(group.draftId) ? <section id={previewId} className="publishing-frozen-preview" aria-label={title + "冻结正文预览"}><header><div><h2>{title}</h2><p>不可变版本 v{preflight.article.version} · {preflight.article.hash}</p></div><span>{preflight.article.imageCount} 张冻结图片</span></header><div className="publishing-frozen-preview-body" dangerouslySetInnerHTML={{__html:preflight.article.bodyHtml}} /></section> : null}
                {group.excluded ? <div className="publishing-review-group-status"><strong>本稿未纳入发布</strong><p>已取消全部媒体，不执行预检、不校验标题，也不产生本次费用。返回修改可重新选择媒体。</p></div> : batch ? <div className="publishing-review-group-status" role="status">
                  <strong>发布请求已受理 · {batchStatus(batch)}</strong><p>{batch.itemCount} 项 · {formatPublishingMoney(batch.totalTenThousandths)} · 批次 {batch.id}</p>
                  <Link className="publishing-button publishing-button-secondary" href={publishingTaskUrl("/publishing/publications/" + encodeURIComponent(batch.id), flow?.taskId)}>查看本稿发布结果<ExternalLink size={15} /></Link>
                  <ul className="publishing-review-receipts">{batch.items.map(item => <li key={item.id}><strong>{item.media.name}</strong><span>{item.title}</span><span>{({queued:"排队中",submitting:"正在提交",processing:"处理中",success:"发布成功",failed:"发布失败",auth_blocked:"授权待处理",submission_unknown:"结果待核实",action_required:"待处理"})[item.status]}</span>{item.resultUrl ? <a href={item.resultUrl} target="_blank" rel="noreferrer">查看发布链接</a> : null}</li>)}</ul>
                </div> : uncertain ? <div className="publishing-review-group-status"><strong>发布请求待确认</strong><p>将使用原请求核实受理结果；本稿尚未计作发布成功。</p><ul>{items.map(item => <li key={item.media.id}>{item.media.name} · {item.title}</li>)}</ul></div> : <>
                  {group.check?.error ? <p className="publishing-form-error publishing-review-check-error" role="alert">{group.check.error.message} 请点击“一键预检”重试。</p> : null}
                  {!items.length && !group.error ? <p className="publishing-review-group-status">未选择投放媒体，请返回修改后重新预检。</p> : null}
                  {items.map(item => {
                    const result = preflight?.items.find(value => value.media.id === item.media.id);
                    return <div className="publishing-review-row" key={group.draftId + ":" + group.draft?.articleVersionId + ":" + item.media.id}>
                      <span className="publishing-media-name" data-label="媒体"><MediaMark name={item.media.shortName} id={item.media.id} logoUrl={item.media.logoUrl} logoSource={item.media.logoSource} logoResolutionStatus={item.media.logoResolutionStatus} /><span><strong>{item.media.name}</strong><span className="publishing-kind-chip">{item.media.kind === "self_media" ? "自媒体" : item.media.kind === "news" ? "软文媒体" : "媒体类型待核验"}</span></span></span>
                      <span data-label="发布标题">{item.title}</span>
                      <span data-label="内容检查">{result ? <span className="publishing-review-check-details">
                        {result.checks.map((check, checkIndex) => <span key={checkIndex} className={check.passed ? "is-success" : "is-danger"}>{check.passed ? "✓ " : "× "}{check.label}</span>)}
                        {result.blockers.map((message, messageIndex) => <span key={"blocker-" + messageIndex} className="is-danger">{message}</span>)}
                        {result.warnings.map((message, messageIndex) => <span key={"warning-" + messageIndex} className="publishing-row-warning"><AlertTriangle size={15} />{message}</span>)}
                        {!result.checks.length && !result.blockers.length ? <span>符合当前预检要求</span> : null}
                      </span> : "—"}</span>
                      <span data-label="状态">{result ? result.blockers.length ? <span className="publishing-status is-danger">不通过</span> : <span className="publishing-status is-success"><CheckCircle2 size={14} />通过</span> : <span className={"publishing-status " + (group.check?.phase === "failed" ? "is-danger" : group.check?.phase === "checking" ? "is-info" : "is-neutral")}>{statusLabel}</span>}</span>
                    </div>;
                  })}
                  {preflight?.warnings.length ? <div className="publishing-notice is-warning"><AlertTriangle size={21} /><div><strong>本稿内容提示</strong><p>{[...new Set(preflight.warnings)].join("；")}</p></div></div> : null}
                  {preflight && (preflight.blockers.length || preflight.items.some(item => item.blockers.length)) ? <div className="publishing-notice is-danger" role="alert"><AlertTriangle size={21} /><div><strong>{preflight.blockers.length || !groupTotals.passedCount ? "本稿当前不能发布" : "本稿部分组合未通过"}</strong>
                    {preflight.blockers.length ? <p>{[...new Set(preflight.blockers)].join("；")}</p> : null}
                    {refreshable(preflight) ? <button className="publishing-button publishing-button-secondary" type="button" disabled={busy || Boolean(unknownIds.length)} onClick={() => acceptCatalogChanges(group)}>{refreshingCatalog === group.draftId ? "正在刷新目录快照…" : "接受本稿当前目录"}</button> : null}
                    {!unknownIds.length && !submitting && bodyEditHref(group) ? <Link className="publishing-row-fix" href={bodyEditHref(group)!}>修改本稿正文</Link> : null}
                  </div></div> : null}
                </>}
              </section>;
            })}
          </section>
        </section>
        {groups.length ? <>
        <section className="publishing-panel publishing-review-fees" aria-label="费用与预算核验">
          <header className="publishing-review-fees-head"><h2>费用与预算核验</h2></header>
          <dl className="publishing-money-summary">
            <div><dt>软文媒体小计</dt><dd>{selectedNews.count} 项 · {selectedNews.amount === undefined ? "待核验" : formatPublishingMoney(selectedNews.amount.toString())}</dd></div>
            <div><dt>自媒体小计</dt><dd>{selectedSelfMedia.count} 项 · {selectedSelfMedia.amount === undefined ? "待核验" : formatPublishingMoney(selectedSelfMedia.amount.toString())}</dd></div>
            <div><dt>预计总价</dt><dd className="is-total">{checksComplete ? formatPublishingMoney(totals.publishTotal.toString()) : uncheckedAmountLabel}</dd></div>
            <div><dt>{session.estimatedBalance !== undefined && acceptedCount ? "预计可用余额" : "可用余额"}</dt><dd>{available === undefined ? "待核验" : formatPublishingMoney(available.toString())}</dd></div>
            <div><dt>本次待预占</dt><dd>{checksComplete ? formatPublishingMoney(totals.publishTotal.toString()) : uncheckedAmountLabel}</dd></div>
            <div className="publishing-money-after"><dt>预占后预计可用</dt><dd>{available === undefined ? "待核验" : formatPublishingMoney((available - totals.publishTotal).toString())}</dd></div>
          </dl>
          <p className="publishing-review-cost-note">两类小计包含待提交稿件的全部已选媒体，未预检时显示草稿保存的目录报价；正式费用以预检返回的报价为准。预计总价仅计入通过内容检查的组合。同一家媒体用于两篇稿件时计为两项。已取消稿件与已受理批次不重复计费。</p>
          {draftIds.length > 1 ? <p className="publishing-review-cost-note">各稿件将逐篇提交；中途失败或结果待核实时会停止后续提交，已受理批次会保留。每稿提交前重新核验余额，账户余额以服务端结果为准。</p> : null}
          {busy || query.error ? <p className="publishing-review-cost-note" role="status">{query.error ? "稿件信息未能更新，请重试读取；当前不能确认发布。" : "正在更新，请等待预检或提交完成。"}</p> : null}
          {insufficient ? <p className="publishing-form-error" role="alert">可用余额不足以覆盖本次全部待提交组合，请调整媒体后重新预检。</p> : null}
          {allAccepted ? <p className="publishing-notice is-success" role="status"><CheckCircle2 size={18} />全部 {acceptedCount} 篇稿件的发布请求已受理，请在上方查看各批次结果。</p> : <label className="publishing-acknowledgement">
            <input type="checkbox" checked={acknowledged} disabled={busy || (!canPublish && !canRecover)} onChange={event => setAcknowledged(event.target.checked)} />
            <span>{unknownIds.length ? "我已确认重试核实原发布请求；核实后将重新预检并确认剩余稿件。" : !hasOrdinaryItems ? "未选择投放媒体，请返回修改后继续。" : !checksComplete ? "请先点击一键预检，完成当前稿件与媒体的检查后再确认发布。" : live ? "我已确认向 " + totals.passedCount + " 项稿件与媒体组合真实投稿。成功后扣款；明确拒稿或失败自动退回；状态未知时金额继续冻结等待对账。" : "我已确认以 Preview 模拟方式提交 " + totals.passedCount + " 项稿件与媒体组合。本次不会联系供应商或产生真实费用。"}</span>
          </label>}
          {!allAccepted && !unknownIds.length && !checksComplete ? <p className="publishing-review-cost-note" role="status">{!hasOrdinaryItems ? "未选择投放媒体，无法继续。请返回修改。" : errorCount ? "有投放项预检失败，请重试完成预检后再确认发布。" : "尚未完成本次预检，不能确认发布。请点击上方“一键预检”。"}</p> : null}
          {submitError ? <p className="publishing-form-error" role="alert">{submitError}</p> : null}
          {attention ? <p className="publishing-form-error" role="status">已受理批次有待核实结果，后续稿件暂停提交。请查看该批次并刷新结果后继续。</p> : null}
          {unknownIds.length ? <p className="publishing-form-error" role="status">有 {unknownIds.length} 篇稿件的请求待确认。核实前暂停修改标题和刷新目录；刷新受理状态也会保留原提交请求。</p> : null}
        </section>
        <footer className="publishing-workflow-footer">
          {allAccepted ? <span role="status">已受理批次将继续更新结果</span> : unknownIds.length || submitting || !reviseHref ? <button type="button" className="publishing-button publishing-button-secondary" disabled><ArrowLeft size={16} />{reviseLabel}</button> : onRevise && !acceptedCount ? <button type="button" className="publishing-button publishing-button-secondary" onClick={() => onRevise(reviseHref)}><ArrowLeft size={16} />{reviseLabel}</button> : <Link className="publishing-button publishing-button-secondary" href={reviseHref}><ArrowLeft size={16} />{reviseLabel}</Link>}
          {!allAccepted && !modesKnown ? <p className="publishing-form-error" role="status">稿件模式尚未恢复，请重试读取本次稿件后再返回修改。</p> : null}
          {!allAccepted ? <div className="publishing-confirm-actions">
            <button type="button" className="publishing-button publishing-button-accent" disabled={!acknowledged || (!canPublish && !canRecover)} onClick={() => unknownIds.length ? void submit() : setDialogOpen(true)}>{submitting ? "正在提交…" : unknownIds.length ? "重试确认受理结果" : !checksComplete ? "确认发布" : (live ? "确认发布" : "模拟发布") + " " + totals.passedCount + " 项"}</button>
          </div> : null}
        </footer>
        </> : null}
      </div>
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

