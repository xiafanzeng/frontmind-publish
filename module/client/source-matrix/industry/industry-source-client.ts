import type { IndustryResponse, IndustryFailure, IndustrySuccess } from '../../../contracts/industry-source';

export type IndustryEndpoint = 'filters' | 'media-ranking' | 'contents' | 'distributions';
export type IndustryQuery = Record<string, string | number | undefined>;
export class IndustryRequestError extends Error {
  constructor(readonly failure: IndustryFailure) { super(failure.message); }
}
const failure = (status: IndustryFailure['status'], message: string, httpStatus = 502, retryable = false): IndustryFailure => ({ status, message, httpStatus, retryable });
const statuses = new Set(['configuration_required', 'unauthorized', 'forbidden', 'entitlement_required', 'quota_exhausted', 'session_expired', 'invalid_input', 'upstream_error', 'invalid_response', 'timeout']);

/** Only the authenticated module proxy is reachable from this client. No supplier credential exists here. */
export async function industryRequest<T>(endpoint: IndustryEndpoint, query: IndustryQuery, signal: AbortSignal): Promise<IndustrySuccess<T>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) controller.abort(); else signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25_000);
  try {
    const response = await fetch(`/api/modules/publish/source-ranking/${endpoint}${params.size ? '?' + params.toString() : ''}`, { credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    let value: IndustryResponse<T>;
    try { value = await response.json() as IndustryResponse<T>; }
    catch (error) {
      // A body-stream timeout/reset is an uncertain operation, so retain its retryable transport semantics.
      if (!(error instanceof SyntaxError)) throw error;
      throw new IndustryRequestError(failure('invalid_response', '行业信源服务返回了无法识别的数据，请稍后重试。'));
    }
    if (!value || typeof value !== 'object') throw new IndustryRequestError(failure('invalid_response', '行业信源响应不完整。'));
    if (value.status !== 'ok') {
      if (statuses.has(value.status) && typeof value.message === 'string' && typeof value.retryable === 'boolean') throw new IndustryRequestError(value);
      throw new IndustryRequestError(failure(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : 'upstream_error', '行业信源服务暂不可用，请检查连接或稍后重试。', response.status, response.status >= 500));
    }
    if (!response.ok || value.data === null || value.data === undefined || value.source !== 'molizhishu-public-industry' || typeof value.fetchedAt !== 'string') throw new IndustryRequestError(failure('invalid_response', '行业信源响应不完整，未作为成功结果使用。'));
    return value;
  } catch (error) {
    if (error instanceof IndustryRequestError) throw error;
    if (signal.aborted) throw error;
    throw new IndustryRequestError(failure(timedOut ? 'timeout' : 'upstream_error', timedOut ? '查询超时，可重试本次查询。' : '网络连接中断，可重试本次查询。', timedOut ? 504 : 502, true));
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export function newIndustryRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function integerText(value: string): string { return BigInt(value).toLocaleString('zh-CN'); }
export function ratioText(count: string, total: string): string {
  const denominator = BigInt(total);
  if (denominator === 0n) return '0.00';
  const hundredths = (BigInt(count) * 10000n + denominator / 2n) / denominator;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
}
export function totalOf(values: string[]): string { return values.reduce((sum, value) => sum + BigInt(value), 0n).toString(); }
