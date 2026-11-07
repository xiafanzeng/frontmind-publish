import type { PublisherGateway } from './gateway';
import type { ArticleDetail, ArticleVersion } from './types';

/** The detail is a working copy; downstream publishing reads the verified
 * immutable version by its ID, never substitutes the working body for it. */
export type LatestArticleSelection = { article: ArticleDetail; version: ArticleVersion };
export type LatestArticleSelectionOptions = {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  /** Editors pin the revision they just saved instead of adopting another edit. */
  expectedRevision?: number;
};

function cancelled() {
  const error = new Error('稿件选择已取消。');
  error.name = 'AbortError';
  return error;
}

function assertCurrent({ signal, isCurrent }: LatestArticleSelectionOptions) {
  if (signal?.aborted || isCurrent?.() === false) throw cancelled();
}

/** Abort waiting even when a gateway cannot cancel an already-issued freeze.
 * Its completion may create a snapshot, but cannot resume a cancelled binding. */
function waitFor<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

function verifySelection(article: ArticleDetail, version: ArticleVersion,
  identity: { articleId: string; versionId: string }): LatestArticleSelection {
  const member = article.versions.find(item => item.id === identity.versionId && item.frozen);
  if (article.id !== identity.articleId || !member || version.id !== identity.versionId || !version.frozen ||
    !version.hash || version.hash !== member.hash || version.version !== member.version) {
    throw new Error('稿件或关联版本已失效，请重新选择。');
  }
  return { article, version };
}

/** Restore an exact saved binding without freezing or moving historical drafts
 * to a newer working copy. The caller owns request-scope cancellation. */
export async function readVerifiedArticleSelection(gateway: PublisherGateway,
  identity: { articleId: string; versionId: string }, signal?: AbortSignal): Promise<LatestArticleSelection> {
  assertCurrent({ signal });
  const [article, version] = await waitFor(Promise.all([
    gateway.getArticle(identity.articleId, signal),
    gateway.getArticleVersion(identity.versionId, signal),
  ]), signal);
  assertCurrent({ signal });
  return verifySelection(article, version, identity);
}

/** Resolve the latest saved working copy through the existing revision-checked
 * freeze operation. Conflicts fail visibly; old snapshots are never a fallback. */
export async function resolveLatestArticleSelection(gateway: PublisherGateway, articleId: string,
  options: LatestArticleSelectionOptions = {}): Promise<LatestArticleSelection> {
  assertCurrent(options);
  const saved = await waitFor(gateway.getArticle(articleId, options.signal), options.signal);
  assertCurrent(options);
  if (saved.id !== articleId || saved.status === 'importing' || saved.status === 'import_failed') {
    throw new Error('所选稿件当前不可用，请重新选择。');
  }
  if (options.expectedRevision !== undefined && saved.revision !== options.expectedRevision) {
    throw new Error('稿件已在其他位置更新，请重新读取并保存后再选择媒体。');
  }
  let article = saved;
  const current = saved.versions.find(item => item.id === saved.currentVersionId && item.frozen);
  if (saved.status !== 'frozen' || !current) {
    assertCurrent(options);
    article = await waitFor(gateway.freezeArticle(articleId, saved.revision), options.signal);
    assertCurrent(options);
  }
  if (article.id !== articleId || article.status !== 'frozen' || !article.currentVersionId || article.revision !== saved.revision ||
    (saved.status !== 'frozen' && saved.currentVersionId && article.currentVersionId === saved.currentVersionId)) {
    throw new Error('稿件在关联期间已更新，请重新选择以使用最新内容。');
  }
  const versionId = article.currentVersionId;
  const version = await waitFor(gateway.getArticleVersion(versionId, options.signal), options.signal);
  assertCurrent(options);
  verifySelection(article, version, { articleId, versionId });
  if (article.currentVersion !== version.version || (article.currentVersionHash && article.currentVersionHash !== version.hash)) {
    throw new Error('稿件当前版本不一致，请重新选择。');
  }
  // A save racing with either freeze's detail reread or the version read must
  // not let the preceding immutable snapshot masquerade as the latest content.
  const latest = await waitFor(gateway.getArticle(articleId, options.signal), options.signal);
  assertCurrent(options);
  if (latest.revision !== article.revision || latest.status !== 'frozen' || latest.currentVersionId !== versionId ||
    latest.currentVersion !== version.version || (latest.currentVersionHash && latest.currentVersionHash !== version.hash)) {
    throw new Error('稿件在关联期间已更新，请重新选择以使用最新内容。');
  }
  return verifySelection(latest, version, { articleId, versionId });
}
