import {useEffect,useRef,useState,type ReactNode} from 'react';
import {MediaDialog} from './MediaMarket';
import {PlanExplanation,planMoney,pricingReason,directSummary,ContentResourceIdentity,contentResourceIdentity,ContentFeeScope} from './PlanningDetails';
import {recommendationKey} from './recommendations';
import type {Candidate,ContentPlan} from './types';

export interface QuantityChange {item_index:number;candidate_id:string;quantity:number}
interface Draft {values:string[];revision:number;failed?:boolean}
const validQuantity=(value:string)=>/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>=1&&Number(value)<=100;
/** Estimates update through the server; no browser quote synthesis or implicit cart writes. */
export function ContentPlanRecommendations({plans,candidates,selectedIndex,onSelect,onDetails,onUpdate,disabled,stale,children,onEditingChange,onApply,onAddMedia,applicationIssue,limitations=[]}:{plans:ContentPlan[];candidates:Candidate[];selectedIndex:number;onSelect:(index:number)=>void;onDetails:(candidate:Candidate)=>void;onUpdate:(index:number,quantities:QuantityChange[])=>Promise<boolean>;disabled:boolean;stale:boolean;children:ReactNode;onEditingChange?:(editing:boolean)=>void;onApply?:(index:number)=>void;onAddMedia?:(index:number)=>void;applicationIssue?:string;limitations?:string[]}) {
 const choices=plans.slice(0,3),activeIndex=choices[selectedIndex]?selectedIndex:0,selected=choices[activeIndex],key=selected?recommendationKey(selected,activeIndex):'';
 const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[pending,setPending]=useState<string|null>(null),[explanation,setExplanation]=useState(false),opener=useRef<HTMLElement|null>(null),mounted=useRef(true);
 const draft=drafts[key],quantities=draft?.values??selected?.items.map(item=>String(item.quantity))??[];
 const dirty=!!selected&&selected.items.some((item,index)=>!validQuantity(quantities[index]??'')||Number(item.quantity)!==Number(quantities[index])),invalid=quantities.some(value=>!validQuantity(value)),updating=dirty||pending===key;
 const latest=useRef({onUpdate,disabled,stale});latest.current={onUpdate,disabled,stale};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{setExplanation(false);},[key]);
 // Publish all outstanding drafts to the page owner so exports cannot contain old totals.
 const changed=(plan:ContentPlan,saved:Draft)=>plan.items.some((item,i)=>!validQuantity(saved.values[i]??'')||Number(item.quantity)!==Number(saved.values[i]));
 const hasEdits=choices.some((plan,index)=>{const saved=drafts[recommendationKey(plan,index)];return !!saved&&changed(plan,saved);});
 const queued=choices.map((plan,index)=>{const owner=recommendationKey(plan,index);return {plan,index,owner,draft:drafts[owner]};}).find(entry=>entry.draft&&!entry.draft.failed&&changed(entry.plan,entry.draft)&&entry.draft.values.every(validQuantity));
 const queuedKey=queued?`${queued.owner}:${queued.draft!.revision}`:'',saveQueue=useRef(queued);saveQueue.current=queued;
 useEffect(()=>{onEditingChange?.(hasEdits||pending!==null);},[hasEdits,pending,onEditingChange]);
 useEffect(()=>()=>{onEditingChange?.(false);},[onEditingChange]);
 useEffect(()=>{
  const queued=saveQueue.current;
  if(!queued?.draft||pending||disabled||stale)return;
  const revision=queued.draft.revision,values=[...queued.draft.values],owner=queued.owner,planIndex=queued.index,items=queued.plan.items;
  const timer=setTimeout(()=>{
   if(latest.current.disabled||latest.current.stale)return;
   setPending(owner);
   void latest.current.onUpdate(planIndex,items.map((item,index)=>({item_index:index,candidate_id:item.candidate_id,quantity:Number(values[index])}))).then(ok=>{
    if(!mounted.current)return;
    setDrafts(current=>{const saved=current[owner];if(!saved||saved.revision!==revision)return current;if(ok){const next={...current};delete next[owner];return next;}return {...current,[owner]:{...saved,failed:true}};});
   }).catch(()=>{if(mounted.current)setDrafts(current=>current[owner]?.revision===revision?{...current,[owner]:{...current[owner]!,failed:true}}:current);}).finally(()=>{if(mounted.current)setPending(null);});
  },450);
  return()=>clearTimeout(timer);
 // The queue survives tab switches; each request keeps its original plan owner.
 },[queuedKey,pending,disabled,stale]);
 const change=(index:number,value:string)=>setDrafts(current=>{const before=current[key]?.values??selected!.items.map(item=>String(item.quantity));return {...current,[key]:{values:before.map((entry,i)=>i===index?value:entry),revision:(current[key]?.revision??0)+1}};});
 const close=()=>{setExplanation(false);opener.current?.focus({preventScroll:true});};
 const amount=(value:string|null|undefined,currency?:string|null)=>updating?(invalid?'请修正篇数':draft?.failed?'费用更新失败':'正在更新…'):planMoney(value,currency);
 const totalArticles=invalid?null:quantities.reduce((sum,value)=>sum+Number(value),0);
 return <aside className="panel sm-recommendation" aria-labelledby="z-budget-heading"><header><h2 id="z-budget-heading">组合推荐</h2></header>{children}
  {choices.length>0&&<div className="sm-plan-switch" aria-label="比较组合">{choices.map((plan,index)=><button type="button" key={recommendationKey(plan,index)} className={index===activeIndex?'active':''} aria-pressed={index===activeIndex} onClick={()=>onSelect(index)}>组合 {index+1}<small>{plan.strategy}</small></button>)}</div>}
  {limitations.length>0&&<p className="small muted">{limitations.join('；')}</p>}
  {!selected&&<div className="sm-combination-empty">{limitations.length?'当前没有符合要求的可计价组合。':'填写预算并生成组合。'}</div>}
  {selected&&<section className="sm-plan"><h3>组合 {activeIndex+1} · {selected.strategy}</h3><p>{selected.reason_summary}</p>
   <ul className="sm-plan-media">{selected.items.map((item,index)=>{const candidate=candidates.find(value=>value.candidate_id===item.candidate_id),identity=contentResourceIdentity(item,candidate),bad=!validQuantity(quantities[index]??''),inputId=`sm-content-quantity-${activeIndex}-${index}`;return <li key={`${item.candidate_id}:${item.resource_id}:${index}`}>
    <div className="sm-plan-member">{candidate?<button type="button" className="link" onClick={()=>onDetails(candidate)}>{identity.name}</button>:<span>{identity.name}</span>}<label className="sm-quantity-control" htmlFor={inputId}><span>建议篇数</span><input id={inputId} inputMode="numeric" type="text" value={quantities[index]??String(item.quantity)} disabled={disabled||stale} aria-label={`${identity.name}建议篇数`} aria-invalid={bad} aria-describedby={bad?`${inputId}-error`:undefined} onChange={event=>change(index,event.target.value)}/></label></div>
    {bad&&<small id={`${inputId}-error`} className="block-error" role="alert">请输入 1–100 的整数篇数。</small>}
    <ContentResourceIdentity item={item} candidate={candidate}/>
    <div className="sm-price-equation"><span>{item.pricing_kind==='package'?'套餐计价（不拆算单价）':`${planMoney(item.unit_price,item.currency??selected.currency)} × ${bad?'—':quantities[index]} 篇`}{item.price_source==='catalog'?' · 目录价':''}{item.pricing_kind==='range'?' · 报价上界':''}{item.base_cost!=null?' = ':''}</span><strong>{amount(item.base_cost??item.known_cost??item.cost,item.currency??selected.currency)}</strong></div>
    {item.base_cost!=null&&item.known_cost!=null&&item.base_cost!==item.known_cost&&<small>含已知必要费用小计：{amount(item.known_cost,item.currency??selected.currency)}</small>}
    {!updating&&<ContentFeeScope item={item} currency={selected.currency} quiet/>}
    {(candidate?.reason_summary||item.quantity_reason)&&<><small className="sm-reason-heading">推荐理由</small>{candidate?.reason_summary&&<p className="sm-reason-body">{directSummary(candidate.reason_summary,identity.name)}</p>}{item.quantity_reason&&<p className="sm-reason-body">{item.quantity_reason}</p>}</>}
    {(item.content_tasks??[]).length>0&&<><small>稿件修改建议</small><ul className="sm-content-tasks">{item.content_tasks.map((task,taskIndex)=><li key={taskIndex}>{task}</li>)}</ul></>}
   </li>;})}</ul>
   {draft?.failed&&dirty&&<p className="block-error" role="alert">篇数已保留，费用暂未更新。<button type="button" className="link" disabled={disabled||stale} onClick={()=>setDrafts(current=>({...current,[key]:{...current[key]!,revision:(current[key]?.revision??0)+1,failed:false}}))}>重试更新费用</button></p>}
   <dl className="sm-plan-totals" aria-live="polite"><div><dt>总篇数</dt><dd>{totalArticles===null?'请修正篇数':`${totalArticles} 篇`}</dd></div><div><dt>预计总价</dt><dd>{amount(selected.known_total_cost??selected.total_cost,selected.currency)}</dd></div><div><dt>总预算</dt><dd>{planMoney(selected.total_cap,selected.currency)}</dd></div><div><dt>{selected.remaining_is_estimate?'按已知费用计算的余量':'预算余量 / 超额'}</dt><dd>{amount(selected.known_total_remaining??selected.total_remaining,selected.currency)}</dd></div>{selected.exploration_cap!=null&&<div><dt>探索费用 / 上限</dt><dd>{amount(selected.known_exploration_cost??selected.exploration_cost,selected.currency)} / {planMoney(selected.exploration_cap,selected.currency)}</dd></div>}</dl>
   {!updating&&(selected.errors??[]).map((issue,index)=><p className="block-error" key={index}>{pricingReason(issue.message||issue.code)}</p>)}
   <button type="button" className="button secondary sm-plan-reason-button" onClick={()=>{opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setExplanation(true);}}>查看组合理由</button>
   {onAddMedia&&<button type="button" className="button secondary" disabled={disabled||stale||updating} onClick={()=>onAddMedia(activeIndex)} title="把该组合的媒体作为选择加入购物车；报价与预检在购物车流程中继续核验">组合媒体加入购物车</button>}
   {onApply&&<><button type="button" className="button primary" disabled={disabled||stale||updating||!!applicationIssue} onClick={()=>onApply(activeIndex)}>加入本组合</button>{applicationIssue&&<p className="small muted">{applicationIssue}</p>}</>}
  </section>}
  <MediaDialog open={explanation} title={selected?.strategy||'组合理由'} confirmLabel="关闭" onCancel={close} onConfirm={close} footer={<button className="button primary" onClick={close}>关闭</button>}><PlanExplanation value={selected?.explanation} candidates={candidates}/></MediaDialog>
 </aside>;
}
