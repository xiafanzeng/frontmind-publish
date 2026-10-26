import {resolvePublisherQuote} from './publisher-source-matrix-catalog.js';
import { eq } from "drizzle-orm";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { createPublishSchema } from "../schema/index.js";
import type { PublishApiCore, PublishDatabase } from "./persistence-core.js";
import {
  publisherImageCapabilityEvidenceBlocker,
  publisherImageCompatibilityBlocker,
} from "./publisher-capability.js";
import { createPublishingPersistence } from "./publisher-repository.js";
import { createPublishWorkerPersistence } from "./publisher-worker-repository.js";

const now = new Date("2026-10-24T08:00:00Z");
const users = mysqlTable("image_rule_test_users", { id: varchar("id", { length: 36 }).primaryKey() });
const tables = createPublishSchema({ users, currentMonitoringEnterpriseProjectId: () => null });
type ImageSupport = "unknown" | "verified" | "unsupported" | null;
const validAsset = {
  isFrozen: true,
  publicCapabilityDigest: "a".repeat(64),
  publicCapabilityCreatedAt: now,
  mimeType: "image/png",
};

/** Only the database transport is replaced; these tests call the actual save and preflight methods. */
function fixture(options: {
  imageSupport?: ImageSupport;
  remark?: string;
  containsImages?: boolean;
  imagePublishEnabled?: boolean;
  imageCount?: number;
  mode?: "test" | "live";
} = {}) {
  const imageSupport = options.imageSupport === undefined ? "unknown" : options.imageSupport;
  const containsImages = options.containsImages ?? true;
  const resource = {
    id: "media-967", externalResourceId: "967", name: "博客园（可发GEO）", mediaKind: "news",
    isActive: true, priceTenThousandths: 10_000n, catalogRevision: "catalog-1", payloadHash: "payload-1",
    consecutiveMisses: 0, remark: options.remark ?? "", titleLimit: null, rawPayload: {},
    platform: null, taxonomy: null, mediaType: null,
  };
  const version = {
    id: "version-1", articleId: "article-1", ownerId: "owner-1", version: 1,
    containsImages, contentHash: "frozen-hash", plainText: "正文",
    canonicalHtml: "<p>正文</p>" + (containsImages
      ? Array.from({ length: options.imageCount ?? 1 }, (_, index) =>
          `<img data-asset-id="asset-${index}" src="https://assets.example.test/${index}.png">`).join("")
      : ""),
  };
  const draftItem = {
    id: "draft-item-1", mediaResourceId: resource.id, submissionTitle: "稿件标题",
    selectedPriceTenThousandths: resource.priceTenThousandths, mediaKindSnapshot: "news",
    mediaSnapshot: { imageSupport: imageSupport ?? "unknown" },
  };
  const runtime = {
    mode: options.mode ?? "live", activeCatalogRevision: resource.catalogRevision, catalogSyncedAt: now,
    featureEnabled: true, publishEnabled: true, emergencyStop: false, credentialStatus: "healthy",
    catalogKindComplete: true, imagePublishEnabled: options.imagePublishEnabled ?? true,
  };
  const responses = new Map<unknown, unknown[] | Error>([
    [tables.publisherDrafts, [{ id: "draft-1", articleVersionId: version.id, revision: 1, status: "ready", titleMode: "single" }]],
    [tables.publisherArticleVersions, [version]],
    [tables.publisherArticles, [{ workingName: "含图稿件", suggestedTitle: "稿件标题" }]],
    [tables.publisherDraftItems, [{ draftItem, resource, imageSupport, capabilityEvidenceUrl: null, capabilityVerifiedAt: null }]],
    [tables.publisherMediaResources, [{ resource, imageSupport }]],
    [tables.publisherRuntimeState, [runtime]],
    [tables.publisherLiveWhitelist, [{ mediaResourceId: resource.id, imageAllowed: true }]],
    [tables.publisherArticleVersionAssets, [validAsset]],
  ]);
  const writes: Array<{ table: unknown; values: unknown }> = [];
  const tx = {
    select() {
      let result: unknown[] | Error = [];
      const query = {
        from(table: unknown) { result = responses.get(table) ?? []; return query; },
        where() { return query; },
        for() { return query; },
        limit() { return query; },
        innerJoin() { return query; },
        leftJoin() { return query; },
        orderBy() { return query; },
        then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
          return (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject);
        },
      };
      return query;
    },
    insert(table: unknown) {
      return { values(values: unknown) {
        writes.push({ table, values });
        return Object.assign(Promise.resolve(), { onDuplicateKeyUpdate: () => Promise.resolve() });
      } };
    },
    update(table: unknown) {
      return { set(values: unknown) { return { where() { writes.push({ table, values }); return Promise.resolve(); } }; } };
    },
  };
  const db = { transaction: async <T>(action: (transaction: typeof tx) => Promise<T>) => action(tx) } as unknown as PublishDatabase;
  const core = {
    tables,
    monitoringProjectOwnerPredicate: (table: { ownerId: typeof tables.publisherDrafts.ownerId }, ownerId: string) => eq(table.ownerId, ownerId),
    monitoringEnterpriseProjectIdForOwner: () => null,
    assertMonitoringEnterpriseProjectActive: async () => {},
    ensureWallet: async () => {},
    availableFunds: async () => 1_000_000n,
    settlePublisherItemMoney: async () => true,
    derivePublisherBatchFundsStatus: () => "reserved",
  } as unknown as PublishApiCore;
  const { PublishingRepository } = createPublishingPersistence(core);
  return { repository: new PublishingRepository(db), db, core, responses, writes, resource, version };
}

