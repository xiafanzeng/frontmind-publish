import type { Row } from './common.js';

/** Supplier ranking names are display strings; matching normalizes common
 * punctuation/spacing variants so 「新浪财经」==「新浪财经 」without inventing
 * identity beyond the exact normalized name. Domain-level aliasing is not
 * attempted: an unmatched name stays reference-only, never a purchasable fact. */
export function normalizeMediaName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000·・•．.,，、;；:：!！?？'"“”‘’()（）\[\]【】<>《》\-—_~]/g, '')
    .replace(/\.(com|cn|net|org|com\.cn|net\.cn|org\.cn)$/,'');
}

export interface IndustryRankingItem { rank: number; code: string | null; name: string; citation_count: string | null }

export function industryRankingItems(ranking: unknown): IndustryRankingItem[] {
  const snapshot = ranking && typeof ranking === 'object' && !Array.isArray(ranking) ? ranking as Row : {};
  if (snapshot.status !== 'ok' || !Array.isArray(snapshot.items)) return [];
  return snapshot.items.flatMap((item: unknown, index: number) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Row : {};
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) return [];
    return [{
      rank: Number.isSafeInteger(row.rank) && (row.rank as number) > 0 ? row.rank as number : index + 1,
      code: typeof row.code === 'string' && row.code.trim() ? row.code.trim() : null,
      name,
      citation_count: typeof row.citation_count === 'string' ? row.citation_count : null,
    }];
  });
}

export interface RankingAttachment { ranking: Row | null; matched: Map<string, IndustryRankingItem>; unmatched: IndustryRankingItem[] }

/** Rank matching is name-exact after normalization and only attaches to real
 * catalogue resources; research-only or observed candidates never inherit a
 * supplier ranking as a purchasable identity. */
export function attachIndustryRanking(candidates: Row[], ranking: unknown): RankingAttachment {
  const items = industryRankingItems(ranking);
  if (!items.length || !candidates.length) return { ranking: ranking && typeof ranking === 'object' ? ranking as Row : null, matched: new Map(), unmatched: items };
  const byName = new Map<string, IndustryRankingItem>();
  for (const item of items) {
    const key = normalizeMediaName(item.name);
    if (key && !byName.has(key)) byName.set(key, item);
  }
  const matched = new Map<string, IndustryRankingItem>(), used = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.resource_id) continue;
    const attributes = candidate.attributes ?? {};
    const key = normalizeMediaName(attributes.source_name ?? attributes.name);
    if (!key || used.has(key)) continue;
    const hit = byName.get(key);
    if (!hit) continue;
    used.add(key);
    matched.set(String(candidate.candidate_id), hit);
    candidate.industry_rank = { rank: hit.rank, code: hit.code, citation_count: hit.citation_count };
  }
  const unmatched = items.filter(item => !used.has(normalizeMediaName(item.name)));
  return { ranking: ranking && typeof ranking === 'object' ? ranking as Row : null, matched, unmatched };
}

/** Catalogue rows keep raw supplier names; the pinned-resource lookup uses the
 * same normalization so an already-retained resource is never double-added. */
export function rankingNamesMissingFromCatalog(names: readonly string[], catalog: Row[]): string[] {
  const present = new Set(catalog.map(row => normalizeMediaName(row.source_name ?? row.name)).filter(Boolean));
  return [...new Set(names.map(name => String(name ?? '').trim()).filter(Boolean))].filter(name => !present.has(normalizeMediaName(name)));
}
