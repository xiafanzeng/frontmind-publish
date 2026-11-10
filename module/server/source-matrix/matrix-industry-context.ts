import { createHash, randomUUID } from 'node:crypto';
import type { IndustryCommonQuery, IndustryDistributions, IndustryFilters, IndustryMedia, IndustryPage, IndustryResponse, IndustryScopeNode } from '../../contracts/industry-source.js';
import { stableJson, type Row } from './common.js';
import { decodeIndustryData } from './industry-codec.js';
import { IndustrySourceProvider } from './industry-provider.js';
import { validateIndustryQuery } from './industry-query.js';

export interface MatrixIndustryContextInput {
  industryId: string;
  industryName: string;
  selection?: IndustryCommonQuery;
  /** Legacy alias only; canonical supplier scope IDs always take precedence. */
  configuredScopeId?: string;
  identity: string;
  environment: Record<string, string | undefined>;
}

const provider = new IndustrySourceProvider();
const SOURCE = 'molizhishu-public-industry';
const SOURCE_ID = SOURCE + ':distributions';
const LIMITATIONS = [
  'filters/distributions 为免费分类统计；媒体排名（media-ranking）为供应商计费查询，仅取当前行业前20名作组合候选池参考，不构成完整媒体证据。',
  '行业排名反映观察期内媒体被引用情况，不等于可售账号、报价或本次投放收录保证；组合报价仍以真实目录为准。',
  '行业统计不代表当前品牌、稿件或单一媒体的表现，不构成可采购资源或报价。',
  '信源类型按 citationCount（引用次数）统计；发布时间按 contentCount（内容数量）统计，两套分母独立，未计算百分比。',
];
const failureMessages: Record<string, string> = {
  configuration_required: '行业信源服务尚未配置，请联系管理员。',
  unauthorized: '行业信源凭据不可用，请联系管理员。',
  forbidden: '当前授权范围不能读取行业信源数据。',
  entitlement_required: '行业信源权益未开通或已到期。',
  quota_exhausted: '供应商暂不接受当前行业查询，请联系管理员。',
  session_expired: '供应商行业数据会话已失效，请重新生成。',
  invalid_input: '供应商未接受当前行业查询条件。',
  upstream_error: '行业信源服务暂时不可用，请稍后重试。',
  invalid_response: '行业信源返回的数据不完整或格式异常。',
  timeout: '行业信源查询超时，请稍后重试。',
};

function hash(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function periodRange(query: IndustryCommonQuery, filters: IndustryFilters): { start: string; end: string } | null {
  if (query.periodType === 'ALL') return query.date === undefined ? { start: filters.minDate!, end: filters.maxDate! } : null;
  if (!validDate(query.date)) return null;
  const date = new Date(query.date + 'T00:00:00.000Z');
  if (query.periodType === 'WEEK') {
    if (date.getUTCDay() !== 1) return null;
    date.setUTCDate(date.getUTCDate() + 6);
  } else if (query.periodType === 'MONTH') {
    if (!query.date.endsWith('-01')) return null;
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
  } else if (query.periodType !== 'DAY') return null;
  const end = date.toISOString().slice(0, 10);
  // Boundary weeks/months may overlap a partial supplier range, as in the analysis view.
  return validDate(end) && query.date <= filters.maxDate! && end >= filters.minDate! ? { start: query.date, end } : null;
}
function flatten(nodes: IndustryScopeNode[]): IndustryScopeNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
}
function mappedScope(filters: IndustryFilters, input: MatrixIndustryContextInput): IndustryScopeNode | null {
  const nodes = flatten(filters.industryTree), name = input.industryName.trim();
  const canonical = /^[1-9]\d{0,18}$/.test(input.industryId);
  const matches = canonical
    ? nodes.filter(node => node.scopeId === input.industryId)
    : input.configuredScopeId !== undefined
      ? nodes.filter(node => node.scopeId === input.configuredScopeId)
      : nodes.filter(node => node.label.trim() === name);
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  return nodes.filter(node => node.scopeId === match.scopeId).length === 1 ? match : null;
}
function selectedQuery(input: MatrixIndustryContextInput, filters: IndustryFilters, scopeId: string): IndustryCommonQuery | null {
  if (input.selection === undefined) return { periodType: 'MONTH', date: filters.maxDate!.slice(0, 7) + '-01', scopeType: 'CATEGORY', scopeId, modelCode: filters.models.find(model => model.value === 'all')?.value ?? filters.models[0]!.value };
  const selection = input.selection;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || Object.keys(selection).some(key => !['periodType', 'date', 'scopeType', 'scopeId', 'modelCode'].includes(key))
    || selection.scopeType !== 'CATEGORY' || selection.scopeId !== scopeId
    || typeof selection.modelCode !== 'string' || !filters.models.some(model => model.value === selection.modelCode)
    || !['ALL', 'DAY', 'WEEK', 'MONTH'].includes(selection.periodType)) return null;
  return { periodType: selection.periodType, ...(selection.date === undefined ? {} : { date: selection.date }), scopeType: 'CATEGORY', scopeId, modelCode: selection.modelCode };
}

