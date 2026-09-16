import type { DocxImportReport, PublicationMode } from "../server/domain/types.js";
import type { PublisherJob } from "./job-types.js";

export interface PutObjectInput { key: string; body: Uint8Array; contentType: string; contentSha256?: string; cacheControl?: string; metadata?: Readonly<Record<string, string>>; }
export interface ObjectMetadata { key: string; exists: boolean; etag?: string; size?: number; contentType?: string; contentSha256?: string; }
export interface PrivateObjectStore {
  put(input: PutObjectInput, signal?: AbortSignal): Promise<unknown>;
  delete(key: string, signal?: AbortSignal): Promise<void>;
  head(key: string, signal?: AbortSignal): Promise<ObjectMetadata>;
  signedGetUrl(key: string, expiresInSeconds?: number): string;
}
export interface PrivateObjectReader { read(key: string, signal?: AbortSignal, maxBytes?: number): Promise<Uint8Array | undefined>; }
export interface FetchedMedia { sourceUrl: string; finalUrl: string; contentType: string; body: Uint8Array; size: number; sha256: string; }
export interface SecureMediaFetchOptions { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; allowedContentTypes?: ReadonlySet<string>; userAgent?: string; signal?: AbortSignal; }
export interface KolResource { id: number; name: string; platform?: string; taxonomy?: string; mediaType?: string; kind: "news" | "self_media"; area?: string; caseUrl?: string; titleLimit?: number; price?: string; pcWeight?: string; mobileWeight?: string; successRate?: string; includeRate?: string; publishTime?: string; includeType?: string; linkType?: string; entryUrl?: string; entryLevel?: string; logo?: string; icon?: string; remark?: string; description?: string; recommended?: boolean; recommendationTags?: string[]; platformRecommendationTags?: string[]; recommendationRemark?: string; authenticationType?: string; authenticationDescription?: string; isSelfMedia: boolean; authenticated?: boolean; festivalPublishable?: boolean; fanCount?: bigint; likeCount?: bigint; publishCount?: bigint; raw: Readonly<Record<string, unknown>>; }
export interface KolOrder { id: number; resourceId: number; orderId: string; title: string; status: "processing" | "success" | "failed" | "unknown"; providerStatus: number; responseMessage?: string; reportedPrice?: string; resourceName?: string; manuscriptId?: string; createdAt?: number; updatedAt?: number; publishedUrl?: string; failureReason?: string; raw: Readonly<Record<string, unknown>>; }
export interface KolProviderPort { readonly mode: PublicationMode; listResources(page?: number, signal?: AbortSignal): Promise<{ resources: readonly KolResource[]; pagination: { currentPage: number; lastPage: number; perPage: number; total: number } }>; createOrder(input: { resourceId: number; title: string; html: string }, signal?: AbortSignal): Promise<{ orderId: string; resourceId: number; resourceName: string; paidAt?: string | number; message?: string; raw: Readonly<Record<string, unknown>> }>; listOrders(query?: { page?: number; id?: number; orderId?: string }, signal?: AbortSignal): Promise<{ orders: readonly KolOrder[]; pagination?: { lastPage: number } }>; getOrderByOrderId(orderId: string, signal?: AbortSignal): Promise<KolOrder | undefined>; }

