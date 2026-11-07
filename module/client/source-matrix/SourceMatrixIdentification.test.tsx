// @vitest-environment jsdom
// Source-only page integration regressions. Execute in the final merged workspace.
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SourceMatrixPage from './SourceMatrixPage';
import type { IdentificationContext, IdentificationContextResponse, IdentificationFields, IdentifyArticleResponse } from '../../shared/article-identification';
import type { MatrixResult, TaskResponse } from './types';
import { flattenIndustryCatalog, type IndustryCatalogResponse } from '../../shared/industry-catalog';

const host = vi.hoisted(() => ({ gateway: {} as object }));
vi.mock('../PublishingContext', () => ({ usePublisherGateway: () => host.gateway }));
// Keep the real distribution component/store: these cases exercise the page's
// recognition bridge and its coordination with the first billed query group.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

function gateway() {
  return {
    getArticleVersion: vi.fn(async (id: string) => ({ id, version: id === 'historical-version' ? 2 : 5, hash: 'hash-' + id, containsImages: false, frozen: true, createdAt: '2026-10-24T00:00:00Z', createdBy: 'Synthetic account' })),
    getDraft: vi.fn(), createDraft: vi.fn(), updateDraftMedia: vi.fn(),
    listMedia: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 100, catalog: { activeRevision: 'catalog-1' } })),
    listArticles: vi.fn(async () => []), getArticle: vi.fn(),
  };
}
beforeEach(() => { host.gateway = gateway(); vi.stubGlobal('crypto', webcrypto); sessionStorage.clear(); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const emptyFields = (): IdentificationFields => ({ product: { value: null, source: 'unidentified' }, industry: { value: null, source: 'unidentified' }, audience: { value: null, source: 'unidentified' }, questions: { value: null, source: 'unidentified' } });
function context(versionId = 'version-a', account = 'account-a', available = true): IdentificationContext {
  return { scopeKey: account + ':project-a', articleId: versionId === 'version-b' ? 'article-b' : 'article-a', articleVersionId: versionId, versionNumber: versionId === 'historical-version' ? 2 : 5, title: versionId === 'historical-version' ? '历史确认稿件' : '真实选中稿件', contentDigest: 'digest-' + versionId, connection: { available, mode: 'environment', revision: 'connection-1' } };
}
function contextResponse(ctx: IdentificationContext): IdentificationContextResponse { return { status: ctx.connection.available ? 'ready' : 'not_configured', context: ctx, fields: emptyFields() }; }
function canonicalCatalog(): IndustryCatalogResponse {
  const industryTree = [{ id: 'node-101', scopeId: '101', scopeType: 'CATEGORY' as const, label: '技术服务', children: [
    { id: 'node-102', scopeId: '102', scopeType: 'CATEGORY' as const, label: '医疗科技', children: [] },
    { id: 'node-103', scopeId: '103', scopeType: 'CATEGORY' as const, label: '工业软件', children: [] },
  ] }];
  return { status: 'configured', industries: flattenIndustryCatalog(industryTree), catalogVersion: 'canonical-catalog-1',
    filters: { models: [{ value: 'all', label: '全部模型' }], industryTree, minDate: '2026-10-01', maxDate: '2026-10-31', sourceTypes: ['新闻资讯'] },
    legacyMappings: [{ localId: 'legacy-health', localName: '医疗科技', canonicalId: '102', status: 'mapped', via: 'explicit' }], brand_data_batches: [] };
}
function identified(ctx: IdentificationContext, suffix = ''): IdentifyArticleResponse {
  return { status: 'complete', context: ctx, fields: {
    product: { value: '识别品牌' + suffix, source: 'inferred' }, industry: { value: '102', canonicalId: '102', source: 'inferred' },
    audience: { value: '采购团队' + suffix, source: 'inferred' }, questions: { value: '如何选型' + suffix + '\n如何落地', source: 'inferred' },
  } };
}
function matrixResult(product: string, boundVersion = 'version-a', candidateName?: string): MatrixResult {
  return { status: 'complete', plan_id: 'plan-1', plan_version: 'plan-version-1', matrix_version: 'matrix-version-1', as_of: '2026-10-24T00:00:00Z',
    scope: { task: { product, audience: '保存的受众', questions: [{ text: '保存的问题' }], binding: { article_id: boundVersion === 'version-b' ? 'article-b' : 'article-a', article_version_id: boundVersion, draft_id: null, version_number: 5, content_hash: 'hash-' + boundVersion, article_title: 'Synthetic saved article', fingerprint: 'binding-fingerprint' } }, evidence_scope: {} },
    matrix: { status: 'complete', candidates: candidateName ? [{ candidate_id: 'candidate-1', resource_id: null, attributes: { source_name: candidateName }, offers: [], primary_role: 'industry', auxiliary_roles: [], selection: 'recommended', matched_questions: [], reason_summary: 'Synthetic saved result', channel_status: 'eligible', manuscript_status: 'compatible', hard_failures: [], pending_conditions: [], evidence_relation: '', evidence_ids: [], aggregate_ids: [] }] : [], layers: [{ role: 'industry', display_name: '行业核心', status: candidateName ? 'populated' : 'empty', candidate_ids: candidateName ? ['candidate-1'] : [], auxiliary_candidate_ids: [] }], fit_order: candidateName ? ['candidate-1'] : [] },
    source_analysis: { status: 'complete', known_detail_count: 0, total_citations: 0, groups: [], actual_sources: [], domain_rollups: [], detail_citations: [], external_aggregates: [], supplier_claims: [], unknown_records: [], content_age: null },
    budget_plans: [], limitations: [], warnings: [], errors: [], minimum_known_cost: null };
}
function installApi(options: {
  readContext: (versionId: string) => IdentificationContextResponse | Promise<IdentificationContextResponse>;
  identify?: () => IdentifyArticleResponse | Promise<IdentifyArticleResponse>;
  readTask?: () => MatrixResult | Promise<MatrixResult>;
  readCatalog?: () => IndustryCatalogResponse | Promise<IndustryCatalogResponse>;
  taskResponse?: () => TaskResponse | Promise<TaskResponse>;
  generate?: () => unknown | Promise<unknown>;
}) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://synthetic.invalid');
    let body: unknown;
    if (url.pathname.endsWith('/matrix/identify/context')) body = await options.readContext(url.searchParams.get('article_version_id')!);
    else if (url.pathname.endsWith('/matrix/identify')) {
      if (!options.identify) throw new Error('Unexpected model request in this test');
      body = await options.identify();
    } else if (url.pathname.endsWith('/industries')) body = await (options.readCatalog?.() ?? canonicalCatalog());
    else if (url.pathname.endsWith('/matrix/connection')) body = { connection: null, mode: 'environment', available: true };
    else if (url.pathname.endsWith('/matrix/generate')) body = await options.generate?.();
    else if (url.pathname.includes('/classify/')) body = options.taskResponse ? await options.taskResponse() : { task_id: 'task-a', state: 'complete', result: await options.readTask?.() };
    else if (url.pathname.includes('/matrix/imports')) body = { datasets: [] };
    else if (url.pathname.includes('/media-requirements')) body = { items: [] };
    else if (url.pathname.includes('/source-ranking/')) body = { status: 'ok', source: 'molizhishu-public-industry', fetchedAt: '2026-11-07T00:00:00Z', data: url.pathname.endsWith('/distributions')
      ? { sourceTypeDistribution: [], publishTimeDistribution: [] }
      : { items: [], pageSize: url.pathname.endsWith('/media-ranking') ? 50 : 20, total: '0', totalCitations: '0', snapshotToken: 'page-' + url.pathname, nextCursor: null, expiresAt: String(Date.now() + 600_000) } };
    else throw new Error('Unexpected fixture route: ' + url.pathname);
    return { ok: true, json: async () => body };
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
function open(query: string) {
  window.history.replaceState({}, '', '/publishing/source-matrix?' + query);
  return render(<div className="monitoring-module"><SourceMatrixPage view="matrix"/></div>);
}
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

it('fills the four real article fields and preserves manual typing and clearing during re-identification', async () => {
  const ctx = context(), second = deferred<IdentifyArticleResponse>(); let requests = 0;
  const fetcher = installApi({ readContext: () => contextResponse(ctx), identify: () => ++requests === 1 ? identified(ctx) : second.promise });
  open('tab=matrix&articleVersion=version-a');
  await waitFor(() => expect(field('品牌 / 产品').value).toBe('识别品牌'));
  expect(field('目标行业 *').value).toBe('102'); expect(field('目标受众').value).toBe('采购团队');
  expect(field('目标问题 / 内容需求 *').value).toBe('如何选型\n如何落地');
  expect(field('覆盖地区').value).toBe(''); expect(field('期望发布时效（小时）').value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '重新识别' }));
  await screen.findByRole('button', { name: '识别中…' });
  fireEvent.change(field('品牌 / 产品'), { target: { value: '人工品牌' } });
  fireEvent.change(field('目标问题 / 内容需求 *'), { target: { value: '' } });
  await act(async () => second.resolve(identified(ctx, '第二次')));
  await waitFor(() => expect(field('目标受众').value).toBe('采购团队第二次'));
  expect(field('品牌 / 产品').value).toBe('人工品牌'); expect(field('目标问题 / 内容需求 *').value).toBe('');
  expect(screen.getAllByRole('button', { name: '采用建议' })).toHaveLength(2);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/matrix/identify'))).toHaveLength(2);
  expect((host.gateway as ReturnType<typeof gateway>).createDraft).not.toHaveBeenCalled();
});

