import type { IndustryCatalogResponse } from '../../shared/industry-catalog';

export type SavedIndustryResolution = { id: string | null; reason: 'missing' | 'unmapped' | 'ambiguous' | null };

/** Resolve persisted identities only against the complete authorized directory.
 * A duplicate label never arbitrarily chooses the first branch. */
export function resolveSavedTaskIndustry(task: Record<string, unknown>, catalog: IndustryCatalogResponse): SavedIndustryResolution {
  const valid = new Set(catalog.industries.map(item => item.id));
  const canonical = typeof task.industry_id === 'string' ? task.industry_id : '';
  if (canonical && valid.has(canonical)) return { id: canonical, reason: null };
  const legacy = typeof task.industry_dataset_id === 'string' ? task.industry_dataset_id : canonical;
  if (legacy) {
    const mapping = catalog.legacyMappings.find(item => item.localId === legacy);
    if (mapping) return mapping.status === 'mapped' && mapping.canonicalId && valid.has(mapping.canonicalId)
      ? { id: mapping.canonicalId, reason: null }
      : { id: null, reason: mapping.status === 'ambiguous' ? 'ambiguous' : 'unmapped' };
  }
  const name = typeof task.industry === 'string' ? task.industry.trim() : '';
  if (!name) return { id: null, reason: canonical || legacy ? 'unmapped' : 'missing' };
  const matched = catalog.industries.filter(item => item.name === name || item.path.join(' / ') === name);
  return matched.length === 1 ? { id: matched[0]!.id, reason: null } : { id: null, reason: matched.length ? 'ambiguous' : 'unmapped' };
}

/** Only the original requirement snapshot changes identity here; current manual
 * fields remain untouched and still compare stale against that snapshot. */
export function canonicalizeMatrixInputIndustry(snapshot: string | null, industryId: string): string | null {
  if (!snapshot) return snapshot;
  try {
    const input: unknown = JSON.parse(snapshot);
    if (!Array.isArray(input) || typeof input[0] !== 'string') return snapshot;
    return JSON.stringify([industryId, ...input.slice(1)]);
  } catch { return snapshot; }
}
