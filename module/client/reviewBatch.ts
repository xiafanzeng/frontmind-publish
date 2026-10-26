import { publicationIdentity } from "./publicationAmounts";
import { PublisherGatewayError, type PublisherGateway } from "./gateway";
import { publisherSubmitIdempotencyKey } from "./queryState";
import type { PublicationBatch, PublicationPreflight, PublisherSubmitInput } from "./types";

export type ReviewBatchProgress = {
  accepted: Record<string, PublicationBatch>;
  /** Keep the exact issued request until the server definitively resolves it. */
  requests: Record<string, PublisherSubmitInput>;
};
export type ReviewBatchGroup = { draftId: string; preflight?: PublicationPreflight };

export function reviewBatchNeedsAttention(batch: PublicationBatch) {
  return Boolean(batch.status === "action_required" || batch.unknownCount || batch.items.some(item => item.status === "submission_unknown" || item.status === "action_required" || item.status === "auth_blocked"));
}

export function reviewBatchTotals(preflights: PublicationPreflight[]) {
  const items = preflights.flatMap(value => value.items);
  const passed = items.filter(item => !item.blockers.length);
  const failed = items.filter(item => item.blockers.length);
  const sum = (values: typeof items) => values.reduce((total, item) => total + BigInt(item.priceTenThousandths), 0n);
  const kind = (name: string) => {
    const matching = items.filter(item => item.media.kind === name);
    return { count: matching.length, amount: sum(matching) };
  };
  // Each preflight reports the same account wallet, never a per-manuscript wallet.
  // Use the conservative observation when independent snapshots differ.
  const available = preflights.reduce<bigint | undefined>((balance, value) => {
    const next = BigInt(value.wallet.availableTenThousandths);
    return balance === undefined || next < balance ? next : balance;
  }, undefined);
  return { passedCount: passed.length, failedCount: failed.length, publishTotal: sum(passed), excludedTotal: sum(failed), news: kind("news"), selfMedia: kind("self_media"), available };
}

function sameApprovedItems(approved: PublicationPreflight, fresh: PublicationPreflight, passedOnly: boolean) {
  const items = approved.items.filter(item => !passedOnly || !item.blockers.length);
  return fresh.mode === approved.mode && fresh.article.versionId === approved.article.versionId &&
    fresh.article.hash === approved.article.hash && fresh.titleMode === approved.titleMode &&
    fresh.catalogRevision === approved.catalogRevision && fresh.items.length === items.length &&
    items.every(item => fresh.items.some(next => next.media.id === item.media.id && next.title === item.title &&
      next.priceTenThousandths === item.priceTenThousandths && next.media.kind === item.media.kind &&
      publicationIdentity(next) === publicationIdentity(item)));
}

function definitiveFailure(reason: unknown) {
  return reason instanceof PublisherGatewayError && reason.code !== "unavailable";
}

/** Existing single-draft contracts only. A failure stops the remaining manuscripts. */
export async function submitReviewBatch({ gateway, groups, progress, isCurrent = () => true, onProgress, onPreflight, onAccepted }: {
  gateway: Pick<PublisherGateway, "preflightDraft" | "updateDraftMedia" | "submitDraft">;
  groups: ReviewBatchGroup[];
  progress: ReviewBatchProgress;
  isCurrent?: () => boolean;
  onProgress?: () => Promise<void>;
  onPreflight?: (draftId: string, preflight: PublicationPreflight) => void;
  onAccepted?: (draftId: string, batch: PublicationBatch) => Promise<void>;
}) {
  if (Object.values(progress.accepted).some(reviewBatchNeedsAttention)) {
    throw new Error("已受理批次仍有待核实结果，请先刷新并查看该批次，再继续后续稿件。");
  }
  for (const group of groups) {
    if (!isCurrent()) return;
    if (progress.accepted[group.draftId]) continue;
    let request = progress.requests[group.draftId];
    if (!request) {
      const approved = group.preflight;
      if (!approved || !approved.items.some(item => !item.blockers.length)) continue;
      let fresh = await gateway.preflightDraft(group.draftId);
      if (!isCurrent()) return;
      onPreflight?.(group.draftId, fresh);
      if (approved.blockers.length || fresh.blockers.length || fresh.draftRevision !== approved.draftRevision ||
        fresh.quoteFingerprint !== approved.quoteFingerprint || !sameApprovedItems(approved, fresh, false)) {
        throw new Error(`「${approved.article.title}」的预检或报价已变化，请重新预检并确认。`);
      }
      const approvedIds = approved.items.filter(item => !item.blockers.length).map(item => item.media.id);
      if (fresh.items.some(item => approvedIds.includes(item.media.id) && item.blockers.length)) {
        throw new Error(`「${approved.article.title}」有新的内容阻断，请重新预检。`);
      }
      if (approvedIds.length < approved.items.length) {
        const narrowed = await gateway.updateDraftMedia(group.draftId, approvedIds, fresh.draftRevision);
        if (!isCurrent()) return;
        fresh = await gateway.preflightDraft(group.draftId);
        if (!isCurrent()) return;
        onPreflight?.(group.draftId, fresh);
        if (fresh.draftRevision !== narrowed.revision || fresh.blockers.length || fresh.items.some(item => item.blockers.length) || !sameApprovedItems(approved, fresh, true)) {
          throw new Error(`「${approved.article.title}」移除未通过媒体后的预检已变化，请重新确认。`);
        }
      }
      const remaining = reviewBatchTotals(groups.filter(value => !progress.accepted[value.draftId]).flatMap(value => value.preflight ? [value.preflight] : []));
      if (BigInt(fresh.wallet.availableTenThousandths) < remaining.publishTotal) {
        throw new Error("当前可用余额不足以覆盖剩余稿件，请更新预检或调整媒体。");
      }
      request = { draftId: group.draftId, preflightRevision: fresh.revision, quoteFingerprint: fresh.quoteFingerprint,
        acknowledged: true, idempotencyKey: publisherSubmitIdempotencyKey(group.draftId, fresh.quoteFingerprint) };
      progress.requests[group.draftId] = request;
    }
    // Persist before both first dispatch and replay, including after a save failure.
    await onProgress?.();
    if (!isCurrent()) return;
    let batch: PublicationBatch;
    try {
      try { batch = await gateway.submitDraft(request); }
      catch (reason) {
        if (!isCurrent()) return;
        if (!(reason instanceof PublisherGatewayError) || reason.code !== "unavailable") throw reason;
        // A committed response may have been lost. Replay once, never mint a new key.
        batch = await gateway.submitDraft(request);
      }
    } catch (reason) {
      if (definitiveFailure(reason)) delete progress.requests[group.draftId];
      await onProgress?.();
      throw reason;
    }
    progress.accepted[group.draftId] = batch;
    delete progress.requests[group.draftId];
    await onProgress?.();
    if (!isCurrent()) return;
    await onAccepted?.(group.draftId, batch);
    if (reviewBatchNeedsAttention(batch)) {
      throw new Error(`「${batch.articleTitle}」已创建批次，但有待核实结果；后续稿件尚未提交，请查看该批次。`);
    }
    if (batch.failedCount || batch.status === "failed" || batch.status === "partial_success") {
      throw new Error(`「${batch.articleTitle}」已创建批次，但包含发布失败项；后续稿件尚未提交，请先查看该批次。`);
    }
  }
}
