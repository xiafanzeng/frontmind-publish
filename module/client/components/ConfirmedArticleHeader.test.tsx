// @vitest-environment jsdom
// Source-only regression cases; run in the final merged repository.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublishingGatewayProvider } from '../PublishingContext';
import { configurePublishingHost } from '../host';
import type { PublisherGateway } from '../gateway';
import type { ArticleDetail, ArticleVersion } from '../types';
import { ConfirmedArticleHeader } from './ConfirmedArticleHeader';

const version = (id: string, n: number): ArticleVersion => ({ id, version: n, hash: `hash-${id}`, frozen: true, containsImages: false, createdAt: '2026-11-07T00:00:00Z', createdBy: 'owner' });
const article: ArticleDetail = {
  id: 'a', title: '真实稿件长标题', status: 'frozen', currentVersion: 2, currentVersionId: 'a-v2', revision: 3,
  wordCount: 6, imageCount: 0, updatedAt: '2026-11-07T00:00:00Z', bodyText: '当前工作副本正文', images: [],
  versions: [version('a-v2', 2), version('a-v1', 1)], importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true },
};
const newDraft: ArticleDetail = { ...article, id: 'new', status: 'draft', currentVersion: 0, currentVersionId: undefined, versions: [] };
function frozenCopy(value: ArticleDetail): ArticleDetail {
  const snapshot = version(`${value.id}-latest`, value.currentVersion + 1);
  return { ...value, status: 'frozen', currentVersionId: snapshot.id, currentVersion: snapshot.version, versions: [snapshot, ...value.versions] };
}
function fixture(initial = article) {
  let current = initial;
  return {
    listArticles: vi.fn<PublisherGateway['listArticles']>().mockResolvedValue([initial]),
    getArticle: vi.fn<PublisherGateway['getArticle']>(async () => current),
    getArticleVersion: vi.fn<PublisherGateway['getArticleVersion']>(async id => current.versions.find(row => row.id === id)!),
    freezeArticle: vi.fn<PublisherGateway['freezeArticle']>(async () => { current = frozenCopy(current); return current; }),
    createDraft: vi.fn(), saveArticle: vi.fn(),
  };
}
function tree(gateway: ReturnType<typeof fixture>, onSelect = vi.fn(), props: Partial<React.ComponentProps<typeof ConfirmedArticleHeader>> = {}) {
  return <PublishingGatewayProvider gateway={gateway as unknown as PublisherGateway}>
    <ConfirmedArticleHeader rows={[]} onSelect={onSelect} {...props}/>
  </PublishingGatewayProvider>;
}
async function choose(id = 'a') {
  fireEvent.click(screen.getByRole('button', { name: /当前稿件/ }));
  const row = await screen.findByRole('radio', { name: new RegExp(`ID：${id}`) });
  fireEvent.click(row);
  const confirm = screen.getByRole('button', { name: '使用此稿件' });
  fireEvent.click(confirm); fireEvent.click(confirm);
}
afterEach(() => { cleanup(); configurePublishingHost({}); vi.restoreAllMocks(); });

