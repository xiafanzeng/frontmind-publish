// Source-only regression cases; run in the final merged ZCode workspace.
import { describe, expect, it, vi } from 'vitest';
import type { IdentificationContext, IdentificationContextResponse, IdentificationFields, IdentifyArticleResponse } from '../../shared/article-identification';
import { ArticleIdentificationStore, IDENTIFICATION_SESSION_TTL, type IdentificationTransport, type IdentificationValues } from './article-identification-store';

const emptyFields = (): IdentificationFields => ({ product: { value: null, source: 'unidentified' }, industry: { value: null, source: 'unidentified' }, audience: { value: null, source: 'unidentified' }, questions: { value: null, source: 'unidentified' } });
const values = (product = ''): IdentificationValues => ({ product, industry: '', audience: '', questions: '' });
const context = (version = 'version-a', scope = 'user-project-a', revision = 'connection-1'): IdentificationContext => ({ scopeKey: scope, articleId: 'article-' + version, articleVersionId: version, versionNumber: 2, title: 'Synthetic article', contentDigest: 'digest-' + version, connection: { available: true, mode: 'environment', revision } });
const ready = (ctx = context()): IdentificationContextResponse => ({ status: ctx.connection.available ? 'ready' : 'not_configured', context: ctx, fields: emptyFields() });
const identified = (ctx = context(), product = 'Suggested product'): IdentifyArticleResponse => ({ status: 'partial', context: ctx, fields: { ...emptyFields(), product: { value: product, source: 'inferred' }, questions: { value: 'First question\nSecond question', source: 'inferred' } } });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function wire(handler: (path: string, signal: AbortSignal, body?: unknown) => Promise<unknown>) {
  const send = vi.fn(handler);
  const transport: IdentificationTransport = async <T>(path: string, signal: AbortSignal, body?: unknown) => await send(path, signal, body) as T;
  return { send, transport };
}
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return { get length() { return map.size; }, clear: () => map.clear(), getItem: key => map.get(key) ?? null, key: index => [...map.keys()][index] ?? null, removeItem: key => { map.delete(key); }, setItem: (key, value) => { map.set(key, value); } };
}
const route = { workspace: 'project-a', articleVersionId: 'version-a', connectionEpoch: 0 };

