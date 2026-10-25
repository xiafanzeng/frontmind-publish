import type { PublicationDraft, PublicationPreflight } from "./types";

/** A result belongs to the exact selected draft and its immutable article.
 * Never share a result by media ID, or mutate the server's approval snapshot. */
export function reviewDraftContext(draft: PublicationDraft): string {
  return JSON.stringify([draft.id, draft.revision, draft.articleId, draft.articleVersionId,
    draft.articleVersionHash, draft.titleMode, draft.sharedTitle,
    draft.items.map(item => [item.media.id, item.title, item.media.catalogRevision,
      item.media.priceTenThousandths, item.media.kind, item.media.titleLimit, item.media.capability])]);
}

export function preflightMatchesReviewDraft(draft: PublicationDraft, result: PublicationPreflight): boolean {
  return result.draftRevision === draft.revision && result.article.id === draft.articleId &&
    result.article.versionId === draft.articleVersionId && result.article.hash === draft.articleVersionHash &&
    (result.titleMode === undefined || result.titleMode === draft.titleMode) &&
    result.items.length === draft.items.length &&
    draft.items.every(item => result.items.some(next => next.media.id === item.media.id && next.title === item.title));
}

export type ManualReviewCheck = {
  context: string;
  phase: "checking" | "complete" | "failed";
  preflight?: PublicationPreflight;
  error?: Error;
};
