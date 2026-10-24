import { randomUUID } from 'node:crypto';
import { sql,type SQL } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { digest, clone, type Row } from './common.js';

/**
 * Trusted article binding between the source matrix and the real publishing
 * business. Publisher tables are reached with the same raw-SQL approach as the
 * media requirements API: no host adapter, no vendor change, no new tables.
 * Every read is scoped to the authenticated business owner and project, so a
 * wrong or missing binding fails closed instead of leaking another owner.
 */
export interface BindingOwnerContext { ownerId: string; enterpriseProjectId: string; }

export interface DraftSelectionRow {
  mediaResourceId: string;
  externalResourceId: string;
  selectedPriceTenThousandths: string;
  selectedCatalogRevision: string;
}

export interface TrustedArticleBinding {
  draftId: string | null;
  draftRevision: number | null;
  draftStatus: string | null;
  articleVersionId: string;
  articleId: string;
  versionNumber: number;
  contentHash: string;
  containsImages: boolean;
  articleTitle: string;
  selections: DraftSelectionRow[];
  fingerprint: string;
}

export interface BindingMediaResource {
  id: string;
  name: string;
  externalResourceId: string;
  mediaKind: string;
  priceTenThousandths: string;
  catalogRevision: string | null;
  remark: string | null;
  titleLimit: number | null;
  rawPayload: Record<string, unknown>;
  imageSupport: 'unknown' | 'verified' | 'unsupported';
}

export interface ExistingDraftItem {
  mediaResourceId: string;
  externalResourceId: string;
  submissionTitle: string;
  selectedPriceTenThousandths: string;
  selectedCatalogRevision: string;
  mediaKindSnapshot: string;
  mediaSnapshot: Record<string, unknown>;
}

export type BindingFailure = 'draft_not_found' | 'version_not_found' | 'draft_version_mismatch';

/** The version identity the planner uses for manuscript and item keys. */
export const bindingVersionKey = (binding: Pick<TrustedArticleBinding, 'versionNumber'>) => 'v' + binding.versionNumber;

export function bindingFingerprint(input: {
  articleVersionId: string; contentHash: string; draftId: string | null;
  draftRevision: number | null; selections: Array<{ mediaResourceId: string }>;
}): string {
  return digest({
    article_version_id: input.articleVersionId,
    content_hash: input.contentHash,
    draft_id: input.draftId,
    draft_revision: input.draftRevision,
    selections: input.selections.map(selection => selection.mediaResourceId).sort(),
  });
}

/** Manuscripts always come from the server-verified frozen version, never the browser. */
export function bindingManuscripts(binding: TrustedArticleBinding): Row[] {
  return [{
    article_id: binding.articleId,
    version: bindingVersionKey(binding),
    title: binding.articleTitle,
    content_hash: binding.contentHash,
    contains_images: binding.containsImages,
    source: 'trusted_article_version',
  }];
}

/**
 * Current draft selections ride along as preferences: they keep offer identity
 * honest during budget verification but never force their way into a plan.
 */
export function bindingSelectedItems(binding: TrustedArticleBinding): Row[] {
  return binding.selections.map(selection => ({
    article_id: binding.articleId,
    version: bindingVersionKey(binding),
    resource_id: selection.mediaResourceId,
    offer_id: null,
    publication_spec: null,
    quantity: 1,
    locked: false,
  }));
}

export interface PlanItemInput { article_id?: unknown; version?: unknown; resource_id?: unknown; offer_id?: unknown; publication_spec?: unknown; quantity?: unknown; purpose?: unknown; }

export interface ApplyAddition {
  mediaResourceId: string; name: string; externalResourceId: string;
  priceTenThousandths: string; offerId: string | null; publicationSpec: unknown;
  purpose: string | null; reason: string | null;
}

export interface ApplyDiff {
  additions: ApplyAddition[];
  alreadySelected: Array<{ mediaResourceId: string; name: string; reason: string }>;
  skipped: Array<{ key: string; reason: string }>;
  overLimit: boolean;
  mergedCount: number;
  knownTotalTenThousandths: string | null;
  pendingPriced: number;
}

