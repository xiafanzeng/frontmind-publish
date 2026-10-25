// @vitest-environment jsdom
// Regression source only. Not executed in this source-only delivery.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndustryDistribution, LiveIndustryDistribution } from './IndustryDistribution';
import { YIHANG_SOURCE_BATCH } from './yihang';
import { matrixApi } from '../api';

vi.mock('../api', () => ({ matrixApi: vi.fn() }));
beforeEach(() => { window.history.replaceState({}, '', '/publishing/source-matrix?draftId=draft-7&task=task-9#analysis'); vi.mocked(matrixApi).mockReset(); });
afterEach(cleanup);

function expectCompleteLayout() {
  expect(screen.getByLabelText('行业')).toBeTruthy();
  expect(screen.getByLabelText('模型')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^日期：/ })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '引用信源' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '媒体排行' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '内容明细 - 全部媒体' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '信源分布' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '类型分布' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '时间分布' })).toBeTruthy();
  const table = screen.getByRole('table');
  for (const label of ['序号', '内容标题 / 原文', '媒体名称', '媒体类型', '引用占比']) {
    expect(within(table).getByRole('columnheader', { name: label })).toBeTruthy();
  }
  expect(within(table).getByRole('columnheader', { name: /引用次数/ })).toBeTruthy();
  expect(screen.getAllByRole('img')).toHaveLength(2);
}

