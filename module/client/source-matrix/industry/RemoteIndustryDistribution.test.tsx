// @vitest-environment jsdom
// Regression source only. Not executed in this source-only delivery.
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishingGatewayProvider } from '../../PublishingContext';
import type { PublisherGateway } from '../../gateway';
import { LiveIndustryDistribution } from './IndustryDistribution';

beforeEach(() => { window.history.replaceState({}, '', '/publishing/source-matrix?task=task-9&draftId=draft-7#analysis'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const filters = { models: [{ value: 'all', label: '全部模型' }], industryTree: [], sourceTypes: ['新闻资讯'], minDate: null, maxDate: '2026-10-29' };
const success = (data: unknown) => ({ status: 'ok', source: 'molizhishu-public-industry', fetchedAt: '2026-11-06T12:00:00Z', data });
function installFetch(options: { noDate?: boolean; configuration?: boolean } = {}) {
  const fetcher = vi.fn(async (input: string) => {
    let value: unknown;
    if (options.configuration) value = { status: 'configuration_required', message: '行业信源连接尚未配置。', httpStatus: 503, retryable: false };
    else if (input.includes('/filters')) value = success({ ...filters, maxDate: options.noDate ? null : filters.maxDate });
    else if (input.includes('/distributions')) value = success({ sourceTypeDistribution: [{ code: '新闻资讯', name: '新闻资讯', citationCount: '3' }], publishTimeDistribution: [{ code: 'ONE_DAY', name: '1天内', contentCount: '2' }] });
    else {
      const media = input.includes('/media-ranking');
      value = success({ items: media ? [{ code: '原始媒体', name: '原始媒体', citationCount: '10' }] : [{ sequence: '1', linkId: 'link-1', title: '真实来源标题', url: null, icon: null, media: '原始媒体', sourceType: '新闻资讯', publishTime: null, citationCount: '6', citationRatio: '60.00' }], pageSize: media ? 10 : 20, total: '1', totalCitations: '10', snapshotToken: media ? 'media-session' : 'content-session', nextCursor: null, expiresAt: String(Date.now() + 600_000) });
    }
    return { ok: !options.configuration, status: options.configuration ? 503 : 200, json: async () => value };
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
    expect(screen.getByRole('table')).toBeTruthy(); expect(screen.getAllByRole('img')).toHaveLength(2);
  });
  it('keeps all panels but sends no charged queries if no date exists', async () => {
    const fetcher = installFetch({ noDate: true }); mount();
    await screen.findByText('当前尚无可选执行日期，暂不查询行业数据。');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(screen.queryByText('0.00%')).toBeNull();
    expect((screen.getByRole('button', { name: '查询' }) as HTMLButtonElement).disabled).toBe(true);
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
