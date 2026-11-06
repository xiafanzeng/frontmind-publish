/** Public industry observations, never a purchasable resource or project-monitoring result. */
export type IndustryInteger = string;
export type IndustryPeriod = 'ALL' | 'DAY' | 'WEEK' | 'MONTH';
export interface IndustryScopeNode {
  id: string;
  label: string;
  scopeType: 'CATEGORY';
  scopeId: IndustryInteger;
  children: IndustryScopeNode[];
}
export interface IndustryFilters {
  models: Array<{ value: string; label: string }>;
  minDate: string | null;
  maxDate: string | null;
  industryTree: IndustryScopeNode[];
  sourceTypes: string[];
}
export interface IndustryCommonQuery {
  periodType: IndustryPeriod;
  date?: string;
  scopeType: 'ALL' | 'CATEGORY';
  scopeId?: IndustryInteger;
  modelCode: string;
}
export interface IndustryListQuery extends IndustryCommonQuery {
  pageSize: number;
  snapshotToken?: string;
  cursor?: string;
  requestId: string;
}
export interface IndustryContentQuery extends IndustryListQuery {
  media?: string;
  sourceType?: string;
  sortBy?: 'citationCount' | 'publishTime';
  sortOrder?: 'asc' | 'desc';
}
export interface IndustryMedia {
  code: string;
  name: string;
  citationCount: IndustryInteger;
}
export interface IndustryContent {
  sequence: IndustryInteger;
  linkId: string;
  title: string;
  url: string | null;
  icon: string | null;
  media: string;
  sourceType: string;
  publishTime: string | null;
  citationCount: IndustryInteger;
  citationRatio: string;
}
export interface IndustryPage<T> {
  items: T[];
  pageSize: number;
  total: IndustryInteger;
  totalCitations: IndustryInteger;
  snapshotToken: string;
  nextCursor: string | null;
  expiresAt: IndustryInteger;
}
export interface IndustryDistributions {
  sourceTypeDistribution: Array<{ code: string; name: string; citationCount: IndustryInteger }>;
  publishTimeDistribution: Array<{ code: string; name: string; contentCount: IndustryInteger }>;
}
export type IndustryErrorStatus = 'configuration_required' | 'unauthorized' | 'forbidden' | 'entitlement_required' | 'quota_exhausted' | 'session_expired' | 'invalid_input' | 'upstream_error' | 'invalid_response' | 'timeout';
export interface IndustryFailure {
  status: IndustryErrorStatus;
  message: string;
  httpStatus: number;
  retryable: boolean;
}
export interface IndustrySuccess<T> {
  status: 'ok';
  data: T;
  fetchedAt: string;
  source: 'molizhishu-public-industry';
}
export type IndustryResponse<T> = IndustrySuccess<T> | IndustryFailure;
