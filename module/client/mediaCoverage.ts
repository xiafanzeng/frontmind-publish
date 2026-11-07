import type { MediaFilters } from "./types";

const unrestrictedCoverageAliases = new Set([
  "不限地区",
  "全国",
  "全国覆盖",
  "综合全国",
  "综合全国（待确认）",
  "综合全国(待确认)",
]);

export function isUnrestrictedMediaCoverage(value?: string) {
  return unrestrictedCoverageAliases.has(value?.trim() ?? "");
}

/** Unify old filter choices only; catalogue records retain their original coverage. */
export function normalizeMediaCoverageFilters(filters: MediaFilters): MediaFilters {
  if (![filters.province, filters.area, filters.region].some(isUnrestrictedMediaCoverage))
    return filters;
  return { ...filters, province: "", city: "", area: "", region: "" };
}
