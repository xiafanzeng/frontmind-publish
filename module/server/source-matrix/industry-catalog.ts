import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { ModuleHttpCore } from '../http-api.js';
import type { IndustryFilters, IndustryResponse } from '../../contracts/industry-source.js';
import { flattenIndustryCatalog, type CanonicalIndustry } from '../../shared/industry-catalog.js';
import { IndustrySourceProvider, industryFailure } from './industry-provider.js';

// Both routers and identification reuse this provider, including its pending reads,
// token fingerprint, actor/project boundary and expiry. No billed endpoint here.
const providers = new WeakMap<ModuleHttpCore, IndustrySourceProvider>();
export function industryProviderFor(core: ModuleHttpCore): IndustrySourceProvider {
  let provider = providers.get(core);
  if (!provider) { provider = new IndustrySourceProvider(); providers.set(core, provider); }
  return provider;
}
export function industryAccess(core: ModuleHttpCore, request: Request): { identity: string; token: string } | ReturnType<typeof industryFailure> {
  const origin = request.get('Origin');
  if (request.get('Sec-Fetch-Site') === 'cross-site') return industryFailure('forbidden', 403, '请从当前站点查询行业信源。');
  if (origin) { try { if (new URL(origin).host !== request.get('Host')) return industryFailure('forbidden', 403, '请从当前站点查询行业信源。'); } catch { return industryFailure('forbidden', 403, '请从当前站点查询行业信源。'); } }
  let context: ReturnType<ModuleHttpCore['context']>;
  try { context = core.context(request); } catch { return industryFailure('unauthorized', 401, '请重新登录后查看行业信源。'); }
  if (!Number.isSafeInteger(context.accountUserId) || context.accountUserId <= 0 || !Number.isSafeInteger(context.actorUserId) || context.actorUserId <= 0 || !context.enterpriseProjectId || !context.businessOwnerId) return industryFailure('forbidden', 403, '需要已授权企业项目才能查看行业信源。');
  const token = core.environment.FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN?.trim();
  if (!token || token.length > 8192 || /\s/.test(token)) return industryFailure('configuration_required', 503, '行业信源服务尚未配置，请联系管理员。');
  const identity = createHash('sha256').update(JSON.stringify({ account: context.accountUserId, actor: context.actorUserId, owner: context.businessOwnerId, project: context.enterpriseProjectId, businessActor: context.businessActorId })).digest('hex');
  return { identity, token };
}
export interface CanonicalCatalog { industries: CanonicalIndustry[]; filters: IndustryFilters; catalogVersion: string }
export async function loadIndustryCatalog(core: ModuleHttpCore, request: Request): Promise<IndustryResponse<CanonicalCatalog>> {
  const access = industryAccess(core, request);
  if ('status' in access) return access;
  const response = await industryProviderFor(core).query('filters', new URLSearchParams(), access.identity, access.token);
  if (response.status !== 'ok') return response;
  try {
    const filters = response.data as IndustryFilters, industries = flattenIndustryCatalog(filters.industryTree);
    const catalogVersion = createHash('sha256').update(JSON.stringify(industries.map(({ id, name, path }) => ({ id, name, path })))).digest('hex');
    return { ...response, data: { filters, industries, catalogVersion } };
  } catch { return industryFailure('invalid_response', 502, '行业目录含重复或无效分类，暂无法使用。'); }
}
