import type { PublisherGateway } from "./gateway";
import type { PublicationDraft, PublisherTitleMode } from "./types";
import { saveUpstreamDraftTitles } from "./titleFlow";

export function uniqueBatchIds(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function batchArticleVersions(primary: string | undefined, search: string, fallback: unknown = []) {
  const params = new URLSearchParams(search);
  const explicit = params.getAll("batchArticleVersion");
  const saved = Array.isArray(fallback) ? fallback.filter((id): id is string => typeof id === "string") : [];
  return uniqueBatchIds([...(primary ? [primary] : []), ...(explicit.length ? explicit : saved)]);
}

export function withBatchArticleVersions(path: string, versionIds: readonly string[]) {
  const [pathname, query] = path.split("?");
  const params = new URLSearchParams(query);
  const ids = uniqueBatchIds(versionIds);
  params.set("mode", "batch");
  params.delete("batchArticleVersion");
  if (ids[0]) params.set("articleVersion", ids[0]);
  for (const id of ids) params.append("batchArticleVersion", id);
  return `${pathname}?${params.toString()}`;
}

export type BatchDraftCreation = {
  versionId: string;
  initialMediaIds: string[];
  requestKey: string;
  draftId?: string;
  sourceDraftId?: string;
  mappedMediaIds?: string[];
  initialTitleMode?: PublisherTitleMode;
};

export function readBatchDraftJournal(value: unknown): BatchDraftCreation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is BatchDraftCreation => Boolean(entry &&
    typeof entry.versionId === "string" && typeof entry.requestKey === "string" &&
    (!entry.draftId || typeof entry.draftId === "string") &&
    (!entry.sourceDraftId || typeof entry.sourceDraftId === "string") &&
    (!entry.mappedMediaIds || Array.isArray(entry.mappedMediaIds) && entry.mappedMediaIds.every((id: unknown) => typeof id === "string")) &&
    (!entry.initialTitleMode || entry.initialTitleMode === "single" || entry.initialTitleMode === "per_media") &&
    Array.isArray(entry.initialMediaIds) && entry.initialMediaIds.every((id: unknown) => typeof id === "string")));
}

/** The server owns one draft per article. Retain the exact first create payload
 * until its receipt is recovered, even if selection changes after a lost reply.
 * Existing article-specific mappings are changed only by explicit shared deltas. */