describe('authenticated article identification state', () => {
  it('reuses successful authorized article recognition across tasks without sharing protected requirements, and explicit re-identify stays fresh', async () => {
    const api = wire(async path => path.includes('/context?') ? ready() : identified());
    const store = new ArticleIdentificationStore(api.transport, () => null), a = store.route({ ...route, formScope: 'task-a' });
    const stopA = a.mount(); await vi.waitFor(() => expect(a.getSnapshot().status).toBe('ready'));
    a.hydrate({ product: 'Saved task A brand' }, 'task-a'); a.setField('audience', 'Private task A audience'); a.setAutomatic(true);
    await vi.waitFor(() => expect(a.getSnapshot().status).toBe('partial')); stopA();
    const b = store.route({ ...route, formScope: 'task-b' }); const stopB = b.mount();
    b.hydrate({ product: 'Saved task B brand' }, 'task-b'); b.setField('questions', ''); b.setAutomatic(true);
    await vi.waitFor(() => expect(b.getSnapshot().status).toBe('partial'));
    expect(b.getSnapshot().values).toMatchObject({ product: 'Saved task B brand', audience: '', questions: '' });
    expect(b.getSnapshot().fields.product.suggestion?.value).toBe('Suggested product');
    expect(b.getSnapshot().fields.questions.edited).toBe(true);
    expect(api.send.mock.calls.filter(([path]) => path.includes('/context?'))).toHaveLength(2);
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(1);
    await b.identify();
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(2);
    expect(b.getSnapshot().values.product).toBe('Saved task B brand'); stopB();
  });

  it('joins in-flight article recognition across different authorized task forms', async () => {
    const model = deferred<IdentifyArticleResponse>(), api = wire(async path => path.includes('/context?') ? ready() : model.promise);
    const store = new ArticleIdentificationStore(api.transport, () => null), a = store.route({ ...route, formScope: 'task-a' }), b = store.route({ ...route, formScope: 'task-b' });
    const stopA = a.mount(), stopB = b.mount(); a.setAutomatic(true); b.setAutomatic(true);
    await vi.waitFor(() => expect(a.getSnapshot().status).toBe('identifying'));
    await vi.waitFor(() => expect(b.getSnapshot().status).toBe('identifying'));
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(1);
    a.setField('product', 'A manual'); b.setField('questions', ''); model.resolve(identified());
    await vi.waitFor(() => expect(a.getSnapshot().status).toBe('partial'));
    await vi.waitFor(() => expect(b.getSnapshot().status).toBe('partial'));
    expect(a.getSnapshot().values.product).toBe('A manual'); expect(b.getSnapshot().values.product).toBe('Suggested product');
    expect(a.getSnapshot().values.questions).toBe('First question\nSecond question'); expect(b.getSnapshot().values.questions).toBe(''); stopA(); stopB();
  });

  it('reuses another task session recognition after fresh authorization on reload without restoring its private form edits', async () => {
    const storage = memoryStorage(), firstApi = wire(async path => path.includes('/context?') ? ready() : identified());
    const a = new ArticleIdentificationStore(firstApi.transport, () => storage).route({ ...route, formScope: 'task-a' });
    const stopA = a.mount(); a.setAutomatic(true); await vi.waitFor(() => expect(a.getSnapshot().status).toBe('partial'));
    a.setField('product', 'Private task A brand'); a.setField('audience', 'Private task A audience'); stopA();
    const metadata = deferred<IdentificationContextResponse>(), secondApi = wire(async path => { if (path.includes('/context?')) return metadata.promise; throw new Error('Model must reuse authenticated persisted recognition'); });
    const b = new ArticleIdentificationStore(secondApi.transport, () => storage).route({ ...route, formScope: 'task-b' });
    const stopB = b.mount(); b.setAutomatic(true); b.hydrate({ product: 'Saved task B brand' }, 'task-b');
    expect(b.getSnapshot().recognizedIndustry).toBeNull(); expect(b.getSnapshot().values.product).toBe('');
    metadata.resolve(ready()); await vi.waitFor(() => expect(b.getSnapshot().status).toBe('partial'));
    expect(b.getSnapshot().values).toMatchObject({ product: 'Saved task B brand', audience: '' });
    expect(b.getSnapshot().fields.product.suggestion?.value).toBe('Suggested product');
    expect(secondApi.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(0); stopB();
  });

  it.each(['authorization', 'version', 'digest', 'connection', 'workspace'] as const)('never reuses article recognition after a %s identity change', async kind => {
    let ctx = context();
    const api = wire(async path => path.includes('/context?') ? ready(ctx) : identified(ctx));
    const store = new ArticleIdentificationStore(api.transport, () => null), a = store.route({ ...route, formScope: 'task-a' });
    const stopA = a.mount(); a.setAutomatic(true); await vi.waitFor(() => expect(a.getSnapshot().status).toBe('partial')); stopA();
    ctx = kind === 'authorization' ? context('version-a', 'other-authorized-account') : kind === 'version' ? context('version-b') : kind === 'digest' ? { ...context(), contentDigest: 'updated-digest' } : kind === 'connection' ? context('version-a', 'user-project-a', 'connection-2') : context();
    const b = store.route({ ...route, articleVersionId: ctx.articleVersionId, workspace: kind === 'workspace' ? 'project-b' : route.workspace, formScope: 'task-b' });
    const stopB = b.mount(); b.setAutomatic(true); await vi.waitFor(() => expect(b.getSnapshot().status).toBe('partial'));
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(2); stopB();
  });

  it.each(['failed', 'unidentified'] as const)('does not cache a %s attempt as a successful result for another task', async outcome => {
    let attempts = 0;
    const api = wire(async path => { if (path.includes('/context?')) return ready(); if (++attempts === 1) { if (outcome === 'failed') throw new Error('synthetic failure'); return { status: 'unidentified', context: context(), fields: emptyFields() }; } return identified(); });
    const store = new ArticleIdentificationStore(api.transport, () => null), a = store.route({ ...route, formScope: 'task-a' });
    const stopA = a.mount(); a.setAutomatic(true); await vi.waitFor(() => expect(a.getSnapshot().status).toBe(outcome)); stopA();
    const b = store.route({ ...route, formScope: 'task-b' }), stopB = b.mount(); b.setAutomatic(true);
    await vi.waitFor(() => expect(b.getSnapshot().status).toBe('partial'));
    expect(b.getSnapshot().values.product).toBe('Suggested product'); expect(attempts).toBe(2); stopB();
  });

  it('fills historically empty saved fields while retaining nonempty saved and explicit clears', async () => {
    const api = wire(async path => path.includes('/context?') ? ready() : identified());
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    current.hydrate({ product: '', audience: 'Saved audience', questions: '' }, 'task-empty');
    current.hydrate({ questions: '' }, 'task-clear', { explicitEmpty: ['questions'] });
    await current.identify();
    expect(current.getSnapshot().values).toMatchObject({ product: 'Suggested product', audience: 'Saved audience', questions: '' });
    expect(current.getSnapshot().fields.questions.savedEmpty).toBe(true);
    expect(current.getSnapshot().fields.questions.suggestion?.value).toBe('First question\nSecond question');
    current.hydrate({ questions: 'Late saved question' }, 'late-saved', { replaceSaved: ['questions'] });
    expect(current.getSnapshot().values.questions).toBe('');
    stop();
  });

  it('queues partial hydration and accepts a late industry without resetting other fields', async () => {
    const meta = deferred<IdentificationContextResponse>();
    const api = wire(async () => meta.promise);
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount();
    current.hydrate({ product: 'Saved product', industry: '' }, 'task');
    current.hydrate({ audience: 'Saved audience' }, 'task');
    current.setField('questions', 'Manual question');
    meta.resolve(ready()); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    current.hydrate({ industry: '901' }, 'task');
    expect(current.getSnapshot().values).toEqual({ product: 'Saved product', audience: 'Saved audience', questions: 'Manual question', industry: '901' });
    current.hydrate({ industry: '902' }, 'task:catalog-2', { replaceSaved: ['industry'] });
    expect(current.getSnapshot().values.industry).toBe('902');
    expect(current.getSnapshot().values.product).toBe('Saved product'); stop();
  });

  it('does not erase good AI results with a later missing/empty hydration or replace saved nonempty by default', async () => {
    const api = wire(async path => path.includes('/context?') ? ready() : identified());
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    await current.identify(); current.hydrate(values(), 'missing-after-ai');
    expect(current.getSnapshot().values.product).toBe('Suggested product');
    current.hydrate({ audience: 'Saved audience' }, 'saved');
    current.hydrate({ audience: 'Other audience' }, 'later');
    expect(current.getSnapshot().values.audience).toBe('Saved audience'); stop();
  });

  it('migrates v1 invalid saved-empty markers after authorization and preserves manual clears/nonempty saved values', async () => {
    const storage = memoryStorage(), api = wire(async path => path.includes('/context?') ? ready() : identified());
    const first = new ArticleIdentificationStore(api.transport, () => storage).route(route);
    const stop = first.mount(); await vi.waitFor(() => expect(first.getSnapshot().status).toBe('ready'));
    first.hydrate({ audience: 'Saved audience' }, 'saved'); first.setField('questions', ''); stop();
    const key = storage.key(0)!, legacy = JSON.parse(storage.getItem(key)!);
    delete legacy.schema; legacy.attempted = true; legacy.status = 'partial'; legacy.hydrations = ['saved'];
    legacy.fields.product = { value: '', origin: 'saved', edited: false, suggestion: { value: 'Recovered suggestion', source: 'inferred' } };
    legacy.fields.industry = { value: '', origin: 'saved', edited: false };
    storage.setItem(key, JSON.stringify(legacy));
    const restored = new ArticleIdentificationStore(api.transport, () => storage).route(route);
    expect(restored.getSnapshot().values.product).toBe(''); const stopRestored = restored.mount();
    await vi.waitFor(() => expect(restored.getSnapshot().values.product).toBe('Recovered suggestion'));
    expect(restored.getSnapshot().fields.industry.origin).toBe('unidentified');
    restored.setAutomatic(true); await vi.waitFor(() => expect(restored.getSnapshot().status).toBe('partial'));
    expect(restored.getSnapshot().values).toMatchObject({ product: 'Suggested product', audience: 'Saved audience', questions: '' });
    expect(restored.getSnapshot().fields.questions.edited).toBe(true);
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(1); stopRestored();
  });

  it('restores new explicit saved-empty metadata without reopening or overwriting the field', async () => {
    const storage = memoryStorage(), api = wire(async path => path.includes('/context?') ? ready() : identified());
    const first = new ArticleIdentificationStore(api.transport, () => storage).route(route);
    const stop = first.mount(); await vi.waitFor(() => expect(first.getSnapshot().status).toBe('ready'));
    first.hydrate({ product: '' }, 'deliberate-clear', { explicitEmpty: ['product'] }); await first.identify(); stop();
    const restored = new ArticleIdentificationStore(api.transport, () => storage).route(route);
    const stopRestored = restored.mount(); restored.setAutomatic(true);
    await vi.waitFor(() => expect(restored.getSnapshot().status).toBe('partial'));
    expect(restored.getSnapshot().fields.product).toMatchObject({ value: '', origin: 'saved', savedEmpty: true });
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(1); stopRestored();
  });

  it('validates industry results against a late/changing canonical catalog without touching other fields', async () => {
    const api = wire(async path => path.includes('/context?') ? ready() : ({ ...identified(), fields: { ...identified().fields, industry: { value: '901', canonicalId: '901', source: 'inferred' } } }));
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); current.setIndustryCatalog({ ids: ['901'], version: 'catalog-1' });
    await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready')); await current.identify();
    expect(current.getSnapshot().values.industry).toBe('901');
    current.setIndustryCatalog({ ids: ['902'], version: 'catalog-2' });
    expect(current.getSnapshot().fields.industry).toMatchObject({ value: '', reason: 'catalog_changed' });
    expect(current.getSnapshot().values.product).toBe('Suggested product');
    current.setIndustryCatalog({ ids: ['901', '902'], version: 'catalog-3' });
    expect(current.getSnapshot().values.industry).toBe('901');
    current.setField('industry', '902'); current.setIndustryCatalog({ ids: ['901'], version: 'catalog-4' });
    expect(current.getSnapshot().fields.industry).toMatchObject({ value: '902', origin: 'manual', edited: true });
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(1); stop();
  });

  it('maps trusted legacy industry identities without losing manual ownership and invalidates stale suggestions', async () => {
    const api = wire(async path => path.includes('/context?') ? ready() : ({ ...identified(), fields: { ...identified().fields, industry: { value: '901', source: 'inferred' } } }));
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    current.setField('industry', 'legacy-id'); current.remapIndustry('legacy-id', '902');
    expect(current.getSnapshot().fields.industry).toMatchObject({ value: '902', origin: 'manual', edited: true, canonicalId: '902' });
    current.setIndustryCatalog({ ids: ['901', '902'], version: 'catalog-1' }); await current.identify();
    expect(current.getSnapshot().fields.industry.suggestion?.value).toBe('901');
    current.setIndustryCatalog({ ids: ['902'], version: 'catalog-2' }); current.adopt('industry');
    expect(current.getSnapshot().values.industry).toBe('902');
    expect(current.getSnapshot().fields.industry.suggestion).toBeUndefined();
    current.setField('industry', ''); current.remapIndustry('902', '903');
    expect(current.getSnapshot().fields.industry).toMatchObject({ value: '', edited: true }); stop();
  });

  it('keeps the authenticated shared recognized industry independent of form edits and same-tab reloads', async () => {
    const storage = memoryStorage();
    const api = wire(async path => path.includes('/context?') ? ready() : ({ ...identified(), fields: { ...identified().fields, industry: { value: '901', canonicalId: '901', source: 'inferred' } } }));
    const current = new ArticleIdentificationStore(api.transport, () => storage).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    await current.identify(); current.setField('industry', '902');
    expect(current.getSnapshot().recognizedIndustry).toMatchObject({ value: '901', canonicalId: '901', source: 'inferred' });
    current.setField('industry', '');
    expect(current.getSnapshot().values.industry).toBe('');
    expect(current.getSnapshot().recognizedIndustry?.value).toBe('901'); stop();
    const meta = deferred<IdentificationContextResponse>(), restoredApi = wire(async () => meta.promise);
    const restored = new ArticleIdentificationStore(restoredApi.transport, () => storage).route(route);
    expect(restored.getSnapshot().recognizedIndustry).toBeNull(); const stopRestored = restored.mount();
    expect(restored.getSnapshot().recognizedIndustry).toBeNull(); meta.resolve(ready());
    await vi.waitFor(() => expect(restored.getSnapshot().recognizedIndustry?.value).toBe('901'));
    expect(restored.getSnapshot().fields.industry).toMatchObject({ value: '', edited: true }); stopRestored();
  });

  it('keeps typing and intentional clearing while a model result is pending, then offers explicit adoption', async () => {
    const model = deferred<IdentifyArticleResponse>();
    const api = wire(async path => path.includes('/context?') ? ready() : model.promise);
    const store = new ArticleIdentificationStore(api.transport, () => null), current = store.route(route);
    const unmount = current.mount(); current.setAutomatic(true);
    await vi.waitFor(() => expect(current.getSnapshot().status).toBe('identifying'));
    current.setField('product', 'My product'); current.setField('questions', '');
    model.resolve(identified());
    await vi.waitFor(() => expect(current.getSnapshot().status).toBe('partial'));
    expect(current.getSnapshot().values).toMatchObject({ product: 'My product', questions: '' });
    expect(current.getSnapshot().fields.questions.edited).toBe(true);
    expect(current.getSnapshot().fields.product.suggestion?.value).toBe('Suggested product');
    current.adopt('product'); expect(current.getSnapshot().values.product).toBe('Suggested product');
    expect(current.getSnapshot().fields.product.origin).toBe('inferred'); unmount();
  });

  it('masks A immediately when B is selected and never paints a late A result in B', async () => {
    const modelA = deferred<IdentifyArticleResponse>();
    const api = wire(async (path, _signal, body) => path.includes('/context?') ? ready(context(new URLSearchParams(path.split('?')[1]).get('article_version_id')!)) : (body as { article_version_id: string }).article_version_id === 'version-a' ? modelA.promise : identified(context('version-b'), 'B product'));
    const store = new ArticleIdentificationStore(api.transport, () => null), a = store.route(route);
    const unmountA = a.mount(); a.setAutomatic(true);
    await vi.waitFor(() => expect(a.getSnapshot().status).toBe('identifying')); unmountA();
    const b = store.route({ ...route, articleVersionId: 'version-b' });
    expect(b.getSnapshot().values.product).toBe('');
    const unmountB = b.mount(); b.setAutomatic(true);
    await vi.waitFor(() => expect(b.getSnapshot().values.product).toBe('B product'));
    modelA.resolve(identified(context(), 'A product'));
    await vi.waitFor(() => expect(a.pending).toBe(false));
    expect(b.getSnapshot().values.product).toBe('B product'); unmountB();
  });

  it('deduplicates StrictMode mounting and an in-flight same-version navigation round trip', async () => {
    const meta = deferred<IdentificationContextResponse>(), model = deferred<IdentifyArticleResponse>();
    const api = wire(async path => path.includes('/context?') ? meta.promise : model.promise);
    const store = new ArticleIdentificationStore(api.transport, () => null), current = store.route(route);
    let stop = current.mount(); current.setAutomatic(true); stop(); stop = current.mount(); current.setAutomatic(true);
    meta.resolve(ready()); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('identifying'));
    expect(api.send.mock.calls.filter(([path]) => path.includes('/context?'))).toHaveLength(1);
    stop(); stop = current.mount(); current.setAutomatic(true);
    await vi.waitFor(() => expect(api.send.mock.calls.filter(([path]) => path.includes('/context?'))).toHaveLength(2));
    model.resolve(identified()); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('partial'));
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(1); stop();
  });

  it('does not automatically retry a failure on rerender or remount; explicit retry works', async () => {
    let fail = true;
    const api = wire(async path => { if (path.includes('/context?')) return ready(); if (fail) throw new Error('synthetic upstream failure'); return identified(); });
    const store = new ArticleIdentificationStore(api.transport, () => null), current = store.route(route);
    let stop = current.mount(); current.setAutomatic(true);
    await vi.waitFor(() => expect(current.getSnapshot().status).toBe('failed'));
    current.setAutomatic(true); stop(); stop = current.mount(); current.setAutomatic(true);
    await vi.waitFor(() => expect(current.getSnapshot().context).not.toBeNull());
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(1);
    fail = false; await current.retry(); expect(current.getSnapshot().status).toBe('partial'); stop();
  });

  it('queues saved-task hydration before context and protects edits made before hydration arrives', async () => {
    const meta = deferred<IdentificationContextResponse>();
    const api = wire(async path => path.includes('/context?') ? meta.promise : identified());
    const store = new ArticleIdentificationStore(api.transport, () => null), current = store.route(route);
    const stop = current.mount(); current.setAutomatic(false);
    current.setField('questions', ''); current.hydrate({ ...values('Saved product'), questions: 'Saved questions' }, 'task-a');
    meta.resolve(ready()); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    expect(current.getSnapshot().values).toMatchObject({ product: 'Saved product', questions: '' });
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(0);
    current.setAutomatic(true); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('partial'));
    expect(current.getSnapshot().values.product).toBe('Saved product');
    expect(current.getSnapshot().fields.product.suggestion?.value).toBe('Suggested product'); stop();
  });

  it('only restores same-tab values after matching fresh server context and rejects another account', async () => {
    const storage = memoryStorage(), api = wire(async () => ready());
    const first = new ArticleIdentificationStore(api.transport, () => storage).route(route);
    const stop = first.mount(); await vi.waitFor(() => expect(first.getSnapshot().status).toBe('ready'));
    first.setField('product', 'Private draft'); expect(first.getSnapshot().persisted).toBe(true); stop();
    const meta = deferred<IdentificationContextResponse>(), secondApi = wire(async () => meta.promise);
    const second = new ArticleIdentificationStore(secondApi.transport, () => storage).route(route);
    expect(second.getSnapshot().values.product).toBe(''); const stopSecond = second.mount();
    expect(second.getSnapshot().values.product).toBe(''); meta.resolve(ready(context('version-a', 'other-user-project')));
    await vi.waitFor(() => expect(second.getSnapshot().status).toBe('ready'));
    expect(second.getSnapshot().values.product).toBe(''); stopSecond();
    const same = new ArticleIdentificationStore(api.transport, () => storage).route(route);
    const stopSame = same.mount(); await vi.waitFor(() => expect(same.getSnapshot().values.product).toBe('Private draft')); stopSame();
  });

  it('does not restore expired, changed-content or changed-connection state', async () => {
    const storage = memoryStorage(); let clock = 1000;
    const api = wire(async () => ready());
    const current = new ArticleIdentificationStore(api.transport, () => storage, () => clock).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    current.setField('product', 'Old draft'); stop(); clock += IDENTIFICATION_SESSION_TTL + 1;
    const expired = new ArticleIdentificationStore(api.transport, () => storage, () => clock).route(route);
    const stopExpired = expired.mount(); await vi.waitFor(() => expect(expired.getSnapshot().status).toBe('ready'));
    expect(expired.getSnapshot().values.product).toBe(''); stopExpired();
    for (const ctx of [{ ...context(), contentDigest: 'changed-digest' }, context('version-a', 'user-project-a', 'connection-2')]) {
      const changedApi = wire(async () => ready(ctx));
      const changed = new ArticleIdentificationStore(changedApi.transport, () => storage, () => 1000).route({ ...route, connectionEpoch: 1 });
      const stopChanged = changed.mount(); await vi.waitFor(() => expect(changed.getSnapshot().status).toBe('ready'));
      expect(changed.getSnapshot().values.product).toBe(''); stopChanged();
    }
  });

  it('retains metadata truthfully with unavailable configuration and never calls the model', async () => {
    const ctx = { ...context(), connection: { available: false, mode: 'none' as const, revision: 'unconfigured' } };
    const api = wire(async () => ({ ...ready(ctx), fields: { ...emptyFields(), product: { value: 'Trusted metadata', source: 'article' } } }));
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); current.setAutomatic(true);
    await vi.waitFor(() => expect(current.getSnapshot().status).toBe('not_configured'));
    expect(current.getSnapshot().fields.product.origin).toBe('article'); expect(current.getSnapshot().values.industry).toBe('');
    current.setField('product', 'Manual brand'); await current.identify();
    expect(current.getSnapshot().values.product).toBe('Manual brand');
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(0); stop();
  });

  it('discards malformed or stale model identity without clearing manual values or leaking upstream errors', async () => {
    const api = wire(async path => path.includes('/context?') ? ready() : identified(context('version-b')));
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    current.setField('product', 'My value'); await current.identify();
    expect(current.getSnapshot().status).toBe('failed'); expect(current.getSnapshot().values.product).toBe('My value');
    expect(current.getSnapshot().message).toBe('识别失败，已保留填写内容，可重试。'); stop();
  });

  it('marks persistence unavailable when browser storage rejects writes', async () => {
    const storage = memoryStorage(); storage.setItem = () => { throw new Error('quota'); };
    const api = wire(async () => ready());
    const current = new ArticleIdentificationStore(api.transport, () => storage).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    current.setField('product', 'Unsaved manual value');
    expect(current.getSnapshot().hasManualChanges).toBe(true); expect(current.getSnapshot().persisted).toBe(false); stop();
  });

  it('isolates manual requirements of different tasks using the same frozen article', async () => {
    const api = wire(async path => path.includes('/context?') ? ready() : identified());
    const store = new ArticleIdentificationStore(api.transport, () => null);
    const a = store.route({ ...route, formScope: 'task-a' }); const stopA = a.mount();
    await vi.waitFor(() => expect(a.getSnapshot().status).toBe('ready'));
    a.hydrate(values('Saved task A'), 'task-a'); a.setField('product', 'Task A manual'); stopA();
    const b = store.route({ ...route, formScope: 'task-b' });
    expect(b.getSnapshot().values.product).toBe(''); const stopB = b.mount(); b.hydrate(values('Saved task B'), 'task-b');
    await vi.waitFor(() => expect(b.getSnapshot().values.product).toBe('Saved task B'));
    b.setAutomatic(true); await vi.waitFor(() => expect(b.getSnapshot().status).toBe('partial'));
    expect(b.getSnapshot().values.product).toBe('Saved task B'); stopB();
    const stopAgain = a.mount(); await vi.waitFor(() => expect(a.getSnapshot().values.product).toBe('Task A manual')); stopAgain();
  });

  it('adopts a newly saved task without losing manual clears or duplicating its pending request', async () => {
    const model = deferred<IdentifyArticleResponse>();
    const api = wire(async path => path.includes('/context?') ? ready() : model.promise);
    const store = new ArticleIdentificationStore(api.transport, () => null), original = store.route({ ...route, formScope: 'new' });
    const stopOriginal = original.mount(); original.setAutomatic(true);
    await vi.waitFor(() => expect(original.getSnapshot().status).toBe('identifying'));
    original.setField('product', ''); original.adoptFormScope('created-task'); stopOriginal();
    const saved = store.route({ ...route, formScope: 'created-task' }); const stopSaved = saved.mount(); saved.setAutomatic(true);
    await vi.waitFor(() => expect(saved.getSnapshot().status).toBe('identifying'));
    saved.setField('questions', 'Entered after saving'); model.resolve(identified());
    await vi.waitFor(() => expect(saved.getSnapshot().status).toBe('partial'));
    expect(saved.getSnapshot().values).toMatchObject({ product: '', questions: 'Entered after saving' });
    expect(saved.getSnapshot().fields.product.suggestion?.value).toBe('Suggested product');
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(1); stopSaved();
  });

  it('preserves manual same-article input while invalidating the old connection result', async () => {
    let revision = 'connection-1';
    const api = wire(async path => path.includes('/context?') ? ready(context('version-a', 'user-project-a', revision)) : identified(context('version-a', 'user-project-a', revision)));
    const store = new ArticleIdentificationStore(api.transport, () => null), original = store.route(route);
    const stop = original.mount(); original.setAutomatic(true);
    await vi.waitFor(() => expect(original.getSnapshot().status).toBe('partial'));
    original.setField('product', 'Keep manual brand'); stop(); revision = 'connection-2';
    const updated = store.route({ ...route, connectionEpoch: 1 }); const stopUpdated = updated.mount();
    await vi.waitFor(() => expect(updated.getSnapshot().status).toBe('ready'));
    expect(updated.getSnapshot().values.product).toBe('Keep manual brand'); expect(updated.getSnapshot().values.questions).toBe(''); stopUpdated();
  });

  it.each(['connection', 'digest'] as const)('refreshes context before retrying a stale %s and sends only one fresh POST', async kind => {
    let ctx = context(), postCount = 0;
    const api = wire(async path => {
      if (path.includes('/context?')) return ready(ctx);
      if (++postCount === 1) throw new Error(kind === 'connection' ? 'AI 连接已变化，请重新读取后识别。' : '稿件内容或标题已变化，请重新读取当前版本。');
      return identified(ctx, 'Fresh result');
    });
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); current.setAutomatic(true);
    await vi.waitFor(() => expect(current.getSnapshot().status).toBe('failed'));
    current.setField('product', 'Keep same-content manual value');
    ctx = kind === 'connection' ? context('version-a', 'user-project-a', 'connection-2') : { ...context(), contentDigest: 'updated-digest' };
    await current.retry();
    expect(current.getSnapshot().status).toBe('partial');
    expect(api.send.mock.calls.filter(([path]) => path.includes('/context?'))).toHaveLength(2);
    const posts = api.send.mock.calls.filter(([path]) => path === '/matrix/identify');
    expect(posts).toHaveLength(2);
    expect(posts[1]?.[2]).toMatchObject({ content_digest: ctx.contentDigest, connection_revision: ctx.connection.revision });
    if (kind === 'connection') expect(current.getSnapshot().values.product).toBe('Keep same-content manual value');
    else expect(current.getSnapshot().values.product).toBe('Fresh result');
    stop();
  });

  it.each([
    '稿件超出本次全文识别的 60,000 字符限制，尚未分析；请手动填写。',
    '当前冻结版本正文为空，请先确认稿件内容。',
    'AI 识别超时，请稍后重试；已填写内容会保留。',
    'AI 连接认证失败，请联系管理员或检查当前模型连接。',
    'AI 服务额度暂不可用，可先手动填写。',
    'AI 请求过于频繁，请稍后重试。',
  ])('shows the safe public reason without clearing manual values: %s', async message => {
    const api = wire(async path => { if (path.includes('/context?')) return ready(); throw new Error(message); });
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    current.setField('product', 'Manual product'); await current.identify();
    expect(current.getSnapshot().message).toBe(message);
    expect(current.getSnapshot().values.product).toBe('Manual product'); stop();
  });

  it('keeps fields through repeated authorization failures and never posts with the old context', async () => {
    let contextFails = false;
    const api = wire(async path => { if (path.includes('/context?')) { if (contextFails) throw new Error('需要已授权企业项目'); return ready(); } return identified(); });
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    current.setField('product', 'Manual product'); contextFails = true;
    await current.identify(); await current.retry();
    expect(current.getSnapshot().message).toBe('需要已授权企业项目');
    expect(current.getSnapshot().values.product).toBe('Manual product');
    expect(api.send.mock.calls.filter(([path]) => path === '/matrix/identify')).toHaveLength(0); stop();
  });

  it('never exposes an arbitrary provider response as the user-visible failure message', async () => {
    const api = wire(async path => { if (path.includes('/context?')) return ready(); throw new Error('provider raw payload must not render'); });
    const current = new ArticleIdentificationStore(api.transport, () => null).route(route);
    const stop = current.mount(); await vi.waitFor(() => expect(current.getSnapshot().status).toBe('ready'));
    await current.identify(); expect(current.getSnapshot().message).toBe('识别失败，已保留填写内容，可重试。'); stop();
  });
});
