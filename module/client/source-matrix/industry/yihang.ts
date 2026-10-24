import source from './yihang-data.json';
import type { SourceDistributionBatch } from '../../../contracts/source-distribution';

/** Offline workbook export only. Never use this batch as live-service fallback or Skill evidence. */
export const YIHANG_SOURCE_BATCH: SourceDistributionBatch = source.batch;
export const YIHANG_SOURCE_PROVENANCE = source.provenance;
