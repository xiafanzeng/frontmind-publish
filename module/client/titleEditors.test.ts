import { describe, expect, it } from "vitest";
import type { MediaResource, PublicationDraft } from "./types";
import { acceptTitleEditorSave, createTitleEditor, readTitleEditors, reconcileTitleEditor, sameDraftSelection, titleEditorSignature } from "./titleEditors";

const media = (id: string): MediaResource => ({
  id, name: `媒体 ${id}`, shortName: id, kind: "news", platform: "网站", taxonomy: "综合",
  mediaType: "新闻", channel: "综合", region: "全国", logoSource: "generated_fallback",
  logoResolutionStatus: "missing", titleLimit: 200, priceTenThousandths: "10000",
  turnaround: "1 天", capability: "text", active: true, catalogRevision: "catalog-1",
});
const draft = (id = "draft-a", ids = ["shared", "other"], revision = 1): PublicationDraft => ({
  id, articleId: `article-${id}`, articleVersionId: `version-${id}`, articleTitle: `稿件 ${id}`,
  articleVersion: 1, articleVersionHash: `hash-${id}`, articleContainsImages: false,
  revision, titleMode: "per_media", items: ids.map(id => ({ media: media(id), title: "初始标题" })),
  updatedAt: "2026-10-24T00:00:00.000Z",
});

it("restores exact publication quantities and treats quote changes as a new selection", () => {
  const current=draft('draft-a',['shared']);
  current.items[0].publication={
    schemaVersion:1,source:'source_matrix_budget_plan',taskId:'task',planId:'plan',planVersion:'pv',planIndex:0,
    articleId:current.articleId,articleVersionId:current.articleVersionId,articleVersion:'1',resourceId:'shared',offerId:'offer',
    publicationSpec:'article',quantity:3,quantityMeaning:'repeat_same_article',purpose:'standard',
    unitPriceTenThousandths:'10000',totalPriceTenThousandths:'30000',quoteFingerprint:'a'.repeat(64),locked:false,
  };
  const editor=createTitleEditor(current);
  expect(readTitleEditors(JSON.stringify({[current.id]:editor}))[current.id].items[0].publication?.quantity).toBe(3);
  const changed={...current,items:current.items.map(item=>({...item,publication:{...item.publication!,offerId:'other-offer'}}))};
  expect(sameDraftSelection(current,changed)).toBe(false);
  expect(titleEditorSignature(createTitleEditor(changed))).not.toBe(editor.savedSignature);
});

