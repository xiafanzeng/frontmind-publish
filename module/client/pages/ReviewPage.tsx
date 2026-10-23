import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Link, useLocation } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { PublisherGatewayError } from "../gateway";
import {
  MediaMark,
  PublishingConfirmDialog,
  PublishingError,
  PublishingLoading,
  PublishingPage,
  PublishingSteps,
} from "../components/PublishingUi";
import { publisherSubmitIdempotencyKey } from "../queryState";
import PublishingFlowSteps, { flowStagesForMode } from "../components/PublishingFlowSteps";
import { formatPublishingMoney } from "../types";
import {
  usePublishingFlow,
  usePublishingSummary,
  usePublishingOperationScope,
  publishingTaskUrl,
} from "../PublishingFlowContext";

const REFRESHABLE_CATALOG_BLOCKERS = new Set([
  "CATALOG_CHANGED",
  "PRICE_CHANGED",
  "MEDIA_KIND_CHANGED",
  "MEDIA_METADATA_CHANGED",
  "MEDIA_CAPABILITY_CHANGED",
  "TITLE_LIMIT_CHANGED",
]);

export default function PublishingReviewPage({
  draftId,
  onSubmitted,
  onRevise,
}: {
  draftId: string;
  onSubmitted?: (batchId: string) => void;
  onRevise?: () => void;
}) {
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const operationScope = usePublishingOperationScope(draftId);
  const [, navigate] = useLocation();
  const load = useCallback(
    (signal: AbortSignal) => gateway.preflightDraft(draftId, signal),
    [draftId, gateway],
  );
  const query = usePublisherQuery(load);
  const [acknowledged, setAcknowledged] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submitIntent = useRef<{ quoteFingerprint: string; key: string } | null>(
    null,
  );
  const submitLock = useRef(false);

  const submit = async () => {
    if (
      !query.data ||
      submitting ||
      submitLock.current ||
      !acknowledged ||
      query.data.blockers.length ||
      !query.data.items.some((item) => !item.blockers.length)
    )
      return;
    const isCurrent = operationScope();
    submitLock.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      let preflight = query.data;
      const passedIds = query.data.items
        .filter((item) => !item.blockers.length)
        .map((item) => item.media.id);
      if (passedIds.length < query.data.items.length) {
        // 部分发布：未通过组合先经真实目录接口移出草稿，再按最新预检快照提交。
        await gateway.updateDraftMedia(
          draftId,
          passedIds,
          query.data.draftRevision,
        );
        preflight = await gateway.preflightDraft(draftId);
        if (
          !isCurrent() ||
          preflight.blockers.length ||
          preflight.items.some((item) => item.blockers.length)
        ) {
          if (isCurrent()) query.reload();
          throw new Error(
            "移除未通过媒体后的预检快照仍有阻断项，请重新预检后再提交。",
          );
        }
      }
      if (submitIntent.current?.quoteFingerprint !== preflight.quoteFingerprint) {
        submitIntent.current = {
          quoteFingerprint: preflight.quoteFingerprint,
          key: publisherSubmitIdempotencyKey(draftId, preflight.quoteFingerprint),
        };
      }
      const request = {
        draftId,
        preflightRevision: preflight.revision,
        quoteFingerprint: preflight.quoteFingerprint,
        acknowledged,
        idempotencyKey: submitIntent.current.key,
      };
      let batch;
      try {
        batch = await gateway.submitDraft(request);
      } catch (reason) {
        if (!isCurrent()) return;
        if (
          !(reason instanceof PublisherGatewayError) ||
          reason.code !== "unavailable"
        ) {
          throw reason;
        }
        // An unavailable response may mean the POST committed but its response was lost.
        // One replay with the same key recovers that batch without a second reservation.
        batch = await gateway.submitDraft(request);
      }
      if (!isCurrent()) return;
      await flow
        ?.record({
          id: `submitted:${batch.id}`,
          label: "发布请求已受理",
          detail: `${batch.itemCount} 家媒体 · 批次结果由发布服务更新`,
          resources: [{ kind: "publication_batch", id: batch.id }],
          outputRefs: [
            {
              resource: {
                kind: "publication_batch",
                id: batch.id,
                label: "已受理发布批次",
              },
              sourceStepId: `submitted:${batch.id}`,
            },
          ],
        })
        .catch(() => undefined);
      if (isCurrent())
        onSubmitted
          ? onSubmitted(batch.id)
          : navigate(
              publishingTaskUrl(
                `/publishing/publications/${batch.id}?submitted=1`,
                flow?.taskId,
              ),
            );
    } catch (reason) {
      if (!isCurrent()) return;
      setSubmitError(
        reason instanceof Error ? reason.message : "发布请求未能提交",
      );
      setDialogOpen(false);
      setSubmitting(false);
      if (
        !(reason instanceof PublisherGatewayError) ||
        reason.code !== "unavailable"
      ) {
        setAcknowledged(false);
        query.reload();
      }
    } finally {
      submitLock.current = false;
    }
  };

  const acceptCatalogChanges = async () => {
    if (!query.data || refreshingCatalog) return;
    setRefreshingCatalog(true);
    setSubmitError("");
    try {
      await gateway.refreshDraftMedia(draftId, query.data.draftRevision);
      setAcknowledged(false);
      query.reload();
    } catch (reason) {
      setSubmitError(
        reason instanceof Error ? reason.message : "目录快照刷新失败",
      );
    } finally {
      setRefreshingCatalog(false);
    }
  };

  const blockingMessages = query.data
    ? [
        ...new Set([
          ...query.data.blockers,
          ...query.data.items.flatMap((item) =>
            item.blockers.map((message) => `${item.media.name}：${message}`),
          ),
        ]),
      ]
    : [];
  const blocked = blockingMessages.length > 0;
  usePublishingSummary({
    title: "费用与发布状态",
    items: [
      { label: "稿件", value: query.data?.article.title ?? "正在预检" },
      { label: "媒体", value: `${query.data?.items.length ?? 0} 家` },
      {
        label: "待预占费用",
        value: query.data
          ? formatPublishingMoney(query.data.totalTenThousandths)
          : "—",
      },
      {
        label: "预检结果",
        value: blocked
          ? `${blockingMessages.length} 项待处理`
          : query.data
            ? "等待确认发布"
            : "读取中",
      },
    ],
    note: submitError || undefined,
  });
  const live = query.data?.mode === "live";
  const canRefreshCatalog = Boolean(
    [
      ...(query.data?.blockerCodes ?? []),
      ...(query.data?.items.flatMap((item) => item.blockerCodes ?? []) ?? []),
    ].some((code) => REFRESHABLE_CATALOG_BLOCKERS.has(code)),
  );
  const kindSubtotals = query.data
    ? {
        news: {
          count:
            query.data.kindCounts?.news ??
            query.data.items.filter((item) => item.media.kind === "news")
              .length,
          amount: query.data.items
            .filter((item) => item.media.kind === "news")
            .reduce(
              (total, item) => total + BigInt(item.priceTenThousandths),
              0n,
            )
            .toString(),
        },
        selfMedia: {
          count:
            query.data.kindCounts?.selfMedia ??
            query.data.items.filter((item) => item.media.kind === "self_media")
              .length,
          amount: query.data.items
            .filter((item) => item.media.kind === "self_media")
            .reduce(
              (total, item) => total + BigInt(item.priceTenThousandths),
              0n,
            )
            .toString(),
        },
      }
    : undefined;

  const passedItems =
    query.data?.items.filter((item) => !item.blockers.length) ?? [];
  const failedItems =
    query.data?.items.filter((item) => item.blockers.length) ?? [];
  const pendingReview = query.data?.items.length === undefined;
  const publishTotal = passedItems.reduce(
    (total, item) => total + BigInt(item.priceTenThousandths),
    0n,
  );
  const excludedTotal = failedItems.reduce(
    (total, item) => total + BigInt(item.priceTenThousandths),
    0n,
  );
  const globalBlocked = Boolean(query.data?.blockers.length);
  // 部分发布：只要存在通过组合且全局门禁通过即可提交；未通过组合先从草稿移除。
  const partialPublish = failedItems.length > 0 && passedItems.length > 0;
  const canPublish =
    Boolean(query.data) && !globalBlocked && passedItems.length > 0;

  return (
    <PublishingPage
      title="发布预检与确认"
      description="确认冻结版本、逐家媒体标题、单价与发布风险。"
      busy={query.loading || query.refreshing || submitting}
    >
      {!flow && (
        <PublishingFlowSteps
          stages={flowStagesForMode(query.data?.titleMode ?? "per_media")}
          doneCount={3}
          activeIndex={3}
        />
      )}
      {query.loading ? (
        <PublishingLoading label="正在刷新价格与发布门禁…" />
      ) : null}
      {query.error ? (
        <PublishingError error={query.error} onRetry={query.reload} />
      ) : null}
      {query.data ? (
        <div className="publishing-review-layout">

          <section
            className="publishing-panel publishing-review-fees"
            aria-label="费用与预算核验"
          >
            <header className="publishing-review-fees-head">
              <h2>费用与预算核验</h2>
              <p className="publishing-review-counts" role="status">
                通过 <strong>{passedItems.length}</strong> · 不通过{" "}
                <strong>{failedItems.length}</strong>
                {pendingReview ? null : (
                  <>
                    {" "}
                    · 本次可发布 <strong>{passedItems.length}</strong> 家
                  </>
                )}
                {partialPublish ? (
                  <span className="publishing-review-partial">
                    部分发布：{failedItems.length} 项未通过组合将被移出本次发布
                  </span>
                ) : null}
              </p>
            </header>
            <dl className="publishing-money-summary">
              <div>
                <dt>软文 / 自媒体</dt>
                <dd>
                  {query.data.kindCounts?.news ??
                    query.data.items.filter(
                      (item) => item.media.kind === "news",
                    ).length}{" "}
                  /{" "}
                  {query.data.kindCounts?.selfMedia ??
                    query.data.items.filter(
                      (item) => item.media.kind === "self_media",
                    ).length}
                </dd>
              </div>
              <div>
                <dt>软文媒体小计</dt>
                <dd>
                  {kindSubtotals?.news.count ?? 0} 家 ·{" "}
                  {formatPublishingMoney(kindSubtotals?.news.amount ?? "0")}
                </dd>
              </div>
              <div>
                <dt>自媒体小计</dt>
                <dd>
                  {kindSubtotals?.selfMedia.count ?? 0} 家 ·{" "}
                  {formatPublishingMoney(
                    kindSubtotals?.selfMedia.amount ?? "0",
                  )}
                </dd>
              </div>
              <div>
                <dt>本次可发布组合费用</dt>
                <dd className="is-total">
                  {formatPublishingMoney(publishTotal.toString())}
                </dd>
              </div>
              {partialPublish ? (
                <div className="publishing-money-excluded">
                  <dt>未纳入本次发布</dt>
                  <dd>
                    {failedItems.length} 项 ·{" "}
                    {formatPublishingMoney(excludedTotal.toString())}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>可用余额</dt>
                <dd>
                  {formatPublishingMoney(
                    query.data.wallet.availableTenThousandths,
                  )}
                </dd>
              </div>
              <div>
                <dt>提交后预占</dt>
                <dd>
                  {formatPublishingMoney(
                    partialPublish
                      ? publishTotal.toString()
                      : query.data.totalTenThousandths,
                  )}
                </dd>
              </div>
              <div className="publishing-money-after">
                <dt>预占后可用</dt>
                <dd>
                  {formatPublishingMoney(
                    partialPublish
                      ? (
                          BigInt(query.data.wallet.availableTenThousandths) -
                          publishTotal
                        ).toString()
                      : query.data.availableAfterTenThousandths,
                  )}
                </dd>
              </div>
            </dl>
            <section className="publishing-gate-list">
              <h3>发布门禁检查</h3>
              {query.data.gates.map((gate) => (
                <p
                  key={gate.label}
                  className={gate.passed ? "is-passed" : "is-blocked"}
                >
                  {gate.passed ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <AlertTriangle size={16} />
                  )}
                  {gate.label}
                </p>
              ))}
            </section>
            <label className="publishing-acknowledgement">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                {live
                  ? `我已确认向 {passedItems.length} 家媒体真实投稿。成功后扣款；明确拒稿或失败自动退回；状态未知时金额继续冻结等待对账。`
                  : `我已确认以 Preview 模拟方式提交 {passedItems.length} 家媒体。本次只生成确定性 Mock 批次，不会联系供应商或产生真实费用。`}
              </span>
            </label>
            {submitError ? (
              <p className="publishing-form-error" role="alert">
                {submitError}
              </p>
            ) : null}
          </section>
          <div className="publishing-review-main">
            <section className="publishing-panel publishing-frozen-article">
              <span className="publishing-file-icon">
                <FileCheck2 size={22} />
              </span>
              <div>
                <strong>{query.data.article.title}</strong>
                <span>
                  {query.data.article.wordCount.toLocaleString("zh-CN")} 字 ·{" "}
                  {query.data.article.imageCount} 张图片
                </span>
              </div>
              <span className="publishing-version-pill">
                版本 <b>v{query.data.article.version}</b>
              </span>
              <code>{query.data.article.hash.slice(0, 12)}</code>
              <button
                className="publishing-button publishing-button-secondary"
                type="button"
                aria-controls="publishing-frozen-article-preview"
                aria-expanded={previewExpanded}
                onClick={() => setPreviewExpanded((value) => !value)}
              >
                <ExternalLink size={15} />
                {previewExpanded ? "收起冻结正文" : "查看冻结正文"}
              </button>
            </section>

            {previewExpanded ? (
              <section
                id="publishing-frozen-article-preview"
                className="publishing-panel publishing-frozen-preview"
                aria-label="冻结正文预览"
              >
                <header>
                  <div>
                    <h2>{query.data.article.title}</h2>
                    <p>
                      不可变版本 v{query.data.article.version} ·{" "}
                      {query.data.article.hash}
                    </p>
                  </div>
                  <span>{query.data.article.imageCount} 张冻结图片</span>
                </header>
                <div
                  className="publishing-frozen-preview-body"
                  dangerouslySetInnerHTML={{
                    __html: query.data.article.bodyHtml,
                  }}
                />
              </section>
            ) : null}

            <section
              className="publishing-panel publishing-review-table"
              aria-label="逐项发布预检"
            >
              <div className="publishing-review-head publishing-review-row">
                <span>媒体</span>
                <span>
                  {query.data.titleMode === "single" ? "统一标题" : "独立标题"}
                </span>
                <span>冻结单价</span>
                <span>内容检查</span>
                <span>状态</span>
              </div>
              {query.data.items.map((item) => (
                <div className="publishing-review-row" key={item.media.id}>
                  <span className="publishing-media-name">
                    <MediaMark
                      name={item.media.shortName}
                      id={item.media.id}
                      logoUrl={item.media.logoUrl}
                      logoSource={item.media.logoSource}
                      logoResolutionStatus={item.media.logoResolutionStatus}
                    />
                    <span>
                      <strong>{item.media.name}</strong>
                      <small>FrontMind 媒体号：{item.media.id}</small>
                      <span className="publishing-kind-chip">
                        {item.media.kind === "self_media"
                          ? "自媒体"
                          : "软文媒体"}
                      </span>
                    </span>
                  </span>
                  <span data-label="独立标题">{item.title}</span>
                  <strong data-label="冻结单价">
                    {formatPublishingMoney(item.priceTenThousandths)}
                  </strong>
                  <span data-label="内容检查">
                    {item.media.capability === "text"
                      ? "仅纯文字"
                      : item.media.capability === "image"
                        ? "支持图片"
                        : "图片待验证"}
                  </span>
                  <span>
                    {item.blockers.length ? (
                      <>
                        <span className="publishing-status is-danger">
                          未通过
                        </span>
                        <Link
                          className="publishing-row-fix"
                          href={`/publishing/articles/${query.data?.article.id}/edit?draftId=${draftId}&mode=${query.data?.titleMode}&from=review`}
                        >
                          返回修改
                        </Link>
                      </>
                    ) : (
                      <span className="publishing-status is-success">
                        <CheckCircle2 size={14} />
                        通过
                      </span>
                    )}
                  </span>
                  {item.warnings.length ? (
                    <p className="publishing-row-warning">
                      <AlertTriangle size={15} />
                      {item.warnings.join("；")}
                    </p>
                  ) : null}
                </div>
              ))}
            </section>

            {query.data.warnings.length ? (
              <div className="publishing-notice is-warning">
                <AlertTriangle size={21} />
                <div>
                  <strong>有 {query.data.warnings.length} 项内容提示</strong>
                  <p>{[...new Set(query.data.warnings)].join("；")}</p>
                </div>
              </div>
            ) : null}
            {blockingMessages.length ? (
              <div className="publishing-notice is-danger" role="alert">
                <AlertTriangle size={21} />
                <div>
                  <strong>当前不能发布</strong>
                  <p>{blockingMessages.join("；")}</p>
                  {canRefreshCatalog ? (
                    <button
                      className="publishing-button publishing-button-secondary"
                      type="button"
                      disabled={refreshingCatalog}
                      onClick={acceptCatalogChanges}
                    >
                      {refreshingCatalog
                        ? "正在刷新目录快照…"
                        : "接受当前目录并重新预检"}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>


          <footer className="publishing-workflow-footer">
            {onRevise ? (
              <button
                type="button"
                className="publishing-button publishing-button-secondary"
                onClick={onRevise}
              >
                <ArrowLeft size={16} />
                返回修改标题
              </button>
            ) : (
              <Link
                className="publishing-button publishing-button-secondary"
                href={`/publishing/drafts/${draftId}/titles`}
              >
                <ArrowLeft size={16} />
                返回修改
              </Link>
            )}
            <div className="publishing-confirm-actions">
              <button
                type="button"
                className="publishing-button publishing-button-secondary"
                disabled={query.refreshing || submitting}
                onClick={() => {
                  setAcknowledged(false);
                  query.reload();
                }}
              >
                {query.refreshing ? "正在预检…" : "一键预检"}
              </button>
              <button
                className="publishing-button publishing-button-accent"
                type="button"
                disabled={!acknowledged || !canPublish || submitting}
                onClick={() => setDialogOpen(true)}
              >
                {(submitting ? "正在提交…" : live ? "确认发布" : "模拟发布") +
                  ` ${passedItems.length} 家媒体`}
              </button>
            </div>
          </footer>

        </div>
      ) : null}

      {query.data ? (
        <PublishingConfirmDialog
          inline={Boolean(flow)}
          open={dialogOpen}
          title={live ? "这是一次真实投稿" : "确认 Preview 模拟发布"}
          description={
            live
              ? `提交后系统将按预检快照预占媒体发布余额。供应商可能立即接单，已创建的外部订单不保证可以撤回。${partialPublish ? `本次仅提交通过预检的 ${passedItems.length} 家；${failedItems.length} 项未通过组合将被移出发布草稿。` : ""}`
              : "提交后只会按当前预检快照生成确定性 Mock 批次，不会请求 KOL 或其他外部服务。"
          }
          confirmLabel={`${live ? "提交并预占" : "确认模拟发布"} ${formatPublishingMoney(publishTotal.toString())}`}
          busy={submitting}
          wide
          onCancel={() => setDialogOpen(false)}
          onConfirm={submit}
        >
          <div className="publishing-dialog-facts">
            <p>
              <span>冻结版本</span>
              <strong>
                v{query.data.article.version} ·{" "}
                {query.data.article.hash.slice(0, 12)}
              </strong>
            </p>
            <p>
              <span>投稿媒体</span>
              <strong>
                {passedItems.length} 家
                {partialPublish
                  ? `（未通过 ${failedItems.length} 项不提交）`
                  : ""}
              </strong>
            </p>
            <p>
              <span>运行模式</span>
              <strong>
                {query.data.mode === "live"
                  ? "真实发布"
                  : query.data.mode.toUpperCase()}
              </strong>
            </p>
          </div>
          <div className="publishing-live-confirmation">
            <section>
              <h3>最终冻结正文</h3>
              <div
                className="publishing-live-article"
                dangerouslySetInnerHTML={{
                  __html: query.data.article.bodyHtml,
                }}
              />
            </section>
            <section>
              <h3>最终图片</h3>
              {query.data.article.images.length ? (
                <ul className="publishing-live-images">
                  {query.data.article.images.map((image, index) => (
                    <li key={image.id}>
                      {image.previewUrl || image.sourceUrl ? (
                        <img
                          src={image.previewUrl ?? image.sourceUrl}
                          alt={image.altText}
                        />
                      ) : null}
                      <span>
                        <strong>图片 {index + 1}</strong>
                        <small>{image.altText || "未填写 Alt 文本"}</small>
                        <code>{image.id}</code>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="publishing-live-empty">本冻结版本不含图片</p>
              )}
            </section>
            <section>
              <h3>媒体、资源 ID 与逐项报价</h3>
              <ul className="publishing-live-media-list">
                {query.data.items.map((item) => (
                  <li key={item.media.id}>
                    <span>
                      <strong>{item.media.name}</strong>
                      <span className="publishing-kind-chip">
                        {item.media.kind === "self_media"
                          ? "自媒体"
                          : "软文媒体"}
                      </span>
                      <small>
                        资源 ID：
                        {item.media.externalResourceId ?? item.media.id}
                      </small>
                      <small>标题：{item.title}</small>
                    </span>
                    <b>{formatPublishingMoney(item.priceTenThousandths)}</b>
                  </li>
                ))}
              </ul>
            </section>
            {live ? (
              <p className="publishing-live-irrevocable">
                <AlertTriangle size={17} />
                提交可能立即创建供应商订单；最终公开发布后不保证能够撤回。
              </p>
            ) : (
              <p className="publishing-live-irrevocable is-preview">
                <CheckCircle2 size={17} />
                Preview 只生成本地 Mock 结果，不会创建供应商订单。
              </p>
            )}
          </div>
          {!flow && (
            <p className="publishing-dialog-security">
              <ShieldCheck size={16} />
              {live
                ? "浏览器不会接触供应商凭据，提交由服务端统一执行。"
                : "Preview 不会发起任何供应商网络请求。"}
            </p>
          )}
        </PublishingConfirmDialog>
      ) : null}
    </PublishingPage>
  );
}
