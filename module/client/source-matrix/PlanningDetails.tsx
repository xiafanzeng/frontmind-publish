import type {ReactNode} from 'react';
import type {BudgetPlan,Candidate,ContentPlanItem,Json} from './types';

export const planMoney=(value:string|null|undefined,currency:string|null|undefined)=>value==null?'待确认':`${currency??'币种待确认'} ${value}`;
/** Comparing structured specifications is independent of serialized field order. */
export function samePublicationSpec(left:Json|undefined,right:Json|undefined):boolean {
 const stable=(value:Json|undefined):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 return JSON.stringify(stable(left))===JSON.stringify(stable(right));
}
/** Research-source identity and the selected sellable account stay separate. */
export function ContentResourceIdentity({item,candidate}:{item:ContentPlanItem;candidate?:Candidate}) {
 const matches=(candidate?.catalog_matches??[]).flatMap(match=>match.resource_id===item.resource_id&&item.offer_id&&item.publication_spec!=null?match.offers.filter(offer=>offer.offer_id===item.offer_id&&samePublicationSpec(offer.publication_spec,item.publication_spec)).map(offer=>({match,offer})):[]);
 const selected=matches.length===1?matches[0]:undefined;
 return <div className="sm-content-resource"><p>所选可售媒体：{selected?.match.source_name||'待确认'}</p><p>具体账号：{selected?.match.account_id||'待确认'}{selected?.match.channel_id?' · 渠道 '+selected.match.channel_id:''}</p><p>报价身份：{selected?.offer.offer_id||'待确认'}</p>{!selected&&<p>资源与报价尚未唯一核验，研究来源名称不代表具体发布账号。</p>}</div>;
}
const reasonLabels:Record<string,string>={quantity_required_positive_integer:'篇数须为正整数',publication_identity_incomplete:'资源、规格或稿件身份尚未齐备',purpose_required:'请确认标准投放或探索用途',offer_missing_or_ambiguous:'报价缺失或存在多个匹配',offer_spec_mismatch:'发布规格与报价不一致',quantity_limit_invalid:'资源的数量限制待确认',quantity_out_of_range:'篇数超出该资源允许范围',currency_unknown:'报价币种待确认',quote_not_valid:'报价尚未生效或已经过期',quote_dates_unknown:'报价有效期待确认',price_unknown:'报价金额待确认',pricing_rule_unknown:'计价方式待确认',mandatory_fees_unknown:'必要附加费尚未确认',mandatory_fee_unknown:'附加费金额或计费方式待确认',package_cross_resource_unresolved:'套餐涉及的资源范围待确认',package_members_unresolved:'套餐包含的发布项待确认',package_purpose_allocation_unknown:'套餐用途分摊待确认',multiple_currencies:'不同币种不可直接合计',currency_mismatch:'报价币种与预算不一致',total_cap_exceeded:'完整费用超过总预算',exploration_not_enabled:'尚未启用探索预算',exploration_cap_exceeded:'探索费用超过子额度',locked_selection_removed:'必须保留已锁定发布项',locked_selection_changed:'锁定发布项不能自动修改',selected_offer_changed:'已选报价发生变化',repeat_publication_not_authorized:'当前稿件或资源尚不支持重复发布',content_tasks_incomplete:'篇数变化后须补全每篇内容任务',new_articles_need_individual_binding:'不同内容须逐篇绑定真实稿件',channel_not_eligible:'渠道条件未通过',channel_conditions_unconfirmed:'所选资源的投放条件待确认',locked_publications_require_formal_plan:'已有锁定发布项须在正式方案中核验',resource_mapping_requires_confirmation:'请先确认对应的可售资源',selected_resource_changed:'组合未保留本次明确选择的资源',quantity_intent_mismatch:'篇数含义与当前选择不一致',unit_price_above_max:'单篇费用超过所设上限',unit_price_below_min:'单篇费用低于所设下限',package_unit_limit_unresolved:'套餐不能直接套用单篇价格限制'};
export const pricingReason=(value:string)=>reasonLabels[value]??(/[\u4e00-\u9fff]/.test(value)?value:'存在待核验条件，完整记录见导出结果');
export function mandatoryFeeText(value:Json|undefined):string {
 if(value==null)return '待确认';
 if(Array.isArray(value)&&!value.length)return '无必要附加费（已确认）';
 if(Array.isArray(value))return value.map(entry=>{if(!entry||typeof entry!=='object'||Array.isArray(entry))return '附加费待确认';return `${entry.basis==='unit'?'每篇':entry.basis==='item'?'每项':'计费方式待确认'} ${plainValue(entry.amount)}${typeof entry.currency==='string'?' '+entry.currency:''}`;}).join('；');
 return '待确认';
}
export function PlanUnknowns({items}:{items:Json[]}) {
 const reasons=[...new Set(items.flatMap(item=>item&&typeof item==='object'&&!Array.isArray(item)&&Array.isArray(item.reasons)?item.reasons.filter((value):value is string=>typeof value==='string'):[]))];
 return reasons.length?<ul className="sm-plan-unknowns">{reasons.map(reason=><li key={reason}>{pricingReason(reason)}</li>)}</ul>:null;
}
export function planQuantity(items:Json[]):number|null {
 let total=0;
 for(const raw of items){const item=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};if(!/^\d+$/.test(String(item.quantity))||!Number.isSafeInteger(Number(item.quantity))||Number(item.quantity)<1)return null;total+=Number(item.quantity);}
 return items.length?total:null;
}
export function plainValue(value:Json|undefined):string {
 if(value==null)return '待确认';
 if(Array.isArray(value))return value.map(plainValue).join('、');
 if(typeof value==='object')return Object.entries(value).map(([key,item])=>`${fieldLabels[key]??key}：${plainValue(item)}`).join('；');
 return String(value);
}
const fieldLabels:Record<string,string>={objective:'方案目标',selection_logic:'选择逻辑',content_allocation:'逐媒体内容分工',tradeoffs:'组合取舍',excluded_candidates:'未选候选',fit_conditions:'适用条件',verification_items:'需要核验',candidate_id:'媒体',candidate_key:'媒体',responsibility:'承担任务',content_angle:'内容方向',reason:'理由',quantity:'篇数',content_tasks:'各篇内容',quantity_reason:'数量理由',purpose:'用途',amount:'金额',currency:'币种',scope:'计费范围',kind:'计价方式'};
/** One renderer shared by cards and reports; it never manufactures missing explanations. */
export function PlanExplanation({value,candidates}:{value:Json|undefined;candidates:Candidate[]}) {
 const names=new Map(candidates.map(candidate=>[candidate.candidate_id,String(candidate.attributes.source_name??candidate.attributes.name??candidate.candidate_id)]));
 const render=(entry:Json,key=''):ReactNode=>{
  if(entry==null)return '未提供';
  if(typeof entry==='string')return <span className="sm-paragraphs">{['candidate_id','candidate_key'].includes(key)?names.get(entry)??entry:entry}</span>;
  if(Array.isArray(entry))return entry.length?<ul>{entry.map((part,index)=><li key={index}>{render(part,key)}</li>)}</ul>:<span>未列出</span>;
  if(typeof entry==='object')return <dl>{Object.entries(entry).map(([field,part])=><div key={field}><dt>{fieldLabels[field]??field}</dt><dd>{render(part,field)}</dd></div>)}</dl>;
  return String(entry);
 };
 return <div className="sm-plan-explanation">{value?render(value):<p>此历史结果尚未提供完整方案解释，请重新生成以补全选择逻辑、内容分工与取舍。</p>}</div>;
}
export function formalItemDetail(plan:BudgetPlan,index:number,candidates:Candidate[]) {
 const raw=plan.items[index],item=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{},candidate=candidates.find(value=>item.candidate_id?value.candidate_id===item.candidate_id:!!item.resource_id&&value.resource_id===item.resource_id);
 // Select only the exact quote; a candidate may carry several incompatible offers.
 const matches=candidate?.offers.filter(value=>!!item.offer_id&&value.offer_id===item.offer_id&&samePublicationSpec(value.publication_spec,item.publication_spec))??[];
 const offer=matches.length===1?matches[0]:undefined;
 const detail=plan.details?.[index];
 const pricing=offer?.pricing,kind=detail?.pricing_kind??pricing?.kind,unit=kind==='package'?'套餐计价（不拆算单价）':detail?.unit_price!=null?planMoney(detail.unit_price,detail.currency):pricing?.kind==='unit'&&pricing.amount!=null?planMoney(String(pricing.amount),pricing.currency):'待确认';
 const fees=detail?.mandatory_fees!==undefined?detail.mandatory_fees:pricing?.mandatory_fees??offer?.mandatory_fees;
 return {item,candidate,offer,unit,detail,fees,kind};
}
