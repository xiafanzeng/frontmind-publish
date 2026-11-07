// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { getTableColumns, type SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { ModuleHttpCore } from '../http-api.js';
import { sourceMatrixConnections as connections, sourceMatrixConnectionTests as tests } from '../../schema/source-matrix-connections.js';
import { digest } from './common.js';
import { createAiConnectionRouter } from './ai-connection-http.js';
import { invokeAi, listProviderModels, type AiSettings } from './ai-connection-provider.js';

// Keep endpoint validation real. These two network boundaries can never call providers.
vi.mock('./ai-connection-provider.js', async () => {
  const actual = await vi.importActual<typeof import('./ai-connection-provider.js')>('./ai-connection-provider.js');
  return { ...actual, invokeAi: vi.fn(), listProviderModels: vi.fn() };
});

const servers: Server[] = [];
const context = { accountUserId: 1, actorUserId: 2, enterpriseProjectId: 'project-A', businessOwnerId: 'owner-A', businessActorId: 'actor-A' };
const tenantId = 'publish-' + digest({ project: context.enterpriseProjectId, owner: context.businessOwnerId });
const actorId = digest({ account: context.accountUserId, actor: context.actorUserId });
const scope = `${tenantId}:${actorId}`;
const encryptionKey = Buffer.alloc(32, 7);
const fixtureKey = 'fixture-secret-never-returned-1234';
const baseline: AiSettings = { name: 'Existing connection', provider: 'deepseek', model: 'deepseek-chat', apiKey: fixtureKey };
type StoredRow = Record<string, any>;

function seal(config: AiSettings): string {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
  cipher.setAAD(Buffer.from(scope));
  const data = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), data].map(value => value.toString('base64')).join('.');
}
function unseal(ciphertext: string): AiSettings {
  const [iv, tag, data] = ciphertext.split('.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv!, 'base64'));
  decipher.setAAD(Buffer.from(scope)); decipher.setAuthTag(Buffer.from(tag!, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data!, 'base64')), decipher.final()]).toString('utf8')) as AiSettings;
}

