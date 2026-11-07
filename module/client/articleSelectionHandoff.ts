import type { PublisherGateway } from './gateway';
import type { LatestArticleSelection } from './latestArticleSelection';

type PendingSelection = {
  workspaceKey: number | undefined;
  selection: LatestArticleSelection;
  expiresAt: number;
};
const pendingSelections = new WeakMap<PublisherGateway, PendingSelection>();

/** Transfer an already verified binding to the immediately following route.
 * This is neither persistent storage nor a substitute for server revalidation. */
export function prepareArticleSelection(
  gateway: PublisherGateway,
  workspaceKey: number | undefined,
  selection: LatestArticleSelection,
) {
  pendingSelections.set(gateway, { workspaceKey, selection, expiresAt: Date.now() + 60_000 });
}

/** Consume from a load/effect, never render. A different identity cannot adopt it. */
export function consumePreparedArticleSelection(
  gateway: PublisherGateway,
  workspaceKey: number | undefined,
  articleId: string,
  versionId: string,
) {
  const pending = pendingSelections.get(gateway);
  if (!pending) return undefined;
  pendingSelections.delete(gateway);
  if (pending.workspaceKey !== workspaceKey || pending.expiresAt <= Date.now()
    || pending.selection.article.id !== articleId || pending.selection.version.id !== versionId) return undefined;
  return pending.selection;
}
