import type { PublicationSelection } from '../shared/publication-selection';
export type PublishingWallet = {
  availableTenThousandths: string;
  reservedTenThousandths: string;
  frozenTenThousandths: string;
};

export type CatalogFreshness = {
  activeRevision: string;
  /** Inventory counts are independent of the current list filters and page. */
  mediaCount?: number;
  newsCount?: number;
  selfMediaCount?: number;
  /** Missing/legacy responses cannot be represented as a verified zero. */
  countStatus?: "available" | "unavailable";
  kindComplete?: boolean;
  lastSyncedAt: string;
  stale: boolean;
};

export type ResumablePublicationDraft = {
  id: string;
  articleTitle: string;
  articleVersion: number;
  status: "draft" | "ready";
  updatedAt: string;
};

export type PublishingDashboard = {
  wallet: PublishingWallet;
  catalog: CatalogFreshness;
  articleCount: number;
  actionableItemCount: number;
  resumableDraftCount: number;
  resumableDrafts: ResumablePublicationDraft[];
  processingBatchCount: number;
  processingBatches: PublicationBatchSummary[];
  recentBatches: PublicationBatchSummary[];
  resumableArticles: ArticleSummary[];
};

export type ArticleStatus = "draft" | "frozen" | "importing" | "import_failed";

export type ArticleSummary = {
  id: string;
  title: string;
  status: ArticleStatus;
  currentVersion: number;
  currentVersionId?: string;
  currentVersionHash?: string;
  wordCount: number;
  imageCount: number;
  updatedAt: string;
};

export type ArticleImage = {
  id: string;
  fileName: string;
  altText: string;
  width: number;
  height: number;
  /** Exact server-issued capability URL preserved in canonical supplier HTML. */
  sourceUrl?: string;
  /** Same-origin bundled URL or owner-authenticated Blob URL used in the editor. */
  previewUrl?: string;
  previewUrlIsObject?: boolean;
};

export type PublisherEditorContent = {
  html: string;
  text: string;
  json: Record<string, unknown>;
};

export type ArticleVersion = {
  id: string;
  version: number;
  hash: string;
  containsImages: boolean;
  frozen: boolean;
  createdAt: string;
  createdBy: string;
};

export type ArticleDetail = ArticleSummary & {
  revision: number;
  bodyText: string;
  bodyHtml?: string;
  editorJson?: Record<string, unknown>;
  images: ArticleImage[];
  versions: ArticleVersion[];
  importChecks: {
    docxSafe: boolean;
    externalLinkCount: number;
    structureValid: boolean;
  };
};

export type ArticleSaveInput = {
  articleId: string;
  expectedRevision: number;
  title: string;
  bodyText: string;
  bodyHtml: string;
  editorJson: Record<string, unknown>;
  images: ArticleImage[];
};

export type ArticleImportResult = {
  importId: string;
  articleId: string;
};

export type MediaCapability = "text" | "image" | "image_pending";

export type PublisherMediaKind = "news" | "self_media";

export type PublisherTitleMode = "single" | "per_media";

export type MediaSort =
  | "recommended"
  | "price_asc"
  | "price_desc"
  | "success_desc"
  | "include_desc"
  | "weight_desc"
  | "updated_desc";

