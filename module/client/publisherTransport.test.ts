import { createTRPCUntypedClient } from "@trpc/client";
import { describe, expect, it } from "vitest";
import type { createPublishRoutes } from "../server/routes";
import { createPublisherTransportLink, isPublisherCatalogRead } from "./publisherTransport";

type PublisherRouter = ReturnType<typeof createPublishRoutes>["publisherRouter"];

describe("publisher catalogue transport", () => {
  it("splits only catalog read procedures, for mounted and module router paths", () => {
    for (const path of ["publisher.media.list", "publisher.media.facets", "media.list", "media.facets"])
      expect(isPublisherCatalogRead({ type: "query", path })).toBe(true);
    for (const path of ["publisher.articles.list", "publisher.media.sync", "other.media.list"])
      expect(isPublisherCatalogRead({ type: "query", path })).toBe(false);
    expect(isPublisherCatalogRead({ type: "mutation", path: "publisher.media.list" })).toBe(false);
  });

  it("lets the list resolve while facets/articles are pending and keeps other queries batched", async () => {
    let releaseFacets!: (response: Response) => void;
    let releaseArticles!: (response: Response) => void;
    const facetsResponse = new Promise<Response>((resolve) => { releaseFacets = resolve; });
    const articlesResponse = new Promise<Response>((resolve) => { releaseArticles = resolve; });
    const requests: Array<{ url: URL; options?: RequestInit }> = [];
    const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    const fetchImpl: typeof fetch = async (input, options) => {
      const url = new URL(String(input));
      requests.push({ url, options });
      if (url.pathname.endsWith("publisher.media.facets")) return facetsResponse;
      if (url.pathname.endsWith("publisher.media.list")) return response({ result: { data: "list-ready" } });
      return articlesResponse;
    };
    const client = createTRPCUntypedClient<PublisherRouter>({ links: [createPublisherTransportLink<PublisherRouter>({
      url: "https://example.test/api/trpc", fetch: fetchImpl,
      headers: ({ opList }) => ({ "x-test-scope": "workspace-a", "x-test-paths": opList.map(({ path }) => path).join(",") }),
    })] });
    const list = client.query("publisher.media.list");
    const facets = client.query("publisher.media.facets");
    const articles = client.query("publisher.articles.list");
    const industries = client.query("publisher.industries");
    await expect(list).resolves.toBe("list-ready");
    releaseFacets(response({ result: { data: "facets-ready" } }));
    await expect(facets).resolves.toBe("facets-ready");
    releaseArticles(response([{ result: { data: "articles-ready" } }, { result: { data: "industries-ready" } }]));
    await expect(Promise.all([articles, industries])).resolves.toEqual(["articles-ready", "industries-ready"]);
    expect(requests).toHaveLength(3);
    expect(requests.filter(({ url }) => url.searchParams.get("batch") === "1")).toHaveLength(1);
    for (const request of requests) expect(new Headers(request.options?.headers).get("x-test-scope")).toBe("workspace-a");
    expect(requests.map(({ options }) => new Headers(options?.headers).get("x-test-paths"))).toEqual(expect.arrayContaining([
      "publisher.media.list", "publisher.media.facets", "publisher.articles.list,publisher.industries",
    ]));
  });
});
