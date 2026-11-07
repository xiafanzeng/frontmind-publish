// @vitest-environment jsdom
// Source-only page integration regressions. Execute in the final merged workspace.
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SourceMatrixPage from './SourceMatrixPage';
import type { IdentificationContext, IdentificationContextResponse, IdentificationFields, IdentifyArticleResponse } from '../../shared/article-identification';
import type { MatrixResult } from './types';

const host = vi.hoisted(() => ({ gateway: {} as object }));
vi.mock('../PublishingContext', () => ({ usePublisherGateway: () => host.gateway }));
vi.mock('./industry/IndustryDistribution', () => ({ LiveIndustryDistribution: () => <div>真实行业分布</div> }));
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
function identified(ctx: IdentificationContext, suffix = ''): IdentifyArticleResponse {
  return { status: 'complete', context: ctx, fields: {
    product: { value: '识别品牌' + suffix, source: 'inferred' }, industry: { value: 'industry-a', source: 'inferred' },
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
}) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://synthetic.invalid');
    let body: unknown;
    if (url.pathname.endsWith('/matrix/identify/context')) body = await options.readContext(url.searchParams.get('article_version_id')!);
    else if (url.pathname.endsWith('/matrix/identify')) {
      if (!options.identify) throw new Error('Unexpected model request in this test');
      body = await options.identify();
    } else if (url.pathname.endsWith('/industries')) body = { industries: [{ id: 'industry-a', name: '真实行业' }] };
    else if (url.pathname.endsWith('/matrix/connection')) body = { connection: null, mode: 'environment', available: true };
    else if (url.pathname.includes('/classify/')) body = { task_id: 'task-a', state: 'complete', result: await options.readTask?.() };
    else if (url.pathname.includes('/matrix/imports')) body = { datasets: [] };
    else if (url.pathname.includes('/media-requirements')) body = { items: [] };
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
  expect(field('目标行业 *').value).toBe('industry-a'); expect(field('目标受众').value).toBe('采购团队');
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
