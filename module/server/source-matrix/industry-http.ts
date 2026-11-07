import { Router, type Request, type Response } from 'express';
import type { ModuleHttpCore } from '../http-api.js';
import { INDUSTRY_ENDPOINTS, IndustryQueryError, validateIndustryQuery } from './industry-query.js';
import { industryFailure } from './industry-provider.js';
import { industryAccess, industryProviderFor } from './industry-catalog.js';

/** These read operations may consume supplier quota, so cross-site browser requests are refused. */
function sameSite(request: Request): boolean {
  if (request.get('Sec-Fetch-Site') === 'cross-site') return false;
  const origin = request.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).host === request.get('Host'); } catch { return false; }
}

export function createIndustrySourceRouter(core: ModuleHttpCore, provider = industryProviderFor(core)): Router {
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
        const access = industryAccess(core, request);
        if ('status' in access) { response.status(access.httpStatus).json(access); return; }
        const query = new URLSearchParams(request.originalUrl.split('?').slice(1).join('?'));
        try { validateIndustryQuery(endpoint, query); } catch (error) {
          response.status(400).json(industryFailure('invalid_input', 400, error instanceof IndustryQueryError ? error.message : '查询参数不正确，请重新选择筛选条件。'));
          return;
        }
        const result = await provider.query(endpoint, query, access.identity, access.token);
        if (!response.destroyed && !response.writableEnded) response.status(result.status === 'ok' ? 200 : result.httpStatus).json(result);
      })().catch(() => {
        if (!response.destroyed && !response.writableEnded) response.status(502).json(industryFailure('upstream_error', 502, '行业信源服务暂时不可用，请稍后重试当前查询。', true));
      });
    });
  }
  return router;
}
