import type { MySql2Database } from "drizzle-orm/mysql2";
import type { PublishSchema } from "../schema/index.js";

/** A real in-process Drizzle connection. Core never converts a transaction to HTTP. */
export type PublishDatabase = MySql2Database<any>;
export type PublishTransaction = Parameters<Parameters<PublishDatabase["transaction"]>[0]>[0];
export type PublishFundsStatus = "reserved" | "frozen" | "consumed" | "released";
export interface PublishPersistenceCore {
  tables: PublishSchema;
  audit(tx: PublishTransaction, entry: Record<string, unknown>): Promise<void>;
  settlePublisherItemMoney(tx: PublishTransaction, input: {
    itemId: string; settlement: "frozen" | "consumed" | "released";
    settledAt: Date; reason: string;
  }): Promise<boolean>;
  derivePublisherBatchFundsStatus(statuses: readonly PublishFundsStatus[]): PublishFundsStatus;
}

export interface PublisherWallet {
  balanceTenThousandths: bigint; reservedTenThousandths: bigint;
  frozenTenThousandths: bigint; spentTenThousandths: bigint;
}
export interface PublishApiCore extends PublishPersistenceCore {
  monitoringProjectOwnerPredicate(table: { ownerId: import("drizzle-orm/mysql-core").AnyMySqlColumn; enterpriseProjectId: import("drizzle-orm/mysql-core").AnyMySqlColumn }, ownerId: string | import("drizzle-orm").SQLWrapper): import("drizzle-orm").SQL;
  monitoringEnterpriseProjectIdForOwner(ownerId: string): string | null;
  assertMonitoringEnterpriseProjectActive(tx: PublishTransaction, projectId: string | null | undefined, ownerId: string): Promise<void>;
  assertOwner(db: PublishDatabase | PublishTransaction, ownerId: string, lock?: boolean): Promise<void>;
  ownerDisplayName(db: PublishDatabase, ownerId: string): Promise<string>;
  readAudit(tx: PublishTransaction, id: string, ownerId: string): Promise<{ action: string; metadata: Record<string, unknown> | null } | undefined>;
  billingSummary(db: PublishDatabase, ownerId: string): Promise<{ userId: string; walletScope: "media_publishing"; currency: "CNY"; scale: 4; balanceTenThousandths: string; reservedTenThousandths: string; frozenTenThousandths: string; spentTenThousandths: string; availableTenThousandths: string }>;
  ensureWallet(db: PublishDatabase, ownerId: string): Promise<void>;
  lockWallet(tx: PublishTransaction, ownerId: string): Promise<PublisherWallet>;
  quoteReservation(tx: PublishTransaction, ownerId: string, total: bigint): Promise<PublisherWallet>;
  availableFunds(tx: PublishTransaction, ownerId: string): Promise<bigint>;
  createReservation(tx: PublishTransaction, input: { id: string; ownerId: string; batchId: string; totalTenThousandths: bigint }): Promise<void>;
  createItemSettlement(tx: PublishTransaction, input: { itemId: string; ownerId: string; reservationId: string; amountTenThousandths: bigint; status: "reserved" }): Promise<void>;
  commitReservation(tx: PublishTransaction, input: { ownerId: string; total: bigint; reservationId: string; batchId: string; nextWallet: PublisherWallet }): Promise<void>;
  reactivatePublisherItemReservation(tx: PublishTransaction, input: { itemId: string; authorizedAt: Date; actorId: string; reason: string }): Promise<boolean>;
}
