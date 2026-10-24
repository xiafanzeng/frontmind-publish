import { describe, expect, it } from "vitest";
import { PublisherGatewayError, type PublisherGateway } from "./gateway";
import type { PublicationBatch, PublicationPreflight } from "./types";
import { reviewBatchTotals, submitReviewBatch, type ReviewBatchProgress } from "./reviewBatch";

const preflight = (id: string, amount = "100", available = "1000"): PublicationPreflight => ({
  revision: `token-${id}`, draftRevision: 1, quoteFingerprint: `quote-${id}`,
  mode: "mock", expiresAt: "2027-01-01T00:00:00Z", catalogRevision: "catalog",
  article: { id, title: id, version: 1, versionId: `v-${id}`, hash: id, wordCount: 1, imageCount: 0, bodyHtml: "<p>正文</p>", images: [] },
  items: [{ media: { id: "shared", name: "相同媒体", kind: "news" }, title: `${id} 标题`, priceTenThousandths: amount, blockers: [], warnings: [], checks: [] }],
  totalTenThousandths: amount, wallet: {availableTenThousandths: available},
  availableAfterTenThousandths: (BigInt(available) - BigInt(amount)).toString(), blockers: [], warnings: [], gates: [],
} as unknown as PublicationPreflight);
const batch = (id: string): PublicationBatch => ({ id: `batch-${id}`, totalTenThousandths: "100", itemCount: 1, items: [] } as unknown as PublicationBatch);
const progress = (): ReviewBatchProgress => ({ accepted: {}, requests: {} });

describe("batch review", () => {
  it("counts manuscript-media combinations separately and never adds account balances", () => {
    const result = reviewBatchTotals([preflight("a", "100", "1000"), preflight("b", "200", "900")]);
    expect(result.passedCount).toBe(2);
    expect(result.news.amount).toBe(300n);
    expect(result.publishTotal).toBe(300n);
    expect(result.available).toBe(900n);
  });

  it("refreshes the next wallet snapshot, retains accepted results and retries only pending drafts", async () => {
    const events: string[] = [];
    let fails = true;
    const state = progress();
    const gateway = {
      preflightDraft: async (id: string) => { events.push(`preflight:${id}`); return preflight(id, "100", state.accepted.a ? "900" : "1000"); },
      submitDraft: async ({draftId}: {draftId:string}) => {
        events.push(`submit:${draftId}`);
        if (draftId === "b" && fails) throw new PublisherGatewayError("目录已变化", "conflict");
        return batch(draftId);
      },
    } as unknown as PublisherGateway;
    const groups = ["a", "b", "c"].map(draftId => ({ draftId, preflight: preflight(draftId) }));
    await expect(submitReviewBatch({gateway, groups, progress: state})).rejects.toThrow("目录已变化");
    expect(Object.keys(state.accepted)).toEqual(["a"]);
    expect(events).toEqual(["preflight:a", "submit:a", "preflight:b", "submit:b"]);
    fails = false;
    await submitReviewBatch({gateway, groups, progress: state});
    expect(Object.keys(state.accepted)).toEqual(["a", "b", "c"]);
    expect(events.filter(event => event === "submit:a")).toHaveLength(1);
  });

  it("replays an unknown submission with exactly the original request before continuing", async () => {
    const state = progress();
    const requests: unknown[] = [];
    let unavailable = true;
    const gateway = {
      preflightDraft: async (id: string) => preflight(id),
      submitDraft: async (request: {draftId:string}) => {
        requests.push(request);
        if (unavailable) throw new PublisherGatewayError("连接中断", "unavailable");
        return batch(request.draftId);
      },
    } as unknown as PublisherGateway;
    const groups = ["a", "b"].map(draftId => ({ draftId, preflight: preflight(draftId) }));
    await expect(submitReviewBatch({gateway, groups, progress: state})).rejects.toThrow("连接中断");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(state.requests.a).toEqual(requests[0]);
    unavailable = false;
    await submitReviewBatch({gateway, groups, progress: state});
    expect(requests[2]).toEqual(requests[0]);
    expect(Object.keys(state.accepted)).toEqual(["a", "b"]);
  });

  it("rejects aggregate insufficient balance before submitting any draft", async () => {
    let submissions = 0;
    const gateway = {
      preflightDraft: async (id: string) => preflight(id, "100", "150"),
      submitDraft: async () => { submissions++; return batch("a"); },
    } as unknown as PublisherGateway;
    const groups = ["a", "b"].map(draftId => ({draftId, preflight: preflight(draftId, "100", "150")}));
    await expect(submitReviewBatch({gateway, groups, progress: progress()})).rejects.toThrow(/余额/);
    expect(submissions).toBe(0);
  });

  it("does not silently publish a newly changed title or price", async () => {
    let submissions = 0;
    const gateway = {
      preflightDraft: async () => ({...preflight("a", "200"), quoteFingerprint: "changed"}),
      submitDraft: async () => { submissions++; return batch("a"); },
    } as unknown as PublisherGateway;
    await expect(submitReviewBatch({gateway, groups:[{draftId:"a", preflight:preflight("a")}], progress:progress()})).rejects.toThrow(/变化/);
    expect(submissions).toBe(0);
  });

  it("narrows only the failing media and submits the new exact preflight token", async () => {
    const approved = preflight("a");
    approved.items.push({...approved.items[0]!, media:{...approved.items[0]!.media,id:"blocked"}, blockers:["不支持图片"]});
    approved.totalTenThousandths = "200";
    let narrowed = false;
    let submitted: unknown;
    const gateway = {
      preflightDraft: async () => narrowed ? {...preflight("a"), revision:"narrow-token", draftRevision:2, quoteFingerprint:"narrow-quote"} : approved,
      updateDraftMedia: async (_id:string, mediaIds:string[], revision:number) => {
        expect(mediaIds).toEqual(["shared"]);
        expect(revision).toBe(1);
        narrowed = true;
        return {revision:2};
      },
      submitDraft: async (request: unknown) => {submitted=request; return batch("a");},
    } as unknown as PublisherGateway;
    await submitReviewBatch({gateway, groups:[{draftId:"a",preflight:approved}], progress:progress()});
    expect(submitted).toMatchObject({draftId:"a",preflightRevision:"narrow-token",quoteFingerprint:"narrow-quote",idempotencyKey:"publisher-submit:a:narrow-quote"});
  });

  it("retains an accepted batch with unknown delivery and stops following manuscripts", async () => {
    const state = progress();
    const submissions: string[] = [];
    const gateway = {
      preflightDraft: async (id:string) => preflight(id),
      submitDraft: async ({draftId}:{draftId:string}) => {
        submissions.push(draftId);
        return {...batch(draftId),articleTitle:draftId,unknownCount:1};
      },
    } as unknown as PublisherGateway;
    const groups=["a","b"].map(draftId=>({draftId,preflight:preflight(draftId)}));
    await expect(submitReviewBatch({gateway,groups,progress:state})).rejects.toThrow(/待核实/);
    expect(state.accepted.a.id).toBe("batch-a");
    expect(submissions).toEqual(["a"]);
    await expect(submitReviewBatch({gateway,groups,progress:state})).rejects.toThrow(/待核实/);
    expect(submissions).toEqual(["a"]);
  });
});