it('carries the verified parent article and historical version in the real media-library entry', async () => {
  const ctx = context('historical-version', 'account-a', false);
  installApi({ readContext: () => contextResponse(ctx) });
  open('tab=matrix&articleVersion=historical-version&enterpriseProjectId=project-a&operatorOwnerId=owner-a&workbenchTask=workbench-a#recommendation');
  expect(new URLSearchParams(window.location.search).has('articleId')).toBe(false);
  await waitFor(() => expect(new URL((screen.getByRole('link', { name: '进入媒体库自选' }) as HTMLAnchorElement).href).searchParams.get('articleId')).toBe('article-a'));
  const target = new URL((screen.getByRole('link', { name: '进入媒体库自选' }) as HTMLAnchorElement).href);
  expect(target.pathname).toBe('/publishing/media/third');
  expect(Object.fromEntries(target.searchParams)).toMatchObject({ articleId: 'article-a', articleVersion: 'historical-version', enterpriseProjectId: 'project-a', operatorOwnerId: 'owner-a', workbenchTask: 'workbench-a', tab: 'matrix' });
  expect(target.hash).toBe('#recommendation');
  expect((host.gateway as ReturnType<typeof gateway>).getArticleVersion).toHaveBeenCalledWith('historical-version', expect.any(AbortSignal));
  expect((host.gateway as ReturnType<typeof gateway>).createDraft).not.toHaveBeenCalled();
});