/** Freeze only free, industry-wide observations; browser selections are conditions, never evidence. */
function tokenOf(input: MatrixIndustryContextInput): string {
  return (input.environment.FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN ?? '').trim();
}

export async function loadMatrixIndustryContext(input: MatrixIndustryContextInput, source: Pick<IndustrySourceProvider, 'query'> = provider): Promise<Row> {
  const snapshot: Row = {
    status: 'configuration_required', message: failureMessages.configuration_required,
    source: SOURCE, industry_id: input.industryId, industry_name: input.industryName,
    query: null, fetched_at: null, data_version: null, aggregates: [], limitations: [...LIMITATIONS],
    source_type_distribution: null, publish_time_distribution: null,
    media_ranking: { status: 'not_queried', message: '本次未读取行业媒体排名。', query: null, fetched_at: null, data_version: null, items: [] },
  };
  const stop = (status: string, message: string, stage?: string): Row => {
    snapshot.status = status; snapshot.message = message;
    if (stage) snapshot.failed_stage = stage;
    snapshot.limitations.push(message);
    return snapshot;
  };
  const upstreamFailure = (status: string, stage: string): Row => {
    const known = Object.hasOwn(failureMessages, status) ? status : 'upstream_error';
    return stop(known, failureMessages[known]!, stage);
  };
  const token = input.environment.FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN?.trim();
  if (!token || token.length > 8192 || /\s/.test(token)) return stop('configuration_required', failureMessages.configuration_required!, 'configuration');
  if (!input.industryId.trim() || !input.industryName.trim() || !input.identity.trim()) return stop('mapping_unavailable', '当前行业或授权查询范围不明确，未读取行业统计。', 'mapping');

  let filtersResponse: IndustryResponse<unknown>;
  try { filtersResponse = await source.query('filters', validateIndustryQuery('filters', new URLSearchParams()), input.identity, token); }
  catch { return upstreamFailure('upstream_error', 'filters'); }
  if (filtersResponse.status !== 'ok') return upstreamFailure(filtersResponse.status, 'filters');
  let filters: IndustryFilters;
  try {
    filters = decodeIndustryData('filters', filtersResponse.data) as IndustryFilters;
    snapshot.provenance = { filters: { source: filtersResponse.source, fetched_at: filtersResponse.fetchedAt, data_version: 'filters-' + hash(filters) }, endpoint: 'distributions' };
  } catch { return stop('invalid_response', failureMessages.invalid_response!, 'filters'); }

  const scope = mappedScope(filters, input);
  if (!scope) return stop('mapping_unavailable', '当前行业无法唯一映射到供应商真实行业树，未回退到全行业或旧样本。', 'mapping');
  if (!validDate(filters.minDate) || !validDate(filters.maxDate) || filters.minDate > filters.maxDate || !filters.models.length) {
    return stop('insufficient_filters', '供应商未提供完整可核验的日期范围或可用模型，未读取行业统计。', 'filters');
  }
  const query = selectedQuery(input, filters, scope.scopeId);
  if (!query || !periodRange(query, filters)) return stop('invalid_selection', '所选行业、模型或日期周期不在供应商当前可核验范围内，请重新选择。', 'selection');
  let params: URLSearchParams;
  try { params = validateIndustryQuery('distributions', new URLSearchParams(Object.entries(query))); }
  catch { return stop('invalid_selection', '行业查询参数未通过校验，未读取行业统计。', 'selection'); }
  snapshot.query = query;
  snapshot.provenance.scope = { industry_id: input.industryId, industry_name: input.industryName, scope_id: scope.scopeId, scope_name: scope.label, mapping: /^[1-9]\d{0,18}$/.test(input.industryId) ? 'canonical_scope' : input.configuredScopeId === undefined ? 'unique_exact_name' : 'configured_scope' };
  snapshot.provenance.available_dates = { min: filters.minDate, max: filters.maxDate };
  snapshot.provenance.period_range = periodRange(query, filters);
  snapshot.provenance.default_selection = input.selection === undefined;

  let distributionResponse: IndustryResponse<unknown>;
  try { distributionResponse = await source.query('distributions', params, input.identity, token); }
  catch { return upstreamFailure('upstream_error', 'distributions'); }
  if (distributionResponse.status !== 'ok') return upstreamFailure(distributionResponse.status, 'distributions');
  let distributions: IndustryDistributions;
  try {
    distributions = decodeIndustryData('distributions', distributionResponse.data) as IndustryDistributions;
    if ([distributions.sourceTypeDistribution, distributions.publishTimeDistribution].some(rows => new Set(rows.map(row => row.code)).size !== rows.length)) throw new Error('Duplicate distribution buckets');
    snapshot.fetched_at = distributionResponse.fetchedAt;
  } catch { return stop('invalid_response', failureMessages.invalid_response!, 'distributions'); }

  // Time of retrieval is separate from the deterministic version of the actual query/data.
  const version = 'industry-' + hash({ source: SOURCE, endpoint: 'distributions', industry_id: input.industryId, industry_name: input.industryName, query, data: distributions });
  snapshot.data_version = version;
  snapshot.source_type_distribution = distributions.sourceTypeDistribution;
  snapshot.publish_time_distribution = distributions.publishTimeDistribution;
  const aggregate = (dimension: string, row: { code: string; name: string }, count: string, unit: string): Row => ({
    aggregate_id: 'industry-aggregate-' + hash({ version, dimension, code: row.code }),
    source_id: SOURCE_ID, source_type: 'external_data', data_version: version, unit, count,
    scope: { industry: input.industryName, industry_id: input.industryId, supplier_industry_name: scope.label, ...query },
    applicability: { kind: 'industry_context', industry: input.industryName },
    aggregate_scope: 'industry_distribution', dimension, bucket: { code: row.code, name: row.name },
  });
  snapshot.aggregates = [
    ...distributions.sourceTypeDistribution.map(row => aggregate('source_type', row, row.citationCount, 'citation_count')),
    ...distributions.publishTimeDistribution.map(row => aggregate('publish_time', row, row.contentCount, 'content_count')),
  ];
  const missing = [!distributions.sourceTypeDistribution.length ? '信源类型分布' : '', !distributions.publishTimeDistribution.length ? '发布时间分布' : ''].filter(Boolean);
  if (missing.length === 2) return stop('empty', '供应商成功返回当前范围，但两个分类统计均无数据；不能据此推断引用或内容数量为零。');

  /* The combination pool needs the supplier's real per-industry media ranking.
   * It is a billed list query: one page of 20, retried only by an explicit new
   * generate. A ranking failure never blocks the free distribution snapshot. */
  await loadMediaRanking(snapshot, query, params, source, input, hash, stop);

  if (missing.length) return stop('partial', '供应商当前范围缺少' + missing.join('、') + '，仅保留已返回维度，未将缺失统计补为零。');
  snapshot.status = 'ok'; snapshot.message = '已读取当前行业真实分类统计' + (snapshot.media_ranking?.status === 'ok' ? '与行业媒体排名前20' : '') + '，供行业背景参考。';
  return snapshot;
}

