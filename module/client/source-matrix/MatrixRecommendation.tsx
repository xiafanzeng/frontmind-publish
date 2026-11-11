import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { MediaDialog } from './MediaMarket';
import { display, label, quote, roleNames,industryContextSnapshot,referencedIndustryAggregates } from './SourceMatrixPresentation';
import { formatPublishingMoney, type MediaResource } from '../types';
import type { BudgetPlan, Candidate, Json, MatrixResult,ResourceSelection } from './types';
import {PlanExplanation,formalItemDetail,planMoney,plainValue,planQuantity,mandatoryFeeText,pricingReason,PlanUnknowns,samePublicationSpec,directSummary} from './PlanningDetails';
import {hasSuggestions,matrixCandidateGroups,matrixReadiness,suggestionGroups} from './matrix-readiness';

export {matrixRoles} from './matrix-readiness';
/** 卡片只放一句完整介绍；更长内容留在推荐理由弹窗里。 */
export function firstSentence(text:string):string {
 const trimmed=text.trim();if(!trimmed)return'';
 const end=trimmed.search(/[。！？!?；;]/);
 if(end>=0&&end<=44){const ch=trimmed[end]!;return trimmed.slice(0,end)+('。！？'.includes(ch)?ch:'。');}
 if(end>44){
  let cut=-1;for(let i=44;i>=20;i-=1){if('，,、；;'.includes(trimmed[i]??'')){cut=i;break;}}
  return cut>=0?trimmed.slice(0,cut)+'。':trimmed.slice(0,44)+'…';
 }
 return trimmed.length<=44?trimmed:trimmed.slice(0,44).replace(/[，、；,\s]+$/,'')+'…';
}
const purposes: Record<string, string> = {authority:'提供可信参考与背景',industry:'覆盖目标行业的核心问题',regional:'补充目标地区的信息覆盖',supplement:'补足核心层之外的触达',exploration:'小范围验证尚待确认的机会'};
const roleHelp:Record<string,{sources:string;usage:string}>={authority:{sources:'行业背景、技术概念、研究资料、标准解释等有来源的内容。',usage:'先建立事实背景，再衔接核心层的选型内容。参考阅读来源不等于可购买发布位。'},industry:{sources:'与目标行业和当前问题直接相关的专业介绍、选型问答、技术文章。',usage:'解释需求、比较条件、实施方法和交付内容，构成整套方案的主线。'},regional:{sources:'与目标地区场景相关、实际覆盖范围有依据的媒体或栏目。',usage:'说明本地服务和采购情境；没有匹配依据时保留空层，不按名称推断地域覆盖。'},supplement:{sources:'能补充核心问题或阅读场景的问答、比较图文、流程内容。',usage:'先明确补充哪一项，再安排内容分工，避免重复核心层的相同内容。'},exploration:{sources:'有明确假设、待验证的新表达方式、受众或查询场景。',usage:'限定验证内容、观察方式和停止条件；探索预算包含在总预算之内。'}};
/* 纯 CSS 悬停说明：:hover 显示、移开即隐藏且无焦点残留；键盘用 focus-visible 打开。
   不再使用 Radix 受控弹层（合成移动下事件链不可靠，曾出现移开后不关闭）。 */
