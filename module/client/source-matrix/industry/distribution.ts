import type { SourceDistributionBatch, SourceDistributionRecord } from '../../../contracts/source-distribution';

export const UNKNOWN = '__unknown__';
/** Single composite date filter: one granularity plus one period from the upstream data.
 * Week grouping is Monday–Sunday over the record dates (a local grouping rule,
 * stated in the UI; the upstream contract defines no week convention). */
export type PeriodGranularity = 'day' | 'week' | 'month';
export type DistributionFilter = { industry: string; model: string; granularity: PeriodGranularity; period: string };
export type DistributionRow = SourceDistributionRecord & { batchId: string; sourceFile: string | null; sourceSha256: string };
export type MediaGroup = { key: string; name: string | null; mediaUrl: string | null; domain: string; count: number; share: number | null };
export type ContentGroup = { key: string; url: string | null; title: string; media: string; type: string; status: string; count: number; share: number | null; records: DistributionRow[]; publishedAt: string | null };
export type DistributionSlice = { key: string; label: string; count: number; share: number | null };
export const EMPTY_FILTER: DistributionFilter = { industry: '', model: '', granularity: 'month', period: '' };

/** Ignore a repeated file, not repeated records inside a file. No record-level deduplication. */
export function uniqueBatches(batches: SourceDistributionBatch[]): SourceDistributionBatch[] {
  const seen = new Set<string>();
  return batches.filter(batch => {
    const key = batch.sourceSha256.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validDay(value: string | null): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(day + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
}

export function safeSourceUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

export function mediaDomain(value: string | null): string {
  if (!value) return '域名未知';
  try { return new URL(value.includes('://') ? value : 'https://' + value).hostname || value; } catch { return value; }
}

/** Preserve the original name + URL pair, even when separate pairs share a domain. */
export function mediaKey(record: SourceDistributionRecord): string { return JSON.stringify([record.mediaName, record.mediaUrl]); }

/** Latest available month by default; never a hardcoded demo month. */
export function defaultFilter(batches: SourceDistributionBatch[]): DistributionFilter {
  const months = periodsFor(batches, 'month');
  return { ...EMPTY_FILTER, granularity: 'month', period: months[0]?.value ?? '' };
}

export type PeriodOption = { value: string; label: string; start: string; end: string; count: number };

function isoWeekStart(day: string): string {
  const date = new Date(day + 'T00:00:00Z');
  const weekday = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shortRange(start: string, end: string): string {
  return start.slice(0, 4) === end.slice(0, 4) ? `${start} ~ ${end.slice(5)}` : `${start} ~ ${end}`;
}

/** Enumerate available periods from the upstream records themselves, latest first. */
export function periodsFor(batches: SourceDistributionBatch[], granularity: PeriodGranularity, industry = ''): PeriodOption[] {
  const days = uniqueBatches(batches).filter(b => !industry || (b.industryId ?? UNKNOWN) === industry)
    .flatMap(b => b.records.map(r => validDay(r.citedAt))).filter((v): v is string => !!v).sort();
  const counts = new Map<string, number>();
  for (const day of days) {
    const value = granularity === 'day' ? day : granularity === 'week' ? isoWeekStart(day) : day.slice(0, 7);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([value, count]) => {
    const start = granularity === 'day' ? value : granularity === 'week' ? value : `${value}-01`;
    const end = granularity === 'day' ? value : granularity === 'week' ? addDays(value, 6) : new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5)), 0)).toISOString().slice(0, 10);
    const label = granularity === 'day' ? value : granularity === 'week' ? `周（${shortRange(start, end)}）` : value;
    return { value, label, start, end, count };
  });
}

export function periodRange(filter: DistributionFilter): { start: string; end: string } | null {
  if (!filter.period) return null;
  const resolver = filter.granularity === 'day' ? dayRange : filter.granularity === 'week' ? weekRange : monthRange;
  return resolver(filter.period);
}

function dayRange(value: string): { start: string; end: string } | null { return validDay(value) ? { start: value, end: value } : null; }
function weekRange(value: string): { start: string; end: string } | null {
  const start = validDay(value);
  return start && start === isoWeekStart(start) ? { start, end: addDays(start, 6) } : null;
}
function monthRange(value: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5));
  if (month < 1 || month > 12) return null;
  return { start: `${value}-01`, end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}

