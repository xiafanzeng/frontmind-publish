import type { PublicationDraft, PublicationDraftItem, PublisherTitleMode } from "./types";

/** Each draft owns its complete media snapshot, including rows excluded at review. */
export type TitleEditor = {
  draft: PublicationDraft;
  items: PublicationDraftItem[];
  mode: PublisherTitleMode;
  sharedTitle: string;
  titles: Record<string, string>;
  checked: string[];
  onlyErrors: boolean;
  savedSignature: string;
  pendingMedia?: { expectedRevision: number; mediaIds: string[] };
};

export function titleEditorSignature(editor: TitleEditor) {
  return JSON.stringify([
    editor.mode,
    editor.sharedTitle,
    editor.items.map(({ media }) => [media.id, editor.titles[media.id] ?? ""]),
    [...editor.checked].sort(),
  ]);
}

export function createTitleEditor(draft: PublicationDraft): TitleEditor {
  const editor: TitleEditor = {
    draft,
    items: draft.items,
    mode: draft.titleMode,
    sharedTitle: draft.sharedTitle ?? draft.articleTitle,
    titles: Object.fromEntries(draft.items.map(item => [item.media.id, item.title])),
    checked: draft.items.map(item => item.media.id),
    onlyErrors: false,
    savedSignature: "",
  };
  return { ...editor, savedSignature: titleEditorSignature(editor) };
}

export function sameDraftSelection(left: PublicationDraft, right: PublicationDraft) {
  const ids = new Set(left.items.map(item => item.media.id));
  return left.articleVersionId === right.articleVersionId &&
    left.revision === right.revision && ids.size === right.items.length &&
    right.items.every(item => ids.has(item.media.id));
}

/** Preserve local edits, but respect newly added/removed server membership.
 * An unrelated revision must never re-add a media removed in another session. */
export function reconcileTitleEditor(draft: PublicationDraft, previous?: TitleEditor): TitleEditor {
  if (!previous || previous.draft.id !== draft.id ||
      previous.draft.articleVersionId !== draft.articleVersionId) return createTitleEditor(draft);
  if (draft.revision < previous.draft.revision) return previous;
  // A response may be lost after our own media write commits. The exact next
  // revision and requested membership acknowledge it without losing unchecked rows.
  const pending = previous.pendingMedia;
  if (pending && draft.revision === pending.expectedRevision + 1 &&
      draft.items.length === pending.mediaIds.length &&
      draft.items.every(item => pending.mediaIds.includes(item.media.id))) {
    return acceptTitleEditorSave(previous, draft, false);
  }
  const fresh = new Map(draft.items.map(item => [item.media.id, item]));
  const oldServer = new Map(previous.draft.items.map(item => [item.media.id, item]));
  const oldIds = new Set(previous.items.map(item => item.media.id));
  const items = [
    ...previous.items.filter(item => fresh.has(item.media.id) || !oldServer.has(item.media.id))
      .map(item => fresh.get(item.media.id) ?? item),
    ...draft.items.filter(item => !oldIds.has(item.media.id)),
  ];
  const titles = Object.fromEntries(items.map(item => [item.media.id, previous.titles[item.media.id] ?? item.title]));
  for (const item of draft.items) {
    const old = oldServer.get(item.media.id);
    if (!oldIds.has(item.media.id) || (old && titles[item.media.id] === old.title))
      titles[item.media.id] = item.title;
  }
  const checked = previous.checked.filter(id => fresh.has(id) || !oldServer.has(id));
  for (const item of draft.items)
    if (!oldServer.has(item.media.id) && !checked.includes(item.media.id)) checked.push(item.media.id);
  const editor: TitleEditor = {
    ...previous,
    pendingMedia: pending && draft.revision === pending.expectedRevision ? pending : undefined,
    draft,
    items,
    titles,
    checked,
    mode: previous.mode === previous.draft.titleMode ? draft.titleMode : previous.mode,
    sharedTitle: previous.sharedTitle === (previous.draft.sharedTitle ?? previous.draft.articleTitle)
      ? draft.sharedTitle ?? draft.articleTitle : previous.sharedTitle,
  };
  // A clean persisted editor stays clean when the server changed during review.
  if (titleEditorSignature(previous) === previous.savedSignature)
    editor.savedSignature = titleEditorSignature(editor);
  return editor;
}

/** Responses to our own writes advance the revision without narrowing the UI snapshot. */
export function acceptTitleEditorSave(editor: TitleEditor, draft: PublicationDraft, saved: boolean): TitleEditor {
  const fresh = new Map(draft.items.map(item => [item.media.id, item]));
  const next = {
    ...editor,
    pendingMedia: undefined,
    draft,
    items: editor.items.map(item => fresh.get(item.media.id) ?? item),
  };
  return saved ? { ...next, savedSignature: titleEditorSignature(next) } : next;
}

function validSnapshotItem(value: unknown): value is PublicationDraftItem {
  if (!value || typeof value !== "object") return false;
  const item = value as PublicationDraftItem;
  return typeof item.title === "string" && Boolean(item.media) &&
    typeof item.media.id === "string" && typeof item.media.name === "string" &&
    typeof item.media.shortName === "string" &&
    typeof item.media.priceTenThousandths === "string" && /^\d+$/.test(item.media.priceTenThousandths);
}

/** Task values are untrusted persisted JSON, and may be from an older editor. */
export function readTitleEditors(value: string): Record<string, TitleEditor> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, TitleEditor> = {};
    for (const [id, raw] of Object.entries(parsed)) {
      if (!raw || typeof raw !== "object") continue;
      const editor = raw as TitleEditor;
      if (editor.draft?.id !== id || typeof editor.draft.articleVersionId !== "string" ||
          !Number.isInteger(editor.draft.revision) || !Array.isArray(editor.draft.items) ||
          !Array.isArray(editor.items) || !Array.isArray(editor.checked) ||
          !editor.checked.every(item => typeof item === "string") ||
          !editor.items.every(validSnapshotItem) || !editor.draft.items.every(validSnapshotItem) ||
          !editor.titles || typeof editor.titles !== "object" || Array.isArray(editor.titles) ||
          !Object.values(editor.titles).every(item => typeof item === "string") ||
          !["single", "per_media"].includes(editor.mode) || typeof editor.sharedTitle !== "string" ||
          typeof editor.savedSignature !== "string") continue;
      const ids = new Set(editor.items.map(item => item.media.id));
      const pending = editor.pendingMedia;
      const pendingMedia = pending && Number.isInteger(pending.expectedRevision) &&
        pending.expectedRevision === editor.draft.revision && Array.isArray(pending.mediaIds) &&
        pending.mediaIds.every(item => typeof item === "string" && ids.has(item)) &&
        new Set(pending.mediaIds).size === pending.mediaIds.length ? pending : undefined;
      result[id] = { ...editor, pendingMedia, onlyErrors: Boolean(editor.onlyErrors), checked: [...new Set(editor.checked)].filter(item => ids.has(item)) };
    }
    return result;
  } catch { return {}; }
}
