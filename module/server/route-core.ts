import type { createPublishingPersistence } from "./publisher-repository.js";
export type PublishingRepository = InstanceType<ReturnType<typeof createPublishingPersistence>["PublishingRepository"]>;
export interface PublishRouteContext {
  user: { id: string };
  publishingRepository: PublishingRepository;
  config: {
    PUBLIC_ORIGIN: string; PUBLISHER_FEATURE_ENABLED: boolean;
    PUBLISHER_REAL_ENABLED: boolean; PUBLISHER_PUBLISH_ENABLED: boolean;
    PUBLISHER_IMAGE_ENABLED: boolean; PUBLISHER_PUBLIC_ASSETS_ENABLED: boolean;
    KOL_WEBHOOK_ENABLED: boolean;
  };
  signAsset(input: { ownerId: string; articleId: string; assetSha256: string }): string;
  audit: { actorId: string | null; actorRole: "user" | "admin" | null; ipHash: string | null };
  writeAudit(audit: PublishRouteContext["audit"], action: string, targetType: string, targetId: string | null, ownerId: string | null, metadata: Record<string, unknown>): Promise<void>;
}
/** Core supplies authentication/authorization; module routes only consume admitted business context. */
export interface PublishRouteCore<Context extends object> {
  authorize(context: Context, capability: "customer" | "admin"): Promise<PublishRouteContext>;
}
