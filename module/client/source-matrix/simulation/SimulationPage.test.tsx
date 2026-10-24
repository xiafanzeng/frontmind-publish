// @vitest-environment jsdom
// Source-only regression cases. Execution belongs to the receiving ZCode stage.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SimulationPage from './SimulationPage';
vi.mock('../../host', () => ({ usePublishingWorkspaceKey: () => 'sample-workspace', projectWorkspaceUrl: (url: string) => url }));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('A sample must never query live services'); }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
it('shows workbook analysis without requiring a recommendation task', () => {
  render(<SimulationPage />);
  expect(screen.getByRole('link', { name: '行业信源分布' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getAllByText(/502/).length).toBeGreaterThan(0);
  expect(screen.queryByText('固定种子')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps workbook sources unassigned and unpriced rather than inventing purchases', () => {
  render(<SimulationPage view="matrix" />);
  expect(screen.getByRole('heading', { name: '尚未分层的样本来源' })).toBeTruthy();
  expect(screen.getAllByText('北京九运百行文化传播有限公司').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '生成组合推荐' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: '加入本组合' })).toBeNull();
  expect(screen.queryByText(/购物车 0 家/)).toBeNull();
  expect(screen.getByText(/真实购物车保留不变/)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
it('opens traceable original rows without claiming complete citation evidence', () => {
  render(<SimulationPage view="matrix" />);
  const trigger = screen.getAllByRole('button', { name: '查看样本依据' })[0]!;
  trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getAllByText(/详细表格/).length).toBeGreaterThan(0);
  expect(screen.getByText(/不证明该来源可售/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }));
  expect(document.activeElement).toBe(trigger);
});
it('keeps two sample destinations and context on legacy report links', () => {
  window.history.replaceState({}, '', '/publishing/source-report?simulation=1&draftId=d1&workbenchTask=w1#evidence');
  render(<SimulationPage view="report" />);
  const href = new URL(screen.getByRole('link', { name: '行业信源分布' }).getAttribute('href')!, 'https://example.invalid');
  expect(href.pathname).toBe('/publishing/source-matrix');
  expect(href.searchParams.get('tab')).toBe('analysis');
  expect(href.searchParams.get('draftId')).toBe('d1');
  expect(href.searchParams.get('workbenchTask')).toBe('w1');
  expect(href.hash).toBe('#evidence');
  expect(screen.queryByRole('link', { name: '方案报告' })).toBeNull();
});
