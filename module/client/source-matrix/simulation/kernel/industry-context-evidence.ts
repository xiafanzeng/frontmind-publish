import { equal, issue, object, rows, text, timestamp, type Issue, type Row } from './common.js';
import { validateIndustryQuery } from './industry-query.js';

/** Global distribution buckets are context, never a media identity or a detail citation. */
export function validateIndustryContext(task: Row): Issue[] {
  const context = task.industry_context;
  if (context === undefined) return [];
  const invalid = () => [issue('invalid_industry_context', 'task.industry_context', '行业依据的来源、范围、单位或版本不一致，请重新获取')];
  if (!object(context) || !text(context.status) || context.source !== 'molizhishu-public-industry' ||
      !text(task.industry_id) || context.industry_id !== task.industry_id || context.industry_name !== task.industry ||
      !rows(context.aggregates) || !Array.isArray(context.limitations) || !context.limitations.every(text)) return invalid();
  if (!['ok', 'partial'].includes(context.status)) return context.aggregates.length ? invalid() : [];
  if (!text(context.data_version) || !object(context.query) || context.query.scopeType !== 'CATEGORY') return invalid();
  try {
    timestamp(context.fetched_at);
    if (Object.values(context.query).some(value => typeof value !== 'string')) return invalid();
    validateIndustryQuery('distributions', new URLSearchParams(context.query as Record<string, string>));
  } catch { return invalid(); }
  const ids = new Set<string>();
  for (const aggregate of context.aggregates) {
    if (!text(aggregate.aggregate_id) || ids.has(aggregate.aggregate_id) ||
        aggregate.aggregate_scope !== 'industry_distribution' || aggregate.source_type !== 'external_data' ||
        !text(aggregate.source_id) || aggregate.data_version !== context.data_version ||
        !['source_type', 'publish_time'].includes(aggregate.dimension) ||
        aggregate.unit !== (aggregate.dimension === 'source_type' ? 'citation_count' : 'content_count') ||
        typeof aggregate.count !== 'string' || !/^(?:0|[1-9]\d{0,18})$/.test(aggregate.count) || BigInt(aggregate.count) > 9223372036854775807n ||
        !object(aggregate.bucket) || !text(aggregate.bucket.code) || !text(aggregate.bucket.name) ||
        aggregate.scope?.industry !== task.industry ||
        !Object.entries(context.query).every(([key, value]) => equal(aggregate.scope?.[key], value)) ||
        aggregate.applicability?.kind !== 'industry_context' || aggregate.applicability.industry !== task.industry ||
        ['resource_id', 'offer_id', 'source_name', 'domain', 'account_id', 'channel_id', 'source_identity', 'url', 'citation_url'].some(key => key in aggregate)) return invalid();
    ids.add(aggregate.aggregate_id);
  }
  return context.aggregates.length ? [] : invalid();
}

export function industryContextAggregates(task: Row): Row[] {
  if (validateIndustryContext(task).length || !['ok', 'partial'].includes(task.industry_context?.status)) return [];
  return task.industry_context.aggregates;
}
