// @vitest-environment jsdom
// Source-only regression cases; not executed for this delivery.
import type { ReactElement, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndustryDateSelect } from './IndustryDateSelect';
import type { IndustryDateValue } from './industry-date';

// Test calendar decisions without the baseline Radix/jsdom close-path timer issue.
// This deliberately does NOT verify the real portal, focus trap, Escape or focus restoration.
vi.mock('@frontmind/module-ui/components/ui/popover', async () => {
  const React = await import('react');
  const Context = React.createContext({ open: false, onOpenChange: (_open: boolean) => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) =>
      <Context.Provider value={{ open, onOpenChange }}>{children}</Context.Provider>,
    PopoverTrigger: ({ children }: { children: ReactElement<{ onClick?: () => void; 'aria-expanded'?: boolean }> }) => {
      const context = React.useContext(Context);
      return React.cloneElement(children, { onClick: () => context.onOpenChange(!context.open), 'aria-expanded': context.open });
    },
    PopoverContent: ({ children }: { children: ReactNode }) => React.useContext(Context).open ? <div>{children}</div> : null,
  };
});

afterEach(cleanup);
function openDate(value: IndustryDateValue = { periodType: 'DAY', date: '2026-11-07' }, minDate: string | null = '2026-08-19', maxDate: string | null = '2026-11-07') {
  const onChange = vi.fn();
  const view = render(<IndustryDateSelect value={value} minDate={minDate} maxDate={maxDate} onChange={onChange}/>);
  fireEvent.click(screen.getByRole('button', { name: /^日期：/ }));
  return { ...view, onChange };
}

describe('shared industry day calendar decisions', () => {
  it('renders Monday-first month cells, selected day and real availability without submitting', () => {
    const { onChange } = openDate();
    const grid = screen.getByRole('grid', { name: '2026年11月' });
    expect(within(grid).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['一', '二', '三', '四', '五', '六', '日']);
    expect(screen.getByRole('button', { name: '选择2026-11-07' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: '选择2026-11-08' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '下个月' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('可选日期：2026-08-19 至 2026-11-07')).toBeTruthy();
    expect(within(grid).getAllByRole('button').filter(button => button.tabIndex === 0)).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('browses months and tabs locally, then submits one concrete day once', () => {
    const { onChange } = openDate();
    fireEvent.click(screen.getByRole('button', { name: '上个月' }));
    expect(screen.getByRole('grid', { name: '2026年10月' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '按周' }));
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByRole('button', { name: '选择2026年第45周' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '按月' }));
    expect(screen.getByRole('button', { name: '选择2026-11' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '按日' }));
    expect(screen.getByRole('grid', { name: '2026年11月' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '选择2026-11-06' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ periodType: 'DAY', date: '2026-11-06' });
    expect(screen.queryByRole('grid')).toBeNull();
  });
  it('does not submit again for the applied day and does not change selection when closed during browsing', () => {
    const { onChange } = openDate();
    fireEvent.click(screen.getByRole('button', { name: '选择2026-11-07' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^日期：/ }));
    fireEvent.click(screen.getByRole('button', { name: '上个月' }));
    fireEvent.click(screen.getByRole('button', { name: /^日期：/ }));
    fireEvent.click(screen.getByRole('button', { name: /^日期：/ }));
    expect(screen.getByRole('grid', { name: '2026年11月' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('opens the maximum month from a non-day selection without pretending a day is selected', () => {
    const { onChange } = openDate({ periodType: 'MONTH', date: '2026-09-01' });
    fireEvent.click(screen.getByRole('tab', { name: '按日' }));
    const grid = screen.getByRole('grid', { name: '2026年11月' });
    expect(within(grid).getAllByRole('button').some(button => button.getAttribute('aria-pressed') === 'true')).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('moves a single grid focus across a month boundary without selecting', () => {
    const { onChange } = openDate({ periodType: 'DAY', date: '2024-03-01' }, '2024-02-07', '2024-03-04');
    const selected = screen.getByRole('button', { name: '选择2024-03-01' });
    selected.focus();
    fireEvent.keyDown(selected, { key: 'ArrowLeft' });
    const leapDay = screen.getByRole('button', { name: '选择2024-02-29' });
    expect(document.activeElement).toBe(leapDay);
    expect(leapDay.getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(leapDay, { key: 'PageUp' });
    const minimum = screen.getByRole('button', { name: '选择2024-02-07' });
    expect(document.activeElement).toBe(minimum);
    fireEvent.keyDown(minimum, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(minimum);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('keeps an unknown lower bound unknown and a missing maximum unavailable', () => {
    const { onChange, unmount } = openDate({ periodType: 'DAY', date: '2026-11-07' }, null);
    const dayButtons = within(screen.getByRole('grid')).getAllByRole('button') as HTMLButtonElement[];
    expect(dayButtons.filter(button => !button.disabled).map(button => button.textContent)).toEqual(['7']);
    expect(screen.getByText('数据截至：2026-11-07')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    unmount();
    const unavailable = openDate({ periodType: 'DAY', date: '2026-11-07' }, null, null);
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByText('暂无可选日期')).toBeTruthy();
    expect(unavailable.onChange).not.toHaveBeenCalled();
  });
});
