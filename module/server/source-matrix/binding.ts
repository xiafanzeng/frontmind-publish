import { randomUUID } from 'node:crypto';
import { sql,type SQL } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { digest, clone, type Row } from './common.js';
import { loadPlannerCatalog, resolvePublisherQuote } from '../publisher-source-matrix-catalog.js';
import { mediaRulesEvidence, mediaRulesTitleLimit } from '../providers/kol/media-rules.js';

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
  publication?: Row;
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
    selections: input.selections.map(selection => selection).sort((a,b)=>a.mediaResourceId.localeCompare(b.mediaResourceId)),
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
    offer_id: selection.publication?.offerId ?? null,
    publication_spec: selection.publication?.publicationSpec ?? null,
    quantity: selection.publication?.quantity ?? 1,
    locked: selection.publication?.locked === true,
    ...(selection.publication?.purpose ? {purpose:selection.publication.purpose}:{}),
  }));
}

export interface PlanItemInput { article_id?: unknown; version?: unknown; resource_id?: unknown; offer_id?: unknown; publication_spec?: unknown; quantity?: unknown; purpose?: unknown; }

export interface ApplyAddition {
  mediaResourceId: string; name: string; externalResourceId: string;
  priceTenThousandths: string; offerId: string | null; publicationSpec: unknown;
  purpose: string | null; reason: string | null;
  articleId: string; articleVersionId: string; articleVersion: string; quantity: number;
  quantityMeaning: 'single' | 'repeat_same_article'; totalPriceTenThousandths: string;
  quoteFingerprint: string; catalogRevision: string; replaceExisting?: boolean;
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
  plan: { items?: unknown; details?: unknown }, binding: TrustedArticleBinding,
  existingItems: ExistingDraftItem[], resources: Map<string, BindingMediaResource>,
  imageBlocker: (resource: BindingMediaResource) => string | null,
  options: {publicationIntent?:string;asOf?:string;taskId?:string} = {},
): ApplyDiff {
  const items=Array.isArray(plan.items)?plan.items as PlanItemInput[]:[];
  const details=Array.isArray(plan.details)?plan.details as Row[]:[];
  const additions:ApplyAddition[]=[],alreadySelected:ApplyDiff['alreadySelected']=[],skipped:ApplyDiff['skipped']=[];
  const existingByMedia=new Map(existingItems.map(item=>[item.mediaResourceId,item]));
  const seen=new Set<string>();
  for(const [index,row] of items.entries()){
    const key=typeof row?.resource_id==='string'?row.resource_id:'item-'+index;
    if(seen.has(key)){skipped.push({key,reason:'同一媒体不同规格或重复发布项须明确修订，不能自动合并'});continue;}seen.add(key);
    if(row.article_id!==binding.articleId||String(row.version??'')!==bindingVersionKey(binding)){skipped.push({key,reason:'组合发布项与当前绑定稿件或版本不一致'});continue;}
    if(typeof row.quantity!=='number'||!Number.isSafeInteger(row.quantity)||row.quantity<1){skipped.push({key,reason:'发布数量须为正整数'});continue;}
    if(row.quantity>1&&options.publicationIntent!=='repeat_existing_article'){skipped.push({key,reason:'多篇新内容尚待逐篇绑定；只有明确重复发布当前冻结稿件的要求可采用多数量'});continue;}
    const resource=resources.get(key);
    if(!resource){skipped.push({key,reason:'未映射到当前可售媒体的准确内部身份'});continue;}
    const blocked=imageBlocker(resource);if(blocked){skipped.push({key,reason:blocked});continue;}
    const quote=resolvePublisherQuote(resource,{offerId:String(row.offer_id??''),publicationSpec:row.publication_spec,quantity:row.quantity,purpose:String(row.purpose??'')},options.asOf);
    if(!quote.ok){skipped.push({key,reason:quote.reason});continue;}
    const previous=existingByMedia.get(resource.id),publication=previous?parseRawPayload(previous.mediaSnapshot.publication):{};
    const same=previous&&publication.articleVersionId===binding.articleVersionId&&publication.offerId===row.offer_id&&digest(publication.publicationSpec)===digest(row.publication_spec)&&publication.purpose===row.purpose;
    if(previous&&same&&publication.quantity===row.quantity&&publication.quoteFingerprint===quote.quoteFingerprint){alreadySelected.push({mediaResourceId:resource.id,name:resource.name,reason:'相同发布项已存在，未累计数量'});continue;}
    if(previous&&(!same||publication.locked===true||!options.taskId||publication.taskId!==options.taskId)){skipped.push({key,reason:'保留现有手动项、锁定项或不同报价规格；请先明确处理购物车冲突'});continue;}
    additions.push({mediaResourceId:resource.id,name:resource.name,externalResourceId:resource.externalResourceId,
      priceTenThousandths:quote.unitPriceTenThousandths,totalPriceTenThousandths:quote.totalPriceTenThousandths,
      offerId:String(row.offer_id),publicationSpec:clone(row.publication_spec),purpose:String(row.purpose),reason:previous?`修订现有发布项：${String(publication.quantity)} 篇 → ${row.quantity} 篇；按最新确认费用替换，不累计篇数`:typeof details[index]?.reason==='string'?details[index]!.reason as string:'新增完整发布项',
      articleId:binding.articleId,articleVersionId:binding.articleVersionId,articleVersion:bindingVersionKey(binding),quantity:row.quantity,
      quantityMeaning:row.quantity>1?'repeat_same_article':'single',quoteFingerprint:quote.quoteFingerprint,catalogRevision:resource.catalogRevision??'',replaceExisting:!!previous});
  }
  const mergedCount=existingItems.length+additions.filter(a=>!a.replaceExisting).length;
  const replaced=new Set(additions.filter(a=>a.replaceExisting).map(a=>a.mediaResourceId));
  const prices=[...existingItems.filter(i=>!replaced.has(i.mediaResourceId)).map(i=>{
    const total=parseRawPayload(i.mediaSnapshot.publication).totalPriceTenThousandths;
    return typeof total==='string'&&/^\d+$/.test(total)?total:validPrice(i.selectedPriceTenThousandths)?i.selectedPriceTenThousandths:null;
  }),...additions.map(a=>a.totalPriceTenThousandths)];
  const known=prices.filter((v):v is string=>v!==null&&/^\d+$/.test(v));
  const pendingPriced=prices.length-known.length;
  // The merged-cart total includes preserved manual rows; it is not the plan's separate budget feasibility.
  return {additions,alreadySelected,skipped,overLimit:mergedCount>20,mergedCount,knownTotalTenThousandths:known.reduce((sum,v)=>sum+BigInt(v),0n).toString(),pendingPriced};
}

