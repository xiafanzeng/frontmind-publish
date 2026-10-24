// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { createPublishSchema } from "../schema/index.js";
import { createPublishingPersistence } from "./publisher-repository.js";
import { createPublishWorkerPersistence } from "./publisher-worker-repository.js";
import { createPublishRoutes } from "./routes.js";
import { KolClient } from "./providers/kol/client.js";
import { PublisherWorkerProcessor } from "../worker/processor.js";
import { KolProviderError } from "./providers/kol/errors.js";
import { requestMediaRulesCollection, getMediaRulesCollection } from "./catalog-read-jobs.js";

const at = new Date("2026-10-24T09:00:01.000Z");
const tables = createPublishSchema({ users: mysqlTable("test_users", { id: varchar("id", { length: 36 }).primaryKey() }), currentMonitoringEnterpriseProjectId: () => null });
function fixture() {
  const jobs = new Map<string, any>();
  const media: any[] = [{ id: "media-42", externalResourceId: "42", catalogRevision: "original-revision", rawPayload: { preserved: "catalogue metadata" }, priceTenThousandths: 35000n }];
  let failCompletion = false;
  const health: Record<string, unknown> = { credentialStatus: "healthy", credentialVerifiedAt: new Date("2026-10-23T00:00:00Z") };
  const reads: string[] = [];
  const writes: string[] = [];
  const dialect = new MySqlDialect();
  const matching = (where: any) => {
    const params = dialect.sqlToQuery(where).params;
    return [...jobs.values()].filter(job => (params.includes(job.id) || params.includes(job.deterministicKey))
      && (!params.includes("leased") || (job.status === "leased" && params.includes(job.leaseOwner))));
  };
  const db: any = {
    transaction: async (action: any) => {
      const saved = structuredClone([...jobs]);
      const savedHealth = { ...health };
      const savedMedia = structuredClone(media);
      try { return await action(db); } catch (error) {
        jobs.clear(); for (const [key, job] of saved) jobs.set(key, job);
        for (const key of Object.keys(health)) delete health[key]; Object.assign(health, savedHealth);
        media.splice(0, media.length, ...savedMedia);
        throw error;
      }
    },
    insert: (table: any) => ({ values: (value: any) => ({ onDuplicateKeyUpdate: async () => {
      const name = getTableName(table); writes.push(name);
      if (name === "publisher_jobs") {
        if (![...jobs.values()].some(job => job.deterministicKey === value.deterministicKey)) jobs.set(value.id, { status: "ready", createdAt: value.availableAt, ...value });
      } else if (name === "publisher_runtime_state") Object.assign(health, value);
      else throw new Error(`Unexpected write: ${name}`);
    } }) }),
    select: () => ({ from: (table: any) => {
      const name = getTableName(table); reads.push(name); let where: any;
      const query: any = { where: (value: any) => { where = value; return query; }, for: () => query,
        limit: async () => {
          if (name === "publisher_media_resources") return media.filter(row => dialect.sqlToQuery(where).params.includes(row.externalResourceId));
          if (name !== "publisher_jobs") throw new Error(`Unexpected read: ${name}`); return matching(where);
        } };
      return query;
    } }),
    update: (table: any) => ({ set: (value: any) => ({ where: async (where: any) => {
      const name = getTableName(table); writes.push(name);
      if (name === "publisher_media_resources") {
        for (const row of media) if (dialect.sqlToQuery(where).params.includes(row.id)) Object.assign(row, value);
        return;
      }
      if (name !== "publisher_jobs") throw new Error(`Unexpected update: ${name}`);
      if (failCompletion) throw new Error("Result persistence failed");
      for (const job of matching(where)) Object.assign(job, value);
    } }) }),
    execute: async (query: any) => {
      const statement = dialect.sqlToQuery(query);
      if (/^INSERT/u.test(statement.sql)) {
        const [id, key, _aggregate, payload, createdAt] = statement.params;
        if (![...jobs.values()].some(job => job.deterministicKey === key)) jobs.set(String(id), {
          id, deterministicKey: key, payload: JSON.parse(String(payload)), createdAt, status: "ready", type: "sync_kol_catalog",
        });
        writes.push("publisher_jobs");
        return [{ affectedRows: 1 }, []];
      }
      return [matching(query), []];
    },
  };
  const apiCore: any = { tables };
  const { PublishingRepository } = createPublishingPersistence(apiCore);
  const { PublisherWorkerRepository } = createPublishWorkerPersistence(apiCore);
  const api = new PublishingRepository(db);
  const worker = new PublisherWorkerRepository(db);
  const lease = (id: string) => { const job = jobs.get(id); Object.assign(job, { status: "leased", leaseOwner: "test-worker" }); return job; };
  return { api, worker, jobs, health, reads, writes, lease, media, db, failCompletion: () => { failCompletion = true; } };
}