describe('shared latest article header', () => {
  it('confirms once and binds the latest saved version without a second version dialog', async () => {
    const gateway = fixture(); const onSelect = vi.fn();
    render(tree(gateway, onSelect, { selectedVersionId: 'a-v1' }));
    expect(gateway.listArticles).not.toHaveBeenCalled();
    await choose();
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith({ article, version: article.versions[0] });
    expect(gateway.getArticleVersion).toHaveBeenCalledWith('a-v2', expect.any(AbortSignal));
    expect(screen.queryByRole('combobox', { name: '稿件版本' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(gateway.createDraft).not.toHaveBeenCalled();
    expect(gateway.saveArticle).not.toHaveBeenCalled();
    expect(gateway.freezeArticle).not.toHaveBeenCalled();
  });

  it.each([newDraft, { ...article, status: 'draft' as const, revision: 4, bodyText: '较新工作副本' }])('freezes the latest working copy, including a new draft without history', async draft => {
    const gateway = fixture(draft); const onSelect = vi.fn();
    render(tree(gateway, onSelect));
    await choose(draft.id);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(gateway.freezeArticle).toHaveBeenCalledTimes(1);
    expect(gateway.freezeArticle).toHaveBeenCalledWith(draft.id, draft.revision);
    expect(onSelect.mock.calls[0]![0]).toEqual({ article: frozenCopy(draft), version: frozenCopy(draft).versions[0] });
    expect(draft.versions).toEqual(draft.id === 'a' ? article.versions : []);
  });

  it('keeps the previous selection and picker on verification failure, then retries', async () => {
    const gateway = fixture(); const onSelect = vi.fn();
    gateway.getArticleVersion.mockResolvedValueOnce({ ...article.versions[0]!, hash: 'wrong-hash' });
    render(tree(gateway, onSelect, { rows: [{ id: 'previous', title: '原稿', version: 4 }] }));
    await choose();
    await screen.findByText('稿件或关联版本已失效，请重新选择。');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('原稿 · v4')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试载入' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  });

  it('shows a freeze failure without selecting an old historical snapshot', async () => {
    const gateway = fixture({ ...article, status: 'draft' }); const onSelect = vi.fn();
    gateway.freezeArticle.mockRejectedValueOnce(new Error('稿件已更新，请重新读取。'));
    render(tree(gateway, onSelect));
    await choose();
    await screen.findByText('稿件已更新，请重新读取。');
    expect(gateway.getArticleVersion).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cancels waiting for an unabortable freeze without a late binding', async () => {
    const gateway = fixture(newDraft); const onSelect = vi.fn();
    let resolve!: (value: ArticleDetail) => void;
    gateway.freezeArticle.mockImplementation(() => new Promise(done => { resolve = done; }));
    render(tree(gateway, onSelect));
    await choose(newDraft.id);
    await waitFor(() => expect(gateway.freezeArticle).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await act(async () => { resolve(frozenCopy(newDraft)); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(gateway.getArticleVersion).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open or freeze when the page guard is cancelled', () => {
    const gateway = fixture(); const onRequestSelect = vi.fn();
    render(tree(gateway, vi.fn(), { onRequestSelect }));
    fireEvent.click(screen.getByRole('button', { name: /当前稿件/ }));
    expect(onRequestSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(gateway.listArticles).not.toHaveBeenCalled();
    expect(gateway.freezeArticle).not.toHaveBeenCalled();
  });

  it('keeps the picker open when the page declines the resolved selection', async () => {
    const gateway = fixture(); const onSelect = vi.fn().mockResolvedValue(false);
    render(tree(gateway, onSelect));
    await choose();
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: '使用此稿件' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('makes a batch a read-only current list without replacement by one article', () => {
    const gateway = fixture(); const onSelect = vi.fn();
    render(tree(gateway, onSelect, { batch: true, rows: [{ id: 'a', title: '稿一', version: 2 }, { id: 'b', title: '稿二', version: 7, excluded: true }] }));
    expect(screen.queryByRole('button', { name: /当前稿件/ })).toBeNull();
    fireEvent.click(screen.getByText('2 篇稿件'));
    expect(screen.getByText('稿一')).toBeTruthy();
    expect(screen.getByText('v7 · 已从本批次排除')).toBeTruthy();
    expect(gateway.listArticles).not.toHaveBeenCalled();
  });

  it('invalidates an outstanding version read when the article scope changes', async () => {
    const gateway = fixture(); const onSelect = vi.fn();
    let resolve!: (value: ArticleVersion) => void;
    gateway.getArticleVersion.mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = render(tree(gateway, onSelect));
    await choose();
    await waitFor(() => expect(gateway.getArticleVersion).toHaveBeenCalledTimes(1));
    view.rerender(tree(gateway, onSelect, { selectedVersionId: 'other-v', rows: [{ id: 'other', title: '新的当前稿件', version: 5 }] }));
    await act(async () => { resolve(article.versions[0]!); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('新的当前稿件 · v5')).toBeTruthy();
  });

  it('does not cancel a new selection when the unchanged current header finishes loading', async () => {
    const gateway = fixture(); const onSelect = vi.fn();
    let resolve!: (value: ArticleVersion) => void;
    gateway.getArticleVersion.mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = render(tree(gateway, onSelect, { selectedVersionId: 'previous-v', loading: true }));
    await choose();
    await waitFor(() => expect(gateway.getArticleVersion).toHaveBeenCalledTimes(1));
    view.rerender(tree(gateway, onSelect, { selectedVersionId: 'previous-v', rows: [{ id: 'previous-v', title: '原稿', version: 4 }] }));
    await act(async () => { resolve(article.versions[0]!); });
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  });
});
