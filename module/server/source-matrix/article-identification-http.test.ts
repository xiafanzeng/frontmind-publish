// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createModuleHttpApi, type ModuleHttpCore } from '../http-api.js';
import { BindingStore } from './binding.js';
import { MatrixRepository } from './repository.js';
import { invokeAi } from './ai-connection-provider.js';

vi.mock('./ai-connection-provider.js', async () => {
  const actual = await vi.importActual<typeof import('./ai-connection-provider.js')>('./ai-connection-provider.js');
  return { ...actual, invokeAi: vi.fn() };
});
const servers: Server[] = [];
beforeEach(() => { vi.mocked(invokeAi).mockReset().mockResolvedValue({ fields: {} }); });
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });
const versionId = '5aab2222-2222-4222-8222-222222222222';
const identity = { accountUserId: 1, actorUserId: 1, enterpriseProjectId: 'p', businessOwnerId: 'owner', businessActorId: 'actor' };
const article = { articleVersionId: versionId, articleId: 'article-1', versionNumber: 2, title: '星河软件', body: '星河软件服务零售企业。', contentHash: 'frozen-hash' };
const platform = { FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'fixture-platform-key', FRONTMIND_SOURCE_MATRIX_LLM_MODEL: 'configured-model', FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: 'https://api.xty.app/v1', FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: 'https://api.xty.app/v1' };
async function host(overrides: Partial<ModuleHttpCore> = {}) {
  const core: ModuleHttpCore = { context: () => identity, database: async () => ({} as any), environment: { ...platform }, ...overrides };
  const app = express(); app.use('/api/modules/publish', createModuleHttpApi(core));
  const server = createServer(app); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test address');
  return 'http://127.0.0.1:' + address.port;
}
function reads() {
  const load = vi.spyOn(BindingStore.prototype, 'loadIdentificationArticle').mockResolvedValue({ article });
  vi.spyOn(MatrixRepository.prototype, 'industries').mockResolvedValue([{ id: 'retail', name: '零售' }]);
  return load;
}
async function contextAt(url: string) {
  const response = await fetch(url + '/api/modules/publish/matrix/identify/context?article_version_id=' + versionId);
  return { response, body: await response.json() };
}
async function identifyAt(url: string, context: any, extra: Record<string, unknown> = {}) {
  return fetch(url + '/api/modules/publish/matrix/identify', { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify({ article_version_id: versionId, content_digest: context.contentDigest, connection_revision: context.connection.revision, ...extra }) });
}

it('reports missing platform settings without selecting an injected host identify adapter', async () => {
  reads(); const identify = vi.fn();
  const url = await host({ environment: {}, sourceMatrixDecisions: { matrix: vi.fn(), budget: vi.fn(), identify } });
  const { response, body } = await contextAt(url);
  expect(response.status).toBe(200);
  expect(body).toMatchObject({ status: 'not_configured', context: { articleId: 'article-1', articleVersionId: versionId, connection: { available: false, mode: 'none' } } });
  expect(body.message).toBe('AI 识别暂未配置，可先手动填写。');
  expect(JSON.stringify(body)).not.toContain(article.body); expect(identify).not.toHaveBeenCalled();
});

it('requires the matching server allowlist for platform identification', async () => {
  reads(); const url = await host({ environment: { ...platform, FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: 'https://other.invalid/v1' } });
  const { body } = await contextAt(url);
  expect(body.context.connection).toMatchObject({ mode: 'none', available: false });
  expect((await identifyAt(url, body.context)).status).toBe(503); expect(invokeAi).not.toHaveBeenCalled();
});

it('analyzes only the authorized full frozen version with platform settings and no task writes', async () => {
  reads(); const create = vi.spyOn(MatrixRepository.prototype, 'create'), injected = vi.fn();
  vi.mocked(invokeAi).mockResolvedValueOnce({ fields: { product: { value: '星河软件', source: 'article', evidence: article.body }, industry: { value: 'retail', source: 'inferred' } } });
  const url = await host({ sourceMatrixDecisions: { matrix: vi.fn(), budget: vi.fn(), identify: injected } });
  const { body } = await contextAt(url), response = await identifyAt(url, body.context);
  expect(body.context.connection).toMatchObject({ mode: 'environment', available: true });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({ status: 'partial', fields: { product: { value: '星河软件', source: 'article' }, industry: { value: 'retail', source: 'inferred' }, audience: { value: null, source: 'unidentified' } } });
  const call = vi.mocked(invokeAi).mock.calls[0]!;
  expect(call[0]).toMatchObject({ provider: 'glm', model: 'configured-model', baseUrl: 'https://api.xty.app/v1/chat/completions' });
  expect(JSON.parse(call[2][1]!.content)).toEqual({ article: { title: article.title, body: article.body }, industries: [{ id: 'retail', name: '零售' }] });
  expect(call[4]).toMatchObject({ identification: true });
  expect(create).not.toHaveBeenCalled(); expect(injected).not.toHaveBeenCalled();
  expect(JSON.stringify(body)).not.toContain(platform.FRONTMIND_SOURCE_MATRIX_LLM_API_KEY);
});