export async function prepareBatchMediaDrafts(input: {
  gateway: Pick<PublisherGateway, "createDraft" | "getDraft" | "updateDraftMedia" | "saveDraftTitles">;
  versionIds: readonly string[];
  articleIdsByVersion?: Readonly<Record<string, string>>;
  confirmedTitlesByVersion?: Readonly<Record<string, string>>;
  /** The editor's existing contract for a new draft, never inferred from count. */
  newDraftTitleMode?: PublisherTitleMode;
  excludedArticleIds?: readonly string[];
  existingDrafts: readonly PublicationDraft[];
  selectedMediaIds: readonly string[];
  originalMediaIds: readonly string[];
  journal: BatchDraftCreation[];
  requestKey: (versionId: string, mediaIds: string[]) => Promise<string>;
  persistJournal: (journal: BatchDraftCreation[]) => Promise<void>;
  onSaved: (draft: PublicationDraft) => Promise<void>;
  isCurrent?: () => boolean;
}) {
  const selected = uniqueBatchIds(input.selectedMediaIds);
  const original = new Set(input.originalMediaIds);
  const added = selected.filter(id => !original.has(id));
  const result: PublicationDraft[] = [];
  const assertCurrent = () => {
    if (input.isCurrent && !input.isCurrent()) throw new Error("选媒任务已切换，请返回原任务继续。");
  };
  for (const versionId of uniqueBatchIds(input.versionIds)) {
    assertCurrent();
    let receipt = input.journal.find(entry => entry.versionId === versionId);
    let draft = input.existingDrafts.find(item => item.articleVersionId === versionId);
    const articleId = input.articleIdsByVersion?.[versionId] ?? draft?.articleId;
    const excluded = Boolean(articleId && input.excludedArticleIds?.includes(articleId));
    const previous = input.existingDrafts.find(item => item.articleId === articleId && item.articleVersionId !== versionId);
    const sourceDraftId = receipt?.sourceDraftId ?? (!draft ? previous?.id : undefined);
    const sourceDraft = sourceDraftId ? await input.gateway.getDraft(sourceDraftId) : undefined;
    assertCurrent();
    if (sourceDraft && sourceDraft.articleId !== articleId) throw new Error("原媒体分配与修改后的稿件不一致，请重新读取。");
    if (receipt?.draftId || draft) {
      draft = await input.gateway.getDraft(receipt?.draftId ?? draft!.id);
      assertCurrent();
      if (draft.articleVersionId !== versionId) throw new Error("批量草稿与冻结稿件不一致，请重新读取。");
    } else {
      if (!receipt) {
        const mappedMediaIds = sourceDraft?.items.map(item => item.media.id);
        const initialMediaIds = excluded ? mappedMediaIds ?? [] : mappedMediaIds ? uniqueBatchIds([...mappedMediaIds.filter(id => selected.includes(id)), ...added]) : selected;
        const initialTitleMode = sourceDraft?.titleMode ?? input.newDraftTitleMode;
        if (!initialTitleMode) throw new Error("新稿件的标题模式无法恢复，请返回稿件页面重新确认。");
        receipt = { versionId, initialMediaIds, initialTitleMode, requestKey: await input.requestKey(versionId, initialMediaIds),
          ...(sourceDraft ? { sourceDraftId: sourceDraft.id, mappedMediaIds } : {}) };
        assertCurrent();
        input.journal.push(receipt);
      }
      // Retry persistence too: an earlier failure can leave an in-memory entry
      // whose key has never reached durable task or browser storage.
      await input.persistJournal(input.journal);
      assertCurrent();
      // Old journals without mode were created by the previous per-media batch
      // contract. Recover that exact request before applying any newer choice.
      draft = await input.gateway.createDraft(versionId, receipt.initialMediaIds, receipt.requestKey, receipt.initialTitleMode ?? "per_media");
      assertCurrent();
      receipt.draftId = draft.id;
      await input.persistJournal(input.journal);
    }
    // A receipt denotes this batch's shared-selection drafts; externally bound
    // drafts can carry different media and must not be flattened to their union.
    const mapping = receipt?.mappedMediaIds ?? (!receipt ? draft.items.map(item => item.media.id) : undefined);
    // Exclusion is a route/editor selection, not deletion of the saved rows.
    // Keep the snapshot so Titles can restore its media and titles on re-check.
    const wanted = excluded ? mapping ?? sourceDraft?.items.map(item => item.media.id) ?? draft.items.map(item => item.media.id)
      : mapping ? uniqueBatchIds([...mapping.filter(id => selected.includes(id)), ...added]) : selected;
    if (draft.items.length !== wanted.length || draft.items.some(item => !wanted.includes(item.media.id))) {
      draft = await input.gateway.updateDraftMedia(draft.id, wanted, draft.revision);
      assertCurrent();
    }
    if (sourceDraft && draft.items.length) {
      const titles = Object.fromEntries(draft.items.map(item => [item.media.id,
        sourceDraft.items.find(previous => previous.media.id === item.media.id)?.title ?? item.title]));
      const mode = sourceDraft.titleMode;
      const sharedTitle = mode === "single" ? input.confirmedTitlesByVersion?.[versionId] ?? sourceDraft.sharedTitle : undefined;
      if (mode === "single" && !sharedTitle?.trim()) throw new Error("正式共享标题无法恢复，请返回对应稿件重新确认。");
      if (mode === "single") for (const mediaId of Object.keys(titles)) titles[mediaId] = sharedTitle!;
      if (draft.titleMode !== mode || mode === "single" && draft.sharedTitle !== sharedTitle || draft.items.some(item => item.title !== titles[item.media.id])) {
        draft = await input.gateway.saveDraftTitles(draft.id, { mode, ...(sharedTitle !== undefined ? { sharedTitle } : {}), titles, expectedRevision: draft.revision });
        assertCurrent();
      }
    }
    if (!excluded) draft = await saveUpstreamDraftTitles(input.gateway, draft);
    assertCurrent();
    await input.onSaved(draft);
    assertCurrent();
    result.push(draft);
  }
  return result;
}