describe("unprovided image requirements in the real persistence path", () => {
  it.each<ImageSupport>(["unknown", null, "verified"])("allows %s in ordinary LIVE preflight without fabricating verification", async (imageSupport) => {
    const { repository } = fixture({ imageSupport });
    const result = await repository.preflightPublisherDraft("owner-1", "draft-1", 1, now);
    expect(result.items[0]?.blockers).toEqual([]);
    expect(result.items[0]?.imageSupport).toBe(imageSupport ?? "unknown");
  });

  it("does not reintroduce the unknown capability gate in TEST preflight", async () => {
    const { repository } = fixture({ mode: "test" });
    const result = await repository.preflightPublisherDraft("owner-1", "draft-1", 1, now);
    expect(result.items[0]?.blockers).toEqual([]);
  });

  it.each<ImageSupport>(["unknown", null])("keeps %s eligible through both worker guards before any provider request", async (imageSupport) => {
    const { core, db, responses, resource, version } = fixture({ imageSupport });
    responses.set(tables.publisherItems, [{
      item: {
        id: "item-1", ownerId: version.ownerId, status: "queued", articleContentHash: version.contentHash,
        mediaKindSnapshot: "news", externalResourceId: "967", submissionTitle: "稿件标题", attemptCount: 0,
        submissionKey: "submission-1",
      },
      batch: { id: "batch-1", ownerId: version.ownerId, mode: "live" },
      version,
      resource,
      snapshot: { catalogRevision: resource.catalogRevision, amountTenThousandths: resource.priceTenThousandths, providerPayloadHash: resource.payloadHash },
    }]);
    responses.set(tables.publisherMediaCapabilities, imageSupport === null ? [] : [{ imageSupport }]);
    responses.set(tables.publisherSubmissionGate, [{ id: "kol", nextAllowedAt: new Date(0) }]);
    const { PublisherWorkerRepository } = createPublishWorkerPersistence(core);
    const result = await new PublisherWorkerRepository(db).preparePublisherSubmission({
      itemId: "item-1", workerId: "worker-1", now, leaseExpiresAt: new Date(now.getTime() + 60_000), minimumIntervalMs: 100,
      runtime: { mode: "live", realEnabled: true, publishEnabled: true, imageEnabled: true },
    });
    expect(result.status).toBe("ready");
  });

  it("saves unknown capability without rewriting it to verified", async () => {
    const { repository, writes } = fixture();
    await repository.savePublisherDraft("owner-1", {
      articleVersionId: "version-1", expectedRevision: 0, titleMode: "single", sharedTitle: "稿件标题",
      items: [{ mediaResourceId: "media-967" }],
    });
    const inserted = writes.find((write) => write.table === tables.publisherDraftItems)?.values as Array<{ mediaSnapshot: { imageSupport: string } }>;
    expect(inserted[0]?.mediaSnapshot.imageSupport).toBe("unknown");
  });

  it("keeps an explicit unsupported capability blocked in save and preflight", async () => {
    const { repository } = fixture({ imageSupport: "unsupported" });
    await expect(repository.savePublisherDraft("owner-1", {
      articleVersionId: "version-1", expectedRevision: 0, items: [{ mediaResourceId: "media-967" }],
    })).rejects.toThrow("Media explicitly does not support images");
    const result = await repository.preflightPublisherDraft("owner-1", "draft-1", 1, now);
    expect(result.items[0]?.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: "IMAGE_UNSUPPORTED" })]));
  });

  it.each(["不支持图片", "仅限纯文字", "图片最多1张"])("enforces explicit %s against the frozen article", async (remark) => {
    const { repository } = fixture({ remark, imageCount: 2 });
    await expect(repository.savePublisherDraft("owner-1", {
      articleVersionId: "version-1", expectedRevision: 0, items: [{ mediaResourceId: "media-967" }],
    })).rejects.toThrow();
    const result = await repository.preflightPublisherDraft("owner-1", "draft-1", 1, now);
    expect(result.items[0]?.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: "IMAGE_RULE_VIOLATION" })]));
  });

  it("does not apply an image restriction to a text-only frozen article", async () => {
    const { repository } = fixture({ imageSupport: "unsupported", remark: "不支持图片", containsImages: false });
    const result = await repository.preflightPublisherDraft("owner-1", "draft-1", 1, now);
    expect(result.items[0]?.blockers).toEqual([]);
  });

  it("does not block text-only save or preflight on conflicting image-only remarks", async () => {
    const { repository } = fixture({ remark: "图片不限；不支持图片", containsImages: false });
    await expect(repository.savePublisherDraft("owner-1", {
      articleVersionId: "version-1", expectedRevision: 0, titleMode: "single", sharedTitle: "稿件标题",
      items: [{ mediaResourceId: "media-967" }],
    })).resolves.toBeDefined();
    const result = await repository.preflightPublisherDraft("owner-1", "draft-1", 1, now);
    expect(result.items[0]?.blockers).toEqual([]);
  });

  it("retains strict verification for LIVE_IMAGE_CANARY while the ordinary image gate is closed", async () => {
    const { repository } = fixture({ imagePublishEnabled: false });
    const result = await repository.preflightPublisherDraft("owner-1", "draft-1", 1, now);
    expect(result.items[0]?.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: "IMAGE_UNVERIFIED" })]));
  });

  it("propagates a failed media read rather than treating it as unspecified requirements", async () => {
    const { repository, responses } = fixture();
    responses.set(tables.publisherDraftItems, new Error("catalog read failed"));
    await expect(repository.preflightPublisherDraft("owner-1", "draft-1", 1, now)).rejects.toThrow("catalog read failed");
  });
});

