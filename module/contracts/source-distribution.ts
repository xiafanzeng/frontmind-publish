/** Exported rows are counts of source records, not verified independent citation events. */
export interface SourceDistributionRecord {
  id: string;
  sourceSheet: string | null;
  sourceRow: number | null;
  citedAt: string | null;
  model: string | null;
  question: string | null;
  title: string | null;
  url: string | null;
  mediaName: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  publishedAt: string | null;
  contentStatus: string | null;
}

export interface SourceDistributionBatch {
  id: string;
  label: string;
  version: string;
  sourceFile: string | null;
  /** Required immutable fingerprint. Duplicate files never increase the denominator. */
  sourceSha256: string;
  industryId: string | null;
  industryName: string | null;
  /** Export's stated scope; it does not assert collection completeness. */
  period: { start: string | null; end: string | null };
  records: SourceDistributionRecord[];
  limitations: string[];
}

export interface SourceDistributionResponse {
  status: string;
  batches: SourceDistributionBatch[];
  message?: string;
}
