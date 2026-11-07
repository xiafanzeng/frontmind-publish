import type { IndustryFilters, IndustryScopeNode } from '../contracts/industry-source.js';

/** One business identity across identification, recommendation and distribution. */
export interface CanonicalIndustry {
  id: string;
  scopeId: string;
  name: string;
  label: string;
  path: string[];
  depth: number;
}
export interface LegacyIndustryMapping {
  localId: string;
  localName: string;
  canonicalId: string | null;
  status: 'mapped' | 'unmapped' | 'ambiguous';
  via?: 'identity' | 'unique_name' | 'explicit';
}
export interface IndustryCatalogResponse {
  status: 'configured' | 'configuration_required';
  industries: CanonicalIndustry[];
  filters: IndustryFilters | null;
  catalogVersion: string | null;
  legacyMappings: LegacyIndustryMapping[];
  brand_data_batches: Array<{ id: string; label: string; [key: string]: unknown }>;
  message?: string | null;
}

/** No first-N truncation. Reject ambiguous identities instead of selecting a branch. */
export function flattenIndustryCatalog(tree: readonly IndustryScopeNode[]): CanonicalIndustry[] {
  const result: CanonicalIndustry[] = [], ids = new Set<string>();
  const visit = (nodes: readonly IndustryScopeNode[], path: string[]) => {
    for (const node of nodes) {
      if (result.length >= 5000 || path.length > 20 || !node.scopeId || ids.has(node.scopeId)) throw new Error('invalid_industry_catalog');
      ids.add(node.scopeId);
      const nextPath = [...path, node.label];
      result.push({ id: node.scopeId, scopeId: node.scopeId, name: node.label, label: '\u3000'.repeat(path.length) + node.label, path: nextPath, depth: path.length });
      visit(node.children, nextPath);
    }
  };
  visit(tree, []);
  return result;
}

export function mapLegacyIndustries(local: ReadonlyArray<{ id: string; name: string; canonicalId?: string }>, canonical: readonly CanonicalIndustry[]): LegacyIndustryMapping[] {
  return local.map(item => {
    const identity = canonical.find(option => option.id === (item.canonicalId || item.id));
    if (identity) return { localId: item.id, localName: item.name, canonicalId: identity.id, status: 'mapped', via: item.canonicalId ? 'explicit' : 'identity' };
    // An explicit but stale mapping must not quietly move to a different category.
    if (item.canonicalId) return { localId: item.id, localName: item.name, canonicalId: null, status: 'unmapped' };
    const matches = canonical.filter(option => option.name.trim() === item.name.trim());
    return matches.length === 1
      ? { localId: item.id, localName: item.name, canonicalId: matches[0]!.id, status: 'mapped', via: 'unique_name' }
      : { localId: item.id, localName: item.name, canonicalId: null, status: matches.length ? 'ambiguous' : 'unmapped' };
  });
}