const validPrice = (value: string) => /^\d+$/.test(value) && BigInt(value) > 0n;

/** mysql2 may hand JSON columns back as strings; rule helpers expect objects. */
function parseRawPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
  return {};
}

/**
 * mysql2 results arrive as [rows, fields], a bare OkPacket or a typed
 * ResultSetHeader depending on the drizzle/mysql2 version; normalise through
 * unknown so both the standalone and host builds typecheck.
 */
function rowsOf(result: unknown): Row[] {
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? rows.filter((row): row is Row => !!row && typeof row === 'object') : [];
}

/**
 * Pure diff of one budget plan against the current trusted cart. The plan is
 * trusted data from the archived snapshot; resources are the live catalogue.
 * Items that cannot be honoured honestly are skipped with a reason instead of
 * being merged by media name.
 */
export function resolvePlanItems(
  plan: { items?: unknown; details?: unknown },
  binding: TrustedArticleBinding,
  existingItems: ExistingDraftItem[],
  resources: Map<string, BindingMediaResource>,
  imageBlocker: (resource: BindingMediaResource) => string | null,
): ApplyDiff {
  const items = Array.isArray(plan.items) ? plan.items as PlanItemInput[] : [];
  const details = Array.isArray(plan.details) ? plan.details as Row[] : [];
  const existingByMedia = new Map(existingItems.map(item => [item.mediaResourceId, item]));
  const additions: ApplyAddition[] = [];
  const alreadySelected: ApplyDiff['alreadySelected'] = [];
  const skipped: ApplyDiff['skipped'] = [];
  const versionKey = bindingVersionKey(binding);
  const seen = new Set<string>();
  items.forEach((raw, index) => {
    const row: PlanItemInput = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const resourceId = typeof row.resource_id === 'string' ? row.resource_id : '';
    const key = resourceId || 'item-' + index;
    if (seen.has(key)) { skipped.push({ key, reason: '组合内同一资源出现多次，未重复加入' }); return; }
    seen.add(key);
    if (row.article_id !== binding.articleId || String(row.version ?? '') !== versionKey) {
      skipped.push({ key, reason: '组合发布项与当前绑定稿件或版本不一致' }); return;
    }
    const quantity = row.quantity;
    if (quantity !== 1 && quantity !== '1') { skipped.push({ key, reason: '发布数量 ' + String(quantity ?? '未知') + ' 暂不支持一键加入，请单独处理' }); return; }
    const resource = resources.get(resourceId) ?? [...resources.values()].find(candidate => candidate.externalResourceId === resourceId);
    if (!resource) { skipped.push({ key, reason: '未映射到当前可售媒体目录' }); return; }
    if (!validPrice(resource.priceTenThousandths)) { skipped.push({ key, reason: '媒体当前无有效报价，需先询价' }); return; }
    const blocked = imageBlocker(resource);
    if (blocked) { skipped.push({ key, reason: blocked }); return; }
    if (existingByMedia.has(resource.id)) {
      alreadySelected.push({ mediaResourceId: resource.id, name: resource.name, reason: '已在购物车，保留原选择与报价身份' });
      return;
    }
    const detail = details[index];
    additions.push({
      mediaResourceId: resource.id, name: resource.name, externalResourceId: resource.externalResourceId,
      priceTenThousandths: resource.priceTenThousandths,
      offerId: typeof row.offer_id === 'string' && row.offer_id ? row.offer_id : null,
      publicationSpec: row.publication_spec ?? null,
      purpose: typeof row.purpose === 'string' ? row.purpose : null,
      reason: detail && typeof detail.reason === 'string' ? detail.reason : null,
    });
  });
  const mergedCount = existingItems.length + additions.length;
  const priced = [...existingItems.map(item => item.selectedPriceTenThousandths), ...additions.map(addition => addition.priceTenThousandths)];
  const pendingPriced = priced.filter(value => !validPrice(value)).length;
  const knownTotal = priced.filter(validPrice).reduce((sum, value) => sum + BigInt(value), 0n).toString();
  return { additions, alreadySelected, skipped, overLimit: mergedCount > 20, mergedCount, knownTotalTenThousandths: knownTotal, pendingPriced };
}

