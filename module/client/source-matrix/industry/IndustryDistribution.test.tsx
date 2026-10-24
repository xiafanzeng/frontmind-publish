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
  it('renders empty filters and keeps chart percentages undefined instead of NaN', () => {
    render(<div className="fm-media"><IndustryDistribution batches={[YIHANG_SOURCE_BATCH]}/></div>);
    fireEvent.change(screen.getByLabelText('月份'), { target: { value: '2026-10' } });
    expect(screen.getByText('当前筛选暂无导出记录')).toBeTruthy();
    expect(document.body.textContent).not.toContain('NaN');
    expect(screen.getByRole('img', { name: '内容发布时间分布，无数据' })).toBeTruthy();
  });
  it('shows explicit loading and error states without sample totals', () => {
    const view = render(<div className="fm-media"><IndustryDistribution batches={[]} loading/></div>);
    expect(screen.getByRole('status').textContent).toContain('正在读取');
    const retry = vi.fn();
    view.rerender(<div className="fm-media"><IndustryDistribution batches={[]} error="读取失败" onRetry={retry}/></div>);
    expect(screen.getByRole('alert').textContent).toContain('读取失败');
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('502')).toBeNull();
  });
});

describe('live data boundary', () => {
  it('never substitutes the workbook after a service failure', async () => {
    vi.mocked(matrixApi).mockRejectedValue(new Error('unavailable'));
    render(<div className="fm-media"><LiveIndustryDistribution/></div>);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
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
});