async function loadMediaRanking(snapshot: Row, query: IndustryCommonQuery, params: URLSearchParams, source: Pick<IndustrySourceProvider, 'query'>, input: MatrixIndustryContextInput, hash: (value: unknown) => string, stop: (status: string, message: string, stage?: string) => Row): Promise<void> {
  const ranking: Row = snapshot.media_ranking as Row;
  ranking.query = { ...query, pageSize: 20 };
  let rankingParams: URLSearchParams;
  try {
    rankingParams = validateIndustryQuery('media-ranking', new URLSearchParams(Object.entries({ ...query, pageSize: String(20), requestId: randomUUID().replace(/-/g, '') })));
  } catch { ranking.status = 'invalid_selection'; ranking.message = '行业排名查询参数未通过校验，未读取媒体排名。'; snapshot.limitations.push(ranking.message as string); return; }
  let response: IndustryResponse<unknown>;
  try { response = await source.query('media-ranking', rankingParams, input.identity, tokenOf(input)); }
  catch { ranking.status = 'upstream_error'; ranking.message = '行业媒体排名读取失败，本次组合仅使用推荐渠道。'; snapshot.limitations.push(ranking.message as string); return; }
  if (response.status !== 'ok') {
    ranking.status = Object.hasOwn(failureMessages, response.status) ? response.status : 'upstream_error';
    ranking.message = '行业媒体排名不可用（' + ranking.status + '），本次组合仅使用推荐渠道。';
    snapshot.limitations.push(ranking.message as string);
    return;
  }
  let page: IndustryPage<IndustryMedia>;
  try { page = decodeIndustryData('media-ranking', response.data) as IndustryPage<IndustryMedia>; }
  catch { ranking.status = 'invalid_response'; ranking.message = '行业媒体排名返回数据异常，未采用。'; snapshot.limitations.push(ranking.message as string); return; }
  ranking.fetched_at = response.fetchedAt;
  ranking.expires_at = String(page.expiresAt);
  ranking.data_version = 'industry-ranking-' + hash({ source: SOURCE, query, ranking: page.items.map(item => [item.code, item.name, item.citationCount]) });
  ranking.items = page.items.map((item, index) => ({ rank: index + 1, code: item.code, name: item.name, citation_count: item.citationCount }));
  ranking.status = 'ok';
  ranking.message = '已读取当前行业媒体排名前' + ranking.items.length + '（引用次数为观察值，不代表可售或收录）。';
  if (!page.items.length) { ranking.status = 'empty'; ranking.message = '供应商当前范围媒体排名为空，未推断为无媒体。'; snapshot.limitations.push(ranking.message as string); }
}