describe("image compatibility is separate from evidence and frozen-asset integrity", () => {
  it.each(["unknown", null, undefined] as const)("does not require evidence for ordinary %s compatibility", (state) => {
    expect(publisherImageCompatibilityBlocker(state)).toBeNull();
    expect(publisherImageCapabilityEvidenceBlocker({ imageSupport: state })).toBe("Media image capability is not verified");
  });

  it("still requires a timestamp and HTTPS evidence when recording verified capability", () => {
    expect(publisherImageCapabilityEvidenceBlocker({ imageSupport: "verified" })).toContain("timestamp");
    expect(publisherImageCapabilityEvidenceBlocker({ imageSupport: "verified", verifiedAt: now, evidenceUrl: "http://example.test/proof" })).toContain("HTTPS");
    expect(publisherImageCapabilityEvidenceBlocker({ imageSupport: "verified", verifiedAt: now, evidenceUrl: "https://example.test/proof" })).toBeNull();
  });

  it("allows unknown capability through the worker's second image guard, while preserving asset validation", () => {
    const { core } = fixture();
    const { publisherLiveImageEvidenceBlocker } = createPublishWorkerPersistence(core);
    for (const imageSupport of ["unknown", null, undefined] as const) {
      expect(publisherLiveImageEvidenceBlocker({ containsImages: true, imageSupport, assets: [validAsset] })).toBeNull();
      expect(publisherLiveImageEvidenceBlocker({ containsImages: true, imageSupport, assets: [] })).toContain("no image asset evidence");
    }
    expect(publisherLiveImageEvidenceBlocker({ containsImages: true, imageSupport: "unsupported", assets: [validAsset] })).toContain("does not support images");
    expect(publisherLiveImageEvidenceBlocker({ containsImages: true, imageSupport: "unknown", assets: [{ ...validAsset, mimeType: "image/gif" }] })).toContain("incomplete public image evidence");
  });
});


