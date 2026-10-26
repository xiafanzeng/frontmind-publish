import { AlertTriangle, ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { PublishingConfirmDialog, PublishingError, PublishingLoading } from "../components/PublishingUi";
import PublishingFrozenArticleDialog from "../components/PublishingFrozenArticleDialog";
import { usePublishingChoice } from "../components/PublishingConversation";
import { formatPublishingMoney, type PublicationBatch, type PublicationDraft, type PublicationPreflight } from "../types";
import { usePublishingFlow, usePublishingSummary, usePublishingOperationScope, publishingTaskUrl } from "../PublishingFlowContext";
import { readPublishingBatch, withPublishingBatch } from "../batchPublishing";
import { reviewBatchNeedsAttention, reviewBatchTotals, submitReviewBatch } from "../reviewBatch";
import { clearResolvedReviewRequests, mergeReviewSessionReceipts, restoreReviewSession, reviewSessions } from "../reviewSession";
import { publishingTitleStage } from "../titleFlow";
import { preflightMatchesReviewDraft, reviewDraftContext, type ManualReviewCheck } from "../reviewPreflight";
import { publicationLineTotal, publicationQuantity } from "../publicationAmounts";
import "../publishing.review-batch.css";

const REFRESHABLE_CATALOG_BLOCKERS = new Set([
  "CATALOG_CHANGED", "PRICE_CHANGED", "MEDIA_KIND_CHANGED", "MEDIA_METADATA_CHANGED",
  "MEDIA_CAPABILITY_CHANGED", "TITLE_LIMIT_CHANGED",
]);
type ReviewGroup = { draftId: string; excluded: boolean; preflight?: PublicationPreflight; draft?: PublicationDraft; batch?: PublicationBatch; error?: Error; check?: ManualReviewCheck };
const refreshable = (value: PublicationPreflight) => [...(value.blockerCodes ?? []), ...value.items.flatMap(item => item.blockerCodes ?? [])].some(code => REFRESHABLE_CATALOG_BLOCKERS.has(code));
const batchStatus = (batch: PublicationBatch) => ({queued:"排队中", processing:"发布处理中", success:"发布成功", failed:"发布失败", partial_success:"部分发布成功", action_required:"待处理"})[batch.status] ?? "已受理";

export type PreparedPublishingConfiguration = { signature: string; drafts: PublicationDraft[] };
export type PublishingConfiguration = PreparedPublishingConfiguration & {
  ready: boolean; invalid: boolean; saving: boolean; mediaHref: string;
  loading: boolean; error?: Error;
};
export type PublishingConfirmationView = {
  busy: boolean; unknown: boolean; unknownIds: string[]; acceptedIds: Record<string, string>;
  groups: ReviewGroup[]; feedback: (draftId: string) => ReactNode;
};
type ConfirmationProps = {
  draftId: string;
  configuration: PublishingConfiguration;
  prepareConfiguration: () => Promise<PreparedPublishingConfiguration | undefined>;
  onReloadConfiguration: () => void;
  children: (view: PublishingConfirmationView) => ReactNode;
  onSubmitted?: (batchId: string) => void;
};

/** Internal title-page controller; legacy review routes are redirects, not a second page. */
export default function PublishingConfirmation(props: ConfirmationProps) {
  const search = useSearch();
  const flow = usePublishingFlow();
  const batch = readPublishingBatch(props.draftId, search);
  const identity = JSON.stringify([batch.draftIds, flow?.scopeKey, flow?.taskId, search]);
  if (flow?.pending) return <PublishingLoading label="正在恢复稿件与已受理批次…" />;
  return <ReviewContent key={identity} {...props} draftIds={batch.draftIds} />;
}

function ReviewContent({ draftId, draftIds, onSubmitted, configuration, prepareConfiguration, onReloadConfiguration, children }: ConfirmationProps & { draftIds: string[] }) {
  const excludedDraftIds = configuration.drafts.filter(draft => !draft.items.length).map(draft => draft.id);
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const [, navigate] = useLocation();
  const routeSearch = useSearch();
  const batchKey = JSON.stringify(draftIds);
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
  const [preparing, setPreparing] = useState(false);
  const prepareLock = useRef(false);
  const pendingCheck = useRef<{ previous: unknown; prepared: PreparedPublishingConfiguration }>();
  const autoDialog = useRef<{ run: number; signature: string }>();
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [preview, setPreview] = useState<{draftId: string; context: string; run: number; trigger: HTMLButtonElement}>();
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
      const excluded = false; // Current exclusions are derived from the live title configuration below.
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
  const balanceReceiptKey = JSON.stringify([session.acceptedIds, session.progress.requests]);
  // The existing overview reads the authenticated media-publishing wallet.
  // Keep that read independent of content preflight and request receipts.
  const loadBalance = useCallback(async (signal: AbortSignal) => {
    if (!metadata) return undefined;
    const dashboard = await gateway.getDashboard(signal);
    const amount = dashboard.wallet?.availableTenThousandths;
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) throw new Error("账户余额未返回有效金额，请重试读取。");
    return {source:metadata, receipts:balanceReceiptKey, amount:BigInt(amount)};
  }, [gateway, metadata, balanceReceiptKey]);
  const balanceQuery = usePublisherQuery(loadBalance);
  const currentBalance = balanceQuery.data && balanceQuery.data.source === metadata && balanceQuery.data.receipts === balanceReceiptKey ? balanceQuery.data : undefined;
  const [checks, setChecks] = useState<{source: typeof metadata; signature?: string; values: Record<string, ManualReviewCheck>}>({source:undefined, values:{}});
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
    autoDialog.current = undefined;
    session.estimatedBalance = undefined;
  }, [session]);
  useEffect(() => {
    invalidateChecks();
    return () => { checkRun.current += 1; checkController.current?.abort(); if (checkTimer.current !== undefined) clearTimeout(checkTimer.current); checkLock.current = false; };
  }, [metadata, configuration.signature, invalidateChecks]);
  useEffect(() => {
    const intent = pendingCheck.current;
    if (intent && configuration.signature !== intent.prepared.signature) {
      pendingCheck.current = undefined;
      prepareLock.current = false;
      setPreparing(false);
    }
  }, [configuration.signature]);
  const groups: ReviewGroup[] = (metadata?.groups ?? []).map(group => {
    const check = checks.source === metadata && checks.signature === configuration.signature ? checks.values[group.draftId] : undefined;
    const current = group.draft && check?.context === reviewDraftContext(group.draft) ? check : undefined;
    return {...group, excluded:excludedDraftIds.includes(group.draftId) && !session.acceptedIds[group.draftId] && !session.progress.requests[group.draftId], check:current, preflight:current?.phase === "complete" ? current.preflight : undefined};
  });
  // Keep only the identity of the selected current check. Never retain a copy
  // of frozen HTML after its draft, version, selection or preflight is invalid.
  const previewGroup = preview && preview.run === checkRun.current ? groups.find(group =>
    group.draftId === preview.draftId && group.draft && reviewDraftContext(group.draft) === preview.context) : undefined;
  const previewArticle = typeof previewGroup?.preflight?.article.bodyHtml === "string" ? previewGroup.preflight.article : undefined;
  const closePreview = useCallback(() => setPreview(undefined), []);
  useEffect(() => { if (preview && !previewArticle) closePreview(); }, [preview, previewArticle, closePreview]);
  const reloadContext = () => { invalidateChecks(); query.reload(); onReloadConfiguration(); };
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
  const selectedItems = ordinary.flatMap(group => checksComplete && group.preflight
    ? group.preflight.items.map(item => ({media:item.media, price:item.priceTenThousandths}))
    : (configuration.drafts.find(draft => draft.id === group.draftId)?.items ?? []).map(item => ({media:item.media, price:publicationLineTotal(item) ?? ''})));
  const feesReading = configuration.loading || query.loading || query.refreshing;
  const selectedAmount = (items: typeof selectedItems) => {
    const prices = items.map(item => item.price);
    return metadata && configuration.ready && !feesReading && !configuration.error && !query.error && ordinary.every(group => group.draft && !group.error) && prices.every(price => /^\d+$/.test(price))
      ? prices.reduce((total, price) => total + BigInt(price), 0n) : undefined;
  };
  const selectedKind = (kind: string) => {
    const items = selectedItems.filter(item => item.media.kind === kind);
    return {count:items.length, amount:selectedAmount(items)};
  };
  const selectedNews = selectedKind("news");
  const selectedSelfMedia = selectedKind("self_media");
  const estimatedTotal = selectedAmount(selectedItems);
  const errorCount = ordinary.filter(group => group.check?.phase === "failed").reduce((count, group) => count + (group.draft?.items.length ?? 0), 0);
  const publishMediaCount = new Set(pendingPreflights.flatMap(value => value.items.filter(item => !item.blockers.length).map(item => item.media.id))).size;
  const acceptedCount = activeIds.filter(id => Boolean(session.acceptedIds[id])).length;
  const unknownIds = activeIds.filter(id => Boolean(session.progress.requests[id]));
  const allAccepted = activeIds.length > 0 && acceptedCount === activeIds.length;
  const hasOrdinaryItems = ordinary.some(group => Boolean(configuration.drafts.find(draft => draft.id === group.draftId)?.items.length));
  const uncheckedAmountLabel = unknownIds.length ? "受理结果待确认" : ordinary.length ? "待预检" : "无待预占";
  const attention = Object.values(session.progress.accepted).some(reviewBatchNeedsAttention);
  const live = pendingPreflights.some(value => value.mode === "live");
  const available = checksComplete ? session.estimatedBalance ?? totals.available : undefined;
  // Entry estimates are display-only. The original preflight wallet still
  // owns insufficient/canPublish, including submit-time balance adjustments.
  const balanceReading = balanceQuery.loading || balanceQuery.refreshing || Boolean(metadata && !currentBalance && !balanceQuery.error);
  const displayAvailable = checksComplete ? available : acceptedCount > 0 && session.estimatedBalance !== undefined ? session.estimatedBalance
    : !feesReading && !configuration.error && !query.error && !balanceReading && !balanceQuery.error ? currentBalance?.amount : undefined;
  const displayTotal = checksComplete ? totals.publishTotal : estimatedTotal;
  const amountPending = feesReading ? "正在读取…" : configuration.error || query.error || ordinary.some(group => group.error) ? "读取失败" : "报价待核验";
  const balancePending = configuration.error || query.error || balanceQuery.error ? "读取失败" : !metadata || feesReading || balanceReading ? "正在读取…" : "待核验";
  const formatSelected = (value: typeof selectedNews) => feesReading || !metadata
    ? query.error ? "读取失败" : "正在读取…"
    : value.count + " 项 · " + (value.amount === undefined ? amountPending : formatPublishingMoney(value.amount.toString()));
  const globalBlocked = pendingPreflights.some(value => value.blockers.length > 0);
  const insufficient = checksComplete && available !== undefined && available < totals.publishTotal;
  const busy = preparing || configuration.saving || query.loading || query.refreshing || checking || submitting || Boolean(refreshingCatalog);
  const canPublish = configuration.ready && !configuration.invalid && checksComplete && groups.length === draftIds.length && !groups.some(group => group.error) && !query.error && !busy && !attention && !unknownIds.length && !globalBlocked && !insufficient && totals.passedCount > 0;
  const canRecover = unknownIds.length > 0 && !busy && !attention && !query.error && !groups.some(group => group.error);
  const blockedCount = pendingPreflights.reduce((count, value) => count + value.blockers.length + value.items.filter(item => item.blockers.length).length, 0);
  const runPreflight = async () => {
    if (query.loading || query.refreshing || checking || submitting || refreshingCatalog || checkLock.current || !metadata) return;
    if (unknownIds.length || attention) { reloadContext(); return; }
    const source = metadata;
    const signature = configuration.signature;
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
      currentMetadata.current === source && currentSession.current === session && configurationRef.current.signature === signature && scopeCurrent();
    setChecks({source, signature, values:Object.fromEntries(targets.map(group => [group.draftId,
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
            setSubmitError("稿件、标题或媒体选择已变化，请确认更新后的内容，再点击确认发布。");
            reloadContext();
            return;
          }
          const preflight = await gateway.preflightDraft(group.draftId, controller.signal);
          if (!isCurrent()) return;
          const after = await gateway.getDraft(group.draftId, controller.signal);
          if (!isCurrent()) return;
          if (reviewDraftContext(after) !== context || !preflightMatchesReviewDraft(after, preflight)) {
            setSubmitError("稿件版本或标题已变化，请确认更新后的内容，再点击确认发布。");
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
      if (isCurrent()) { autoDialog.current = {run, signature}; checkLock.current = false; setChecking(false); }
    }
  };
  const beginConfirmation = async () => {
    if (busy || prepareLock.current || !configuration.ready || configuration.invalid || !hasOrdinaryItems || unknownIds.length || attention) return;
    const isCurrent = operationScope();
    prepareLock.current = true;
    setPreparing(true);
    setSubmitError("");
    invalidateChecks();
    try {
      const prepared = await prepareConfiguration();
      if (!isCurrent()) return;
      if (!prepared) { prepareLock.current = false; setPreparing(false); return; }
      // Reload only after all saves completed. Never run against the old query's drafts.
      pendingCheck.current = {previous:metadata, prepared};
      query.reload();
    } catch (reason) {
      if (isCurrent()) setSubmitError(reason instanceof Error ? reason.message : "配置保存失败，请重试。");
      prepareLock.current = false;
      if (isCurrent()) setPreparing(false);
    }
  };
  useEffect(() => {
    const intent = pendingCheck.current;
    if (!intent || query.loading || query.refreshing || configuration.saving) return;
    if (query.error) {
      pendingCheck.current = undefined; prepareLock.current = false; setPreparing(false);
      return;
    }
    if (!metadata || metadata === intent.previous || configuration.signature !== intent.prepared.signature) return;
    pendingCheck.current = undefined;
    prepareLock.current = false;
    setPreparing(false);
    const expected = new Map(intent.prepared.drafts.map(draft => [draft.id, reviewDraftContext(draft)]));
    if (ordinary.some(group => !group.draft || group.error || expected.get(group.draftId) !== reviewDraftContext(group.draft))) {
      setSubmitError("稿件或投放配置已变化，请核对更新后的内容，再点击确认发布。");
      onReloadConfiguration();
      return;
    }
    void runPreflight();
  }, [metadata, query.loading, query.refreshing, query.error, configuration.signature, configuration.saving]);
  useEffect(() => {
    const intent = autoDialog.current;
    if (!intent || checking || intent.run !== checkRun.current || intent.signature !== configuration.signature) return;
    autoDialog.current = undefined;
    if (canPublish) { setAcknowledged(false); setDialogOpen(true); }
  }, [checking, canPublish, configuration.signature]);
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
    if (!metadata || !configuration.ready) return;
    void persistRef.current().catch(reason => setSubmitError(reason instanceof Error ? reason.message : "发布进度保存失败，请重试。"));
  }, [session, query.data, configuration.ready]);
  usePublishingSummary({title:"费用与发布状态", items:[
    {label:"稿件", value:draftIds.length + " 篇 · 已受理 " + acceptedCount + " 篇"},
    {label:"待发布组合", value:checksComplete ? totals.passedCount + " 项" : unknownIds.length ? "受理结果待确认" : hasOrdinaryItems ? "待预检" : "0 项"},
    {label:"待预占费用", value:checksComplete ? formatPublishingMoney(totals.publishTotal.toString()) : uncheckedAmountLabel},
    {label:"预检结果", value:unknownIds.length ? unknownIds.length + " 篇待确认受理结果" : allAccepted ? "全部发布请求已受理" : !checksComplete ? checking ? "预检中" : hasOrdinaryItems ? "请点击确认发布" : "未选择投放媒体" : blockedCount ? blockedCount + " 项待处理" : "等待确认发布"},
  ], note:submitError || undefined});

  const submit = async () => {
    if (submitLock.current || !acknowledged || (!canPublish && !canRecover) || (!unknownIds.length && checks.signature !== configurationRef.current.signature)) return;
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
  const reviseStage = reviseIds.length && titleStage ? "media" : undefined;
  const reviseHref = reviseStage ? publishingTaskUrl(withPublishingBatch(contextualPath(
    "/publishing/drafts/" + encodeURIComponent(reviseIds[0]!) + "/" + reviseStage,
    reviseStage === "media" ? {mode:"single"} : {},
  ), reviseIds, acceptedCount ? [] : excludedDraftIds), flow?.taskId) : undefined;
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
  const feedback = (id: string) => {
    const group = groups.find(value => value.draftId === id);
    if (!group) return null;
    const value = group.preflight;
    const accepted = session.progress.accepted[id] ?? group.batch;
    const uncertain = Boolean(session.progress.requests[id]);
    const groupTotals = reviewBatchTotals(value ? [value] : []);
    return <div className="publishing-title-check-feedback">
      {group.error ? <PublishingError error={group.error} onRetry={reloadContext} /> : null}
      {accepted ? <div role="status"><strong>发布请求已受理 · {batchStatus(accepted)}</strong><p>{accepted.itemCount} 项 · {formatPublishingMoney(accepted.totalTenThousandths)}</p><Link className="publishing-button publishing-button-secondary" href={publishingTaskUrl("/publishing/publications/" + encodeURIComponent(accepted.id), flow?.taskId)}>查看本稿发布结果<ExternalLink size={15} /></Link></div>
        : uncertain ? <p role="status">发布请求受理结果待确认，当前配置已锁定；请核实原请求。</p>
        : group.excluded ? <p>本稿未纳入本次发布，不执行检查或产生本次费用。</p> : <>
          {group.check?.error ? <p className="publishing-form-error" role="alert">{group.check.error.message} 请点击“确认发布”重试核验。</p> : null}
          {value && group.draft ? <button type="button" className="publishing-button publishing-button-secondary" aria-haspopup="dialog" disabled={typeof value.article.bodyHtml !== "string"} onClick={event => setPreview({draftId:id, context:reviewDraftContext(group.draft!), run:checkRun.current, trigger:event.currentTarget})}>查看冻结正文<ExternalLink size={15} /></button> : null}
          {value?.warnings.length ? <p className="publishing-row-warning">{[...new Set(value.warnings)].join("；")}</p> : null}
          {value && (value.blockers.length || groupTotals.failedCount) ? <div className="publishing-notice is-danger" role="alert"><AlertTriangle size={21} /><div><strong>{value.blockers.length || !groupTotals.passedCount ? "本稿当前不能发布" : "本稿部分组合未通过"}</strong><p>{[...new Set(value.blockers)].join("；")}</p>
            {refreshable(value) ? <button type="button" className="publishing-button publishing-button-secondary" disabled={busy || Boolean(unknownIds.length)} onClick={() => void acceptCatalogChanges(group)}>{refreshingCatalog === id ? "正在刷新目录快照…" : "接受本稿当前目录"}</button> : null}
            {!unknownIds.length && !busy && bodyEditHref(group) ? <Link className="publishing-row-fix" href={bodyEditHref(group)!}>修改本稿正文</Link> : null}
          </div></div> : null}
        </>}
    </div>;
  };
  return <div className="publishing-title-confirmation publishing-review-page">
      {children({busy, unknown:unknownIds.length > 0, unknownIds, acceptedIds:session.acceptedIds, groups, feedback})}
      <div className="publishing-review-layout">
        {query.error ? <PublishingError error={query.error} onRetry={reloadContext} /> : null}
        {checking || checksComplete || errorCount ? <p className="publishing-review-counts" role="status">{checking ? "正在核验当前稿件、媒体与报价…" : `通过 ${totals.passedCount} 项 · 不通过 ${totals.failedCount} 项`}{errorCount ? ` · ${errorCount} 项核验未完成` : ""}{totals.failedCount ? `；未通过的组合不纳入本次提交，最终范围将在确认弹窗中列明。` : ""}</p> : null}
        <section className="publishing-panel publishing-review-fees" aria-label="费用与预算核验" aria-busy={feesReading || !checksComplete && balanceReading || undefined}>
          <header className="publishing-review-fees-head"><h2>费用与预算核验</h2></header>
          <dl className="publishing-money-summary">
            <div><dt>软文媒体小计</dt><dd>{formatSelected(selectedNews)}</dd></div>
            <div><dt>自媒体小计</dt><dd>{formatSelected(selectedSelfMedia)}</dd></div>
            <div><dt>预计总价</dt><dd className="is-total">{unknownIds.length ? "受理结果待确认" : allAccepted ? "无待提交投放" : displayTotal === undefined ? amountPending : formatPublishingMoney(displayTotal.toString())}</dd></div>
            <div><dt>{session.estimatedBalance !== undefined && acceptedCount ? "预计可用余额" : "可用余额"}</dt><dd>{displayAvailable === undefined ? balancePending : formatPublishingMoney(displayAvailable.toString())}</dd></div>
            <div><dt>本次待预占</dt><dd>{checksComplete ? formatPublishingMoney(totals.publishTotal.toString()) : feesReading || !metadata ? amountPending : unknownIds.length || !hasOrdinaryItems ? uncheckedAmountLabel : "待发布前核验后确定"}</dd></div>
            <div className="publishing-money-after"><dt>{checksComplete ? "预占后预计可用" : "按预估扣除后余额"}</dt><dd>{unknownIds.length ? "受理结果待确认" : displayAvailable === undefined ? balancePending : displayTotal === undefined ? amountPending : formatPublishingMoney((displayAvailable - displayTotal).toString())}</dd></div>
          </dl>
          <p className="publishing-review-cost-note">两类小计包含待提交稿件的全部已选投放项。完成核验前，预计总价与扣除后余额按当前所选投放项的目录报价预估，不代表内容已通过或资金已预占；核验完成后，预计总价与待预占仅计入通过内容检查的组合，以服务端报价为准。同一家媒体用于两篇稿件时分别计价；每项小计已包含发布次数和已确认费用，不重复乘次数。已取消、已排除稿件与已受理批次不重复计费。</p>
          {!checksComplete && balanceQuery.error ? <PublishingError error={balanceQuery.error} onRetry={balanceQuery.reload} /> : null}
          {draftIds.length > 1 ? <p className="publishing-review-cost-note">各稿件将逐篇提交；中途失败或结果待核实时会停止后续提交，已受理批次会保留。每稿提交前重新核验余额，账户余额以服务端结果为准。</p> : null}
          {busy || query.error ? <p className="publishing-review-cost-note" role="status">{query.error ? "稿件信息未能更新，请重试读取；当前不能确认发布。" : "正在更新，请等待预检或提交完成。"}</p> : null}
          {insufficient ? <p className="publishing-form-error" role="alert">可用余额不足以覆盖本次全部待提交组合，请调整媒体后重新预检。</p> : null}
          {!allAccepted && !unknownIds.length && !checksComplete && metadata && !feesReading && (!hasOrdinaryItems || errorCount > 0) ? <p className="publishing-review-cost-note" role="status">{!hasOrdinaryItems ? "未选择投放媒体，无法继续。请返回修改。" : "有投放项预检失败，请重试完成预检后再确认发布。"}</p> : null}
          {submitError ? <p className="publishing-form-error" role="alert">{submitError}</p> : null}
          {attention ? <p className="publishing-form-error" role="status">已受理批次有待核实结果，后续稿件暂停提交。请查看该批次并刷新结果后继续。</p> : null}
          {unknownIds.length ? <p className="publishing-form-error" role="status">有 {unknownIds.length} 篇稿件的请求待确认。核实前暂停修改标题和刷新目录；刷新受理状态也会保留原提交请求。</p> : null}
        </section>
        <footer className="publishing-workflow-footer">
          {allAccepted ? null : busy || unknownIds.length ? <button type="button" className="publishing-button publishing-button-secondary" disabled><ArrowLeft size={16} />返回选择媒体</button>
            : <Link className="publishing-button publishing-button-secondary" href={acceptedCount ? reviseHref ?? configuration.mediaHref : configuration.mediaHref}><ArrowLeft size={16} />{acceptedCount ? "修改待提交稿件" : "返回选择媒体"}</Link>}
          {allAccepted ? <span role="status">全部发布请求已受理，请查看各稿件结果</span> : unknownIds.length ? <button type="button" className="publishing-button publishing-button-accent" disabled={!canRecover} onClick={() => {setAcknowledged(false); setDialogOpen(true);}}>核实原请求受理结果</button>
            : <button type="button" className="publishing-button publishing-button-accent" aria-busy={busy || undefined} disabled={busy || !configuration.ready || configuration.invalid || !hasOrdinaryItems || attention} onClick={() => void beginConfirmation()}>{configuration.saving || preparing ? "正在保存…" : checking ? "正在核验…" : submitting ? "正在提交…" : "确认发布"}</button>}
          {attention ? <button type="button" className="publishing-button publishing-button-secondary" disabled={busy} onClick={reloadContext}>刷新受理状态</button> : null}
        </footer>
      </div>
      <PublishingFrozenArticleDialog article={previewArticle} trigger={preview?.trigger} onClose={closePreview} />
      <PublishingConfirmDialog open={dialogOpen && (unknownIds.length > 0 || checks.signature === configuration.signature)} title={unknownIds.length ? "核实原发布请求" : live ? "这是一次真实投稿" : "确认 Preview 模拟发布"}
        description={unknownIds.length ? "仅核实已派发请求，使用原请求标识和载荷，不创建新的投放请求；核实后剩余稿件需要重新确认。" : (live ? "提交后将按逐稿预检快照预占余额，供应商可能立即接单，已创建的外部订单不保证可以撤回。" : "只生成确定性 Mock 批次，不会请求外部供应商。") + (draftIds.length > 1 ? "各稿件逐篇提交，中途失败将保留已受理批次并停止后续稿件。" : "") + (totals.failedCount ? "本次仅提交通过预检的 " + totals.passedCount + " 项，未通过的 " + totals.failedCount + " 项不提交。" : "")}
        confirmLabel={unknownIds.length ? "核实原请求" : (live ? "提交并预占" : "确认模拟发布") + " " + formatPublishingMoney(totals.publishTotal.toString())} confirmDisabled={!acknowledged || (!canPublish && !canRecover)} busy={submitting} wide onCancel={() => setDialogOpen(false)} onConfirm={submit}>
        <label className="publishing-check-row publishing-review-confirm">
          <input type="checkbox" checked={acknowledged} disabled={submitting || (!canPublish && !canRecover)} onChange={event => setAcknowledged(event.target.checked)} />
          <span>{unknownIds.length ? "我已确认核实原发布请求的受理结果。" : live ? "我已核对本次稿件、媒体、标题、发布次数与最终报价，并确认真实投稿。" : "我已确认本次为 Preview 模拟发布，不会联系供应商或产生真实费用。"}</span>
        </label>
        {!unknownIds.length ? <><div className="publishing-dialog-facts"><p><span>待提交稿件</span><strong>{pending.filter(group => group.preflight?.items.some(item => !item.blockers.length)).length} 篇</strong></p><p><span>投稿媒体（去重）</span><strong>{publishMediaCount} 家</strong></p><p><span>投稿组合</span><strong>{totals.passedCount} 项</strong></p><p><span>运行模式</span><strong>{live ? "真实发布" : "PREVIEW"}</strong></p></div>
        <div className="publishing-live-confirmation">
          {pending.filter(group => group.preflight?.items.some(item => !item.blockers.length)).map(group => {const value=group.preflight!; return <section className="publishing-review-confirm-group" key={group.draftId}>
            <h3>{value.article.title} · v{value.article.version}</h3><p>冻结版本 {value.article.hash}</p>
            <div className="publishing-live-article" dangerouslySetInnerHTML={{__html:value.article.bodyHtml}} />
            <h4>最终图片</h4>{value.article.images.length ? <ul className="publishing-live-images">{value.article.images.map((image,index) => <li key={image.id}>{image.previewUrl || image.sourceUrl ? <img src={image.previewUrl ?? image.sourceUrl} alt={image.altText} /> : null}<span><strong>图片 {index+1}</strong><small>{image.altText || "未填写 Alt 文本"}</small><code>{image.id}</code></span></li>)}</ul> : <p className="publishing-live-empty">本冻结版本不含图片</p>}
            <h4>本次投稿媒体、资源 ID 与逐项报价</h4><ul className="publishing-live-media-list">{value.items.filter(item => !item.blockers.length).map(item => <li key={item.media.id}><span><strong>{item.media.name}</strong><span className="publishing-kind-chip">{item.media.kind === "self_media" ? "自媒体" : "软文媒体"}</span><small>资源 ID：{item.media.externalResourceId ?? item.media.id}</small><small>标题：{item.title}</small><small>{publicationQuantity(item) ?? "待确认"} 次发布{item.publication?.quantityMeaning === "repeat_same_article" ? " · 同稿同标题重复发布" : ""} · 单价 {formatPublishingMoney(item.media.priceTenThousandths)}</small></span><b>小计 {formatPublishingMoney(item.priceTenThousandths)}</b></li>)}</ul>
          </section>;})}
          <p className={"publishing-live-irrevocable" + (live ? "" : " is-preview")}><AlertTriangle size={17} />{live ? "提交可能立即创建供应商订单；最终公开发布后不保证能够撤回。" : "Preview 只生成 Mock 结果，不会创建供应商订单。"}</p>
        </div>
        </> : null}
        {!flow && !unknownIds.length ? <p className="publishing-dialog-security"><ShieldCheck size={16} />{live ? "浏览器不会接触供应商凭据，提交由服务端统一执行。" : "Preview 不会发起任何供应商网络请求。"}</p> : null}
      </PublishingConfirmDialog>
  </div>;
}