function LayerHelp({role}:{role:string}) {
 return <span className="sm-role-help-wrap" tabIndex={0} aria-label={`${roleNames[role]}层说明`}><span aria-hidden="true">?</span><span className="sm-role-popover-lite" role="tooltip"><strong>{roleNames[role]}层</strong><dl><dt>用途</dt><dd>{purposes[role]}</dd><dt>适合内容</dt><dd>{roleHelp[role]?.sources}</dd><dt>使用方式</dt><dd>{roleHelp[role]?.usage}</dd></dl></span></span>;
}
export const itemObject = (item: Json): Record<string, Json> => item && typeof item === 'object' && !Array.isArray(item) ? item : {};
export const candidateName = (candidate: Candidate) => display(candidate.attributes.source_name ?? candidate.attributes.name ?? candidate.resource_id);
export function candidateForItem(item: Json, candidates: Candidate[]) {
 const value = itemObject(item);
 const matches=candidates.filter(candidate => value.candidate_id ? candidate.candidate_id === value.candidate_id : !!value.resource_id && candidate.resource_id === value.resource_id);
 return matches.length===1?matches[0]:undefined;
}
export function differentPlans(plans: BudgetPlan[]) {
 const seen = new Set<string>();
 const stable=(value:Json|undefined):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 return plans.filter(plan => {
  const key = JSON.stringify(plan.items.map(item => {const row=itemObject(item);return JSON.stringify([row.article_id,row.version,row.resource_id,row.offer_id,stable(row.publication_spec),row.quantity,row.purpose]);}).sort());
  if(seen.has(key))return false;seen.add(key);return true;
 }).slice(0,3);
}
const money = planMoney;
function safeUrl(value: Json | undefined) {if(typeof value !== 'string')return undefined;try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}}
function EvidenceValue({value}: {value: Json}) {
 if(Array.isArray(value))return <ul>{value.map((entry,index)=><li key={index}><EvidenceValue value={entry}/></li>)}</ul>;
 if(value&&typeof value==='object')return <dl>{Object.entries(value).map(([key,entry])=><div key={key}><dt>{key}</dt><dd><EvidenceValue value={entry}/></dd></div>)}</dl>;
 const url=safeUrl(value);return url?<a className="link" href={url} target="_blank" rel="noopener noreferrer">{String(value)} ↗</a>:<>{display(value)}</>;
}
export function CatalogResourceChoice({candidate,value,onChange,disabled}:{candidate:Candidate;value?:ResourceSelection;onChange:(value:ResourceSelection|null)=>void;disabled?:boolean}) {
 const choices=(candidate.catalog_matches??[]).flatMap(match=>match.offers.flatMap(offer=>offer.offer_id&&offer.publication_spec!=null?[{match,offer,value:{candidate_id:candidate.candidate_id,resource_id:match.resource_id,offer_id:offer.offer_id,publication_spec:offer.publication_spec}}]:[]));
 const selected=choices.findIndex(choice=>value?.resource_id===choice.value.resource_id&&value.offer_id===choice.value.offer_id&&samePublicationSpec(value.publication_spec,choice.value.publication_spec));
 return <section className="sm-resource-choice"><h3>对应可售资源与报价</h3>{choices.length?<label>资源 / 账号 / 报价<select value={selected<0?'':String(selected)} disabled={disabled} onChange={event=>onChange(event.target.value===''?null:choices[Number(event.target.value)]?.value??null)}><option value="">未选择，请核对账号和发布规格</option>{choices.map(({match,offer},index)=><option key={`${match.resource_id}:${offer.offer_id}:${index}`} value={index}>{match.source_name} · {match.account_id||match.channel_id||'账号待核验'} · {plainValue(offer.publication_spec)} · {offer.pricing?.amount!=null?planMoney(String(offer.pricing.amount),offer.pricing.currency):'报价待确认'}</option>)}</select></label>:null}{selected>=0&&<p className="small">{choices[selected]?.match.identity_relation==='confirmed'?'已提供可信资源映射':'研究来源与所选资源仍需核验具体身份'} · {choices[selected]?.offer.pricing_status==='terms_provided'?'报价条款已提供，采用前复核有效性':'报价条款尚待补齐'}</p>}</section>;
}

export const topicFitLabels:Record<string,string>={direct:'主题直接相关',related:'主题相邻相关',weak:'弱相关'};
export const formFitLabels:Record<string,string>={same:'同类载体可直接承接',adaptable:'现有素材可改编',rebuild:'需补充关键素材'};
export const audienceFitLabels:Record<string,string>={direct:'受众一致',adjacent:'相邻受众',unclear:'受众待核实'};
const fitLabel=(map:Record<string,string>,value:string|undefined,fallback:string):string=>typeof value==='string'&&value?(map[value]??value):fallback;

