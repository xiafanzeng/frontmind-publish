import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@frontmind/module-ui/components/ui/popover';
import { MediaDialog } from './MediaMarket';
import { display, label, quote, roleNames } from './SourceMatrixPresentation';
import { formatPublishingMoney, type MediaResource } from '../types';
import type { BudgetPlan, Candidate, Json, MatrixResult,ResourceSelection } from './types';
import {PlanExplanation,formalItemDetail,planMoney,plainValue,planQuantity,mandatoryFeeText,pricingReason,PlanUnknowns,samePublicationSpec} from './PlanningDetails';

export const matrixRoles = ['authority', 'industry', 'regional', 'supplement', 'exploration'] as const;
const purposes: Record<string, string> = {authority:'提供可信参考与背景',industry:'覆盖目标行业的核心问题',regional:'补充目标地区的信息覆盖',supplement:'补足核心层之外的触达',exploration:'小范围验证尚待确认的机会'};
const roleHelp:Record<string,{sources:string;usage:string}>={authority:{sources:'行业背景、技术概念、研究资料、标准解释等有来源的内容。',usage:'先建立事实背景，再衔接核心层的选型内容。参考阅读来源不等于可购买发布位。'},industry:{sources:'与目标行业和当前问题直接相关的专业介绍、选型问答、技术文章。',usage:'解释需求、比较条件、实施方法和交付内容，构成整套方案的主线。'},regional:{sources:'与目标地区场景相关、实际覆盖范围有依据的媒体或栏目。',usage:'说明本地服务和采购情境；没有匹配依据时保留空层，不按名称推断地域覆盖。'},supplement:{sources:'能补充核心问题或阅读场景的问答、比较图文、流程内容。',usage:'先明确补充哪一项，再安排内容分工，避免重复核心层的相同内容。'},exploration:{sources:'有明确假设、待验证的新表达方式、受众或查询场景。',usage:'限定验证内容、观察方式和停止条件；探索预算包含在总预算之内。'}};
function LayerHelp({role}:{role:string}) {
 const [open,setOpen]=useState(false),[pinned,setPinned]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),trigger=useRef<HTMLButtonElement>(null);
 const [style,setStyle]=useState<CSSProperties>();
 const suppressFocus=useRef(false);
 const show=()=>{clearTimeout(timer.current);const node=trigger.current;if(node){const css=getComputedStyle(node);setStyle({fontFamily:css.fontFamily,'--sm-help-ink':css.getPropertyValue('--ink'),'--sm-help-line':css.getPropertyValue('--line'),'--sm-help-surface':css.getPropertyValue('--surface')} as CSSProperties);}setOpen(true);};
 const leave=()=>{if(!pinned)timer.current=setTimeout(()=>setOpen(false),180);};
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 return <Popover open={open} onOpenChange={value=>{setOpen(value);if(!value){setPinned(false);suppressFocus.current=true;}}}><PopoverTrigger asChild><button ref={trigger} type="button" className="sm-role-help" aria-label={`${roleNames[role]}层说明`} onMouseEnter={show} onMouseLeave={leave} onFocus={()=>{if(suppressFocus.current){suppressFocus.current=false;return;}show();}} onBlur={leave} onClick={event=>{event.preventDefault();if(pinned){setPinned(false);setOpen(false);}else{setPinned(true);show();}}}>?</button></PopoverTrigger><PopoverContent className="sm-role-popover" align="start" side="bottom" collisionPadding={16} style={style} onOpenAutoFocus={event=>event.preventDefault()} onCloseAutoFocus={()=>{suppressFocus.current=true;}} onMouseEnter={()=>clearTimeout(timer.current)} onMouseLeave={leave}><strong>{roleNames[role]}层</strong><dl><dt>用途</dt><dd>{purposes[role]}</dd><dt>适合内容</dt><dd>{roleHelp[role]?.sources}</dd><dt>使用方式</dt><dd>{roleHelp[role]?.usage}</dd></dl><button type="button" className="sm-role-close" onClick={()=>{suppressFocus.current=true;setOpen(false);setPinned(false);}}>关闭说明</button></PopoverContent></Popover>;
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
 return <section className="sm-resource-choice"><h3>对应可售资源与报价</h3><p>选择的是本次采购资源，不证明该具体账号曾被引用。更改后请更新组合以重新核算。</p>{choices.length?<label>资源 / 账号 / 报价<select value={selected<0?'':String(selected)} disabled={disabled} onChange={event=>onChange(event.target.value===''?null:choices[Number(event.target.value)]?.value??null)}><option value="">未选择，请核对账号和发布规格</option>{choices.map(({match,offer},index)=><option key={`${match.resource_id}:${offer.offer_id}:${index}`} value={index}>{match.source_name} · {match.account_id||match.channel_id||'账号待核验'} · {plainValue(offer.publication_spec)} · {offer.pricing?.amount!=null?planMoney(String(offer.pricing.amount),offer.pricing.currency):'报价待确认'}</option>)}</select></label>:<p>当前没有可选择的可信报价。需补齐媒体资源、发布规格和报价条款后再核算，未知费用不计为零。</p>}{selected>=0&&<p className="small">{choices[selected]?.match.identity_relation==='confirmed'?'已提供可信资源映射':'研究来源与所选资源仍需核验具体身份'} · {choices[selected]?.offer.pricing_status==='terms_provided'?'报价条款已提供，采用前复核有效性':'报价条款尚待补齐'}</p>}</section>;
}

