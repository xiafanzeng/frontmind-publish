import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaCatalogPromiseCache } from "./media-catalog-cache.js";

afterEach(() => vi.useRealTimers());

describe("bounded catalog facet promise cache", () => {
  it("shares pending work, starts TTL at completion and retries failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cache = new MediaCatalogPromiseCache<number>(3, 60_000);
    let complete!: (value: number) => void;
    const load = vi.fn(() => new Promise<number>((resolve) => { complete = resolve; }));
    const pending = cache.getOrLoad("revision/filter", load);
    await Promise.resolve();
    vi.setSystemTime(70_000);
    expect(cache.getOrLoad("revision/filter", load)).toBe(pending);
    complete(12);
    expect(await pending).toBe(12);
    vi.setSystemTime(120_000);
    expect(await cache.getOrLoad("revision/filter", load)).toBe(12);
    expect(load).toHaveBeenCalledTimes(1);
    vi.setSystemTime(131_000);
    expect(await cache.getOrLoad("revision/filter", async () => 13)).toBe(13);
    await expect(cache.getOrLoad("failure", async () => { throw new Error("retry"); })).rejects.toThrow("retry");
    expect(await cache.getOrLoad("failure", async () => 1)).toBe(1);
  });

  it("evicts one least-recent completed result and isolates full scope/revision keys", async () => {
    const cache = new MediaCatalogPromiseCache<number>(3);
    for (const key of ["a", "b", "c"]) await cache.getOrLoad(key, async () => 1);
    await cache.getOrLoad("a", async () => 2);
    await cache.getOrLoad("d", async () => 1);
    expect(await cache.getOrLoad("a", async () => 2)).toBe(1);
    expect(await cache.getOrLoad("c", async () => 2)).toBe(1);
    expect(await cache.getOrLoad("b", async () => 2)).toBe(2);
    expect(await cache.getOrLoad("revision-2/filter", async () => 3)).toBe(3);
    cache.clear();
    expect(await cache.getOrLoad("revision-2/filter", async () => 4)).toBe(4);
  });
});
