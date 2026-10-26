import type { PublisherGateway } from "./gateway";
import type { PublicationDraft, PublisherTitleMode } from "./types";

/** Every valid saved title mode enters the same title/check/confirmation page. */
export function publishingTitleStage(
  drafts: readonly { titleMode?: PublisherTitleMode }[],
): "titles" | undefined {
  if (!drafts.length || drafts.some(draft => draft.titleMode !== "single" && draft.titleMode !== "per_media")) return undefined;
  return "titles";
}

/** Save the upstream decision before entering title configuration.
 * articleTitle is a display label and may fall back to a file name; it must not
 * silently replace a missing confirmed shared title on an old draft. */
export async function saveUpstreamDraftTitles(
  gateway: Pick<PublisherGateway, "saveDraftTitles">,
  draft: PublicationDraft,
  requestedMode: PublisherTitleMode = draft.titleMode,
  sharedTitle?: string,
): Promise<PublicationDraft> {
  if (requestedMode !== "single" && requestedMode !== "per_media")
    throw new Error("标题模式无法恢复，请返回稿件页面重新确认。");
  const title = requestedMode === "single" ? sharedTitle ?? draft.sharedTitle : undefined;
  if (requestedMode === "single" && !title?.trim())
    throw new Error("正式共享标题无法恢复，请返回稿件页面确认标题与冻结版本。");
  const titles = Object.fromEntries(draft.items.map(item => [item.media.id, requestedMode === "single" ? title! : item.title]));
  if (draft.titleMode === requestedMode && (requestedMode !== "single" || draft.sharedTitle === title && draft.items.every(item => item.title === title))) return draft;
  return gateway.saveDraftTitles(draft.id, {
    mode: requestedMode,
    ...(title !== undefined ? { sharedTitle: title } : {}),
    titles,
    expectedRevision: draft.revision,
  });
}
