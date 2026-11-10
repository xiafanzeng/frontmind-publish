// @vitest-environment jsdom
// Regression sources only; execution belongs to the final ZCode merge.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArticleIdentificationFieldInfo } from './ArticleIdentificationFeedback';
import { emptyIdentificationSnapshot } from './article-identification-store';
import type { ArticleIdentification } from './useArticleIdentification';

afterEach(cleanup);
function identified(): ArticleIdentification {
  return { ...emptyIdentificationSnapshot, status: 'partial',
    fields: { ...emptyIdentificationSnapshot.fields, product: { value: 'Article brand', origin: 'article', edited: false, evidence: 'Private original excerpt', reason: 'evidence_not_verbatim' },
      audience: { value: 'Suggested audience', origin: 'inferred', edited: false, evidence: 'Another private excerpt' },
      industry: { value: '', origin: 'unidentified', edited: false, candidate: 'Untrusted free text', reason: 'ambiguous_industry', suggestions: [{ id: '1', name: 'Stale model name' }, { id: '2', name: 'Model name 2' }, { id: '1', name: 'Duplicate' }, { id: 'invalid', name: 'Invalid' }] } },
    setField: vi.fn(), hydrate: vi.fn(), setIndustryCatalog: vi.fn(), remapIndustry: vi.fn(), identify: vi.fn(async () => {}), retry: vi.fn(async () => {}), adopt: vi.fn(), adoptIndustry: vi.fn(() => true), adoptFormScope: vi.fn(),
  };
}
const catalog = { loading: false, options: [{ id: '1', name: '真实目录行业一' }, { id: '2', name: '需要自然换行的真实目录长行业名称' }], retry: vi.fn() };
it('renders no provenance label for extracted and inferred fields while hiding all excerpts and ordinary reasons', () => {
  const identification = identified();
  const { container } = render(<><ArticleIdentificationFieldInfo fieldKey="product" identification={identification}/><ArticleIdentificationFieldInfo fieldKey="audience" identification={identification}/></>);
  expect(container.textContent).toBe('');
  identification.fields.product = { value: 'Historical value', origin: 'saved', edited: false };
  const other = render(<ArticleIdentificationFieldInfo fieldKey="product" identification={identification}/>); expect(other.container.textContent).toBe('');
});
it('shows current official names and adopts with one non-submit native button activation', () => {
  const identification = identified(), submit = vi.fn(), adopted = vi.fn();
  render(<form onSubmit={event => { event.preventDefault(); submit(); }}><ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={catalog} onIndustryAdopted={adopted}/></form>);
  expect(screen.getByText('未识别')).toBeTruthy(); expect(screen.queryByText('Untrusted free text')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  const choice = screen.getByRole('button', { name: '真实目录行业一' }) as HTMLButtonElement;
  expect(choice.type).toBe('button'); choice.focus(); expect(document.activeElement).toBe(choice);
  fireEvent.click(choice); expect(identification.adoptIndustry).toHaveBeenCalledWith('1'); expect(adopted).toHaveBeenCalledTimes(1); expect(submit).not.toHaveBeenCalled();
  expect(identification.identify).not.toHaveBeenCalled(); expect(screen.queryByText('采用建议')).toBeNull();
});
it('separates loading and service failure from genuine no-suggestion identification', () => {
  const identification = identified();
  const view = render(<ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={{ ...catalog, loading: true }}/>);
  expect(screen.getByText('正在读取行业…')).toBeTruthy(); expect(screen.queryByText('未识别')).toBeNull();
  view.rerender(<ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={{ ...catalog, error: true }}/>);
  expect(screen.queryByText('未识别')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '重试读取行业' })); expect(catalog.retry).toHaveBeenCalled();
  identification.fields.industry.suggestions = [];
  view.rerender(<ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={catalog}/>);
  expect(screen.getByText('未识别')).toBeTruthy(); expect(screen.getByText('请手动选择行业。')).toBeTruthy(); expect(screen.queryByRole('button')).toBeNull();
});
it('hides unresolved options for a valid manual or adopted industry without any provenance label', () => {
  const identification = identified(); identification.fields.industry = { value: '1', origin: 'inferred', edited: true };
  const view = render(<ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={catalog}/>);
  expect(view.container.textContent).toBe(''); expect(screen.queryByText('未识别')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
  identification.fields.industry = { value: '1', origin: 'manual', edited: true };
  view.rerender(<ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={catalog}/>); expect(view.container.textContent).toBe('');
});

it('treats server-side catalog unavailability as a recoverable failure even when the page directory is healthy', () => {
  const identification = identified(), submit = vi.fn(), pageRetry = vi.fn();
  identification.fields.industry.reason = 'catalog_unavailable';
  const currentCatalog = { ...catalog, retry: pageRetry };
  const view = render(<form onSubmit={event => { event.preventDefault(); submit(); }}><ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={currentCatalog}/></form>);
  expect(screen.getByText('行业目录暂不可用。')).toBeTruthy(); expect(screen.queryByText('未识别')).toBeNull();
  expect(screen.queryByRole('button', { name: '真实目录行业一' })).toBeNull();
  const retry = screen.getByRole('button', { name: '重试识别行业' }) as HTMLButtonElement;
  expect(retry.type).toBe('button'); fireEvent.click(retry);
  expect(identification.retry).toHaveBeenCalledTimes(1); expect(pageRetry).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  expect(identification.setField).not.toHaveBeenCalled(); expect(identification.adoptIndustry).not.toHaveBeenCalled();
  identification.fields.industry.reason = 'ambiguous_industry';
  view.rerender(<ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={currentCatalog}/>);
  expect(screen.queryByText('行业目录暂不可用。')).toBeNull(); expect(screen.getByText('未识别')).toBeTruthy();
  expect(screen.getByRole('button', { name: '真实目录行业一' })).toBeTruthy();
});
it.each(['manual', 'saved'] as const)('preserves a valid %s industry when an identification result reports catalog unavailability', origin => {
  const identification = identified();
  identification.fields.industry = { value: '1', origin, edited: origin === 'manual', saved: origin === 'saved', reason: 'catalog_unavailable' };
  const view = render(<ArticleIdentificationFieldInfo fieldKey="industry" identification={identification} industryCatalog={catalog}/>);
  expect(view.container.textContent).toBe(''); expect(screen.queryByText('未识别')).toBeNull();
  expect(screen.queryByRole('button', { name: '重试识别行业' })).toBeNull();
  expect(identification.fields.industry.value).toBe('1'); expect(identification.retry).not.toHaveBeenCalled(); expect(identification.setField).not.toHaveBeenCalled();
});
