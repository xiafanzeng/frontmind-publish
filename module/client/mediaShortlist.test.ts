// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mediaSelectionBlocker,
  mediaShortlistKey,
  readMediaShortlist,
  saveMediaShortlist,
  switchMediaKind,
} from "./mediaShortlist";
import { DEFAULT_MEDIA_FILTERS } from "./queryState";
import type { MediaResource } from "./types";

const media = {
  id: "media-1",
  name: "测试媒体",
  kind: "news",
  platform: "平台",
  priceTenThousandths: "10000",
  active: true,
  capability: "image_pending",
} as MediaResource;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {getItem:vi.fn(),setItem:vi.fn(),removeItem:vi.fn(),clear:vi.fn()});
  vi.mocked(sessionStorage.getItem).mockImplementation((key) => values.get(key) ?? null);
  vi.mocked(sessionStorage.setItem).mockImplementation((key, value) => { values.set(key, value); });
  vi.mocked(sessionStorage.removeItem).mockImplementation((key) => { values.delete(key); });
  vi.mocked(sessionStorage.clear).mockImplementation(() => values.clear());
});

describe("media shortlist", () => {
  it("allows unspecified image requirements without claiming verified support", () => {
    expect(mediaSelectionBlocker(media, false)).toBe("");
    expect(mediaSelectionBlocker(media, true)).toBe("");
    expect(media.capability).toBe("image_pending");
    expect(mediaSelectionBlocker({ ...media, capability: "image" }, true)).toBe("");
  });
  it("retains explicit image bans and does not invent a ban from unrelated remarks", () => {
    expect(mediaSelectionBlocker({ ...media, capability: "text" }, true)).toContain("明确不支持图片");
    expect(mediaSelectionBlocker({ ...media, capability: "text" }, false)).toBe("");
    for (const remark of ["不支持图片", "仅限纯文字", "禁止图片", "图片最多0张"]) {
      expect(mediaSelectionBlocker({ ...media, remark }, true)).toBeTruthy();
      expect(mediaSelectionBlocker({ ...media, remark }, false)).toBe("");
    }
    for (const remark of ["未注明", "", "图片不限", "改稿需要付费", "图片最多3张"]) {
      expect(mediaSelectionBlocker({ ...media, remark }, true)).toBe("");
    }
  });
  it("still rejects inactive media and invalid quotes for image articles", () => {
    expect(
      mediaSelectionBlocker({ ...media, active: false }, true),
    ).toBeTruthy();
    expect(
      mediaSelectionBlocker({ ...media, priceTenThousandths: "bad" }, true),
    ).toBeTruthy();
    expect(
      mediaSelectionBlocker({ ...media, priceTenThousandths: "0" }, true),
    ).toBeTruthy();
  });
  it("persists only display estimates and keeps viewers, owners and enterprise projects isolated", () => {
    const a = mediaShortlistKey(3, "enterpriseProjectId=a&operatorOwnerId=8");
    saveMediaShortlist(a, new Map([[media.id, media]]));
    expect(readMediaShortlist(a).get(media.id)?.priceTenThousandths).toBe(
      "10000",
    );
    for (const key of [
      mediaShortlistKey(4, "enterpriseProjectId=a&operatorOwnerId=8"),
      mediaShortlistKey(3, "enterpriseProjectId=b&operatorOwnerId=8"),
      mediaShortlistKey(3, "enterpriseProjectId=a&operatorOwnerId=9"),
    ])
      expect(readMediaShortlist(key).size).toBe(0);
    saveMediaShortlist(a, new Map());
    expect(readMediaShortlist(a).size).toBe(0);
  });
  it("ignores corrupt storage and clears incompatible filters when changing kind", () => {
    const key = mediaShortlistKey(3, "enterpriseProjectId=corrupt")!;
    sessionStorage.setItem(key, "{");
    expect(readMediaShortlist(key).size).toBe(0);
    const next = switchMediaKind(
      {
        ...DEFAULT_MEDIA_FILTERS,
        platform: "旧平台",
        authenticated: "true",
        query: "品牌",
        priceMin: "20",
        page: 5,
      },
      "self_media",
      DEFAULT_MEDIA_FILTERS,
    );
    expect(next).toMatchObject({
      kind: "self_media",
      platform: "",
      authenticated: "",
      query: "品牌",
      priceMin: "20",
      page: 1,
    });
  });
});
