// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createServerBackedPublisherGateway, type PublisherTrpcClient } from "./ProductionPublishingEntry";

// Exercise the real gateway pagination without importing UI routing.
vi.mock("./PublishingRoutes", () => ({ default: () => null }));

const timestamp = "2026-10-27T00:00:00.000Z";
const summary = (page: number) => ({
  id: `article-${page}`, workingName: `稿件 ${page}`, suggestedTitle: `稿件 ${page}`,
  status: "ready", currentVersion: 0, containsImages: false, revision: 1,
  createdAt: timestamp, updatedAt: timestamp,
});
type ListResult = { items: ReturnType<typeof summary>[]; nextCursor: string | null };
type ListQuery = (input: { limit: number; cursor?: string }, options?: { signal?: AbortSignal }) => Promise<ListResult>;

function setup(query: ListQuery) {
  const list = vi.fn<ListQuery>(query);
  const client = { publisher: { articles: { list: { query: list } } } } as unknown as PublisherTrpcClient;
  return { gateway: createServerBackedPublisherGateway(client), list };
}

describe("complete article library pagination", () => {
  it("reads past twenty pages until the server has no next cursor", async () => {
    const { gateway, list } = setup(async input => {
      const page = input.cursor ? Number(input.cursor.replace("cursor-", "")) : 0;
      return { items: [summary(page)], nextCursor: page < 24 ? `cursor-${page + 1}` : null };
    });
    const controller = new AbortController();
    const result = await gateway.listArticles(controller.signal);
    expect(result).toHaveLength(25);
    expect(new Set(result.map(article => article.id))).toEqual(new Set(Array.from({ length: 25 }, (_, page) => `article-${page}`)));
    expect(list).toHaveBeenCalledTimes(25);
    expect(list.mock.calls[24]?.[0]).toEqual({ limit: 100, cursor: "cursor-24" });
    expect(list.mock.calls.every(call => call[1]?.signal === controller.signal)).toBe(true);
  });

  it.each([
    { cursors: ["cursor-a", "cursor-a"] },
    { cursors: ["cursor-a", "cursor-b", "cursor-a"] },
  ])("rejects repeated cursor sequences instead of returning a partial library: $cursors", async ({ cursors }) => {
    let page = 0;
    const { gateway, list } = setup(async () => {
      const current = page++;
      return { items: [summary(current)], nextCursor: cursors[current] ?? null };
    });
    await expect(gateway.listArticles()).rejects.toMatchObject({
      name: "PublisherGatewayError", code: "unavailable",
      message: "稿件列表分页游标重复，请重试读取完整列表。",
    });
    expect(list).toHaveBeenCalledTimes(cursors.length);
  });

  it("does not start a page query after cancellation", async () => {
    const { gateway, list } = setup(async () => ({ items: [summary(0)], nextCursor: null }));
    const controller = new AbortController();
    controller.abort();
    await expect(gateway.listArticles(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects a late page after abort and never returns already accumulated rows", async () => {
    let resolvePage!: (result: ListResult) => void;
    const pendingPage = new Promise<ListResult>(resolve => { resolvePage = resolve; });
    const { gateway, list } = setup(async input => input.cursor
      ? pendingPage
      : { items: [summary(0)], nextCursor: "cursor-1" });
    const controller = new AbortController();
    const request = gateway.listArticles(controller.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    controller.abort();
    // The mock deliberately ignores AbortSignal, as a late transport may do.
    resolvePage({ items: [summary(1)], nextCursor: "cursor-2" });
    await rejection;
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
  });
});