export interface LoggerPort {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface PublisherSubmissionItem {
  itemId: string;
  batchId: string;
  mode: PublicationMode;
  resourceId: number;
  title: string;
  canonicalHtml: string;
  articleContentHash: string;
  containsImages: boolean;
}

export type PreparePublisherSubmissionResult =
  | { status: "terminal" }
  | { status: "blocked"; reason: string }
  | {
      status: "deferred";
      reason: "rate_limit" | "submission_concurrency" | "emergency_stop";
      retryAt: Date;
    }
  | {
      status: "ready";
      attemptId: string;
      item: PublisherSubmissionItem;
    };

export interface PublisherPollingItem {
  itemId: string;
  status: string;
  providerOrderId: string;
  submittedAt: Date;
}

export interface PublisherDocxImportSource {
  importId: string;
  ownerId: string;
  status: string;
  objectKey: string;
  fileName: string;
  contentType?: string;
}

export interface PublisherAssetPurgeCandidate {
  assetId: string;
  objectKeys: readonly string[];
}

export interface PublisherObjectLeaseCleanupCandidate {
  leaseId: string;
  storageKey: string;
}

/**
 * Durable MySQL boundary for the independent publisher job engine. Every method
 * that changes an item or its funds must be transactional and idempotent. In
 * particular, preparePublisherSubmission must acquire the global submission
 * gate, re-check catalog/hash/quote/runtime state, create a STARTED attempt and
 * transition queued -> submitting in one transaction.
 */
export interface PublisherWorkerRepositoryPort {
  leasePublisherJobs(input: {
    workerId: string;
    now: Date;
    limit: number;
    leaseMs: number;
    allowedTypes?: readonly PublisherJob["type"][];
  }): Promise<readonly PublisherJob[]>;
  renewPublisherJobLease(
    jobId: string,
    workerId: string,
    leasedUntil: Date,
  ): Promise<void>;
  completePublisherJob(
    jobId: string,
    workerId: string,
    completedAt: Date,
  ): Promise<void>;
  deferPublisherJob(
    jobId: string,
    workerId: string,
    availableAt: Date,
    reason: string,
  ): Promise<void>;
  retryPublisherJob(input: {
    jobId: string;
    workerId: string;
    availableAt: Date;
    error: string;
  }): Promise<void>;
  deadLetterPublisherJob(input: {
    jobId: string;
    workerId: string;
    failedAt: Date;
    error: string;
  }): Promise<void>;
  enqueuePublisherMaintenanceJobs(at: Date): Promise<void>;
  recoverExpiredPublisherSubmissions(at: Date, limit: number): Promise<number>;
  claimExpiredPublisherObjectLeases(input: {
    now: Date;
    claimUntil: Date;
    limit: number;
  }): Promise<readonly PublisherObjectLeaseCleanupCandidate[]>;
  confirmPublisherObjectLeaseCleanup(input: {
    leaseId: string;
    storageKey: string;
    now: Date;
  }): Promise<boolean>;
  completePublisherObjectLeaseCleanup(input: {
    leaseId: string;
    storageKey: string;
    completedAt: Date;
  }): Promise<void>;

  preparePublisherSubmission(input: {
    itemId: string;
    workerId: string;
    now: Date;
    leaseExpiresAt: Date;
    minimumIntervalMs: number;
    runtime: {
      mode: PublicationMode;
      realEnabled: boolean;
      publishEnabled: boolean;
      imageEnabled: boolean;
    };
  }): Promise<PreparePublisherSubmissionResult>;
  markPublisherSubmissionAccepted(input: {
    itemId: string;
    attemptId: string;
    providerOrderId: string;
    providerPaidAt?: string | number;
    providerRaw: unknown;
    acceptedAt: Date;
    nextPollAt: Date;
  }): Promise<void>;
  markPublisherSubmissionRejected(input: {
    itemId: string;
    attemptId: string;
    reason: string;
    providerRaw?: unknown;
    settledAt: Date;
  }): Promise<void>;
  markPublisherSubmissionUnknown(input: {
    itemId: string;
    attemptId: string;
    reason: string;
    providerRaw?: unknown;
    observedAt: Date;
    blockCredentialGate: boolean;
  }): Promise<void>;
  markPublisherSubmissionBlocked(input: {
    itemId: string;
    attemptId: string;
    status: "auth_blocked" | "action_required";
    reason: string;
    observedAt: Date;
  }): Promise<void>;

  getPublisherItemForPolling(
    itemId: string,
  ): Promise<PublisherPollingItem | undefined>;
  applyPublisherOrderObservation(input: {
    itemId: string;
    providerOrderId: string;
    providerStatus: "processing" | "success" | "failed" | "unknown";
    publishedUrl?: string;
    failureReason?: string;
    actionRequiredReason?: string;
    reportedPrice?: string;
    manuscriptId?: string;
    providerRaw: unknown;
    observedAt: Date;
    nextPollAt?: Date;
  }): Promise<void>;