export class BindingStore {
  constructor(private db: MySql2Database<any>, readonly ctx: BindingOwnerContext) {}

  async loadPlannerCatalog() { return loadPlannerCatalog(this.db,this.ctx.ownerId,this.ctx.enterpriseProjectId); }

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
      mediaSnapshot: parseRawPayload(row.media_snapshot),
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
        publication:parseRawPayload(item.mediaSnapshot.publication),
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
      where r.id in (${placeholders}) and r.is_active = 1 and r.media_kind is not null`);
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
    tenantId: string; draftId: string; expectedRevision: number; additions: ApplyAddition[];
    mediaSnapshotFor: (resource: BindingMediaResource, addition: ApplyAddition) => Record<string, unknown>;
    resourceBlocker?: (resource: BindingMediaResource) => string | null;
    planIdentity: { taskId: string; planId: string; planVersion: string; planIndex: number };
  }): Promise<{ ok: true; revision: number } | { ok: false; reason: 'draft_changed' | 'revision_conflict' | 'plan_changed' }> {
    return this.db.transaction(async tx => {
      // Serialize adoption with budget begin/save/cancel, not just cart writes.
      // tenantId comes from the authenticated MatrixRepository, never the body.
      const taskRows: unknown = await tx.execute(sql`select state, latest from publisher_source_matrix_tasks
        where tenant_id = ${input.tenantId} and task_id = ${input.planIdentity.taskId} for update`);
      const task = rowsOf(taskRows)[0], latest = parseRawPayload(task?.latest);
      if (!task || task.state !== 'complete' || latest.status !== 'complete'
        || latest.plan_id !== input.planIdentity.planId || latest.plan_version !== input.planIdentity.planVersion) {
        return { ok: false, reason: 'plan_changed' } as const;
      }
      const locked: unknown = await tx.execute(sql`select id, revision, status, article_version_id from publisher_drafts
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
      const existing: unknown = await tx.execute(sql`select media_resource_id,media_snapshot from publisher_draft_items where draft_id = ${input.draftId} and owner_id = ${this.ctx.ownerId} for update`);
      const previous=new Map(rowsOf(existing).map(row=>[String(row.media_resource_id),parseRawPayload(parseRawPayload(row.media_snapshot).publication)]));
      // Validate every item before the first write; returning a business error may commit a transaction.
      for(const addition of input.additions){
        const resource=resources.get(addition.mediaResourceId);
        if(!resource||String(draft.article_version_id)!==addition.articleVersionId||resource.catalogRevision!==addition.catalogRevision) return {ok:false,reason:'draft_changed'} as const;
        if(input.resourceBlocker?.(resource)) return {ok:false,reason:'draft_changed'} as const;
        const current=resolvePublisherQuote(resource,{offerId:addition.offerId??'',publicationSpec:addition.publicationSpec,quantity:addition.quantity,purpose:addition.purpose??''});
        if(!current.ok||current.quoteFingerprint!==addition.quoteFingerprint||current.totalPriceTenThousandths!==addition.totalPriceTenThousandths) return {ok:false,reason:'draft_changed'} as const;
        const old=previous.get(addition.mediaResourceId);
        if(old&&(!addition.replaceExisting||old.locked===true||old.taskId!==input.planIdentity.taskId||old.articleVersionId!==addition.articleVersionId||old.offerId!==addition.offerId||digest(old.publicationSpec)!==digest(addition.publicationSpec)||old.purpose!==addition.purpose)) return {ok:false,reason:'draft_changed'} as const;
        if(!old&&addition.replaceExisting) return {ok:false,reason:'draft_changed'} as const;
      }
      if(previous.size+input.additions.filter(a=>!a.replaceExisting).length>20) return {ok:false,reason:'draft_changed'} as const;
      const selectedAt = new Date().toISOString().slice(0, 23).replace('T', ' ');
      for (const addition of input.additions) {
        const resource = resources.get(addition.mediaResourceId)!;
        const snapshot = input.mediaSnapshotFor(resource, addition);
        if(addition.replaceExisting){
          await tx.execute(sql`update publisher_draft_items set selected_price_ten_thousandths=${addition.priceTenThousandths},selected_catalog_revision=${resource.catalogRevision??''},media_snapshot=${JSON.stringify(snapshot)},selected_at=${selectedAt} where draft_id=${input.draftId} and owner_id=${this.ctx.ownerId} and media_resource_id=${resource.id}`);
        }else{
          await tx.execute(sql`insert into publisher_draft_items
            (id, enterprise_project_id, owner_id, draft_id, media_resource_id, external_resource_id, submission_title,
             selected_price_ten_thousandths, selected_catalog_revision, media_kind_snapshot, media_snapshot, selected_at)
            values (${randomUUID()}, ${this.ctx.enterpriseProjectId}, ${this.ctx.ownerId}, ${input.draftId}, ${resource.id},
              ${resource.externalResourceId}, '', ${addition.priceTenThousandths}, ${resource.catalogRevision ?? ''},
              ${resource.mediaKind}, ${JSON.stringify(snapshot)}, ${selectedAt})`);
        }
      }
      const updated: unknown = await tx.execute(sql`update publisher_drafts set revision = revision + 1, status = 'draft', updated_at = now(3)
        where id = ${input.draftId} and owner_id = ${this.ctx.ownerId} and revision = ${input.expectedRevision}`);
      const header = (Array.isArray(updated) ? updated[0] : updated) as { affectedRows?: unknown } | undefined;
      const affected = header && typeof header.affectedRows === 'number' ? header.affectedRows : 1;
      if (affected !== 1) throw new Error('Draft revision changed during locked publication merge');
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
    remark: mediaRulesEvidence(resource.remark,resource.titleLimit,resource.rawPayload).remark,
    titleLimit: Math.max(1,mediaRulesTitleLimit(resource.remark,resource.titleLimit,resource.rawPayload)),
    imageSupport: resource.imageSupport,
    publication: {
      schemaVersion:1,source:'source_matrix_budget_plan',taskId:planIdentity.taskId,planId:planIdentity.planId,
      planVersion:planIdentity.planVersion,planIndex:planIdentity.planIndex,
      articleId:addition.articleId,articleVersionId:addition.articleVersionId,articleVersion:addition.articleVersion,
      resourceId:resource.id,offerId:addition.offerId,publicationSpec:clone(addition.publicationSpec),
      quantity:addition.quantity,quantityMeaning:addition.quantityMeaning,purpose:addition.purpose,
      unitPriceTenThousandths:addition.priceTenThousandths,totalPriceTenThousandths:addition.totalPriceTenThousandths,
      quoteFingerprint:addition.quoteFingerprint,locked:false,
    },
  };
}
