import { and } from "drizzle-orm";
import { MySqlDialect, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { createPublishSchema } from "../schema/index.js";
import type { PublishApiCore, PublishDatabase } from "./persistence-core.js";
import { createPublishingPersistence } from "./publisher-repository.js";

const users = mysqlTable("catalog_query_test_users", { id: varchar("id", { length: 36 }).primaryKey() });
const tables = createPublishSchema({ users, currentMonitoringEnterpriseProjectId: () => null });
const { PublishingRepository } = createPublishingPersistence({ tables } as unknown as PublishApiCore);

function fixture(complete = true) {
  const selections: string[][] = [];
  const transactions: unknown[] = [];
  const runtime = { activeCatalogRevision: "revision-1", catalogSyncedAt: new Date("2026-10-24T10:00:00Z"), catalogKindComplete: complete };
  const database = {
    select(fields?: Record<string, unknown>) {
      const keys = Object.keys(fields ?? {});
      selections.push(keys);
      const rows = keys.includes("news") ? [{ news: 3, selfMedia: 9 }]
        : keys.includes("total") ? [{ total: 2 }]
        : keys.includes("resource") ? [] : [runtime];
      const query = {
        from() { return query; }, where() { return query; }, limit() { return query; },
        leftJoin() { return query; }, orderBy() { return query; }, offset() { return query; },
        then(resolve: (result: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
      };
      return query;
    },
    transaction<T>(action: (transaction: unknown) => Promise<T>, options: unknown) {
      transactions.push(options);
      return action(database);
    },
  };
  return { repository: new PublishingRepository(database as unknown as PublishDatabase), selections, transactions };
}

describe("catalog query scope and snapshot semantics", () => {
  it("uses exact area aliases, independent AI/recommendation AND and alias OR", () => {
    const { repository } = fixture();
    const query = new MySqlDialect().sqlToQuery(and(...repository.mediaConditions({
      coverageProvince: "广东", coverageCity: "深圳市", aiPlatform: "Kimi",
      recommendationGroup: "无免责声明", recommendationTag: "周末可发，高收录",
    }))!);
    expect(query.params).toEqual(expect.arrayContaining([
      "广东省 深圳市", "广东省  深圳市", "深圳", "kimi", "无免责申明", "无免责声明", "周末可发，高收录",
    ]));
    expect(query.params).not.toContain("广东省");
    expect(query.params).not.toContain("全国");
    expect(query.sql).toContain(" or ");
    expect(query.sql).toContain(" and ");
    expect(query.sql.match(/JSON_CONTAINS/g)).toHaveLength(4);
  });

  it("fails closed for invalid repository-level normalized selections", () => {
    const { repository } = fixture();
    for (const input of [{ coverageProvince: "unknown" }, { coverageCity: "深圳市" },
      { coverageProvince: "四川", coverageCity: "深圳市" }, { aiPlatform: "unknown" }, { recommendationGroup: "unknown" }]) {
      const query = new MySqlDialect().sqlToQuery(and(...repository.mediaConditions(input))!);
      expect(query.sql).toContain("FALSE");
    }
  });

  it("reuses one in-snapshot inventory aggregate for all/category-only result totals", async () => {
    for (const [input, expected] of [[{}, 12], [{ kind: "news" as const }, 3], [{ kind: "self_media" as const }, 9]] as const) {
      const { repository, selections, transactions } = fixture();
      const result = await repository.listPublisherMedia(input);
      expect(result.total).toBe(expected);
      expect(result.catalogCounts).toEqual({ all: 12, news: 3, selfMedia: 9 });
      expect(selections.filter((keys) => keys.includes("news"))).toHaveLength(1);
      expect(selections.filter((keys) => keys.includes("total"))).toHaveLength(0);
      expect(transactions).toEqual([{ isolationLevel: "repeatable read", withConsistentSnapshot: true }]);
    }
  });

  it("keeps a filtered total separate and never substitutes it for global inventory", async () => {
    const { repository, selections } = fixture();
    const result = await repository.listPublisherMedia({ area: "广东", page: 2, pageSize: 20 });
    expect(result.total).toBe(2);
    expect(result.catalogCounts).toEqual({ all: 12, news: 3, selfMedia: 9 });
    expect(selections.filter((keys) => keys.includes("total"))).toHaveLength(1);
    const incomplete = await fixture(false).repository.listPublisherMedia();
    expect(incomplete.catalogCounts).toBeNull();
    expect(incomplete.catalogCountStatus).toBe("unavailable");
  });

  it("reads price bounds and advanced thresholds in one capability-scoped aggregate", async () => {
    const selections: Array<{ keys: string[]; joins: number }> = [];
    const runtime = { activeCatalogRevision: "revision-1", catalogSyncedAt: new Date("2026-10-24T10:00:00Z"), catalogKindComplete: true };
    const database = {
      select(fields?: Record<string, unknown>) {
        const selection = { keys: Object.keys(fields ?? {}), joins: 0 };
        selections.push(selection);
        const rows = selection.keys.includes("news") ? [{ news: 3, selfMedia: 9 }]
          : selection.keys.includes("minimum") ? [{ minimum: 10000n, maximum: 30000n, pcWeight1: 2 }]
          : selection.keys.includes("value") || selection.keys.includes("tags") ? [] : [runtime];
        const query = {
          from() { return query; }, where() { return query; }, limit() { return query; },
          groupBy() { return query; }, orderBy() { return query; },
          leftJoin() { selection.joins += 1; return query; },
          then(resolve: (result: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
        };
        return query;
      },
    };
    const repository = new PublishingRepository(database as unknown as PublishDatabase);
    const result = await repository.getPublisherMediaFacets({ imageSupport: "verified" });
    const aggregates = selections.filter(({ keys }) => keys.includes("minimum") || keys.includes("pcWeight1"));

    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]).toMatchObject({ joins: 1 });
    expect(aggregates[0].keys).toEqual(expect.arrayContaining(["minimum", "maximum", "pcWeight1"]));
    expect(result.minimumPriceTenThousandths).toBe("10000");
    expect(result.maximumPriceTenThousandths).toBe("30000");
    expect(result.pcWeightThresholds).toEqual([{ value: "1", count: 2 }]);
    expect(result.catalogCounts).toEqual({ all: 12, news: 3, selfMedia: 9 });
  });
});
