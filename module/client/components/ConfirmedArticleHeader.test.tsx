// @vitest-environment jsdom
// Source-only regression cases; run in the final merged repository.
import React, { type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublishingGatewayProvider } from '../PublishingContext';
import { configurePublishingHost } from '../host';
import type { PublisherGateway } from '../gateway';
import type { ArticleDetail, ArticleVersion } from '../types';
import { ConfirmedArticleHeader } from './ConfirmedArticleHeader';

vi.mock('../source-matrix/MediaMarket', () => ({
  MediaDialog: ({ open, title, children, onCancel, onConfirm, confirmLabel, confirmDisabled }: {
    open: boolean; title: string; children: ReactNode; onCancel: () => void; onConfirm: () => void; confirmLabel: string; confirmDisabled?: boolean;
  }) => open ? <div role="dialog" aria-label={title}>{children}<button onClick={onCancel}>取消版本选择</button><button disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button></div> : null,
}));
const version = (id: string, n: number): ArticleVersion => ({ id, version: n, hash: `hash-${id}`, frozen: true, containsImages: false, createdAt: '2026-11-07T00:00:00Z', createdBy: 'owner' });
const article: ArticleDetail = {
  id: 'a', title: '真实稿件长标题', status: 'frozen', currentVersion: 2, currentVersionId: 'a-v2', revision: 3,
  wordCount: 6, imageCount: 0, updatedAt: '2026-11-07T00:00:00Z', bodyText: '当前工作副本正文', images: [],
  versions: [version('a-v2', 2), version('a-v1', 1)], importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true },
};
function fixture() {
  return {
    listArticles: vi.fn<PublisherGateway['listArticles']>().mockResolvedValue([article, { ...article, id: 'unconfirmed', currentVersion: 0, currentVersionId: undefined, status: 'draft' }]),
    getArticle: vi.fn<PublisherGateway['getArticle']>().mockResolvedValue(article),
    getArticleVersion: vi.fn<PublisherGateway['getArticleVersion']>(async id => article.versions.find(row => row.id === id)!),
    createDraft: vi.fn(), saveArticle: vi.fn(), freezeArticle: vi.fn(),
  };
}
function tree(gateway: ReturnType<typeof fixture>, onSelect = vi.fn(), props: Partial<React.ComponentProps<typeof ConfirmedArticleHeader>> = {}) {
  return <PublishingGatewayProvider gateway={gateway as unknown as PublisherGateway}>
    <ConfirmedArticleHeader rows={[]} onSelect={onSelect} {...props}/>
  </PublishingGatewayProvider>;
}
async function openVersionChoice() {
  fireEvent.click(screen.getByRole('button', { name: /当前稿件/ }));
  const row = await screen.findByRole('radio', { name: /ID：a/ });
  expect((screen.getByRole('button', { name: '选择确认版本' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('radio', { name: /ID：unconfirmed/ })).toBeNull();
  fireEvent.click(row);
  fireEvent.click(screen.getByRole('button', { name: '选择确认版本' }));
  await screen.findByRole('combobox', { name: '稿件版本' });
}
afterEach(() => { cleanup(); configurePublishingHost({}); vi.restoreAllMocks(); });

describe('shared confirmed article header', () => {
  it('does not automatically select the first article and commits an explicitly chosen historical version only after verification', async () => {
    const gateway = fixture(); const onSelect = vi.fn();
    render(tree(gateway, onSelect));
    expect(gateway.listArticles).not.toHaveBeenCalled();
    await openVersionChoice();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: '稿件版本' }), { target: { value: 'a-v1' } });
    fireEvent.click(screen.getByRole('button', { name: '使用此版本' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ article, version: article.versions[1] }));
    expect(gateway.getArticleVersion).toHaveBeenCalledWith('a-v1', expect.any(AbortSignal));
    expect(gateway.getArticle).toHaveBeenCalledTimes(2);
    expect(gateway.createDraft).not.toHaveBeenCalled();
    expect(gateway.saveArticle).not.toHaveBeenCalled();
    expect(gateway.freezeArticle).not.toHaveBeenCalled();
  });
  it('preserves the previous selection on a mismatched or removed version and supports retry', async () => {
    const gateway = fixture(); const onSelect = vi.fn();
    gateway.getArticleVersion.mockResolvedValueOnce({ ...article.versions[0]!, hash: 'another-version-hash' });
    render(tree(gateway, onSelect, { rows: [{ id: 'previous', title: '原稿', version: 4 }] }));
    await openVersionChoice();
    fireEvent.click(screen.getByRole('button', { name: '使用此版本' }));
    await screen.findByText('稿件或确认版本已失效，请重新选择。');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('原稿 · v4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试选择版本' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  });
  it('ignores a late version response after cancellation', async () => {
    const gateway = fixture(); const onSelect = vi.fn();
    let resolve!: (value: ArticleVersion) => void;
    gateway.getArticleVersion.mockImplementation(() => new Promise(done => { resolve = done; }));
    render(tree(gateway, onSelect));
    await openVersionChoice();
    fireEvent.click(screen.getByRole('button', { name: '使用此版本' }));
    await waitFor(() => expect(gateway.getArticleVersion).toHaveBeenCalledTimes(1));
    const signal = gateway.getArticleVersion.mock.calls[0][1]!;
    fireEvent.click(screen.getByRole('button', { name: '取消版本选择' }));
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(article.versions[0]!); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('makes a batch a read-only current list without offering replacement by one article', () => {
    const gateway = fixture(); const onSelect = vi.fn();
    render(tree(gateway, onSelect, { batch: true, rows: [{ id: 'a', title: '稿一', version: 2 }, { id: 'b', title: '稿二', version: 7, excluded: true }] }));
    expect(screen.queryByRole('button', { name: /当前稿件/ })).toBeNull();
    fireEvent.click(screen.getByText('2 篇稿件'));
    expect(screen.getByText('稿一')).toBeTruthy();
    expect(screen.getByText('v7 · 已从本批次排除')).toBeTruthy();
    expect(gateway.listArticles).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('invalidates an outstanding version read when the current article scope changes', async () => {
    const gateway = fixture(); const onSelect = vi.fn();
    let resolve!: (value: ArticleVersion) => void;
    gateway.getArticleVersion.mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = render(tree(gateway, onSelect));
    await openVersionChoice();
    fireEvent.click(screen.getByRole('button', { name: '使用此版本' }));
    await waitFor(() => expect(gateway.getArticleVersion).toHaveBeenCalledTimes(1));
    view.rerender(tree(gateway, onSelect, { selectedVersionId: 'other-v', rows: [{ id: 'other', title: '新的当前稿件', version: 5 }] }));
    await act(async () => { resolve(article.versions[0]!); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('新的当前稿件 · v5')).toBeTruthy();
  });
});
