// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { KolClient } from "./client";

const credentials = {
  apiKey: "test-api-key",
  mobile: "test-mobile",
  password: "test-password",
  identity: "advertiser",
  captcha: "test-captcha",
  captchaToken: "test-captcha-token",
};
const page = () =>
  Response.json({
    success: true,
    status: 200,
    data: [],
    pagination: { current_page: 1, last_page: 1, per_page: 50, total: 0 },
  });
const token = () =>
  Response.json({
    success: true,
    status: 200,
    data: { token: "test-refreshed-token" },
  });
const accepted = () => Response.json({ success: true, status: 200, response_data: [
  { order_id: "test-order", resource_id: 1, resource_name: "测试媒体" },
] });
const order = { resourceId: 1, title: "测试订单", html: "<p>仅测试</p>" };
function subject(
  responses: (() => Response)[],
  options: Partial<ConstructorParameters<typeof KolClient>[0]> = {},
) {
  const calls: { method: string; path: string; token: string | null }[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        token:
          url.searchParams.get("token") ??
          new Headers(init?.headers).get("authorization"),
      });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected network request in test");
      return response();
    },
  );
  const client = new KolClient({
    baseUrl: "https://api.kol.test",
    mode: "live",
    accessToken: "test-supplied-token",
    ...credentials,
    maxGetAttempts: 1,
    realEnabled: true,
    publishEnabled: true,
    createOrderEncoding: "form",
    ...options,
    fetch: fetchImpl,
  });
  return { client, calls, fetchImpl };
}

