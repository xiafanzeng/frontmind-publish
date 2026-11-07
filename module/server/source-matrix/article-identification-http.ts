import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { ModuleHttpCore } from '../http-api.js';
import type { IdentificationContext, IdentificationContextResponse, IdentificationFields, IdentifyArticleResponse } from '../../shared/article-identification.js';
import { BindingStore, type IdentificationArticle } from './binding.js';
import { loadIndustryCatalog } from './industry-catalog.js';
import { digest } from './common.js';
import { resolveUserDecisionAdapter } from './ai-connection-http.js';
import { identificationDigest, unidentifiedFields, validateIdentificationFields, identifyWithinDeadline, identificationCandidates, IDENTIFICATION_MAX_CHARACTERS } from './article-identification.js';

const selection = z.object({ article_version_id: z.string().uuid(), draft_id: z.string().uuid().optional() }).strict();
const identifyBody = selection.extend({ content_digest: z.string().regex(/^[a-f0-9]{64}$/), connection_revision: z.string().min(1).max(160) }).strict();
const unconfiguredMessage = 'AI 识别暂未配置，可先手动填写。';
type Decision = Awaited<ReturnType<typeof resolveUserDecisionAdapter>>;
const hostRevisions = new WeakMap<object, { identify: unknown; revision: string }>();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function failure(status: number, code: string, publicMessage: string) { return Object.assign(new Error(code), { status, code, publicMessage }); }

function authorizedScope(core: ModuleHttpCore, req: Request) {
  const ctx = { ...core.context(req) };
  if (!ctx.enterpriseProjectId || !ctx.businessOwnerId || !ctx.accountUserId || !ctx.actorUserId) throw failure(403, 'forbidden', '需要已授权企业项目');
  return { ownerId: ctx.businessOwnerId, enterpriseProjectId: ctx.enterpriseProjectId, scopeKey: hash([ctx.accountUserId, ctx.actorUserId, ctx.businessActorId, ctx.businessOwnerId, ctx.enterpriseProjectId]), tenantId: 'publish-' + digest({ project: ctx.enterpriseProjectId, owner: ctx.businessOwnerId }) };
}

function connectionOf(core: ModuleHttpCore, decision: Decision): IdentificationContext['connection'] {
  let revision: string;
  if (decision.mode === 'user') revision = 'user:' + decision.connection!.revision;
  else if (decision.mode === 'environment') {
    // A keyed fingerprint notices credential rotation without publishing a key
    // or an unkeyed hash of it. It is stable across equivalent server workers.
    const env = core.environment;
    revision = 'environment:' + createHmac('sha256', env.FRONTMIND_SOURCE_MATRIX_LLM_API_KEY || 'unconfigured').update(JSON.stringify([env.FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL || '', env.FRONTMIND_SOURCE_MATRIX_LLM_MODEL || '', env.FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS || '', 'identify-v1'])).digest('hex');
  } else if (decision.mode === 'host' && decision.adapter) {
    if (decision.adapter.identificationRevision) revision = 'host:' + hash(decision.adapter.identificationRevision);
    else {
      let entry = hostRevisions.get(decision.adapter);
      if (!entry || entry.identify !== decision.adapter.identify) { entry = { identify: decision.adapter.identify, revision: randomUUID() }; hostRevisions.set(decision.adapter, entry); }
      revision = 'host:' + entry.revision;
    }
  } else revision = 'none:identify-v1';
  return { mode: decision.mode, available: typeof decision.adapter?.identify === 'function', revision };
}

function contextOf(scopeKey: string, article: IdentificationArticle, connection: IdentificationContext['connection']): IdentificationContext {
  return { scopeKey, articleId: article.articleId, articleVersionId: article.articleVersionId, versionNumber: article.versionNumber, title: article.title, contentDigest: identificationDigest(article), connection };
}

function modelFailure(error: unknown): Error {
  const messages: Record<string, [number, string]> = {
    provider_timeout: [503, 'AI 识别超时，请稍后重试；已填写内容会保留。'],
    provider_credential_invalid: [503, 'AI 连接认证失败，请联系管理员或检查当前模型连接。'],
    provider_permission_denied: [503, '当前 AI 连接没有使用该模型的权限。'],
    provider_quota_exhausted: [503, 'AI 服务额度暂不可用，可先手动填写。'],
    provider_rate_limited: [429, 'AI 请求过于频繁，请稍后重试。'],
    provider_model_unavailable: [503, '配置的 AI 模型暂不可用，请检查模型连接。'],
    provider_parameters_invalid: [503, 'AI 服务不支持当前识别协议，请检查模型连接。'],
    provider_refused: [422, '模型未能处理这篇稿件，可手动填写或稍后重试。'],
    provider_response_too_large: [422, 'AI 返回内容超出限制，未采用该结果，请重试。'],
    provider_incomplete_response: [422, 'AI 未完成本次识别，未采用不完整结果，请重试。'],
    provider_invalid_response: [422, 'AI 返回格式无效，未采用该结果，请重试。'],
    provider_empty_response: [422, 'AI 未返回识别内容，请重试或手动填写。'],
  };
  const code = error instanceof Error && Object.hasOwn(messages, error.message) ? error.message : 'identification_unavailable';
  const [status, message]: [number, string] = messages[code] || [503, 'AI 识别暂不可用，请稍后重试；已填写内容会保留。'];
  return failure(status, code, message);
}

