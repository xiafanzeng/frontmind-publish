import { afterEach, describe, expect, it, vi } from "vitest";
import { unavailablePublishingProvider } from "./unavailable.js";

afterEach(() => vi.unstubAllGlobals());

describe("unconfigured publishing provider", () => {
  it.each(["mock", "test", "live"] as const)("rejects all operations without network in %s mode", async (mode) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = unavailablePublishingProvider(mode);
    expect(provider.mode).toBe(mode);
    const operations = [
      () => provider.listResources(),
      () => provider.listOrders(),
      () => provider.getOrderByOrderId("synthetic-order"),
      () => provider.createOrder({ resourceId: 1, title: "Synthetic title", html: "<p>Test</p>" }),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toThrow("Media publishing provider is not configured");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
