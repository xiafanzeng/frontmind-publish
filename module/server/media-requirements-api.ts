import { Router, json } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { ModuleHttpCore } from "./http-api.js";
import { getKolRuntimeStatus } from "./providers/kol/runtime.js";
import { setTimeout as pause } from "node:timers/promises";
import { requestMediaRulesCollection, getMediaRulesCollection } from "./catalog-read-jobs.js";
import { KolProviderError } from "./providers/kol/errors.js";
import { parseMediaRules, preflightMediaRules, type MediaRules } from "./providers/kol/media-rules.js";

const configurationHelp = "官方 API 待配置。请管理员准备 PUBLISHER_FEATURE_ENABLED=true、PUBLISHER_PROVIDER_ENABLED=true、PUBLISHER_MODE=live（或 test）、HTTPS 的 PUBLISHER_KOL_BASE_URL，以及 PUBLISHER_KOL_ACCESS_TOKEN；或完整登录字段 PUBLISHER_KOL_API_KEY、PUBLISHER_KOL_MOBILE、PUBLISHER_KOL_PASSWORD、PUBLISHER_KOL_IDENTITY、PUBLISHER_KOL_CAPTCHA、PUBLISHER_KOL_CAPTCHA_TOKEN。配置后通过现有目录同步链路入库。凭据只在服务端填写。";
const pageSchema = z.coerce.number().int().min(1).max(100_000);
const articleSchema = z.object({
  mediaId: z.string().uuid(), title: z.string().max(1000),
  body: z.string().max(2_000_000), images: z.number().int().min(0).max(10000),
  links: z.number().int().min(0).max(10000),
}).strict();
type MediaRow = { id: string; name: string; externalResourceId: string; price: string; remark: string | null; titleLimit: number | null; collectedAt: Date | string; rawPayload: Record<string, unknown> | string };

function rulesFor(row: MediaRow): MediaRules {
  const raw = typeof row.rawPayload === "string" ? JSON.parse(row.rawPayload) : row.rawPayload;
  // Reparse server-controlled raw evidence, never accept browser-supplied rules.
  const saved = raw?.frontmindMediaRules as { rawRemark?: unknown; collectedAt?: unknown; apiTitleLimit?: unknown } | undefined;
  if (saved && typeof saved.rawRemark === "string" && typeof saved.collectedAt === "string") {
    return parseMediaRules(saved.rawRemark, saved.collectedAt,
      typeof saved.apiTitleLimit === "number" ? saved.apiTitleLimit : undefined);
  }
  return parseMediaRules(row.remark ?? "", new Date(row.collectedAt).toISOString(), row.titleLimit);
}

/** Shared catalog has no owner rows. Only authenticated users can read it;
 * manuscripts are request-local and are never stored or sent to the provider. */