/** Mounted after the existing matrix same-origin/no-store middleware. No writes. */
export function mountArticleIdentificationRoutes(router: Router, core: ModuleHttpCore): void {
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
  async function load(req: Request, input: z.infer<typeof selection>) {
    const scope = authorizedScope(core, req);
    const db = await core.database();
    const store = new BindingStore(db, scope);
    const loaded = await store.loadIdentificationArticle({ articleVersionId: input.article_version_id, draftId: input.draft_id });
    if (!loaded.article) throw failure(loaded.failure === 'draft_version_mismatch' ? 409 : 404, 'binding_not_found', '当前稿件或版本不可用，请重新选择已授权稿件。');
    const catalog = await loadIndustryCatalog(core, req);
    const industries = catalog.status === 'ok' ? catalog.data.industries : [];
    const decision = await resolveUserDecisionAdapter(core, req);
    if (authorizedScope(core, req).scopeKey !== scope.scopeKey) throw failure(409, 'scope_changed', '当前工作区或身份已变化，请重新读取稿件。');
    return { scope, store, article: loaded.article, industries, catalog, decision, context: { ...contextOf(scope.scopeKey, loaded.article, connectionOf(core, decision)), catalogVersion: catalog.status === 'ok' ? catalog.data.catalogVersion : null } };
  }

  router.get('/matrix/identify/context', wrap(async (req, res) => {
    const parsed = selection.safeParse(req.query);
    if (!parsed.success) throw failure(400, 'invalid_input', '请选择有效稿件及明确版本。');
    const current = await load(req, parsed.data);
    // The actual schema has no trusted brand, industry, audience or questions
    // metadata. Do not infer it from working names, summaries or demo records.
    const body: IdentificationContextResponse = { status: current.context.connection.available ? 'ready' : 'not_configured', context: current.context, fields: unidentifiedFields(), ...(!current.context.connection.available ? { message: unconfiguredMessage } : {}) };
    if (current.catalog.status !== 'ok') body.fields.industry.reason = 'catalog_unavailable';
    res.json(body);
  }));

  router.post('/matrix/identify', wrap(async (req, res) => {
    const parsed = identifyBody.safeParse(req.body);
    if (!parsed.success) throw failure(400, 'invalid_input', '识别请求无效，请重新读取当前稿件。');
    const body = parsed.data;
    const current = await load(req, body);
    if (body.content_digest !== current.context.contentDigest) throw failure(409, 'stale_content', '稿件内容或标题已变化，请重新读取当前版本。');
    if (body.connection_revision !== current.context.connection.revision) throw failure(409, 'connection_changed', 'AI 连接已变化，请重新读取后识别。');
    if (!current.context.connection.available || !current.decision.adapter?.identify) throw failure(503, 'not_configured', unconfiguredMessage);
    if (!current.article.body.trim()) throw failure(422, 'empty_article', '当前冻结版本正文为空，请先确认稿件内容。');
    if (current.article.body.length > IDENTIFICATION_MAX_CHARACTERS || current.article.title.length > 2000) throw failure(413, 'article_too_large', '稿件超出本次全文识别的 60,000 字符限制，尚未分析；请手动填写。');
    let fields: IdentificationFields;
    try {
      const output = await identifyWithinDeadline(input => current.decision.adapter!.identify!(input), { article: { title: current.article.title, body: current.article.body }, ...identificationCandidates(current.article, current.industries) });
      const encoded = JSON.stringify(output);
      if (!encoded || Buffer.byteLength(encoded, 'utf8') > 131_072) throw new Error('provider_response_too_large');
      fields = validateIdentificationFields(output, current.article, current.industries);
      if (current.catalog.status !== 'ok') fields.industry = { value: null, source: 'unidentified', reason: 'catalog_unavailable', ...(fields.industry.candidate ? { candidate: fields.industry.candidate } : {}) };
    } catch (error) { throw modelFailure(error); }
    // Reauthorize after the potentially long model call. A removed draft,
    // version, permission, industry or connection invalidates the late result.
    if (authorizedScope(core, req).scopeKey !== current.scope.scopeKey) throw failure(409, 'scope_changed', '当前工作区或身份已变化，请重新读取稿件。');
    const latest = await current.store.loadIdentificationArticle({ articleVersionId: body.article_version_id, draftId: body.draft_id });
    if (!latest.article || latest.article.articleId !== current.article.articleId || latest.article.articleVersionId !== current.article.articleVersionId || latest.article.versionNumber !== current.article.versionNumber || identificationDigest(latest.article) !== current.context.contentDigest || latest.article.contentHash !== current.article.contentHash) throw failure(409, 'stale_content', '稿件或版本权限已变化，本次结果未采用，请重新读取。');
    const nextDecision = await resolveUserDecisionAdapter(core, req);
    if (connectionOf(core, nextDecision).revision !== current.context.connection.revision || !nextDecision.adapter?.identify) throw failure(409, 'connection_changed', 'AI 连接已变化，本次结果未采用，请重新识别。');
    if (fields.industry.value) {
      const latestCatalog = await loadIndustryCatalog(core, req);
      if (latestCatalog.status !== 'ok' || !latestCatalog.data.industries.some(item => item.id === fields.industry.value && current.industries.some(original => original.id === item.id && original.name === item.name))) fields.industry = { value: null, source: 'unidentified', reason: latestCatalog.status === 'ok' ? 'catalog_changed' : 'catalog_unavailable' };
    }
    if (authorizedScope(core, req).scopeKey !== current.scope.scopeKey) throw failure(409, 'scope_changed', '当前工作区或身份已变化，请重新读取稿件。');
    const count = Object.values(fields).filter(field => field.value !== null).length;
    const response: IdentifyArticleResponse = { status: count === 4 ? 'complete' : count ? 'partial' : 'unidentified', context: current.context, fields };
    res.json(response);
  }));
}
