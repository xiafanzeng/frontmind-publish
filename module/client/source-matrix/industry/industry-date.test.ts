// Regression source only. Not executed in this source-only delivery.
import { describe, expect, it } from 'vitest';
import { formatIndustryDate, industryDateOptions, isIndustryDateValueAvailable, normalizeIndustryDateValue } from './industry-date';

describe('public industry date periods', () => {
  it('normalizes legacy ALL and out-of-range URLs against the supplier maximum', () => {
    expect(normalizeIndustryDateValue('ALL', '2020-01-01', '2026-09-01', '2026-11-07')).toEqual({ periodType: 'MONTH', date: '2026-11-01' });
    expect(normalizeIndustryDateValue('DAY', '2027-01-01', '2026-09-01', '2026-11-07')).toEqual({ periodType: 'DAY', date: '2026-11-07' });
    expect(normalizeIndustryDateValue('DAY', '2026-02-30', '2026-01-01', '2026-11-07')).toEqual({ periodType: 'DAY', date: '2026-11-07' });
    expect(normalizeIndustryDateValue('WEEK', '2026-11-07', '2026-09-01', '2026-11-07')).toEqual({ periodType: 'WEEK', date: '2026-11-02' });
  });
  it('separates natural period bounds from the available data interval', () => {
    const weekly = industryDateOptions('WEEK', '2026-10-28', '2026-11-07').options;
    expect(weekly.map(option => [option.start, option.end, option.availableStart, option.availableEnd])).toEqual([
      ['2026-11-02', '2026-11-08', '2026-11-02', '2026-11-07'],
      ['2026-10-26', '2026-11-01', '2026-10-28', '2026-11-01'],
    ]);
    const monthly = industryDateOptions('MONTH', '2024-02-07', '2024-03-04').options;
    expect(monthly[1]).toMatchObject({ start: '2024-02-01', end: '2024-02-29', availableStart: '2024-02-07', availableEnd: '2024-02-29' });
  });
  it('uses the ISO week year at year boundaries', () => {
    expect(formatIndustryDate({ periodType: 'WEEK', date: '2020-12-28' })).toBe('按周 · 2020年第53周');
    expect(formatIndustryDate({ periodType: 'WEEK', date: '2024-12-30' })).toBe('按周 · 2025年第1周');
    expect(formatIndustryDate({ periodType: 'WEEK', date: '2026-11-02' })).toBe('按周 · 2026年第45周');
  });
  it('does not invent history if the lower date bound is unknown', () => {
    expect(industryDateOptions('DAY', null, '2026-11-07').options.map(option => option.date)).toEqual(['2026-11-07']);
    expect(industryDateOptions('MONTH', null, '2026-11-07').options.map(option => option.date)).toEqual(['2026-11-01']);
    expect(industryDateOptions('DAY', '2026-11-08', '2026-11-07').options).toEqual([]);
    expect(normalizeIndustryDateValue('MONTH', undefined, null, null)).toBeNull();
    expect(industryDateOptions('DAY', null, null).options).toEqual([]);
  });
  it('windows the supported history locally without losing or inventing days', () => {
    const first = industryDateOptions('DAY', '2026-11-01', '2026-11-07', 0, 4);
    const next = industryDateOptions('DAY', '2026-11-01', '2026-11-07', 4, 4);
    expect(first.hasMore).toBe(true); expect(next.hasMore).toBe(false);
    expect([...first.options, ...next.options].map(option => option.date)).toEqual(['2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01']);
    expect(isIndustryDateValueAvailable({ periodType: 'WEEK', date: '2026-11-03' }, '2026-11-01', '2026-11-07')).toBe(false);
    expect(isIndustryDateValueAvailable({ periodType: 'WEEK', date: '2026-10-26' }, '2026-11-01', '2026-11-07')).toBe(true);
  });
});