it('fails closed for wrong owner/version, changed content and changed platform revision', async () => {
  const load = reads(), url = await host(), { body } = await contextAt(url);
  load.mockResolvedValueOnce({ failure: 'version_not_found' });
  expect((await identifyAt(url, body.context)).status).toBe(404);
  load.mockResolvedValueOnce({ article: { ...article, body: '已变化的正文' } });
  expect((await identifyAt(url, body.context)).status).toBe(409);
  expect((await identifyAt(url, body.context, { connection_revision: 'changed' })).status).toBe(409);
  expect(invokeAi).not.toHaveBeenCalled();
});

it('discards a late result when frozen article permissions disappear', async () => {
  const load = reads();
  vi.mocked(invokeAi).mockImplementationOnce(async () => { load.mockResolvedValueOnce({ failure: 'version_not_found' }); return { fields: { product: { value: '星河软件', source: 'inferred' } } }; });
  const url = await host(), { body } = await contextAt(url), response = await identifyAt(url, body.context);
  expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain('星河软件');
});

it('rejects arbitrary endpoints, manuscript text and tenant keys before storage access', async () => {
  let accessed = false; const url = await host({ database: async () => { accessed = true; throw new Error('must not query'); } });
  const response = await identifyAt(url, { contentDigest: 'a'.repeat(64), connection: { revision: 'connection' } }, { body: 'untrusted', base_url: 'https://other.invalid', tenant_id: 'other' });
  expect(response.status).toBe(400); expect(accessed).toBe(false);
  const crossOrigin = await fetch(url + '/api/modules/publish/matrix/identify', { method: 'POST', headers: { Origin: 'https://other.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  expect(crossOrigin.status).toBe(403); expect(accessed).toBe(false);
});

it('rejects empty and oversized full text before invocation rather than silently truncating', async () => {
  const load = reads(), url = await host();
  for (const body of ['', 'x'.repeat(60_001)]) {
    load.mockResolvedValue({ article: { ...article, body } });
    const state = await contextAt(url); expect([413, 422]).toContain((await identifyAt(url, state.body.context)).status);
  }
  expect(invokeAi).not.toHaveBeenCalled();
});

it('sanitizes unexpected provider errors and keeps incomplete or refused output unusable', async () => {
  reads(); const url = await host(), { body } = await contextAt(url);
  for (const code of ['secret-key private article upstream', 'provider_timeout', 'provider_refused', 'provider_invalid_response', 'provider_incomplete_response']) {
    vi.mocked(invokeAi).mockRejectedValueOnce(new Error(code));
    const response = await identifyAt(url, body.context);
    expect([422, 503]).toContain(response.status); expect(JSON.stringify(await response.json())).not.toMatch(/secret-key|private article|upstream/);
  }
});

it('rejects an in-flight response after the authenticated workspace changes', async () => {
  reads(); let currentIdentity = { ...identity };
  vi.mocked(invokeAi).mockImplementationOnce(async () => { currentIdentity = { ...identity, enterpriseProjectId: 'other-project' }; return { fields: {} }; });
  const url = await host({ context: () => currentIdentity }), { body } = await contextAt(url), response = await identifyAt(url, body.context);
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ status: 'scope_changed' });
});

it('drops an industry removed during identification while preserving other valid fields', async () => {
  reads();
  vi.mocked(invokeAi).mockImplementationOnce(async () => { vi.mocked(MatrixRepository.prototype.industries).mockResolvedValue([]); return { fields: { product: { value: '星河软件', source: 'inferred' }, industry: { value: 'retail', source: 'inferred' } } }; });
  const url = await host(), { body } = await contextAt(url), response = await identifyAt(url, body.context);
  expect(await response.json()).toMatchObject({ status: 'partial', fields: { product: { value: '星河软件' }, industry: { value: null, source: 'unidentified' } } });
});

it('notices platform key, endpoint model and allowlist rotation through the HMAC revision', async () => {
  reads(); const environment = { ...platform };
  const url = await host({ environment }), before = (await contextAt(url)).body.context;
  environment.FRONTMIND_SOURCE_MATRIX_LLM_MODEL = 'changed-model';
  const after = (await contextAt(url)).body.context;
  expect(after.connection.revision).not.toBe(before.connection.revision);
  expect(JSON.stringify(after)).not.toContain(platform.FRONTMIND_SOURCE_MATRIX_LLM_API_KEY);
  vi.mocked(invokeAi).mockImplementationOnce(async () => { environment.FRONTMIND_SOURCE_MATRIX_LLM_API_KEY = 'rotated-fixture-key'; return { fields: {} }; });
  const response = await identifyAt(url, after);
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ status: 'connection_changed' });
});
