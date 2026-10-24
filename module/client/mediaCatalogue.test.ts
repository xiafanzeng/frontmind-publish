import { describe, expect, it } from "vitest";
import { catalogueInventory, chooseCatalogueSnapshot, cataloguePriceRanges, validateCatalogueNames, validateCataloguePrice } from "./mediaCatalogue";

describe("catalogue presentation boundaries", () => {
  it("keeps the latest inventory while another query loads or exposes an old cached page", () => {
    const old = { activeRevision: "old", lastSyncedAt: "2026-10-23T00:00:00Z", stale: false, mediaCount: 20 };
    const latest = { ...old, activeRevision: "latest", lastSyncedAt: "2026-10-24T00:00:00Z", mediaCount: 30 };
    expect(chooseCatalogueSnapshot(undefined, latest, true)).toBe(latest);
    expect(chooseCatalogueSnapshot(old, latest, true)).toBe(latest);
    expect(chooseCatalogueSnapshot(old, latest, false)).toBe(latest);
    expect(chooseCatalogueSnapshot(latest, old, false)).toBe(latest);
    const unavailable = { ...old, lastSyncedAt: "1970-01-01T00:00:00.000Z", countStatus: "unavailable" as const };
    expect(chooseCatalogueSnapshot(unavailable, latest, false)).toBe(unavailable);
    expect(catalogueInventory(chooseCatalogueSnapshot(unavailable, latest, false))).toBeUndefined();
  });
  it("accepts only internally consistent inventory, including a verified empty catalog", () => {
    const catalog = { activeRevision: "one", lastSyncedAt: "2026-10-24T00:00:00Z", stale: false, kindComplete: true, countStatus: "available" as const, mediaCount: 30, newsCount: 10, selfMediaCount: 20 };
    expect(catalogueInventory(catalog)).toEqual({ all: 30, news: 10, selfMedia: 20 });
    expect(catalogueInventory({ ...catalog, mediaCount: 10 })).toBeUndefined();
    expect(catalogueInventory({ ...catalog, newsCount: undefined })).toBeUndefined();
    expect(catalogueInventory({ ...catalog, countStatus: "unavailable" })).toBeUndefined();
    expect(catalogueInventory({ ...catalog, kindComplete: false })).toBeUndefined();
    expect(catalogueInventory({ ...catalog, mediaCount: 0, newsCount: 0, selfMediaCount: 0 })).toEqual({ all: 0, news: 0, selfMedia: 0 });
  });

  it("places every price boundary and decimal in exactly one preset", () => {
    for (const price of [0, 0.0001, 50, 50.0001, 100, 100.5, 150, 150.0001, 200, 200.0001]) {
      const matches = cataloguePriceRanges.slice(1).filter(range =>
        (range.exclusive ? price > Number(range.min) : price >= Number(range.min)) &&
        (!range.max || price <= Number(range.max)),
      );
      expect(matches, `price ${price}`).toHaveLength(1);
    }
  });

  it("validates custom money without dropping zero, one-sided or four-decimal bounds", () => {
    expect(validateCataloguePrice("0", "50.0001")).toEqual({ min: "0", max: "50.0001" });
    expect(validateCataloguePrice("", "0")).toEqual({ min: "", max: "0" });
    expect(validateCataloguePrice("100.5", "")).toEqual({ min: "100.5", max: "" });
    for (const [min, max] of [["-1", ""], ["1e2", ""], ["NaN", ""], ["1.00001", ""], ["51", "50"], ["100000000.0001", ""]]) {
      expect(validateCataloguePrice(min, max).error).toBeTruthy();
    }
  });

  it("deduplicates names without silently truncating batch requests", () => {
    expect(validateCatalogueNames("媒体甲，媒体乙\n媒体甲\r\n 媒体丙 ").names).toEqual(["媒体甲", "媒体乙", "媒体丙"]);
    expect(validateCatalogueNames(Array.from({ length: 51 }, (_, i) => `媒体${i}`).join(",")).error).toBeTruthy();
    expect(validateCatalogueNames("甲".repeat(121)).error).toBeTruthy();
  });
});
