import type { IndustryContent, IndustryDistributions, IndustryFilters, IndustryMedia, IndustryPage, IndustryScopeNode } from '../../contracts/industry-source.js';
import type { IndustryEndpoint } from './industry-query.js';

export class IndustryDecodeError extends Error {
  constructor() { super('Invalid industry response'); }
}

/** Preserve unsafe JSON integer tokens before JSON.parse can round them. Strings are untouched. */
export function parseIndustryJson(text: string): unknown {
  let output = '', index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === '\\') { index += 2; continue; }
        if (text[index++] === '"') break;
      }
      output += text.slice(start, index);
      continue;
    }
    if (character === '-' || (character >= '0' && character <= '9')) {
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index))?.[0];
      if (token) {
        output += /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)) ? JSON.stringify(token) : token;
        index += token.length;
        continue;
      }
    }
    output += character;
    index += 1;
  }
  try { return JSON.parse(output) as unknown; } catch { throw new IndustryDecodeError(); }
}

export function industryRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IndustryDecodeError();
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 1000, empty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) throw new IndustryDecodeError();
  return value;
}

function nullableText(value: unknown, maximum: number): string | null {
  return value === null || value === undefined ? null : text(value, maximum, true);
}

function array(value: unknown, maximum = 100): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new IndustryDecodeError();
  return value;
}

function integer(value: unknown, positive = false): string {
  const result = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value : '';
  if (!/^(?:0|[1-9]\d{0,18})$/.test(result) || BigInt(result) > 9223372036854775807n || (positive && result === '0')) throw new IndustryDecodeError();
  return result;
}

function date(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new IndustryDecodeError();
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new IndustryDecodeError();
  return result;
}

function filters(value: unknown): IndustryFilters {
  const source = industryRecord(value), ids = new Set<string>();
  let nodeCount = 0;
  const node = (input: unknown, depth: number): IndustryScopeNode => {
    if (++nodeCount > 5000 || depth > 20) throw new IndustryDecodeError();
    const entry = industryRecord(input), id = text(entry.id, 128);
    if (entry.scopeType !== 'CATEGORY' || ids.has(id)) throw new IndustryDecodeError();
    ids.add(id);
    return { id, label: text(entry.label, 500), scopeType: 'CATEGORY', scopeId: integer(entry.scopeId, true), children: array(entry.children, 5000).map(item => node(item, depth + 1)) };
  };
  const minDate = date(source.minDate), maxDate = date(source.maxDate);
  if (minDate && maxDate && minDate > maxDate) throw new IndustryDecodeError();
  return {
    models: array(source.models, 256).map(value => { const item = industryRecord(value); return { value: text(item.value, 128), label: text(item.label, 500) }; }),
    minDate, maxDate,
    industryTree: array(source.industryTree, 5000).map(value => node(value, 0)),
    sourceTypes: array(source.sourceTypes, 256).map(value => text(value, 500)),
  };
}

function media(value: unknown): IndustryMedia {
  const item = industryRecord(value);
  return { code: text(item.code, 500), name: text(item.name, 500), citationCount: integer(item.citationCount) };
}

function content(value: unknown): IndustryContent {
  const item = industryRecord(value), linkId = text(item.linkId, 500), ratio = text(item.citationRatio, 32);
  if (!/^\d{1,3}\.\d{2}$/.test(ratio) || Number(ratio) > 100) throw new IndustryDecodeError();
  const published = nullableText(item.publishTime, 19);
  if (published !== null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(published)) throw new IndustryDecodeError();
  return {
    sequence: integer(item.sequence, true), linkId,
    title: item.title === null || item.title === undefined || typeof item.title === 'string' && !item.title.trim() ? linkId : text(item.title, 10000),
    url: nullableText(item.url, 16384), icon: nullableText(item.icon, 16384),
    media: text(item.media, 500, true), sourceType: text(item.sourceType, 500, true),
    publishTime: published, citationCount: integer(item.citationCount), citationRatio: ratio,
  };
}

function page<T>(value: unknown, item: (value: unknown) => T): IndustryPage<T> {
  const source = industryRecord(value), pageSize = Number(integer(source.pageSize, true));
  if (pageSize > 100) throw new IndustryDecodeError();
  const items = array(source.items, pageSize).map(item);
  return {
    items, pageSize, total: integer(source.total), totalCitations: integer(source.totalCitations),
    snapshotToken: text(source.snapshotToken, 4096),
    nextCursor: source.nextCursor === null ? null : text(source.nextCursor, 4096),
    expiresAt: integer(source.expiresAt, true),
  };
}

function distributions(value: unknown): IndustryDistributions {
  const source = industryRecord(value);
  return {
    sourceTypeDistribution: array(source.sourceTypeDistribution, 256).map(value => {
      const item = industryRecord(value);
      return { code: text(item.code, 500), name: text(item.name, 500), citationCount: integer(item.citationCount) };
    }),
    publishTimeDistribution: array(source.publishTimeDistribution, 64).map(value => {
      const item = industryRecord(value);
      return { code: text(item.code, 128), name: text(item.name, 500), contentCount: integer(item.contentCount) };
    }),
  };
}

/** Deliberate response field allowlists: no provider metadata, credentials or invented media IDs. */
export function decodeIndustryData(endpoint: IndustryEndpoint, value: unknown): IndustryFilters | IndustryPage<IndustryMedia> | IndustryPage<IndustryContent> | IndustryDistributions {
  switch (endpoint) {
    case 'filters': return filters(value);
    case 'media-ranking': return page(value, media);
    case 'contents': return page(value, content);
    case 'distributions': return distributions(value);
  }
}