describe('verified repeated publication worker allocation',()=>{
 it('accepts the exact per-copy allocation including a one-time fee without treating it as a changed catalogue price',async()=>{
  const {core,db,responses,resource,version}=fixture({containsImages:false});
  resource.rawPayload={publisher_quote_v1:{offer_id:'offer-967',publication_spec:'text',provider_resource_id:'967',provider_execution:'independent_unit_orders',repeat_allowed:true,
   pricing:{kind:'unit',amount:'1.00',currency:'CNY',quoted_at:'2026-10-01T00:00:00Z',valid_until:'2026-11-01T00:00:00Z',mandatory_fees:[{amount:'0.50',basis:'item'}]}}};
  const quote=resolvePublisherQuote(resource,{offerId:'offer-967',publicationSpec:'text',quantity:2,purpose:'standard'},now.toISOString());
  if(!quote.ok)throw new Error(quote.reason);
  const publication={schemaVersion:1,source:'source_matrix_budget_plan',taskId:'task-1',planId:'plan-1',planVersion:'plan-v1',planIndex:0,
   articleId:version.articleId,articleVersionId:version.id,articleVersion:'v1',resourceId:resource.id,offerId:'offer-967',publicationSpec:'text',quantity:2,quantityMeaning:'repeat_same_article',purpose:'standard',
   unitPriceTenThousandths:quote.unitPriceTenThousandths,totalPriceTenThousandths:quote.totalPriceTenThousandths,quoteFingerprint:quote.quoteFingerprint,locked:false};
  responses.set(tables.publisherItems,[{item:{id:'item-copy-1',ownerId:version.ownerId,status:'queued',articleContentHash:version.contentHash,mediaKindSnapshot:'news',externalResourceId:'967',submissionTitle:'稿件标题',attemptCount:0,submissionKey:'submission-copy-1',
   mediaMetadataSnapshot:{publication,publicationIndex:0,allocatedPriceTenThousandths:quote.perPublicationTenThousandths[0]}},batch:{id:'batch-1',ownerId:version.ownerId,mode:'live'},version,resource,
   snapshot:{catalogRevision:resource.catalogRevision,amountTenThousandths:BigInt(quote.perPublicationTenThousandths[0]!),providerPayloadHash:resource.payloadHash}}]);
  responses.set(tables.publisherSubmissionGate,[{id:'kol',nextAllowedAt:new Date(0)}]);
  const {PublisherWorkerRepository}=createPublishWorkerPersistence(core);
  const result=await new PublisherWorkerRepository(db).preparePublisherSubmission({itemId:'item-copy-1',workerId:'worker-1',now,leaseExpiresAt:new Date(now.getTime()+60000),minimumIntervalMs:100,runtime:{mode:'live',realEnabled:true,publishEnabled:true,imageEnabled:true}});
  expect(result.status).toBe('ready');
 });
});