describe("worker-owned provider connection checks", () => {
  it("deduplicates all callers within a minute into one read-only job", async () => {
    const f = fixture();
    const first = await f.api.requestPublisherConnectionCheck("user-a", at);
    const second = await f.api.requestPublisherConnectionCheck("user-b", new Date(at.valueOf() + 30_000));
    expect(first).toEqual(second);
    expect(f.jobs.size).toBe(1);
    expect(f.jobs.get(first.checkId)).toMatchObject({ type: "sync_kol_catalog", maxAttempts: 1, payload: { purpose: "credential_check" } });
    expect(f.writes).toEqual(["publisher_jobs", "publisher_jobs"]);
    const third = await f.api.requestPublisherConnectionCheck("user-a", new Date(at.valueOf() + 60_000));
    expect(third.checkId).not.toBe(first.checkId);
  });

  it("never substitutes a previous healthy runtime state for this pending check", async () => {
    const f = fixture(); const { checkId } = await f.api.requestPublisherConnectionCheck("user", at);
    expect(await f.api.getPublisherConnectionCheck(checkId, at)).toEqual({ status: "pending" });
    expect(f.reads.every(name => name === "publisher_jobs")).toBe(true);
    f.jobs.get(checkId).payload.connectionCheck = { status: "healthy", checkedAt: at.toISOString() };
    expect(await f.api.getPublisherConnectionCheck(checkId, at)).toEqual({ status: "pending" });
  });

  it("uses one long-lived worker client to refresh once, checks only orders, and never creates an order", async () => {
    const f = fixture(); const calls: string[] = []; let rejected = false;
    const provider = new KolClient({ baseUrl: "https://kol.test", mode: "live", accessToken: "test-old-token",
      apiKey: "test-key", mobile: "test-mobile", password: "test-password", identity: "advertiser", captcha: "test-captcha", captchaToken: "test-captcha-token",
      maxGetAttempts: 1, fetch: async (url, init) => {
        const path = new URL(String(url)).pathname; calls.push(`${init?.method} ${path}`);
        if (path === "/api/auth/authenticate") return Response.json({ status: 200, success: true, data: { token: "test-worker-token" } });
        expect(init?.method).toBe("GET");
        expect(new URL(String(url)).searchParams.get("page")).toBe("1");
        if (!rejected) { rejected = true; return Response.json({ status: 401 }, { status: 401 }); }
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-worker-token");
        return Response.json({ success: true, status: 200, data: [] });
      } });
    const createOrder = vi.spyOn(provider, "createOrder"); const listResources = vi.spyOn(provider, "listResources");
    const processor = new PublisherWorkerProcessor({ repository: f.worker, provider, objectStore: {}, logger: {}, now: () => at } as never,
      { workerId: "test-worker", mode: "live", providerEnabled: true } as never);
    for (const offset of [0, 60_000]) {
      const { checkId } = await f.api.requestPublisherConnectionCheck("user", new Date(at.valueOf() + offset));
      const job = f.lease(checkId);
      await processor.handle({ ...job, attemptCount: 0, leasedUntil: at });
      expect(await f.api.getPublisherConnectionCheck(checkId, at)).toMatchObject({ status: "healthy", checkedAt: at });
    }
    expect(calls).toEqual(["GET /api/news_order", "POST /api/auth/authenticate", "GET /api/news_order", "GET /api/news_order"]);
    expect(createOrder).not.toHaveBeenCalled(); expect(listResources).not.toHaveBeenCalled();
    expect(f.health).toMatchObject({ credentialStatus: "healthy", credentialVerifiedAt: at, credentialFailedAt: null });
    expect(f.writes.every(name => ["publisher_jobs", "publisher_runtime_state"].includes(name))).toBe(true);
  });

  it.each([401, 503])("finishes a failed HTTP %s check without retrying it or reporting old healthy state", async status => {
    const f = fixture(); const { checkId } = await f.api.requestPublisherConnectionCheck("user", at);
    const provider = new KolClient({ baseUrl: "https://kol.test", mode: "live", accessToken: "test-token", maxGetAttempts: 1,
      fetch: async () => Response.json({ status }, { status }) });
    const processor = new PublisherWorkerProcessor({ repository: f.worker, provider, objectStore: {}, logger: {}, now: () => at } as never,
      { workerId: "test-worker", mode: "live", providerEnabled: true } as never);
    await processor.handle({ ...f.lease(checkId), attemptCount: 0, leasedUntil: at });
    expect(f.jobs.get(checkId).status).toBe("succeeded");
    expect(await f.api.getPublisherConnectionCheck(checkId, at)).toMatchObject({ status: "failed", checkedAt: at });
    expect(f.health).toMatchObject({ credentialStatus: status === 401 ? "auth_blocked" : "unknown", credentialFailedAt: at });
  });

  it("reports lost/dead/overdue checks as failed instead of polling indefinitely", async () => {
    const f = fixture(); const { checkId } = await f.api.requestPublisherConnectionCheck("user", at);
    expect(await f.api.getPublisherConnectionCheck(checkId, new Date(at.valueOf() + 5 * 60_000))).toMatchObject({ status: "failed" });
    f.jobs.get(checkId).status = "dead";
    expect(await f.api.getPublisherConnectionCheck(checkId, at)).toMatchObject({ status: "failed" });
    f.jobs.get(checkId).payload.purpose = "catalog";
    await expect(f.api.getPublisherConnectionCheck(checkId, at)).rejects.toThrow("发布连接检查不存在");
  });

  it("exposes customer-authorized queue/status APIs that do not call the provider", async () => {
    const request = vi.fn(async () => ({ checkId: "c62ce15a-e403-4f99-a3d3-b02c6d4c19e0" }));
    const get = vi.fn(async () => ({ status: "pending" as const }));
    const authorize = vi.fn(async () => ({ user: { id: "user" }, publishingRepository: { requestPublisherConnectionCheck: request, getPublisherConnectionCheck: get } }));
    const { publisherRouter } = createPublishRoutes({ authorize } as never);
    const caller = publisherRouter.createCaller({});
    const { checkId } = await caller.provider.requestConnectionCheck();
    expect(await caller.provider.connectionCheck({ checkId })).toEqual({ status: "pending" });
    expect(request).toHaveBeenCalledWith("user"); expect(get).toHaveBeenCalledWith(checkId);
    expect(authorize.mock.calls.every(call => call[1] === "customer")).toBe(true);
  });
});

