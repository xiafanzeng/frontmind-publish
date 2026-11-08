// @vitest-environment jsdom
// Source-only regression coverage for the Pro handoff; not executed in this round.
import { useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResearchImportDialog } from './ResearchImportDialog';
import type { ResearchDatasetSummary } from './research-import-types';

// These tests cover import state/requests. Shared modal focus and actual viewport
// behavior must be checked separately with the real shared dialogs after merge.
vi.mock('./SourceMatrixPresentation', () => ({
  MatrixDialog: ({ open, title, children, footer, onClose }: { open: boolean; title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) => open ? <section role="dialog" aria-label={title}><h2>{title}</h2><button onClick={onClose}>关闭弹窗</button>{children}{footer}</section> : null,
}));
vi.mock('./MediaMarket', () => ({
  MediaDialog: ({ open, title, children, onCancel, onConfirm, busy, confirmLabel }: { open: boolean; title: string; children: ReactNode; onCancel: () => void; onConfirm: () => void; busy: boolean; confirmLabel: string }) => open ? <section role="dialog" aria-label={title}><h2>{title}</h2>{children}<button disabled={busy} onClick={onCancel}>取消</button><button disabled={busy} onClick={onConfirm}>{confirmLabel}</button></section> : null,
}));

const a: ResearchDatasetSummary = { id: '11111111-1111-4111-8111-111111111111', name: '原始研究.csv', recordCount: 3, status: 'confirmed', createdAt: '2026-11-08T01:00:00Z', version: 'research-private-version-a' };
const b: ResearchDatasetSummary = { ...a, id: '22222222-2222-4222-8222-222222222222', name: '仁南-信源分析.xlsx', version: 'research-private-version-b' };
const c: ResearchDatasetSummary = { ...a, id: '33333333-3333-4333-8333-333333333333', name: '补充资料.txt' };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const completed = (dataset: ResearchDatasetSummary, extra = {}) => response({ dataset, reused: false, validation: { counts: { valid: dataset.recordCount, duplicate: 0, failed: 0, total: dataset.recordCount }, warnings: [] }, ...extra });
const file = (name = b.name) => new File(['source_name,url\n媒体,https://example.test'], name);
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>(yes => { resolve = yes; }); return { promise, resolve }; }
function upload(value: File) { fireEvent.change(screen.getByLabelText('选择导入文件'), { target: { files: [value] } }); }
function harness(initialIds: string[] = []) {
  const onChange = vi.fn();
  function Harness() {
    const [ids, setIds] = useState(initialIds), [open, setOpen] = useState(true);
    return <><button onClick={() => setOpen(true)}>打开导入</button><ResearchImportDialog open={open} scopeKey="task-a" selectedIds={ids} onClose={() => setOpen(false)} onChange={(next, datasets) => { setIds(next); onChange(next, datasets); }}/></>;
  }
  return { ...render(<Harness/>), onChange };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('automatic research imports', () => {
  it('refreshes saved metadata without changing an unchanged selection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ datasets: [b] })));
    const onChange = vi.fn(), onRefresh = vi.fn();
    render(<ResearchImportDialog open selectedIds={[b.id]} onClose={vi.fn()} onChange={onChange} onRefresh={onRefresh}/>);
    await screen.findByText(b.name);
    expect(onRefresh).toHaveBeenCalledWith([b]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows one row while importing and after automatic save, with the exact original filename', async () => {
    const importing = deferred();
    const fetcher = vi.fn().mockResolvedValueOnce(response({ datasets: [] })).mockReturnValueOnce(importing.promise);
    vi.stubGlobal('fetch', fetcher);
    const view = harness();
    await screen.findByText('暂无文件，选择文件后将自动保存并选用。');
    expect(screen.getByRole('dialog', { name: '导入数据' })).toBeTruthy();
    for (const text of ['工作表', '资料用途', '字段映射', '校验映射', '数据预览', '已保存的数据集']) expect(screen.queryByText(text)).toBeNull();
    upload(file());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('正在导入…', { selector: 'small' })).toBeTruthy();
    const init = fetcher.mock.calls[1]![1] as RequestInit, body = init.body as FormData;
    expect(fetcher.mock.calls[1]![0]).toBe('/api/modules/publish/matrix/imports/auto');
    expect(body.get('original_name')).toBe(b.name);
    expect((body.get('file') as File).name).toBe(b.name);
    expect(body.get('selected_ids')).toBe('[]');
    await act(async () => { importing.resolve(completed(b)); });
    await screen.findByText('文件已保存并选用。');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect((screen.getByRole('checkbox', { name: `选用 ${b.name}` }) as HTMLInputElement).checked).toBe(true);
    expect(view.onChange.mock.lastCall?.[0]).toEqual([b.id]);
    expect(screen.queryByText(b.id)).toBeNull();
    expect(screen.queryByText(b.version)).toBeNull();
  });

  it('collapses a fingerprint reuse into its existing saved row and reloads saved files on reopen', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ datasets: [b] })).mockResolvedValueOnce(completed(b, { reused: true })).mockResolvedValueOnce(response({ datasets: [b] }));
    vi.stubGlobal('fetch', fetcher);
    harness();
    await screen.findByText(b.name);
    upload(file());
    await screen.findByText('已复用并选用已有文件。');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    fireEvent.click(screen.getByRole('button', { name: '打开导入' }));
    await screen.findByText(b.name);
    expect((screen.getByRole('checkbox', { name: `选用 ${b.name}` }) as HTMLInputElement).checked).toBe(true);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/modules/publish/matrix/imports', '/api/modules/publish/matrix/imports/auto', '/api/modules/publish/matrix/imports']);
  });

  it('keeps a failed replacement on the old row and switches selection only after an atomic successful retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ datasets: [a, c] })).mockResolvedValueOnce(response({ message: '未识别到可用内容，请检查文件。' }, false)).mockResolvedValueOnce(completed(b, { replacedId: a.id }));
    vi.stubGlobal('fetch', fetcher);
    const view = harness([a.id, c.id]);
    await screen.findByText(a.name);
    fireEvent.click(within(screen.getByText(a.name).closest('li')!).getByRole('button', { name: '替换' }));
    upload(file());
    await screen.findByText(/未识别到可用内容/);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect((screen.getByRole('checkbox', { name: `选用 ${a.name}` }) as HTMLInputElement).checked).toBe(true);
    expect(view.onChange).not.toHaveBeenCalled();
    const body = (fetcher.mock.calls[1]![1] as RequestInit).body as FormData;
    expect(body.get('replace_id')).toBe(a.id);
    expect(JSON.parse(String(body.get('selected_ids')))).toEqual([c.id]);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('文件已替换并选用。');
    expect(screen.queryByText(a.name)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(view.onChange.mock.lastCall?.[0]).toEqual([c.id, b.id]);
    expect(fetcher.mock.calls.some(call => String(call[0]).endsWith('/remove'))).toBe(false);
  });

  it('keeps a failed new file in the same list and allows local removal without a delete request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ datasets: [a] })).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetcher);
    const view = harness([a.id]);
    await screen.findByText(a.name);
    upload(file());
    await screen.findByText('未收到导入结果，请重试核对。');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(view.onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    expect(screen.queryByText(b.name)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not delete on deselection, and keeps data and selection when confirmed deletion fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ datasets: [a] })).mockResolvedValueOnce(response({ message: '删除失败，请重试。' }, false)).mockResolvedValueOnce(response({ removed: true }));
    vi.stubGlobal('fetch', fetcher);
    const view = harness([a.id]);
    await screen.findByText(a.name);
    fireEvent.click(screen.getByRole('checkbox', { name: `选用 ${a.name}` }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(view.onChange.mock.lastCall?.[0]).toEqual([]);
    fireEvent.click(screen.getByRole('checkbox', { name: `选用 ${a.name}` }));
    view.onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByRole('dialog', { name: '删除文件' })).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '删除文件' }));
    await screen.findByText('删除失败，请重试。');
    expect(view.onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除文件' }));
    await screen.findByText('文件已删除，已有生成结果保留原快照。');
    expect(view.onChange.mock.lastCall?.[0]).toEqual([]);
    expect(screen.queryByText(a.name)).toBeNull();
  });

  it('blocks upload until saved state is known and offers recovery after a failed list request', async () => {
    const loading = deferred(), fetcher = vi.fn().mockReturnValueOnce(loading.promise).mockResolvedValueOnce(response({ datasets: [] }));
    vi.stubGlobal('fetch', fetcher);
    harness();
    expect((screen.getByRole('button', { name: '选择文件 / 拖拽到此处' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.drop(screen.getByRole('button', { name: '选择文件 / 拖拽到此处' }).parentElement!, { dataTransfer: { files: [file()] } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { loading.resolve(response({ message: '读取失败，请重试。' }, false)); });
    await screen.findByText('读取失败，请重试。');
    expect((screen.getByLabelText('选择导入文件') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重新读取文件列表' }));
    await screen.findByText('暂无文件，选择文件后将自动保存并选用。');
    expect((screen.getByLabelText('选择导入文件') as HTMLInputElement).disabled).toBe(false);
  });

  it('enforces file and selected-record limits while allowing deselection to recover', async () => {
    const heavy = { ...a, recordCount: 10000 };
    const fetcher = vi.fn().mockResolvedValueOnce(response({ datasets: [heavy, b] }));
    vi.stubGlobal('fetch', fetcher);
    const view = harness([a.id]);
    await screen.findByText(a.name);
    fireEvent.click(screen.getByRole('checkbox', { name: `选用 ${b.name}` }));
    expect(screen.getByText('所选数据超过 10,000 条，请先取消部分选择。')).toBeTruthy();
    expect(view.onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: `选用 ${a.name}` }));
    fireEvent.click(screen.getByRole('checkbox', { name: `选用 ${b.name}` }));
    expect(view.onChange.mock.lastCall?.[0]).toEqual([b.id]);
    upload(new File([], '空文件.csv'));
    await screen.findByText('请选择非空且不超过 8 MiB 的文件。');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('aborts old scope requests and ignores their responses even when the transport resolves after cancellation', async () => {
    const oldUpload = deferred(), newLoad = deferred();
    const fetcher = vi.fn().mockResolvedValueOnce(response({ datasets: [] })).mockReturnValueOnce(oldUpload.promise).mockReturnValueOnce(newLoad.promise);
    vi.stubGlobal('fetch', fetcher);
    const oldCallback = vi.fn(), newCallback = vi.fn();
    const view = render(<ResearchImportDialog open scopeKey="old-owner" selectedIds={[]} onClose={vi.fn()} onChange={oldCallback}/>);
    await screen.findByText('暂无文件，选择文件后将自动保存并选用。');
    upload(file());
    const signal = (fetcher.mock.calls[1]![1] as RequestInit).signal!;
    view.rerender(<ResearchImportDialog open scopeKey="new-owner" selectedIds={[]} onClose={vi.fn()} onChange={newCallback}/>);
    expect(signal.aborted).toBe(true);
    await act(async () => { oldUpload.resolve(completed(b)); newLoad.resolve(response({ datasets: [c] })); });
    await screen.findByText(c.name);
    expect(screen.queryByText(b.name)).toBeNull();
    expect(oldCallback).not.toHaveBeenCalled();
    expect(newCallback).not.toHaveBeenCalled();
  });

  it('uses the current callback and selection if the parent updates while upload is pending', async () => {
    const importing = deferred();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ datasets: [a, c] })).mockReturnValueOnce(importing.promise));
    const first = vi.fn(), latest = vi.fn();
    const view = render(<ResearchImportDialog open scopeKey="same-owner" selectedIds={[a.id]} onClose={vi.fn()} onChange={first}/>);
    await screen.findByText(a.name);
    upload(file());
    view.rerender(<ResearchImportDialog open scopeKey="same-owner" selectedIds={[c.id]} onClose={vi.fn()} onChange={latest}/>);
    await act(async () => { importing.resolve(completed(b)); });
    await waitFor(() => expect(latest).toHaveBeenCalled());
    expect(first).not.toHaveBeenCalled();
    expect(latest.mock.lastCall?.[0]).toEqual([c.id, b.id]);
  });
});
