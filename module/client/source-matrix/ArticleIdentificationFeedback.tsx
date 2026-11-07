import type { IdentificationFieldKey } from '../../shared/article-identification';
import type { ArticleIdentification } from './useArticleIdentification';
import './article-identification.css';

export function ArticleIdentificationStatus({ identification }: { identification: ArticleIdentification }) {
  const { status, message } = identification;
  const blocked = ['no_article', 'loading', 'identifying'].includes(status);
  const finished = ['complete', 'partial', 'unidentified'].includes(status);
  return <div className="sm-identification-status">
    <span role="status" aria-live="polite">{message}</span>
    <button type="button" className="button secondary" disabled={blocked} onClick={() => { void (status === 'failed' ? identification.retry() : identification.identify()); }}>
      {status === 'identifying' ? '识别中…' : status === 'failed' ? '重试识别' : status === 'not_configured' ? '重新检查配置' : finished ? '重新识别' : '根据稿件识别'}
    </button>
  </div>;
}
const origins = { article: '稿件信息', inferred: 'AI 建议', unidentified: '未识别', manual: '手动填写', saved: '已保存要求' };
// Display only our public enum; provider text and unexpected cached values never
// become failure explanations in the UI.
const reasons = {
  missing: '本次识别未提供此字段，请手动填写。', invalid_format: '此字段返回格式无效，未自动采用。',
  empty: '未识别出可填写内容，请手动确认。', too_long: '此字段超出长度限制，未自动采用。',
  industry_not_in_catalog: '行业候选不在当前目录中，请选择真实行业。', catalog_unavailable: '行业目录暂不可用，加载后可继续确认。',
  ambiguous_industry: '行业匹配存在歧义，请手动选择。', evidence_not_verbatim: '原文引证未能核实，请核对当前建议。',
  inferred_from_article: '根据稿件推断，请核对后使用。', unsupported_product: '稿件中未找到可靠的品牌／产品依据，请手动填写。',
  catalog_changed: '行业目录已更新，请重新确认行业。',
} as const;
export function ArticleIdentificationFieldInfo({ fieldKey, identification, industryName }: { fieldKey: IdentificationFieldKey; identification: ArticleIdentification; industryName?: (id: string) => string }) {
  const field = identification.fields[fieldKey];
  const suggestion = field.suggestion;
  const reason = field.reason && Object.prototype.hasOwnProperty.call(reasons, field.reason) ? reasons[field.reason] : undefined;
  const displayValue = (value: string) => fieldKey === 'industry' ? industryName?.(value) ?? '已匹配行业（可采用后查看）' : value;
  return <span className="sm-identification-field-info">
    <span className="sm-identification-origin" data-origin={field.origin}>{origins[field.origin]}</span>
    {field.evidence && <span className="sm-identification-evidence" title={field.evidence}>原文：{field.evidence}</span>}
    {reason && <span className="sm-identification-reason">{reason}</span>}
    {field.candidate && <span className="sm-identification-candidate">{fieldKey === 'industry' ? '行业候选' : '待确认'}：{field.candidate}，请手动确认。</span>}
    {suggestion?.value != null && <span className="sm-identification-suggestion">
      <span>{suggestion.source === 'article' ? '稿件信息' : 'AI 建议'}：{displayValue(suggestion.value)}</span>
      <button type="button" className="link" onClick={event => { event.preventDefault(); identification.adopt(fieldKey); }}>采用{suggestion.source === 'article' ? '稿件信息' : '建议'}</button>
    </span>}
  </span>;
}