export function RecommendationReason({candidate,result,onClose,returnFocus,resourceSelection,onResourceSelection,disabled}: {candidate: Candidate | null;result: MatrixResult | null;onClose:()=>void;returnFocus?:HTMLElement|null;resourceSelection?:ResourceSelection;onResourceSelection?:(value:ResourceSelection|null)=>void;disabled?:boolean}) {
 useEffect(()=>{if(!candidate)return;const trigger=returnFocus;return()=>{trigger?.focus();};},[candidate,returnFocus]);
 if(!candidate)return null;
 const industryAggregates=referencedIndustryAggregates(result,candidate),industryContext=industryContextSnapshot(result);
 const globalIds=new Set([...(candidate.industry_aggregate_ids??[]),...(Array.isArray(industryContext.aggregates)?industryContext.aggregates.flatMap(entry=>{const row=itemObject(entry);return typeof row.aggregate_id==='string'?[row.aggregate_id]:[];}):[])]);
 const otherReferences=candidate.references?.filter(reference=>{const row=itemObject(reference);return row.type!=='aggregate'||typeof row.aggregate_id!=='string'||!globalIds.has(row.aggregate_id);});
 const cited=result?.source_analysis.detail_citations.filter(detail=>detail.evidence_ids.some(id=>candidate.evidence_ids.includes(id)))??[];
 const suggestionMode=Array.isArray(result?.matrix.suggestions?.selected_candidate_ids);
 return <MediaDialog open title={'推荐理由 · '+candidateName(candidate)} confirmLabel="关闭" onCancel={onClose} onConfirm={onClose} footer={<button className="button primary" onClick={onClose}>关闭</button>}>
  <div className="sm-reason"><p>{candidate.reason_summary||'推荐理由待确认'}</p><dl>
  {suggestionMode?<div><dt>适配判断</dt><dd>{candidate.topic_fit?`${fitLabel(topicFitLabels,candidate.topic_fit,'主题待判断')} · ${fitLabel(formFitLabels,candidate.form_fit,'载体待判断')} · ${fitLabel(audienceFitLabels,candidate.audience_fit,'受众待判断')}`:'适配标签待生成（规则推荐未做语义核验）'}{candidate.industry_rank?`；行业引用排名第 ${candidate.industry_rank.rank} 位（观察值，不代表可售或收录）`:''}</dd></div>
  :<div><dt>主层与辅助角色</dt><dd>{candidate.primary_role?roleNames[candidate.primary_role]??candidate.primary_role:'尚未分层'}{candidate.auxiliary_roles.length?'；辅助：'+candidate.auxiliary_roles.map(role=>roleNames[role]??role).join('、'):''}</dd></div>}
  <div><dt>匹配目标问题</dt><dd>{candidate.matched_questions.length?candidate.matched_questions.map(id=>{const questions=result?.scope.task.questions;const question=Array.isArray(questions)?questions.find(item=>item&&typeof item==='object'&&!Array.isArray(item)&&item.question_id===id):null;return question&&typeof question==='object'&&!Array.isArray(question)?display(question.text):id;}).join('；'):'未提供逐问题匹配'}</dd></div><div><dt>证据与身份</dt><dd>{label(candidate.evidence_relation||'none')} · {label(candidate.channel_status)} · {label(candidate.manuscript_status)}</dd></div></dl>
  {candidate.selection_reason&&<><h3>入选依据</h3><p className="sm-paragraphs">{candidate.selection_reason}</p></>}
  <h3>媒体介绍</h3><p className="sm-paragraphs">{candidate.media_intro||'此历史结果未提供独立媒体介绍，请结合来源详情核验。'}</p>
  <h3>内容方向</h3><p className="sm-paragraphs">{candidate.content_direction||'此结果尚未提供具体内容方向。'}</p>
  {suggestionMode?<h3>推荐排序</h3>:<h3>本层排序依据</h3>}
  <p>{suggestionMode?(candidate.selection_reason?'按本次推荐顺序排列；依据见上方入选依据。':'按服务端程序排序；规则推荐未提供语义排序理由。'):<>{candidate.layer_rank?`本层第 ${candidate.layer_rank} 位。`:'沿用本次矩阵的适配顺序。'}{candidate.ranking_reason||'历史结果没有独立排序理由；不会按报价或引用次数重新排序。'}</>}</p>
  {onResourceSelection&&<CatalogResourceChoice candidate={candidate} value={resourceSelection} onChange={onResourceSelection} disabled={disabled}/>}
  <h3>详细理由与覆盖价值</h3>{candidate.reason_details?.length?<ul>{candidate.reason_details.map((reason,index)=><li key={index}>{reason}</li>)}</ul>:<p>尚未提供更详细的推荐理由。</p>}
  <h3>依据来源与范围</h3><p>实际引用证据 {candidate.evidence_ids.length} 项 · 媒体关联行业依据 {candidate.aggregate_ids.length} 项 · 实际引用行业整体分布 {industryAggregates.length} 项。平台关联、行业推荐和供应商声明不等于该可售账号被引用。</p>
  {cited.map((detail,index)=><section className="sm-evidence-record" key={index}><EvidenceValue value={detail.scope}/><EvidenceValue value={detail.record}/>{safeUrl(detail.normalized_url)&&<a className="link" href={safeUrl(detail.normalized_url)} target="_blank" rel="noopener noreferrer">查看被引用内容 ↗</a>}</section>)}
  {result?.source_analysis.external_aggregates.filter(entry=>{const row=itemObject(entry);return typeof row.aggregate_id==='string'&&candidate.aggregate_ids.includes(row.aggregate_id);}).map((entry,index)=><section className="sm-evidence-record" key={'aggregate-'+index}><h4>行业汇总依据 · 不代表逐条引用</h4><EvidenceValue value={entry}/></section>)}
  {industryAggregates.map((entry,index)=><section className="sm-evidence-record" key={'industry-aggregate-'+index}><h4>行业整体分布参考（非该媒体引用）</h4><EvidenceValue value={entry}/></section>)}
  {otherReferences?.map((reference,index)=><section className="sm-evidence-record" key={'reference-'+index}><EvidenceValue value={reference}/></section>)}
  {candidate.attributes.observation_context&&<section className="sm-evidence-record"><h4>原始观察追溯</h4><p>以下为样本中的观察信息，仅支持本次语义判断，不等于完整引用证据或可售账号绑定。</p><EvidenceValue value={candidate.attributes.observation_context}/></section>}
  {!cited.length&&!otherReferences?.length&&!industryAggregates.length&&!candidate.attributes.observation_context&&<p>当前结果没有可展示的逐条内容链接、模型、引用日期或原始行追溯；不能据此声称当前稿件已被引用。</p>}
  <h3>限制与待确认</h3><ul>{[...candidate.hard_failures,...candidate.pending_conditions,...(candidate.unconfirmed_items??[]),...(result?.limitations??[])].map((item,index)=><li key={index}>{item}</li>)}</ul><p>{candidate.selection==='alternative'?'此候选为备选，未提供具体替代对象时不推断备选关系。':label(candidate.selection||'undecided')}</p>
  </div>
 </MediaDialog>;
}

