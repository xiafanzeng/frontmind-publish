import { describe, expect, it } from "vitest";
import { KolTokenCache } from "./token.js";

const HOUR = 60 * 60_000;

/** Token with a JWT exp roughly 40 days out, like the real supplier tokens. */
const LONG_LIVED_TOKEN = [
  "header",
  Buffer.from(
    JSON.stringify({ exp: Math.floor((Date.now() + 40 * 24 * HOUR) / 1000) }),
  ).toString("base64url"),
  "signature",
].join(".");

type Authenticate = (signal?: AbortSignal) => Promise<string>;

function makeCache(authenticate: Authenticate, startAt: number) {
  let now = startAt;
  return {
    cache: new KolTokenCache(authenticate, {
      refreshSkewMs: 60_000,
      maxTokenAgeMs: 8 * HOUR,
      now: () => new Date(now),
    }),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("KolTokenCache supplier session lifetime", () => {
  it("reuses the cached token within the 8-hour session window", async () => {
    let calls = 0;
    const { cache, advance } = makeCache(async () => {
      calls += 1;
      return LONG_LIVED_TOKEN;
    }, Date.now());
    const first = await cache.getToken();
    advance(HOUR);
    const second = await cache.getToken();
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });

  it("proactively re-authenticates after 8 hours even when the JWT exp is far away", async () => {
    let calls = 0;
    const { cache, advance } = makeCache(async () => {
      calls += 1;
      return LONG_LIVED_TOKEN;
    }, Date.now());
    await cache.getToken();
    advance(8 * HOUR + 61_000);
    await cache.getToken();
    expect(calls).toBe(2);
  });

  it("honours a shorter JWT exp when present", async () => {
    const start = Date.now();
    const shortLived = [
      "header",
      Buffer.from(
        JSON.stringify({ exp: Math.floor((start + 2 * HOUR) / 1000) }),
      ).toString("base64url"),
      "signature",
    ].join(".");
    let calls = 0;
    let now = start;
    const cache = new KolTokenCache(
      async () => {
        calls += 1;
        return shortLived;
      },
      {
        refreshSkewMs: 60_000,
        maxTokenAgeMs: 8 * HOUR,
        now: () => new Date(now),
      },
    );
    await cache.getToken();
    now = start + 2 * HOUR - 30_000;
    await cache.getToken();
    expect(calls).toBe(2);
  });

  it("re-authenticates after invalidate with forceRefresh semantics", async () => {
    let calls = 0;
    const { cache } = makeCache(async () => {
      calls += 1;
      return `${LONG_LIVED_TOKEN}-${calls}`;
    }, Date.now());
    const first = await cache.getToken();
    cache.invalidate(first);
    const second = await cache.getToken({
      forceRefresh: true,
      rejectedToken: first,
    });
    expect(calls).toBe(2);
    expect(second).not.toBe(first);
  });
});
