import type { SourceDistributionBatch, SourceDistributionRecord, SourceDistributionResponse } from '../../contracts/source-distribution.js';
import { sha256Hex } from '../domain/hash.js';
import { calendarDay, object, stableJson, type Row } from './common.js';

/** Whole-response limits: never return a silently truncated denominator. */
export const DISTRIBUTION_LIMITS = { industries: 200, batches: 200, records: 50_000, bytes: 8 * 1024 * 1024 } as const;
export interface DistributionIndustry { industryId: string; name: string; dataset: Row }
class DistributionFailure extends Error {
  constructor(readonly status: 'data_limit_exceeded' | 'invalid_data') { super(status); }
}
function invalid(): never { throw new DistributionFailure('invalid_data'); }
function limited(): never { throw new DistributionFailure('data_limit_exceeded'); }
function nullableText(value: unknown, max = 16_000): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) return invalid();
  return value.trim() ? value : null;
}
function requiredText(value: unknown): string { return nullableText(value, 1000) ?? invalid(); }
function safeDate(value: unknown, limitations: Set<string>): string | null {
  const text = nullableText(value, 80);
  if (text === null) return null;
  try { calendarDay(text); return text; }
  catch { limitations.add('无法识别的日期保留为未知，未从其他字段推断。'); return null; }
}
function safeUrl(value: unknown, limitations: Set<string>): string | null {
  const text = nullableText(value);
  if (text === null) return null;
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_url');
    return text;
  } catch { limitations.add('无效或不安全的链接保留为未知。'); return null; }
}
function safeMediaUrl(value: unknown, limitations: Set<string>): string | null {
  const text = nullableText(value);
  // Exports may use a bare domain as the original media identity. Preserve it without inventing a protocol.
  if (text && text.includes('.') && !/[/:?#@\\\s]/.test(text)) {
    try { if (new URL('https://' + text).hostname) return text; } catch { /* handled as an unsafe/invalid URL below */ }
  }
  return safeUrl(text, limitations);
}
function projectRecord(value: unknown, limitations: Set<string>): SourceDistributionRecord {
  if (!object(value)) return invalid();
  const row = value.sourceRow;
  if (row != null && (!Number.isSafeInteger(row) || row < 1)) return invalid();
  // Deliberately construct each property; dataset, quotes and arbitrary evidence fields never cross this boundary.
  return {
    id: requiredText(value.id), sourceSheet: nullableText(value.sourceSheet, 1000), sourceRow: row ?? null,
    citedAt: safeDate(value.citedAt, limitations), model: nullableText(value.model, 1000), question: nullableText(value.question),
    title: nullableText(value.title), url: safeUrl(value.url, limitations), mediaName: nullableText(value.mediaName, 1000),
    mediaUrl: safeMediaUrl(value.mediaUrl, limitations), mediaType: nullableText(value.mediaType, 1000),
    publishedAt: safeDate(value.publishedAt, limitations), contentStatus: nullableText(value.contentStatus, 1000),
  };
}
function period(value: unknown, limitations: Set<string>): SourceDistributionBatch['period'] {
  if (value != null && !object(value)) return invalid();
  const bounds = object(value) ? value : {};
  const start = safeDate(bounds.start, limitations), end = safeDate(bounds.end, limitations);
  if (start && end && calendarDay(start) > calendarDay(end)) return invalid();
  return { start, end };
}

/** Only event/detail rows are convertible. Aggregates and supplier claims are never expanded into rows. */
function legacyBatch(industry: DistributionIndustry): Row | null {
  const dataset = industry.dataset;
  if (dataset.citations == null) return null;
  if (!Array.isArray(dataset.citations)) return invalid();
  if (dataset.citations.length > DISTRIBUTION_LIMITS.records) return limited();
  const limitations = new Set<string>([
    '兼容视图保留逐行 detail 原始记录；不等于已验证、去重的独立引用事件数。',
    '只导出声明为 detail 的原始行；聚合证据、供应商声明和未声明类型不计入此视图，不代表完整采集总量。',
    '缺少的日期、问题文本、类型和发布时间保持未知。',
    '文件指纹为白名单兼容视图的 SHA-256；源文件名未知，不代表原始文件哈希。',
  ]);
  const records: SourceDistributionRecord[] = [];
  let bytes = 0;
  for (const [index, citation] of dataset.citations.entries()) {
    if (!object(citation)) return invalid();
    if (citation.data_kind !== 'detail' || citation.source_type === 'supplier_claim') continue;
    // Never trust a dataset's embedded tenant key. It must agree with the repository's authenticated boundary.
    // The optional per-record tenant check is performed before this function is called.
    const record = projectRecord({
      id: `citation-row-${index + 1}`, sourceSheet: citation.source_sheet, sourceRow: citation.source_row,
      citedAt: citation.cited_at, model: citation.model ?? citation.scope?.model, question: citation.question_text,
      title: citation.title, url: citation.citation_url, mediaName: citation.source_name,
      // `domain` is a declared evidence identity field; never derive media identity from a content URL.
      mediaUrl: citation.media_url == null || citation.media_url === '' ? citation.domain : citation.media_url,
      mediaType: citation.media_type, publishedAt: citation.published_at, contentStatus: citation.content_status,
    }, limitations);
    bytes += Buffer.byteLength(JSON.stringify(record));
    if (bytes > DISTRIBUTION_LIMITS.bytes) return limited();
    records.push(record);
  }
  if (!records.length) return null;
  const fingerprint = sha256Hex(stableJson(records));
  return {
    id: `citations-${fingerprint.slice(0, 24)}`, label: `${industry.name} · 已导入引用明细`,
    version: fingerprint, sourceFile: null, sourceSha256: fingerprint,
    period: dataset.scope?.period, records, limitations: [...limitations],
  };
}

/** Pure, read-only projection. A bad/oversize import fails the complete view instead of producing false totals. */
export function readSourceDistribution(industries: DistributionIndustry[], tenantId: string): SourceDistributionResponse {
  try {
    if (industries.length > DISTRIBUTION_LIMITS.industries) return limited();
    const batches: SourceDistributionBatch[] = [], fingerprints = new Map<string, string>();
    let records = 0, bytes = Buffer.byteLength('{"status":"ready","batches":[]}');
    for (const industry of industries) {
      if (!object(industry.dataset)) return invalid();
      const dataset = industry.dataset;
      // A conflicting embedded identity is a configuration error, never a source of authorization.
      if ((dataset.tenant_id != null && dataset.tenant_id !== tenantId) ||
        (dataset.scope?.tenant_id != null && dataset.scope.tenant_id !== tenantId)) return invalid();
      if (dataset.citations != null && !Array.isArray(dataset.citations)) return invalid();
      if ((dataset.citations?.length ?? 0) > DISTRIBUTION_LIMITS.records) return limited();
      for (const citation of dataset.citations ?? []) {
        if (!object(citation)) return invalid();
        if ((citation.tenant_id != null && citation.tenant_id !== tenantId) ||
          (citation.scope?.tenant_id != null && citation.scope.tenant_id !== tenantId)) return invalid();
      }
      let imports: unknown[];
      if (dataset.source_distribution != null) {
        if (!object(dataset.source_distribution) || !Array.isArray(dataset.source_distribution.batches)) return invalid();
        imports = dataset.source_distribution.batches;
      } else {
        const legacy = legacyBatch(industry); imports = legacy ? [legacy] : [];
      }
      if (imports.length > DISTRIBUTION_LIMITS.batches) return limited();
      for (const value of imports) {
        if (!object(value) || !Array.isArray(value.records)) return invalid();
        if (value.tenant_id != null && value.tenant_id !== tenantId) return invalid();
        if (value.records.length > DISTRIBUTION_LIMITS.records) return limited();
        const fingerprint = requiredText(value.sourceSha256).toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(fingerprint)) return invalid();
        if (value.industryId != null && value.industryId !== industry.industryId) return invalid();
        const limitations = new Set<string>();
        if (value.limitations != null) {
          if (!Array.isArray(value.limitations) || value.limitations.length > 100) return invalid();
          for (const limitation of value.limitations) limitations.add(requiredText(limitation));
        }
        const projected: SourceDistributionBatch = {
          id: requiredText(value.id), label: requiredText(value.label), version: requiredText(value.version),
          sourceFile: nullableText(value.sourceFile, 1000), sourceSha256: fingerprint,
          // Industry ownership is supplied by the authorized industry row, never arbitrary embedded metadata.
          industryId: industry.industryId, industryName: industry.name,
          period: period(value.period, limitations), records: [], limitations: [],
        };
        let batchBytes = 0;
        const ids = new Set<string>();
        for (const raw of value.records) {
          if (object(raw) && raw.tenant_id != null && raw.tenant_id !== tenantId) return invalid();
          const record = projectRecord(raw, limitations);
          if (ids.has(record.id)) return invalid();
          ids.add(record.id);
          batchBytes += Buffer.byteLength(JSON.stringify(record));
          if (batchBytes > DISTRIBUTION_LIMITS.bytes) return limited();
          projected.records.push(record);
        }
        projected.limitations = [...limitations];
        // A repeated file cannot double totals. Conflicting scopes/rows under one SHA require an operator to repair the import.
        const content = stableJson({ industryId: projected.industryId, period: projected.period, records: projected.records });
        const previous = fingerprints.get(fingerprint);
        if (previous !== undefined) { if (previous !== content) return invalid(); continue; }
        fingerprints.set(fingerprint, content);
        records += projected.records.length;
        bytes += Buffer.byteLength(JSON.stringify(projected)) + (batches.length ? 1 : 0);
        if (records > DISTRIBUTION_LIMITS.records || bytes > DISTRIBUTION_LIMITS.bytes || batches.length >= DISTRIBUTION_LIMITS.batches) return limited();
        batches.push(projected);
      }
    }
    return batches.length
      ? { status: 'ready', batches }
      : { status: 'configuration_required', batches: [], message: '当前项目尚未接入可查看的行业引用明细。' };
  } catch (error) {
    if (!(error instanceof DistributionFailure)) throw error;
    return error.status === 'data_limit_exceeded'
      ? { status: error.status, batches: [], message: '已导入数据超出当前分析视图容量，请联系运营缩小导入范围后重试；本次未展示不完整统计。' }
      : { status: error.status, batches: [], message: '当前行业数据暂不可用，请联系运营核对导入数据后重试。' };
  }
}
