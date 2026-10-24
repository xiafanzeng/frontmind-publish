import { describe, expect, it, vi } from "vitest";
import { batchArticleVersions, prepareBatchMediaDrafts, withBatchArticleVersions, type BatchDraftCreation } from "./batchMediaSelection";
import type { MediaResource, PublicationDraft, SaveDraftTitlesInput } from "./types";

function draft(versionId: string, mediaIds: string[], revision = 1): PublicationDraft {
  return { id: `draft-${versionId}`, articleId: `article-${versionId}`, articleVersionId: versionId,
    articleTitle: versionId, articleVersion: 1, articleVersionHash: versionId, articleContainsImages: false,
    revision, titleMode: "per_media", updatedAt: "2026-10-24T00:00:00Z",
    items: mediaIds.map(id => ({ media: { id } as MediaResource, title: `${versionId}-${id}` })) };
}

function harness(initial: PublicationDraft[] = []) {
  const saved = new Map(initial.map(item => [item.id, item]));
  const receipts = new Map<string, PublicationDraft>();
  const gateway = {
    getDraft: vi.fn(async (id: string) => saved.get(id)!),
    createDraft: vi.fn(async (version: string, media: string[], key?: string) => {
      const result = receipts.get(key!) ?? draft(version, media);
      saved.set(result.id, result); receipts.set(key!, result); return result;
    }),
    updateDraftMedia: vi.fn(async (id: string, media: string[], revision: number) => {
      const previous = saved.get(id)!;
      expect(previous.revision).toBe(revision);
      const result = { ...previous, revision: revision + 1, items: media.map(mediaId =>
        previous.items.find(item => item.media.id === mediaId) ?? { media: { id: mediaId } as MediaResource, title: previous.articleTitle }) };
      saved.set(id, result); return result;
    }),
    saveDraftTitles: vi.fn(async (id: string, input: SaveDraftTitlesInput | Record<string, string>) => {
      const update = input as SaveDraftTitlesInput;
      const previous = saved.get(id)!;
      expect(previous.revision).toBe(update.expectedRevision);
      const result = { ...previous, revision: previous.revision + 1, titleMode: update.mode, sharedTitle: update.sharedTitle,
        items: previous.items.map(item => ({ ...item, title: update.titles[item.media.id] })) };
      saved.set(id, result); return result;
    }),
  };
  return { gateway, saved, input: { gateway, versionIds: ["a", "b"], existingDrafts: initial,
    selectedMediaIds: ["shared"], originalMediaIds: [] as string[], journal: [] as BatchDraftCreation[],
    requestKey: async (version: string, ids: string[]) => JSON.stringify([version, ids]),
    persistJournal: vi.fn(async (_journal: BatchDraftCreation[]) => {}), onSaved: vi.fn(async (_draft: PublicationDraft) => {}) } };
}

