// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { ModuleHttpCore } from '../http-api.js';
import { createAiConnectionRouter, resolvePlatformDecisionAdapter, resolveUserDecisionAdapter } from './ai-connection-http.js';

const servers: Server[] = [];
const context = { accountUserId: 1, actorUserId: 2, enterpriseProjectId: 'project-A', businessOwnerId: 'owner-A', businessActorId: 'actor-A' };
const platform = { FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'fixture-platform-key', FRONTMIND_SOURCE_MATRIX_LLM_MODEL: 'configured-model', FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: 'https://api.xty.app/v1', FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: 'https://api.xty.app/v1' };
function fixture(environment: Record<string, string | undefined> = platform) {
  const database = vi.fn(async () => { throw new Error('Personal connection storage must not be read'); });
  const injected = { matrix: vi.fn(), budget: vi.fn(), identify: vi.fn() };
  const core: ModuleHttpCore = { context: () => context, environment: { ...environment }, database, sourceMatrixDecisions: injected };
  return { core, database, injected };
}
async function host(core: ModuleHttpCore) {
  const app = express(); app.use('/api/modules/publish', createAiConnectionRouter(core));
  const server = createServer(app); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  return 'http://127.0.0.1:' + address.port + '/api/modules/publish/matrix/connection';
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });

it('ignores injected host adapters and legacy personal revisions without consulting storage', async () => {
  const f = fixture(), req = {} as any;
  const result = await resolvePlatformDecisionAdapter(f.core, req);
  expect(result.mode).toBe('environment'); expect(result.adapter?.identify).toBeTypeOf('function');
  expect(result.adapter).not.toBe(f.injected); expect(result).not.toHaveProperty('connection');
  expect((await resolveUserDecisionAdapter(f.core, req, 'legacy-personal-revision')).mode).toBe('environment');
  expect(f.database).not.toHaveBeenCalled(); expect(f.injected.identify).not.toHaveBeenCalled();
});

it('returns only safe platform status, with no saved connection or configuration details', async () => {
  const f = fixture(), url = await host(f.core), response = await fetch(url), body = await response.json();
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(body).toEqual({ connection: null, mode: 'environment', available: true, message: '当前使用平台配置的模型' });
  expect(JSON.stringify(body)).not.toMatch(/fixture-platform-key|configured-model|api\.xty/);
  expect(f.database).not.toHaveBeenCalled();
});

it('does not fall back to personal or host models when platform configuration is missing', async () => {
  const f = fixture({ FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'fixture-platform-key' });
  const result = await resolvePlatformDecisionAdapter(f.core, {} as any);
  expect(result).toEqual({ mode: 'none', adapter: undefined });
  const response = await fetch(await host(f.core));
  expect(await response.json()).toMatchObject({ connection: null, mode: 'none', available: false, message: expect.stringContaining('暂不可用') });
  expect(f.database).not.toHaveBeenCalled();
});

it('keeps status authorization and removes all four personal management endpoints', async () => {
  const f = fixture(), url = await host(f.core);
  for (const action of ['models', 'test', 'save', 'remove']) {
    expect((await fetch(url + '/' + action, { method: 'POST', headers: { Origin: new URL(url).origin, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404);
  }
  f.core.context = () => ({ ...context, actorUserId: undefined }) as any;
  expect((await fetch(url)).status).toBe(403);
  expect(f.database).not.toHaveBeenCalled();
});
