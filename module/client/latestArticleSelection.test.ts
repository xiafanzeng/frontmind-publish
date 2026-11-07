// Source-only regressions; execute only in the final merged repository.
import { describe, expect, it, vi } from 'vitest';
import type { PublisherGateway } from './gateway';
import type { ArticleDetail, ArticleVersion } from './types';
import { readVerifiedArticleSelection, resolveLatestArticleSelection } from './latestArticleSelection';

const oldVersion: ArticleVersion = { id: 'a-v1', version: 1, hash: 'old-hash', frozen: true, containsImages: false, createdAt: '2026-11-07T00:00:00Z', createdBy: 'owner' };
const newVersion: ArticleVersion = { ...oldVersion, id: 'a-v2', version: 2, hash: 'latest-hash' };
const working: ArticleDetail = {
  id: 'a', title: '最新标题', status: 'draft', revision: 4, currentVersion: 1, currentVersionId: oldVersion.id,
  wordCount: 4, imageCount: 0, updatedAt: '2026-11-08T00:00:00Z', bodyText: '最新正文', images: [], versions: [oldVersion],
  importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true },
};
const frozen: ArticleDetail = { ...working, status: 'frozen', currentVersion: 2, currentVersionId: newVersion.id, currentVersionHash: newVersion.hash, versions: [newVersion, oldVersion] };
function fixture(initial = working) {
  let current = initial;
  const calls = {
    getArticle: vi.fn<PublisherGateway['getArticle']>(async () => current),
    freezeArticle: vi.fn<PublisherGateway['freezeArticle']>(async () => { current = frozen; return current; }),
    getArticleVersion: vi.fn<PublisherGateway['getArticleVersion']>(async id => id === newVersion.id ? newVersion : oldVersion),
    saveArticle: vi.fn(), createDraft: vi.fn(),
  };
  return { calls, gateway: calls as unknown as PublisherGateway };
}

