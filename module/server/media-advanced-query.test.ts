import { and, type SQL } from "drizzle-orm";
import { MySqlDialect, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { createPublishSchema } from "../schema/index.js";
import type { PublishApiCore, PublishDatabase } from "./persistence-core.js";
import { createPublishingPersistence } from "./publisher-repository.js";

const users = mysqlTable("advanced_query_users", { id: varchar("id", { length: 36 }).primaryKey() });
const tables = createPublishSchema({ users, currentMonitoringEnterpriseProjectId: () => null });
const { PublishingRepository } = createPublishingPersistence({ tables } as unknown as PublishApiCore);
const groups = {
  publishTimes: ["半小时", "1小时", "2小时", "3小时", "4小时", "新供应商条件", null, ""].map((value) => ({ value, count: 1 })),
  entries: ["没有入口", "无入口", "栏目页面", "新入口", null].map((value) => ({ value, count: 1 })),
  links: ["电话", "可带电话", "不带", null].map((value) => ({ value, count: 1 })),
};
const dialect = new MySqlDialect();
const repository = new PublishingRepository({} as PublishDatabase);
const query = (input: Parameters<typeof repository.mediaConditions>[0]) =>
  dialect.sqlToQuery(and(...repository.mediaConditions(input, groups))!);

describe("normalized advanced SQL membership", () => {
  it("selects cumulative members once in SQL while preserving legacy exact requests", () => {
    const cumulative = query({ publishTimeBand: "within_3h" });
    expect(cumulative.params).toEqual(expect.arrayContaining(["半小时", "1小时", "2小时", "3小时"]));
    expect(cumulative.params).not.toContain("4小时");
    expect(cumulative.sql).toContain(" in ");
    const legacy = query({ publishSpeed: "1小时", entryType: "没有入口", linkType: "电话" });
    expect(legacy.params).toContain("1小时");
    expect(legacy.params).not.toContain("半小时");
    expect(legacy.params).not.toContain("无入口");
    expect(legacy.params).not.toContain("可带电话");
  });
  it("includes missing and all unparseable values in pending, merging only proven aliases", () => {
    expect(query({ publishTimeBand: "unconfirmed" }).sql).toContain("is null");
    expect(query({ publishTimeBand: "unconfirmed" }).params).toEqual(expect.arrayContaining(["新供应商条件", ""]));
    expect(query({ entryCategory: "none" }).params).toEqual(expect.arrayContaining(["没有入口", "无入口"]));
    expect(query({ entryCategory: "none" }).sql).not.toContain("is null");
    expect(query({ entryCategory: "unspecified" }).sql).toContain("is null");
    expect(query({ entryCategory: "raw:新入口" }).params).toContain("新入口");
    expect(query({ linkCategory: "phone" }).params).toEqual(expect.arrayContaining(["电话", "可带电话"]));
    expect(query({ linkCategory: "unspecified" }).sql).toContain("is null");
  });
  it("handles festival false and NULL independently and rejects conflicting filters", () => {
    // Compare against the same typed column's legacy boolean predicate: Drizzle
    // may encode booleans to 0/1 before exposing SQL parameters.
    expect(query({ festivalStatus: "not_publishable" }).params).toEqual(query({ festivalPublishable: false }).params);
    expect(query({ festivalStatus: "publishable" }).params).toEqual(query({ festivalPublishable: true }).params);
    expect(query({ festivalStatus: "unspecified" }).sql).toContain("is null");
    expect(() => query({ festivalStatus: "not_publishable", festivalPublishable: true })).toThrow();
    expect(() => query({ publishTimeBand: "within_3h", publishSpeed: "3小时" })).toThrow();
  });

  it("loads unpaged full-catalog raw groups in the list snapshot, caches by identity, and uses the same predicate for count/page", async () => {
    const scopes: Array<{ keys: string[]; sql?: string; params?: unknown[]; limited?: number }> = [];
    let revision = "revision-1";
    const db = {
      select(fields?: Record<string, unknown>) {
        const keys = Object.keys(fields ?? {});
        const scope: (typeof scopes)[number] = { keys }; scopes.push(scope);
        const rawColumn = (fields?.value as { name?: string } | undefined)?.name;
        const rows = rawColumn === "publish_speed" ? groups.publishTimes.map(({ value, count: total }) => ({ value, total }))
          : rawColumn === "entry_level" ? groups.entries.map(({ value, count: total }) => ({ value, total }))
          : rawColumn === "link_type" ? groups.links.map(({ value, count: total }) => ({ value, total }))
          : keys.includes("news") ? [{ news: 100, selfMedia: 200 }]
          : keys.includes("total") ? [{ total: 4 }]
          : keys.includes("id") ? []
          : [{ activeCatalogRevision: revision, catalogSyncedAt: new Date("2026-11-08T00:00:00Z"), catalogKindComplete: true }];
        const q = {
          from() { return q; }, groupBy() { return q; }, orderBy() { return q; }, offset() { return q; },
          limit(n: number) { scope.limited = n; return q; },
          where(condition?: SQL) { if (condition) Object.assign(scope, dialect.sqlToQuery(condition)); return q; },
          then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
        }; return q;
      },
      transaction<T>(action: (tx: unknown) => Promise<T>) { return action(db); },
    };
    const repo = new PublishingRepository(db as unknown as PublishDatabase);
    const first = await repo.listPublisherMedia({ publishTimeBand: "within_3h", nameQuery: "媒体", page: 2, pageSize: 1 });
    expect(first).toMatchObject({ total: 4, catalogCounts: { all: 300, news: 100, selfMedia: 200 }, advancedFilterVersion: 1 });
    const rawScopes = scopes.filter(({ keys }) => keys.includes("value"));
    expect(rawScopes).toHaveLength(3);
    expect(rawScopes.every((scope) => scope.limited === undefined && !scope.params?.includes("%媒体%"))).toBe(true);
    // Grouped raw-value selects also carry a `total` key; match the count/page
    // scopes exactly so the identical-predicate assertion compares the real queries.
    const countScope = scopes.find(({ keys }) => keys.length === 1 && keys[0] === "total")!;
    const pageScope = scopes.find(({ keys }) => keys.length === 1 && keys[0] === "id")!;
    expect(countScope.sql).toBe(pageScope.sql);
    expect(countScope.params).toEqual(pageScope.params);
    await repo.listPublisherMedia({ publishTimeBand: "within_1h" });
    expect(scopes.filter(({ keys }) => keys.includes("value"))).toHaveLength(3);
    revision = "revision-2";
    await repo.listPublisherMedia({ publishTimeBand: "within_3h" });
    expect(scopes.filter(({ keys }) => keys.includes("value"))).toHaveLength(6);
  });

  it("counts pending/missing from the exact facet scope, never by subtracting scoped values from global inventory", async () => {
    const runtime = { activeCatalogRevision: "revision-1", catalogSyncedAt: new Date("2026-11-08T00:00:00Z"), catalogKindComplete: true };
    const db = {
      select(fields?: Record<string, unknown>) {
        const keys = Object.keys(fields ?? {});
        const column = (fields?.value as { name?: string } | undefined)?.name;
        const rows = keys.includes("news") ? [{ news: 100, selfMedia: 200 }]
          : column === "publish_speed" ? [{ value: "1小时", total: 2 }, { value: null, total: 3 }, { value: "当天", total: 1 }]
          : column === "entry_level" ? [{ value: "没有入口", total: 2 }, { value: "无入口", total: 1 }, { value: null, total: 3 }]
          : column === "link_type" ? [{ value: "电话", total: 2 }, { value: "可带电话", total: 1 }, { value: null, total: 3 }]
          : keys.includes("minimum") ? [{ minimum: null, maximum: null, festivalTrue: 2, festivalFalse: 4, festivalUnspecified: 0 }]
          : keys.includes("value") || keys.includes("tags") ? [] : [runtime];
        const q = {
          from() { return q; }, where() { return q; }, groupBy() { return q; }, orderBy() { return q; },
          leftJoin() { return q; }, limit() { return q; },
          then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
        }; return q;
      },
    };
    const repo = new PublishingRepository(db as unknown as PublishDatabase);
    const facets = await repo.getPublisherMediaFacets({ nameQuery: "局部" });
    expect(facets.publishTimeBands.find(({ value }) => value === "unconfirmed")?.count).toBe(4);
    expect(facets.entryCategories.find(({ value }) => value === "none")?.count).toBe(3);
    expect(facets.entryCategories.find(({ value }) => value === "unspecified")?.count).toBe(3);
    expect(facets.linkCategories.find(({ value }) => value === "phone")?.count).toBe(3);
    expect(facets.festivalStatuses).toEqual([
      { value: "publishable", count: 2 }, { value: "not_publishable", count: 4 }, { value: "unspecified", count: 0 },
    ]);
    expect(facets.publishSpeeds).toEqual([{ value: "1小时", count: 2 }, { value: "当天", count: 1 }]);
    expect(facets.catalogCounts?.all).toBe(300);
  });

  it("discards a grouped membership load if the pool crosses a catalogue activation", async () => {
    let revision = "revision-old";
    let groupLoads = 0;
    const db = {
      select(fields?: Record<string, unknown>) {
        if (fields?.value) { groupLoads += 1; revision = "revision-new"; }
        const rows = fields?.value ? [{ value: "1小时", total: 1 }]
          : [{ activeCatalogRevision: revision, catalogSyncedAt: new Date("2026-11-08T00:00:00Z"), catalogKindComplete: true }];
        const q = { from() { return q; }, where() { return q; }, groupBy() { return q; }, limit() { return q; },
          then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); } }; return q;
      },
    };
    const repo = new PublishingRepository(db as unknown as PublishDatabase);
    const oldCatalog = { catalogRevision: "revision-old", catalogSyncedAt: new Date("2026-11-08T00:00:00Z"), kindComplete: true };
    await expect(repo.loadAdvancedFilterGroups(db as unknown as PublishDatabase, oldCatalog)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(repo.loadAdvancedFilterGroups(db as unknown as PublishDatabase, oldCatalog)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(groupLoads).toBe(6);
  });
});