export function RecommendationReason({candidate,result,onClose,returnFocus,resourceSelection,onResourceSelection,disabled}: {candidate: Candidate | null;result: MatrixResult | null;onClose:()=>void;returnFocus?:HTMLElement|null;resourceSelection?:ResourceSelection;onResourceSelection?:(value:ResourceSelection|null)=>void;disabled?:boolean}) {
 useEffect(()=>{if(!candidate)return;const trigger=returnFocus;return()=>{trigger?.focus();};},[candidate,returnFocus]);
 if(!candidate)return null;
 const cited=result?.source_analysis.detail_citations.filter(detail=>detail.evidence_ids.some(id=>candidate.evidence_ids.includes(id)))??[];
 return <MediaDialog open title={'推荐理由 · '+candidateName(candidate)} confirmLabel="关闭" onCancel={onClose} onConfirm={onClose} footer={<button className="button primary" onClick={onClose}>关闭</button>}>
  <div className="sm-reason"><p>{candidate.reason_summary||'推荐理由待确认'}</p><dl><div><dt>主层与辅助角色</dt><dd>{candidate.primary_role?roleNames[candidate.primary_role]??candidate.primary_role:'尚未分层'}{candidate.auxiliary_roles.length?'；辅助：'+candidate.auxiliary_roles.map(role=>roleNames[role]??role).join('、'):''}</dd></div><div><dt>匹配目标问题</dt><dd>{candidate.matched_questions.length?candidate.matched_questions.map(id=>{const questions=result?.scope.task.questions;const question=Array.isArray(questions)?questions.find(item=>item&&typeof item==='object'&&!Array.isArray(item)&&item.question_id===id):null;return question&&typeof question==='object'&&!Array.isArray(question)?display(question.text):id;}).join('；'):'未提供逐问题匹配'}</dd></div><div><dt>证据与身份</dt><dd>{label(candidate.evidence_relation||'none')} · {label(candidate.channel_status)} · {label(candidate.manuscript_status)}</dd></div></dl>
  <h3>媒体介绍</h3><p className="sm-paragraphs">{candidate.media_intro||'此历史结果未提供独立媒体介绍，请结合来源详情核验。'}</p>
  <h3>内容方向</h3><p className="sm-paragraphs">{candidate.content_direction||'此结果尚未提供具体内容方向。'}</p>
  <h3>本层排序依据</h3><p>{candidate.layer_rank?`本层第 ${candidate.layer_rank} 位。`:'沿用本次矩阵的适配顺序。'}{candidate.ranking_reason||'历史结果没有独立排序理由；不会按报价或引用次数重新排序。'}</p>
  {onResourceSelection&&<CatalogResourceChoice candidate={candidate} value={resourceSelection} onChange={onResourceSelection} disabled={disabled}/>}
  <h3>角色理由与覆盖价值</h3>{candidate.reason_details?.length?<ul>{candidate.reason_details.map((reason,index)=><li key={index}>{reason}</li>)}</ul>:<p>尚未提供更详细的角色理由。</p>}
  <h3>依据来源与范围</h3><p>实际引用证据 {candidate.evidence_ids.length} 项 · 行业推荐依据 {candidate.aggregate_ids.length} 项。平台关联、行业推荐和供应商声明不等于该可售账号被引用。</p>
  {cited.map((detail,index)=><section className="sm-evidence-record" key={index}><EvidenceValue value={detail.scope}/><EvidenceValue value={detail.record}/>{safeUrl(detail.normalized_url)&&<a className="link" href={safeUrl(detail.normalized_url)} target="_blank" rel="noopener noreferrer">查看被引用内容 ↗</a>}</section>)}
  {result?.source_analysis.external_aggregates.filter(entry=>{const row=itemObject(entry);return typeof row.aggregate_id==='string'&&candidate.aggregate_ids.includes(row.aggregate_id);}).map((entry,index)=><section className="sm-evidence-record" key={'aggregate-'+index}><h4>行业汇总依据 · 不代表逐条引用</h4><EvidenceValue value={entry}/></section>)}
  {candidate.references?.map((reference,index)=><section className="sm-evidence-record" key={'reference-'+index}><EvidenceValue value={reference}/></section>)}
  {candidate.attributes.observation_context&&<section className="sm-evidence-record"><h4>原始观察追溯</h4><p>以下为样本中的观察信息，仅支持本次语义判断，不等于完整引用证据或可售账号绑定。</p><EvidenceValue value={candidate.attributes.observation_context}/></section>}
  {!cited.length&&!candidate.references?.length&&!candidate.attributes.observation_context&&<p>当前结果没有可展示的逐条内容链接、模型、引用日期或原始行追溯；不能据此声称当前稿件已被引用。</p>}
  <h3>限制与待确认</h3><ul>{[...candidate.hard_failures,...candidate.pending_conditions,...(candidate.unconfirmed_items??[]),...(result?.limitations??[])].map((item,index)=><li key={index}>{item}</li>)}</ul><p>{candidate.selection==='alternative'?'此候选为备选，未提供具体替代对象时不推断备选关系。':label(candidate.selection||'undecided')}</p>
  </div>
 </MediaDialog>;
}