  beginKolCatalogSync(input: {
    runId: string;
    leaseToken: string;
    startedAt: Date;
    leaseExpiresAt: Date;
  }): Promise<{
    alreadyComplete: boolean;
    acquired: boolean;
    retryAt?: Date;
  }>;
  failKolCatalogSync(input: {
    runId: string;
    leaseToken: string;
    failedAt: Date;
    pagesFetched: number;
    recordsSeen: number;
    reason: string;
  }): Promise<void>;
  stageKolCatalogPage(input: {
    runId: string;
    leaseToken: string;
    page: number;
    expectedLastPage: number;
    resources: readonly KolResource[];
    stagedAt: Date;
    leaseExpiresAt: Date;
  }): Promise<{
    invalidRecords: number;
    duplicateRecords: number;
    crossKindDuplicateRecords: number;
  }>;
  finalizeKolCatalogSync(input: {
    runId: string;
    leaseToken: string;
    expectedLastPage: number;
    syncedAt: Date;
    leaseExpiresAt: Date;
  }): Promise<void>;
  cleanupExpiredKolCatalogSyncStaging(input: {
    completedBefore: Date;
    limit: number;
  }): Promise<number>;
  getKolMediaLogoCandidate(mediaResourceId: string): Promise<
    | {
        mediaResourceId: string;
        externalResourceId: string;
        catalogRevision: string;
        syncRunId: string;
        candidateHash: string;
        mediaName: string;
        platform: string | null;
        area: string | null;
        archiveStatus:
          "pending" | "archived" | "pending_review" | "missing" | "failed";
        sourceKind:
          | "logo"
          | "icon"
          | "site_favicon"
          | "web_search_verified"
          | "manual_verified"
          | "generated_fallback"
          | null;
        reviewAudit?: PublisherLogoSearchAudit;
        trustedDomains: readonly string[];
        candidates: ReadonlyArray<{
          kind: "logo" | "icon" | "site_favicon";
          url: string;
        }>;
      }
    | undefined
  >;
  completeKolMediaLogoArchive(input: {
    mediaResourceId: string;
    syncRunId: string;
    catalogRevision: string;
    candidateHash: string;
    sourceKind:
      | "logo"
      | "icon"
      | "site_favicon"
      | "web_search_verified"
      | "manual_verified"
      | "generated_fallback";
    sourceUrl: string;
    objectKey: string;
    contentType: "image/jpeg" | "image/png";
    sizeBytes: number;
    sha256: string;
    checkedAt: Date;
    reviewAudit?: PublisherLogoSearchAudit;
  }): Promise<void>;
  carryForwardKolMediaLogoArchive(input: {
    mediaResourceId: string;
    syncRunId: string;
    candidateHash: string;
    checkedAt: Date;
  }): Promise<void>;
  failKolMediaLogoArchive(input: {
    mediaResourceId: string;
    syncRunId: string;
    candidateHash: string;
    errorCode: string;
    checkedAt: Date;
  }): Promise<void>;
  recordKolMediaLogoFallback(input: {
    mediaResourceId: string;
    syncRunId: string;
    candidateHash: string;
    status: "pending_review" | "missing" | "failed";
    errorCode: string;
    checkedAt: Date;
    reviewAudit?: PublisherLogoSearchAudit;
  }): Promise<void>;
  markKolCredentialAuthBlocked(input: { failedAt: Date }): Promise<void>;

  getPublisherDocxImport(
    importId: string,
  ): Promise<PublisherDocxImportSource | undefined>;
  leasePublisherDocxImportImages(input: {
    importId: string;
    ownerId: string;
    storageKeys: readonly string[];
    leasedAt: Date;
    expiresAt: Date;
  }): Promise<void>;
  completePublisherDocxImport(input: {
    importId: string;
    ownerId: string;
    report: DocxImportReport;
    completedAt: Date;
  }): Promise<void>;
  failPublisherDocxImport(input: {
    importId: string;
    reason: string;
    failedAt: Date;
  }): Promise<void>;

