import { Router, json } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { ModuleHttpCore } from "./http-api.js";
import { createKolRuntimeClient, getKolRuntimeStatus } from "./providers/kol/runtime.js";
import { KolClient } from "./providers/kol/client.js";
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
      const client = createKolRuntimeClient(core.environment);
      if (!(client instanceof KolClient)) throw new Error("Real client required");
      const collected = await client.listMediaRules(page);
      const db = await core.database();
      // Persist only a requirements snapshot in the existing media JSON archive.
      // Prices and availability remain owned by catalog sync. Advance revision
      // so frozen selections and previous publication preflights are invalidated.
      let matched = 0;
      await db.transaction(async tx => {
        for (const item of collected.resources) {
          const title = item.rules.rules.find(x => x.field === "title_chars");
          const apiEvidence = title?.evidence.find(x => x.startsWith("API title_limit="));
          const snapshot = JSON.stringify({ rawRemark: item.rules.rawRemark, collectedAt: item.rules.collectedAt,
            source: item.rules.source, apiTitleLimit: apiEvidence ? Number(apiEvidence.split("=")[1]) : null });
          const [result] = await tx.execute(sql`update publisher_media_resources
            set raw_payload = JSON_SET(raw_payload, '$.frontmindMediaRules', cast(${snapshot} as json)),
                catalog_revision = SHA2(CONCAT(catalog_revision, ${snapshot}), 256)
            where external_resource_id = ${item.externalResourceId}`);
          matched += Number((result as unknown as { affectedRows?: number }).affectedRows ?? 0);
        }
      });
      res.json({ collected: collected.resources.length, matched, pagination: collected.pagination });
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
