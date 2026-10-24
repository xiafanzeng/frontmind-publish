// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createServerBackedPublisherGateway, type PublisherTrpcClient } from './ProductionPublishingEntry';
import { mediaSelectionBlocker } from './mediaShortlist';
import { DEFAULT_MEDIA_FILTERS } from './queryState';

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

const mediaId = '55555555-5555-4555-8555-555555555555';
const draftId = '66666666-6666-4666-8666-666666666666';
type ImageSupportFixture = 'unknown' | 'verified' | 'unsupported' | null | undefined;

// Start at the API boundary rather than constructing an already-normalized
// MediaResource. Null/missing fields also exercise legacy response handling.
function mediaResponse(imageSupport: ImageSupportFixture) {
  return {
    id: mediaId, externalResourceId: '967', name: '网易-科技', kind: 'news',
    platform: '网易', taxonomy: 'IT科技', area: '全国', mediaType: '新闻',
    priceTenThousandths: '3850000', catalogRevision: 'catalog-current',
    titleLimit: null, publishSpeed: '1小时', isActive: true,
    successRateBasisPoints: null, includeRateBasisPoints: null,
    authenticated: null, festivalPublishable: null, recommended: null,
    fanCount: null, likeCount: null, publishCount: null,
    ...(imageSupport === undefined ? {} : { imageSupport }),
  };
}

function setupMediaSelection(imageSupport: ImageSupportFixture, remark?: string) {
  const rawMedia = { ...mediaResponse(imageSupport), ...(remark ? { remark } : {}) };
  const draftItem = {
    id: 'selection-1', mediaResource: rawMedia, submissionTitle: summary.suggestedTitle,
    selectedPriceTenThousandths: '3850000', selectedCatalogRevision: 'catalog-selected',
  };
  let storedDraft = {
    id: draftId, articleVersionId: currentVersionId, revision: 1,
    titleMode: 'single', sharedTitle: summary.suggestedTitle, updatedAt: createdAt,
    items: [draftItem],
  };
  const list = vi.fn(async () => ({
    items: [rawMedia], total: 1, page: 1, pageSize: 50,
    catalogRevision: 'catalog-current', catalogSyncedAt: createdAt,
    catalogStale: false, kindComplete: true,
  }));
  const getDraft = vi.fn(async () => storedDraft);
  const saveDraft = vi.fn(async (input: {
    articleVersionId: string; expectedRevision: number; draftId?: string;
    items: Array<{ mediaResourceId: string; submissionTitle?: string }>;
  }) => {
    if (input.items.some(item => item.mediaResourceId !== mediaId)) throw new Error('Unexpected media id');
    storedDraft = {
      ...storedDraft, articleVersionId: input.articleVersionId,
      revision: input.expectedRevision + 1,
      items: input.items.map(item => ({
        ...draftItem, submissionTitle: item.submissionTitle ?? draftItem.submissionTitle,
      })),
    };
    return storedDraft;
  });
  const preflight = vi.fn(async () => ({
    articleVersionId: currentVersionId, articleContentHash: 'b'.repeat(64),
    articleCanonicalHtml: '<p>冻结内容</p>', articlePlainText: '冻结内容',
    preflightRevision: 'preflight-1', quoteFingerprint: 'quote-1', mode: 'live',
    expiresAt: createdAt, catalogRevision: 'catalog-current', titleMode: 'single',
    kindCounts: { news: 1, selfMedia: 0 }, totalTenThousandths: '3850000',
    availableTenThousandths: '10000000', availableAfterReservationTenThousandths: '6150000',
    sufficientFunds: true, blockers: [], warnings: [],
    items: [{
      mediaResourceId: mediaId, mediaName: rawMedia.name, mediaKind: 'news',
      submissionTitle: summary.suggestedTitle, priceTenThousandths: '3850000',
      imageSupport: imageSupport ?? 'unknown', warnings: [],
      blockers: imageSupport === 'unsupported'
        ? [{ code: 'IMAGE_NOT_SUPPORTED', message: '此媒体明确不支持图片' }] : [],
    }],
  }));
  const getBatch = vi.fn(async () => ({
    id: 'batch-1', articleVersionId: currentVersionId, mode: 'live',
    status: 'completed', titleMode: 'single', quotedTotalTenThousandths: '3850000',
    kindCounts: { news: 1, selfMedia: 0 }, createdAt, updatedAt: createdAt,
    article: { ...summary, version: 2, contentHash: 'b'.repeat(64) },
    items: [{
      id: 'historical-item-1', mediaName: rawMedia.name, mediaKind: 'news',
      platform: '网易', priceTenThousandths: '3850000', submissionTitle: summary.suggestedTitle,
      status: 'success', fundsStatus: 'consumed', completedAt: createdAt,
    }],
  }));
  const client = { publisher: {
    articles: {
      list: { query: vi.fn(async () => ({ items: [summary], nextCursor: null })) },
      get: { query: vi.fn(async () => summary) },
      assets: { query: vi.fn(async () => [asset]) },
      versions: { query: vi.fn(async () => versions) },
    },
    media: { list: { query: list } },
    drafts: { get: { query: getDraft }, save: { mutate: saveDraft }, preflight: { mutate: preflight } },
    dashboard: { query: vi.fn(async () => ({ wallet: { reservedTenThousandths: '0', frozenTenThousandths: '0' } })) },
    batches: { get: { query: getBatch } },
  } } as unknown as PublisherTrpcClient;
  const fetch = vi.fn(async () => { throw new Error('Gateway fixtures must not use the network'); });
  const newGateway = () => createServerBackedPublisherGateway(client, { fetch });
  return { gateway: newGateway(), newGateway, rawMedia, list, saveDraft, getDraft, preflight, storedDraft };
}

