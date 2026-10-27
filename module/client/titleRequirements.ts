import type { MediaRules } from '../server/providers/kol/media-rules';

export type TitleRequirementDisplay = {
  state: 'constrained' | 'explicitly_unlimited' | 'unknown' | 'conflict' | 'unavailable';
  text?: string;
  evidence: string[];
  source?: string;
  collectedAt?: string;
  max?: number;
  exclusive?: boolean;
};

/** Catalogue evidence is separate from the normalized/frozen submission limit.
 * Neither a default titleLimit nor a price/draft snapshot proves a media rule.
 * Only the existing server parser decides what original catalogue text means.
 */
export function titleRequirementDisplay(rules?: MediaRules): TitleRequirementDisplay {
  const unavailable: TitleRequirementDisplay = { state: 'unavailable', text: '该媒体标题要求暂未读取，请重试。', evidence: [] };
  if (!rules || rules.version !== 1 || !Array.isArray(rules.rules)) return unavailable;
  const titleRules = rules.rules.filter(rule => rule.field === 'title_chars');
  if (titleRules.length !== 1) return unavailable;
  const rule = titleRules[0]!;
  const evidence = Array.isArray(rule.evidence) ? rule.evidence.filter(item => typeof item === 'string' && item.trim().length > 0) : [];
  const provenance = { evidence, source: rules.source, collectedAt: rules.collectedAt };
  if (rule.state === 'unknown') return { state: 'unknown', ...provenance };
  // A missing source clause cannot be substituted with a normalized number.
  if (evidence.length === 0) return { ...unavailable, ...provenance };
  if (rule.state === 'conflict') return { state: 'conflict', text: '标题要求来源冲突，请确认媒体资料。', ...provenance };
  if (rule.state === 'explicitly_unlimited') return { state: 'explicitly_unlimited', text: '目录明确：标题字数不限', ...provenance };
  const max = rule.max;
  if (rule.state !== 'constrained' || typeof max !== 'number' || !Number.isSafeInteger(max) || max < 0) return { ...unavailable, ...provenance };
  return {
    state: 'constrained',
    text: `目录要求：标题${rule.exclusive ? '少于' : '不超过'} ${max} 字`,
    max,
    exclusive: Boolean(rule.exclusive),
    ...provenance,
  };
}

/** Describe an existing validation failure; never change its numerical limit.
 * Current catalogue evidence can differ from a frozen draft's submission cap.
 */
export function titleLimitMessage(limit: number, requirement: TitleRequirementDisplay): string {
  if (requirement.state === 'constrained' && requirement.max !== undefined && requirement.max - (requirement.exclusive ? 1 : 0) === limit) {
    return `超过当前目录标题要求（${requirement.exclusive ? '少于' : '不超过'} ${requirement.max} 字），请缩短标题。`;
  }
  return `超过当前提交上限 ${limit} 字，请缩短标题。`;
}
