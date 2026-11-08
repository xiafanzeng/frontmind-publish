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
/** Only actionable problems are public. Evidence and matching diagnostics remain in state. */
const errors = {
  missing: '请填写此项。', invalid_format: '识别格式无效，请填写。', empty: '请填写此项。',
  too_long: '识别内容过长，请填写。', industry_not_in_catalog: '请选择有效行业。',
  catalog_unavailable: '行业目录暂不可用。', ambiguous_industry: '请选择行业。',
  unsupported_product: '请填写品牌或产品。', catalog_changed: '行业已失效，请重新选择。',
} as const;
type IndustryFeedbackCatalog = { loading: boolean; error?: boolean; options: readonly { id: string; name: string }[]; retry: () => void };
export function ArticleIdentificationFieldInfo({ fieldKey, identification, industryCatalog, onIndustryAdopted }: {
  fieldKey: IdentificationFieldKey; identification: ArticleIdentification;
  industryName?: (id: string) => string;
  industryCatalog?: IndustryFeedbackCatalog; onIndustryAdopted?: () => void;
}) {
  const field = identification.fields[fieldKey];
  const ai = !!field.value && (field.origin === 'article' || field.origin === 'inferred');
  if (fieldKey === 'industry') {
    if (industryCatalog?.loading) return <span className="sm-identification-field-info" role="status">正在读取行业…</span>;
    if (industryCatalog?.error || industryCatalog && !industryCatalog.options.length) return <span className="sm-identification-field-info" role="status">
      行业目录暂不可用。<button type="button" className="link" onClick={industryCatalog.retry}>重试读取行业</button>
    </span>;
    const valid = !!field.value && (!industryCatalog || industryCatalog.options.some(item => item.id === field.value));
    if (valid) return ai ? <span className="sm-identification-field-info"><span className="sm-identification-origin" data-origin={field.origin}>AI 建议</span></span> : null;
    if (field.value) return <span className="sm-identification-field-info" role="status">行业已失效，请重新选择。</span>;
    // The identification server may have failed its own catalog read even when
    // this page already has a valid directory. Reload recognition to clear that
    // result-owned failure; a UI-only directory retry cannot repair it.
    if (field.reason === 'catalog_unavailable') return <span className="sm-identification-field-info" role="status">
      行业目录暂不可用。<button type="button" className="link" disabled={['loading', 'identifying'].includes(identification.status)} onClick={event => {
        event.preventDefault(); void identification.retry();
      }}>重试识别行业</button>
    </span>;
    if (!['complete', 'partial', 'unidentified'].includes(identification.status)) return null;
    const seen = new Set<string>();
    const options = !field.edited && !field.saved ? (field.suggestions ?? []).flatMap(option => {
      const current = industryCatalog?.options.find(item => item.id === option.id);
      if (!current || seen.has(current.id)) return [];
      seen.add(current.id); return [current];
    }).slice(0, 5) : [];
    return <span className="sm-identification-field-info">
      <span role="status">未识别</span>
      {options.length ? <span className="sm-identification-suggestion">
        <span>AI 建议</span>{options.map(option => <button key={option.id} type="button" className="link" onClick={event => {
          event.preventDefault();
          if (industryCatalog?.options.some(item => item.id === option.id) && identification.adoptIndustry(option.id)) onIndustryAdopted?.();
        }}>{option.name}</button>)}
      </span> : <span>请手动选择行业。</span>}
    </span>;
  }
  const reason = !field.value && field.reason && Object.prototype.hasOwnProperty.call(errors, field.reason) ? errors[field.reason as keyof typeof errors] : undefined;
  if (!ai && !reason) return null;
  return <span className="sm-identification-field-info">
    {ai && <span className="sm-identification-origin" data-origin={field.origin}>AI 建议</span>}
    {reason && <span className="sm-identification-reason">{reason}</span>}
  </span>;
}
