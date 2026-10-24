// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { KolClient } from "./client";

describe("provider form submission contract: all HTTP is intercepted", () => {
  const input = { resourceId: 42, title: "A&B + 中文", html: "<p>只发送一次 & 不切换编码</p>" };
  const options = { baseUrl: "https://api.kol.cn", accessToken: "test-only-token", mode: "live" as const, realEnabled: true, publishEnabled: true };
  const preflight = () => Response.json({ success: true, status: 200, data: [] });
  it("uses the default form encoding and returns the matching order id", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, request?: RequestInit) => {
      if (request?.method === "GET") {
        expect(new URL(String(url)).searchParams.get("page")).toBe("1");
        expect(new Headers(request.headers).get("authorization")).toBe("Bearer test-only-token");
        return preflight();
      }
      expect(request?.method).toBe("POST");
      expect(new Headers(request?.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
      expect(new Headers(request?.headers).get("user-agent")).toBe("frontmind-publisher-worker/0.1");
      expect(Object.fromEntries(new URLSearchParams(String(request?.body)))).toEqual({ token: "test-only-token", title: input.title, content: input.html, resource_id: "42" });
      expect(request?.redirect).toBe("error");
      return Response.json({ success: true, status: 200, response_data: [{ order_id: "confirmed-order", resource_id: 42, resource_name: "媒体甲" }] });
    });
    const result = await new KolClient({ ...options, fetch: fetcher }).createOrder(input);
    expect(result.orderId).toBe("confirmed-order");
    expect(fetcher.mock.calls.map(([, request]) => request?.method)).toEqual(["GET", "POST"]);
  });
  it.each([401, 403, 429, 500])("does not retry or fall back encoding when POST returns %i", async status => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, request?: RequestInit) => request?.method === "GET"
      ? preflight() : Response.json({ success: false, status }, { status }));
    await expect(new KolClient({ ...options, fetch: fetcher }).createOrder(input)).rejects.toMatchObject({
      name: "KolSubmissionUnknownError",
      submissionMayHaveSucceeded: true,
      details: { operation: "create_order", submissionPhase: "after_send" },
    });
    expect(fetcher.mock.calls.map(([, request]) => request?.method)).toEqual(["GET", "POST"]);
  });
  it("does not resend a timed-out order and honors an explicitly unknown encoding before HTTP", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, request?: RequestInit) => {
      if (request?.method === "GET") return preflight();
      throw new TypeError("network lost after send");
    });
    await expect(new KolClient({ ...options, fetch: fetcher }).createOrder(input)).rejects.toMatchObject({ name: "KolSubmissionUnknownError" });
    expect(fetcher.mock.calls.map(([, request]) => request?.method)).toEqual(["GET", "POST"]);
    fetcher.mockClear();
    await expect(new KolClient({ ...options, createOrderEncoding: "unknown", fetch: fetcher }).createOrder(input)).rejects.toMatchObject({ code: "invalid_configuration" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403])("retains HTTP %s evidence when the order POST rejection has no JSON body", async status => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, request?: RequestInit) => request?.method === "GET"
      ? preflight() : new Response("<html>Unauthorized</html>", { status }));
    await expect(new KolClient({ ...options, fetch: fetcher }).createOrder(input)).rejects.toMatchObject({
      code: "submission_unknown",
      submissionMayHaveSucceeded: true,
      details: { operation: "create_order", httpStatus: status, submissionPhase: "after_send" },
    });
    expect(fetcher.mock.calls.map(([, request]) => request?.method)).toEqual(["GET", "POST"]);
  });
  it.each([
    () => Response.json({ success: true, status: 200, response_data: [] }),
    () => Response.json({ success: true, status: 200, response_data: [{ order_id: "wrong-resource", resource_id: 99, resource_name: "媒体乙" }] }),
    () => new Response("<html>response lost</html>"),
  ])("retains unknown after an ambiguous POST despite an empty preflight page", async response => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, request?: RequestInit) => request?.method === "GET"
      ? preflight() : response());
    await expect(new KolClient({ ...options, fetch: fetcher }).createOrder(input)).rejects.toMatchObject({
      code: "submission_unknown",
      submissionMayHaveSucceeded: true,
      details: { submissionPhase: "after_send" },
    });
    expect(fetcher.mock.calls.map(([, request]) => request?.method)).toEqual(["GET", "POST"]);
  });
  it("queries the accepted order using its id and the same authenticated User-Agent", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, request?: RequestInit) => {
      const endpoint = new URL(String(url));
      expect(endpoint.pathname).toBe("/api/news_order");
      expect(endpoint.searchParams.get("order_id")).toBe("confirmed-order");
      expect(request?.method).toBe("GET");
      expect(new Headers(request?.headers).get("authorization")).toBe("Bearer test-only-token");
      expect(new Headers(request?.headers).get("user-agent")).toBe("frontmind-publisher-worker/0.1");
      return Response.json({ success: true, status: 200, data: [{ id: 9, order_id: "confirmed-order", resource_id: 42,
        status: 1, response_message: "https://media.test/article/9", title: input.title }] });
    });
    expect(await new KolClient({ ...options, fetch: fetcher }).getOrderByOrderId("confirmed-order"))
      .toMatchObject({ orderId: "confirmed-order", status: "success", publishedUrl: "https://media.test/article/9" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

