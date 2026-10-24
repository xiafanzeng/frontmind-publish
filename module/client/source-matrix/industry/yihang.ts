import source from './yihang-data.json';
import type { SourceDistributionBatch } from '../../../contracts/source-distribution';

/** Offline workbook export only. Never use this batch as live-service fallback or Skill evidence. */
export const YIHANG_SOURCE_BATCH: SourceDistributionBatch = source.batch;
/** Provenance is read as plain JSON values; the huge literal type would exceed compiler limits. */
export const YIHANG_SOURCE_PROVENANCE: Record<string, unknown> = source.provenance as Record<string, unknown>;
