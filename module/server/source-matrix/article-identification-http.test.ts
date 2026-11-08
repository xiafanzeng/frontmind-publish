import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { createModuleHttpApi, type ModuleHttpCore } from '../http-api.js';
import { BindingStore } from './binding.js';
import * as canonicalCatalog from './industry-catalog.js';
import { MatrixRepository } from './repository.js';
import type { ArticleIdentificationInput } from './adapter.js';

const servers: Server[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });
const versionId = '5aab2222-2222-4222-8222-222222222222';
const identity = { accountUserId: 1, actorUserId: 1, enterpriseProjectId: 'p', businessOwnerId: 'owner', businessActorId: 'actor' };
const article = { articleVersionId: versionId, articleId: 'article-1', versionNumber: 2, title: '星河软件', body: '星河软件服务零售企业。', contentHash: 'frozen-hash' };
async function host(overrides: Partial<ModuleHttpCore> = {}) {
  const core: ModuleHttpCore = { context: () => identity, database: async () => ({} as any), environment: {}, sourceMatrixDecisions: { matrix: async () => undefined, budget: async () => undefined }, ...overrides };
  const app = express(); app.use('/api/modules/publish', createModuleHttpApi(core));
  const server = createServer(app); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test address');
  return `http://127.0.0.1:${address.port}`;
}
function reads() {
  const load = vi.spyOn(BindingStore.prototype, 'loadIdentificationArticle').mockResolvedValue({ article });
  vi.spyOn(canonicalCatalog, 'loadIndustryCatalog').mockResolvedValue({ status: 'ok', source: 'molizhishu-public-industry', fetchedAt: '2026-11-07T00:00:00Z', data: { catalogVersion: 'catalog-1', industries: [{ id: 'retail', scopeId: 'retail', name: '零售', label: '零售', path: ['零售'], depth: 0 }], filters: { models: [], industryTree: [], minDate: null, maxDate: null, sourceTypes: [] } } });
  return load;
}
async function contextAt(url: string) {
  const response = await fetch(url + '/api/modules/publish/matrix/identify/context?article_version_id=' + versionId);
  return { response, body: await response.json() };
}
async function identifyAt(url: string, context: any, extra: Record<string, unknown> = {}) {
  return fetch(url + '/api/modules/publish/matrix/identify', { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify({ article_version_id: versionId, content_digest: context.contentDigest, connection_revision: context.connection.revision, ...extra }) });
}

it('reports an existing host without identify as not configured and does not fall through', async () => {
  reads(); const url = await host({ environment: { FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'test-only' } });
  const { response, body } = await contextAt(url);
  expect(response.status).toBe(200);
  expect(body).toMatchObject({ status: 'not_configured', context: { articleId: 'article-1', articleVersionId: versionId, connection: { available: false, mode: 'host' } } });
  expect(body.message).toBe('AI 识别暂未配置，可先手动填写。');
  expect(JSON.stringify(body)).not.toContain(article.body);
  expect(JSON.stringify(body)).not.toContain('test-only');
});

it('analyzes the authorized full version without a planner task or draft mutation', async () => {
  reads();
  const create = vi.spyOn(MatrixRepository.prototype, 'create');
  const identify = vi.fn(async (_input: ArticleIdentificationInput) => ({ fields: { product: { value: '星河软件', source: 'article', evidence: '星河软件服务零售企业。' }, industry: { value: 'retail', source: 'inferred' } } }));
  const url = await host({ sourceMatrixDecisions: { matrix: async () => undefined, budget: async () => undefined, identify } });
  const { body } = await contextAt(url);
  const response = await identifyAt(url, body.context);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({ status: 'partial', fields: { product: { value: '星河软件', source: 'article' }, industry: { value: 'retail', source: 'inferred' }, audience: { value: null, source: 'unidentified' } } });
  expect(identify.mock.calls[0]?.[0]).toMatchObject({ article: { title: article.title, body: article.body }, industries: [{ id: 'retail', name: '零售' }] });
  expect(create).not.toHaveBeenCalled();
});

it('fails closed for wrong owner/version, changed content and changed connection', async () => {
  const load = reads(); const identify = vi.fn(async () => ({ fields: {} }));
  const adapter = { matrix: async () => undefined, budget: async () => undefined, identify };
  const url = await host({ sourceMatrixDecisions: adapter }); const { body } = await contextAt(url);
  load.mockResolvedValueOnce({ failure: 'version_not_found' });
  expect((await identifyAt(url, body.context)).status).toBe(404);
  load.mockResolvedValueOnce({ article: { ...article, body: '已变化的正文' } });
  expect((await identifyAt(url, body.context)).status).toBe(409);
  expect((await identifyAt(url, body.context, { connection_revision: 'changed' })).status).toBe(409);
  expect(identify).not.toHaveBeenCalled();
});

it('discards results when permissions or content change during the model request', async () => {
  const load = reads();
  const identify = async () => { load.mockResolvedValueOnce({ failure: 'version_not_found' }); return { fields: { product: { value: '星河软件', source: 'inferred' } } }; };
  const url = await host({ sourceMatrixDecisions: { matrix: async () => undefined, budget: async () => undefined, identify } });
  const { body } = await contextAt(url); const response = await identifyAt(url, body.context);
  expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain('星河软件');
});

