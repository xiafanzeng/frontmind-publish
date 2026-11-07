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
export function ArticleIdentificationFieldInfo({ fieldKey, identification, industryName }: { fieldKey: IdentificationFieldKey; identification: ArticleIdentification; industryName?: (id: string) => string }) {
  const field = identification.fields[fieldKey];
  const suggestion = field.suggestion;
  const displayValue = (value: string) => fieldKey === 'industry' ? industryName?.(value) ?? '已匹配行业（可采用后查看）' : value;
  return <span className="sm-identification-field-info">
    <span className="sm-identification-origin" data-origin={field.origin}>{origins[field.origin]}</span>
    {field.evidence && <span className="sm-identification-evidence" title={field.evidence}>原文：{field.evidence}</span>}
    {field.candidate && <span className="sm-identification-candidate">{fieldKey === 'industry' ? '行业候选' : '待确认'}：{field.candidate}，请手动确认。</span>}
    {suggestion?.value != null && <span className="sm-identification-suggestion">
      <span>{suggestion.source === 'article' ? '稿件信息' : 'AI 建议'}：{displayValue(suggestion.value)}</span>
      <button type="button" className="link" onClick={event => { event.preventDefault(); identification.adopt(fieldKey); }}>采用{suggestion.source === 'article' ? '稿件信息' : '建议'}</button>
    </span>}
  </span>;
}
