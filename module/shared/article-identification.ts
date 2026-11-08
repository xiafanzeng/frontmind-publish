/** Public, secret-free contract for read-only identification of a frozen article. */
export type IdentificationFieldKey = 'product' | 'industry' | 'audience' | 'questions';
export type IdentificationSource = 'article' | 'inferred' | 'unidentified';
export interface IdentificationIndustrySuggestion { id: string; name: string }
/** Value-bound form provenance, independent of whether the form was saved. */
export type IdentificationProvenance = Partial<Record<IdentificationFieldKey, { value: string; origin: 'article' | 'inferred' | 'manual'; protected?: boolean; explicitEmpty?: boolean }>>;
export type IdentificationReason = 'missing' | 'invalid_format' | 'empty' | 'too_long' | 'industry_not_in_catalog' | 'catalog_unavailable' | 'ambiguous_industry' | 'evidence_not_verbatim' | 'inferred_from_article' | 'unsupported_product' | 'catalog_changed';
export interface IdentificationField {
  value: string | null;
  source: IdentificationSource;
  evidence?: string;
  candidate?: string;
  reason?: IdentificationReason;
  canonicalId?: string;
  suggestions?: IdentificationIndustrySuggestion[];
}
export type IdentificationFields = Record<IdentificationFieldKey, IdentificationField>;
export interface IdentificationContext {
  scopeKey: string;
  catalogVersion?: string | null;
  articleId: string;
  articleVersionId: string;
  versionNumber: number;
  title: string;
  contentDigest: string;
  connection: {
    available: boolean;
    mode: 'host' | 'user' | 'environment' | 'none';
    revision: string;
  };
}
export interface IdentificationContextResponse {
  status: 'ready' | 'not_configured';
  context: IdentificationContext;
  fields: IdentificationFields;
  message?: string;
}
export interface IdentifyArticleRequest {
  article_version_id: string;
  draft_id?: string;
  content_digest: string;
  connection_revision: string;
}
export interface IdentifyArticleResponse {
  status: 'complete' | 'partial' | 'unidentified';
  context: IdentificationContext;
  fields: IdentificationFields;
}
