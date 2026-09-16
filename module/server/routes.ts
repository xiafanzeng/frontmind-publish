import { accountActivityInputSchema, accountActivityOutputSchema, accountActivityPageInputSchema, accountActivityPageOutputSchema } from "@frontmind/monitoring-contracts";
import {
  adminBankTransferOutputSchema,
  adminBillingAdjustmentInputSchema,
  adminBillingUserOutputSchema,
  adminAuditOutputSchema,
  adminCreateUserInputSchema,
  adminOperationDetailOutputSchema,
  adminOperationsListInputSchema,
  adminOperationsListOutputSchema,
  adminOverviewOutputSchema,
  adminProviderCostOutputSchema,
  adminResetPasswordInputSchema,
  adminRunListOutputSchema,
  adminSetUserStatusInputSchema,
  adminUserListOutputSchema,
  adminUserViewSchema,
  authMeOutputSchema,
  auditListInputSchema,
  approveBankTransferInputSchema,
  bankTransferReviewOutputSchema,
  booleanResultOutputSchemas,
  billingLedgerEntryOutputSchema,
  billingMonitorQuoteInputSchema,
  billingMonitorQuoteOutputSchema,
  billingQuoteInputSchema,
  billingQuoteOutputSchema,
  billingSummaryOutputSchema,
  changePasswordInputSchema,
  createTopupOrderInputSchema,
  createTopupOrderOutputSchema,
  deletedMonitorOutputSchema,
  deletedProjectOutputSchema,
  deletedRunOutputSchema,
  idSchema,
  listInputSchema,
  mediaPublishingAdminAdjustmentInputSchema,
  mediaPublishingAdminBankReviewInputSchema,
  mediaPublishingAdminBankReviewOutputSchema,
  mediaPublishingAdminUserOutputSchema,
  mediaPublishingBankTransferReviewOutputSchema,
  mediaPublishingBillingSummaryOutputSchema,
  mediaPublishingCreateTopupOrderInputSchema,
  mediaPublishingCreateTopupOrderOutputSchema,
  mediaPublishingLedgerEntryOutputSchema,
  mediaPublishingSubmitBankTransferReviewInputSchema,
  mediaPublishingSwitchTopupPaymentMethodInputSchema,
  mediaPublishingTopupListInputSchema,
  mediaPublishingTopupListOutputSchema,
  mediaPublishingTopupOrderOutputSchema,
  mediaPublishingTopupStatusInputSchema,
  mediaPublishingTopupStatusOutputSchema,
  monitoringAnalysisInputSchema,
  monitoringAnalysisOutputSchema,
  monitoringAnswerDetailOutputSchema,
  monitoringAnswerGetInputSchema,
  monitoringAnswersListInputSchema,
  monitoringAnswersListOutputSchema,
  monitoringScopeSchema,
  monitoringSummaryOutputSchema,
  monitorCreateInputSchema,
  monitorDetailOutputSchema,
  monitorListOutputSchema,
  monitorMutationOutputSchema,
  monitorUpdateInputSchema,
  paymentMethodsOutputSchema,
  platformAcceptanceBatchOutputSchema,
  platformAcceptanceGetInputSchema,
  platformAcceptanceListInputSchema,
  platformAcceptancePlanInputSchema,
  platformAcceptancePlanOutputSchema,
  platformAcceptanceStartInputSchema,
  platformCapabilityInputSchema,
  platformOutputSchema,
  pricingOutputSchema,
  projectBrandUpdateInputSchema,
  projectCreateInputSchema,
  projectOutputSchema,
  projectUpdateInputSchema,
  publisherAdminEmergencyStopInputSchema,
  publisherAdminCapabilityOutputSchema,
  publisherAdminCatalogRunOutputSchema,
  publisherAdminCatalogSyncRequestOutputSchema,
  publisherAdminLiveWhitelistInputSchema,
  publisherAdminMediaCapabilityInputSchema,
  publisherAdminReconciliationCandidateOutputSchema,
  publisherAdminRuntimeUpdateInputSchema,
  publisherAdminUnknownItemOutputSchema,
  publisherAdminUnknownBindInputSchema,
  publisherAdminUnknownResubmitInputSchema,
  publisherArticleAssetOutputSchema,
  publisherArticleAssetsInputSchema,
  publisherArticleListInputSchema,
  publisherArticleListOutputSchema,
  publisherArticleOutputSchema,
  publisherArticleVersionOutputSchema,
  publisherBatchInputSchema,
  publisherBatchListInputSchema,
  publisherBatchListOutputSchema,
  publisherBatchOutputSchema,
  publisherCreateArticleInputSchema,
  publisherDashboardOutputSchema,
  publisherDocxImportOutputSchema,
  publisherDraftInputSchema,
  publisherDraftOutputSchema,
  publisherFreezeArticleInputSchema,
  publisherImportListInputSchema,
  publisherImportListOutputSchema,
  publisherImportStatusInputSchema,
  publisherMediaListInputSchema,
  publisherMediaListOutputSchema,
  publisherMediaFacetsInputSchema,
  publisherMediaFacetsOutputSchema,
  publisherPreflightInputSchema,
  publisherPreflightOutputSchema,
  publisherRefreshDraftMediaInputSchema,
  publisherRuntimeOutputSchema,
  publisherSaveArticleInputSchema,
  publisherSaveDraftInputSchema,
  publisherSaveDraftTitlesInputSchema,
  publisherSubmitInputSchema,
  publisherSubmitOutputSchema,
  rejectBankTransferInputSchema,
  regionOutputSchema,
  runCreationResultOutputSchema,
  runDetailOutputSchema,
  runListOutputSchema,
  runNowInputSchema,
  runRecordOutputSchema,
  submitBankTransferReviewInputSchema,
  submitBankTransferReviewOutputSchema,
  switchTopupPaymentMethodInputSchema,
  switchTopupPaymentMethodOutputSchema,
  topupOrderOutputSchema,
  topupStatusInputSchema,
  topupStatusOutputSchema,
} from "@frontmind/monitoring-contracts";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { RepositoryError } from "@frontmind/module-contracts/errors";
import { canonicalizePublisherHtml, publisherCanonicalImageReferences } from "./domain/canonical-html.js";
import type { PublishRouteContext, PublishRouteCore, PublishingRepository } from "./route-core.js";

