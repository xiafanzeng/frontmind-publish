// @vitest-environment jsdom
// Regression source only. Not executed in this source-only delivery.
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishingGatewayProvider } from '../../PublishingContext';
import type { PublisherGateway } from '../../gateway';
import { LiveIndustryDistribution } from './IndustryDistribution';
import { downloadCitationCsv } from './industry-source-export';

// Keep the real collector, CSV serializer, client, store and dialog. Only suppress the browser download.
vi.mock('./industry-source-export', async importOriginal => {
  const actual = await importOriginal<typeof import('./industry-source-export')>();
  return { ...actual, downloadCitationCsv: vi.fn() };
});

beforeEach(() => { window.history.replaceState({}, '', '/publishing/source-matrix?task=task-9&draftId=draft-7#analysis'); vi.mocked(downloadCitationCsv).mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const filters = { models: [{ value: 'all', label: '全部模型' }], industryTree: [], sourceTypes: ['新闻资讯'], minDate: null, maxDate: '2026-10-29' };
const success = (data: unknown) => ({ status: 'ok', source: 'molizhishu-public-industry', fetchedAt: '2026-11-06T12:00:00Z', data });
const listPage = (media: boolean, overrides: Record<string, unknown> = {}) => ({
  items: media ? [{ code: 'media-code-1', name: '原始媒体', citationCount: '10' }] : [{ sequence: '1', linkId: 'link-1', title: '真实来源标题', url: null, icon: null, media: '原始媒体', sourceType: '新闻资讯', publishTime: null, citationCount: '6', citationRatio: '60.00' }],
  pageSize: media ? 10 : 20, total: '1', totalCitations: '10', snapshotToken: media ? 'media-session' : 'content-session', nextCursor: null, expiresAt: String(Date.now() + 600_000), ...overrides,
});
function installFetch(options: { noDate?: boolean; configuration?: boolean; response?: (url: URL) => unknown | Promise<unknown> } = {}) {
  const fetcher = vi.fn(async (input: string) => {
    let value: unknown = await options.response?.(new URL(input, window.location.origin));
    if (value !== undefined) { /* A controlled server response for this request. */ }
    else if (options.configuration) value = { status: 'configuration_required', message: '行业信源连接尚未配置。', httpStatus: 503, retryable: false };
    else if (input.includes('/filters')) value = success({ ...filters, maxDate: options.noDate ? null : filters.maxDate });
    else if (input.includes('/distributions')) value = success({ sourceTypeDistribution: [{ code: '新闻资讯', name: '新闻资讯', citationCount: '3' }], publishTimeDistribution: [{ code: 'ONE_DAY', name: '1天内', contentCount: '2' }] });
    else {
      const media = input.includes('/media-ranking');
      value = success(listPage(media));
    }
    const result = value as { status: string; httpStatus?: number };
    return { ok: result.status === 'ok', status: result.httpStatus ?? 200, json: async () => value };
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
function mount(gateway = {} as PublisherGateway) {
  return render(<StrictMode><PublishingGatewayProvider gateway={gateway}><div className="fm-media"><LiveIndustryDistribution/></div></PublishingGatewayProvider></StrictMode>);
}
describe('live industry API boundary', () => {
  it('uses four real module routes once, preserves context, and displays percent text once', async () => {
    const fetcher = installFetch(); const gateway = {} as PublisherGateway;
    const view = mount(gateway);
    await screen.findByText('真实来源标题');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(screen.getByText('60.00%')).toBeTruthy(); expect(screen.queryByText('6000.00%')).toBeNull();
    expect(window.location.search).toContain('task=task-9'); expect(window.location.search).toContain('draftId=draft-7'); expect(window.location.hash).toBe('#analysis');
    expect(window.location.search).not.toMatch(/snapshotToken|cursor|requestId/);
    expect(screen.getByRole('heading', { name: '信源分布' })).toBeTruthy(); expect(screen.getAllByRole('img')).toHaveLength(2);
    view.unmount(); mount(gateway); await screen.findByText('真实来源标题'); expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('never falls back to imported workbook data when not configured', async () => {
    const fetcher = installFetch({ configuration: true }); mount();
    await screen.findByText('行业信源连接尚未配置。');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(screen.queryByText('502')).toBeNull(); expect(screen.queryByText('一航软件样本')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull(); expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.queryByLabelText('信源类型')).toBeNull(); expect(screen.queryByRole('button', { name: '重新加载' })).toBeNull();
    expect((screen.getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps all panels but sends no charged queries if no date exists', async () => {
    const fetcher = installFetch({ noDate: true }); mount();
    await screen.findByText('当前尚无可选执行日期，暂不查询行业数据。');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(screen.queryByText('0.00%')).toBeNull();
    expect((screen.getByRole('button', { name: '查询' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not send queries while the common form is being edited', async () => {
    const fetcher = installFetch(); mount(); await screen.findByText('真实来源标题');
    fireEvent.change(screen.getByLabelText('日期范围'), { target: { value: 'DAY' } });
    fireEvent.change(screen.getByLabelText('执行日期（北京时间）'), { target: { value: '2026-10-28' } });
    expect(fetcher).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(7));
    expect(fetcher.mock.calls.some(([url]) => url.includes('date=2026-10-28') && url.includes('periodType=DAY'))).toBe(true);
  });
});

describe('citation source states and recovery', () => {
  it('keeps unknown counts and hides data controls until the initial lists settle', async () => {
    let releaseMedia!: (value: unknown) => void;
    let releaseContents!: (value: unknown) => void;
    const pendingMedia = new Promise(resolve => { releaseMedia = resolve; });
    const pendingContents = new Promise(resolve => { releaseContents = resolve; });
    installFetch({ response: url => url.pathname.endsWith('/media-ranking') ? pendingMedia : url.pathname.endsWith('/contents') ? pendingContents : undefined });
    mount();
    await screen.findByText('加载媒体引用数据中...');
    const citation = screen.getByRole('region', { name: '引用信源' });
    const loadingContent = within(citation).getByText('加载内容明细中...');
    expect(loadingContent.closest('[role="status"]')).not.toBeNull();
    expect(citation.textContent).toMatch(/媒体\s*—\s*个/);
    expect(citation.textContent).toMatch(/内容\s*—\s*条/);
    expect(citation.textContent?.match(/引用\s*—\s*次/g)).toHaveLength(2);
    expect(citation.textContent).not.toMatch(/(?:媒体|内容|引用)\s*0\s*(?:个|条|次)/);
    expect(within(citation).queryByRole('table')).toBeNull();
    expect(within(citation).queryByLabelText('信源类型')).toBeNull();
    expect(within(citation).queryByRole('navigation')).toBeNull();
    expect((within(citation).getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { releaseMedia(success(listPage(true))); releaseContents(success(listPage(false))); });
    await screen.findByText('真实来源标题');
  });

  it.each([
    ['media-ranking', '媒体排行加载失败，请稍后重试'],
    ['contents', '内容明细加载失败，请稍后重试'],
  ] as const)('retries only the failed %s operation with the original request identity', async (endpoint, title) => {
    let attempts = 0;
    const fetcher = installFetch({ response: url => {
      if (url.pathname.endsWith('/' + endpoint) && attempts++ === 0) return { status: 'timeout', message: '本次查询超时。', httpStatus: 504, retryable: true };
      return undefined;
    } });
    mount(); await screen.findByText(title);
    const citation = screen.getByRole('region', { name: '引用信源' });
    expect((within(citation).getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(true);
    expect(citation.textContent).toMatch(/引用\s*—\s*次/);
    if (endpoint === 'media-ranking') {
      expect(citation.textContent).toMatch(/媒体\s*—\s*个/);
      expect(screen.getByText('真实来源标题')).toBeTruthy();
      expect(screen.queryByRole('navigation', { name: '媒体排行分页' })).toBeNull();
    } else {
      expect(citation.textContent).toMatch(/内容\s*—\s*条/);
      expect(screen.getByRole('button', { name: /原始媒体/ })).toBeTruthy();
      expect(within(citation).queryByRole('table')).toBeNull();
      expect(within(citation).queryByLabelText('信源类型')).toBeNull();
      expect(screen.queryByRole('navigation', { name: '引用内容分页' })).toBeNull();
    }
    fireEvent.click(within(citation).getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(screen.queryByText(title)).toBeNull());
    if (endpoint === 'media-ranking') await screen.findByRole('button', { name: /原始媒体/ });
    await screen.findByText('真实来源标题');
    expect(fetcher).toHaveBeenCalledTimes(5);
    const retried = fetcher.mock.calls.map(([url]) => url).filter(url => url.includes('/' + endpoint + '?'));
    expect(retried).toHaveLength(2); expect(retried[1]).toBe(retried[0]);
    const otherEndpoint = endpoint === 'contents' ? 'media-ranking' : 'contents';
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/' + otherEndpoint + '?'))).toHaveLength(1);
  });

  it('restarts an expired content session from its first page without restarting media', async () => {
    let attempts = 0;
    const fetcher = installFetch({ response: url => {
      if (url.pathname.endsWith('/contents') && attempts++ === 0) return { status: 'session_expired', message: '查询会话已失效。', httpStatus: 409, retryable: false };
      return undefined;
    } });
    mount(); await screen.findByText('内容明细加载失败，请稍后重试');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await screen.findByText('真实来源标题');
    const requests = fetcher.mock.calls.filter(([url]) => url.includes('/contents?')).map(([url]) => new URL(url, window.location.origin).searchParams);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.get('requestId')).not.toBe(requests[0]!.get('requestId'));
    expect(requests[1]!.has('snapshotToken')).toBe(false); expect(requests[1]!.has('cursor')).toBe(false);
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/media-ranking?'))).toHaveLength(1);
  });

  it('keeps content filters available after a successful empty result so the user can recover', async () => {
    const fetcher = installFetch({ response: url => url.pathname.endsWith('/contents') && url.searchParams.get('sourceType') === '新闻资讯'
      ? success(listPage(false, { items: [], total: '0', totalCitations: '0' })) : undefined });
    mount(); await screen.findByText('真实来源标题');
    fireEvent.change(screen.getByLabelText('信源类型'), { target: { value: '新闻资讯' } });
    fireEvent.click(screen.getByRole('button', { name: '应用内容筛选' }));
    await screen.findByText('当前筛选暂无内容');
    const citation = screen.getByRole('region', { name: '引用信源' });
    expect(citation.textContent).toMatch(/内容\s*0\s*条/);
    expect(citation.textContent).toMatch(/引用\s*0\s*次/);
    expect((screen.getByLabelText('信源类型') as HTMLSelectElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /原始媒体/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('信源类型'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '应用内容筛选' }));
    await screen.findByText('真实来源标题');
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/media-ranking?'))).toHaveLength(1);
  });

  it('shows the selected media display name while preserving its code in the content request', async () => {
    const fetcher = installFetch(); mount(); await screen.findByText('真实来源标题');
    fireEvent.click(screen.getByRole('button', { name: /原始媒体/ }));
    await screen.findByRole('heading', { name: '内容明细 - 原始媒体' });
    await screen.findByText('真实来源标题');
    expect(screen.queryByRole('heading', { name: /media-code-1/ })).toBeNull();
    const requests = fetcher.mock.calls.filter(([url]) => url.includes('/contents?'));
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1]![0], window.location.origin).searchParams.get('media')).toBe('media-code-1');
  });

  it('shows confirmed zero counts and disables export when both successful lists are empty', async () => {
    installFetch({ response: url => url.pathname.endsWith('/media-ranking') || url.pathname.endsWith('/contents')
      ? success(listPage(url.pathname.endsWith('/media-ranking'), { items: [], total: '0', totalCitations: '0' })) : undefined });
    mount(); await screen.findByText('当前筛选暂无内容');
    const citation = screen.getByRole('region', { name: '引用信源' });
    expect(citation.textContent).toMatch(/媒体\s*0\s*个/);
    expect(citation.textContent).toMatch(/内容\s*0\s*条/);
    expect(citation.textContent?.match(/引用\s*0\s*次/g)).toHaveLength(2);
    expect((within(citation).getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(true);
    expect(downloadCitationCsv).not.toHaveBeenCalled();
  });
});

function installPagedFetch() {
  return installFetch({ response: url => {
    const media = url.pathname.endsWith('/media-ranking');
    if (!media && !url.pathname.endsWith('/contents')) return undefined;
    const more = url.searchParams.has('cursor');
    return success(listPage(media, {
      total: '2', nextCursor: more ? null : media ? 'media-next' : 'content-next',
      ...(more ? { items: media ? [{ code: 'media-code-2', name: '后续媒体', citationCount: '0' }] : [{ sequence: '2', linkId: 'link-2', title: '后续来源标题', url: 'https://example.com/source-2', icon: null, media: '后续媒体', sourceType: '新闻资讯', publishTime: null, citationCount: '4', citationRatio: '40.00' }] } : {}),
    }));
  } });
}

describe('citation source complete export', () => {
  it('downloads the real completed data without a quota dialog or extra request', async () => {
    const fetcher = installFetch(); mount(); await screen.findByText('真实来源标题');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(downloadCitationCsv).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(4);
    const csv = vi.mocked(downloadCitationCsv).mock.calls[0]![0];
    expect(csv).toContain('媒体排行'); expect(csv).toContain('内容明细');
    expect(csv).toContain('原始媒体'); expect(csv).toContain('真实来源标题'); expect(csv).toContain('60.00');
  });

  it('does not fetch additional pages or download when the shared quota confirmation is canceled', async () => {
    const fetcher = installPagedFetch(); mount(); await screen.findByText('真实来源标题');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    const dialog = await screen.findByRole('alertdialog', { name: '导出完整引用信源' });
    expect(dialog.textContent).toContain('共享查询额度');
    expect(fetcher).toHaveBeenCalledTimes(4); expect(downloadCitationCsv).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '返回检查' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(fetcher).toHaveBeenCalledTimes(4); expect(downloadCitationCsv).not.toHaveBeenCalled();
  });

  it('continues both independent cursor sessions and includes every row after quota confirmation', async () => {
    const fetcher = installPagedFetch(); mount(); await screen.findByText('真实来源标题');
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    const dialog = await screen.findByRole('alertdialog', { name: '导出完整引用信源' });
    fireEvent.click(within(dialog).getByRole('button', { name: '继续导出' }));
    await waitFor(() => expect(downloadCitationCsv).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledTimes(6);
    const more = fetcher.mock.calls.map(([url]) => new URL(url, window.location.origin)).filter(url => url.searchParams.has('cursor'));
    expect(more).toHaveLength(2);
    const media = more.find(url => url.pathname.endsWith('/media-ranking'))!.searchParams;
    const contents = more.find(url => url.pathname.endsWith('/contents'))!.searchParams;
    expect(media.get('cursor')).toBe('media-next'); expect(media.get('snapshotToken')).toBe('media-session');
    expect(contents.get('cursor')).toBe('content-next'); expect(contents.get('snapshotToken')).toBe('content-session');
    const csv = vi.mocked(downloadCitationCsv).mock.calls[0]![0];
    expect(csv).toContain('原始媒体'); expect(csv).toContain('后续媒体');
    expect(csv).toContain('真实来源标题'); expect(csv).toContain('后续来源标题');
    expect(csv).toContain('https://example.com/source-2');
  });
});
