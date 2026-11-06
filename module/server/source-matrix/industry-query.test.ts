import { describe, expect, it } from 'vitest';
import { validateIndustryQuery } from './industry-query.js';

const common = 'periodType=MONTH&date=2026-10-01&scopeType=ALL&modelCode=all';
const operation = 'requestId=11111111-1111-4111-8111-111111111111';

describe('industry endpoint parameter boundaries', () => {
  it('rejects unknown and repeated parameters before any upstream call', () => {
    expect(() => validateIndustryQuery('filters', new URLSearchParams('projectId=1'))).toThrow();
    expect(() => validateIndustryQuery('media-ranking', new URLSearchParams(`${common}&${operation}&date=2026-10-02`))).toThrow();
    expect(() => validateIndustryQuery('distributions', new URLSearchParams(`${common}&requestId=x`))).toThrow();
    expect(() => validateIndustryQuery('media-ranking', new URLSearchParams(`${common}&${operation}&media=媒体`))).toThrow();
  });
  it('requires explicit scope and a valid operation ID for billed lists', () => {
    expect(() => validateIndustryQuery('media-ranking', new URLSearchParams(common))).toThrow();
    expect(() => validateIndustryQuery('contents', new URLSearchParams(`${common}&requestId=not_valid`))).toThrow();
    expect(() => validateIndustryQuery('contents', new URLSearchParams(operation))).toThrow();
  });
  it('preserves raw optional values and their presence for same-operation retries', () => {
    const query = new URLSearchParams(`${common}&${operation}&media=%20测试媒体%20&sourceType=&sortOrder=DESC`);
    expect(validateIndustryQuery('contents', query).toString()).toBe(query.toString());
    expect(validateIndustryQuery('contents', query).has('snapshotToken')).toBe(false);
  });
  it('retains full int64 scope IDs and rejects invalid dates or cursors', () => {
    const query = new URLSearchParams(`periodType=DAY&date=2026-11-06&scopeType=CATEGORY&scopeId=9007199254740993&modelCode=doubao_api&${operation}`);
    expect(validateIndustryQuery('contents', query).get('scopeId')).toBe('9007199254740993');
    expect(() => validateIndustryQuery('contents', new URLSearchParams(`${common.replace('2026-10-01', '2026-02-30')}&${operation}`))).toThrow();
    expect(() => validateIndustryQuery('contents', new URLSearchParams(`${common}&${operation}&cursor=cursor-without-session`))).toThrow();
    expect(() => validateIndustryQuery('contents', new URLSearchParams(`${common}&${operation}&snapshotToken=x&cursor=null`))).toThrow();
  });
});