describe('image eligibility across the API gateway boundary', () => {
  it.each([
    ['unknown', 'image_pending', false],
    [null, 'image_pending', false],
    [undefined, 'image_pending', false],
    ['verified', 'image', false],
    ['unsupported', 'text', true],
  ] as const)('preserves API imageSupport %s without inventing a verified capability', async (support, capability, blocked) => {
    const { gateway, rawMedia } = setupMediaSelection(support);
    const result = await gateway.listMedia(DEFAULT_MEDIA_FILTERS);
    const media = result.items[0]!;
    expect(media.capability).toBe(capability);
    expect(Boolean(mediaSelectionBlocker(media, true))).toBe(blocked);
    expect(mediaSelectionBlocker(media, false)).toBe('');
    expect(rawMedia.imageSupport).toBe(support);
  });

  it('keeps unknown selections, price snapshots and frozen image context through save, reload and cancellation', async () => {
    const { gateway, newGateway, saveDraft, rawMedia } = setupMediaSelection('unknown');
    const page = await gateway.listMedia(DEFAULT_MEDIA_FILTERS);
    expect(mediaSelectionBlocker(page.items[0]!, true)).toBe('');
    const saved = await gateway.createDraft(currentVersionId, [mediaId], 'selection-key', 'single');
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      articleVersionId: currentVersionId, expectedRevision: 0,
      items: [{ mediaResourceId: mediaId, submissionTitle: summary.suggestedTitle }],
    }));
    expect(saved).toMatchObject({
      articleVersionId: currentVersionId, articleContainsImages: true, revision: 1,
      items: [{ media: { id: mediaId, capability: 'image_pending', priceTenThousandths: '3850000', catalogRevision: 'catalog-selected' } }],
    });
    // A fresh gateway has no draft, media or version cache from the first page.
    const reopened = newGateway();
    const restored = await reopened.getDraft(draftId);
    expect(restored).toEqual(saved);
    expect(mediaSelectionBlocker(restored.items[0]!.media, restored.articleContainsImages)).toBe('');
    const cleared = await reopened.updateDraftMedia(draftId, [], restored.revision);
    expect(cleared.items).toEqual([]);
    const selectedAgain = await reopened.updateDraftMedia(draftId, [mediaId], cleared.revision);
    expect(selectedAgain.items[0]?.media.capability).toBe('image_pending');
    expect(rawMedia.imageSupport).toBe('unknown');
    expect(saveDraft).toHaveBeenCalledTimes(3);
  });

  it('retains an explicitly unsupported media snapshot when reopening a draft', async () => {
    const { gateway } = setupMediaSelection('unsupported');
    const draft = await gateway.getDraft(draftId);
    expect(draft.items[0]?.media.capability).toBe('text');
    expect(mediaSelectionBlocker(draft.items[0]!.media, true)).not.toBe('');
  });

  it.each(['不支持图片', '仅限纯文字'])('keeps an explicit supplier prohibition in the mapped remark: %s', async (remark) => {
    const { gateway, rawMedia } = setupMediaSelection('unknown', remark);
    const page = await gateway.listMedia(DEFAULT_MEDIA_FILTERS);
    const media = page.items[0]!;
    expect(media.remark).toBe(remark);
    expect(media.capability).toBe('image_pending');
    expect(mediaSelectionBlocker(media, true)).not.toBe('');
    expect(mediaSelectionBlocker(media, false)).toBe('');
    expect(rawMedia.imageSupport).toBe('unknown');
  });

  it('propagates failed reads and writes rather than replacing them with an unknown-capability success', async () => {
    const { gateway, list, getDraft, saveDraft } = setupMediaSelection('unknown');
    list.mockRejectedValueOnce(new Error('读取失败'));
    await expect(gateway.listMedia(DEFAULT_MEDIA_FILTERS)).rejects.toMatchObject({ message: '读取失败' });
    getDraft.mockRejectedValueOnce(new Error('草稿读取失败'));
    await expect(gateway.getDraft(draftId)).rejects.toMatchObject({ message: '草稿读取失败' });
    saveDraft.mockRejectedValueOnce(new Error('保存失败'));
    await expect(gateway.createDraft(currentVersionId, [mediaId])).rejects.toMatchObject({ message: '保存失败' });
    const retried = await gateway.listMedia(DEFAULT_MEDIA_FILTERS);
    expect(mediaSelectionBlocker(retried.items[0]!, true)).toBe('');
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it.each(['unknown', 'unsupported'] as const)('preserves %s from preflight when a draft row cannot be matched', async (support) => {
    const { gateway, getDraft, storedDraft } = setupMediaSelection(support);
    getDraft.mockResolvedValueOnce({ ...storedDraft, items: [] });
    const preflight = await gateway.preflightDraft(draftId);
    const item = preflight.items[0]!;
    expect(item.media.capability).toBe(support === 'unsupported' ? 'text' : 'image_pending');
    expect(Boolean(mediaSelectionBlocker(item.media, true))).toBe(support === 'unsupported');
    // Server blockers remain authoritative; the mapper must not erase them.
    expect(item.blockers).toEqual(support === 'unsupported' ? ['此媒体明确不支持图片'] : []);
  });

  it('does not claim historical batch rows without capability metadata are text-only', async () => {
    const batch = await setupMediaSelection('unknown').gateway.getBatch('batch-1');
    expect(batch.items[0]?.media.capability).toBe('image_pending');
  });
});
