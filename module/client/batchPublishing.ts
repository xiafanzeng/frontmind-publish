/** Ordered server draft references. A draft still owns exactly one frozen article. */
export function readPublishingBatch(primaryId: string, search: string) {
  const params = new URLSearchParams(search);
  const draftIds = [...new Set([primaryId, ...params.getAll("batchDraft")].filter(Boolean))];
  const members = new Set(draftIds);
  const excludedDraftIds = [...new Set(params.getAll("excludedDraft"))]
    .filter((id) => members.has(id));
  return { draftIds, excludedDraftIds };
}

/** Keep project/task/filter context; only replace the group owned by this flow. */
export function withPublishingBatch(
  path: string,
  draftIds: string[],
  excludedDraftIds: string[] = [],
) {
  const url = new URL(path, "https://publishing.invalid");
  const ids = [...new Set(draftIds.filter(Boolean))];
  url.searchParams.delete("batchDraft");
  url.searchParams.delete("excludedDraft");
  if (ids.length > 1) {
    ids.forEach((id) => url.searchParams.append("batchDraft", id));
    url.searchParams.set("mode", "batch");
  }
  for (const id of new Set(excludedDraftIds)) {
    if (ids.includes(id)) url.searchParams.append("excludedDraft", id);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
