import { mediaAiPlatforms, mediaCoverageProvinces, normalizeAiPlatform, normalizeCoverage } from './media-catalog-filters.js';
import { isUnrestrictedMediaCoverage } from './media-coverage.js';

/** Province aliases are equivalent; a city constraint must never be widened
 * to its parent province. Keep city/unknown legacy text visible and exact. */
export function normalizeMatrixRegion(value: string): string {
  const raw = value.trim(), normalized = normalizeCoverage(raw);
  return normalized && !normalized.city && mediaCoverageProvinces.includes(normalized.province) ? normalized.province : raw;
}

/** Mixed legacy values retain their explicit regions; the unlimited alias is
 * removed. Unknown old values remain visible/removable rather than disappearing. */
export function normalizeMatrixRegions(value: string | readonly string[] | undefined): string[] {
  const values = typeof value === 'string' ? value.split(/[、,，;；\n]/u) : value ?? [];
  return [...new Set(values.map(item => item.trim()).filter(item => item && !isUnrestrictedMediaCoverage(item) && item !== 'nationwide')
    .map(normalizeMatrixRegion))];
}

export function matrixRegionDraft(regions: string, unrestricted?: boolean) {
  const values = normalizeMatrixRegions(regions);
  return { regions: values.join('、'), regionsUnrestricted: values.length ? false : unrestricted ?? true };
}

export const matrixHourOptions = [
  { value: '', label: '不限时效' }, { value: '6', label: '6小时以内' },
  { value: '12', label: '12小时以内' }, { value: '24', label: '1天以内' },
  { value: '72', label: '3天以内' },
] as const;
/** Legacy hours are retained exactly until explicitly changed. Never round or
 * reinterpret 0 as unlimited; invalid legacy values require a visible correction. */
export function matrixHourLabel(value: string): string {
  return matrixHourOptions.find(option => option.value === value)?.label ?? `原设置：${value} 小时`;
}
export function normalizeMatrixTargetPlatform(value: string | undefined): string {
  const raw = value?.trim() ?? '';
  return mediaAiPlatforms.includes(raw) ? raw : normalizeAiPlatform(raw) ?? raw;
}
export const isMatrixTargetPlatform = (value: string) => mediaAiPlatforms.includes(value);