export class BindingStore {
  constructor(private db: MySql2Database<any>, readonly ctx: BindingOwnerContext) {}

  private async rows(statement: SQL): Promise<Row[]> {
    const result = await this.db.execute(statement) as unknown;
    const rows = Array.isArray(result) ? (result[0] as unknown[] ?? []) : [];
    return rows.filter((row): row is Row => !!row && typeof row === 'object');
  }

  async loadVersion(articleVersionId: string) {
    const rows = await this.rows(sql`select v.id, v.article_id, v.version, v.content_hash, v.contains_images, a.working_name
      from publisher_article_versions v join publisher_articles a on a.id = v.article_id and a.owner_id = v.owner_id
      where v.id = ${articleVersionId} and v.owner_id = ${this.ctx.ownerId}
        and (v.enterprise_project_id is null or v.enterprise_project_id = ${this.ctx.enterpriseProjectId}) limit 1`);
    const row = rows[0];
    if (!row) return null;
    return {
      articleVersionId: String(row.id), articleId: String(row.article_id), versionNumber: Number(row.version),
      contentHash: String(row.content_hash), containsImages: row.contains_images === 1 || row.contains_images === true,
      articleTitle: String(row.working_name ?? ''),
    };
  }

  async loadDraft(draftId: string) {
    const rows = await this.rows(sql`select id, article_version_id, status, revision from publisher_drafts
      where id = ${draftId} and owner_id = ${this.ctx.ownerId}
        and (enterprise_project_id is null or enterprise_project_id = ${this.ctx.enterpriseProjectId}) limit 1`);
    const row = rows[0];
    if (!row) return null;
    return { id: String(row.id), articleVersionId: String(row.article_version_id), status: String(row.status), revision: Number(row.revision) };
  }

  async loadDraftItems(draftId: string): Promise<ExistingDraftItem[]> {
    const rows = await this.rows(sql`select media_resource_id, external_resource_id, submission_title,
      cast(selected_price_ten_thousandths as char) as price, selected_catalog_revision, media_kind_snapshot, media_snapshot
      from publisher_draft_items where draft_id = ${draftId} and owner_id = ${this.ctx.ownerId}`);
    return rows.map(row => ({
      mediaResourceId: String(row.media_resource_id),
      externalResourceId: String(row.external_resource_id ?? ''),
      submissionTitle: String(row.submission_title ?? ''),
      selectedPriceTenThousandths: String(row.price ?? ''),
      selectedCatalogRevision: String(row.selected_catalog_revision ?? ''),
      mediaKindSnapshot: String(row.media_kind_snapshot ?? 'unknown'),
      mediaSnapshot: (row.media_snapshot && typeof row.media_snapshot === 'object' ? row.media_snapshot : {}) as Record<string, unknown>,
    }));
  }

  /** Loads the trusted binding; the server re-reads everything, the browser only supplies ids. */
  async loadBinding(input: { draftId?: string; articleVersionId?: string }): Promise<{ binding?: TrustedArticleBinding; failure?: BindingFailure }> {
    let draft: { id: string; articleVersionId: string; status: string; revision: number } | null = null;
    if (input.draftId) {
      draft = await this.loadDraft(input.draftId);
      if (!draft) return { failure: 'draft_not_found' };
      if (input.articleVersionId && draft.articleVersionId !== input.articleVersionId) return { failure: 'draft_version_mismatch' };
    }
    const versionId = draft?.articleVersionId ?? input.articleVersionId ?? '';
    if (!versionId) return { failure: 'version_not_found' };
    const version = await this.loadVersion(versionId);
    if (!version) return { failure: 'version_not_found' };
    const selections = draft ? await this.loadDraftItems(draft.id) : [];
    const binding: TrustedArticleBinding = {
      draftId: draft?.id ?? null, draftRevision: draft?.revision ?? null, draftStatus: draft?.status ?? null,
      articleVersionId: version.articleVersionId, articleId: version.articleId, versionNumber: version.versionNumber,
      contentHash: version.contentHash, containsImages: version.containsImages, articleTitle: version.articleTitle,
      selections: selections.map(item => ({
        mediaResourceId: item.mediaResourceId, externalResourceId: item.externalResourceId,
        selectedPriceTenThousandths: item.selectedPriceTenThousandths, selectedCatalogRevision: item.selectedCatalogRevision,
      })),
      fingerprint: '',
    };
    binding.fingerprint = bindingFingerprint(binding);
    return { binding };
  }

