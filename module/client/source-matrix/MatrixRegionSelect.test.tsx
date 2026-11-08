// @vitest-environment jsdom
// Source-only regression; real Radix portal, Escape and focus restoration need browser acceptance.
import { useState, type ReactElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MatrixRegionSelect } from './MatrixRegionSelect';

vi.mock('@frontmind/module-ui/components/ui/popover', async () => {
  const React = await import('react');
  const Context = React.createContext({ open: false, onOpenChange: (_open: boolean) => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) => <Context.Provider value={{ open, onOpenChange }}>{children}</Context.Provider>,
    PopoverTrigger: ({ children }: { children: ReactElement<{ onClick?: () => void }> }) => { const context = React.useContext(Context); return React.cloneElement(children, { onClick: () => context.onOpenChange(!context.open) }); },
    PopoverContent: ({ children }: { children: ReactNode }) => React.useContext(Context).open ? <div>{children}</div> : null,
  };
});
afterEach(cleanup);
function Form({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial), [unrestricted, setUnrestricted] = useState(!initial);
  return <MatrixRegionSelect value={value} unrestricted={unrestricted} onChange={(next, unlimited) => { setValue(next); setUnrestricted(unlimited); }}/>;
}
it('requires explicitly unchecking unlimited and keeps the temporary empty state until changed', () => {
  render(<Form/>);fireEvent.click(screen.getByRole('button', { name: '覆盖地区' }));
  expect((screen.getByRole('checkbox', { name: '广东' }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: '不限地区' }));
  expect((screen.getByRole('checkbox', { name: '不限地区' }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('button', { name: '覆盖地区' }).textContent).toContain('选择省份');
  fireEvent.click(screen.getByRole('checkbox', { name: '广东' }));fireEvent.click(screen.getByRole('checkbox', { name: '上海' }));
  expect(screen.getByRole('button', { name: '覆盖地区' }).textContent).toContain('广东、上海');
  fireEvent.click(screen.getByRole('checkbox', { name: '不限地区' }));
  expect((screen.getByRole('checkbox', { name: '广东' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: '上海' }) as HTMLInputElement).disabled).toBe(true);
});
it('retains removable old settings and clears local search with keyboard focus', () => {
  render(<Form initial="旧城区、广东省"/>);fireEvent.click(screen.getByRole('button', { name: '覆盖地区' }));
  expect(screen.getByRole('button', { name: '移除原地区 旧城区' })).toBeTruthy();
  const search = screen.getByRole('textbox', { name: '搜索省份' });
  fireEvent.change(search, { target: { value: '不存在' } });expect(screen.getByRole('status').textContent).toContain('没有匹配');
  fireEvent.click(screen.getByRole('button', { name: '清除省份搜索' }));expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: 'ArrowDown' });expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: '北京' }));
  fireEvent.click(screen.getByRole('button', { name: '移除原地区 旧城区' }));expect(screen.getByRole('button', { name: '覆盖地区' }).textContent).toBe('广东');
});