export function createMediaRequirementsApi(core: ModuleHttpCore): Router {
  const router = Router();
  router.use(json({ limit: "3mb" }));
  // Capability-only response: never disclose a token, URL value or login material.
  router.get("/status", (req, res) => {
    try {
      core.context(req); res.setHeader("Cache-Control", "no-store");
      const status = getKolRuntimeStatus(core.environment);
      res.json({ configured: status.configured && status.mode !== "mock",
        message: status.configured && status.mode !== "mock" ? undefined : configurationHelp });
    } catch { res.status(503).json({ configured: false, message: configurationHelp }); }
  });
  router.use((req, res, next) => {
    try {
      core.context(req);
      res.setHeader("Cache-Control", "no-store");
      const status = getKolRuntimeStatus(core.environment);
      if (!status.configured || status.mode === "mock") {
        res.status(503).json({ code: "rules_not_configured", message: configurationHelp });
        return;
      }
      next();
    } catch { res.status(503).json({ code: "rules_not_configured", message: configurationHelp }); }
  });
  const fail = (res: import("express").Response, error: unknown) => {
    if (error instanceof z.ZodError) { res.status(400).json({ code: "invalid_input", message: "输入格式不正确，请检查稿件和页码。" }); return; }
    res.status(503).json({ code: error instanceof KolProviderError ? error.code : "rules_unavailable", message: "媒体要求读取失败，请重试或联系管理员核对 API 与同步状态。" });
  };
  router.get("/", async (req, res) => {
    try {
      // Match the displayed gateway rows by immutable internal ids, independent
      // of API/catalog sort order. One bounded request serves each directory page.
      if (req.query.ids !== undefined) {
        const ids = z.string().max(4000).parse(req.query.ids).split(",");
        z.array(z.string().uuid()).min(1).max(101).parse(ids);
        const db = await core.database();
        const [rows] = await db.execute(sql`select id, name, external_resource_id as externalResourceId,
          cast(price_ten_thousandths as char) as price, remark, title_limit as titleLimit,
          last_seen_at as collectedAt, raw_payload as rawPayload from publisher_media_resources
          where is_active = 1 and media_kind is not null and id in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
        res.json({ items: (rows as unknown as MediaRow[]).map(row => ({ id: row.id,
          name: row.name, externalResourceId: row.externalResourceId, price: row.price, rules: rulesFor(row) })) });
        return;
      }
      const page = pageSchema.parse(req.query.page ?? 1);
      const db = await core.database();
      const [rows] = await db.execute(sql`select id, name, external_resource_id as externalResourceId,
        cast(price_ten_thousandths as char) as price, remark, title_limit as titleLimit,
        last_seen_at as collectedAt, raw_payload as rawPayload from publisher_media_resources
        where is_active = 1 and media_kind is not null order by id limit 26 offset ${(page - 1) * 25}`);
      const records = rows as unknown as MediaRow[];
      res.json({ page, hasMore: records.length > 25, items: records.slice(0, 25).map(row => ({
        id: row.id, name: row.name, externalResourceId: row.externalResourceId, price: row.price,
        rules: rulesFor(row),
      })) });
    } catch (error) { fail(res, error); }
  });
  router.post("/collect", async (req, res) => {
    try {
      const { page } = z.object({ page: pageSchema }).strict().parse(req.body);
      const context = core.context(req);
      const db = await core.database();
      const { jobId } = await requestMediaRulesCollection(db, page, context.businessActorId);
      const deadline = Date.now() + 25_000;
      // Keep the existing collect response while the single publishing Worker
      // performs the read and snapshot update with its own authenticated client.
      while (!res.destroyed) {
        const check = await getMediaRulesCollection(db, jobId);
        if (check.status === "succeeded" && check.result) {
          res.json(check.result);
          return;
        }
        if (check.status === "failed") throw new Error("Media requirements collection failed");
        if (Date.now() >= deadline) {
          res.status(503).json({ code: "rules_collection_pending",
            message: "媒体要求正在后台采集，请稍后重新读取。", jobId });
          return;
        }
        await pause(250);
      }
    } catch (error) { fail(res, error); }
  });
  router.post("/preflight", async (req, res) => {
    try {
      const input = articleSchema.parse(req.body);
      const db = await core.database();
      const [rows] = await db.execute(sql`select id, name, external_resource_id as externalResourceId,
        cast(price_ten_thousandths as char) as price, remark, title_limit as titleLimit,
        last_seen_at as collectedAt, raw_payload as rawPayload from publisher_media_resources
        where id = ${input.mediaId} and is_active = 1 and media_kind is not null limit 1`);
      const row = (rows as unknown as MediaRow[])[0];
      if (!row) { res.status(404).json({ code: "media_not_found", message: "媒体不存在或已停止接单。" }); return; }
      const rules = rulesFor(row);
      res.json({ ...preflightMediaRules(rules, input), mediaId: row.id, collectedAt: rules.collectedAt, source: rules.source });
    } catch (error) { fail(res, error); }
  });
  return router;
}
