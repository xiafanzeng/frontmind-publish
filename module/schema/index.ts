import { sql } from "drizzle-orm";
import { type AnyMySqlColumn, bigint, boolean, datetime, decimal, foreignKey, index, int, json, longtext, mysqlEnum, mysqlTable, primaryKey, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export interface PublishSchemaCore {
  users: { id: AnyMySqlColumn };
  currentMonitoringEnterpriseProjectId(): string | null;
}
export const publicationModes = ["mock", "test", "live"] as const;
export const publisherArticleStatuses = ["draft", "ready", "archived"] as const;
export const publisherImportStatuses = [
  "uploaded",
  "validating",
  "parsing",
  "ready",
  "rejected",
  "failed",
] as const;
export const publisherImageSupportStatuses = [
  "unknown",
  "verified",
  "unsupported",
] as const;
export const publisherMediaKinds = ["news", "self_media"] as const;
export const publisherHistoricalMediaKinds = [
  "news",
  "self_media",
  "unknown",
] as const;
export const publisherTitleModes = ["single", "per_media"] as const;
export const publisherMediaSyncStatuses = [
  "running",
  "success",
  "partial",
  "failed",
] as const;
export const publisherMediaLogoArchiveStatuses = [
  "pending",
  "archived",
  "pending_review",
  "missing",
  "failed",
] as const;
export const publisherMediaLogoSourceKinds = [
  "logo",
  "icon",
  "site_favicon",
  "web_search_verified",
  "manual_verified",
  "generated_fallback",
] as const;
export type PublisherMediaLogoReviewAudit = {
  searchProvider: string;
  queryHash: string;
  candidateImageUrl: string;
  pageUrl: string;
  evidenceUrl: string | null;
  officialDomain: string | null;
  matchedName: string;
  verification: "unverified" | "case_domain" | "official_registry";
  observedAt: string;
};
export const publisherDraftStatuses = [
  "draft",
  "ready",
  "submitted",
  "archived",
] as const;
export const publisherBatchStatuses = [
  "queued",
  "processing",
  "success",
  "failed",
  "partial_success",
  "action_required",
] as const;
export const publisherItemStatuses = [
  "queued",
  "submitting",
  "processing",
  "success",
  "failed",
  "auth_blocked",
  "submission_unknown",
  "action_required",
] as const;
export const publisherFundsStatuses = [
  "reserved",
  "frozen",
  "consumed",
  "released",
] as const;
export const publisherJobTypes = [
  "import_docx",
  "sync_kol_catalog",
  "archive_publisher_media_logo",
  "submit_publication_item",
  "poll_publication_item",
  "reconcile_publication_unknown",
  "purge_publisher_assets",
] as const;
export const publisherJobStatuses = [
  "ready",
  "leased",
  "retry_wait",
  "paused",
  "succeeded",
  "dead",
] as const;
export const publisherAttemptResults = [
  "succeeded",
  "business_rejected",
  "auth_blocked",
  "submission_unknown",
] as const;
export const publisherCredentialStatuses = [
  "unconfigured",
  "healthy",
  "auth_blocked",
  "unknown",
] as const;
export const publisherWebhookSignatureStatuses = [
  "not_configured",
  "verified",
  "invalid",
] as const;
export const publisherWebhookEventStatuses = [
  "received",
  "queued",
  "processed",
  "unmatched",
  "rejected",
] as const;
const id = (name: string) => varchar(name, { length: 36 });
const createdAt = () =>
  timestamp("created_at", { mode: "date", fsp: 3 }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { mode: "date", fsp: 3 })
    .notNull()
    .defaultNow()
    .onUpdateNow();

export function createPublishSchema(core: PublishSchemaCore) {
const publisherArticles = mysqlTable(
  "publisher_articles",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    workingName: varchar("working_name", { length: 180 }).notNull(),
    suggestedTitle: varchar("suggested_title", { length: 200 }),
    status: mysqlEnum("status", publisherArticleStatuses)
      .notNull()
      .default("draft"),
    currentVersionId: id("current_version_id"),
    revision: int("revision", { unsigned: true }).notNull().default(0),
    editorJson: json("editor_json").$type<Record<string, unknown>>(),
    canonicalHtml: longtext("canonical_html"),
    plainText: longtext("plain_text"),
    contentHash: varchar("content_hash", { length: 64 }),
    containsImages: boolean("contains_images").notNull().default(false),
    archivedAt: datetime("archived_at", { mode: "date", fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pub_articles_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_articles_id_owner_uq").on(table.id, table.ownerId),
    uniqueIndex("pub_articles_current_version_uq").on(table.currentVersionId),
    index("pub_articles_owner_updated_idx").on(table.ownerId, table.updatedAt),
    index("pub_articles_owner_status_idx").on(table.ownerId, table.status),
  ],
);

const publisherDocxImports = mysqlTable(
  "publisher_docx_imports",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    articleId: id("article_id"),
    sourceFilename: varchar("source_filename", { length: 255 }).notNull(),
    sourceObjectKey: varchar("source_object_key", { length: 1_024 }).notNull(),
    sizeBytes: int("size_bytes", { unsigned: true }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    parserVersion: varchar("parser_version", { length: 64 }).notNull(),
    status: mysqlEnum("status", publisherImportStatuses)
      .notNull()
      .default("uploaded"),
    detectedTitle: varchar("detected_title", { length: 200 }),
    importReport: json("import_report").$type<Record<string, unknown>>(),
    warnings: json("warnings")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    blockingIssues: json("blocking_issues")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pub_docx_imports_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_imports_id_owner_uq").on(table.id, table.ownerId),
    index("pub_imports_owner_status_idx").on(table.ownerId, table.status),
    index("pub_imports_expiry_idx").on(table.expiresAt),
    index("pub_imports_owner_sha_idx").on(table.ownerId, table.sha256),
    foreignKey({
      name: "pub_imports_article_owner_fk",
      columns: [table.articleId, table.ownerId],
      foreignColumns: [publisherArticles.id, publisherArticles.ownerId],
    }).onDelete("restrict"),
  ],
);

const publisherArticleVersions = mysqlTable(
  "publisher_article_versions",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    articleId: id("article_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    editorJson: json("editor_json").$type<Record<string, unknown>>().notNull(),
    canonicalHtml: longtext("canonical_html").notNull(),
    plainText: longtext("plain_text").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    containsImages: boolean("contains_images").notNull().default(false),
    sourceImportId: id("source_import_id"),
    freezeIdempotencyKey: varchar("freeze_idempotency_key", {
      length: 191,
    }).notNull(),
    createdBy: id("created_by").references(() => core.users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index("pub_article_versions_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_versions_id_owner_uq").on(table.id, table.ownerId),
    uniqueIndex("pub_versions_article_number_uq").on(
      table.articleId,
      table.version,
    ),
    uniqueIndex("pub_versions_owner_freeze_key_uq").on(
      table.ownerId,
      table.freezeIdempotencyKey,
    ),
    index("pub_versions_hash_idx").on(table.contentHash),
    foreignKey({
      name: "pub_versions_article_owner_fk",
      columns: [table.articleId, table.ownerId],
      foreignColumns: [publisherArticles.id, publisherArticles.ownerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "pub_versions_import_owner_fk",
      columns: [table.sourceImportId, table.ownerId],
      foreignColumns: [publisherDocxImports.id, publisherDocxImports.ownerId],
    }).onDelete("restrict"),
  ],
);

const publisherArticleAssets = mysqlTable(
  "publisher_article_assets",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    articleId: id("article_id").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    width: int("width", { unsigned: true }).notNull(),
    height: int("height", { unsigned: true }).notNull(),
    sizeBytes: int("size_bytes", { unsigned: true }).notNull(),
    storageKey: varchar("storage_key", { length: 1_024 }).notNull(),
    storageKeyHash: varchar("storage_key_hash", { length: 64 }).notNull(),
    altText: varchar("alt_text", { length: 500 }),
    sourceImportId: id("source_import_id"),
    isFrozen: boolean("is_frozen").notNull().default(false),
    publicCapabilityDigest: varchar("public_capability_digest", { length: 64 }),
    publicCapabilityCreatedAt: datetime("public_capability_created_at", {
      mode: "date",
      fsp: 3,
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pub_article_assets_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_assets_id_owner_uq").on(table.id, table.ownerId),
    uniqueIndex("pub_assets_article_sha_uq").on(table.articleId, table.sha256),
    uniqueIndex("pub_assets_capability_uq").on(table.publicCapabilityDigest),
    index("pub_assets_storage_key_idx").on(table.storageKeyHash),
    foreignKey({
      name: "pub_assets_article_owner_fk",
      columns: [table.articleId, table.ownerId],
      foreignColumns: [publisherArticles.id, publisherArticles.ownerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "pub_assets_import_owner_fk",
      columns: [table.sourceImportId, table.ownerId],
      foreignColumns: [publisherDocxImports.id, publisherDocxImports.ownerId],
    }).onDelete("restrict"),
  ],
);

const publisherArticleVersionAssets = mysqlTable(
  "publisher_article_version_assets",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    articleVersionId: id("article_version_id").notNull(),
    assetId: id("asset_id").notNull(),
    sortOrder: int("sort_order", { unsigned: true }).notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    index("pub_article_version_assets_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    primaryKey({ columns: [table.articleVersionId, table.assetId] }),
    index("pub_version_assets_owner_idx").on(table.ownerId),
    foreignKey({
      name: "pub_version_assets_version_owner_fk",
      columns: [table.articleVersionId, table.ownerId],
      foreignColumns: [
        publisherArticleVersions.id,
        publisherArticleVersions.ownerId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pub_version_assets_asset_owner_fk",
      columns: [table.assetId, table.ownerId],
      foreignColumns: [
        publisherArticleAssets.id,
        publisherArticleAssets.ownerId,
      ],
    }).onDelete("restrict"),
  ],
);

const publisherObjectLeases = mysqlTable(
  "publisher_object_leases",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    operationId: varchar("operation_id", { length: 191 }).notNull(),
    storageKey: varchar("storage_key", { length: 1_024 }).notNull(),
    storageKeyHash: varchar("storage_key_hash", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 64 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pub_object_leases_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_object_leases_operation_key_uq").on(
      table.ownerId,
      table.operationId,
      table.storageKeyHash,
    ),
    index("pub_object_leases_expiry_idx").on(table.expiresAt),
    index("pub_object_leases_storage_expiry_idx").on(
      table.storageKeyHash,
      table.expiresAt,
    ),
  ],
);

const publisherMediaSyncRuns = mysqlTable(
  "publisher_media_sync_runs",
  {
    id: id("id").primaryKey(),
    catalogRevision: varchar("catalog_revision", { length: 64 }).notNull(),
    status: mysqlEnum("status", publisherMediaSyncStatuses)
      .notNull()
      .default("running"),
    startedBy: id("started_by").references(() => core.users.id, {
      onDelete: "set null",
    }),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }).notNull(),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
    pagesFetched: int("pages_fetched", { unsigned: true }).notNull().default(0),
    pagesExpected: int("pages_expected", { unsigned: true })
      .notNull()
      .default(0),
    recordsSeen: int("records_seen", { unsigned: true }).notNull().default(0),
    newsRecords: int("news_records", { unsigned: true }).notNull().default(0),
    selfMediaRecords: int("self_media_records", { unsigned: true })
      .notNull()
      .default(0),
    invalidRecords: int("invalid_records", { unsigned: true })
      .notNull()
      .default(0),
    duplicateRecords: int("duplicate_records", { unsigned: true })
      .notNull()
      .default(0),
    crossKindDuplicateRecords: int("cross_kind_duplicate_records", {
      unsigned: true,
    })
      .notNull()
      .default(0),
    recordsChanged: int("records_changed", { unsigned: true })
      .notNull()
      .default(0),
    stopReason: varchar("stop_reason", { length: 240 }),
    error: json("error").$type<Record<string, unknown>>(),
    isComplete: boolean("is_complete").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pub_media_sync_revision_idx").on(table.catalogRevision),
    index("pub_media_sync_status_started_idx").on(
      table.status,
      table.startedAt,
    ),
  ],
);

const publisherMediaResources = mysqlTable(
  "publisher_media_resources",
  {
    id: id("id").primaryKey(),
    externalResourceId: varchar("external_resource_id", {
      length: 128,
    }).notNull(),
    catalogRevision: varchar("catalog_revision", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    mediaKind: mysqlEnum("media_kind", publisherMediaKinds),
    platform: varchar("platform", { length: 120 }),
    taxonomy: varchar("taxonomy", { length: 120 }),
    mediaType: varchar("media_type", { length: 120 }),
    area: varchar("area", { length: 120 }),
    caseUrl: text("case_url"),
    titleLimit: int("title_limit", { unsigned: true }),
    priceTenThousandths: bigint("price_ten_thousandths", {
      mode: "bigint",
      unsigned: true,
    }).notNull(),
    successRateBasisPoints: int("success_rate_basis_points", {
      unsigned: true,
    }),
    includeRateBasisPoints: int("include_rate_basis_points", {
      unsigned: true,
    }),
    pcWeight: int("pc_weight", { unsigned: true }),
    mobileWeight: int("mobile_weight", { unsigned: true }),
    includeType: varchar("include_type", { length: 120 }),
    publishSpeed: varchar("publish_speed", { length: 120 }),
    entryUrl: text("entry_url"),
    entryLevel: varchar("entry_level", { length: 120 }),
    linkType: varchar("link_type", { length: 120 }),
    providerLogoUrl: text("logo_url"),
    providerIconUrl: text("provider_icon_url"),
    logoCandidateHash: varchar("logo_candidate_hash", { length: 64 }).notNull(),
    logoArchiveStatus: mysqlEnum(
      "logo_archive_status",
      publisherMediaLogoArchiveStatuses,
    )
      .notNull()
      .default("missing"),
    logoSourceKind: mysqlEnum(
      "logo_source_kind",
      publisherMediaLogoSourceKinds,
    ),
    logoSourceUrl: text("logo_source_url"),
    logoObjectKey: varchar("logo_object_key", { length: 1_024 }),
    logoContentType: varchar("logo_content_type", { length: 120 }),
    logoSizeBytes: bigint("logo_size_bytes", {
      mode: "bigint",
      unsigned: true,
    }),
    logoSha256: varchar("logo_sha256", { length: 64 }),
    logoCheckedAt: datetime("logo_checked_at", { mode: "date", fsp: 3 }),
    logoArchiveError: varchar("logo_archive_error", { length: 120 }),
    logoReviewAudit:
      json("logo_review_audit").$type<PublisherMediaLogoReviewAudit>(),
    remark: text("remark"),
    description: text("description"),
    recommended: boolean("recommended"),
    authenticated: boolean("authenticated"),
    festivalPublishable: boolean("festival_publishable"),
    fanCount: bigint("fan_count", { mode: "bigint", unsigned: true }),
    likeCount: bigint("like_count", { mode: "bigint", unsigned: true }),
    publishCount: bigint("publish_count", { mode: "bigint", unsigned: true }),
    rawPayload: json("raw_payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    consecutiveMisses: int("consecutive_misses", { unsigned: true })
      .notNull()
      .default(0),
    lastSeenCompleteRunId: id("last_seen_complete_run_id").references(
      () => publisherMediaSyncRuns.id,
      { onDelete: "set null" },
    ),
    lastSeenAt: datetime("last_seen_at", { mode: "date", fsp: 3 }).notNull(),
    inactiveAt: datetime("inactive_at", { mode: "date", fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("pub_media_external_id_uq").on(table.externalResourceId),
    index("pub_media_active_name_idx").on(table.isActive, table.name),
    index("pub_media_platform_taxonomy_idx").on(table.platform, table.taxonomy),
    index("pub_media_area_idx").on(table.area),
    index("pub_media_active_price_idx").on(
      table.isActive,
      table.priceTenThousandths,
    ),
    index("pub_media_active_kind_price_id_idx").on(
      table.isActive,
      table.mediaKind,
      table.priceTenThousandths,
      table.id,
    ),
    index("pub_media_active_kind_platform_tax_idx").on(
      table.isActive,
      table.mediaKind,
      table.platform,
      table.taxonomy,
      table.id,
    ),
    index("pub_media_active_kind_area_id_idx").on(
      table.isActive,
      table.mediaKind,
      table.area,
      table.id,
    ),
    index("pub_media_logo_archive_idx").on(
      table.logoArchiveStatus,
      table.updatedAt,
    ),
  ],
);

const publisherMediaLogoAssets = mysqlTable(
  "publisher_media_logo_assets",
  {
    mediaResourceId: id("media_resource_id").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    sourceKind: mysqlEnum(
      "source_kind",
      publisherMediaLogoSourceKinds,
    ).notNull(),
    objectKey: varchar("object_key", { length: 1_024 }).notNull(),
    contentType: varchar("content_type", { length: 120 }).notNull(),
    sizeBytes: bigint("size_bytes", {
      mode: "bigint",
      unsigned: true,
    }).notNull(),
    catalogRevision: varchar("catalog_revision", { length: 64 }).notNull(),
    reviewAudit: json("review_audit").$type<PublisherMediaLogoReviewAudit>(),
    archivedAt: datetime("archived_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "pub_media_logo_assets_media_fk",
      columns: [table.mediaResourceId],
      foreignColumns: [publisherMediaResources.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.mediaResourceId, table.sha256] }),
    index("pub_media_logo_asset_sha_idx").on(table.sha256),
  ],
);

const publisherMediaLogoResolutions = mysqlTable(
  "publisher_media_logo_resolutions",
  {
    id: id("id").primaryKey(),
    syncRunId: id("sync_run_id").notNull(),
    mediaResourceId: id("media_resource_id").notNull(),
    candidateHash: varchar("candidate_hash", { length: 64 }).notNull(),
    status: mysqlEnum("status", publisherMediaLogoArchiveStatuses).notNull(),
    sourceKind: mysqlEnum("source_kind", publisherMediaLogoSourceKinds),
    logoSha256: varchar("logo_sha256", { length: 64 }),
    errorCode: varchar("error_code", { length: 120 }),
    reviewAudit: json("review_audit").$type<PublisherMediaLogoReviewAudit>(),
    checkedAt: datetime("checked_at", { mode: "date", fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "pub_media_logo_resolutions_run_fk",
      columns: [table.syncRunId],
      foreignColumns: [publisherMediaSyncRuns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pub_media_logo_resolutions_media_fk",
      columns: [table.mediaResourceId],
      foreignColumns: [publisherMediaResources.id],
    }).onDelete("cascade"),
    uniqueIndex("pub_media_logo_resolution_run_media_uq").on(
      table.syncRunId,
      table.mediaResourceId,
    ),
    index("pub_media_logo_resolution_run_status_idx").on(
      table.syncRunId,
      table.status,
      table.sourceKind,
    ),
  ],
);

const publisherMediaSyncStaging = mysqlTable(
  "publisher_media_sync_staging",
  {
    runId: id("run_id")
      .notNull()
      .references(() => publisherMediaSyncRuns.id, { onDelete: "cascade" }),
    externalResourceId: varchar("external_resource_id", {
      length: 128,
    }).notNull(),
    page: int("page", { unsigned: true }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    mediaKind: mysqlEnum("media_kind", publisherMediaKinds),
    platform: varchar("platform", { length: 120 }),
    taxonomy: varchar("taxonomy", { length: 120 }),
    mediaType: varchar("media_type", { length: 120 }),
    area: varchar("area", { length: 120 }),
    caseUrl: text("case_url"),
    titleLimit: int("title_limit", { unsigned: true }),
    priceTenThousandths: bigint("price_ten_thousandths", {
      mode: "bigint",
      unsigned: true,
    }).notNull(),
    successRateBasisPoints: int("success_rate_basis_points", {
      unsigned: true,
    }),
    includeRateBasisPoints: int("include_rate_basis_points", {
      unsigned: true,
    }),
    pcWeight: int("pc_weight", { unsigned: true }),
    mobileWeight: int("mobile_weight", { unsigned: true }),
    includeType: varchar("include_type", { length: 120 }),
    publishSpeed: varchar("publish_speed", { length: 120 }),
    entryUrl: text("entry_url"),
    entryLevel: varchar("entry_level", { length: 120 }),
    linkType: varchar("link_type", { length: 120 }),
    providerLogoUrl: text("logo_url"),
    providerIconUrl: text("provider_icon_url"),
    logoCandidateHash: varchar("logo_candidate_hash", { length: 64 }).notNull(),
    remark: text("remark"),
    description: text("description"),
    recommended: boolean("recommended"),
    authenticated: boolean("authenticated"),
    festivalPublishable: boolean("festival_publishable"),
    fanCount: bigint("fan_count", { mode: "bigint", unsigned: true }),
    likeCount: bigint("like_count", { mode: "bigint", unsigned: true }),
    publishCount: bigint("publish_count", { mode: "bigint", unsigned: true }),
    rawPayload: json("raw_payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    stagedAt: datetime("staged_at", { mode: "date", fsp: 3 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.externalResourceId] }),
    index("pub_media_staging_run_page_idx").on(table.runId, table.page),
  ],
);

const publisherMediaCapabilities = mysqlTable(
  "publisher_media_capabilities",
  {
    id: id("id").primaryKey(),
    mediaResourceId: id("media_resource_id")
      .notNull()
      .references(() => publisherMediaResources.id, { onDelete: "cascade" }),
    imageSupport: mysqlEnum("image_support", publisherImageSupportStatuses)
      .notNull()
      .default("unknown"),
    contentProfile: varchar("content_profile", { length: 64 })
      .notNull()
      .default("unknown"),
    verifiedMediaType: varchar("verified_media_type", { length: 120 }),
    evidenceUrl: text("evidence_url"),
    verifiedAt: datetime("verified_at", { mode: "date", fsp: 3 }),
    verifiedBy: id("verified_by").references(() => core.users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("pub_media_capability_resource_uq").on(table.mediaResourceId),
    index("pub_media_capability_image_idx").on(table.imageSupport),
  ],
);

const publisherRuntimeState = mysqlTable("publisher_runtime_state", {
  id: varchar("id", { length: 32 }).primaryKey(),
  mode: mysqlEnum("mode", publicationModes).notNull().default("mock"),
  featureEnabled: boolean("feature_enabled").notNull().default(false),
  publishEnabled: boolean("publish_enabled").notNull().default(false),
  imagePublishEnabled: boolean("image_publish_enabled")
    .notNull()
    .default(false),
  webhookEnabled: boolean("webhook_enabled").notNull().default(false),
  emergencyStop: boolean("emergency_stop").notNull().default(false),
  credentialStatus: mysqlEnum("credential_status", publisherCredentialStatuses)
    .notNull()
    .default("unconfigured"),
  credentialVerifiedAt: datetime("credential_verified_at", {
    mode: "date",
    fsp: 3,
  }),
  credentialFailedAt: datetime("credential_failed_at", {
    mode: "date",
    fsp: 3,
  }),
  activeCatalogRevision: varchar("active_catalog_revision", { length: 64 }),
  catalogSyncedAt: datetime("catalog_synced_at", { mode: "date", fsp: 3 }),
  catalogKindComplete: boolean("catalog_kind_complete")
    .notNull()
    .default(false),
  changedBy: id("changed_by").references(() => core.users.id, {
    onDelete: "set null",
  }),
  updatedAt: updatedAt(),
});

const publisherLiveWhitelist = mysqlTable("publisher_live_whitelist", {
  mediaResourceId: id("media_resource_id")
    .primaryKey()
    .references(() => publisherMediaResources.id, { onDelete: "cascade" }),
  imageAllowed: boolean("image_allowed").notNull().default(false),
  reason: varchar("reason", { length: 240 }).notNull(),
  enabledBy: id("enabled_by").references(() => core.users.id, {
    onDelete: "set null",
  }),
  enabledAt: datetime("enabled_at", { mode: "date", fsp: 3 }).notNull(),
  updatedAt: updatedAt(),
});

const publisherDrafts = mysqlTable(
  "publisher_drafts",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    articleVersionId: id("article_version_id").notNull(),
    status: mysqlEnum("status", publisherDraftStatuses)
      .notNull()
      .default("draft"),
    revision: int("revision", { unsigned: true }).notNull().default(0),
    titleMode: mysqlEnum("title_mode", publisherTitleModes)
      .notNull()
      .default("per_media"),
    sharedTitle: varchar("shared_title", { length: 200 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pub_drafts_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_drafts_id_owner_uq").on(table.id, table.ownerId),
    index("pub_drafts_owner_updated_idx").on(table.ownerId, table.updatedAt),
    foreignKey({
      name: "pub_drafts_version_owner_fk",
      columns: [table.articleVersionId, table.ownerId],
      foreignColumns: [
        publisherArticleVersions.id,
        publisherArticleVersions.ownerId,
      ],
    }).onDelete("restrict"),
  ],
);

const publisherPreflights = mysqlTable(
  "publisher_preflights",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "cascade" }),
    draftId: id("draft_id").notNull(),
    draftRevision: int("draft_revision", { unsigned: true }).notNull(),
    quoteFingerprint: varchar("quote_fingerprint", { length: 64 }).notNull(),
    snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
    mode: mysqlEnum("mode", publicationModes).notNull(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    consumedAt: datetime("consumed_at", { mode: "date", fsp: 3 }),
    createdAt: createdAt(),
  },
  (table) => [
    index("pub_preflights_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_preflights_id_owner_uq").on(table.id, table.ownerId),
    index("pub_preflights_owner_expiry_idx").on(table.ownerId, table.expiresAt),
    foreignKey({
      name: "pub_preflights_draft_owner_fk",
      columns: [table.draftId, table.ownerId],
      foreignColumns: [publisherDrafts.id, publisherDrafts.ownerId],
    }).onDelete("cascade"),
  ],
);

const publisherDraftItems = mysqlTable(
  "publisher_draft_items",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    draftId: id("draft_id").notNull(),
    mediaResourceId: id("media_resource_id")
      .notNull()
      .references(() => publisherMediaResources.id, { onDelete: "restrict" }),
    externalResourceId: varchar("external_resource_id", {
      length: 128,
    }).notNull(),
    submissionTitle: varchar("submission_title", { length: 200 }).notNull(),
    selectedPriceTenThousandths: bigint("selected_price_ten_thousandths", {
      mode: "bigint",
      unsigned: true,
    }).notNull(),
    selectedCatalogRevision: varchar("selected_catalog_revision", {
      length: 64,
    }).notNull(),
    mediaKindSnapshot: mysqlEnum(
      "media_kind_snapshot",
      publisherHistoricalMediaKinds,
    )
      .notNull()
      .default("unknown"),
    mediaSnapshot: json("media_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    selectedAt: datetime("selected_at", { mode: "date", fsp: 3 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pub_draft_items_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_draft_items_id_owner_uq").on(table.id, table.ownerId),
    uniqueIndex("pub_draft_items_draft_media_uq").on(
      table.draftId,
      table.mediaResourceId,
    ),
    index("pub_draft_items_media_idx").on(table.mediaResourceId),
    foreignKey({
      name: "pub_draft_items_draft_owner_fk",
      columns: [table.draftId, table.ownerId],
      foreignColumns: [publisherDrafts.id, publisherDrafts.ownerId],
    }).onDelete("cascade"),
  ],
);

const publisherBatches = mysqlTable(
  "publisher_batches",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    draftId: id("draft_id").notNull(),
    articleVersionId: id("article_version_id").notNull(),
    status: mysqlEnum("status", publisherBatchStatuses)
      .notNull()
      .default("queued"),
    fundsStatus: mysqlEnum("funds_status", publisherFundsStatuses)
      .notNull()
      .default("reserved"),
    mode: mysqlEnum("mode", publicationModes).notNull(),
    quotedTotalTenThousandths: bigint("quoted_total_ten_thousandths", {
      mode: "bigint",
      unsigned: true,
    }).notNull(),
    quoteFingerprint: varchar("quote_fingerprint", { length: 64 }).notNull(),
    preflightRevision: varchar("preflight_revision", { length: 128 }).notNull(),
    preflightSnapshot: json("preflight_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 191 }).notNull(),
    liveConfirmationAccepted: boolean("live_confirmation_accepted")
      .notNull()
      .default(false),
    titleMode: mysqlEnum("title_mode", publisherTitleModes)
      .notNull()
      .default("per_media"),
    confirmedAt: datetime("confirmed_at", { mode: "date", fsp: 3 }),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pub_batches_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_batches_id_owner_uq").on(table.id, table.ownerId),
    uniqueIndex("pub_batches_owner_idempotency_uq").on(
      table.ownerId,
      table.idempotencyKey,
    ),
    uniqueIndex("pub_batches_owner_draft_uq").on(table.ownerId, table.draftId),
    index("pub_batches_owner_created_idx").on(table.ownerId, table.createdAt),
    index("pub_batches_status_updated_idx").on(table.status, table.updatedAt),
    foreignKey({
      name: "pub_batches_draft_owner_fk",
      columns: [table.draftId, table.ownerId],
      foreignColumns: [publisherDrafts.id, publisherDrafts.ownerId],
    }).onDelete("restrict"),
    foreignKey({
      name: "pub_batches_version_owner_fk",
      columns: [table.articleVersionId, table.ownerId],
      foreignColumns: [
        publisherArticleVersions.id,
        publisherArticleVersions.ownerId,
      ],
    }).onDelete("restrict"),
  ],
);

const publisherItems = mysqlTable(
  "publisher_items",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    batchId: id("batch_id").notNull(),
    mediaResourceId: id("media_resource_id")
      .notNull()
      .references(() => publisherMediaResources.id, { onDelete: "restrict" }),
    externalResourceId: varchar("external_resource_id", {
      length: 128,
    }).notNull(),
    mediaNameSnapshot: varchar("media_name_snapshot", {
      length: 255,
    }).notNull(),
    mediaKindSnapshot: mysqlEnum(
      "media_kind_snapshot",
      publisherHistoricalMediaKinds,
    )
      .notNull()
      .default("unknown"),
    mediaMetadataSnapshot: json("media_metadata_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    submissionTitle: varchar("submission_title", { length: 200 }).notNull(),
    articleContentHash: varchar("article_content_hash", {
      length: 64,
    }).notNull(),
    catalogRevision: varchar("catalog_revision", { length: 64 }).notNull(),
    preflightBlockers: json("preflight_blockers")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    preflightWarnings: json("preflight_warnings")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    submissionKey: varchar("submission_key", { length: 191 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }),
    status: mysqlEnum("status", publisherItemStatuses)
      .notNull()
      .default("queued"),
    fundsStatus: mysqlEnum("funds_status", publisherFundsStatuses)
      .notNull()
      .default("reserved"),
    externalOrderId: varchar("external_order_id", { length: 191 }),
    externalManuscriptId: varchar("external_manuscript_id", { length: 191 }),
    reportedOrderPriceTenThousandths: bigint(
      "reported_order_price_ten_thousandths",
      { mode: "bigint", unsigned: true },
    ),
    publishedUrl: text("published_url"),
    failureReason: text("failure_reason"),
    actionRequiredReason: text("action_required_reason"),
    attemptCount: int("attempt_count", { unsigned: true }).notNull().default(0),
    submittedAt: datetime("submitted_at", { mode: "date", fsp: 3 }),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
    lastPolledAt: datetime("last_polled_at", { mode: "date", fsp: 3 }),
    nextPollAt: datetime("next_poll_at", { mode: "date", fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("pub_items_enterprise_idx").on(
      table.ownerId,
      table.enterpriseProjectId,
    ),
    uniqueIndex("pub_items_id_owner_uq").on(table.id, table.ownerId),
    uniqueIndex("pub_items_submission_key_uq").on(table.submissionKey),
    uniqueIndex("pub_items_batch_media_uq").on(
      table.batchId,
      table.mediaResourceId,
    ),
    uniqueIndex("pub_items_external_order_uq").on(table.externalOrderId),
    index("pub_items_status_next_poll_idx").on(table.status, table.nextPollAt),
    index("pub_items_batch_status_idx").on(table.batchId, table.status),
    foreignKey({
      name: "pub_items_batch_owner_fk",
      columns: [table.batchId, table.ownerId],
      foreignColumns: [publisherBatches.id, publisherBatches.ownerId],
    }).onDelete("cascade"),
  ],
);

const publisherSubmissionAttempts = mysqlTable(
  "publisher_submission_attempts",
  {
    id: id("id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    itemId: id("item_id").notNull(),
    attemptNumber: int("attempt_number", { unsigned: true }).notNull(),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }).notNull(),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
    result: mysqlEnum("result", publisherAttemptResults),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    httpStatus: int("http_status", { unsigned: true }),
    responseRedacted:
      json("response_redacted").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 64 }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("pub_attempts_item_number_uq").on(
      table.itemId,
      table.attemptNumber,
    ),
    index("pub_attempts_started_idx").on(table.startedAt),
    foreignKey({
      name: "pub_attempts_item_owner_fk",
      columns: [table.itemId, table.ownerId],
      foreignColumns: [publisherItems.id, publisherItems.ownerId],
    }).onDelete("cascade"),
  ],
);

const publisherReconciliationCandidates = mysqlTable(
  "publisher_reconciliation_candidates",
  {
    id: id("id").primaryKey(),
    itemId: id("item_id")
      .notNull()
      .references(() => publisherItems.id, { onDelete: "cascade" }),
    externalOrderId: varchar("external_order_id", { length: 191 }).notNull(),
    confidenceBasisPoints: int("confidence_basis_points", {
      unsigned: true,
    }).notNull(),
    evidence: json("evidence").$type<Record<string, unknown>>().notNull(),
    boundAt: datetime("bound_at", { mode: "date", fsp: 3 }),
    boundBy: id("bound_by").references(() => core.users.id, {
      onDelete: "set null",
    }),
    rejectedAt: datetime("rejected_at", { mode: "date", fsp: 3 }),
    rejectedBy: id("rejected_by").references(() => core.users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("pub_reconcile_item_order_uq").on(
      table.itemId,
      table.externalOrderId,
    ),
    index("pub_reconcile_unresolved_idx").on(table.boundAt, table.rejectedAt),
  ],
);

const publisherJobs = mysqlTable(
  "publisher_jobs",
  {
    enterpriseProjectId: id("enterprise_project_id").$defaultFn(
      () => core.currentMonitoringEnterpriseProjectId() ?? sql`NULL`,
    ),
    id: id("id").primaryKey(),
    type: mysqlEnum("type", publisherJobTypes).notNull(),
    status: mysqlEnum("status", publisherJobStatuses)
      .notNull()
      .default("ready"),
    deterministicKey: varchar("deterministic_key", { length: 191 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 191 }).notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    availableAt: datetime("available_at", { mode: "date", fsp: 3 }).notNull(),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAt: datetime("lease_expires_at", { mode: "date", fsp: 3 }),
    attempts: int("attempts", { unsigned: true }).notNull().default(0),
    maxAttempts: int("max_attempts", { unsigned: true }).notNull().default(20),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    lastErrorMessage: text("last_error_message"),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("pub_jobs_deterministic_key_uq").on(table.deterministicKey),
    index("pub_jobs_claim_idx").on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    index("pub_jobs_type_aggregate_idx").on(table.type, table.aggregateId),
  ],
);

const publisherSubmissionGate = mysqlTable(
  "publisher_submission_gate",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAt: datetime("lease_expires_at", { mode: "date", fsp: 3 }),
    nextAllowedAt: datetime("next_allowed_at", {
      mode: "date",
      fsp: 3,
    }).notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [index("pub_submission_gate_lease_idx").on(table.leaseExpiresAt)],
);

const publisherWebhookEvents = mysqlTable(
  "publisher_webhook_events",
  {
    id: id("id").primaryKey(),
    provider: varchar("provider", { length: 64 }).notNull().default("kol"),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    rawPayload: json("raw_payload").$type<Record<string, unknown>>().notNull(),
    signatureStatus: mysqlEnum(
      "signature_status",
      publisherWebhookSignatureStatuses,
    )
      .notNull()
      .default("not_configured"),
    status: mysqlEnum("status", publisherWebhookEventStatuses)
      .notNull()
      .default("received"),
    receivedAt: datetime("received_at", { mode: "date", fsp: 3 }).notNull(),
    processedAt: datetime("processed_at", { mode: "date", fsp: 3 }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("pub_webhooks_provider_hash_uq").on(
      table.provider,
      table.payloadHash,
    ),
    index("pub_webhooks_status_received_idx").on(
      table.status,
      table.receivedAt,
    ),
  ],
);

const publisherWebhookItems = mysqlTable(
  "publisher_webhook_items",
  {
    id: id("id").primaryKey(),
    eventId: id("event_id")
      .notNull()
      .references(() => publisherWebhookEvents.id, { onDelete: "cascade" }),
    externalOrderId: varchar("external_order_id", { length: 191 }),
    itemId: id("item_id").references(() => publisherItems.id, {
      onDelete: "set null",
    }),
    rawItem: json("raw_item").$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum("status", ["matched", "unmatched", "queued"] as const)
      .notNull()
      .default("unmatched"),
    createdAt: createdAt(),
  },
  (table) => [
    index("pub_webhook_items_event_idx").on(table.eventId),
    index("pub_webhook_items_order_idx").on(table.externalOrderId),
  ],
);

/** Both domains lock the same account. Legacy wallet tables remain migration evidence. */
const mediaPublishingItemPriceSnapshots = mysqlTable(
  "media_publishing_item_price_snapshots",
  {
    itemId: id("item_id").primaryKey(),
    ownerId: id("owner_id")
      .notNull()
      .references(() => core.users.id, { onDelete: "restrict" }),
    mediaResourceId: id("media_resource_id")
      .notNull()
      .references(() => publisherMediaResources.id, { onDelete: "restrict" }),
    catalogRevision: varchar("catalog_revision", { length: 64 }).notNull(),
    externalResourceId: varchar("external_resource_id", {
      length: 128,
    }).notNull(),
    amountTenThousandths: bigint("amount_ten_thousandths", {
      mode: "bigint",
      unsigned: true,
    }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("CNY"),
    providerPayloadHash: varchar("provider_payload_hash", {
      length: 64,
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("media_pub_price_owner_idx").on(table.ownerId),
    foreignKey({
      name: "media_pub_price_item_owner_fk",
      columns: [table.itemId, table.ownerId],
      foreignColumns: [publisherItems.id, publisherItems.ownerId],
    }).onDelete("cascade"),
  ],
);


return { mediaPublishingItemPriceSnapshots, publisherArticles, publisherDocxImports, publisherArticleVersions, publisherArticleAssets, publisherArticleVersionAssets, publisherObjectLeases, publisherMediaSyncRuns, publisherMediaResources, publisherMediaLogoAssets, publisherMediaLogoResolutions, publisherMediaSyncStaging, publisherMediaCapabilities, publisherRuntimeState, publisherLiveWhitelist, publisherDrafts, publisherPreflights, publisherDraftItems, publisherBatches, publisherItems, publisherSubmissionAttempts, publisherReconciliationCandidates, publisherJobs, publisherSubmissionGate, publisherWebhookEvents, publisherWebhookItems };
}
export type PublishSchema = ReturnType<typeof createPublishSchema>;