describe("batch media upstream", () => {
  it("carries every frozen version in order without losing task/project context", () => {
    const route = withBatchArticleVersions("/publishing/media?enterpriseProjectId=p&workbenchTask=t", ["a", "b", "a"]);
    const params = new URLSearchParams(route.split("?")[1]);
    expect(params.getAll("batchArticleVersion")).toEqual(["a", "b"]);
    expect(params.get("articleVersion")).toBe("a");
    expect(params.get("enterpriseProjectId")).toBe("p");
    expect(params.get("workbenchTask")).toBe("t");
    expect(batchArticleVersions("a", params.toString(), ["wrong-task"])).toEqual(["a", "b"]);
  });

  it("creates one actual draft per frozen article, with the shared media selection", async () => {
    const { gateway, input } = harness();
    const result = await prepareBatchMediaDrafts(input);
    expect(result.map(item => [item.id, item.articleVersionId])).toEqual([["draft-a", "a"], ["draft-b", "b"]]);
    expect(gateway.createDraft.mock.calls.map(call => call.slice(0, 2))).toEqual([["a", ["shared"]], ["b", ["shared"]]]);
    expect(input.journal.map(entry => entry.draftId)).toEqual(["draft-a", "draft-b"]);
  });

  it("retains distinct and overlapping per-article mappings when resuming", async () => {
    const initial = [draft("a", ["shared", "a-only"]), draft("b", ["shared", "b-only"])];
    const { input, gateway } = harness(initial);
    input.originalMediaIds = ["shared", "a-only", "b-only"];
    input.selectedMediaIds = [...input.originalMediaIds];
    const result = await prepareBatchMediaDrafts(input);
    expect(result.map(item => item.items.map(row => row.media.id))).toEqual([["shared", "a-only"], ["shared", "b-only"]]);
    expect(gateway.createDraft).not.toHaveBeenCalled();
    expect(gateway.updateDraftMedia).not.toHaveBeenCalled();
  });

  it("applies shared additions/removals without copying another article's retained media", async () => {
    const { input } = harness([draft("a", ["shared", "a-only"]), draft("b", ["shared", "b-only"])]);
    input.originalMediaIds = ["shared", "a-only", "b-only"];
    input.selectedMediaIds = ["a-only", "b-only", "new"];
    const result = await prepareBatchMediaDrafts(input);
    expect(result.map(item => item.items.map(row => row.media.id))).toEqual([["a-only", "new"], ["b-only", "new"]]);
  });

  it("replays the original create payload after a lost response, then applies a changed selection", async () => {
    const { input, gateway, saved } = harness();
    const original = gateway.createDraft.getMockImplementation()!;
    let loseReply = true;
    gateway.createDraft.mockImplementation(async (version, media, key) => {
      const result = await original(version, media, key);
      if (version === "b" && loseReply) { loseReply = false; throw new Error("response lost"); }
      return result;
    });
    await expect(prepareBatchMediaDrafts(input)).rejects.toThrow("response lost");
    expect(input.journal.map(entry => entry.draftId)).toEqual(["draft-a", undefined]);
    input.selectedMediaIds = ["replacement"];
    const result = await prepareBatchMediaDrafts(input);
    expect(saved.size).toBe(2);
    expect(result.map(item => item.items.map(row => row.media.id))).toEqual([["replacement"], ["replacement"]]);
    const replay = gateway.createDraft.mock.calls.filter(call => call[0] === "b");
    expect(replay[0]).toEqual(replay[1]);
    expect(replay[1][1]).toEqual(["shared"]);
  });

  it("does not create a draft if its recovery record cannot be persisted", async () => {
    const { input, gateway } = harness();
    input.persistJournal.mockRejectedValueOnce(new Error("save failed"));
    await expect(prepareBatchMediaDrafts(input)).rejects.toThrow("save failed");
    expect(gateway.createDraft).not.toHaveBeenCalled();
  });

  it("copies only the revised article's media and retained titles onto its new frozen version", async () => {
    const initial = [draft("a", ["shared", "a-only"]), draft("b", ["shared", "b-only"])];
    const { input, gateway, saved } = harness(initial);
    gateway.createDraft.mockImplementation(async (version, media) => {
      const result = { ...draft(version, media), articleId: version === "a2" ? "article-a" : `article-${version}` };
      saved.set(result.id, result); return result;
    });
    const result = await prepareBatchMediaDrafts({ ...input, versionIds: ["a2", "b"], articleIdsByVersion: { a2: "article-a", b: "article-b" },
      selectedMediaIds: ["shared", "a-only", "b-only"], originalMediaIds: ["shared", "a-only", "b-only"] });
    expect(result.map(item => item.items.map(row => row.media.id))).toEqual([["shared", "a-only"], ["shared", "b-only"]]);
    expect(result[0].items.map(item => item.title)).toEqual(["a-shared", "a-a-only"]);
    expect(gateway.createDraft).toHaveBeenCalledTimes(1);
    expect(result[1].id).toBe("draft-b");
  });

  it("retains a fully excluded article's editable rows and titles when another article is refrozen", async () => {
    const { input, gateway, saved } = harness([draft("a", ["shared"]), draft("b", ["shared", "b-only"])]);
    gateway.createDraft.mockImplementation(async (version, media) => {
      const result = { ...draft(version, media), articleId: version === "a2" ? "article-a" : "article-b" };
      saved.set(result.id, result); return result;
    });
    const result = await prepareBatchMediaDrafts({ ...input, versionIds: ["a2", "b"], articleIdsByVersion: { a2: "article-a", b: "article-b" },
      excludedArticleIds: ["article-b"], selectedMediaIds: ["shared"], originalMediaIds: ["shared"] });
    expect(result[0].items.map(item => item.media.id)).toEqual(["shared"]);
    expect(result[1].items.map(item => [item.media.id, item.title])).toEqual([["shared", "b-shared"], ["b-only", "b-b-only"]]);
    expect(gateway.updateDraftMedia).not.toHaveBeenCalled();
  });

  it("preserves a revised source draft's single-title mode and custom shared title", async () => {
    const source = { ...draft("a", ["shared"]), titleMode: "single" as const, sharedTitle: "已保存统一标题" };
    source.items[0].title = source.sharedTitle;
    const { input, gateway, saved } = harness([source]);
    gateway.createDraft.mockImplementation(async (version, media) => {
      const result = { ...draft(version, media), articleId: "article-a" };
      saved.set(result.id, result); return result;
    });
    const [result] = await prepareBatchMediaDrafts({ ...input, versionIds: ["a2"], articleIdsByVersion: { a2: "article-a" }, originalMediaIds: ["shared"] });
    expect(gateway.createDraft).toHaveBeenCalledWith("a2", ["shared"], expect.any(String), "single");
    expect(result.titleMode).toBe("single");
    expect(result.sharedTitle).toBe("已保存统一标题");
    expect(result.items[0].title).toBe("已保存统一标题");
  });
});
