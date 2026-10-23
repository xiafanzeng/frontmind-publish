// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createServerBackedPublisherGateway, type PublisherTrpcClient } from './ProductionPublishingEntry';

// Routing is unrelated to the gateway contract; all article lookup code stays real.
vi.mock('./PublishingRoutes', () => ({ default: () => null }));

const articleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const firstVersionId = '11111111-1111-4111-8111-111111111111';
const currentVersionId = '22222222-2222-4222-8222-222222222222';
const missingVersionId = '33333333-3333-4333-8333-333333333333';
const assetId = '44444444-4444-4444-8444-444444444444';
const createdAt = '2026-10-23T00:00:00.000Z';
const versions = [
  { id: firstVersionId, articleId, version: 1, contentHash: 'a'.repeat(64), containsImages: false, createdAt },
  { id: currentVersionId, articleId, version: 2, contentHash: 'b'.repeat(64), containsImages: true, createdAt },
];
const summary = {
  id: articleId, workingName: '测试稿件', suggestedTitle: '测试标题', status: 'ready',
  currentVersionId, currentVersion: 2, containsImages: true, revision: 4, createdAt, updatedAt: createdAt,
};
const asset = {
  id: assetId, articleId, sha256: 'c'.repeat(64), mimeType: 'image/png', width: 100,
  height: 100, sizeBytes: 128, altText: '工作副本图片', isFrozen: false, createdAt,
};
type ListResult = { items: typeof summary[]; nextCursor: null };
type QueryOptions = { signal?: AbortSignal };

function setup({ workingCopyHasImages = true, listResult }: {
  workingCopyHasImages?: boolean;
  listResult?: Promise<ListResult>;
} = {}) {
  let currentScope = true;
  const list = vi.fn(async (_input: { limit: number; cursor?: string }, _options?: QueryOptions) =>
    listResult ?? { items: [{ ...summary, containsImages: workingCopyHasImages }], nextCursor: null });
  const get = vi.fn(async ({ articleId: requested }: { articleId: string }, _options?: QueryOptions) => {
    if (requested !== articleId) throw new Error('Unexpected article');
    return {
      ...summary, containsImages: workingCopyHasImages, editorJson: { type: 'doc', content: [] },
      canonicalHtml: workingCopyHasImages
        ? `<p>工作副本</p><img data-asset-id="${assetId}" src="https://example.test/private-image" alt="工作副本图片">`
        : '<p>工作副本</p>',
      plainText: '工作副本', contentHash: 'd'.repeat(64),
    };
  });
  const assets = vi.fn(async ({ articleId: requested }: { articleId: string }, _options?: QueryOptions) => {
    if (requested !== articleId) throw new Error('Unexpected article');
    return workingCopyHasImages ? [asset] : [];
  });
  const versionList = vi.fn(async ({ articleId: requested }: { articleId: string }, _options?: QueryOptions) => {
    if (requested !== articleId) throw new Error('Unexpected article');
    return versions;
  });
  const client = { publisher: { articles: {
    list: { query: list }, get: { query: get }, assets: { query: assets }, versions: { query: versionList },
  } } } as unknown as PublisherTrpcClient;
  const fetch = vi.fn(async () => { throw new Error('Image previews must not be downloaded to read version metadata'); });
  const gateway = createServerBackedPublisherGateway(client, {
    fetch,
    captureOperation: () => {
      if (!currentScope) throw new Error('工作区已切换');
      return { fetch };
    },
  });
  return { gateway, list, get, assets, versionList, fetch, leaveScope: () => { currentScope = false; } };
}

describe('frozen article version selection metadata', () => {
  it('returns the requested current frozen version, independent of the working-copy image flag', async () => {
    const { gateway } = setup({ workingCopyHasImages: false });
    expect(await gateway.getArticleVersion(currentVersionId)).toEqual({
      id: currentVersionId, version: 2, hash: 'b'.repeat(64), containsImages: true,
      frozen: true, createdAt, createdBy: '当前账号',
    });
  });

  it('resolves a historical frozen version without downloading working-copy image previews', async () => {
    const { gateway, fetch } = setup();
    expect(await gateway.getArticleVersion(firstVersionId)).toEqual({
      id: firstVersionId, version: 1, hash: 'a'.repeat(64), containsImages: false,
      frozen: true, createdAt, createdBy: '当前账号',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the not_found error when the exact version does not exist', async () => {
    const { gateway } = setup();
    await expect(gateway.getArticleVersion(missingVersionId)).rejects.toMatchObject({
      name: 'PublisherGatewayError', code: 'not_found',
    });
  });

  it('rejects an already aborted request even when the version is cached', async () => {
    const { gateway } = setup();
    await gateway.getArticleVersion(currentVersionId);
    const controller = new AbortController();
    controller.abort();
    await expect(gateway.getArticleVersion(currentVersionId, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes cancellation to the existing lookup and rejects a late result after abort', async () => {
    let resolve!: (value: ListResult) => void;
    const listResult = new Promise<ListResult>(yes => { resolve = yes; });
    const { gateway, list } = setup({ listResult });
    const controller = new AbortController();
    const request = gateway.getArticleVersion(currentVersionId, controller.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    resolve({ items: [summary], nextCursor: null });
    await rejection;
    expect(list.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('keeps the host operation guard in front of cached version reads', async () => {
    const { gateway, leaveScope } = setup();
    await gateway.getArticleVersion(currentVersionId);
    leaveScope();
    expect(() => gateway.getArticleVersion(currentVersionId)).toThrow('工作区已切换');
  });
});