describe('source distribution interactions', () => {
  it('shows all three honest totals, pages contents and retains owning route context', () => {
    render(<div className="fm-media"><IndustryDistribution batches={[YIHANG_SOURCE_BATCH]}/></div>);
    expect(screen.getAllByText('502').length).toBeGreaterThan(0);
    expect(screen.getAllByText('114').length).toBeGreaterThan(0);
    expect(screen.getAllByText('61').length).toBeGreaterThan(0);
    const pager = screen.getByRole('navigation', { name: '引用内容分页' });
    fireEvent.click(within(pager).getByRole('button', { name: '下一页' }));
    expect(pager.textContent).toContain('第 2 / 12 页');
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: '百度文心-手机版' } });
    expect(screen.getAllByText('118').length).toBeGreaterThan(0);
    expect(pager.textContent).toContain('第 1 /');
    expect(window.location.search).toContain('draftId=draft-7');
    expect(window.location.search).toContain('task=task-9');
    expect(window.location.hash).toBe('#analysis');
  });
  it('filters only content table on media selection and exposes return-all action', () => {
    render(<div className="fm-media"><IndustryDistribution batches={[YIHANG_SOURCE_BATCH]}/></div>);
    const ranking = screen.getByRole('complementary', { name: '媒体引用排行' });
    // Two distinct media groups share this name; the first row is the top-ranked m.360189.com group.
    fireEvent.click(within(ranking).getAllByRole('button', { name: /北京九运百行文化传播有限公司/ })[0]!);
    expect(screen.getByRole('button', { name: '返回全部媒体' })).toBeTruthy();
    expect(screen.getByText(/占比仍按全筛选范围计算/)).toBeTruthy();
    expect(screen.getByText(/分母 502 条/)).toBeTruthy();
    expect(screen.getByText(/分母 114 项/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回全部媒体' }));
    expect(screen.queryByRole('button', { name: '返回全部媒体' })).toBeNull();
  });
  it('renders empty filters and keeps chart percentages undefined instead of NaN', async () => {
    render(<div className="fm-media"><IndustryDistribution batches={[YIHANG_SOURCE_BATCH]}/></div>);
    // 图2：日期为单一复合下拉，弹层内切换粒度并选择周期
    fireEvent.click(screen.getByRole('button', { name: /按月 · 2026-09/ }));
    expect(screen.getByRole('dialog', { name: '选择日期周期' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '按日' }));
    fireEvent.click(screen.getByRole('tab', { name: '按日' }));
    fireEvent.click(screen.getAllByRole('button', { name: /2026-09-12/ })[0]!);
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.includes('媒体 46 · 内容 80 · 引用 262 条记录') === true)).toBeTruthy();
    // 空状态：URL 恢复一个不存在的模型值（也覆盖筛选参数的刷新恢复路径）
    window.history.replaceState({}, '', '/publishing/source-matrix?smModel=不存在的模型&smGranularity=day&smPeriod=2026-09-12');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByText('当前筛选暂无导出记录')).toBeTruthy();
    expectCompleteLayout();
    expect(document.body.textContent).not.toContain('NaN');
    expect(screen.getByRole('img', { name: '内容发布时间分布，无数据' })).toBeTruthy();
  });
  it('shows explicit loading and error states without sample totals', () => {
    const view = render(<div className="fm-media"><IndustryDistribution batches={[]} loading/></div>);
    expect(screen.getByRole('status').textContent).toContain('正在读取');
    expectCompleteLayout();
    const retry = vi.fn();
    view.rerender(<div className="fm-media"><IndustryDistribution batches={[]} error="读取失败" onRetry={retry}/></div>);
    expect(screen.getByRole('alert').textContent).toContain('读取失败');
    expectCompleteLayout();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('502')).toBeNull();
  });
  it('keeps an honest empty layout and a date popup without invented periods', () => {
    window.history.replaceState({}, '', '/publishing/source-matrix?smPeriod=2026-10&smIndustry=missing');
    render(<div className="fm-media"><IndustryDistribution batches={[]}/></div>);
    expectCompleteLayout();
    expect((screen.getByLabelText('行业') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('模型') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('0.00%')).toBeNull();
    expect(screen.getByRole('navigation', { name: '引用内容分页' }).textContent).toContain('内容 — 项');
    for (const chart of screen.getAllByRole('img')) {
      expect(chart.textContent).toContain('—');
      expect(chart.getAttribute('style')).not.toContain('conic-gradient');
    }
    fireEvent.click(screen.getByRole('button', { name: /日期：按月 · 暂无可选周期/ }));
    const popup = screen.getByRole('dialog', { name: '选择日期周期' });
    for (const label of ['按日', '按周', '按月']) expect(within(popup).getByRole('tab', { name: label })).toBeTruthy();
    fireEvent.click(within(popup).getByRole('tab', { name: '按周' }));
    expect(within(popup).getByText('当前范围没有可选周期')).toBeTruthy();
    expect(popup.textContent).not.toContain('2026-10');
    fireEvent.keyDown(popup, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /日期：按周/ }));
  });
  it('does not show stale numeric data while loading or failed, then fills the same panels on success', () => {
    const view = render(<div className="fm-media"><IndustryDistribution batches={[YIHANG_SOURCE_BATCH]} loading/></div>);
    expectCompleteLayout();
    expect(screen.queryByText('502')).toBeNull();
    view.rerender(<div className="fm-media"><IndustryDistribution batches={[YIHANG_SOURCE_BATCH]} error="读取失败"/></div>);
    expectCompleteLayout();
    expect(screen.queryByText('502')).toBeNull();
    expect(screen.queryByText('一航软件样本')).toBeNull();
    view.rerender(<div className="fm-media"><IndustryDistribution batches={[YIHANG_SOURCE_BATCH]}/></div>);
    expectCompleteLayout();
    expect(screen.getAllByText('502').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('selects a real period when data arrives after the empty-state granularity was changed', () => {
    const view = render(<div className="fm-media"><IndustryDistribution batches={[]}/></div>);
    fireEvent.click(screen.getByRole('button', { name: /日期：按月 · 暂无可选周期/ }));
    fireEvent.click(screen.getByRole('tab', { name: '按日' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    view.rerender(<div className="fm-media"><IndustryDistribution batches={[YIHANG_SOURCE_BATCH]}/></div>);
    expect(screen.getByRole('button', { name: /日期：按日 · 2026-09-13/ })).toBeTruthy();
    expect(window.location.search).toContain('smPeriod=2026-09-13');
    expect(window.location.search).toContain('draftId=draft-7');
    expect(screen.getAllByText('240').length).toBeGreaterThan(0);
    // Retrying must not erase the chosen valid period while the response is pending.
    view.rerender(<div className="fm-media"><IndustryDistribution batches={[]} loading/></div>);
    view.rerender(<div className="fm-media"><IndustryDistribution batches={[YIHANG_SOURCE_BATCH]}/></div>);
    expect(screen.getByRole('button', { name: /日期：按日 · 2026-09-13/ })).toBeTruthy();
  });
});

describe('live data boundary', () => {
  it('never substitutes the workbook after a service failure', async () => {
    vi.mocked(matrixApi).mockRejectedValue(new Error('unavailable'));
    render(<div className="fm-media"><LiveIndustryDistribution/></div>);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expectCompleteLayout();
    expect(screen.queryByText('502')).toBeNull();
    expect(screen.queryByText('一航软件样本')).toBeNull();
    expect(matrixApi).toHaveBeenCalledWith('/source-distribution', expect.any(AbortSignal));
  });
  it('shows a non-ready status as unavailable rather than a successful zero', async () => {
    vi.mocked(matrixApi).mockResolvedValue({ status: 'data_limit_exceeded', batches: [], message: '当前范围过大，请缩小数据范围后重试。' });
    render(<div className="fm-media"><LiveIndustryDistribution/></div>);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('当前范围过大'));
    expect(screen.queryByText('原始导出引用记录')).toBeNull();
  });
  it('distinguishes configuration-required from failure and restores live data through retry', async () => {
    vi.mocked(matrixApi).mockResolvedValueOnce({ status: 'configuration_required', batches: [], message: '当前项目尚未接入可查看的行业引用明细。' });
    // Fixture is supplied only through this mocked API; the production component imports no workbook fallback.
    vi.mocked(matrixApi).mockResolvedValueOnce({ status: 'ready', batches: [YIHANG_SOURCE_BATCH] });
    render(<div className="fm-media"><LiveIndustryDistribution/></div>);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('当前项目尚未接入'));
    expectCompleteLayout();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.getAllByText('502').length).toBeGreaterThan(0));
    expectCompleteLayout();
    expect(matrixApi).toHaveBeenCalledTimes(2);
  });
  it('keeps a successful empty response as pending data, not zero industry activity', async () => {
    vi.mocked(matrixApi).mockResolvedValue({ status: 'ready', batches: [] });
    render(<div className="fm-media"><LiveIndustryDistribution/></div>);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('行业数据待接入'));
    expectCompleteLayout();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('0.00%')).toBeNull();
  });
});
