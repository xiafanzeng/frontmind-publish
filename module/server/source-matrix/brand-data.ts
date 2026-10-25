import source from '../../client/source-matrix/industry/yihang-data.json';
import { digest, type Row } from './common.js';

/**
 * Brand citation sample batches feeding the recommendation lane only.
 * The workbook export is converted offline (module/scripts/convert-source-distribution.py);
 * this module maps the preserved originals into planner citation records with
 * honest quality markers. It is never a fallback for the industry distribution
 * page, and file identity (sha256/version) travels with every request for audit.
 */
interface SampleRecord {
  id: string; sourceSheet: string | null; sourceRow: number | null; citedAt: string | null;
  model: string | null; question: string | null; title: string | null; url: string | null;
  mediaName: string | null; mediaUrl: string | null; mediaType: string | null; publishedAt: string | null; contentStatus: string | null;
}

export interface BrandDataBatch {
  id: string;
  label: string;
  version: string;
  sourceFile: string;
  sourceSha256: string;
  industryHint: string | null;
  period: { start: string | null; end: string | null };
  recordCount: number;
  models?: string[];
}


const batch = (source as { batch?: { id?: string; label?: string; version?: string; sourceFile?: string | null; sourceSha256?: string; industryId?: string | null; industryName?: string | null; period?: { start?: string | null; end?: string | null }; records?: SampleRecord[]; limitations?: string[] } }).batch ?? {};

function batchModels(records: unknown): string[] {
  return [...new Set((Array.isArray(records) ? records as SampleRecord[] : []).map(record => record.model).filter((model): model is string => !!model))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export const BRAND_DATA_BATCHES: BrandDataBatch[] = batch.sourceSha256 ? [{
  id: String(batch.id ?? 'yihang-20260913'),
  label: String(batch.label ?? '一航软件样本'),
  version: String(batch.version ?? 'unknown'),
  sourceFile: String(batch.sourceFile ?? '一航软件-信源分析-20260913-214944.xlsx'),
  sourceSha256: String(batch.sourceSha256),
  industryHint: batch.industryName ? String(batch.industryName) : null,
  period: { start: batch.period?.start ?? null, end: batch.period?.end ?? null },
  recordCount: Array.isArray(batch.records) ? batch.records.length : 0,
  models: batchModels(batch.records),
}] : [];

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase(); } catch { return null; }
}

/**
 * Map preserved sample rows to planner citation records. Unknown fields stay
 * null (the kernel treats them as unknown; nothing is invented). Each exported
 * row is one observation with a stable traceable evidence id — it is NOT an
 * answer record id and never claimed as one.
 */
export function brandCitationRecords(batchId: string, platforms?: string[]): Row[] {
  const selected = BRAND_DATA_BATCHES.find(item => item.id === batchId);
  if (!selected) return [];
  const records: SampleRecord[] = Array.isArray(batch.records) ? batch.records as SampleRecord[] : [];
  const platformFilter = platforms?.filter(Boolean) ?? [];
  const questionIds = new Map<string, string>();
  return records
    .filter(record => !platformFilter.length || (record.model && platformFilter.includes(record.model)))
    .map(record => {
      const questionText = record.question?.trim() || null;
      const questionId = questionText ? (questionIds.get(questionText) ?? (() => { const id = 'sample-question-' + digest({ text: questionText }); questionIds.set(questionText, id); return id; })()) : null;
      return {
        evidence_id: `sample:${selected.id}:${record.id}`,
        data_kind: 'detail',
        source_type: 'observation',
        batch: { id: selected.id, label: selected.label, version: selected.version, source_file: selected.sourceFile, source_sha256: selected.sourceSha256 },
        scope: {
          platform: record.model ?? null,
          model: record.model ?? null,
          question_id: questionId,
          question_text: questionText,
          cited_at: record.citedAt ?? null,
        },
        source_name: record.mediaName && record.mediaName.trim() ? record.mediaName : null,
        url: record.url ?? null,
        citation_url: record.url ?? null,
        domain: hostOf(record.mediaUrl),
        published_at: null,
        citation_count: 1,
        sample_date: record.citedAt ?? null,
        industry: null,
        media_type: record.mediaType ?? null,
        content_status: record.contentStatus ?? null,
        trace: { sheet: record.sourceSheet ?? null, row: record.sourceRow ?? null, title: record.title ?? null },
        quality: {
          missing_answer_id: true,
          missing_account_identity: !(record.mediaName && record.mediaName.trim()),
          missing_publication_date: true,
          missing_media_type: !record.mediaType,
        },
      };
    });
}