it('does not hydrate task A requirements into a separately selected article B', async () => {
  installApi({ readContext: version => contextResponse(context(version, 'account-a', false)), readTask: () => matrixResult('属于稿件 A 的品牌') });
  open('tab=matrix&task=task-a&articleVersion=version-b');
  await screen.findByText('已保存矩阵与当前稿件或版本不一致。已保留当前输入，请重新生成矩阵。');
  expect(field('品牌 / 产品').value).toBe(''); expect(field('目标受众').value).toBe(''); expect(field('目标问题 / 内容需求 *').value).toBe('');
  expect(screen.queryByDisplayValue('属于稿件 A 的品牌')).toBeNull();
  expect((host.gateway as ReturnType<typeof gateway>).createDraft).not.toHaveBeenCalled();
});

it('masks the old gateway task and fields before the replacement account context resolves', async () => {
  let account = 'account-a'; const nextContext = deferred<IdentificationContextResponse>(), nextTask = deferred<MatrixResult>();
  installApi({ readContext: version => account === 'account-a' ? contextResponse(context(version, account, false)) : nextContext.promise,
    readTask: () => account === 'account-a' ? matrixResult('旧账号保存品牌', 'version-a', '旧账号矩阵媒体') : nextTask.promise });
  const view = open('tab=matrix&task=task-a&articleVersion=version-a');
  await waitFor(() => expect(field('品牌 / 产品').value).toBe('旧账号保存品牌'));
  expect(screen.getByRole('heading', { name: '旧账号矩阵媒体' })).toBeTruthy();
  account = 'account-b'; host.gateway = gateway();
  view.rerender(<div className="monitoring-module"><SourceMatrixPage view="matrix"/></div>);
  expect(field('品牌 / 产品').value).toBe(''); expect(screen.queryByRole('heading', { name: '旧账号矩阵媒体' })).toBeNull();
  await act(async () => { nextContext.resolve(contextResponse(context('version-a', account, false))); nextTask.resolve(matrixResult('新账号保存品牌')); });
  await waitFor(() => expect(field('品牌 / 产品').value).toBe('新账号保存品牌'));
  expect(screen.queryByDisplayValue('旧账号保存品牌')).toBeNull();
});

const modelCalls = (fetcher: ReturnType<typeof installApi>) => fetcher.mock.calls.filter(([url]) => String(url).endsWith('/matrix/identify'));
const distributionCalls = (fetcher: ReturnType<typeof installApi>) => fetcher.mock.calls.filter(([url]) => /\/source-ranking\/(media-ranking|contents|distributions)(\?|$)/.test(String(url)));
const canonicalChoices = (select: HTMLSelectElement) => [...select.options].filter(option => ['101', '102', '103'].includes(option.value)).map(option => ({ id: option.value, label: option.textContent }));

