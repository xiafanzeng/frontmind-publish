import type { IndustryPeriod } from '../../../contracts/industry-source';

export type IndustryDatePeriod = Exclude<IndustryPeriod, 'ALL'>;
export type IndustryDateValue = { periodType: IndustryDatePeriod; date: string };
export type IndustryDateOption = IndustryDateValue & { label: string; start: string; end: string; availableStart: string | null; availableEnd: string };
export const INDUSTRY_DATE_PERIODS: ReadonlyArray<{ value: IndustryDatePeriod; label: string }> = [
  { value: 'DAY', label: '按日' }, { value: 'WEEK', label: '按周' }, { value: 'MONTH', label: '按月' },
];
const DAY_MS = 86_400_000;
const dateText = (date: Date) => date.toISOString().slice(0, 10);
export function isIndustryDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && dateText(parsed) === value;
}
export function industryPeriodStart(period: IndustryDatePeriod, value: string): string {
  if (period === 'MONTH') return value.slice(0, 7) + '-01';
  if (period === 'DAY') return value;
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return dateText(date);
}
function periodEnd(period: IndustryDatePeriod, start: string): string {
  const date = new Date(start + 'T00:00:00Z');
  if (period === 'WEEK') date.setUTCDate(date.getUTCDate() + 6);
  if (period === 'MONTH') date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return dateText(date);
}
function supportedRange(minDate: string | null, maxDate: string | null) {
  if (!isIndustryDate(maxDate)) return null;
  // A missing lower bound is unknown, not evidence of an unlimited history.
  const min = isIndustryDate(minDate) ? minDate : maxDate;
  return min <= maxDate ? { min, max: maxDate } : null;
}
export function isIndustryDateValueAvailable(value: IndustryDateValue, minDate: string | null, maxDate: string | null): boolean {
  const range = supportedRange(minDate, maxDate);
  return Boolean(range && INDUSTRY_DATE_PERIODS.some(period => period.value === value.periodType)
    && isIndustryDate(value.date) && industryPeriodStart(value.periodType, value.date) === value.date
    && value.date <= range.max && periodEnd(value.periodType, value.date) >= range.min);
}
export function normalizeIndustryDateValue(period: IndustryPeriod | string, date: string | undefined, minDate: string | null, maxDate: string | null): IndustryDateValue | null {
  const range = supportedRange(minDate, maxDate);
  if (!range) return null;
  const supported = INDUSTRY_DATE_PERIODS.find(item => item.value === period);
  const periodType = supported?.value ?? 'MONTH';
  const candidate = { periodType, date: industryPeriodStart(periodType, supported && isIndustryDate(date) ? date : range.max) };
  return isIndustryDateValueAvailable(candidate, minDate, maxDate)
    ? candidate : { periodType, date: industryPeriodStart(periodType, range.max) };
}
export function industryPeriodLabel(value: IndustryDateValue): string {
  if (value.periodType === 'DAY') return value.date;
  if (value.periodType === 'MONTH') return value.date.slice(0, 7);
  // ISO weeks belong to the year containing their Thursday, including cross-year weeks.
  const thursday = new Date(value.date + 'T00:00:00Z');
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const yearStart = new Date(thursday); yearStart.setUTCMonth(0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${year}年第${week}周`;
}
export function formatIndustryDate(value: IndustryDateValue): string {
  return `${INDUSTRY_DATE_PERIODS.find(period => period.value === value.periodType)!.label} · ${industryPeriodLabel(value)}`;
}
/** Window a real supported range locally; scrolling never reads an industry endpoint. */
export function industryDateOptions(periodType: IndustryDatePeriod, minDate: string | null, maxDate: string | null, offset = 0, limit = 80): { options: IndustryDateOption[]; hasMore: boolean } {
  const range = supportedRange(minDate, maxDate);
  if (!range) return { options: [], hasMore: false };
  const cursor = new Date(industryPeriodStart(periodType, range.max) + 'T00:00:00Z');
  const step = (amount: number) => {
    if (periodType === 'MONTH') cursor.setUTCMonth(cursor.getUTCMonth() - amount);
    else cursor.setUTCDate(cursor.getUTCDate() - amount * (periodType === 'WEEK' ? 7 : 1));
  };
  step(Math.max(0, Math.floor(offset)));
  const options: IndustryDateOption[] = [];
  const inRange = () => cursor.getTime() >= new Date(industryPeriodStart(periodType, range.min) + 'T00:00:00Z').getTime();
  while (options.length < Math.max(0, Math.floor(limit)) && inRange()) {
    const start = dateText(cursor), end = periodEnd(periodType, start), value = { periodType, date: start };
    options.push({ ...value, label: industryPeriodLabel(value), start, end, availableStart: isIndustryDate(minDate) ? start < range.min ? range.min : start : null, availableEnd: end > range.max ? range.max : end });
    step(1);
  }
  return { options, hasMore: inRange() };
}

/** Calendar browsing uses the same conservative availability as the period lists. */
export function industryDayCalendar(month: string | null, minDate: string | null, maxDate: string | null) {
  const range = supportedRange(minDate, maxDate);
  if (!range) return null;
  const minMonth = industryPeriodStart('MONTH', range.min), maxMonth = industryPeriodStart('MONTH', range.max);
  const requested = isIndustryDate(month) ? industryPeriodStart('MONTH', month) : maxMonth;
  const start = requested < minMonth ? minMonth : requested > maxMonth ? maxMonth : requested;
  const first = new Date(start + 'T00:00:00Z'), end = periodEnd('MONTH', start);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Number(end.slice(8));
  const cells = Array.from({ length: Math.max(35, Math.ceil((offset + days) / 7) * 7) }, (_, index) => {
    const day = index - offset + 1;
    return day < 1 || day > days ? null : `${start.slice(0, 8)}${String(day).padStart(2, '0')}`;
  });
  const weeks: Array<Array<string | null>> = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  const adjacent = (step: number) => {
    const date = new Date(first); date.setUTCMonth(date.getUTCMonth() + step);
    return dateText(date);
  };
  return {
    month: start, label: `${first.getUTCFullYear()}年${first.getUTCMonth() + 1}月`, weeks,
    firstSelectable: start < range.min ? range.min : start,
    lastSelectable: end > range.max ? range.max : end,
    previousMonth: start > minMonth ? adjacent(-1) : null,
    nextMonth: start < maxMonth ? adjacent(1) : null,
    rangeLabel: isIndustryDate(minDate) ? `可选日期：${minDate} 至 ${range.max}` : `数据截至：${range.max}`,
  };
}

/** Move only the browsing focus. This never changes the applied period or selected day. */
export function moveIndustryDayFocus(value: string, key: string, minDate: string | null, maxDate: string | null): string | null {
  const range = supportedRange(minDate, maxDate);
  if (!range || !isIndustryDate(value) || value < range.min || value > range.max) return null;
  const date = new Date(value + 'T00:00:00Z');
  const weekday = (date.getUTCDay() + 6) % 7;
  if (key === 'ArrowLeft') date.setUTCDate(date.getUTCDate() - 1);
  else if (key === 'ArrowRight') date.setUTCDate(date.getUTCDate() + 1);
  else if (key === 'ArrowUp') date.setUTCDate(date.getUTCDate() - 7);
  else if (key === 'ArrowDown') date.setUTCDate(date.getUTCDate() + 7);
  else if (key === 'Home') date.setUTCDate(date.getUTCDate() - weekday);
  else if (key === 'End') date.setUTCDate(date.getUTCDate() + 6 - weekday);
  else if (key === 'PageUp' || key === 'PageDown') {
    const day = date.getUTCDate(); date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + (key === 'PageUp' ? -1 : 1));
    const last = new Date(date); last.setUTCMonth(last.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(day, last.getUTCDate()));
  } else return null;
  // Clamp before serialization so even a boundary-year navigation cannot invent a date.
  if (date.getTime() < new Date(range.min + 'T00:00:00Z').getTime()) return range.min;
  if (date.getTime() > new Date(range.max + 'T00:00:00Z').getTime()) return range.max;
  return dateText(date);
}
