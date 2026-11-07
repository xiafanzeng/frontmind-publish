import { createHash } from 'node:crypto';
import type { IndustryFailure, IndustryResponse, IndustrySuccess } from '../../contracts/industry-source.js';
import { decodeIndustryData, industryRecord, IndustryDecodeError, parseIndustryJson } from './industry-codec.js';
import type { IndustryEndpoint } from './industry-query.js';

const ORIGIN = 'https://business-api.molizhishu.com';
const ROOT = '/api/business/source-ranking/';
// The supplier's billed list aggregations exceed 15s on real accounts
// (measured >15.5s twice on 2026-11-06); filters/distributions stay sub-second.
const TIMEOUT_MS = 60000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 256;
const MAX_FILTER_BYTES = 12 * 1024 * 1024;
const MAX_CACHED_BYTES = 16 * 1024 * 1024;
const OPERATION_TTL_MS = 10 * 60 * 1000;

export function industryFailure(status: IndustryFailure['status'], httpStatus: number, message: string, retryable = false): IndustryFailure {
  return { status, httpStatus, message, retryable };
}

function providerFailure(httpStatus: number, value: unknown): IndustryFailure {
  const envelope = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const code = Number(envelope.code), message = typeof envelope.message === 'string' ? envelope.message : '';
  // Inspect upstream text only to classify; never send its raw message to clients or logs.
  const tokenFailure = /api\s*token|bearer|认证|鉴权|凭证|(?:^|[\s，。:：])token\s*(?:失效|无效|过期|缺失)/i.test(message);
  const status = httpStatus >= 400 ? httpStatus : code;
  if (status === 403) return /权益|续费|福利|开通|到期/.test(message)
    ? industryFailure('entitlement_required', 403, '行业信源权益未开通或已到期，请由账号管理员在供应商官网处理。')
    : industryFailure('forbidden', 403, '当前账号没有行业信源访问权限，请联系管理员。');
  if (status === 429) return industryFailure('quota_exhausted', 429, '本月行业信源查询额度已用完，请停止新的列表查询并联系管理员。');
  if (status === 409) return industryFailure('session_expired', 409, '查询会话已失效或数据已更新，请从首屏重新查询。重新查询可能消耗次数。');
  if (status === 400 || httpStatus < 400 && code === 400001) return industryFailure('invalid_input', 400, '供应商未接受当前查询参数，请重新选择筛选条件。');
  if (status === 401 || httpStatus < 400 && (code === 401001 || tokenFailure)) return industryFailure('unauthorized', 401, '行业信源凭证无效或已过期，请联系管理员。');
  return industryFailure('upstream_error', 502, '行业信源服务暂时不可用，可稍后重试当前查询。', true);
}

async function readBounded(response: Response, controller: AbortController, limit = MAX_RESPONSE_BYTES): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) { controller.abort(); throw new IndustryDecodeError(); }
  if (!response.body) return '';
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { controller.abort(); throw new IndustryDecodeError(); }
      try { body += decoder.decode(chunk.value, { stream: true }); } catch { throw new IndustryDecodeError(); }
    }
    try { return body + decoder.decode(); } catch { throw new IndustryDecodeError(); }
  } catch (error) { controller.abort(); throw error; }
  finally { reader.releaseLock(); }
}

function fingerprint(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function businessMonth(time: number): string { return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 7); }

interface Entry {
  signature: string;
  createdAt: number;
  expiresAt: number;
  month: string;
  pending?: Promise<IndustryResponse<unknown>>;
  value?: IndustrySuccess<unknown>;
  failure?: IndustryFailure;
  bytes: number;
}

/** Process-local coalescing is an optimization; provider requestId remains the idempotency authority. */
export class IndustrySourceProvider {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly transport: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  private discard(key: string, entry: Entry) {
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  private room(): boolean {
    for (const [key, entry] of this.entries) {
      if (!entry.pending && this.now() - entry.createdAt > 2 * OPERATION_TTL_MS) this.discard(key, entry);
    }
    while (this.entries.size >= MAX_ENTRIES || this.bytes > MAX_CACHED_BYTES) {
      const candidate = [...this.entries].find(([, entry]) => !entry.pending);
      if (!candidate) return false;
      this.discard(candidate[0], candidate[1]);
    }
    return true;
  }