export function createPublishRoutes<Context extends object>(core: PublishRouteCore<Context>) {
const t = initTRPC.context<Context>().create();
const publisherCustomerProcedure = t.procedure.use(async ({ ctx, next }) => next({ ctx: { ...ctx, ...await core.authorize(ctx as unknown as Context, "customer") } }));
const publisherAdminProcedure = t.procedure.use(async ({ ctx, next }) => next({ ctx: { ...ctx, ...await core.authorize(ctx as unknown as Context, "admin") } }));


const publisherRouter = t.router({
  dashboard: publisherCustomerProcedure
    .output(publisherDashboardOutputSchema)
    .query(({ ctx }) =>
      translateRepositoryErrors(() =>
        ctx.publishingRepository.getPublisherDashboard(ctx.user.id),
      ),
    ),
  articles: t.router({
    list: publisherCustomerProcedure
      .input(publisherArticleListInputSchema)
      .output(publisherArticleListOutputSchema)
      .query(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const rows = await ctx.publishingRepository.listPublisherArticles(
            ctx.user.id,
            input,
          );
          const hasMore = rows.length > input.limit;
          const page = rows.slice(0, input.limit);
          return {
            items: await Promise.all(
              page.map((article) =>
                publicPublisherArticleSummary(
                  ctx.publishingRepository,
                  ctx.user.id,
                  article,
                ),
              ),
            ),
            nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
          };
        }),
      ),
    create: publisherCustomerProcedure
      .input(publisherCreateArticleInputSchema)
      .output(publisherArticleOutputSchema)
      .mutation(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const created = await ctx.publishingRepository.createPublisherArticle(
            ctx.user.id,
            input.workingName,
          );
          return publicPublisherArticle(
            ctx.publishingRepository,
            ctx.user.id,
            created,
          );
        }),
      ),
    get: publisherCustomerProcedure
      .input(publisherArticleAssetsInputSchema)
      .output(publisherArticleOutputSchema)
      .query(({ ctx, input }) =>
        translateRepositoryErrors(async () =>
          publicPublisherArticle(
            ctx.publishingRepository,
            ctx.user.id,
            await ctx.publishingRepository.getPublisherArticle(
              ctx.user.id,
              input.articleId,
            ),
          ),
        ),
      ),
    save: publisherCustomerProcedure
      .input(publisherSaveArticleInputSchema)
      .output(publisherArticleOutputSchema)
      .mutation(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          if (
            !input.editorJson ||
            typeof input.editorJson !== "object" ||
            Array.isArray(input.editorJson)
          ) {
            throw new RepositoryError(
              "INVALID_STATE",
              "Article editor state must be an object",
            );
          }
          const [article, assets] = await Promise.all([
            ctx.publishingRepository.getPublisherArticle(
              ctx.user.id,
              input.articleId,
            ),
            ctx.publishingRepository.listPublisherArticleAssets(
              ctx.user.id,
              input.articleId,
            ),
          ]);
          const allowedImageSourcesByAssetId = new Map(
            assets.map((asset) => [
              asset.id,
              new Set([
                new URL(
                  `/api/monitoring/publisher/public-assets/${asset.id}/${ctx.signAsset({
                      ownerId: ctx.user.id,
                      articleId: input.articleId,
                      assetSha256: asset.sha256,
                    },
                  )}`,
                  ctx.config.PUBLIC_ORIGIN,
                ).toString(),
              ]),
            ]),
          );
          await Promise.all(
            publisherCanonicalImageReferences(article.canonicalHtml ?? "").map(
              async ({ assetId, source }) => {
                const sources = allowedImageSourcesByAssetId.get(assetId);
                if (!sources) return;
                const capability = publisherAssetCapabilityFromExactUrl(
                  source,
                  assetId,
                  ctx.config.PUBLIC_ORIGIN,
                );
                if (!capability) return;
                const trusted =
                  await ctx.publishingRepository.getPublicPublisherAsset(
                    assetId,
                    capability,
                  );
                if (trusted?.id === assetId) sources.add(source);
              },
            ),
          );
          const canonical = canonicalizePublisherHtml(input.canonicalHtml, {
            allowedAssetIds: assets.map(({ id }) => id),
            allowedImageSourcesByAssetId,
          });
          if (canonical.blockingIssues.length) {
            throw new RepositoryError(
              "INVALID_STATE",
              canonical.blockingIssues[0]?.message ??
                "Article content failed security validation",
            );
          }
          await ctx.publishingRepository.savePublisherArticle(ctx.user.id, {
            articleId: input.articleId,
            expectedRevision: input.expectedRevision,
            workingName: input.workingName,
            suggestedTitle: input.suggestedTitle,
            editorJson: input.editorJson as Record<string, unknown>,
            canonicalHtml: canonical.canonicalHtml,
            plainText: canonical.plainText,
            containsImages: canonical.containsImages,
          });
          return publicPublisherArticle(
            ctx.publishingRepository,
            ctx.user.id,
            await ctx.publishingRepository.getPublisherArticle(
              ctx.user.id,
              input.articleId,
            ),
          );
        }),
      ),
    freeze: publisherCustomerProcedure
      .input(publisherFreezeArticleInputSchema)
      .output(publisherArticleVersionOutputSchema)
      .mutation(({ ctx, input }) =>
        translateRepositoryErrors(() =>
          ctx.publishingRepository.freezePublisherArticle(ctx.user.id, {
            ...input,
            actorId: ctx.user.id,
          }),
        ),
      ),
    versions: publisherCustomerProcedure
      .input(publisherArticleAssetsInputSchema)
      .output(z.array(publisherArticleVersionOutputSchema))
      .query(({ ctx, input }) =>
        translateRepositoryErrors(() =>
          ctx.publishingRepository.listPublisherArticleVersions(
            ctx.user.id,
            input.articleId,
          ),
        ),
      ),
    assets: publisherCustomerProcedure
      .input(publisherArticleAssetsInputSchema)
      .output(z.array(publisherArticleAssetOutputSchema))
      .query(({ ctx, input }) =>
        translateRepositoryErrors(async () =>
          (
            await ctx.publishingRepository.listPublisherArticleAssets(
              ctx.user.id,
              input.articleId,
            )
          ).map((asset) => ({
            ...asset,
            mimeType: publisherAssetMimeType(asset.mimeType),
          })),
        ),
      ),
  }),
  imports: t.router({
    list: publisherCustomerProcedure
      .input(publisherImportListInputSchema)
      .output(publisherImportListOutputSchema)
      .query(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const rows = await ctx.publishingRepository.listPublisherDocxImports(
            ctx.user.id,
            input,
          );
          const hasMore = rows.length > input.limit;
          const page = rows.slice(0, input.limit);
          return {
            items: page.map(publicPublisherImport),
            nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
          };
        }),
      ),
    get: publisherCustomerProcedure
      .input(publisherImportStatusInputSchema)
      .output(publisherDocxImportOutputSchema)
      .query(({ ctx, input }) =>
        translateRepositoryErrors(async () =>
          publicPublisherImport(
            await ctx.publishingRepository.getPublisherDocxImport(
              ctx.user.id,
              input.importId,
            ),
          ),
        ),
      ),
  }),
  media: t.router({
    list: publisherCustomerProcedure
      .input(publisherMediaListInputSchema)
      .output(publisherMediaListOutputSchema)
      .query(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const result =
            await ctx.publishingRepository.listPublisherMedia(input);
          const runtime =
            await ctx.publishingRepository.getPublisherRuntimeState();
          const syncedAt = runtime?.catalogSyncedAt ?? null;
          return {
            ...result,
            nextCursor:
              result.legacyCursorMode && result.hasMore
                ? (result.items.at(-1)?.id ?? null)
                : null,
            catalogRevision: runtime?.activeCatalogRevision ?? null,
            catalogSyncedAt: syncedAt,
            catalogStale:
              !syncedAt || Date.now() - syncedAt.getTime() > 12 * 60 * 60_000,
            kindComplete: runtime?.catalogKindComplete ?? false,
          };
        }),
      ),
    facets: publisherCustomerProcedure
      .input(publisherMediaFacetsInputSchema)
      .output(publisherMediaFacetsOutputSchema)
      .query(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const [facets, runtime] = await Promise.all([
            ctx.publishingRepository.getPublisherMediaFacets(input ?? {}),
            ctx.publishingRepository.getPublisherRuntimeState(),
          ]);
          return {
            ...facets,
            catalogRevision: runtime?.activeCatalogRevision ?? null,
            catalogSyncedAt: runtime?.catalogSyncedAt ?? null,
            kindComplete: runtime?.catalogKindComplete ?? false,
          };
        }),
      ),
  }),
  drafts: t.router({
    get: publisherCustomerProcedure
      .input(publisherDraftInputSchema)
      .output(publisherDraftOutputSchema)
      .query(({ ctx, input }) =>
        translateRepositoryErrors(() =>
          ctx.publishingRepository.getPublisherDraft(
            ctx.user.id,
            input.draftId,
          ),
        ),
      ),
    save: publisherCustomerProcedure
      .input(publisherSaveDraftInputSchema)
      .output(publisherDraftOutputSchema)
      .mutation(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const saved = await ctx.publishingRepository.savePublisherDraft(
            ctx.user.id,
            input,
          );
          return ctx.publishingRepository.getPublisherDraft(
            ctx.user.id,
            saved.id,
          );
        }),
      ),
    saveTitles: publisherCustomerProcedure
      .input(publisherSaveDraftTitlesInputSchema)
      .output(publisherDraftOutputSchema)
      .mutation(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const saved = await ctx.publishingRepository.savePublisherDraftTitles(
            ctx.user.id,
            input,
          );
          return ctx.publishingRepository.getPublisherDraft(
            ctx.user.id,
            saved.id,
          );
        }),
      ),
    refreshMedia: publisherCustomerProcedure
      .input(publisherRefreshDraftMediaInputSchema)
      .output(publisherDraftOutputSchema)
      .mutation(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const refreshed =
            await ctx.publishingRepository.refreshPublisherDraftMedia(
              ctx.user.id,
              input,
            );
          return ctx.publishingRepository.getPublisherDraft(
            ctx.user.id,
            refreshed.id,
          );
        }),
      ),
    preflight: publisherCustomerProcedure
      .input(publisherPreflightInputSchema)
      .output(publisherPreflightOutputSchema)
      .mutation(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const runtime =
            await ctx.publishingRepository.getPublisherRuntimeState();
          const requiredMode = requirePublisherServerRuntimeMode(runtime);
          const preflight =
            await ctx.publishingRepository.preflightPublisherDraft(
              ctx.user.id,
              input.draftId,
              input.expectedDraftRevision,
              { requiredMode },
            );
          const containsImages =
            preflight.mode !== "mock"
              ? (
                  await ctx.publishingRepository.getPublisherArticleVersion(
                    ctx.user.id,
                    preflight.articleVersionId,
                  )
                ).containsImages
              : false;
          return {
            ...preflight,
            blockers: mergePublisherGateBlockers(
              preflight.blockers,
              publisherEnvironmentGateBlockers(
                ctx,
                preflight.mode,
                containsImages,
              ),
            ),
          };
        }),
      ),
    submit: publisherCustomerProcedure
      .input(publisherSubmitInputSchema)
      .output(publisherSubmitOutputSchema)
      .mutation(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const runtime =
            await ctx.publishingRepository.getPublisherRuntimeState();
          const mode = requirePublisherServerRuntimeMode(runtime);
          const draft = await ctx.publishingRepository.getPublisherDraft(
            ctx.user.id,
            input.draftId,
          );
          const version =
            await ctx.publishingRepository.getPublisherArticleVersion(
              ctx.user.id,
              draft.articleVersionId,
            );
          const containsImages = version.containsImages;
          const blockers = [
            ...publisherEnvironmentGateBlockers(ctx, mode, containsImages),
            ...publisherDatabaseGateBlockers(runtime, mode),
          ];
          if (blockers.length > 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: blockers.map(({ message }) => message).join("; "),
            });
          }
          return ctx.publishingRepository.submitPublisherDraft(
            ctx.user.id,
            input,
            { requiredMode: mode },
          );
        }),
      ),
  }),
  batches: t.router({
    list: publisherCustomerProcedure
      .input(publisherBatchListInputSchema)
      .output(publisherBatchListOutputSchema)
      .query(({ ctx, input }) =>
        translateRepositoryErrors(async () => {
          const result = await ctx.publishingRepository.listPublisherBatches(
            ctx.user.id,
            input,
          );
          return {
            ...result,
            nextCursor:
              result.legacyCursorMode && result.hasMore
                ? (result.items.at(-1)?.id ?? null)
                : null,
          };
        }),
      ),
    get: publisherCustomerProcedure
      .input(publisherBatchInputSchema)
      .output(publisherBatchOutputSchema)
      .query(({ ctx, input }) =>
        translateRepositoryErrors(() =>
          ctx.publishingRepository.getPublisherBatch(
            ctx.user.id,
            input.batchId,
          ),
        ),
      ),
  }),
});
const publisherAdminRouter = t.router({

  runtime: publisherAdminProcedure
    .output(publisherRuntimeOutputSchema)
    .query(({ ctx }) => publicPublisherRuntime(ctx)),

  updateRuntime: publisherAdminProcedure
    .input(publisherAdminRuntimeUpdateInputSchema)
    .output(publisherRuntimeOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await translateRepositoryErrors(() =>
        ctx.publishingRepository.updatePublisherRuntimeState({
          ...input,
          changedBy: ctx.user.id,
        }),
      );
      await ctx.writeAudit(
        ctx.audit,
        "admin.publisher_runtime_updated",
        "publisher_runtime",
        "kol",
        null,
        input,
      );
      return publicPublisherRuntime(ctx);
    }),

  emergencyStop: publisherAdminProcedure
    .input(publisherAdminEmergencyStopInputSchema)
    .output(publisherRuntimeOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await translateRepositoryErrors(() =>
        ctx.publishingRepository.updatePublisherRuntimeState({
          emergencyStop: input.enabled,
          changedBy: ctx.user.id,
        }),
      );
      await ctx.writeAudit(
        ctx.audit,
        input.enabled
          ? "admin.publisher_emergency_stop_enabled"
          : "admin.publisher_emergency_stop_disabled",
        "publisher_runtime",
        "kol",
        null,
        { reason: input.reason },
      );
      return publicPublisherRuntime(ctx);
    }),

  requestCatalogSync: publisherAdminProcedure
    .output(publisherAdminCatalogSyncRequestOutputSchema)
    .mutation(async ({ ctx }) => {
      const result = await translateRepositoryErrors(() =>
        ctx.publishingRepository.requestPublisherCatalogSync(ctx.user.id),
      );
      return { queued: true, syncRunId: result.syncRunId };
    }),

  catalogRuns: publisherAdminProcedure
    .input(listInputSchema.optional())
    .output(z.array(publisherAdminCatalogRunOutputSchema))
    .query(async ({ ctx, input }) => {
      const runs = await ctx.publishingRepository.listPublisherMediaSyncRuns(
        input?.limit ?? 50,
      );
      return runs.map((run) => ({
        id: run.id,
        catalogRevision: run.catalogRevision,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        pagesFetched: run.pagesFetched,
        pagesExpected: run.pagesExpected,
        recordsSeen: run.recordsSeen,
        newsRecords: run.newsRecords,
        selfMediaRecords: run.selfMediaRecords,
        invalidRecords: run.invalidRecords,
        duplicateRecords: run.duplicateRecords,
        crossKindDuplicateRecords: run.crossKindDuplicateRecords,
        recordsChanged: run.recordsChanged,
        logoPending: run.logoPending,
        logoArchived: run.logoArchived,
        logoFailed: run.logoFailed,
        logoProviderArchived: run.logoProviderArchived,
        logoIconArchived: run.logoIconArchived,
        logoSiteFaviconArchived: run.logoSiteFaviconArchived,
        logoWebSearchVerifiedArchived: run.logoWebSearchVerifiedArchived,
        logoManualVerifiedArchived: run.logoManualVerifiedArchived,
        logoPendingReview: run.logoPendingReview,
        logoGeneratedFallback: run.logoGeneratedFallback,
        logoMissing: run.logoMissing,
        logoRealMissing: run.logoRealMissing,
        logoRealCoverageBasisPoints: run.logoRealCoverageBasisPoints,
        stopReason: run.stopReason,
        isComplete: run.isComplete,
      }));
    }),

  capabilities: publisherAdminProcedure
    .input(listInputSchema.optional())
    .output(z.array(publisherAdminCapabilityOutputSchema))
    .query(async ({ ctx, input }) => {
      const rows =
        await ctx.publishingRepository.listPublisherMediaCapabilities(
          input?.limit ?? 100,
        );
      return rows.map((row) => ({
        mediaResourceId: row.mediaResourceId,
        externalResourceId: row.externalResourceId,
        mediaName: row.mediaName,
        priceTenThousandths: row.priceTenThousandths.toString(),
        liveWhitelisted: Boolean(row.liveWhitelistMediaResourceId),
        liveImageAllowed: row.liveImageAllowed === true,
        imageSupport: row.imageSupport ?? "unknown",
        contentProfile: row.contentProfile ?? "unknown",
        evidenceUrl: row.evidenceUrl,
        verifiedAt: row.verifiedAt,
        verifiedBy: row.verifiedBy,
        notes: row.notes,
        updatedAt: row.updatedAt,
      }));
    }),

  setCapability: publisherAdminProcedure
    .input(publisherAdminMediaCapabilityInputSchema)
    .output(booleanResultOutputSchemas.updated)
    .mutation(async ({ ctx, input }) => {
      await translateRepositoryErrors(() =>
        ctx.publishingRepository.setPublisherMediaCapability({
          ...input,
          verifiedBy: ctx.user.id,
        }),
      );
      await ctx.writeAudit(
        ctx.audit,
        "admin.publisher_media_capability_verified",
        "publisher_media",
        input.mediaResourceId,
        null,
        { imageSupport: input.imageSupport, evidenceUrl: input.evidenceUrl },
      );
      return { updated: true };
    }),

  setLiveWhitelist: publisherAdminProcedure
    .input(publisherAdminLiveWhitelistInputSchema)
    .output(booleanResultOutputSchemas.updated)
    .mutation(async ({ ctx, input }) => {
      await translateRepositoryErrors(() =>
        ctx.publishingRepository.setPublisherLiveWhitelist({
          ...input,
          actorId: ctx.user.id,
        }),
      );
      return { updated: true };
    }),

  unknownItems: publisherAdminProcedure
    .input(listInputSchema.optional())
    .output(z.array(publisherAdminUnknownItemOutputSchema))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.publishingRepository.listPublisherUnknownItems(
        input?.limit ?? 100,
      );
      return Promise.all(
        rows.map(async ({ item, price, username }) => ({
          itemId: item.id,
          batchId: item.batchId,
          ownerUsername: username,
          mediaName: item.mediaNameSnapshot,
          submissionTitle: item.submissionTitle,
          status:
            item.status === "submission_unknown"
              ? ("submission_unknown" as const)
              : ("action_required" as const),
          fundsStatus: item.fundsStatus,
          priceTenThousandths: price.amountTenThousandths.toString(),
          actionRequiredReason: item.actionRequiredReason,
          updatedAt: item.updatedAt,
          candidates: (
            await ctx.publishingRepository.listPublisherReconciliationCandidates(
              item.id,
            )
          ).map(publicPublisherReconciliationCandidate),
        })),
      );
    }),

  reconciliationCandidates: publisherAdminProcedure
    .input(z.object({ itemId: idSchema }))
    .output(z.array(publisherAdminReconciliationCandidateOutputSchema))
    .query(async ({ ctx, input }) =>
      (
        await ctx.publishingRepository.listPublisherReconciliationCandidates(
          input.itemId,
        )
      ).map(publicPublisherReconciliationCandidate),
    ),

  bindUnknown: publisherAdminProcedure
    .input(publisherAdminUnknownBindInputSchema)
    .output(booleanResultOutputSchemas.updated)
    .mutation(async ({ ctx, input }) => {
      await translateRepositoryErrors(() =>
        ctx.publishingRepository.bindPublisherReconciliationCandidate({
          ...input,
          actorId: ctx.user.id,
        }),
      );
      return { updated: true };
    }),

  authorizeResubmit: publisherAdminProcedure
    .input(publisherAdminUnknownResubmitInputSchema)
    .output(booleanResultOutputSchemas.updated)
    .mutation(async ({ ctx, input }) => {
      await translateRepositoryErrors(() =>
        ctx.publishingRepository.authorizePublisherResubmit({
          ...input,
          actorId: ctx.user.id,
        }),
      );
      return { updated: true };
    })
});

