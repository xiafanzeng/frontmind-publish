import type { PublisherGateway } from "./gateway";
import type { ReviewBatchProgress } from "./reviewBatch";
import type { PublisherSubmitInput } from "./types";
import { publisherSubmitIdempotencyKey } from "./queryState";

export type ReviewSession = {
  progress: ReviewBatchProgress;
  acceptedIds: Record<string, string>;
  estimatedBalance?: bigint;
};

// Keep receipts through in-app navigation within the same gateway. Task values
// persist IDs and exact outstanding requests; article HTML is never stored here.
export const reviewSessions = new WeakMap<PublisherGateway, Map<string, ReviewSession>>();

/** Clear only requests that the existing submission flow has conclusively
 * removed. Group-key changes must not resurrect an older copy of that request. */
export function clearResolvedReviewRequests(
  gateway: PublisherGateway, sessionPrefix: string, resolved: Record<string, string>,
  selections?: Record<string, unknown>,
): Record<string, string> {
  const updates: Record<string, string> = {};
  if (!Object.keys(resolved).length) return updates;
  for (const [key, session] of reviewSessions.get(gateway) ?? []) {
    if (!key.startsWith(sessionPrefix)) continue;
    for (const [id, requestKey] of Object.entries(resolved)) {
      if (session.progress.requests[id]?.idempotencyKey === requestKey) delete session.progress.requests[id];
    }
  }
  for (const [key, saved] of Object.entries(selections ?? {})) {
    if (!key.startsWith("publishingBatchReview:") || typeof saved !== "string") continue;
    try {
      const value = JSON.parse(saved) as { requests?: Record<string, PublisherSubmitInput> };
      let changed = false;
      for (const [id, requestKey] of Object.entries(resolved)) {
        if (value.requests?.[id]?.idempotencyKey === requestKey) {
          delete value.requests[id];
          changed = true;
        }
      }
      if (changed) updates[key] = JSON.stringify(value);
    } catch { /* Preserve unrelated or malformed presentation values. */ }
  }
  return updates;
}

export function mergeReviewSessionReceipts(target: ReviewSession, source: ReviewSession, draftIds: readonly string[]) {
  for (const id of draftIds) {
    const acceptedId = source.acceptedIds[id] ?? source.progress.accepted[id]?.id;
    if (acceptedId) {
      target.acceptedIds[id] = acceptedId;
      if (source.progress.accepted[id]) target.progress.accepted[id] = source.progress.accepted[id];
      delete target.progress.requests[id];
    } else if (!target.acceptedIds[id] && !target.progress.requests[id] && source.progress.requests[id]) {
      target.progress.requests[id] = source.progress.requests[id];
    }
  }
  return target;
}

function readProgress(saved: string, ids: readonly string[]): ReviewSession {
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
  } catch { /* Malformed presentation values cannot become submission requests. */ }
  return session;
}

/** A draft's outstanding request outlives a change to the URL's group/exclusions.
 * Only merge receipts in the same workspace/task scope; never generate a new request. */
export function restoreReviewSession(
  gateway: PublisherGateway,
  sessionPrefix: string,
  draftIds: readonly string[],
  savedProgress: string,
  selections?: Record<string, unknown>,
): ReviewSession {
  const restored = readProgress(savedProgress, draftIds);
  const sources = Object.entries(selections ?? {})
    .filter(([key, value]) => key.startsWith("publishingBatchReview:") && typeof value === "string")
    .map(([, value]) => readProgress(value as string, draftIds));
  for (const [key, session] of reviewSessions.get(gateway) ?? []) {
    if (key.startsWith(sessionPrefix)) sources.push(session);
  }
  for (const source of sources) {
    mergeReviewSessionReceipts(restored, source, draftIds);
  }
  return restored;
}

/** A stale title deep link must not modify an accepted or unresolved draft,
 * including when the host has no task-value persistence. */
export function hasProtectedReviewDraft(
  gateway: PublisherGateway, draftIds: readonly string[], sessionPrefix: string,
  savedProgress = "", selections?: Record<string, unknown>,
): boolean {
  const session = restoreReviewSession(gateway, sessionPrefix, draftIds, savedProgress, selections);
  return draftIds.some(id => Boolean(session.acceptedIds[id] || session.progress.requests[id]));
}