describe("title editor snapshots", () => {
  it("isolates identical media IDs by draft and includes check changes in its dirty signature", () => {
    const a = createTitleEditor(draft());
    const b = createTitleEditor(draft("draft-b"));
    a.titles = { ...a.titles, shared: "A 的标题" };
    a.checked = ["other"];
    expect(b.titles.shared).toBe("初始标题");
    expect(b.checked).toContain("shared");
    expect(titleEditorSignature({ ...b, checked: [] })).not.toBe(b.savedSignature);
  });

  it("restores excluded rows and edits after narrowing, persisted refresh, and reselect", () => {
    const initial = createTitleEditor(draft());
    const edited = { ...initial, checked: ["shared"], titles: { ...initial.titles, other: "暂不发布的标题" } };
    const narrowed = draft("draft-a", ["shared"], 2);
    const saved = acceptTitleEditorSave(edited, narrowed, true);
    const restored = reconcileTitleEditor(narrowed, readTitleEditors(JSON.stringify({ "draft-a": saved }))["draft-a"]);
    expect(restored.items.map(item => item.media.id)).toEqual(["shared", "other"]);
    expect(restored.checked).toEqual(["shared"]);
    expect(restored.titles.other).toBe("暂不发布的标题");
    const reselected = { ...restored, checked: [...restored.checked, "other"] };
    expect(titleEditorSignature(reselected)).not.toBe(reselected.savedSignature);
  });

  it("does not resurrect externally removed media and includes newly added server rows", () => {
    const initial = createTitleEditor(draft());
    const next = reconcileTitleEditor(draft("draft-a", ["shared", "new"], 2), initial);
    expect(next.checked).toEqual(["shared", "new"]);
    expect(next.items.map(item => item.media.id)).toEqual(["shared", "new"]);
    expect(next.draft.revision).toBe(2);
  });

  it("retains unchecked rows when a persisted own narrowing committed but its reply was lost", () => {
    const initial = createTitleEditor(draft());
    const pending = { ...initial, checked: ["shared"], titles: { ...initial.titles, other: "保留的标题" },
      pendingMedia: { expectedRevision: 1, mediaIds: ["shared"] } };
    const restored = readTitleEditors(JSON.stringify({ "draft-a": pending }))["draft-a"];
    const next = reconcileTitleEditor(draft("draft-a", ["shared"], 2), restored);
    expect(next.items.map(item => item.media.id)).toEqual(["shared", "other"]);
    expect(next.checked).toEqual(["shared"]);
    expect(next.titles.other).toBe("保留的标题");
    expect(next.pendingMedia).toBeUndefined();
    // Later unrelated server removals still have their ordinary reconciliation rules.
    const unrelated = reconcileTitleEditor(draft("draft-a", ["other"], 3), restored);
    expect(unrelated.items.map(item => item.media.id)).toEqual(["other"]);
    expect(unrelated.pendingMedia).toBeUndefined();
  });

  it("ignores old cached revisions after a successful narrowing", () => {
    const initial = createTitleEditor(draft());
    const saved = acceptTitleEditorSave({ ...initial, checked: ["shared"] }, draft("draft-a", ["shared"], 3), true);
    expect(reconcileTitleEditor(draft(), saved)).toBe(saved);
    expect(sameDraftSelection(draft(), saved.draft)).toBe(false);
  });

  it("keeps independent local titles while adopting unedited server titles", () => {
    const initial = createTitleEditor(draft());
    const local = { ...initial, titles: { ...initial.titles, shared: "本地修改" } };
    const latest = draft("draft-a", ["shared", "other"], 2);
    latest.items = latest.items.map(item => ({ ...item, title: "服务端修改" }));
    const next = reconcileTitleEditor(latest, local);
    expect(next.mode).toBe("per_media");
    expect(next.titles.shared).toBe("本地修改");
    expect(next.titles.other).toBe("服务端修改");
  });

  it("ignores a legacy local mode switch and follows the authoritative upstream mode", () => {
    const initial = createTitleEditor(draft());
    const legacy = { ...initial, mode: "single" as const, sharedTitle: "旧的本地模式标题", checked: ["shared"] };
    const next = reconcileTitleEditor(draft(), legacy);
    expect(next.mode).toBe("per_media");
    expect(next.sharedTitle).toBe("");
    expect(next.checked).toEqual(["shared"]);
    const single = { ...draft(), revision: 2, titleMode: "single" as const, sharedTitle: "上游确认标题" };
    const switched = reconcileTitleEditor(single, { ...initial, titles: { shared: "旧独立标题" } });
    expect(switched.mode).toBe("single");
    expect(switched.sharedTitle).toBe("上游确认标题");
    expect(sameDraftSelection(draft(), single)).toBe(false);
  });

  it("does not invent a confirmed single title from the display label", () => {
    const missing = { ...draft(), titleMode: "single" as const, articleTitle: "upload.docx" };
    expect(createTitleEditor(missing).sharedTitle).toBe("");
  });

  it("advances revisions after media writes without marking unsaved titles clean", () => {
    const initial = createTitleEditor(draft());
    const edited = { ...initial, checked: ["shared"] };
    const next = acceptTitleEditorSave(edited, draft("draft-a", ["shared"], 2), false);
    expect(next.draft.revision).toBe(2);
    expect(next.savedSignature).toBe(initial.savedSignature);
    expect(titleEditorSignature(next)).not.toBe(next.savedSignature);
  });

  it("resets snapshots for a different frozen version and rejects malformed persisted data", () => {
    const previous = createTitleEditor(draft());
    const newVersion = { ...draft(), articleVersionId: "new-version", articleVersion: 2 };
    expect(reconcileTitleEditor(newVersion, { ...previous, checked: [] }).checked).toHaveLength(2);
    expect(readTitleEditors("broken")).toEqual({});
    expect(readTitleEditors(JSON.stringify({ "draft-a": { ...previous, checked: [42] } }))).toEqual({});
  });
});