export type MediaResource = {
  id: string;
  /** Provider catalog identifier frozen into the customer confirmation view. */
  externalResourceId?: string;
  name: string;
  shortName: string;
  /** `unknown` only appears on immutable historical snapshots. */
  kind: PublisherMediaKind | "unknown";
  platform: string;
  taxonomy: string;
  mediaType: string;
  channel: string;
  region: string;
  caseUrl?: string;
  /** Authenticated same-origin archive path; provider CDN URLs never reach Web. */
  logoUrl?: string;
  /** Generated fallbacks are intentionally not counted as real media logos. */
  logoSource:
    | "provider_logo"
    | "provider_icon"
    | "site_favicon"
    | "web_search_verified"
    | "manual_verified"
    | "generated_fallback";
  logoResolutionStatus:
    "pending" | "archived" | "pending_review" | "missing" | "failed";
  titleLimit: number;
  priceTenThousandths: string;
  turnaround: string;
  /** Percent on a 0–100 scale; absent means unknown, never a zero estimate. */
  successRate?: number;
  /** Percent on a 0–100 scale, preserving the source's decimal precision. */
  includeRate?: number;
  includeType?: string;
  entryType?: string;
  linkType?: string;
  pcWeight?: number;
  mobileWeight?: number;
  authenticated?: boolean;
  authenticationType?: string;
  authenticationDescription?: string;
  recommendationTags?: string[];
  platformRecommendationTags?: string[];
  recommendationRemark?: string;
  festivalAvailable?: boolean;
  recommended?: boolean;
  remark?: string;
  followers?: number;
  likes?: number;
  publishedCount?: number;
  capability: MediaCapability;
  active: boolean;
  catalogRevision: string;
};

export type MediaFilters = {
  query: string;
  /** Catalogue UI opts in to name-only search; older consumers keep their semantics. */
  searchScope?: "name";
  /** Newline/comma separated names (legacy callers may also search ids), maximum 50. */
  batchQuery?: string;
  /** Request-only internal IDs for an account's cart/favourite scope; never persisted in URLs. */
  mediaIds?: string[];
  kind?: PublisherMediaKind;
  platform?: string;
  taxonomy?: string;
  mediaType?: string;
  area?: string;
  /** Reviewed coverage dimensions; raw area/region remain independent exact constraints. */
  province?: string;
  city?: string;
  /** Supplier platform label, independent of recommendationGroup and recommended. */
  aiPlatform?: string;
  recommendationGroup?: string;
  recommended?: "" | "true";
  /** Exact provider recommend label, never inferred from free text or platform_recommend. */
  recommendationTag?: string;
  priceMin?: string;
  priceMax?: string;
  priceMinExclusive?: boolean;
  includeType?: string;
  publishSpeed?: string;
  entryType?: string;
  linkType?: string;
  pcWeight?: string;
  mobileWeight?: string;
  includeRate?: string;
  successRate?: string;
  authenticated?: "" | "true";
  festival?: "" | "true";
  sort?: MediaSort;
  /** Compatibility aliases for the first publishing UI and API. */
  channel?: string;
  region?: string;
  price?: "" | "under_100" | "100_300" | "over_300";
  capability?: "" | MediaCapability;
  page: number;
  pageSize: number;
};

export type MediaFacetOption = {
  value: string;
  label: string;
  count: number;
};

export type MediaFacets = {
  /** Version 2 is required before exposing normalized coverage and label filters. */
  filterSchemaVersion?: number;
  coverageProvinces?: MediaFacetOption[];
  coverageCities?: Array<MediaFacetOption & { province: string }>;
  aiPlatforms?: MediaFacetOption[];
  recommendationGroups?: MediaFacetOption[];
  kinds: Record<PublisherMediaKind, number>;
  platforms: MediaFacetOption[];
  taxonomies: MediaFacetOption[];
  mediaTypes: MediaFacetOption[];
  areas: MediaFacetOption[];
  includeTypes: MediaFacetOption[];
  publishSpeeds: MediaFacetOption[];
  entryTypes: MediaFacetOption[];
  linkTypes: MediaFacetOption[];
  imageSupports: MediaFacetOption[];
  pcWeightThresholds: MediaFacetOption[];
  mobileWeightThresholds?: MediaFacetOption[];
  includeRateThresholds: MediaFacetOption[];
  successRateThresholds: MediaFacetOption[];
  recommendedOptions: MediaFacetOption[];
  recommendationTags?: MediaFacetOption[];
  authenticatedOptions: MediaFacetOption[];
  festivalPublishableOptions: MediaFacetOption[];
  catalog: CatalogFreshness;
};

export type MediaList = {
  filterSchemaVersion?: number;
  items: MediaResource[];
  total: number;
  page: number;
  pageSize: number;
  catalog: CatalogFreshness;
};