return { publisherRouter, publisherAdminRouter };
}


async function publicPublisherArticle(
  repository: PublishingRepository,
  ownerId: string,
  article: Parameters<typeof publicPublisherArticleSummary>[2] & {
    editorJson: unknown;
    canonicalHtml: string | null;
    plainText: string | null;
    contentHash: string | null;
  },
) {
  return {
    ...(await publicPublisherArticleSummary(repository, ownerId, article)),
    editorJson: article.editorJson,
    canonicalHtml: article.canonicalHtml,
    plainText: article.plainText,
    contentHash: article.contentHash,
  };
}

function publisherAssetMimeType(value: string): "image/jpeg" | "image/png" {
  if (value === "image/jpeg" || value === "image/png") return value;
  throw new RepositoryError(
    "INVALID_STATE",
    "Stored publisher asset has an invalid MIME type",
  );
}

function publisherAssetCapabilityFromExactUrl(
  source: string,
  assetId: string,
  publicOrigin: string,
): string | null {
  try {
    const url = new URL(source);
    const origin = new URL(publicOrigin);
    if (
      url.origin !== origin.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const prefix = `/api/monitoring/publisher/public-assets/${encodeURIComponent(assetId)}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const encodedCapability = url.pathname.slice(prefix.length);
    if (!encodedCapability || encodedCapability.includes("/")) return null;
    const capability = decodeURIComponent(encodedCapability);
    if (capability.length < 32 || capability.length > 256) return null;
    const expected = new URL(
      `${prefix}${encodeURIComponent(capability)}`,
      origin,
    ).toString();
    return expected === url.toString() ? capability : null;
  } catch {
    return null;
  }
}

function publicPublisherImport(record: {
  id: string;
  articleId: string | null;
  sourceFilename: string;
  sizeBytes: number;
  status:
    "uploaded" | "validating" | "parsing" | "ready" | "rejected" | "failed";
  warnings: readonly Record<string, unknown>[];
  blockers: readonly Record<string, unknown>[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    articleId: record.articleId,
    sourceFilename: record.sourceFilename,
    sizeBytes: record.sizeBytes,
    status: record.status,
    warnings: publicPublisherIssues(record.warnings),
    blockers: publicPublisherIssues(record.blockers),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function publicPublisherIssues(values: readonly Record<string, unknown>[]) {
  return values.flatMap((value) => {
    if (typeof value.code !== "string" || typeof value.message !== "string") {
      return [];
    }
    return [
      {
        code: value.code.slice(0, 64),
        message: value.message.slice(0, 500),
        ...(typeof value.itemId === "string" ? { itemId: value.itemId } : {}),
        ...(typeof value.field === "string" ? { field: value.field } : {}),
      },
    ];
  });
}

type PublisherGateBlocker = {
  code: string;
  message: string;
  itemId?: string | null;
  field?: string | null;
};

function requirePublisherServerRuntimeMode(
  runtime: { mode?: "mock" | "test" | "live" | null } | null | undefined,
): "test" | "live" {
  if (runtime?.mode === "test" || runtime?.mode === "live") {
    return runtime.mode;
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Server-backed media publishing requires database runtime mode TEST or LIVE; Mock publishing is available only in Preview",
  });
}

function publisherEnvironmentGateBlockers(
  ctx: Pick<PublishRouteContext, "config">,
  mode: "mock" | "test" | "live",
  containsImages: boolean,
): PublisherGateBlocker[] {
  if (mode === "mock") return [];
  const blockers: PublisherGateBlocker[] = [];
  if (ctx.config.PUBLISHER_REAL_ENABLED !== true) {
    blockers.push({
      code: "ENV_REAL_DISABLED",
      message: "Real provider access is disabled by the API environment",
    });
  }
  if (ctx.config.PUBLISHER_PUBLISH_ENABLED !== true) {
    blockers.push({
      code: "ENV_PUBLISH_DISABLED",
      message: "Provider order creation is disabled by the API environment",
    });
  }
  if (containsImages) {
    if (ctx.config.PUBLISHER_IMAGE_ENABLED !== true) {
      blockers.push({
        code: "ENV_IMAGE_DISABLED",
        message:
          "TEST/LIVE image publishing is disabled by the API environment",
      });
    }
    if (ctx.config.PUBLISHER_PUBLIC_ASSETS_ENABLED !== true) {
      blockers.push({
        code: "PUBLIC_ASSETS_DISABLED",
        message: "Frozen public image assets are disabled",
      });
    }
  }
  return blockers;
}

function publisherDatabaseGateBlockers(
  runtime:
    | {
        featureEnabled: boolean;
        publishEnabled: boolean;
        emergencyStop: boolean;
      }
    | null
    | undefined,
  mode: "mock" | "test" | "live",
): PublisherGateBlocker[] {
  const blockers: PublisherGateBlocker[] = [];
  if (!runtime?.featureEnabled) {
    blockers.push({
      code: "FEATURE_DISABLED",
      message: "Media publishing customer access is disabled",
    });
  }
  if (mode === "mock") return blockers;
  if (!runtime?.publishEnabled) {
    blockers.push({
      code: "PUBLISH_DISABLED",
      message: "Provider publishing is disabled by the database gate",
    });
  }
  if (runtime?.emergencyStop) {
    blockers.push({
      code: "EMERGENCY_STOP",
      message: "Publishing is paused",
    });
  }
  return blockers;
}

function mergePublisherGateBlockers(
  current: readonly PublisherGateBlocker[],
  environment: readonly PublisherGateBlocker[],
): PublisherGateBlocker[] {
  const codes = new Set(current.map(({ code }) => code));
  return [...current, ...environment.filter(({ code }) => !codes.has(code))];
}

async function publicPublisherRuntime(ctx: PublishRouteContext) {
  const repository = ctx.publishingRepository;
  if (!repository) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Media publishing is not enabled",
    });
  }
  const runtime = await repository.getPublisherRuntimeState();
  const environmentEnabled = ctx.config.PUBLISHER_FEATURE_ENABLED === true;
  const databaseFeatureEnabled = runtime?.featureEnabled ?? false;
  return {
    mode: runtime?.mode ?? ("mock" as const),
    environmentEnabled,
    environmentRealEnabled: ctx.config.PUBLISHER_REAL_ENABLED === true,
    environmentPublishEnabled: ctx.config.PUBLISHER_PUBLISH_ENABLED === true,
    environmentImageEnabled: ctx.config.PUBLISHER_IMAGE_ENABLED === true,
    environmentPublicAssetsEnabled:
      ctx.config.PUBLISHER_PUBLIC_ASSETS_ENABLED === true,
    environmentWebhookEnabled: ctx.config.KOL_WEBHOOK_ENABLED === true,
    databaseFeatureEnabled,
    featureEnabled: environmentEnabled && databaseFeatureEnabled,
    publishEnabled: runtime?.publishEnabled ?? false,
    imagePublishEnabled: runtime?.imagePublishEnabled ?? false,
    webhookEnabled:
      ctx.config.KOL_WEBHOOK_ENABLED && (runtime?.webhookEnabled ?? false),
    emergencyStop: runtime?.emergencyStop ?? false,
    credentialStatus: runtime?.credentialStatus ?? ("unconfigured" as const),
    credentialVerifiedAt: runtime?.credentialVerifiedAt ?? null,
    credentialFailedAt: runtime?.credentialFailedAt ?? null,
    catalogRevision: runtime?.activeCatalogRevision ?? null,
    catalogSyncedAt: runtime?.catalogSyncedAt ?? null,
  };
}

function publicPublisherReconciliationCandidate(candidate: {
  id: string;
  itemId: string;
  externalOrderId: string;
  confidenceBasisPoints: number;
  evidence: Record<string, unknown>;
  boundAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: candidate.id,
    itemId: candidate.itemId,
    externalOrderId: candidate.externalOrderId,
    confidenceBasisPoints: candidate.confidenceBasisPoints,
    evidence: candidate.evidence,
    boundAt: candidate.boundAt,
    rejectedAt: candidate.rejectedAt,
    createdAt: candidate.createdAt,
  };
}


function repositoryTrpcError(error: RepositoryError): TRPCError {
  const code = {
    NOT_FOUND: "NOT_FOUND",
    FORBIDDEN: "FORBIDDEN",
    CONFLICT: "CONFLICT",
    QUOTA_EXCEEDED: "PRECONDITION_FAILED",
    BALANCE_INSUFFICIENT: "PRECONDITION_FAILED",
    INVALID_STATE: "BAD_REQUEST",
  }[error.code] as
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "CONFLICT"
    | "PRECONDITION_FAILED"
    | "BAD_REQUEST";
  return new TRPCError({ code, message: error.message, cause: error });
}

async function translateRepositoryErrors<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof RepositoryError)) throw error;
    throw repositoryTrpcError(error);
  }
}
async function publicPublisherArticleSummary(
  repository: PublishingRepository,
  ownerId: string,
  article: {
    id: string;
    workingName: string;
    suggestedTitle: string | null;
    status: "draft" | "ready" | "archived";
    currentVersionId: string | null;
    currentVersion?: number | null;
    containsImages: boolean;
    revision: number;
    updatedAt: Date;
    createdAt: Date;
  },
) {
  const versions = article.currentVersion === undefined && article.currentVersionId
    ? await repository.listPublisherArticleVersions(ownerId, article.id)
    : [];
  const currentVersion = versions.find(
    ({ id }) => id === article.currentVersionId,
  );
  return {
    id: article.id,
    workingName: article.workingName,
    suggestedTitle: article.suggestedTitle,
    status: article.status,
    currentVersionId: article.currentVersionId,
    currentVersion: article.currentVersion ?? currentVersion?.version ?? null,
    containsImages: article.containsImages,
    revision: article.revision,
    updatedAt: article.updatedAt,
    createdAt: article.createdAt,
  };
}
