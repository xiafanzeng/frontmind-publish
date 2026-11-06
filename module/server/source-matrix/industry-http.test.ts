import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { ModuleHttpCore } from '../http-api.js';
import { createIndustrySourceRouter } from './industry-http.js';
import { IndustrySourceProvider } from './industry-provider.js';

const servers: Server[] = [];
const context = { accountUserId: 1, actorUserId: 2, enterpriseProjectId: 'project-A', businessOwnerId: 'owner-A', businessActorId: 'actor-A' };
const token = 'server-only-fixture-token';
function core(overrides: Partial<ModuleHttpCore> = {}): ModuleHttpCore {
  return { context: () => context, environment: { FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN: token }, database: async () => { throw new Error('must not access database'); }, ...overrides };
}
async function host(value: ModuleHttpCore, provider: IndustrySourceProvider) {
  const app = express(); app.use('/api/modules/publish/source-ranking', createIndustrySourceRouter(value, provider));
  const server = createServer(app); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
  return `http://127.0.0.1:${address.port}/api/modules/publish/source-ranking`;
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });

describe('authenticated industry HTTP gateway', () => {
  it('refuses missing context, missing secret, cross-site requests and HEAD before provider access', async () => {
    const provider = new IndustrySourceProvider(), query = vi.spyOn(provider, 'query');
    const unauth = await host(core({ context: () => { throw new Error('not authenticated'); } }), provider);
    expect((await fetch(unauth + '/filters')).status).toBe(401);
    const forbidden = await host(core({ context: () => ({ ...context, enterpriseProjectId: null }) }), provider);
    expect((await fetch(forbidden + '/filters')).status).toBe(403);
    const missing = await host(core({ environment: {} }), provider);
    expect(await (await fetch(missing + '/filters')).json()).toMatchObject({ status: 'configuration_required' });
    const url = await host(core(), provider);
    expect((await fetch(url + '/filters', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(url + '/filters', { method: 'HEAD' })).status).toBe(405);
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects duplicate, unknown and endpoint-incompatible parameters', async () => {
    const provider = new IndustrySourceProvider(), query = vi.spyOn(provider, 'query');
    const url = await host(core(), provider);
    const common = 'periodType=MONTH&date=2026-10-01&scopeType=ALL&modelCode=all';
    for (const suffix of ['/filters?projectId=other', `/distributions?${common}&requestId=11111111-1111-4111-8111-111111111111`, `/contents?${common}&date=2026-10-02`]) expect((await fetch(url + suffix)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it('derives isolation from authenticated context and returns no-store typed payloads', async () => {
    const provider = new IndustrySourceProvider();
    const query = vi.spyOn(provider, 'query').mockResolvedValue({ status: 'ok', source: 'molizhishu-public-industry', fetchedAt: '2026-11-06T08:00:00.000Z', data: { models: [], minDate: null, maxDate: null, industryTree: [], sourceTypes: [] } });
    const first = await host(core(), provider), second = await host(core({ context: () => ({ ...context, actorUserId: 3 }) }), provider);
    const response = await fetch(first + '/filters');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ status: 'ok', data: { maxDate: null } });
    await fetch(second + '/filters');
    expect(query.mock.calls[0]![2]).not.toBe(query.mock.calls[1]![2]);
    expect(query.mock.calls[0]![3]).toBe(token);
  });
});
