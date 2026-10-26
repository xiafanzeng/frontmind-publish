import { describe, expect, it, vi } from "vitest";
import { publishingTitleStage, saveUpstreamDraftTitles } from "./titleFlow";
import type { PublisherGateway } from "./gateway";
import type { PublicationDraft } from "./types";

describe("upstream title flow", () => {
  it("routes every saved title mode to the combined titles page", () => {
    expect(publishingTitleStage([{ titleMode: "single" }, { titleMode: "single" }])).toBe("titles");
    expect(publishingTitleStage([{ titleMode: "single" }, { titleMode: "per_media" }])).toBe("titles");
    expect(publishingTitleStage([])).toBeUndefined();
    expect(publishingTitleStage([{ titleMode: "single" }, {}])).toBeUndefined();
  });
  const draft = (overrides: Partial<PublicationDraft> = {}) => ({
    id: "draft-a", revision: 4, titleMode: "single", sharedTitle: "本稿确认标题", articleTitle: "文件名.docx",
    items: [{ media: { id: "shared" }, title: "本稿确认标题" }], ...overrides,
  }) as PublicationDraft;

  it("does not save again when all single-title rows already match the confirmed title", async () => {
    const gateway = { saveDraftTitles: vi.fn<PublisherGateway["saveDraftTitles"]>() };
    const current = draft();
    expect(await saveUpstreamDraftTitles(gateway, current)).toBe(current);
    expect(gateway.saveDraftTitles).not.toHaveBeenCalled();
  });
  it("saves the explicit upstream title and mode before entering title configuration", async () => {
    const gateway = { saveDraftTitles: vi.fn<PublisherGateway["saveDraftTitles"]>(async () => draft({ revision: 5 })) };
    await saveUpstreamDraftTitles(gateway, draft({ titleMode: "per_media" }), "single", "新上游确认标题");
    expect(gateway.saveDraftTitles).toHaveBeenCalledWith("draft-a", {
      mode: "single", sharedTitle: "新上游确认标题", titles: { shared: "新上游确认标题" }, expectedRevision: 4,
    });
  });
  it("does not substitute a display filename when the confirmed shared title is missing", async () => {
    const gateway = { saveDraftTitles: vi.fn<PublisherGateway["saveDraftTitles"]>() };
    await expect(saveUpstreamDraftTitles(gateway, draft({ sharedTitle: undefined }))).rejects.toThrow("正式共享标题无法恢复");
    expect(gateway.saveDraftTitles).not.toHaveBeenCalled();
  });
  it("leaves a failed save recoverable instead of returning a draft ready for navigation", async () => {
    const gateway = { saveDraftTitles: vi.fn<PublisherGateway["saveDraftTitles"]>().mockRejectedValue(new Error("save failed")) };
    const current = draft({ titleMode: "per_media" });
    await expect(saveUpstreamDraftTitles(gateway, current, "single", "新标题")).rejects.toThrow("save failed");
    expect(current.titleMode).toBe("per_media");
  });
});