/** Only the two route-owned tables and their equality/expiry predicates are supported. */
function fixture(saved?: AiSettings, overrides: Partial<ModuleHttpCore> = {}) {
  const active: StoredRow[] = [], pending: StoredRow[] = [];
  const dialect = new MySqlDialect();
  let failTokenDelete = false;
  const rowsFor = (table: unknown) => {
    if (table === connections) return active;
    if (table === tests) return pending;
    throw new Error('Unexpected table in connection HTTP test');
  };
  const matches = (table: typeof connections | typeof tests, condition: SQL, row: StoredRow): boolean => {
    const query = dialect.sqlToQuery(condition);
    const predicates = [...query.sql.matchAll(/`([^`]+)`\s*(=|<)\s*\?/g)];
    if (!predicates.length || predicates.length !== query.params.length) throw new Error('Unsupported test database predicate');
    const columns = Object.entries(getTableColumns(table));
    return predicates.every((match, index) => {
      const field = columns.find(([, column]) => column.name === match[1])?.[0];
      if (!field) throw new Error('Unknown predicate column');
      const expected = query.params[index];
      if (match[2] === '=') return row[field] === expected;
      if (field !== 'expiresAt') throw new Error('Unexpected range predicate');
      const at = expected instanceof Date ? expected : new Date(String(expected).replace(' ', 'T') + 'Z');
      return row.expiresAt.getTime() < at.getTime();
    });
  };
  const db: any = {
    select: () => ({ from: (table: typeof connections | typeof tests) => ({ where: (condition: SQL) => ({ limit: (count: number) => {
      const result = rowsFor(table).filter(row => matches(table, condition, row)).slice(0, count);
      return Object.assign(Promise.resolve(result), { for: () => Promise.resolve(result) });
    } }) }) }),
    insert: (table: unknown) => ({ values: async (value: StoredRow) => { rowsFor(table).push({ createdAt: new Date(), updatedAt: new Date(), ...value }); } }),
    update: (table: typeof connections | typeof tests) => ({ set: (value: StoredRow) => ({ where: async (condition: SQL) => {
      for (const row of rowsFor(table)) if (matches(table, condition, row)) Object.assign(row, value);
    } }) }),
    delete: (table: typeof connections | typeof tests) => ({ where: async (condition: SQL) => {
      if (table === tests && failTokenDelete) throw new Error('Fixture storage failure');
      const rows = rowsFor(table), remaining = rows.filter(row => !matches(table, condition, row));
      rows.splice(0, rows.length, ...remaining);
    } }),
    transaction: async (action: (tx: any) => Promise<unknown>) => {
      const before = structuredClone({ active, pending });
      try { return await action(db); }
      catch (error) { active.splice(0, active.length, ...before.active); pending.splice(0, pending.length, ...before.pending); throw error; }
    },
  };
  const environment: Record<string, string | undefined> = { FRONTMIND_SOURCE_MATRIX_CREDENTIAL_KEY: encryptionKey.toString('base64') };
  const core: ModuleHttpCore = { context: () => context, environment, database: async () => db, ...overrides };
  if (saved) active.push({ tenantId, actorId, id: randomUUID(), revision: randomUUID(), name: saved.name, provider: saved.provider, model: saved.model, maskedKey: '••••1234', ciphertext: seal(saved), createdAt: new Date(), updatedAt: new Date() });
  const addPending = (config: AiSettings, expectedRevision: string | null = active[0]?.revision || null) => {
    const token = randomBytes(32).toString('hex');
    pending.push({ tenantId, actorId, tokenHash: createHash('sha256').update(token).digest('hex'), ciphertext: seal(config), expectedRevision, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    return token;
  };
  return { core, environment, active, pending, addPending, failTokenDelete: () => { failTokenDelete = true; } };
}
async function host(core: ModuleHttpCore) {
  const app = express(); app.use('/api/modules/publish', createAiConnectionRouter(core));
  const server = createServer(app); servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  return `http://127.0.0.1:${address.port}/api/modules/publish/matrix/connection`;
}
async function post(url: string, action: string, body: unknown) {
  const response = await fetch(url + '/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(url).origin }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
function editable(config: AiSettings, expectedRevision: string | null = null) {
  const { name, model, ...fields } = config;
  return { fields: { ...fields, expectedRevision }, test: { ...fields, name, model, expectedRevision } };
}

beforeEach(() => {
  vi.mocked(invokeAi).mockReset().mockResolvedValue('OK');
  vi.mocked(listProviderModels).mockReset().mockResolvedValue({ mode: 'listed', models: ['deepseek-chat'], truncated: false, message: 'Directory response' });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
});

describe('AI connection HTTP lifecycle', () => {
  it('requires a Key and accepts only provider-specific fields before any provider access', async () => {
    const f = fixture(baseline), before = structuredClone(f.active), url = await host(f.core);
    const valid = { provider: 'deepseek', apiKey: fixtureKey, expectedRevision: f.active[0]!.revision };
    const invalid = [
      { ...valid, apiKey: undefined }, { ...valid, apiKey: '' }, { ...valid, apiKey: 'abc' },
      { ...valid, baseUrl: 'https://api.deepseek.com' }, { ...valid, region: 'cn-beijing' },
      { ...valid, workspace: 'team-a' }, { ...valid, azureEndpoint: 'https://sample.openai.azure.com' },
      { ...valid, provider: 'azure-openai' }, { ...valid, provider: 'azure-foundry' },
      { ...valid, provider: 'dashscope', region: 'unknown-region' },
      { ...valid, provider: 'dashscope', workspace: 'unsafe.example' },
    ];
    for (const body of invalid) {
      expect(await post(url, 'models', body)).toMatchObject({ status: 400, body: { status: 'invalid_input' } });
      expect(await post(url, 'test', { ...body, model: 'deployment-a' })).toMatchObject({ status: 400, body: { status: 'invalid_input' } });
    }
    expect(listProviderModels).not.toHaveBeenCalled(); expect(invokeAi).not.toHaveBeenCalled();
    expect(f.active).toEqual(before); expect(f.pending).toEqual([]);
  });

  it('forwards DashScope and Azure query settings consistently without promoting catalog entries to tested deployments', async () => {
    const f = fixture(), url = await host(f.core);
    const dash = { ...baseline, provider: 'dashscope' as const, model: 'qwen-plus', region: 'ap-southeast-1', workspace: 'team-a' };
    expect((await post(url, 'models', editable(dash).fields)).status).toBe(200);
    expect(vi.mocked(listProviderModels).mock.calls.at(-1)?.[0]).toMatchObject({ provider: dash.provider, apiKey: fixtureKey, region: dash.region, workspace: dash.workspace });
    expect((await post(url, 'test', editable(dash).test)).status).toBe(200);
    expect(vi.mocked(invokeAi).mock.calls.at(-1)?.[0]).toMatchObject(dash);
    const catalog = { mode: 'catalog' as const, models: ['gpt-4.1'], truncated: true, message: 'Catalog only; enter a deployment name and test it.' };
    vi.mocked(listProviderModels).mockResolvedValue(catalog);
    const azure = { provider: 'azure-openai', apiKey: fixtureKey, azureEndpoint: 'https://resource-a.openai.azure.com', expectedRevision: null };
    expect(await post(url, 'models', azure)).toEqual({ status: 200, body: catalog });
    expect(vi.mocked(listProviderModels).mock.calls.at(-1)?.[0]).toMatchObject({ provider: azure.provider, apiKey: fixtureKey, azureEndpoint: azure.azureEndpoint });
    expect(invokeAi).toHaveBeenCalledTimes(1); expect(f.pending).toHaveLength(1); expect(f.active).toEqual([]);
  });

  it('blocks stale edits and legacy custom endpoints before querying or testing, while keeping legacy connections readable and removable', async () => {
    const legacy = { ...baseline, baseUrl: 'https://admin-model.example.com/v1' };
    const f = fixture(legacy), before = structuredClone(f.active), url = await host(f.core);
    f.environment.FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS = legacy.baseUrl;
    const response = await fetch(url), state = await response.json();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(state).toMatchObject({ connection: { requiresAdminEndpoint: true, revision: f.active[0]!.revision }, mode: 'user', available: true });
    expect(JSON.stringify(state)).not.toContain(legacy.baseUrl); expect(JSON.stringify(state)).not.toContain(fixtureKey);
    for (const action of ['models', 'test']) {
      const input = action === 'models' ? editable(baseline).fields : editable(baseline).test;
      expect(await post(url, action, { ...input, expectedRevision: randomUUID() })).toMatchObject({ status: 409, body: { status: 'stale_connection' } });
      expect(await post(url, action, { ...input, expectedRevision: f.active[0]!.revision })).toMatchObject({ status: 409, body: { status: 'legacy_endpoint_readonly' } });
    }
    expect(listProviderModels).not.toHaveBeenCalled(); expect(invokeAi).not.toHaveBeenCalled(); expect(f.active).toEqual(before);
    expect(await post(url, 'remove', { expectedRevision: f.active[0]!.revision })).toMatchObject({ status: 200, body: { connection: null, mode: 'none', available: false } });
    expect(f.active).toEqual([]);
  });

  it('keeps the saved connection on directory and test failures and returns distinct safe errors', async () => {
    const f = fixture(baseline), before = structuredClone(f.active), url = await host(f.core), input = editable(baseline, f.active[0]!.revision);
    vi.mocked(listProviderModels).mockRejectedValueOnce(new Error('provider_credential_invalid'));
    vi.mocked(invokeAi).mockRejectedValueOnce(new Error('provider_permission_denied'));
    const directory = await post(url, 'models', input.fields), tested = await post(url, 'test', input.test);
    expect(directory).toMatchObject({ status: 422, body: { status: 'model_list_failed', message: expect.stringContaining('Key') } });
    expect(tested).toMatchObject({ status: 422, body: { status: 'connection_test_failed' } });
    expect(directory.body).not.toHaveProperty('models'); expect(tested.body).not.toHaveProperty('testToken');
    expect(JSON.stringify([directory, tested])).not.toContain(fixtureKey);
    expect(f.active).toEqual(before); expect(f.pending).toEqual([]);
  });

  it('derives bounded names, preserves explicit remarks and saves exactly the tested ciphertext once', async () => {
    const f = fixture(), url = await host(f.core);
    for (const example of [
      { name: undefined, model: 'deepseek-ai/DeepSeek-V3', expected: '硅基流动 · deepseek-ai/DeepSeek-V3' },
      { name: '   ', model: 'Qwen/Qwen3-8B', expected: '硅基流动 · Qwen/Qwen3-8B' },
      { name: undefined, model: 'x'.repeat(160), expected: ('硅基流动 · ' + 'x'.repeat(160)).slice(0, 100) },
      { name: 'Saved personal remark', model: 'Qwen/Qwen3-8B', expected: 'Saved personal remark' },
    ]) {
      const old = structuredClone(f.active), expectedRevision = f.active[0]?.revision || null;
      const tested = await post(url, 'test', { provider: 'siliconflow', apiKey: fixtureKey, model: example.model, name: example.name, expectedRevision });
      expect(tested.status).toBe(200); expect(tested.body.testToken).toMatch(/^[a-f0-9]{64}$/);
      expect(f.active).toEqual(old); expect(f.pending).toHaveLength(1);
      const ciphertext = f.pending[0]!.ciphertext;
      expect(unseal(ciphertext)).toMatchObject({ name: example.expected, apiKey: fixtureKey, provider: 'siliconflow', model: example.model });
      const saved = await post(url, 'save', { testToken: tested.body.testToken, expectedRevision });
      expect(saved).toMatchObject({ status: 200, body: { connection: { name: example.expected, model: example.model, provider: 'siliconflow' }, mode: 'user', available: true } });
      expect(f.active[0]!.ciphertext).toBe(ciphertext); expect(f.pending).toEqual([]);
      expect(JSON.stringify(saved)).not.toContain(fixtureKey); expect(saved.body.connection).not.toHaveProperty('apiKey');
      expect(await post(url, 'save', { testToken: tested.body.testToken, expectedRevision: f.active[0]!.revision })).toMatchObject({ status: 409, body: { status: 'test_expired' } });
    }
  });

  it('persists both Azure provider shapes and returns editable resource metadata without exposing the Key', async () => {
    const f = fixture(), url = await host(f.core);
    for (const azure of [
      { provider: 'azure-openai' as const, azureEndpoint: 'https://resource-a.openai.azure.com' },
      { provider: 'azure-foundry' as const, azureEndpoint: 'https://resource-b.services.ai.azure.com' },
    ]) {
      const config = { ...baseline, ...azure, name: 'Saved deployment', model: 'my-deployment' }, expectedRevision = f.active[0]?.revision || null;
      const tested = await post(url, 'test', editable(config, expectedRevision).test);
      expect(tested.status).toBe(200);
      expect(vi.mocked(invokeAi).mock.calls.at(-1)?.[0]).toEqual(config);
      const saved = await post(url, 'save', { testToken: tested.body.testToken, expectedRevision });
      expect(saved.status).toBe(200); expect(unseal(f.active[0]!.ciphertext)).toEqual(config);
      const state = await (await fetch(url)).json();
      expect(state).toMatchObject({ mode: 'user', available: true, connection: { ...azure, name: config.name, model: config.model } });
      expect(state.connection).not.toHaveProperty('apiKey'); expect(state.connection).not.toHaveProperty('baseUrl');
      expect(JSON.stringify(state)).not.toContain(fixtureKey);
    }
  });

  it('rejects expired tokens and both requested and stored revision mismatches without replacing the saved connection', async () => {
    const f = fixture(baseline), url = await host(f.core), revision = f.active[0]!.revision;
    const expired = f.addPending({ ...baseline, name: 'Expired candidate' }); f.pending[0]!.expiresAt = new Date(Date.now() - 1000);
    const wrongRequest = f.addPending({ ...baseline, name: 'Current candidate' });
    const wrongStored = f.addPending({ ...baseline, name: 'Stale candidate' }, randomUUID());
    const before = structuredClone({ active: f.active, pending: f.pending });
    expect(await post(url, 'save', { testToken: expired, expectedRevision: revision })).toMatchObject({ status: 409, body: { status: 'test_expired' } });
    expect(await post(url, 'save', { testToken: wrongRequest, expectedRevision: randomUUID() })).toMatchObject({ status: 409, body: { status: 'stale_connection' } });
    expect(await post(url, 'save', { testToken: wrongStored, expectedRevision: revision })).toMatchObject({ status: 409, body: { status: 'stale_connection' } });
    expect({ active: f.active, pending: f.pending }).toEqual(before);
    expect(invokeAi).not.toHaveBeenCalled(); expect(listProviderModels).not.toHaveBeenCalled();
  });

  it('rechecks endpoint policy when redeeming encrypted candidates, including legacy allowlist changes', async () => {
    const f = fixture(baseline), url = await host(f.core), expectedRevision = f.active[0]!.revision;
    const legacy = { ...baseline, baseUrl: 'https://former-admin-endpoint.example.com/v1' };
    f.environment.FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS = legacy.baseUrl;
    const legacyToken = f.addPending(legacy);
    delete f.environment.FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS;
    const azureToken = f.addPending({ ...baseline, provider: 'azure-openai', azureEndpoint: 'https://resource.openai.azure.com.attacker.example', model: 'deployment-a' });
    const before = structuredClone({ active: f.active, pending: f.pending });
    expect(await post(url, 'save', { testToken: legacyToken, expectedRevision })).toMatchObject({ status: 409, body: { status: 'legacy_endpoint_readonly' } });
    expect(await post(url, 'save', { testToken: azureToken, expectedRevision })).toMatchObject({ status: 409, body: { status: 'endpoint_not_allowed' } });
    expect({ active: f.active, pending: f.pending }).toEqual(before);
    expect(invokeAi).not.toHaveBeenCalled();
  });

  it('retains host priority and metadata even when personal settings become unreadable', async () => {
    const adapter = { matrix: vi.fn().mockResolvedValue(undefined), budget: vi.fn().mockResolvedValue(undefined) };
    const config: AiSettings = { ...baseline, provider: 'dashscope', model: 'qwen-plus', region: 'us-east-1', workspace: 'workspace-a' };
    const f = fixture(config, { sourceMatrixDecisions: adapter }), url = await host(f.core);
    expect(await (await fetch(url)).json()).toMatchObject({ mode: 'host', available: true, connection: { region: config.region, workspace: config.workspace } });
    const tested = await post(url, 'test', editable(config, f.active[0]!.revision).test);
    expect(tested.status).toBe(200);
    expect(await post(url, 'save', { testToken: tested.body.testToken, expectedRevision: f.active[0]!.revision })).toMatchObject({ status: 200, body: { mode: 'host', available: true, connection: { region: config.region, workspace: config.workspace } } });
    f.active[0]!.ciphertext = 'damaged.ciphertext.value';
    const before = structuredClone(f.active), state = await (await fetch(url)).json();
    expect(state).toMatchObject({ mode: 'host', available: true, connection: { settingsUnavailable: true, revision: f.active[0]!.revision } });
    expect(state.connection).not.toHaveProperty('apiKey'); expect(state.connection).not.toHaveProperty('baseUrl');
    vi.mocked(listProviderModels).mockClear(); vi.mocked(invokeAi).mockClear();
    expect(await post(url, 'models', editable(config, f.active[0]!.revision).fields)).toMatchObject({ status: 503, body: { status: 'configuration_required' } });
    expect(listProviderModels).not.toHaveBeenCalled(); expect(invokeAi).not.toHaveBeenCalled(); expect(f.active).toEqual(before);
  });

  it('rolls back a replacement if consuming its single-use token fails', async () => {
    const f = fixture(baseline), url = await host(f.core), expectedRevision = f.active[0]!.revision;
    const testToken = f.addPending({ ...baseline, name: 'Replacement' });
    const before = structuredClone({ active: f.active, pending: f.pending });
    f.failTokenDelete();
    expect(await post(url, 'save', { testToken, expectedRevision })).toMatchObject({ status: 503, body: { status: 'connection_storage_unavailable' } });
    expect({ active: f.active, pending: f.pending }).toEqual(before);
    expect((await (await fetch(url)).json()).connection).toMatchObject({ name: baseline.name, revision: expectedRevision });
  });
});