  /** Shared catalogue, like the media requirements API: active rows with a kind and price. */
  async loadMediaResources(keys: string[]): Promise<Map<string, BindingMediaResource>> {
    if (!keys.length) return new Map();
    const uniqueKeys = [...new Set(keys)];
    const placeholders = sql.join(uniqueKeys.map(key => sql`${key}`), sql`, `);
    const rows = await this.rows(sql`select r.id, r.name, r.external_resource_id, r.media_kind,
      cast(r.price_ten_thousandths as char) as price, r.catalog_revision, r.remark, r.title_limit, r.raw_payload, c.image_support
      from publisher_media_resources r left join publisher_media_capabilities c on c.media_resource_id = r.id
      where (r.id in (${placeholders}) or r.external_resource_id in (${placeholders})) and r.is_active = 1 and r.media_kind is not null`);
    const map = new Map<string, BindingMediaResource>();
    for (const row of rows) {
      const resource: BindingMediaResource = {
        id: String(row.id), name: String(row.name ?? ''), externalResourceId: String(row.external_resource_id ?? ''),
        mediaKind: String(row.media_kind), priceTenThousandths: String(row.price ?? ''),
        catalogRevision: row.catalog_revision == null ? null : String(row.catalog_revision),
        remark: row.remark == null ? null : String(row.remark),
        titleLimit: row.title_limit == null ? null : Number(row.title_limit),
        rawPayload: parseRawPayload(row.raw_payload),
        imageSupport: ['unknown', 'verified', 'unsupported'].includes(String(row.image_support)) ? String(row.image_support) as BindingMediaResource['imageSupport'] : 'unknown',
      };
      map.set(resource.id, resource);
    }
    return map;
  }

