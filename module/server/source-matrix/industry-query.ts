export const INDUSTRY_ENDPOINTS = ['filters', 'media-ranking', 'contents', 'distributions'] as const;
export type IndustryEndpoint = typeof INDUSTRY_ENDPOINTS[number];

const common = ['periodType', 'date', 'scopeType', 'scopeId', 'modelCode'];
const pagination = ['pageSize', 'snapshotToken', 'cursor', 'requestId'];
const content = ['media', 'sourceType', 'sortBy', 'sortOrder'];
const signedInt64Max = 9223372036854775807n;

export class IndustryQueryError extends Error {
  constructor(message = '查询参数不正确，请重新选择筛选条件。') { super(message); }
}

function requireValue(query: URLSearchParams, key: string): string {
  const value = query.get(key);
  if (value === null || !value.trim()) throw new IndustryQueryError();
  return value;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Validate the endpoint-specific allowlist without normalizing the original operation. */
export function validateIndustryQuery(endpoint: IndustryEndpoint, input: URLSearchParams): URLSearchParams {
  const allowed = new Set(endpoint === 'filters' ? [] : [
    ...common,
    ...(endpoint === 'distributions' ? [] : pagination),
    ...(endpoint === 'contents' ? content : []),
  ]);
  const seen = new Set<string>();
  for (const [key, value] of input) {
    if (!allowed.has(key) || seen.has(key) || /[\u0000-\u001f\u007f]/.test(value)) throw new IndustryQueryError();
    seen.add(key);
  }
  if (endpoint === 'filters') return new URLSearchParams(input);

  const period = requireValue(input, 'periodType').trim().toUpperCase();
  const scope = requireValue(input, 'scopeType').trim().toUpperCase();
  const model = requireValue(input, 'modelCode');
  if (!['ALL', 'DAY', 'WEEK', 'MONTH'].includes(period) || !['ALL', 'CATEGORY'].includes(scope) || model.length > 128) throw new IndustryQueryError();
  if (period !== 'ALL' && !validDate(requireValue(input, 'date'))) throw new IndustryQueryError();
  if (input.has('date') && !validDate(input.get('date')!)) throw new IndustryQueryError();
  if (scope === 'CATEGORY' && !input.has('scopeId')) throw new IndustryQueryError();
  if (input.has('scopeId')) {
    const id = input.get('scopeId')!;
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > signedInt64Max) throw new IndustryQueryError();
  }
  if (endpoint === 'distributions') return new URLSearchParams(input);

  if (!/^[a-zA-Z0-9-]{16,64}$/.test(requireValue(input, 'requestId'))) throw new IndustryQueryError('查询标识无效，请重新开始查询。');
  if (input.has('pageSize') && !/^(?:[1-9]|[1-9]\d|100)$/.test(input.get('pageSize')!)) throw new IndustryQueryError();
  for (const key of ['snapshotToken', 'cursor']) {
    if (!input.has(key)) continue;
    const value = requireValue(input, key);
    if (value.length > 4096 || value === 'null') throw new IndustryQueryError();
  }
  if (input.has('cursor') && !input.has('snapshotToken')) throw new IndustryQueryError();
  if (endpoint === 'contents') {
    for (const key of ['media', 'sourceType']) if ((input.get(key)?.length ?? 0) > 500) throw new IndustryQueryError();
    if (input.has('sortBy') && !['citationCount', 'publishTime'].includes(input.get('sortBy')!)) throw new IndustryQueryError();
    if (input.has('sortOrder') && !['asc', 'desc'].includes(input.get('sortOrder')!.toLowerCase())) throw new IndustryQueryError();
  }
  // Preserve whitespace/case and absent-vs-present fields exactly for provider idempotency.
  return new URLSearchParams(input);
}
