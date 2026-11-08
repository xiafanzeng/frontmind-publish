import type { MediaFilters } from "./types";
import { isUnrestrictedMediaCoverage } from '../shared/media-coverage';
export { isUnrestrictedMediaCoverage } from '../shared/media-coverage';

/** Unify old filter choices only; catalogue records retain their original coverage. */
export function normalizeMediaCoverageFilters(filters: MediaFilters): MediaFilters {
  if (![filters.province, filters.area, filters.region].some(isUnrestrictedMediaCoverage))
    return filters;
  return { ...filters, province: "", city: "", area: "", region: "" };
}