describe('latest article selection', () => {
  it('creates a real snapshot of the changed working copy and leaves historical rows intact', async () => {
    const { calls, gateway } = fixture();
    const result = await resolveLatestArticleSelection(gateway, working.id, { expectedRevision: working.revision });
    expect(result).toEqual({ article: frozen, version: newVersion });
    expect(calls.freezeArticle).toHaveBeenCalledTimes(1);
    expect(calls.freezeArticle).toHaveBeenCalledWith(working.id, working.revision);
    expect(calls.getArticleVersion).toHaveBeenCalledWith(newVersion.id, undefined);
    expect(working.versions).toEqual([oldVersion]);
    expect(calls.saveArticle).not.toHaveBeenCalled();
    expect(calls.createDraft).not.toHaveBeenCalled();
  });

  it('supports a new saved draft without a previously confirmed version', async () => {
    const { calls, gateway } = fixture({ ...working, currentVersion: 0, currentVersionId: undefined, versions: [] });
    expect((await resolveLatestArticleSelection(gateway, working.id)).version.id).toBe(newVersion.id);
    expect(calls.freezeArticle).toHaveBeenCalledTimes(1);
  });

  it('reuses the exact current snapshot when the saved working copy is still frozen', async () => {
    const { calls, gateway } = fixture(frozen);
    expect(await resolveLatestArticleSelection(gateway, frozen.id)).toEqual({ article: frozen, version: newVersion });
    expect(calls.freezeArticle).not.toHaveBeenCalled();
    expect(calls.getArticle).toHaveBeenCalledTimes(2);
  });

  it('rejects an editor revision changed by another session before freezing', async () => {
    const { calls, gateway } = fixture();
    await expect(resolveLatestArticleSelection(gateway, working.id, { expectedRevision: 3 })).rejects.toThrow('其他位置更新');
    expect(calls.freezeArticle).not.toHaveBeenCalled();
  });

  it('never falls back to the old snapshot when freezing fails', async () => {
    const { calls, gateway } = fixture();
    calls.freezeArticle.mockRejectedValueOnce(new Error('revision conflict'));
    await expect(resolveLatestArticleSelection(gateway, working.id)).rejects.toThrow('revision conflict');
    expect(calls.getArticleVersion).not.toHaveBeenCalled();
  });

  it('rejects a freeze result that still points at the preceding working copy snapshot', async () => {
    const { calls, gateway } = fixture();
    calls.freezeArticle.mockResolvedValueOnce({ ...working, status: 'frozen' });
    await expect(resolveLatestArticleSelection(gateway, working.id)).rejects.toThrow('关联期间已更新');
    expect(calls.getArticleVersion).not.toHaveBeenCalled();
  });

  it('rejects a concurrent save observed after the version read', async () => {
    const { calls, gateway } = fixture(frozen);
    calls.getArticle.mockResolvedValueOnce(frozen).mockResolvedValueOnce({ ...working, revision: 5 });
    await expect(resolveLatestArticleSelection(gateway, working.id)).rejects.toThrow('关联期间已更新');
  });

  it('rejects a concurrent save included in the freeze gateway reread', async () => {
    const { calls, gateway } = fixture();
    calls.freezeArticle.mockResolvedValueOnce({ ...working, revision: 5 });
    await expect(resolveLatestArticleSelection(gateway, working.id)).rejects.toThrow('关联期间已更新');
    expect(calls.getArticleVersion).not.toHaveBeenCalled();
  });

  it('stops after a cancelled freeze even when the underlying mutation completes later', async () => {
    const { calls, gateway } = fixture();
    let resolve!: (value: ArticleDetail) => void;
    let started!: () => void;
    const freezeStarted = new Promise<void>(done => { started = done; });
    calls.freezeArticle.mockImplementation(() => { started(); return new Promise(done => { resolve = done; }); });
    const controller = new AbortController();
    const result = resolveLatestArticleSelection(gateway, working.id, { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await freezeStarted;
    controller.abort();
    await rejected;
    resolve(frozen);
    expect(calls.getArticleVersion).not.toHaveBeenCalled();
  });

  it('rejects a stale operation before any read or freeze', async () => {
    const { calls, gateway } = fixture();
    await expect(resolveLatestArticleSelection(gateway, working.id, { isCurrent: () => false })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.getArticle).not.toHaveBeenCalled();
    expect(calls.freezeArticle).not.toHaveBeenCalled();
  });
});

describe('read-only saved article binding', () => {
  it('restores an explicitly bound historical version without refreshing or freezing it', async () => {
    const { calls, gateway } = fixture(frozen);
    expect(await readVerifiedArticleSelection(gateway, { articleId: working.id, versionId: oldVersion.id })).toEqual({ article: frozen, version: oldVersion });
    expect(calls.freezeArticle).not.toHaveBeenCalled();
    expect(calls.saveArticle).not.toHaveBeenCalled();
  });

  it.each([
    { ...oldVersion, id: 'other-version' },
    { ...oldVersion, hash: 'wrong-hash' },
    { ...oldVersion, version: 9 },
    { ...oldVersion, frozen: false },
  ])('rejects mismatched immutable metadata', async version => {
    const { calls, gateway } = fixture(frozen);
    calls.getArticleVersion.mockResolvedValueOnce(version);
    await expect(readVerifiedArticleSelection(gateway, { articleId: working.id, versionId: oldVersion.id })).rejects.toThrow('已失效');
  });

  it('rejects a version not owned by the returned article', async () => {
    const { calls, gateway } = fixture({ ...frozen, versions: [newVersion] });
    await expect(readVerifiedArticleSelection(gateway, { articleId: working.id, versionId: oldVersion.id })).rejects.toThrow('已失效');
    calls.getArticle.mockResolvedValueOnce({ ...frozen, id: 'another-article' });
    await expect(readVerifiedArticleSelection(gateway, { articleId: working.id, versionId: oldVersion.id })).rejects.toThrow('已失效');
  });
});