/* Same taxonomy as the media library: two Chinese kinds keyed by catalog media_kind. */
const mediaKindLabels:Record<string,string>={news:'门户媒体',self_media:'第三方自媒体'};
const candidateMediaType=(candidate:Candidate,media?:MediaResource):string=>{
 const mapped=media?.kind&&media.kind!=='unknown'?media.kind:candidate.attributes.media_kind??candidate.attributes.media_type;
 const kindText=typeof mapped==='string'&&mapped.trim()?mapped.trim():'';
 if(mediaKindLabels[kindText])return mediaKindLabels[kindText]!;
 const taxonomy=candidate.attributes.taxonomy;
 return typeof taxonomy==='string'&&taxonomy.trim()?taxonomy.trim():'媒体渠道';
};
/* Per-article catalog price read from the same media-library resource the cart uses. */
const catalogPriceOf=(media?:MediaResource):string=>!media?'—':/^\d+$/.test(media.priceTenThousandths)&&BigInt(media.priceTenThousandths)>0n?formatPublishingMoney(media.priceTenThousandths):'待询价';

export function MatrixRecommendation({result,referenceCandidateIds=[],mediaFor,isSelected,issue,onToggle,onDetails,onMediaDetails,onLayer}: {result: MatrixResult;highlightedPlan?: BudgetPlan | null;highlightedCandidateIds?:string[];referenceCandidateIds?:string[];mediaFor:(id:string|null)=>MediaResource|undefined;isSelected:(media:MediaResource)=>boolean;issue:(candidate:Candidate,media:MediaResource)=>string;onToggle:(id:string)=>void;onDetails:(candidate:Candidate)=>void;onMediaDetails:(media:MediaResource)=>void;onLayer:(candidates:Candidate[])=>void}) {
 const [expanded,setExpanded]=useState<string[]>([]);
 useEffect(()=>setExpanded([]),[result.matrix_version]);
 const referenceOnly=new Set(referenceCandidateIds);
 const groups=matrixCandidateGroups(result.matrix);
 const readiness=matrixReadiness(result.matrix);
 const card=(candidate:Candidate)=>{
  const media=mediaFor(candidate.resource_id),blocked=referenceOnly.has(candidate.candidate_id)?'参考阅读，非购买发布位':media?issue(candidate,media):'尚未映射可售资源，仅供研究';
  const source=candidate.attributes.domain??candidate.attributes.media_domain??candidate.attributes.source_url??candidate.attributes.url;
  let domain=typeof source==='string'?source:'';try{if(domain.includes('://'))domain=new URL(domain).hostname;}catch{domain='';}
  return <article key={candidate.candidate_id} className={'sm-candidate'+(media&&isSelected(media)?' is-highlighted':'')} data-source-id={candidate.candidate_id}>
   <header><h4>{media?.name??candidateName(candidate)}</h4><span className="sm-card-links">{media&&<button className="link small" onClick={()=>onMediaDetails(media)}>媒体资料</button>}<button className="link small" onClick={()=>onDetails(candidate)}>查看推荐理由</button></span></header>
   {domain&&<span className="sm-candidate-domain">{domain}</span>}
   <p className="sm-media-intro">{firstSentence(directSummary(candidate.media_intro||candidate.reason_summary||'',candidateName(candidate)))||'查看媒体资料了解发布要求。'}</p>
   <div className="sm-candidate-foot"><strong className="sm-candidate-price">{referenceOnly.has(candidate.candidate_id)?'参考阅读':candidate.offers.length?quote(candidate):media&&/^\d+$/.test(media.priceTenThousandths)&&BigInt(media.priceTenThousandths)>0n?`${formatPublishingMoney(media.priceTenThousandths)} · 目录价`:'待询价'}</strong><div className="actions">{media?<label className={'sm-add'+(blocked?' is-disabled':'')} title={blocked||undefined}><input type="checkbox" aria-label={'选择 '+media.name+' '+media.platform} checked={isSelected(media)} disabled={!!blocked} onChange={()=>onToggle(candidate.candidate_id)}/>{isSelected(media)?'已加入':'加入购物车'}</label>:<span className="small muted">仅供研究</span>}</div></div>
   {media&&blocked&&<small className="sm-candidate-issue">{blocked}</small>}
  </article>;
 };
 if(!readiness.complete&&!readiness.partial)return <div className="x-empty" role="status"><strong>{readiness.message}</strong></div>;
 /* 2026.11.10-web.1 deliverable: the ≤20 deduplicated media acquisition
  * outlets with per-item adoption basis, the remaining candidate list and the
  * reference-only supplier ranking names. */
 if(hasSuggestions(result.matrix)){
  const suggestion=suggestionGroups(result.matrix);
  /* Same-name channel families: the ≤20 list keeps one row per channel. The
   * default family row presents the channel itself (name/type/overall basis/
   * price span) instead of one concrete account; every same-named platform
   * account unfolds beneath it with its own platform, catalog price and basis,
   * so buyers can compare platform strengths and pick the publishing account.
   * Siblings already shown in an expanded family leave the 候选清单. */
  const channelName=(candidate:Candidate)=>{const name=candidate.attributes.source_name??candidate.attributes.name;return typeof name==='string'&&name.trim()?name.trim():'';};
  const familyKey=(candidate:Candidate)=>{const name=channelName(candidate);return name?name.toLowerCase():'';};
  const validated=result.matrix.candidates.filter(candidate=>candidate.semantic_decision_validated);
  const byChannel=new Map<string,Candidate[]>();
  for(const candidate of validated){const key=familyKey(candidate);if(!key)continue;const list=byChannel.get(key)??[];list.push(candidate);byChannel.set(key,list);}
  const familyOf=(head:Candidate):Candidate[]=>{const key=familyKey(head);const members=key?byChannel.get(key)??[]:[];return members.length>1&&members.some(member=>member.candidate_id===head.candidate_id)?members:[head];};
  const familyNames=new Set(suggestion.selected.map(familyOf).filter(family=>family.length>1).map(family=>familyKey(family[0]!)));
  const others=suggestion.others.filter(candidate=>{const key=familyKey(candidate);return key?!familyNames.has(key):true;});
  const memberPlatform=(member:Candidate)=>{const media=mediaFor(member.resource_id);const platform=media?.platform??member.attributes.platform;return typeof platform==='string'&&platform.trim()?platform.trim():'同名账号';};
  const familyType=(family:Candidate[])=>[...new Set(family.map(member=>candidateMediaType(member,mediaFor(member.resource_id))))].join('/');
  const familyPrice=(family:Candidate[])=>{
   const prices=family.map(member=>mediaFor(member.resource_id)).filter((media):media is MediaResource=>!!media&&/^\d+$/.test(media.priceTenThousandths)&&BigInt(media.priceTenThousandths)>0n).map(media=>BigInt(media.priceTenThousandths));
   if(!prices.length)return family.some(member=>mediaFor(member.resource_id))?'待询价':'—';
   const low=prices.reduce((a,b)=>a<b?a:b),high=prices.reduce((a,b)=>a>b?a:b);
   return low===high?formatPublishingMoney(low.toString()):`${formatPublishingMoney(low.toString())}–${formatPublishingMoney(high.toString())}`;
  };
  return <div className="sm-suggest">
   <div className="table-wrap"><table className="sm-suggest-table"><caption className="sr-only">媒体渠道推荐：每行一个推荐渠道、类型、目录价与推荐依据，按适配度顺序排列；同名多平台账号可在行内展开对比</caption><thead><tr><th scope="col">媒体</th><th scope="col">类型</th><th scope="col">目录价/篇</th><th scope="col">推荐依据</th><th scope="col">操作</th></tr></thead><tbody>
   {suggestion.selected.map((candidate,index)=>{
    const media=mediaFor(candidate.resource_id),blocked=referenceOnly.has(candidate.candidate_id)?'参考阅读，非购买发布位':media?issue(candidate,media):'尚未映射可售资源，仅供研究';
    const basis=candidate.selection_reason||candidate.reason_summary||'推荐依据待补充（可重试未完成项）';
    const singleRow=(head:Candidate)=>{const headMedia=mediaFor(head.resource_id);return <tr key={head.candidate_id} className={headMedia&&isSelected(headMedia)?'is-highlighted':''}><th scope="row"><span className="sm-suggest-name">{index+1}. {headMedia?.name??candidateName(head)}</span>{head.industry_rank&&<span className="sm-suggest-rank">行业引用第 {head.industry_rank.rank} 位</span>}</th><td>{candidateMediaType(head,headMedia)}</td><td className="sm-suggest-price">{catalogPriceOf(headMedia)}</td><td className="sm-suggest-basis">{basis}{head.decision_basis==='rule'&&<span className="small muted">（规则生成，未做语义核验）</span>}</td><td><div className="sm-suggest-actions"><button className="link small" onClick={()=>onDetails(head)}>查看推荐理由</button>{headMedia&&!blocked&&<label className={'sm-add'+(blocked?' is-disabled':'')} title={blocked||undefined}><input type="checkbox" aria-label={'选择 '+(headMedia.name??candidateName(head))+' '+(headMedia.platform??'')} checked={isSelected(headMedia)} disabled={!!blocked} onChange={()=>onToggle(head.candidate_id)}/>{isSelected(headMedia)?'已加入':'加入购物车'}</label>}{!headMedia&&<span className="small muted">仅供研究</span>}{blocked&&headMedia&&<small className="sm-candidate-issue">{blocked}</small>}</div></td></tr>;};
    const family=familyOf(candidate);
    if(family.length===1)return singleRow(candidate);
    const open=expanded.includes('family:'+candidate.candidate_id);
    const highlighted=family.some(member=>{const memberMedia=mediaFor(member.resource_id);return memberMedia&&isSelected(memberMedia);});
    return <Fragment key={candidate.candidate_id}>
     <tr className={highlighted?'is-highlighted sm-suggest-family':'sm-suggest-family'}><th scope="row"><span className="sm-suggest-name">{index+1}. {media?.name??candidateName(candidate)}</span>{candidate.industry_rank&&<span className="sm-suggest-rank">行业引用第 {candidate.industry_rank.rank} 位</span>}</th><td>{familyType(family)}</td><td className="sm-suggest-price">{familyPrice(family)}</td><td className="sm-suggest-basis">{basis}{candidate.decision_basis==='rule'&&<span className="small muted">（规则生成，未做语义核验）</span>}</td><td><div className="sm-suggest-actions"><button className="link small" onClick={()=>onDetails(candidate)}>查看推荐理由</button><button className="link small" aria-expanded={open} onClick={()=>setExpanded(current=>current.includes('family:'+candidate.candidate_id)?current.filter(value=>value!=='family:'+candidate.candidate_id):[...current,'family:'+candidate.candidate_id])}>{open?'收起同名账号':`展开 ${family.length-1} 个同名平台账号`}</button></div></td></tr>
     {open&&family.map(member=>{
      const memberMedia=mediaFor(member.resource_id),memberBlocked=referenceOnly.has(member.candidate_id)?'参考阅读，非购买发布位':memberMedia?issue(member,memberMedia):'尚未映射可售资源，仅供研究';
      const memberBasis=member.selection_reason||member.reason_summary||'该账号的单独推荐依据待补充（可重试未完成项）。';
      return <tr key={'member-'+member.candidate_id} className="sm-suggest-member"><th scope="row"><span className="sm-suggest-name">{memberPlatform(member)}</span></th><td>{candidateMediaType(member,memberMedia)}</td><td className="sm-suggest-price">{catalogPriceOf(memberMedia)}</td><td className="sm-suggest-basis">{memberBasis}{member.decision_basis==='rule'&&<span className="small muted">（规则生成，未做语义核验）</span>}</td><td><div className="sm-suggest-actions"><button className="link small" onClick={()=>onDetails(member)}>查看推荐理由</button>{memberMedia&&!memberBlocked&&<label className={'sm-add'+(memberBlocked?' is-disabled':'')} title={memberBlocked||undefined}><input type="checkbox" aria-label={'选择 '+(memberMedia.name??candidateName(member))+' '+(memberMedia.platform??'')} checked={isSelected(memberMedia)} disabled={!!memberBlocked} onChange={()=>onToggle(member.candidate_id)}/>{isSelected(memberMedia)?'已加入':'加入购物车'}</label>}{!memberMedia&&<span className="small muted">仅供研究</span>}{memberBlocked&&memberMedia&&<small className="sm-candidate-issue">{memberBlocked}</small>}</div></td></tr>;
     })}
    </Fragment>;
   })}
   {!suggestion.selected.length&&<tr><td colSpan={5}><p className="sm-layer-gap">本轮没有得到可展示的推荐渠道，请重试或重新生成。</p></td></tr>}
   </tbody></table></div>
   {others.length>0&&<><button className="link small sm-more-candidates" aria-expanded={expanded.includes('others')} aria-controls="sm-suggest-others" onClick={()=>setExpanded(current=>current.includes('others')?current.filter(value=>value!=='others'):[...current,'others'])}>{expanded.includes('others')?'收起候选清单':`候选清单（未入选 ${others.length}）`}</button>{expanded.includes('others')&&<div className="sm-layer-candidates" id="sm-suggest-others" aria-label="未入选候选清单">{others.map(card)}</div>}</>}
   {suggestion.unmatched.length>0&&<details className="sm-suggest-ranking"><summary>行业排名前20中未匹配目录资源的媒体（{suggestion.unmatched.length}，仅供参考）</summary><ul>{suggestion.unmatched.map(item=><li key={item.rank+'-'+item.name}><span>第 {item.rank} 位 · {item.name}</span>{item.citation_count&&<span className="small muted">引用 {item.citation_count} 次（观察值）</span>}</li>)}</ul><p className="small muted">以上名称来自供应商行业媒体引用排名，未在当前媒体目录中找到对应可售资源；仅作信源参考，不能作为报价或发布依据。</p></details>}
   {suggestion.rankingStatus&&suggestion.rankingStatus!=='ok'&&suggestion.rankingMessage&&<p className="small muted" role="status">{suggestion.rankingMessage}</p>}
  </div>;
 }
 return <div className="table-wrap sm-layer-table-wrap"><table className="sm-layer-table"><caption className="sr-only">信源矩阵推荐：每层一行，层内为候选列表</caption><tbody>{groups.map(({role,items,gap,state})=><tr className="sm-layer-tr" key={role}><th scope="row" className="sm-layer-label"><div className="sm-layer-title"><h3>{roleNames[role]}层</h3><LayerHelp role={role}/></div><span>{state==='loading'?'候选读取中':state==='failed'?'候选读取失败':state==='incomplete'?`${items.length} 个已知候选 · 尚未完整`:state==='not_applicable'?'当前不适用':`${items.length} 个候选`}</span>{items.some(candidate=>{const media=mediaFor(candidate.resource_id);return media&&!isSelected(media)&&!issue(candidate,media);})&&<button className="link sm-layer-multi" onClick={()=>onLayer(items)}>多选本层可投媒体</button>}</th><td className="sm-layer-cell"><div className="sm-layer-candidates" id={'sm-layer-'+role} aria-label={roleNames[role]+'层候选'}>{items.length?(expanded.includes(role)?items:items.slice(0,3)).map(card):<p className="sm-layer-gap">{gap}</p>}</div>{items.length>0&&state!=='complete'&&<p className="small muted" role="status">{gap}</p>}{items.length>3&&<button className="link small sm-more-candidates" aria-expanded={expanded.includes(role)} aria-controls={'sm-layer-'+role} onClick={()=>setExpanded(current=>current.includes(role)?current.filter(value=>value!==role):[...current,role])}>{expanded.includes(role)?'收起候选':`更多候选（${items.length-3}）`}</button>}</td></tr>)}</tbody></table></div>;
}