export function MatrixRecommendation({result,highlightedPlan,highlightedCandidateIds=[],referenceCandidateIds=[],mediaFor,isSelected,issue,onToggle,onDetails,onMediaDetails,onLayer}: {result: MatrixResult;highlightedPlan: BudgetPlan | null;highlightedCandidateIds?:string[];referenceCandidateIds?:string[];mediaFor:(id:string|null)=>MediaResource|undefined;isSelected:(media:MediaResource)=>boolean;issue:(candidate:Candidate,media:MediaResource)=>string;onToggle:(id:string)=>void;onDetails:(candidate:Candidate)=>void;onMediaDetails:(media:MediaResource)=>void;onLayer:(candidates:Candidate[])=>void}) {
 const [expanded,setExpanded]=useState<string[]>([]);
 useEffect(()=>setExpanded([]),[result.matrix_version]);
 const highlighted=new Set([...(highlightedPlan?.items.map(item=>candidateForItem(item,result.matrix.candidates)?.candidate_id).filter(Boolean)??[]),...highlightedCandidateIds]);
 const referenceOnly=new Set(referenceCandidateIds);
 const ordered=[...result.matrix.candidates].sort((a,b)=>{const left=result.matrix.fit_order.indexOf(a.candidate_id),right=result.matrix.fit_order.indexOf(b.candidate_id);return (left<0?Infinity:left)-(right<0?Infinity:right);});
 const assigned=new Set<string>();
 const groups=matrixRoles.map(role=>{const layer=result.matrix.layers.find(value=>value.role===role);const items=ordered.filter(candidate=>!assigned.has(candidate.candidate_id)&&(candidate.primary_role===role||!candidate.primary_role&&layer?.candidate_ids.includes(candidate.candidate_id)));items.forEach(candidate=>assigned.add(candidate.candidate_id));return {role,items,gap:layer?.reason_summary};});
 const card=(candidate:Candidate)=>{
  const media=mediaFor(candidate.resource_id),blocked=referenceOnly.has(candidate.candidate_id)?'参考阅读，非购买发布位':media?issue(candidate,media):'尚未映射可售资源，仅供研究';
  const source=candidate.attributes.domain??candidate.attributes.media_domain??candidate.attributes.source_url??candidate.attributes.url;
  let domain=typeof source==='string'?source:'';try{if(domain.includes('://'))domain=new URL(domain).hostname;}catch{domain='';}
  return <article key={candidate.candidate_id} className={'sm-candidate'+(highlighted.has(candidate.candidate_id)?' is-highlighted':'')} data-source-id={candidate.candidate_id}>
   <header><h4>{media?.name??candidateName(candidate)}</h4><button className="link small sm-reason-link" onClick={()=>onDetails(candidate)}>查看推荐理由</button></header>
   <span className="sm-candidate-domain">{domain||'来源域名待确认'}{highlighted.has(candidate.candidate_id)&&<span className="sm-member"> · 当前组合</span>}</span>
   <p className="sm-media-intro">{candidate.media_intro||'样本中的媒体来源；具体内容领域与账号身份待核验。'}</p>
   <div className="sm-candidate-foot"><strong className="sm-candidate-price">{referenceOnly.has(candidate.candidate_id)?'参考阅读':candidate.offers.length?quote(candidate):media&&/^\d+$/.test(media.priceTenThousandths)&&BigInt(media.priceTenThousandths)>0n?`${formatPublishingMoney(media.priceTenThousandths)} · 目录价`:'待询价'}</strong><div className="actions">{media&&<button className="link small" onClick={()=>onMediaDetails(media)}>媒体资料</button>}{media?<label className={'sm-add'+(blocked?' is-disabled':'')} title={blocked||undefined}><input type="checkbox" aria-label={'选择 '+media.name+' '+media.platform} checked={isSelected(media)} disabled={!!blocked} onChange={()=>onToggle(candidate.candidate_id)}/>{isSelected(media)?'已加入':'加入'}</label>:<span className="small muted">仅供研究</span>}</div></div>
   {media&&blocked&&<small className="sm-candidate-issue">{blocked}</small>}
  </article>;
 };
 return <div className="sm-layer-list">{groups.map(({role,items,gap})=><section className="sm-layer-row" key={role}><header><div className="sm-layer-title"><h3>{roleNames[role]}层</h3><LayerHelp role={role}/></div><p>{purposes[role]}</p><span>{items.length} 个候选</span>{items.some(candidate=>{const media=mediaFor(candidate.resource_id);return media&&!isSelected(media)&&!issue(candidate,media);})&&<button className="link small" onClick={()=>onLayer(items)}>选择本层可投媒体</button>}</header><div className="sm-layer-content"><div className="sm-layer-candidates" id={'sm-layer-'+role} aria-label={roleNames[role]+'层候选'}>{items.length?(expanded.includes(role)?items:items.slice(0,3)).map(card):<p className="sm-layer-gap">{gap||'暂无合适候选；当前依据不足，保留本层缺口。'}</p>}</div>{items.length>3&&<button className="link small sm-more-candidates" aria-expanded={expanded.includes(role)} aria-controls={'sm-layer-'+role} onClick={()=>setExpanded(current=>current.includes(role)?current.filter(value=>value!==role):[...current,role])}>{expanded.includes(role)?'收起候选':`更多候选（${items.length-3}）`}</button>}</div></section>)}</div>;
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
 return <aside className="panel sm-recommendation" id="z-budget-panel" aria-labelledby="z-budget-heading"><header><h2 id="z-budget-heading">组合推荐</h2><p>先确定媒体与内容，再核算篇数和预算。</p></header>{children}{choices.length>0&&<><div className="sm-plan-switch" aria-label="比较预算组合">{choices.map((plan,index)=><button key={index} className={(activeIndex===index?'active':'')} aria-pressed={activeIndex===index} onClick={()=>onSelect(index)}>组合 {index+1}<small>{plan.strategy}</small></button>)}</div>{selected&&<section className="sm-plan" aria-live="polite"><h3>{selected.strategy||'预算组合'}</h3><p>{selected.reason_summary}</p><ul className="sm-plan-media">{selected.items.map((item,index)=>{
  const {candidate,unit,detail,fees,kind}=formalItemDetail(selected,index,candidates),row=itemObject(item);
  return <li key={index}><div className="sm-plan-member">{candidate?<button className="link" onClick={()=>onDetails(candidate)}>{candidateName(candidate)}</button>:display(row.resource_id)}<label className="sm-quantity-control">篇数{onUpdate?<input id={`sm-formal-quantity-${index}`} inputMode="numeric" type="text" aria-label={`${candidate?candidateName(candidate):display(row.resource_id)}正式发布篇数`} value={quantities[index]??String(row.quantity)} disabled={disabled||stale||updating} onChange={event=>setQuantities(current=>current.map((value,i)=>i===index?event.target.value:value))}/>:<strong>{display(row.quantity)} 篇</strong>}</label></div><small>规格：{plainValue(row.publication_spec)}</small><div className="sm-price-equation"><span>{unit}{kind==='unit'?` × ${display(row.quantity)} 篇`:''}</span><strong>{money(detail?.cost,detail?.currency??selected.currency)}</strong></div><small>附加费：{mandatoryFeeText(fees)}</small><small>{row.quantity_mode==='new_articles'?'每篇为不同内容':'使用绑定稿件；数量及重复发布条件以服务端核验为准'}</small><small>{detail?.unknown_reasons.map(pricingReason).join('；')||display(row.reason??'费用已按本次报价核验')}</small></li>;
 })}</ul>{onUpdate&&<><button className="button secondary" disabled={disabled||stale||updating||!quantitiesDirty} onClick={()=>void updateQuantities()}>{updating?'正在核算…':'复核正式方案篇数'}</button>{quantitiesDirty&&<p className="notice">篇数已修改，下方费用仍属原方案。请先复核，再确认购物车差异。</p>}{quantityError&&<p role="alert" className="block-error">{quantityError}</p>}</>}<dl className="sm-plan-totals"><div><dt>总篇数</dt><dd>{planQuantity(selected.items)??'待确认'} 篇</dd></div><div><dt>已知费用</dt><dd>{money(selected.known_total_cost,selected.currency)}</dd></div><div><dt>完整组合费用</dt><dd>{money(selected.total_cost,selected.currency)}</dd></div><div><dt>总预算</dt><dd>{money(selected.total_cap,selected.currency)}</dd></div><div><dt>预算余量 / 超额</dt><dd>{money(selected.total_remaining,selected.currency)}</dd></div><div><dt>探索费用 / 上限</dt><dd>{money(selected.exploration_cost,selected.currency)} / {money(selected.exploration_cap,selected.currency)}</dd></div><div><dt>待确认费用</dt><dd>{selected.unknown_items.length} 项{selected.is_estimate?' · 估算':''}</dd></div></dl><PlanUnknowns items={selected.unknown_items}/><button className="button secondary sm-plan-reason-button" onClick={()=>{opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setExplanation(selected);}}>查看方案理由与内容分工</button><p className="sm-plan-status">{selected.budget_feasible?'金额可行':'金额不可行 / 待确认'} · {selected.ready_to_publish?'服务报告已就绪，仍需网站预检':'待预检 / 不可直接执行'} · {selected.execution_recommended?'服务建议执行':'尚未建议执行'}</p>{selected.errors.map((error,index)=><p className="block-error" key={index}>{pricingReason(error.message||error.code)}</p>)}{selected.semantic_pending.length>0&&<p>仍有 {selected.semantic_pending.length} 个语义适配待确认项。</p>}{stale&&<p className="block-error">条件已变化，此组合仅供对照，请重新生成。</p>}{applicationBlock&&<p className="sm-plan-bridge">当前组合暂不能直接加入：{applicationBlock}。请补齐发布条件后重新核验。</p>}<button className="button primary" disabled={disabled||stale||updating||quantitiesDirty||!selected.items.length||!selected.budget_feasible||selected.is_estimate||!!selected.unknown_items.length||!!selected.errors.length||!!selected.semantic_pending.length||!!applicationBlock} onClick={()=>onApply(selected)}>加入本组合</button><p className="small muted">切换组合仅高亮成员；加入前核对差异，已有手选项保留。</p></section>}</>}{!choices.length&&<div className="sm-combination-empty">填写预算并生成组合。未知报价不会计为零，组合不保证全局最优。</div>}<MediaDialog open={!!explanation} title={explanation?.strategy||'方案理由与内容分工'} confirmLabel="关闭" onCancel={close} onConfirm={close} footer={<button className="button primary" onClick={close}>关闭</button>}><PlanExplanation value={explanation?.explanation} candidates={candidates}/></MediaDialog></aside>;
}
