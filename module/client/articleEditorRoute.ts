/** Open a real article without inheriting another article's publishing bindings. */
export function articleEditorHref(
  articleId: string,
  search = "",
  options: { mode?: "single" | "multi" | "batch"; retainArticleContext?: boolean } = {},
): string {
  const source = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const name of ["operatorOwnerId", "enterpriseProjectId"]) {
    const value = source.get(name);
    if (value) params.set(name, value);
  }
  const requestedMode = options.mode ?? source.get("mode");
  if (requestedMode === "single" || requestedMode === "multi" ||
      (requestedMode === "batch" && options.retainArticleContext)) {
    params.set("mode", requestedMode);
  }
  // The caller must establish that this is the same article, never merely a
  // similarly named row. A list/other-article selection has no such proof.
  if (options.retainArticleContext) {
    for (const name of ["workbenchTask", "task", "matrixTask", "draftId", "articleVersion", "returnTo",
      "batchArticle", "batchArticleVersion", "batchDraft", "excludedDraft", "titleMode"]) {
      for (const value of source.getAll(name)) if (value) params.append(name, value);
    }
  }
  return `/publishing/articles/${encodeURIComponent(articleId)}/edit${params.size ? `?${params}` : ""}`;
}