  /**
   * Inserts only the new plan items inside one transaction with a revision
   * compare-and-set. Existing rows keep their titles, snapshots and prices, so
   * a merge can never silently replace a manual selection.
   */
  async insertPlanItems(input: {
    draftId: string; expectedRevision: number; additions: ApplyAddition[];
    mediaSnapshotFor: (resource: BindingMediaResource, addition: ApplyAddition) => Record<string, unknown>;
    planIdentity: { taskId: string; planId: string; planVersion: string; planIndex: number };
  }): Promise<{ ok: true; revision: number } | { ok: false; reason: 'draft_changed' | 'revision_conflict' }> {
    return this.db.transaction(async tx => {
      const locked: unknown = await tx.execute(sql`select id, revision, status from publisher_drafts
        where id = ${input.draftId} and owner_id = ${this.ctx.ownerId}
          and (enterprise_project_id is null or enterprise_project_id = ${this.ctx.enterpriseProjectId}) for update`);
      const rows = rowsOf(locked);
      const draft = rows[0];
      if (!draft) return { ok: false, reason: 'draft_changed' } as const;
      if (Number(draft.revision) !== input.expectedRevision) return { ok: false, reason: 'revision_conflict' } as const;
      if (draft.status === 'submitted' || draft.status === 'archived') return { ok: false, reason: 'draft_changed' } as const;
      const keys = input.additions.map(addition => addition.mediaResourceId);
      const placeholders = keys.length ? sql.join(keys.map(key => sql`${key}`), sql`, `) : sql`''`;
      const resourceRows: unknown = await tx.execute(sql`select r.id, r.name, r.external_resource_id, r.media_kind,
        cast(r.price_ten_thousandths as char) as price, r.catalog_revision, r.remark, r.title_limit, r.raw_payload, c.image_support
        from publisher_media_resources r left join publisher_media_capabilities c on c.media_resource_id = r.id
        where r.id in (${placeholders}) and r.is_active = 1 and r.media_kind is not null`);
      const resources = new Map<string, BindingMediaResource>();
      for (const row of rowsOf(resourceRows)) {
        resources.set(String(row.id), {
          id: String(row.id), name: String(row.name ?? ''), externalResourceId: String(row.external_resource_id ?? ''),
          mediaKind: String(row.media_kind), priceTenThousandths: String(row.price ?? ''),
          catalogRevision: row.catalog_revision == null ? null : String(row.catalog_revision),
          remark: row.remark == null ? null : String(row.remark), titleLimit: row.title_limit == null ? null : Number(row.title_limit),
          rawPayload: parseRawPayload(row.raw_payload),
          imageSupport: ['unknown', 'verified', 'unsupported'].includes(String(row.image_support)) ? String(row.image_support) as BindingMediaResource['imageSupport'] : 'unknown',
        });
      }
      const existing: unknown = await tx.execute(sql`select media_resource_id from publisher_draft_items where draft_id = ${input.draftId} and owner_id = ${this.ctx.ownerId}`);
      const existingIds = new Set(rowsOf(existing).map(row => String(row.media_resource_id)));
      const selectedAt = new Date().toISOString().slice(0, 23).replace('T', ' ');
      for (const addition of input.additions) {
        if (existingIds.has(addition.mediaResourceId)) continue;
        const resource = resources.get(addition.mediaResourceId);
        if (!resource || !validPrice(resource.priceTenThousandths)) return { ok: false, reason: 'draft_changed' } as const;
        const snapshot = input.mediaSnapshotFor(resource, addition);
        await tx.execute(sql`insert into publisher_draft_items
          (id, enterprise_project_id, owner_id, draft_id, media_resource_id, external_resource_id, submission_title,
           selected_price_ten_thousandths, selected_catalog_revision, media_kind_snapshot, media_snapshot, selected_at)
          values (${randomUUID()}, ${this.ctx.enterpriseProjectId}, ${this.ctx.ownerId}, ${input.draftId}, ${resource.id},
            ${resource.externalResourceId}, '', ${resource.priceTenThousandths}, ${resource.catalogRevision ?? ''},
            ${resource.mediaKind}, ${JSON.stringify(snapshot)}, ${selectedAt})`);
        existingIds.add(resource.id);
      }
      const updated: unknown = await tx.execute(sql`update publisher_drafts set revision = revision + 1, status = 'draft', updated_at = now(3)
        where id = ${input.draftId} and owner_id = ${this.ctx.ownerId} and revision = ${input.expectedRevision}`);
      const header = (Array.isArray(updated) ? updated[0] : updated) as { affectedRows?: unknown } | undefined;
      const affected = header && typeof header.affectedRows === 'number' ? header.affectedRows : 1;
      if (affected !== 1) return { ok: false, reason: 'revision_conflict' } as const;
      return { ok: true, revision: input.expectedRevision + 1 } as const;
    });
  }
}

/** Snapshot keys used by later saves for title rules; publication payload rides in the same json. */
export function publicationSnapshot(resource: BindingMediaResource, addition: ApplyAddition, planIdentity: { taskId: string; planId: string; planVersion: string; planIndex: number }): Record<string, unknown> {
  return {
    name: resource.name,
    externalResourceId: resource.externalResourceId,
    kind: resource.mediaKind,
    priceTenThousandths: resource.priceTenThousandths,
    catalogRevision: resource.catalogRevision,
    remark: resource.remark,
    titleLimit: resource.titleLimit,
    imageSupport: resource.imageSupport,
    publication: {
      source: 'source_matrix_budget_plan',
      task_id: planIdentity.taskId,
      plan_id: planIdentity.planId,
      plan_version: planIdentity.planVersion,
      plan_index: planIdentity.planIndex,
      offer_id: addition.offerId,
      publication_spec: addition.publicationSpec === undefined ? null : clone(addition.publicationSpec),
      quantity: 1,
      purpose: addition.purpose,
    },
  };
}