export function filterRecords(batches: SourceDistributionBatch[], filter: DistributionFilter): DistributionRow[] {
  const range = periodRange(filter);
  return uniqueBatches(batches).filter(b => !filter.industry || (b.industryId ?? UNKNOWN) === filter.industry).flatMap(batch => batch.records.filter(record => {
    if (filter.model && (record.model ?? UNKNOWN) !== filter.model) return false;
    const day = validDay(record.citedAt);
    if (range && (!day || day < range.start || day > range.end)) return false;
    return true;
  }).map(record => ({ ...record, batchId: batch.id, sourceFile: batch.sourceFile, sourceSha256: batch.sourceSha256 })));
}

export function percentage(count: number, total: number): number | null { return total > 0 ? count / total : null; }
export function percentageText(value: number | null): string { return value === null ? '—' : (value * 100).toFixed(2) + '%'; }

export function mediaRanking(rows: DistributionRow[]): MediaGroup[] {
  const groups = new Map<string, MediaGroup>();
  for (const row of rows) {
    const key = mediaKey(row), previous = groups.get(key);
    if (previous) previous.count++;
    else groups.set(key, { key, name: row.mediaName, mediaUrl: row.mediaUrl, domain: mediaDomain(row.mediaUrl), count: 1, share: null });
  }
  return [...groups.values()].map(group => ({ ...group, share: percentage(group.count, rows.length) })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-CN'));
}

export function contentGroups(rows: DistributionRow[], denominator = rows.length): ContentGroup[] {
  const groups = new Map<string, DistributionRow[]>();
  for (const row of rows) {
    // A missing URL is not a shared identity. Keep each export row visible separately.
    const key = row.url ? 'url:' + row.url : JSON.stringify(['missing-url', row.sourceSha256, row.id]);
    const records = groups.get(key);
    if (records) records.push(row); else groups.set(key, [row]);
  }
  const values = (records: DistributionRow[], field: 'title' | 'mediaName' | 'mediaType' | 'contentStatus', fallback: string) => [...new Set(records.map(r => r[field] || (field === 'mediaName' ? mediaDomain(r.mediaUrl) : fallback)))].join(' / ');
  return [...groups].map(([key, records]) => {
    // Missing dates remain unknown even if another export row for this URL has a date.
    const publicationDays = [...new Set(records.map(r => validDay(r.publishedAt)))];
    return { key, url: records[0]?.url ?? null, title: values(records, 'title', '标题未知'), media: values(records, 'mediaName', '媒体未知'), type: values(records, 'mediaType', '未知'), status: values(records, 'contentStatus', '状态未知'), count: records.length, share: percentage(records.length, denominator), records, publishedAt: publicationDays.length === 1 ? publicationDays[0]! : null };
  }).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-CN'));
}

export function typeDistribution(rows: DistributionRow[]): DistributionSlice[] {
  const counts = new Map<string, number>();
  for (const row of rows) { const type = row.mediaType || '未知'; counts.set(type, (counts.get(type) ?? 0) + 1); }
  return [...counts].map(([label, count]) => ({ key: label, label, count, share: percentage(count, rows.length) })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-CN'));
}

export const PUBLICATION_BUCKETS = [
  ['day', '1天内 · 0–1天'], ['week', '1周内 · 2–7天'], ['month', '1月内 · 8–30天'], ['year', '1年内 · 31–365天'], ['three-years', '1–3年 · 366–1095天'], ['older', '3年以上 · 1096天及以上'], ['unknown', '未知'],
] as const;

export function periodEnd(batches: SourceDistributionBatch[], filter: DistributionFilter): string | null {
  return periodRange(filter)?.end ?? uniqueBatches(batches).filter(b => !filter.industry || (b.industryId ?? UNKNOWN) === filter.industry).flatMap(b => [validDay(b.period.end), ...b.records.map(r => validDay(r.citedAt))]).filter((v): v is string => !!v).sort().at(-1) ?? null;
}

export function publicationDistribution(contents: ContentGroup[], end: string | null): DistributionSlice[] {
  const urls = contents.filter(content => content.url), counts = new Map<string, number>();
  for (const content of urls) {
    const age = end && content.publishedAt ? Math.floor((Date.parse(end + 'T00:00:00Z') - Date.parse(content.publishedAt + 'T00:00:00Z')) / 86400000) : null;
    const key = age === null || !Number.isFinite(age) || age < 0 ? 'unknown' : age <= 1 ? 'day' : age <= 7 ? 'week' : age <= 30 ? 'month' : age <= 365 ? 'year' : age <= 1095 ? 'three-years' : 'older';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return PUBLICATION_BUCKETS.map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0, share: percentage(counts.get(key) ?? 0, urls.length) }));
}