describe("worker-owned media requirements collection", () => {
  const pagination = { currentPage: 7, lastPage: 20, perPage: 50, total: 999 };
  function processorFor(f: ReturnType<typeof fixture>, provider: unknown) {
    return new PublisherWorkerProcessor({ repository: f.worker, provider, objectStore: {}, logger: {}, now: () => at } as never,
      { workerId: "test-worker", mode: "live", providerEnabled: true } as never);
  }
  it("deduplicates each page/minute and validates purpose without trusting another completed job", async () => {
    const f = fixture();
    const first = await requestMediaRulesCollection(f.db, 7, "actor-a", at);
    expect(await requestMediaRulesCollection(f.db, 7, "actor-b", at)).toEqual(first);
    expect(await getMediaRulesCollection(f.db, first.jobId, at)).toEqual({ status: "pending" });
    const another = await requestMediaRulesCollection(f.db, 8, "actor-a", at);
    expect(another.jobId).not.toBe(first.jobId);
    f.jobs.get(first.jobId).payload.purpose = "credential_check";
    expect(await getMediaRulesCollection(f.db, first.jobId, at)).toMatchObject({ status: "failed" });
    await expect(requestMediaRulesCollection(f.db, 0, "actor-a", at)).rejects.toThrow();
  });
  it("ages raw UTC MySQL timestamps correctly even when the API process uses Shanghai time", async () => {
    const previous = process.env.TZ;
    process.env.TZ = "Asia/Shanghai";
    try {
      const f = fixture();
      const { jobId } = await requestMediaRulesCollection(f.db, 7, "actor", at);
      f.jobs.get(jobId).createdAt = at.toISOString().replace("T", " ").replace("Z", "");
      expect(await getMediaRulesCollection(f.db, jobId, at)).toEqual({ status: "pending" });
      expect(await getMediaRulesCollection(f.db, jobId, new Date(at.valueOf() + 5 * 60_000)))
        .toMatchObject({ status: "failed" });
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("stores only rules evidence, updates revision, and completes this job without orders or money writes", async () => {
    const f = fixture(); const { jobId } = await requestMediaRulesCollection(f.db, 7, "actor", at);
    const provider = { listResources: vi.fn(async () => ({ pagination, resources: [
      { id: 42, remark: "标题不超过32字", titleLimit: 32, raw: { token: "must-not-persist" } },
      { id: 99, remark: "未同步媒体" },
    ] })), createOrder: vi.fn(), listOrders: vi.fn() };
    await processorFor(f, provider).handle({ ...f.lease(jobId), attemptCount: 0, leasedUntil: at });
    expect(provider.listResources).toHaveBeenCalledOnce(); expect(provider.listResources).toHaveBeenCalledWith(7, undefined);
    expect(provider.createOrder).not.toHaveBeenCalled(); expect(provider.listOrders).not.toHaveBeenCalled();
    expect(await getMediaRulesCollection(f.db, jobId, at)).toEqual({ status: "succeeded", result: { collected: 2, matched: 1, pagination } });
    expect(f.media[0].rawPayload).toEqual({ preserved: "catalogue metadata", frontmindMediaRules: {
      rawRemark: "标题不超过32字", collectedAt: at.toISOString(), source: "/api/news_resource_2/data", apiTitleLimit: 32,
    } });
    expect(JSON.stringify(f.media[0].rawPayload)).not.toContain("must-not-persist");
    expect(f.media[0].catalogRevision).not.toBe("original-revision");
    expect(f.media[0].priceTenThousandths).toBe(35000n);
    expect(f.writes.every(name => ["publisher_jobs", "publisher_runtime_state", "publisher_media_resources"].includes(name))).toBe(true);
  });
  it("preserves the supplier's valid zero-page empty catalogue response", async () => {
    const f = fixture(); const { jobId } = await requestMediaRulesCollection(f.db, 7, "actor", at);
    const pagination = { currentPage: 0, lastPage: 0, perPage: 50, total: 0 };
    const provider = { listResources: vi.fn(async () => ({ resources: [], pagination })) };
    await processorFor(f, provider).handle({ ...f.lease(jobId), attemptCount: 0, leasedUntil: at });
    expect(await getMediaRulesCollection(f.db, jobId, at))
      .toEqual({ status: "succeeded", result: { collected: 0, matched: 0, pagination } });
  });

  it("completes an authentication failure and blocks credentials instead of retrying forever", async () => {
    const f = fixture(); const { jobId } = await requestMediaRulesCollection(f.db, 7, "actor", at);
    const provider = { listResources: vi.fn(async () => { throw new KolProviderError("authentication_blocked", "private", { operation: "list_resources", httpStatus: 401 }); }), createOrder: vi.fn() };
    await processorFor(f, provider).handle({ ...f.lease(jobId), attemptCount: 0, leasedUntil: at });
    expect(await getMediaRulesCollection(f.db, jobId, at)).toMatchObject({ status: "failed" });
    expect(f.jobs.get(jobId).status).toBe("succeeded");
    expect(f.health).toMatchObject({ credentialStatus: "auth_blocked", credentialFailedAt: at });
    expect(f.media[0].catalogRevision).toBe("original-revision");
    expect(provider.createOrder).not.toHaveBeenCalled();
  });
  it("does not write without the worker lease and rolls catalogue evidence back if completion fails", async () => {
    const f = fixture(); const { jobId } = await requestMediaRulesCollection(f.db, 7, "actor", at);
    const input = { jobId, workerId: "test-worker", checkedAt: at, credentialStatus: "healthy" as const,
      result: { resources: [{ id: 42, remark: "new evidence", titleLimit: 12 }], pagination } };
    await f.worker.completePublisherMediaRulesCollection(input);
    expect(f.media[0].catalogRevision).toBe("original-revision");
    f.lease(jobId); f.failCompletion();
    await expect(f.worker.completePublisherMediaRulesCollection(input)).rejects.toThrow("Result persistence failed");
    expect(f.media[0].catalogRevision).toBe("original-revision");
    expect(f.jobs.get(jobId).status).toBe("leased");
    expect(await getMediaRulesCollection(f.db, jobId, new Date(at.valueOf() + 5 * 60_000))).toMatchObject({ status: "failed" });
  });
});