export function BudgetRecommendations({plans,candidates,children,selectedIndex,onSelect,onApply,onDetails,disabled,stale,applicationIssue,onUpdate}: {plans:BudgetPlan[];candidates:Candidate[];children:ReactNode;selectedIndex:number;onSelect:(index:number)=>void;onApply:(plan:BudgetPlan)=>void;onDetails:(candidate:Candidate)=>void;disabled:boolean;stale:boolean;applicationIssue?:(plan:BudgetPlan)=>string|undefined;onUpdate?:(plan:BudgetPlan,quantities:Array<{item_index:number;candidate_id:string;quantity:number}>)=>Promise<boolean>}) {
 const [explanation,setExplanation]=useState<BudgetPlan|null>(null),opener=useRef<HTMLElement|null>(null);
 const [quantities,setQuantities]=useState<string[]>([]),[quantityError,setQuantityError]=useState(''),[updating,setUpdating]=useState(false);
 const choices=differentPlans(plans),activeIndex=choices[selectedIndex]?selectedIndex:0,selected=choices[activeIndex],applicationBlock=selected?applicationIssue?.(selected):undefined;
 useEffect(()=>setExplanation(null),[plans]);
 useEffect(()=>{setQuantities(selected?.items.map(item=>String(itemObject(item).quantity))??[]);setQuantityError('');},[selected]);
 const quantitiesDirty=!!selected&&selected.items.some((item,index)=>String(itemObject(item).quantity)!==quantities[index]);
 const updateQuantities=async()=>{
  if(!selected||!onUpdate||disabled||stale||updating)return;
  const bad=quantities.findIndex(value=>!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1);
  if(bad>=0){setQuantityError('篇数须为正整数；资源允许数量以复核为准。');document.getElementById(`sm-formal-quantity-${bad}`)?.focus();return;}
  const changes=selected.items.map((item,index)=>({item_index:index,candidate_id:candidateForItem(item,candidates)?.candidate_id??'',quantity:Number(quantities[index])}));
  if(changes.some(item=>!item.candidate_id)){setQuantityError('有发布项无法对应当前矩阵候选，请更新组合。');return;}
  setUpdating(true);setQuantityError('');try{await onUpdate(selected,changes);}finally{setUpdating(false);}
 };
 const close=()=>{setExplanation(null);opener.current?.focus({preventScroll:true});};
 return <aside className="panel sm-recommendation" id="z-budget-panel" aria-labelledby="z-budget-heading"><header><h2 id="z-budget-heading">组合推荐</h2></header>{children}{choices.length>0&&<><div className="sm-plan-switch" aria-label="比较预算组合">{choices.map((plan,index)=><button key={index} className={(activeIndex===index?'active':'')} aria-pressed={activeIndex===index} onClick={()=>onSelect(index)}>组合 {index+1}<small>{plan.strategy}</small></button>)}</div>{selected&&<section className="sm-plan" aria-live="polite"><h3>{selected.strategy||'预算组合'}</h3><p>{selected.reason_summary}</p><ul className="sm-plan-media">{selected.items.map((item,index)=>{
  const {candidate,unit,detail,fees,kind}=formalItemDetail(selected,index,candidates),row=itemObject(item);
  return <li key={index}><div className="sm-plan-member">{candidate?<button className="link" onClick={()=>onDetails(candidate)}>{candidateName(candidate)}</button>:display(row.resource_id)}<label className="sm-quantity-control">篇数{onUpdate?<input id={`sm-formal-quantity-${index}`} inputMode="numeric" type="text" aria-label={`${candidate?candidateName(candidate):display(row.resource_id)}正式发布篇数`} value={quantities[index]??String(row.quantity)} disabled={disabled||stale||updating} onChange={event=>setQuantities(current=>current.map((value,i)=>i===index?event.target.value:value))}/>:<strong>{display(row.quantity)} 篇</strong>}</label></div><small>规格：{plainValue(row.publication_spec)}</small><div className="sm-price-equation"><span>{unit}{kind==='unit'?` × ${display(row.quantity)} 篇`:''}</span><strong>{money(detail?.cost,detail?.currency??selected.currency)}</strong></div><small>附加费：{mandatoryFeeText(fees)}</small><small>{row.quantity_mode==='new_articles'?'每篇为不同内容':'使用绑定稿件；数量及重复发布条件以服务端核验为准'}</small><small>{detail?.unknown_reasons.map(pricingReason).join('；')||display(row.reason??'费用已按本次报价核验')}</small></li>;
 })}</ul>{onUpdate&&<><button className="button secondary" disabled={disabled||stale||updating||!quantitiesDirty} onClick={()=>void updateQuantities()}>{updating?'正在核算…':'复核正式方案篇数'}</button>{quantitiesDirty&&<p className="notice">篇数已修改，下方费用仍属原方案。请先复核，再确认购物车差异。</p>}{quantityError&&<p role="alert" className="block-error">{quantityError}</p>}</>}<dl className="sm-plan-totals"><div><dt>总篇数</dt><dd>{planQuantity(selected.items)??'待确认'} 篇</dd></div><div><dt>已知费用</dt><dd>{money(selected.known_total_cost,selected.currency)}</dd></div><div><dt>完整组合费用</dt><dd>{money(selected.total_cost,selected.currency)}</dd></div><div><dt>总预算</dt><dd>{money(selected.total_cap,selected.currency)}</dd></div><div><dt>预算余量 / 超额</dt><dd>{money(selected.total_remaining,selected.currency)}</dd></div><div><dt>探索费用 / 上限</dt><dd>{money(selected.exploration_cost,selected.currency)} / {money(selected.exploration_cap,selected.currency)}</dd></div><div><dt>待确认费用</dt><dd>{selected.unknown_items.length} 项{selected.is_estimate?' · 估算':''}</dd></div></dl><PlanUnknowns items={selected.unknown_items}/><button className="button secondary sm-plan-reason-button" onClick={()=>{opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setExplanation(selected);}}>查看方案理由与内容分工</button><p className="sm-plan-status">{selected.budget_feasible?'金额可行':'金额不可行 / 待确认'} · {selected.ready_to_publish?'服务报告已就绪，仍需网站预检':'待预检 / 不可直接执行'} · {selected.execution_recommended?'服务建议执行':'尚未建议执行'}</p>{selected.errors.map((error,index)=><p className="block-error" key={index}>{pricingReason(error.message||error.code)}</p>)}{selected.semantic_pending.length>0&&<p>仍有 {selected.semantic_pending.length} 个语义适配待确认项。</p>}{stale&&<p className="block-error">条件已变化，此组合仅供对照，请重新生成。</p>}{applicationBlock&&<p className="sm-plan-bridge">当前组合暂不能直接加入：{applicationBlock}。请补齐发布条件后重新核验。</p>}<button className="button primary" disabled={disabled||stale||updating||quantitiesDirty||!selected.items.length||!selected.budget_feasible||selected.is_estimate||!!selected.unknown_items.length||!!selected.errors.length||!!selected.semantic_pending.length||!!applicationBlock} onClick={()=>onApply(selected)}>加入本组合</button><p className="small muted">切换组合仅高亮成员；加入前核对差异，已有手选项保留。</p></section>}</>}{!choices.length&&<div className="sm-combination-empty">填写预算并生成组合。未知报价不会计为零，组合不保证全局最优。</div>}<MediaDialog open={!!explanation} title={explanation?.strategy||'方案理由与内容分工'} confirmLabel="关闭" onCancel={close} onConfirm={close} footer={<button className="button primary" onClick={close}>关闭</button>}><PlanExplanation value={explanation?.explanation} candidates={candidates}/></MediaDialog></aside>;
}
