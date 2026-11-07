export type ConfirmedArticleIdentity = { articleId: string; versionId: string };

/** A read-only article selection retains publishing bindings only for the exact
 * same article/version. Callers pass an unbound page path for a new selection. */
export function confirmedArticleSelectionHref(
  path: string,
  search: string,
  next: ConfirmedArticleIdentity,
  current?: { articleId?: string; versionId?: string },
): string {
  const hashIndex = path.indexOf('#');
  const hash = hashIndex < 0 ? '' : path.slice(hashIndex);
  const [pathname, query] = (hashIndex < 0 ? path : path.slice(0, hashIndex)).split('?');
  const params = new URLSearchParams(search);
  const same = current?.articleId === next.articleId && current?.versionId === next.versionId;
  if (!same) {
    for (const key of ['draftId', 'workbenchTask', 'task', 'matrixTask', 'batchArticle', 'batchArticleVersion',
      'batchDraft', 'excludedDraft', 'returnTo', 'researchDataset', 'researchSelection']) params.delete(key);
  }
  const target = new URLSearchParams(query);
  for (const key of new Set(target.keys())) {
    params.delete(key);
    for (const value of target.getAll(key)) params.append(key, value);
  }
  params.set('articleId', next.articleId);
  params.set('articleVersion', next.versionId);
  return `${pathname}?${params.toString()}${hash}`;
}

/** A freshly chosen article must not inherit the host's still-mounted old task. */
export function isIndependentArticleSelection(search: string): boolean {
  const params = new URLSearchParams(search);
  return Boolean(params.get('articleId') && params.get('articleVersion') && !params.get('workbenchTask'));
}
