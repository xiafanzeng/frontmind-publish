import type { PublisherGateway } from "./gateway";
import type { ArticleDetail } from "./types";

type PendingArticle = { scope: string; article: ArticleDetail };
const pendingArticles = new WeakMap<PublisherGateway, PendingArticle>();

/** One read-only handoff to the immediately following editor route. Never persisted. */
export function prepareArticleEditor(gateway: PublisherGateway, scope: string, article: ArticleDetail) {
  pendingArticles.set(gateway, { scope, article });
}

/** Consumed by the editor load effect, not during render (including StrictMode). */
export function consumePreparedArticle(gateway: PublisherGateway, scope: string, articleId: string) {
  const pending = pendingArticles.get(gateway);
  if (!pending) return undefined;
  pendingArticles.delete(gateway);
  if (pending.scope !== scope || pending.article.id !== articleId) return undefined;
  return pending.article;
}