it('rejects arbitrary endpoints, text and tenant keys before model or database access', async () => {
  let accessed = false; const url = await host({ database: async () => { accessed = true; throw new Error('must not query'); } });
  const response = await identifyAt(url, { contentDigest: 'a'.repeat(64), connection: { revision: 'connection' } }, { body: 'untrusted', base_url: 'https://other.invalid', tenant_id: 'other' });
  expect(response.status).toBe(400); expect(accessed).toBe(false);
  const crossOrigin = await fetch(url + '/api/modules/publish/matrix/identify', { method: 'POST', headers: { Origin: 'https://other.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  expect(crossOrigin.status).toBe(403); expect(accessed).toBe(false);
});

it('rejects empty or oversized text before model invocation without silently truncating', async () => {
  const load = reads(); const identify = vi.fn(async () => ({ fields: {} }));
  const url = await host({ sourceMatrixDecisions: { matrix: async () => undefined, budget: async () => undefined, identify } });
  for (const body of ['', 'x'.repeat(60_001)]) {
    load.mockResolvedValue({ article: { ...article, body } });
    const state = await contextAt(url); const response = await identifyAt(url, state.body.context);
    expect([413, 422]).toContain(response.status);
  }
  expect(identify).not.toHaveBeenCalled();
});

it('sanitizes unexpected host errors and never returns raw provider text', async () => {
  reads(); const url = await host({ sourceMatrixDecisions: { matrix: async () => undefined, budget: async () => undefined, identify: async () => { throw new Error('secret-key private article upstream'); } } });
  const { body } = await contextAt(url); const response = await identifyAt(url, body.context);
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toMatch(/secret-key|private article|upstream/);
});

it('rejects an in-flight response after the authenticated workspace changes', async () => {
  reads(); let currentIdentity = { ...identity };
  const url = await host({ context: () => currentIdentity, sourceMatrixDecisions: { matrix: async () => undefined, budget: async () => undefined, identify: async () => { currentIdentity = { ...identity, enterpriseProjectId: 'other-project' }; return { fields: {} }; } } });
  const { body } = await contextAt(url); const response = await identifyAt(url, body.context);
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ status: 'scope_changed' });
});

it('drops an industry removed during identification but preserves other valid fields', async () => {
  reads();
  const url = await host({ sourceMatrixDecisions: { matrix: async () => undefined, budget: async () => undefined, identify: async () => {
    vi.mocked(canonicalCatalog.loadIndustryCatalog).mockResolvedValue({ status: 'configuration_required', httpStatus: 503, retryable: false, message: '目录暂不可用' });
    return { fields: { product: { value: '星河软件', source: 'inferred' }, industry: { value: 'retail', source: 'inferred' } } };
  } } });
  const { body } = await contextAt(url); const response = await identifyAt(url, body.context);
  expect(await response.json()).toMatchObject({ status: 'partial', fields: { product: { value: '星河软件' }, industry: { value: null, source: 'unidentified' } } });
});

it('rechecks host model configuration revision before returning output', async () => {
  reads();
  const adapter = { identificationRevision: 'model-before', matrix: async () => undefined, budget: async () => undefined, identify: async () => { adapter.identificationRevision = 'model-after'; return { fields: {} }; } };
  const url = await host({ sourceMatrixDecisions: adapter }); const { body } = await contextAt(url); const response = await identifyAt(url, body.context);
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ status: 'connection_changed' });
});


it('identifies the other three fields when the industry catalog is unavailable', async () => {
  reads();
  vi.mocked(canonicalCatalog.loadIndustryCatalog).mockResolvedValue({ status: 'configuration_required', httpStatus: 503, retryable: false, message: '目录暂不可用' });
  const identify = vi.fn(async () => ({ fields: { product: { value: '星河软件', source: 'inferred' }, audience: { value: '零售企业', source: 'inferred' }, questions: { value: '如何管理门店', source: 'inferred' }, industry: { value: 'retail', source: 'inferred' } } }));
  const url = await host({ sourceMatrixDecisions: { matrix: async () => undefined, budget: async () => undefined, identify } });
  const { response, body } = await contextAt(url);
  expect(response.status).toBe(200);
  expect(body.fields.industry.reason).toBe('catalog_unavailable');
  const result = await identifyAt(url, body.context);
  expect(await result.json()).toMatchObject({ status: 'partial', fields: { product: { value: '星河软件' }, industry: { value: null, reason: 'catalog_unavailable' }, audience: { value: '零售企业' }, questions: { value: '如何管理门店' } } });
  expect(identify).toHaveBeenCalledOnce();
});

it('provides an opaque research form scope without accessing articles, storage or models',async()=>{
 const database=vi.fn(async()=>{throw new Error('must not read storage');});
 let current={...identity};const url=await host({context:()=>current,database});
 const read=async()=>{const response=await fetch(url+'/api/modules/publish/matrix/form-scope?scopeKey=untrusted');expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');return response.json();};
 const first=await read();expect(first).toEqual({scopeKey:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect(await read()).toEqual(first);
 for(const change of [{accountUserId:2},{actorUserId:2},{businessActorId:'other-actor'},{businessOwnerId:'other-owner'},{enterpriseProjectId:'other-project'}]){
  current={...identity,...change};expect((await read()).scopeKey).not.toBe(first.scopeKey);
 }
 expect(database).not.toHaveBeenCalled();
});
it('refuses research draft identity when the project or authenticated actor is missing',async()=>{
 for(const change of [{enterpriseProjectId:null},{businessOwnerId:null},{accountUserId:null},{actorUserId:null}]){
  const url=await host({context:()=>({...identity,...change}) as any});
  const response=await fetch(url+'/api/modules/publish/matrix/form-scope');expect(response.status).toBe(403);
  expect(await response.json()).not.toHaveProperty('scopeKey');
 }
});