it('identifies on first entry to analysis, makes one category query group and shares every canonical option across tabs', async () => {
  const ctx = context(), model = deferred<IdentifyArticleResponse>();
  const fetcher = installApi({ readContext: () => contextResponse(ctx), identify: () => model.promise });
  open('tab=analysis&articleVersion=version-a');
  await screen.findByRole('option', { name: '医疗科技' }); await screen.findByRole('button', { name: '识别中…' });
  const distributionSelect = screen.getByRole('combobox', { name: '行业' }) as HTMLSelectElement;
  expect(distributionSelect.value).toBe('__pending__'); expect(distributionCalls(fetcher)).toHaveLength(0);
  const distributionOptions = canonicalChoices(distributionSelect);
  expect(distributionOptions).toEqual(canonicalCatalog().industries.map(item => ({ id: item.id, label: item.label })));
  expect(screen.queryByRole('option', { name: '软件测试' })).toBeNull();
  await act(async () => model.resolve(identified(ctx)));
  await waitFor(() => expect(distributionCalls(fetcher)).toHaveLength(3));
  expect((screen.getByRole('combobox', { name: '行业' }) as HTMLSelectElement).value).toBe('102');
  expect(distributionCalls(fetcher).every(([url]) => { const params = new URL(String(url), location.origin).searchParams; return params.get('scopeType') === 'CATEGORY' && params.get('scopeId') === '102'; })).toBe(true);
  fireEvent.click(screen.getByRole('link', { name: '信源矩阵推荐' }));
  await waitFor(() => expect(field('品牌 / 产品').value).toBe('识别品牌'));
  expect(field('目标行业 *').value).toBe('102');
  expect(canonicalChoices(field('目标行业 *') as HTMLSelectElement)).toEqual(distributionOptions);
  fireEvent.click(screen.getByRole('link', { name: '行业信源分布' }));
  await waitFor(() => expect((screen.getByRole('combobox', { name: '行业' }) as HTMLSelectElement).value).toBe('102'));
  expect(modelCalls(fetcher)).toHaveLength(1); expect(distributionCalls(fetcher)).toHaveLength(3);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/industries'))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/source-ranking/filters'))).toHaveLength(0);
});

it('fills the other three fields of a legacy questions-only saved task without overwriting the saved question', async () => {
  const ctx = context(), result = matrixResult('');
  result.scope.task = { binding: result.scope.task.binding ?? null, questions: [{ text: '旧任务已保存的问题' }] };
  const fetcher = installApi({ readContext: () => contextResponse(ctx), identify: () => identified(ctx), readTask: () => result });
  open('tab=matrix&task=task-a&articleVersion=version-a');
  await waitFor(() => expect(field('品牌 / 产品').value).toBe('识别品牌'));
  expect(field('目标受众').value).toBe('采购团队'); expect(field('目标行业 *').value).toBe('102');
  expect(field('目标问题 / 内容需求 *').value).toBe('旧任务已保存的问题');
  expect(screen.getByText('已保存要求')).toBeTruthy();
  expect(screen.getByRole('button', { name: '采用建议' })).toBeTruthy();
  expect(modelCalls(fetcher)).toHaveLength(1);
  expect((host.gateway as ReturnType<typeof gateway>).createDraft).not.toHaveBeenCalled();
});

it('resolves a saved industry after the catalog arrives without resetting other fields or repeating identification', async () => {
  const ctx = context(), catalog = deferred<IndustryCatalogResponse>(), result = matrixResult('');
  result.scope.task = { binding: result.scope.task.binding ?? null, industry_id: 'legacy-health', industry: '医疗科技', questions: [{ text: '旧任务已保存的问题' }] };
  const response = identified(ctx); response.status = 'partial'; response.fields.industry = { value: null, source: 'unidentified', candidate: '医疗科技', reason: 'catalog_unavailable' };
  const fetcher = installApi({ readContext: () => contextResponse(ctx), identify: () => response, readTask: () => result, readCatalog: () => catalog.promise });
  open('tab=matrix&task=task-a&articleVersion=version-a');
  await waitFor(() => expect(field('品牌 / 产品').value).toBe('识别品牌'));
  expect(field('目标行业 *').value).toBe('');
  fireEvent.change(field('品牌 / 产品'), { target: { value: '人工确认品牌' } });
  fireEvent.change(field('覆盖地区'), { target: { value: '深圳' } });
  await act(async () => catalog.resolve(canonicalCatalog()));
  await waitFor(() => expect(field('目标行业 *').value).toBe('102'));
  expect(field('品牌 / 产品').value).toBe('人工确认品牌'); expect(field('目标受众').value).toBe('采购团队');
  expect(field('目标问题 / 内容需求 *').value).toBe('旧任务已保存的问题'); expect(field('覆盖地区').value).toBe('深圳');
  expect(modelCalls(fetcher)).toHaveLength(1);
  fireEvent.click(screen.getByRole('link', { name: '行业信源分布' }));
  await waitFor(() => expect(distributionCalls(fetcher)).toHaveLength(3));
  expect(distributionCalls(fetcher).every(([url]) => new URL(String(url), location.origin).searchParams.get('scopeId') === '102')).toBe(true);
  expect(modelCalls(fetcher)).toHaveLength(1);
});