describe("KOL explicit token plus account refresh", () => {
  it("reuses a supplied token without login, even when its local JWT expiry is old", async () => {
    const expiredToken = `test.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.test`;
    const { client, calls } = subject([page, page], {
      accessToken: expiredToken,
    });
    await client.listResources();
    await client.listResources();
    expect(calls).toHaveLength(2);
    expect(
      calls.every(
        (call) => call.method === "GET" && call.token === expiredToken,
      ),
    ).toBe(true);
  });
  it.each([401, 200])(
    "refreshes once after a safe GET reports 401 with HTTP %s",
    async (httpStatus) => {
      const { client, calls, fetchImpl } = subject([
        () =>
          Response.json(
            { success: false, status: 401 },
            { status: httpStatus },
          ),
        token,
        page,
        () => Response.json({ success: true, status: 200, data: [] }),
      ]);
      await client.listResources();
      await client.listOrders();
      expect(calls).toEqual([
        {
          method: "GET",
          path: "/api/news_resource_2/data",
          token: "test-supplied-token",
        },
        { method: "POST", path: "/api/auth/authenticate", token: null },
        {
          method: "GET",
          path: "/api/news_resource_2/data",
          token: "test-refreshed-token",
        },
        {
          method: "GET",
          path: "/api/news_order",
          token: "Bearer test-refreshed-token",
        },
      ]);
      expect(
        Object.fromEntries(
          new URLSearchParams(
            fetchImpl.mock.calls[1]![1]!.body as URLSearchParams,
          ),
        ),
      ).toEqual({
        mobile: credentials.mobile,
        password: credentials.password,
        api_key: credentials.apiKey,
        identity: credentials.identity,
        captcha: credentials.captcha,
        captcha_token: credentials.captchaToken,
      });
    },
  );
  it("refreshes on an actual HTTP 401 even without a JSON error envelope", async () => {
    const { client, calls } = subject([
      () => new Response("Unauthorized", { status: 401 }),
      token,
      page,
    ]);
    await client.listResources();
    expect(calls.map((call) => call.path)).toEqual([
      "/api/news_resource_2/data",
      "/api/auth/authenticate",
      "/api/news_resource_2/data",
    ]);
  });
  it("does not log in for a forbidden 403 response", async () => {
    const { client, calls } = subject([
      () => Response.json({ status: 403 }, { status: 403 }),
    ]);
    await expect(client.listResources()).rejects.toMatchObject({
      code: "authentication_blocked",
    });
    expect(calls).toHaveLength(1);
  });
  it("fails closed when only a token or incomplete login credentials are configured", async () => {
    for (const extra of [
      { apiKey: undefined },
      {
        apiKey: undefined,
        mobile: undefined,
        password: undefined,
        identity: undefined,
        captcha: undefined,
        captchaToken: undefined,
      },
    ]) {
      const { client, calls } = subject(
        [() => Response.json({ status: 401 }, { status: 401 })],
        extra,
      );
      await expect(client.listResources()).rejects.toMatchObject({
        code: "authentication_blocked",
      });
      await expect(client.listResources()).rejects.toMatchObject({
        code: "authentication_blocked",
      });
      expect(calls).toHaveLength(1);
    }
  });
  it("stops after one refresh if the renewed token is also rejected", async () => {
    const rejected = () => Response.json({ status: 401 }, { status: 401 });
    const { client, calls } = subject([rejected, token, rejected]);
    await expect(client.listResources()).rejects.toMatchObject({
      code: "authentication_blocked",
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/news_resource_2/data",
      "/api/auth/authenticate",
      "/api/news_resource_2/data",
    ]);
  });
  it.each([401, 403])("never refreshes or repeats a non-idempotent order POST after a %s", async status => {
    const { client, calls } = subject([
      page,
      () => Response.json({ status }, { status }),
    ]);
    await expect(client.createOrder(order)).rejects.toMatchObject({
      code: "submission_unknown",
      submissionMayHaveSucceeded: true,
      details: { httpStatus: status, submissionPhase: "after_send" },
    });
    await expect(client.createOrder(order)).rejects.toMatchObject({
      code: "authentication_blocked",
      submissionMayHaveSucceeded: false,
      details: { operation: "create_order_preflight", submissionPhase: "before_send" },
    });
    expect(calls).toEqual([
      { method: "GET", path: "/api/news_order", token: "Bearer test-supplied-token" },
      { method: "POST", path: "/api/news_order", token: null },
    ]);
  });
  it("recovers a blocked credential through a separate read-only check before a new explicit order", async () => {
    const { client, calls } = subject([
      page,
      () => Response.json({ status: 401 }, { status: 401 }),
      token,
      page,
      page,
      accepted,
    ]);
    await expect(client.createOrder(order)).rejects.toMatchObject({ code: "submission_unknown" });
    await expect(client.createOrder(order)).rejects.toMatchObject({ code: "authentication_blocked", submissionMayHaveSucceeded: false });
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual(["GET /api/news_order", "POST /api/news_order"]);
    await client.listOrders({ page: 1 });
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual([
      "GET /api/news_order", "POST /api/news_order", "POST /api/auth/authenticate", "GET /api/news_order",
    ]);
    // Recovery never submits an order. Only this subsequent explicit call can.
    await expect(client.createOrder({ ...order, title: "用户明确创建的新订单" })).resolves.toMatchObject({ orderId: "test-order" });
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual([
      "GET /api/news_order", "POST /api/news_order", "POST /api/auth/authenticate", "GET /api/news_order",
      "GET /api/news_order", "POST /api/news_order",
    ]);
  });
  it.each([401, 200])("refreshes a rejected credential on the safe order preflight with HTTP %s", async status => {
    const { client, calls, fetchImpl } = subject([
      () => Response.json({ status: 401 }, { status }),
      token,
      page,
      accepted,
    ]);
    await expect(client.createOrder(order)).resolves.toMatchObject({ orderId: "test-order" });
    expect(calls).toEqual([
      { method: "GET", path: "/api/news_order", token: "Bearer test-supplied-token" },
      { method: "POST", path: "/api/auth/authenticate", token: null },
      { method: "GET", path: "/api/news_order", token: "Bearer test-refreshed-token" },
      { method: "POST", path: "/api/news_order", token: null },
    ]);
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams.get("page")).toBe("1");
    expect(new URLSearchParams(String(fetchImpl.mock.calls[3]![1]!.body)).get("token"))
      .toBe("test-refreshed-token");
  });
  it.each([401, 403])("does not submit with a rejected token-only credential (%s)", async status => {
    const { client, calls } = subject([
      () => Response.json({ status }, { status }),
    ], { apiKey: undefined });
    await expect(client.createOrder(order)).rejects.toMatchObject({
      code: "authentication_blocked",
      submissionMayHaveSucceeded: false,
      details: { operation: "create_order_preflight", httpStatus: status, submissionPhase: "before_send" },
    });
    expect(calls.map(call => call.method)).toEqual(["GET"]);
  });
  it("does not log in or submit after a forbidden preflight", async () => {
    const { client, calls } = subject([
      () => new Response("Forbidden", { status: 403 }),
    ]);
    await expect(client.createOrder(order)).rejects.toMatchObject({
      code: "authentication_blocked",
      submissionMayHaveSucceeded: false,
      details: { operation: "create_order_preflight", httpStatus: 403, submissionPhase: "before_send" },
    });
    expect(calls.map(call => call.method)).toEqual(["GET"]);
  });
  it("stops before the order POST when the only permitted login refresh fails", async () => {
    const { client, calls } = subject([
      () => Response.json({ status: 401 }, { status: 401 }),
      () => Response.json({ status: 401 }, { status: 401 }),
    ]);
    await expect(client.createOrder(order)).rejects.toMatchObject({
      code: "authentication_failed",
      submissionMayHaveSucceeded: false,
      details: { operation: "create_order_preflight", submissionPhase: "before_send" },
    });
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual([
      "GET /api/news_order", "POST /api/auth/authenticate",
    ]);
  });
  it("does not repeat login or submit when the refreshed preflight token is rejected", async () => {
    const rejected = () => Response.json({ status: 401 }, { status: 401 });
    const { client, calls } = subject([rejected, token, rejected]);
    await expect(client.createOrder(order)).rejects.toMatchObject({
      code: "authentication_blocked",
      submissionMayHaveSucceeded: false,
      details: { operation: "create_order_preflight", submissionPhase: "before_send" },
    });
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual([
      "GET /api/news_order", "POST /api/auth/authenticate", "GET /api/news_order",
    ]);
  });
  it.each([
    { response: () => { throw new TypeError("network interrupted"); }, code: "upstream_unavailable" },
    { response: () => new Response("{incomplete"), code: "invalid_response" },
    { response: () => Response.json({ success: true, status: 200, data: "wrong shape" }), code: "invalid_response" },
    { response: () => Response.json({ status: 503 }, { status: 503 }), code: "upstream_unavailable" },
  ])("records preflight $code before any order POST", async ({ response, code }) => {
    const { client, calls } = subject([response]);
    const failure = await client.createOrder(order).catch(error => error);
    expect(failure).toMatchObject({
      code,
      submissionMayHaveSucceeded: false,
      details: { operation: "create_order_preflight", submissionPhase: "before_send" },
    });
    expect(JSON.stringify(failure.details)).not.toContain("test-supplied-token");
    expect(JSON.stringify(failure.details)).not.toContain(order.html);
    expect(calls.map(call => call.method)).toEqual(["GET"]);
  });
  it("honors an already aborted submission before any HTTP", async () => {
    const { client, calls } = subject([]);
    await expect(client.createOrder(order, AbortSignal.abort())).rejects.toMatchObject({
      submissionMayHaveSucceeded: false,
      details: { operation: "create_order_preflight", submissionPhase: "before_send" },
    });
    expect(calls).toEqual([]);
  });
  it("honors a cancellation after the safe preflight before the order POST", async () => {
    const controller = new AbortController();
    const { client, calls } = subject([() => { controller.abort(); return page(); }]);
    await expect(client.createOrder(order, controller.signal)).rejects.toMatchObject({
      submissionMayHaveSucceeded: false,
      details: { operation: "create_order_preflight", submissionPhase: "before_send" },
    });
    expect(calls.map(call => call.method)).toEqual(["GET"]);
  });
  it("logs in only once before the safe preflight and order in account-only mode", async () => {
    const { client, calls } = subject([token, page, accepted], { accessToken: undefined });
    await expect(client.createOrder(order)).resolves.toMatchObject({ orderId: "test-order" });
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual([
      "POST /api/auth/authenticate", "GET /api/news_order", "POST /api/news_order",
    ]);
  });
  it("retains the existing account-only login path", async () => {
    const { client, calls } = subject([token, page], {
      accessToken: undefined,
    });
    await client.listResources();
    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/authenticate",
      "/api/news_resource_2/data",
    ]);
  });
});
