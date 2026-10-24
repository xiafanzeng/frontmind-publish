// @vitest-environment node
import express from "express";
import { createServer, type Server } from "node:http";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMediaRequirementsApi } from "./media-requirements-api.js";

const mocks = vi.hoisted(() => ({ request: vi.fn(), get: vi.fn(), factory: vi.fn() }));
vi.mock("./catalog-read-jobs.js", () => ({
  requestMediaRulesCollection: mocks.request,
  getMediaRulesCollection: mocks.get,
}));
vi.mock("./providers/kol/runtime.js", () => ({
  getKolRuntimeStatus: () => ({ configured: true, mode: "live" }),
  createKolRuntimeClient: mocks.factory,
}));
const result = { collected: 2, matched: 1,
  pagination: { currentPage: 2, lastPage: 3, perPage: 20, total: 60 } };
let server: Server;
let origin: string;
const db = {};
beforeAll(async () => {
  const app = express();
  app.use(createMediaRequirementsApi({
    database: async () => db,
    context: () => ({ businessActorId: "actor", businessOwnerId: "owner", accountUserId: 1, actorUserId: 1, enterpriseProjectId: null }),
    environment: {},
  } as never));
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local test listener missing");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ jobId: "job-1" });
  mocks.get.mockResolvedValue({ status: "succeeded", result });
});
const collect = (page: number) => fetch(`${origin}/collect`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page }),
});
describe("worker-owned media requirements collection", () => {
  it("keeps the response contract and authenticated actor while never constructing an API login client", async () => {
    const response = await collect(2);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(mocks.request).toHaveBeenCalledWith(db, 2, "actor");
    expect(mocks.get).toHaveBeenCalledWith(db, "job-1");
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("waits for this queued job rather than reusing old runtime health", async () => {
    mocks.get.mockResolvedValueOnce({ status: "pending" });
    const response = await collect(2);
    expect(await response.json()).toEqual(result);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("reports failed reads without returning private provider data or bypassing the worker", async () => {
    mocks.get.mockResolvedValue({ status: "failed", message: "private-provider-error" });
    const response = await collect(2);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("rules_unavailable");
    expect(JSON.stringify(body)).not.toContain("private-provider-error");
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("rejects an invalid page before queuing work", async () => {
    const response = await collect(0);
    expect(response.status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
