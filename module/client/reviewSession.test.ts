import { expect, it } from "vitest";
import type { PublisherGateway } from "./gateway";
import type { PublicationBatch, PublisherSubmitInput } from "./types";
import { clearResolvedReviewRequests, hasProtectedReviewDraft, mergeReviewSessionReceipts, restoreReviewSession, reviewSessions, type ReviewSession } from "./reviewSession";

const request: PublisherSubmitInput = {
  draftId:"b", preflightRevision:"original-revision", quoteFingerprint:"original-quote",
  acknowledged:true, idempotencyKey:"publisher-submit:b:original-quote",
};

it("retains the exact request when a cached batch is reopened as a subset or with different exclusions", () => {
  const gateway={} as PublisherGateway;
  reviewSessions.set(gateway,new Map([["scope-one:old-group",{
    progress:{accepted:{},requests:{b:request}},acceptedIds:{a:"accepted-a"},
  }]]));
  const restored=restoreReviewSession(gateway,"scope-one:",["b"],"");
  expect(restored.progress.requests.b).toBe(request);
  expect(restored.acceptedIds).toEqual({});
  expect(hasProtectedReviewDraft(gateway,["b"],"scope-one:")).toBe(true);
  expect(hasProtectedReviewDraft(gateway,["b"],"scope-two:")).toBe(false);
});

it("recovers persisted receipts by draft identity across group keys and ignores malformed requests", () => {
  const gateway={} as PublisherGateway;
  const selections={
    "publishingBatchReview:a,b":JSON.stringify({acceptedBatchIds:{a:"accepted-a"},requests:{b:request}}),
    "publishingBatchReview:broken":"not-json",
    "publishingBatchReview:c":JSON.stringify({requests:{c:{...request,draftId:"c"}}}),
  };
  const restored=restoreReviewSession(gateway,"scope:",["b","c"],"",selections);
  expect(restored.progress.requests).toEqual({b:request});
  expect(restored.acceptedIds).toEqual({});
});

it("keeps a confirmed acceptance ahead of an older persisted unknown request", () => {
  const gateway={} as PublisherGateway;
  const accepted={id:"accepted-b"} as PublicationBatch;
  reviewSessions.set(gateway,new Map([["scope:original",{
    progress:{accepted:{b:accepted},requests:{}},acceptedIds:{b:"accepted-b"},
  }]]));
  const restored=restoreReviewSession(gateway,"scope:",["b"],JSON.stringify({requests:{b:request}}));
  expect(restored.acceptedIds.b).toBe("accepted-b");
  expect(restored.progress.accepted.b).toBe(accepted);
  expect(restored.progress.requests.b).toBeUndefined();
});

it("merges newer subset receipts into an already cached group without replacing its mutable session", () => {
  const gateway={} as PublisherGateway;
  const original:ReviewSession={progress:{accepted:{},requests:{}},acceptedIds:{}};
  reviewSessions.set(gateway,new Map([
    ["scope:original",original],
    ["scope:subset",{progress:{accepted:{},requests:{b:request}},acceptedIds:{}}],
  ]));
  const restored=restoreReviewSession(gateway,"scope:",["a","b"],"");
  expect(mergeReviewSessionReceipts(original,restored,["a","b"])).toBe(original);
  expect(original.progress.requests.b).toBe(request);
});

it("does not resurrect an exactly resolved request from an older group and leaves other requests intact", () => {
  const gateway={} as PublisherGateway;
  const other={...request,quoteFingerprint:"new-quote",idempotencyKey:"publisher-submit:b:new-quote"};
  const original:ReviewSession={progress:{accepted:{},requests:{b:request}},acceptedIds:{}};
  const unrelated:ReviewSession={progress:{accepted:{},requests:{b:request}},acceptedIds:{}};
  reviewSessions.set(gateway,new Map([["scope:original",original],["other-scope:original",unrelated]]));
  const selections={
    "publishingBatchReview:a,b":JSON.stringify({acceptedBatchIds:{a:"accepted-a"},requests:{b:request}}),
    "publishingBatchReview:b":JSON.stringify({requests:{b:other}}),
  };
  const updates=clearResolvedReviewRequests(gateway,"scope:",{b:request.idempotencyKey},selections);
  expect(original.progress.requests.b).toBeUndefined();
  expect(unrelated.progress.requests.b).toBe(request);
  expect(JSON.parse(updates["publishingBatchReview:a,b"]!)).toEqual({acceptedBatchIds:{a:"accepted-a"},requests:{}});
  expect(updates["publishingBatchReview:b"]).toBeUndefined();
  const restored=restoreReviewSession(gateway,"scope:",["b"],"",{...selections,...updates});
  expect(restored.progress.requests.b).toEqual(other);
});