export type PublicationDraftItem = {
  publication?: PublicationSelection;
  media: MediaResource;
  title: string;
};

export type PublicationDraft = {
  id: string;
  articleId: string;
  articleVersionId: string;
  articleTitle: string;
  articleVersion: number;
  articleVersionHash: string;
  articleContainsImages: boolean;
  revision: number;
  titleMode: PublisherTitleMode;
  sharedTitle?: string;
  items: PublicationDraftItem[];
  updatedAt: string;
};

export type SaveDraftTitlesInput = {
  mode: PublisherTitleMode;
  sharedTitle?: string;
  titles: Record<string, string>;
  expectedRevision: number;
};

export type PreflightItem = PublicationDraftItem & {
  priceTenThousandths: string;
  checks: Array<{ label: string; passed: boolean }>;
  blockerCodes?: string[];
  blockers: string[];
  warnings: string[];
};

export type PublicationPreflight = {
  revision: string;
  draftRevision: number;
  quoteFingerprint: string;
  mode: "mock" | "test" | "live";
  expiresAt: string;
  article: {
    id: string;
    title: string;
    version: number;
    versionId: string;
    hash: string;
    wordCount: number;
    imageCount: number;
    bodyHtml: string;
    images: Array<{
      id: string;
      altText: string;
      sourceUrl?: string;
      previewUrl?: string;
    }>;
  };
  catalogRevision: string;
  titleMode?: PublisherTitleMode;
  kindCounts?: { news: number; selfMedia: number };
  items: PreflightItem[];
  totalTenThousandths: string;
  wallet: PublishingWallet;
  availableAfterTenThousandths: string;
  blockerCodes?: string[];
  blockers: string[];
  warnings: string[];
  gates: Array<{ label: string; passed: boolean }>;
};

export type PublicationItemStatus =
  | "queued"
  | "submitting"
  | "processing"
  | "success"
  | "failed"
  | "auth_blocked"
  | "submission_unknown"
  | "action_required";

export type PublicationBatchStatus =
  | "queued"
  | "processing"
  | "success"
  | "failed"
  | "partial_success"
  | "action_required";

export type PublicationFundStatus =
  "reserved" | "frozen" | "consumed" | "released";

export type PublicationItem = {
  id: string;
  media: MediaResource;
  title: string;
  status: PublicationItemStatus;
  fundStatus: PublicationFundStatus;
  priceTenThousandths: string;
  resultUrl?: string;
  resultMessage?: string;
  submittedAt?: string;
  completedAt?: string;
  submissionAttempts?: Array<{ id: string; number: number; startedAt: string; completedAt?: string; result?: "succeeded" | "business_rejected" | "auth_blocked" | "submission_unknown" }>;
  updatedAt: string;
};

export type PublicationBatchSummary = {
  id: string;
  articleTitle: string;
  articleVersion: number;
  mode: "mock" | "test" | "live";
  status: PublicationBatchStatus;
  itemCount: number;
  successCount: number;
  failedCount: number;
  unknownCount: number;
  newsCount?: number;
  selfMediaCount?: number;
  titleMode?: PublisherTitleMode;
  totalTenThousandths: string;
  consumedTenThousandths: string;
  releasedTenThousandths: string;
  frozenTenThousandths: string;
  createdAt: string;
};

export type PublicationBatch = PublicationBatchSummary & {
  articleVersionId: string;
  articleVersionHash: string;
  items: PublicationItem[];
};

export type PublisherSubmitInput = {
  draftId: string;
  preflightRevision: string;
  quoteFingerprint: string;
  acknowledged: boolean;
  idempotencyKey: string;
};

export function formatPublishingMoney(value: string) {
  const amount = BigInt(value || "0");
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 10_000n;
  const fractional = (absolute % 10_000n)
    .toString()
    .padStart(4, "0")
    .slice(0, 2);
  return `${sign}¥${whole.toLocaleString("zh-CN")}.${fractional}`;
}

export function publishingDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