  async query(endpoint: IndustryEndpoint, query: URLSearchParams, identity: string, token: string): Promise<IndustryResponse<unknown>> {
    const startedAt = this.now(), billed = endpoint === 'media-ranking' || endpoint === 'contents';
    const signature = `${endpoint}?${query.toString()}`;
    // Tokens never enter keys as cleartext. Actor/account/project/owner are supplied by the host.
    const scope = fingerprint(`${identity}\0${fingerprint(token)}`);
    const key = billed ? `${scope}:operation:${query.get('requestId')}` : `${scope}:read:${fingerprint(signature)}`;
    let entry = this.entries.get(key);
    if (entry && entry.signature !== signature) return industryFailure('invalid_input', 400, '同一次查询标识不能用于不同参数，请重新开始查询。');
    if (entry && billed && (entry.month !== businessMonth(startedAt) || entry.expiresAt <= startedAt)) {
      return industryFailure('session_expired', 409, '原查询已超过有效重试时间，请从首屏重新查询。重新查询可能消耗次数。');
    }
    if (entry?.pending) return entry.pending;
    if (entry?.value && entry.expiresAt > startedAt) return entry.value;
    if (endpoint === 'filters' && entry?.failure && entry.expiresAt > startedAt) return entry.failure;
    if (entry && !billed && entry.expiresAt <= startedAt) { this.discard(key, entry); entry = undefined; }
    if (!entry) {
      if (!this.room()) return industryFailure('upstream_error', 503, '行业信源服务繁忙，请稍后重试当前查询。', true);
      entry = { signature, createdAt: startedAt, expiresAt: startedAt + (billed ? OPERATION_TTL_MS : 30000), month: businessMonth(startedAt), bytes: 0 };
      this.entries.set(key, entry);
    }
    const owned = entry;
    owned.pending = this.fetchOne(endpoint, query, token).then(result => {
      if (result.status === 'ok') {
        if (billed) {
          const data = industryRecord(result.data);
          // decodeIndustryData has validated this int64; bound the cache without lossy conversion.
          const expiry = BigInt(String(data.expiresAt));
          if (expiry < BigInt(owned.expiresAt)) owned.expiresAt = Number(expiry);
        }
        const bytes = Buffer.byteLength(JSON.stringify(result));
        if (bytes <= (endpoint === 'filters' ? MAX_FILTER_BYTES : 256 * 1024) && this.bytes + bytes <= MAX_CACHED_BYTES) {
          owned.value = result;
          owned.bytes = bytes;
          this.bytes += bytes;
        }
      } else if (endpoint === 'filters') {
        // Context, catalog and identification may arrive together. Share a brief
        // failure too, without reissuing supplier reads on every task poll.
        owned.failure = result;
        owned.expiresAt = this.now() + 10000;
      } else if (result.status === 'session_expired') {
        // Never re-issue an operation the supplier has declared non-replayable.
        owned.expiresAt = 0;
      }
      return result;
    }).finally(() => { owned.pending = undefined; });
    return owned.pending;
  }

  private async fetchOne(endpoint: IndustryEndpoint, query: URLSearchParams, token: string): Promise<IndustryResponse<unknown>> {
    const url = new URL(ROOT + endpoint, ORIGIN);
    url.search = query.toString();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, endpoint === 'filters' ? 10000 : TIMEOUT_MS);
    try {
      // Do not couple this to a browser disconnect: an already-sent query can have consumed quota.
      // Keep the operation available for an identical retry. No implicit transport retries.
      const response = await this.transport(url.toString(), { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal });
      const body = await readBounded(response, controller, endpoint === 'filters' ? MAX_FILTER_BYTES : MAX_RESPONSE_BYTES);
      let parsed: unknown;
      try { parsed = parseIndustryJson(body); } catch {
        if (!response.ok) return providerFailure(response.status, null);
        throw new IndustryDecodeError();
      }
      // HTTP failures retain their status even when a gateway returns JSON null or an array.
      if (!response.ok) return providerFailure(response.status, parsed);
      const envelope = industryRecord(parsed);
      if (envelope.success !== true || Number(envelope.code) !== 200) return providerFailure(response.status, envelope);
      return { status: 'ok', data: decodeIndustryData(endpoint, envelope.data), fetchedAt: new Date(this.now()).toISOString(), source: 'molizhishu-public-industry' };
    } catch (error) {
      if (timedOut) return industryFailure('timeout', 504, '行业信源查询超时，可重试本次查询。', true);
      if (error instanceof IndustryDecodeError) return industryFailure('invalid_response', 502, '行业信源返回的数据不完整或格式异常，请联系管理员。');
      return industryFailure('upstream_error', 502, '行业信源连接失败，可稍后重试当前查询。', true);
    } finally { clearTimeout(timer); }
  }
}