it('preserves an explicit recommendation industry clear while the analysis tab reuses the genuine recognition', async () => {
  const ctx = context(), fetcher = installApi({ readContext: () => contextResponse(ctx), identify: () => identified(ctx) });
  open('tab=matrix&articleVersion=version-a');
  await waitFor(() => expect(field('目标行业 *').value).toBe('102'));
  fireEvent.change(field('目标行业 *'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('link', { name: '行业信源分布' }));
  await waitFor(() => expect((screen.getByRole('combobox', { name: '行业' }) as HTMLSelectElement).value).toBe('102'));
  expect(distributionCalls(fetcher)).toHaveLength(3);
  fireEvent.click(screen.getByRole('link', { name: '信源矩阵推荐' }));
  await waitFor(() => expect(field('目标行业 *').value).toBe(''));
  expect(modelCalls(fetcher)).toHaveLength(1);
});

it('hydrates a cancelled task projection with no result and still recognizes its missing requirements', async () => {
  const ctx = context(), saved = matrixResult('');
  const fetcher = installApi({ readContext: () => contextResponse(ctx), identify: () => identified(ctx), taskResponse: () => ({
    task_id: 'task-a', state: 'cancelled', result: null,
    task: { binding: saved.scope.task.binding ?? null, questions: [{ text: '取消任务仍保留的内容需求' }] },
  }) });
  open('tab=matrix&task=task-a&articleVersion=version-a');
  await waitFor(() => expect(field('品牌 / 产品').value).toBe('识别品牌'));
  expect(field('目标受众').value).toBe('采购团队'); expect(field('目标行业 *').value).toBe('102');
  expect(field('目标问题 / 内容需求 *').value).toBe('取消任务仍保留的内容需求');
  expect(screen.getByText('等待生成矩阵')).toBeTruthy(); expect(modelCalls(fetcher)).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => /\/(matrix\/generate|budget)$/.test(String(url)))).toBe(false);
});

it('waits for verified article context after adopting a new task before comparing transferred form fields', async () => {
 const ctx=context(),nextContext=deferred<IdentificationContextResponse>();let contexts=0;
 const fetcher=installApi({readContext:()=>++contexts===1?contextResponse(ctx):nextContext.promise,identify:()=>identified(ctx),
  readCatalog:()=>canonicalCatalog(),generate:()=>({state:'running',task_id:'task-a'}),readTask:()=>matrixResult('识别品牌','version-a','新任务矩阵媒体')});
 open('tab=matrix&articleVersion=version-a');
 await waitFor(()=>expect(field('品牌 / 产品').value).toBe('识别品牌'));
 fireEvent.change(field('总预算（CNY）'),{target:{value:''}});
 fireEvent.click(screen.getByRole('button',{name:'生成推荐矩阵'}));
 await waitFor(()=>expect(contexts).toBeGreaterThan(1));
 await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).includes('/classify/task-a'))).toBe(true));
 expect(screen.queryByText(/行业范围或稿件已变化，先前生成结果未应用/)).toBeNull();
 expect(screen.queryByRole('heading',{name:'新任务矩阵媒体'})).toBeNull();
 await act(async()=>nextContext.resolve(contextResponse(ctx)));
 expect(await screen.findByRole('heading',{name:'新任务矩阵媒体'},{timeout:4000})).toBeTruthy();
 expect(field('品牌 / 产品').value).toBe('识别品牌');
 expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/classify/task-a')).length).toBeGreaterThan(1);
 expect(screen.queryByText(/先前生成结果未应用/)).toBeNull();
 expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/budget'))).toHaveLength(0);
});
