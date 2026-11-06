import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { ModuleHttpCore } from '../http-api.js';
import { INDUSTRY_ENDPOINTS, IndustryQueryError, validateIndustryQuery } from './industry-query.js';
import { industryFailure, IndustrySourceProvider } from './industry-provider.js';

/** These read operations may consume supplier quota, so cross-site browser requests are refused. */
function sameSite(request: Request): boolean {
  if (request.get('Sec-Fetch-Site') === 'cross-site') return false;
  const origin = request.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).host === request.get('Host'); } catch { return false; }
}

export function createIndustrySourceRouter(core: ModuleHttpCore, provider = new IndustrySourceProvider()): Router {
  const router = Router();
  router.use((request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      response.status(405).json(industryFailure('invalid_input', 405, '此接口仅接受查询请求。'));
      return;
    }
    if (!sameSite(request)) {
      response.status(403).json(industryFailure('forbidden', 403, '请从当前站点查询行业信源。'));
      return;
    }
    next();
  });
  for (const endpoint of INDUSTRY_ENDPOINTS) {
    router.get(`/${endpoint}`, (request: Request, response: Response) => {
      void (async () => {
        let context: ReturnType<ModuleHttpCore['context']>;
        try { context = core.context(request); } catch {
          response.status(401).json(industryFailure('unauthorized', 401, '请重新登录后查看行业信源。'));
          return;
        }
        if (!Number.isSafeInteger(context.accountUserId) || context.accountUserId <= 0 || !Number.isSafeInteger(context.actorUserId) || context.actorUserId <= 0 || !context.enterpriseProjectId || !context.businessOwnerId) {
          response.status(403).json(industryFailure('forbidden', 403, '需要已授权企业项目才能查看行业信源。'));
          return;
        }
        const token = core.environment.FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN?.trim();
        if (!token || token.length > 8192 || /\s/.test(token)) {
          response.status(503).json(industryFailure('configuration_required', 503, '行业信源服务尚未配置，请联系管理员。'));
          return;
        }
        const query = new URLSearchParams(request.originalUrl.split('?').slice(1).join('?'));
        try { validateIndustryQuery(endpoint, query); } catch (error) {
          response.status(400).json(industryFailure('invalid_input', 400, error instanceof IndustryQueryError ? error.message : '查询参数不正确，请重新选择筛选条件。'));
          return;
        }
        const identity = createHash('sha256').update(JSON.stringify({ account: context.accountUserId, actor: context.actorUserId, owner: context.businessOwnerId, project: context.enterpriseProjectId, businessActor: context.businessActorId })).digest('hex');
        const result = await provider.query(endpoint, query, identity, token);
        if (!response.destroyed && !response.writableEnded) response.status(result.status === 'ok' ? 200 : result.httpStatus).json(result);
      })().catch(() => {
        if (!response.destroyed && !response.writableEnded) response.status(502).json(industryFailure('upstream_error', 502, '行业信源服务暂时不可用，请稍后重试当前查询。', true));
      });
    });
  }
  return router;
}
