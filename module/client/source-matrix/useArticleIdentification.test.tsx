// @vitest-environment jsdom
// Source-only integration cases; not executed in the Pro package workflow.
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useArticleIdentification, type UseArticleIdentificationOptions } from './useArticleIdentification';
import { ArticleIdentificationFieldInfo, ArticleIdentificationStatus } from './ArticleIdentificationFeedback';

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
function Harness(props: UseArticleIdentificationOptions) {
  const identification = useArticleIdentification(props);
  return <div className="fm-media"><label>品牌<input value={identification.values.product} onChange={event => identification.setField('product', event.target.value)}/></label>
    <ArticleIdentificationFieldInfo fieldKey="product" identification={identification}/><ArticleIdentificationStatus identification={identification}/></div>;
}
const options = (): UseArticleIdentificationOptions => ({ gateway: {}, workspace: 'project', articleVersionId: 'version-a', enabled: true, autoIdentify: true, connectionEpoch: 0 });
function context(version: string) { return { scopeKey: 'authenticated-scope', articleId: 'article-' + version, articleVersionId: version, versionNumber: 1, title: 'Synthetic article', contentDigest: 'digest-' + version, connection: { available: true, mode: 'environment', revision: 'revision' } }; }
const emptyFields = { product: { value: null, source: 'unidentified' }, industry: { value: null, source: 'unidentified' }, audience: { value: null, source: 'unidentified' }, questions: { value: null, source: 'unidentified' } };
it('renders a new route blank and preserves an intentional manual clear after recognition', async () => {
  let resolveModel!: (value: unknown) => void;
  const model = new Promise(resolve => { resolveModel = resolve; });
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.includes('/context?')) {
      const version = new URL(input, 'https://synthetic.invalid').searchParams.get('article_version_id')!;
      return { ok: true, json: async () => ({ status: 'ready', context: context(version), fields: emptyFields }) };
    }
    return { ok: true, json: async () => await model };
  });
  vi.stubGlobal('fetch', fetchMock);
  const props = options(); const view = render(<StrictMode><Harness {...props}/></StrictMode>);
  await screen.findByText('正在根据当前稿件识别…');
  fireEvent.change(screen.getByLabelText('品牌'), { target: { value: '' } });
  // Explicit edit followed by intentional clearing produces a manual ownership marker.
  fireEvent.change(screen.getByLabelText('品牌'), { target: { value: 'manual' } });
  fireEvent.change(screen.getByLabelText('品牌'), { target: { value: '' } });
  await act(async () => resolveModel({ status: 'partial', context: context('version-a'), fields: { ...emptyFields, product: { value: 'Suggestion A', source: 'inferred' } } }));
  expect((screen.getByLabelText('品牌') as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('button', { name: '采用建议' })).toBeNull();
  expect(screen.queryByText('AI 建议')).toBeNull();
  expect((screen.getByLabelText('品牌') as HTMLInputElement).value).toBe('');
  view.rerender(<StrictMode><Harness {...props} articleVersionId="version-b" autoIdentify={false}/></StrictMode>);
  expect((screen.getByLabelText('品牌') as HTMLInputElement).value).toBe('');
  await waitFor(() => expect(screen.getByRole('button', { name: '根据稿件识别' }).hasAttribute('disabled')).toBe(false));
  expect(fetchMock.mock.calls.filter(([path]) => path === '/api/modules/publish/matrix/identify')).toHaveLength(1);
});

it('does not read context or identify when disabled for independent/demo browsing', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  render(<Harness {...options()} enabled={false}/>);
  expect(screen.getByText('请先选择稿件，可继续手动填写。')).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('renders only allowlisted field reasons and keeps arbitrary provider reason text out of feedback', async () => {
  let reason = 'unsupported_product';
  vi.stubGlobal('fetch', vi.fn(async (input: string) => ({ ok: true, json: async () => input.includes('/context?')
    ? { status: 'ready', context: context('version-a'), fields: emptyFields }
    : { status: 'unidentified', context: context('version-a'), fields: { ...emptyFields, product: { value: null, source: 'unidentified', reason } } } })));
  render(<Harness {...options()}/>);
  await screen.findByText('请填写品牌或产品。');
  reason = 'provider raw payload must never render';
  fireEvent.click(screen.getByRole('button', { name: '重新识别' }));
  await waitFor(() => expect(screen.queryByText('请填写品牌或产品。')).toBeNull());
  expect(screen.queryByText(reason)).toBeNull();
});
