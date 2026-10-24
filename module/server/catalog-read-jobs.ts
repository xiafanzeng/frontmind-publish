import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PublishDatabase } from "./persistence-core.js";
import type { KolPagination } from "./providers/kol/types.js";

type CatalogReadDatabase = Pick<PublishDatabase, "execute">;
export type MediaRulesCollectionState = {
  status: "pending" | "succeeded" | "failed";
  result?: { collected: number; matched: number; pagination: KolPagination };
  message?: string;
};

function records(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
}
function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return undefined; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Shared read-only supplier work; callers cannot supply URLs or credentials. */
export async function requestMediaRulesCollection(database: CatalogReadDatabase, page: number, actor: string, now = new Date()) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !actor.trim() || !Number.isFinite(now.valueOf())) {
    throw new TypeError("媒体要求采集参数无效");
  }
  const key = `publisher:media-rules:${page}:${Math.floor(now.valueOf() / 60_000)}`;
  await database.execute(sql`INSERT INTO publisher_jobs
    (id, type, status, deterministic_key, aggregate_id, payload, available_at, max_attempts)
    VALUES (${randomUUID()}, 'sync_kol_catalog', 'ready', ${key}, ${key},
      ${JSON.stringify({ purpose: "media_rules_collect", page, requestedBy: actor })}, ${now}, 1)
    ON DUPLICATE KEY UPDATE deterministic_key = deterministic_key`);
  const [job] = records(await database.execute(sql`SELECT id FROM publisher_jobs
    WHERE deterministic_key = ${key} AND type = 'sync_kol_catalog' LIMIT 1`));
  if (typeof job?.id !== "string") throw new Error("媒体要求采集任务未能排队，请稍后重试");
  return { jobId: job.id };
}

/** Reads this job only; a previous successful catalogue/check is not evidence. */
export async function getMediaRulesCollection(database: CatalogReadDatabase, jobId: string, now = new Date()): Promise<MediaRulesCollectionState> {
  const [job] = records(await database.execute(sql`SELECT id, status, payload, created_at AS createdAt
    FROM publisher_jobs WHERE id = ${jobId} AND type = 'sync_kol_catalog' LIMIT 1`));
  const payload = object(job?.payload);
  if (!job || payload?.purpose !== "media_rules_collect") return { status: "failed", message: "媒体要求采集任务不存在" };
  const result = object(payload.mediaRulesCollection);
  if (job.status === "succeeded" && result?.status === "succeeded") {
    const pagination = object(result.pagination);
    if (count(result.collected) && count(result.matched) && pagination
      && count(pagination.currentPage)
      && count(pagination.lastPage)
      && count(pagination.perPage) && pagination.perPage > 0 && count(pagination.total)) {
      return { status: "succeeded", result: { collected: result.collected, matched: result.matched,
        pagination: { currentPage: pagination.currentPage, lastPage: pagination.lastPage, perPage: pagination.perPage, total: pagination.total } } };
    }
  }
  // Drizzle raw MySQL queries return DATETIME as a timezone-less string.
  // This database stores UTC; never let the API process's local timezone age it.
  const rawCreatedAt = typeof job.createdAt === "string"
    && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(job.createdAt)
    ? `${job.createdAt.replace(" ", "T")}Z` : job.createdAt;
  const createdAt = new Date(rawCreatedAt as string | number | Date).valueOf();
  if (job.status === "succeeded" || job.status === "dead" || !Number.isFinite(createdAt) || now.valueOf() - createdAt >= 5 * 60_000) {
    return { status: "failed", message: "媒体要求采集未完成，请稍后重试或联系管理员" };
  }
  return { status: "pending" };
}
