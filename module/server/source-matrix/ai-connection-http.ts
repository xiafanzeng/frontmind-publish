import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ModuleHttpCore } from '../http-api.js';
import type { SourceMatrixDecisionAdapter } from './adapter.js';
import { createEnvDecisionAdapter } from './decisions.js';

type Mode = 'environment' | 'none';
type PublicFailure = Error & { status: number; code: string; publicMessage: string };
function failure(status: number, code: string, publicMessage: string): PublicFailure {
  return Object.assign(new Error(code), { status, code, publicMessage });
}
function authorize(core: ModuleHttpCore, req: Request): void {
  const ctx = core.context(req);
  if (!ctx.enterpriseProjectId || !ctx.businessOwnerId || !ctx.actorUserId) throw failure(403, 'forbidden', '需要已授权企业项目');
}

/** The platform environment is the only model source. In particular this never
 * queries/decrypts old personal connections or selects a host-injected adapter. */
export async function resolvePlatformDecisionAdapter(core: ModuleHttpCore, req: Request): Promise<{ adapter?: SourceMatrixDecisionAdapter; mode: Mode }> {
  authorize(core, req);
  const adapter = createEnvDecisionAdapter(core.environment);
  return { adapter, mode: adapter ? 'environment' : 'none' };
}

/** Compatibility seam for existing integrations. Personal revisions are obsolete
 * for matrix/budget generation and cannot block or redirect platform requests. */
export async function resolveUserDecisionAdapter(core: ModuleHttpCore, req: Request, _expectedRevision?: string): Promise<Awaited<ReturnType<typeof resolvePlatformDecisionAdapter>>> {
  return resolvePlatformDecisionAdapter(core, req);
}

export function createAiConnectionRouter(core: ModuleHttpCore): Router {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  router.get('/matrix/connection', (req: Request, res: Response, next: NextFunction) => {
    void resolvePlatformDecisionAdapter(core, req).then(decision => {
      res.json({ connection: null, mode: decision.mode, available: !!decision.adapter, message: decision.adapter ? '当前使用平台配置的模型' : '推荐服务暂不可用，请稍后重试或联系运营' });
    }).catch(next);
  });
  // Personal models/test/save/remove routes intentionally no longer exist.
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const known = error as Partial<PublicFailure>;
    if (typeof known.status === 'number' && known.publicMessage && known.code) { res.status(known.status).json({ status: known.code, message: known.publicMessage }); return; }
    res.status(503).json({ status: 'unavailable', message: '推荐服务暂不可用，请稍后重试或联系运营' });
  });
  return router;
}