  recordPublisherReconciliationCandidates(input: {
    itemId: string;
    orders: readonly KolOrder[];
    observedAt: Date;
  }): Promise<void>;
  getPublisherAssetPurgeCandidate(
    assetId: string,
  ): Promise<PublisherAssetPurgeCandidate | undefined>;
  finalizePublisherAssetPurge(assetId: string, purgedAt: Date): Promise<void>;
}

export interface PublisherWorkerDependencies {
  repository: PublisherWorkerRepositoryPort;
  provider: KolProviderPort;
  objectStore: PrivateObjectStore;
  logger: LoggerPort;
  now?: () => Date;
  fetch?: typeof fetch;
  mediaFetcher?: (
    input: string | URL,
    options?: SecureMediaFetchOptions,
  ) => Promise<FetchedMedia>;
  logoSearch?: PublisherLogoSearchPort;
}

export type PublisherLogoSearchVerification =
  "unverified" | "case_domain" | "official_registry";

export type PublisherLogoSearchCandidate = {
  matchedName: string;
  imageUrl: string;
  pageUrl: string;
  evidenceUrl: string | null;
  officialDomain: string | null;
  verification: PublisherLogoSearchVerification;
};

export type PublisherLogoSearchAudit = Omit<
  PublisherLogoSearchCandidate,
  "imageUrl"
> & {
  searchProvider: string;
  queryHash: string;
  observedAt: string;
  candidateImageUrl: string;
};

export interface PublisherLogoSearchPort {
  readonly providerName: string;
  readonly trustedEvidenceDomains: readonly string[];
  search(input: {
    name: string;
    externalResourceId: string;
    queryHash: string;
    platform: string | null;
    area: string | null;
    trustedDomains: readonly string[];
    signal?: AbortSignal;
  }): Promise<readonly PublisherLogoSearchCandidate[]>;
}

const REQUIRED_METHODS = [
  "leasePublisherJobs",
  "renewPublisherJobLease",
  "completePublisherJob",
  "deferPublisherJob",
  "retryPublisherJob",
  "deadLetterPublisherJob",
  "enqueuePublisherMaintenanceJobs",
  "recoverExpiredPublisherSubmissions",
  "claimExpiredPublisherObjectLeases",
  "confirmPublisherObjectLeaseCleanup",
  "completePublisherObjectLeaseCleanup",
  "preparePublisherSubmission",
  "markPublisherSubmissionAccepted",
  "markPublisherSubmissionRejected",
  "markPublisherSubmissionUnknown",
  "markPublisherSubmissionBlocked",
  "getPublisherItemForPolling",
  "applyPublisherOrderObservation",
  "beginKolCatalogSync",
  "failKolCatalogSync",
  "stageKolCatalogPage",
  "finalizeKolCatalogSync",
  "cleanupExpiredKolCatalogSyncStaging",
  "getKolMediaLogoCandidate",
  "completeKolMediaLogoArchive",
  "failKolMediaLogoArchive",
  "recordKolMediaLogoFallback",
  "markKolCredentialAuthBlocked",
  "getPublisherDocxImport",
  "leasePublisherDocxImportImages",
  "completePublisherDocxImport",
  "failPublisherDocxImport",
  "recordPublisherReconciliationCandidates",
  "getPublisherAssetPurgeCandidate",
  "finalizePublisherAssetPurge",
] as const satisfies readonly (keyof PublisherWorkerRepositoryPort)[];

export function assertPublisherWorkerRepositoryPort(
  value: unknown,
): asserts value is PublisherWorkerRepositoryPort {
  if (!value || typeof value !== "object") {
    throw new TypeError("Publisher worker repository adapter is not an object");
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof (value as Record<string, unknown>)[method] !== "function") {
      throw new TypeError(
        `Publisher worker repository adapter is missing ${method}()`,
      );
    }
  }
}
