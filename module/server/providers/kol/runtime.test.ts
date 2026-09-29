// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { checkKolRuntimeConnection, createKolRuntimeClient, getKolRuntimeStatus } from "./runtime";

const env = {
  NODE_ENV: "production", PUBLISHER_FEATURE_ENABLED: "true", PUBLISHER_PROVIDER_ENABLED: "true",
  PUBLISHER_MODE: "live", PUBLISHER_KOL_BASE_URL: "https://api.kol.test",
  PUBLISHER_KOL_ACCESS_TOKEN: "test-private-token", PUBLISHER_REAL_ENABLED: "true",
  PUBLISHER_PUBLISH_ENABLED: "true",
};
const page = () => Response.json({ success: true, status: 200,
  data: [{ id: 1, name: "合成测试媒体", is_zimeiti: 2, price: "10" }],
  pagination: { current_page: 1, last_page: 20, per_page: 50, total: 999 } });

describe("module-owned media runtime", () => {
  it("exposes capability booleans without credential or origin values", () => {
    const status = getKolRuntimeStatus(env);
    expect(status).toEqual({ enabled: true, mode: "live", configured: true, realPublicationEnabled: true });
    expect(JSON.stringify(status)).not.toContain(env.PUBLISHER_KOL_ACCESS_TOKEN);
    expect(JSON.stringify(status)).not.toContain(env.PUBLISHER_KOL_BASE_URL);
  });

  it("checks only one read-only page using existing server credentials", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/news_resource_2/data");
      expect(url.searchParams.get("token")).toBe(env.PUBLISHER_KOL_ACCESS_TOKEN);
      expect(url.searchParams.get("page")).toBe("1");
      expect(init?.method).toBe("GET");
      return page();
    });
    const result = await checkKolRuntimeConnection(env, { fetch: fetcher });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toEqual({ connectionOk: true, pageItemCount: 1,
      pagination: { currentPage: 1, lastPage: 20, perPage: 50, total: 999 } });
    expect(JSON.stringify(result)).not.toContain("合成测试媒体");
    expect(JSON.stringify(result)).not.toContain("test-private-token");
  });

  it("rejects missing credentials, disabled provider and mock checks before HTTP", async () => {
    const fetcher = vi.fn();
    for (const extra of [{ PUBLISHER_KOL_ACCESS_TOKEN: "" }, { PUBLISHER_PROVIDER_ENABLED: "false" },
      { NODE_ENV: "development", PUBLISHER_MODE: "mock" }]) {
      await expect(checkKolRuntimeConnection({ ...env, ...extra }, { fetch: fetcher }))
        .rejects.toMatchObject({ code: "invalid_configuration" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps token-only operation when obsolete account values are incomplete", async () => {
    const fetcher = vi.fn(async () => page());
    const client = createKolRuntimeClient({ ...env, KOL_API_KEY: "replace-me", KOL_PASSWORD: "" }, { fetch: fetcher });
    await client.listResources();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("supports complete legacy account settings without exposing them", async () => {
    const paths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname; paths.push(path);
      return path === "/api/auth/authenticate"
        ? Response.json({ success: true, status: 200, data: { token: "test-issued-token" } }) : page();
    });
    await checkKolRuntimeConnection({ ...env, PUBLISHER_KOL_ACCESS_TOKEN: undefined,
      KOL_API_KEY: "test-api", KOL_MOBILE: "test-mobile", KOL_PASSWORD: "test-password",
      KOL_IDENTITY: "advertiser", KOL_CAPTCHA: "test-captcha", KOL_CAPTCHA_TOKEN: "test-captcha-token" }, { fetch: fetcher });
    expect(paths).toEqual(["/api/auth/authenticate", "/api/news_resource_2/data"]);
  });

  it("preserves send switches rather than enabling publication in a new route", async () => {
    const fetcher = vi.fn();
    const client = createKolRuntimeClient({ ...env, PUBLISHER_PUBLISH_ENABLED: "false" }, { fetch: fetcher });
    await expect(client.createOrder({ resourceId: 1, title: "test", html: "<p>test</p>" }))
      .rejects.toMatchObject({ code: "publishing_disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
