// Regression source only. Not executed in this source-only delivery.
import { describe, expect, it } from 'vitest';
import { formatIndustryDate, industryDateOptions, industryDayCalendar, isIndustryDateValueAvailable, moveIndustryDayFocus, normalizeIndustryDateValue } from './industry-date';

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

describe('public industry day calendar', () => {
  it('places month days in Monday-first weeks and leaves both ends blank', () => {
    const calendar = industryDayCalendar('2026-11-07', '2026-08-19', '2026-11-07')!;
    expect(calendar.label).toBe('2026年11月');
    expect(calendar.weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(calendar.weeks[5]).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(calendar.firstSelectable).toBe('2026-11-01');
    expect(calendar.lastSelectable).toBe('2026-11-07');
    expect(calendar.rangeLabel).toBe('可选日期：2026-08-19 至 2026-11-07');
  });
  it('handles leap February, ordinary February and adjacent years', () => {
    const leap = industryDayCalendar('2024-02-01', '2023-12-05', '2025-03-01')!;
    expect(leap.weeks.flat().filter(Boolean)).toHaveLength(29);
    expect(leap.weeks[0]).toEqual([null, null, null, '2024-02-01', '2024-02-02', '2024-02-03', '2024-02-04']);
    expect(industryDayCalendar('2025-02-01', '2023-12-05', '2025-03-01')!.weeks.flat().filter(Boolean)).toHaveLength(28);
    expect(industryDayCalendar('2024-01-01', '2023-12-05', '2025-03-01')).toMatchObject({ previousMonth: '2023-12-01', nextMonth: '2024-02-01' });
    expect(industryDayCalendar('2024-12-01', '2023-12-05', '2025-03-01')!.nextMonth).toBe('2025-01-01');
  });
  it('restricts navigation to known bounds and never invents a missing start', () => {
    expect(industryDayCalendar('2026-07-01', '2026-08-19', '2026-11-07')).toMatchObject({ month: '2026-08-01', previousMonth: null, firstSelectable: '2026-08-19' });
    expect(industryDayCalendar('2027-01-01', '2026-08-19', '2026-11-07')).toMatchObject({ month: '2026-11-01', nextMonth: null });
    expect(industryDayCalendar(null, null, '2026-11-07')).toMatchObject({ firstSelectable: '2026-11-07', lastSelectable: '2026-11-07', previousMonth: null, nextMonth: null, rangeLabel: '数据截至：2026-11-07' });
    expect(industryDayCalendar(null, null, null)).toBeNull();
    expect(industryDayCalendar(null, '2026-11-08', '2026-11-07')).toBeNull();
  });
  it('moves focus across weeks, months and years while clamping at actual availability', () => {
    const move = (day: string, key: string) => moveIndustryDayFocus(day, key, '2023-12-05', '2025-03-07');
    expect(move('2024-03-01', 'ArrowLeft')).toBe('2024-02-29');
    expect(move('2024-02-29', 'ArrowRight')).toBe('2024-03-01');
    expect(move('2024-12-31', 'ArrowRight')).toBe('2025-01-01');
    expect(move('2024-03-05', 'ArrowUp')).toBe('2024-02-27');
    expect(move('2024-02-27', 'ArrowDown')).toBe('2024-03-05');
    expect(move('2024-03-01', 'Home')).toBe('2024-02-26');
    expect(move('2024-03-01', 'End')).toBe('2024-03-03');
    expect(move('2024-03-31', 'PageUp')).toBe('2024-02-29');
    expect(move('2025-01-31', 'PageDown')).toBe('2025-02-28');
    expect(move('2023-12-05', 'ArrowLeft')).toBe('2023-12-05');
    expect(move('2025-03-07', 'ArrowDown')).toBe('2025-03-07');
    expect(move('2024-03-01', 'Enter')).toBeNull();
    expect(moveIndustryDayFocus('2026-11-07', 'ArrowLeft', null, '2026-11-07')).toBe('2026-11-07');
    expect(moveIndustryDayFocus('2026-11-07', 'ArrowLeft', null, null)).toBeNull();
  });
});
