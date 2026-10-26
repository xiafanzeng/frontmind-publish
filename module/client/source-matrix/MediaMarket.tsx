/** Design-owned media library shell and rows. Data remains supplied by the live gateways. */
import { Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { projectWorkspaceUrl, usePublishingWorkspaceKey } from '../host';
import { createPortal } from 'react-dom';

import { formatPublishingMoney, type MediaResource, type PublicationDraftItem } from '../types';
import { publicationSelectionAmounts } from '../publicationAmounts';
import type { MediaRules, RuleField } from '../../server/providers/kol/media-rules';
import '../publishing.market.css';
import {ReferenceSymbols,ReferenceIcon} from './ReferenceIcons';
import {referenceScopeStyle} from './ReferenceScope';


const api = '/api/modules/publish/media-requirements';
export async function rulesRequest<T>(path: string, signal?: AbortSignal, input?: unknown): Promise<T> {
 const response = await fetch(api + path, {credentials:'same-origin',signal,...(input === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})});
 const body = await response.json().catch(()=>null);
 if (!response.ok) throw new Error(body?.message ?? '媒体资料暂时不可用');
 return body as T;
}
export const credentialHelp = '请管理员准备：PUBLISHER_FEATURE_ENABLED=true、PUBLISHER_PROVIDER_ENABLED=true、PUBLISHER_MODE=live（或 test）、HTTPS 的 PUBLISHER_KOL_BASE_URL，以及 PUBLISHER_KOL_ACCESS_TOKEN；也可使用完整登录字段 PUBLISHER_KOL_API_KEY、MOBILE、PASSWORD、IDENTITY、CAPTCHA、CAPTCHA_TOKEN（后五项同样带 PUBLISHER_KOL_ 前缀）。凭据仅在服务端配置。';
export function useMarketRules(ids: string[], revision = ''): {key:string;rules:Record<string,MediaRules>;ready:boolean;error:string;loading:boolean;reload:()=>void} {
 const workspace = usePublishingWorkspaceKey(), idsKey = ids.join(','), key = `${workspace}:${revision}:${idsKey}`;
 const [reloadToken,setReloadToken] = useState(0);
 const reload = useCallback(()=>setReloadToken(value=>value+1),[]);
 const [state,setState] = useState<{key:string;reloadToken:number;rules:Record<string,MediaRules>;ready:boolean;error:string;loading:boolean}>({key:'',reloadToken:0,rules:{},ready:false,error:'',loading:true});
 useEffect(()=>{
   if (!idsKey) {
    setState({key,reloadToken,rules:{},ready:false,error:'',loading:false});
    return;
   }
  const abort=new AbortController();let active=true;
  const current=()=>active&&!abort.signal.aborted;
  setState({key,reloadToken,rules:{},ready:false,error:'',loading:true});
  const timeout=setTimeout(()=>{
   if(!current())return;
   abort.abort();
   setState({key,reloadToken,rules:{},ready:false,error:'媒体要求读取超时，请重试。',loading:false});
  },20_000);
  void rulesRequest<{configured:boolean;message?:string}>('/status',abort.signal).then(async status=>{
   if(!current())return;
   if(!status.configured){
    clearTimeout(timeout);
    setState({key,reloadToken,rules:{},ready:false,error:status.message??credentialHelp,loading:false});return;
   }
   const items:Array<{id:string;rules:MediaRules}>=[],all=idsKey?idsKey.split(','):[];
   for(let i=0;i<all.length;i+=100){
    const data=await rulesRequest<{items:Array<{id:string;rules:MediaRules}>}>('?ids='+encodeURIComponent(all.slice(i,i+100).join(',')),abort.signal);
    if(!current())return;
    items.push(...data.items);
   }
   if(current()){
    clearTimeout(timeout);
    setState({key,reloadToken,rules:Object.fromEntries(items.map(x=>[x.id,x.rules])),ready:true,error:'',loading:false});
   }
  }).catch(e=>{
   if(!current())return;
   clearTimeout(timeout);
   setState({key,reloadToken,rules:{},ready:false,error:e instanceof Error?e.message:'读取失败',loading:false});
  });
  return()=>{active=false;clearTimeout(timeout);abort.abort();};
 },[key,idsKey,reloadToken]);
 // Mask the previous scope (and previous attempt) before the new effect runs.
  const visible=state.key===key&&state.reloadToken===reloadToken?state:{key,rules:{},ready:false,error:'',loading:Boolean(idsKey)};
 return {...visible,reload};
}
export function MediaDialog({open,title,description,confirmLabel,onCancel,onConfirm,children,busy,confirmDisabled,footer,inline:_inline,wide:_wide}:{open:boolean;title:string;description?:string;confirmLabel:string;onCancel:()=>void;onConfirm:()=>void;children?:ReactNode;busy?:boolean;confirmDisabled?:boolean;inline?:boolean;wide?:boolean;footer?:ReactNode}) {
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=dialog.current;if(!node)return;if(open&&!node.open)node.showModal();else if(!open&&node.open)node.close();},[open]);
 if(!open)return null;
 return <dialog ref={dialog} id="dialog" aria-labelledby="dialog-title" onCancel={event=>{event.preventDefault();if(!busy)onCancel();}}><header className="dialog-header"><h2 id="dialog-title">{title}</h2><button className="close" aria-label="关闭弹窗" onClick={onCancel}><ReferenceIcon name="x"/></button></header><div id="dialog-body" className="dialog-body">{description&&<p className="small muted">{description}</p>}{children}</div><footer id="dialog-foot" className="dialog-foot">{footer??<><button className="button secondary" onClick={onCancel}>取消</button><button className="button primary" disabled={busy||confirmDisabled} onClick={onConfirm}>{confirmLabel}</button></>}</footer></dialog>;
}
export function MediaShell({title,note,notice,actions,taskbar,children,dialogs:extraDialogs,steps}:{title?:string;note?:string;notice?:ReactNode;actions?:ReactNode;taskbar?:ReactNode;children:ReactNode;dialogs?:ReactNode;steps?:ReactNode}) {
 const nodes=Children.toArray(children),dialogs=nodes.filter(node=>isValidElement(node)&&(node.type===MediaDialog||node.type===MediaDetails)),body=nodes.filter(node=>!dialogs.includes(node));
 // 无标题的页面（媒体选择总览）不再渲染页头区块，页内第一个元素就是流程条/正文。
 return <div className="fm-media" style={referenceScopeStyle}><ReferenceSymbols/><main id="view" className="content">{title!==undefined&&<header className="heading"><div><h1>{title}</h1><p>{note}</p></div><div className="actions">{actions}</div></header>}{notice}{steps}{taskbar}{body}</main>{dialogs}{extraDialogs}</div>;
}
export function MediaTabs(_props:{active:string;base?:string;query?:string}) { return null; }
export function MediaTaskbar({title,note,count=0,total,children,actions,saveStatus,cartHref='/publishing/media/cart',cart=true}:{title?:string;note?:string;count?:number;total?:string;children?:ReactNode;actions?:ReactNode;saveStatus?:string;cartHref?:string;cart?:boolean}) {
 return <section className="panel b-task"><div className="grow"><strong>{title || '独立浏览媒体库'}</strong><span className="small muted">{title?(note??'已确认稿件'):'可研究、收藏和保存方案；配置标题前需绑定已确认稿件'}</span></div>{children??<select aria-label="当前投放任务"><option value="research">独立浏览 / 研究</option>{title&&<option value="current">{title}</option>}</select>}<div className="actions">{actions}<span className="b-save">{saveStatus??''}</span></div>{cart&&<div className="b-taskbar-total"><Link href={projectWorkspaceUrl(cartHref)} className="button secondary">购物车 {count} · {total === undefined?'待确认':formatPublishingMoney(total)}</Link></div>}</section>;
}
/**
 * 底部购物车抽屉：整条汇总栏即展开入口（电商式交互），展开后直接管理当前已选媒体；
 * 数据来自调用方传入的真实选择集合，不维护第二份购物车状态。
 * 独立“查看购物车”按钮已移除，完整购物车页面路由保留，可经抽屉内链接进入。
 */
export function MediaCartFooter({count,total,cartHref='/publishing/media/cart',onNext,pending=0,nextLabel='配置标题',nextDisabled=false,nextHint,articlesHref,items,publicationItems,onRemove,researchNotice}:{count:number;total?:string;cartHref?:string;onNext?:()=>void;pending?:number;nextLabel?:string;nextDisabled?:boolean;nextHint?:string;articlesHref?:string;items?:MediaResource[];publicationItems?:PublicationDraftItem[];onRemove?:(media:MediaResource)=>void;researchNotice?:string}) {
 const [open,setOpen]=useState(false);
 const slotRef=useRef<HTMLDivElement>(null),dockRef=useRef<HTMLDivElement>(null),toggleRef=useRef<HTMLButtonElement>(null);
 const drawerId=useId(),hintId=useId(),expanded=open&&count>0;
 const amounts=publicationSelectionAmounts(items??[],publicationItems);
 // The in-flow slot owns width and bottom clearance. The dock itself is fixed,
 // so it remains visible even while the slot is far below the scroll viewport.
 useLayoutEffect(()=>{
  const slot=slotRef.current,dock=dockRef.current;
  if(!slot||!dock)return;
  let scrollOwner:HTMLElement|null=slot.parentElement;
  while(scrollOwner&&!/(auto|scroll)/.test(getComputedStyle(scrollOwner).overflowY))scrollOwner=scrollOwner.parentElement;
  let frame=0;
  const measure=()=>{
   frame=0;
   const anchor=slot.getBoundingClientRect(),viewport=window.visualViewport;
   const viewportLeft=viewport?.offsetLeft??0,viewportTop=viewport?.offsetTop??0;
   const viewportRight=viewportLeft+(viewport?.width??document.documentElement.clientWidth);
   const viewportBottom=viewportTop+(viewport?.height??window.innerHeight);
   const scrollBounds=scrollOwner?.getBoundingClientRect();
   const left=Math.max(anchor.left,viewportLeft),right=Math.min(anchor.right,viewportRight);
   const bottom=Math.min(viewportBottom,scrollBounds?.bottom??viewportBottom);
   dock.style.setProperty('--y-cart-left',`${left}px`);
   dock.style.setProperty('--y-cart-width',`${Math.max(0,right-left)}px`);
   dock.style.setProperty('--y-cart-viewport-bottom',`${Math.max(0,window.innerHeight-bottom)}px`);
   dock.dataset.positioned=right>left?'true':'false';
   const bar=dock.getBoundingClientRect();
   const bottomGap=Math.max(0,bottom-bar.bottom);
   slot.style.height=`${Math.ceil(bar.height+bottomGap+16)}px`;
   // Reserve the existing sticky topbar when present; do not change the host.
   const topbar=scrollOwner?.querySelector('.publish-topbar')?.getBoundingClientRect();
   const top=Math.max(viewportTop,scrollBounds?.top??viewportTop,topbar?.bottom??viewportTop);
   dock.style.setProperty('--y-cart-drawer-room',`${Math.max(0,bar.top-top-10)}px`);
  };
  const schedule=()=>{if(!frame)frame=window.requestAnimationFrame(measure);};
  const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(schedule);
  observer?.observe(slot);observer?.observe(dock);
  if(scrollOwner)observer?.observe(scrollOwner);
  window.addEventListener('resize',schedule);
  window.addEventListener('scroll',schedule,{capture:true,passive:true});
  const viewport=window.visualViewport;
  viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);
  measure();
  return()=>{
   observer?.disconnect();window.cancelAnimationFrame(frame);
   window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);
   viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);
  };
 },[]);
 useEffect(()=>{
  if(count===0&&open){
   setOpen(false);
   // Removing the last focused row must not leave keyboard focus on the body.
   if(document.activeElement===document.body)toggleRef.current?.focus({preventScroll:true});
  }
 },[count,open]);
 const close=()=>{setOpen(false);toggleRef.current?.focus({preventScroll:true});};
 const priceOf=(media:MediaResource)=>!/^[0-9]+$/.test(media.priceTenThousandths)||BigInt(media.priceTenThousandths)<=0n
   ?<span className="y-cart-pending">待确认</span>
   :formatPublishingMoney(media.priceTenThousandths);
 // Sample research uses the same measured dock, without inventing an empty live cart.
 if(researchNotice)return <div ref={slotRef} className="y-cart-slot"><div ref={dockRef} className="b-bottom y-cart-dock" id="x-cart-footer"><div className="y-cart-bar-wrap"><div className="y-cart-bar-summary" role="status"><strong>一航软件样本 · 仅供研究</strong><span className="small muted">{researchNotice}</span></div></div></div></div>;
 return <div ref={slotRef} className="y-cart-slot">
 <div ref={dockRef} className="b-bottom y-cart-dock" id="x-cart-footer" onKeyDown={event=>{if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();close();}}}>
  <div className="y-cart-bar-wrap">
    <button ref={toggleRef} type="button" className="y-cart-bar" aria-expanded={expanded} aria-disabled={count===0||undefined} aria-controls={drawerId} onClick={()=>{if(count>0)setOpen(v=>!v)}}>
      <span className="y-cart-bar-summary"><strong>购物车 {count} 家 <span style={{fontWeight:400,color:'#cabac9'}}>·</span> {count>0&&pending===count?<span className="y-cart-pending">总价待确认</span>:<>{total===undefined?'待确认':formatPublishingMoney(total)}{pending>0&&<> <span className="y-cart-pending">+ 待询价</span></>}</>}</strong><span className="small muted">{pending?`${pending} 项待询价 / 待确认；未知报价不计为 0 元。`:count?'报价来自媒体目录，发布前需重新确认。':'勾选即加入，取消勾选即移除。'}</span>{nextDisabled&&nextHint&&<span id={hintId} className="small muted y-cart-next-hint" role="status">{nextHint}</span>}</span>
      <span className={'y-cart-toggle'+(expanded?' is-open':'')} aria-hidden="true"><i>▴</i></span>
      <span className="sr">{expanded?'收起已选媒体':'展开已选媒体'}</span>
    </button>
    <div className="actions y-cart-actions">{nextDisabled&&articlesHref&&<Link className="button secondary" href={articlesHref}>进入稿件选择</Link>}<button type="button" className="button primary" disabled={nextDisabled} aria-describedby={nextDisabled&&nextHint?hintId:undefined} onClick={onNext}>{nextLabel} →</button></div>
  </div>
  <section id={drawerId} className="y-cart-drawer" aria-label="购物车已选媒体" hidden={!expanded}>
    <header className="y-cart-drawer-head">
      <strong>已选媒体 {count} 家{publicationItems?.length ? ` · ${amounts.quantity??'待确认'} 次发布` : ''}</strong>
      <span className="small muted">{count>0&&pending===count?'全部报价待确认':<>{total===undefined?'总价待确认':formatPublishingMoney(total)}{pending>0?<> · {pending} 项待询价</>:''}</>}</span>
      <div className="actions"><Link className="link small" href={projectWorkspaceUrl(cartHref)}>完整购物车 →</Link><button className="link small" type="button" aria-label="收起购物车" onClick={close}>▾</button></div>
    </header>
    <ul>{(items??[]).map(media=>{const amount=amounts.byMedia.get(media.id);return <li key={media.id}><strong>{media.name}</strong><small>{media.kind==='self_media'?'自媒体':'软文媒体'}{amount?.boundRows ? ` · ${amount.quantity??'待确认'} 次发布` : ''}</small><span className="b-price">{amount?.boundRows ? <>{amount.total===null?'小计待确认':formatPublishingMoney(amount.total)}<small>单价 {priceOf(media)} · 费用以复核结果为准</small></> : priceOf(media)}</span><button className="link danger small" type="button" aria-label={`移除 ${media.name}`} onClick={()=>onRemove?.(media)}>移除</button></li>;})}</ul>
  </section>
 </div>
 </div>;
}
export function RowHead(){return <div className="y-row-head" aria-hidden="true">{['媒体 / 账号','价格信息','平台与覆盖','稿件要求','发布条件与备注'].map(x=><span key={x}>{x}</span>)}</div>;}
export function Property({name,value,extra=false,empty='未提供',claim=false}:{name:string;value?:ReactNode;extra?:boolean;empty?:string;claim?:boolean}){const missing=value==null||value==='';return <dl className={'y-prop '+(extra?'y-extra':'')}><dt>{name}</dt><dd title={!missing&&typeof value==='string'?(claim?'原备注摘录 · 待核验：':'')+value:undefined} className={missing?'y-missing':''}>{missing?empty:value}</dd></dl>;}
export function ruleText(rules:MediaRules|undefined,field:RuleField) {
 const rule=rules?.rules.find(r=>r.field===field);
 if(!rule||rule.state==='unknown')return '未注明';
 if(rule.state==='conflict')return '规则冲突 · 待核验';
 if(rule.state==='explicitly_unlimited')return '明确不限';
 return (rule.exclusive?'少于 ':'不超过 ')+rule.max+(field.endsWith('chars')?' 字':field==='images'?' 张':' 个');
}
/** 其他要求：供应商备注里除已结构化展示的稿件要求（标题/正文/图片/链接等）之外的剩余条目。 */
export function otherRequirements(rules:MediaRules|undefined,remark:string|undefined) {
 if(rules)return rules.unresolved.length?rules.unresolved.join('；'):'未注明特殊要求';
 return remark?.trim()||'未注明特殊要求';
}
/** A viewport tooltip avoids clipping in the reference horizontal directory. */
export function MarketRemark({text,media,rules}:{text?:string;media?:MediaResource;rules?:MediaRules}) {
 const [pinned,setPinned]=useState(false),[open,setOpen]=useState(false),[position,setPosition]=useState({left:12,top:12}),id='x-tip',anchor=useRef<HTMLButtonElement>(null),tip=useRef<HTMLDivElement>(null);
 const content=text?.trim()?text:'未注明特殊要求 · 点击查看';
 useLayoutEffect(()=>{if(!open)return;const rect=anchor.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(475,window.innerWidth-24),height=tip.current?.offsetHeight??180;setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:Math.max(12,rect.top-height-12>12?rect.top-height-12:Math.min(rect.bottom+12,window.innerHeight-height-12))});},[open,content]);
 useEffect(()=>{if(!open)return;const close=()=>setOpen(false);window.addEventListener('scroll',close,true);window.addEventListener('resize',close);return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};},[open]);
 return <><button onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)} ref={anchor} className="x-remarks" type="button" aria-describedby={open?id:undefined} data-remarks={media?.id} aria-label={media?'查看 '+media.name+' 其他要求':'其他要求：'+content} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onClick={()=>{setOpen(false);setPinned(true);}} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);e.stopPropagation();}}}>{content}</button>{open&&createPortal(<div id={id} ref={tip} role="tooltip" className="x-tip y-tip" style={{left:position.left,top:position.top,width:Math.min(475,window.innerWidth-24)}}><h4>{media?media.name+' · '+media.platform:'其他要求'}</h4><div className="y-full-remark">{content}</div><div className="y-tooltip-rules">标题：{ruleText(rules,'title_chars')}　正文：{ruleText(rules,'body_chars')}　图片：{ruleText(rules,'images')}</div><div className="y-tip-status"><b>供应商目录 · 采集 {rules?.collectedAt??'未提供'}</b><br/>备注为供应商文本，声明尚未独立核验。<br/>悬停查看全文 · 点击固定查看与原始字段</div></div>,anchor.current?.closest('dialog[open]')||anchor.current?.closest('.fm-media')||document.body)}{pinned&&createPortal(<MediaDialog open title={'其他要求 · '+(media?.name??'')} confirmLabel="知道了" onCancel={()=>setPinned(false)} onConfirm={()=>setPinned(false)}><div className="actions"><span className="b-chip neutral">{media?.platform??'未提供'}</span><span className="b-chip neutral">供应商目录</span><span className="b-chip ">待人工复核</span></div><div className="y-raw-note" style={{marginTop:15}}>{content}</div><h3 className="y-section-label">结构化发布要求</h3>{media&&<MediaRuleTable media={media} rules={rules}/>}<h3 className="y-section-label">其他限制（原始提取条目）</h3><div className="reading">{rules?.unresolved.join('；')||'未注明'}</div></MediaDialog>,anchor.current?.closest('.fm-media')||document.body)}</>;
}
function remarkFact(text:string|undefined,kind:'speed'|'weekend'|'contact'|'shortTitle') {const patterns={speed:/当天可出|出稿快|发稿快|快速出稿/g,weekend:/周末可发|节假日可发/g,contact:/不带任何联系方式|不带联系方式|默认删除任何联系方式|联系方式默认去掉不通知/g,shortTitle:/自备短标题/g};return [...new Set((text??'').match(patterns[kind])??[])].join('；');}
export function MarketRow({media:m,rules,checked=false,disabled=false,favorite=false,onToggle,onFavorite,onDetails,onQuote,reason,selectionDisabledReason,catalogueFields=false}:{media:MediaResource;catalogueFields?:boolean;rules?:MediaRules;checked?:boolean;disabled?:boolean;favorite?:boolean;onToggle?:()=>void;onFavorite?:()=>void;onDetails?:()=>void;onQuote?:()=>void;reason?:string;selectionDisabledReason?:string}) {
 const selectionReasonId=useId(),disabledReason=disabled?selectionDisabledReason:undefined;
 const remark=rules?.rawRemark??m.remark,knownPrice=/^\d+$/.test(m.priceTenThousandths)&&BigInt(m.priceTenThousandths)>0n,link=m.caseUrl&&/^https?:\/\//i.test(m.caseUrl)?m.caseUrl:undefined,title=ruleText(rules,'title_chars')==='未注明'&&remarkFact(remark,'shortTitle')?'未注明 · 自备短标题':ruleText(rules,'title_chars');
 const external=(label:string)=>link?<a className="y-external" href={link} target="_blank" rel="noopener noreferrer" aria-label={'打开 '+m.name+' 的来源链接'}>{label} ↗</a>:<span className="y-missing">未提供有效链接</span>;
 return <article className={'y-media-row '+(checked?'selected':'')} data-media-id={m.id}>
 <div className="y-media-identity"><div className="y-media-title"><span className="y-monogram" aria-hidden="true">{Array.from(m.name)[0]||'媒'}</span><h3><button className="y-media-name" onClick={onDetails}>{m.name}</button></h3></div>
 <div className="y-identity-controls"><input type="checkbox" aria-label={'选择 '+m.name+' '+m.platform} aria-describedby={disabledReason?selectionReasonId:undefined} checked={checked} disabled={disabled} onChange={onToggle}/><span className="y-platform-pill">{m.platform}</span><button className={'y-row-star '+(favorite?'active':'')} aria-label={(favorite?'取消收藏':'收藏')+' '+m.name} aria-pressed={favorite} onClick={onFavorite}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.55 4.43 1.08 6.27L12 17.34l-5.63 2.96 1.08-6.27L2.9 9.6l6.3-.9Z"/></svg></button>{link&&<a className="y-external" href={link} target="_blank" rel="noopener noreferrer" aria-label={'查看 '+m.name+' 链接'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg></a>}</div>
 {disabledReason&&<p id={selectionReasonId} className="small muted">{disabledReason}</p>}
 <div className="y-row-origin"><span>{m.externalResourceId??m.id}</span><span>{checked?'已加入购物车':'目录记录'}</span></div></div>
 <div><span className="y-price-label">发布报价</span><div className={'y-price-value '+(!knownPrice?'is-pending':'')}>{knownPrice?formatPublishingMoney(m.priceTenThousandths):'待询价'}{knownPrice&&<small className="y-price-unit">/ 篇</small>}</div><div className="y-price-detail"><span>{knownPrice?'目录报价 · 发布前复核':'目录未提供报价'}</span><span className="y-extra">市场价：<span className="y-missing">未提供</span></span><button className="link" onClick={onQuote??onDetails}>{knownPrice?'查看 / 修改报价':'录入已确认报价'} ↗</button></div></div>
 <div className="y-props"><Property name="媒体平台" value={m.platform}/><Property name="覆盖地区" value={m.region}/><Property name="所属行业" value={m.taxonomy}/><div className="y-prop y-extra"><dt>原始链接</dt><dd>{external('查看链接')}</dd></div></div>
 <div className="y-props"><Property name="标题字数" value={title} claim={title.includes('自备短标题')}/><Property name="正文字数" value={ruleText(rules,'body_chars')}/><Property name="图片要求" value={ruleText(rules,'images')}/><Property name="联系方式" value={remarkFact(remark,'contact')} empty="未注明" claim extra/></div>
 <div className="y-last-column"><Property name="发布时效" value={catalogueFields?m.turnaround:remarkFact(remark,'speed')||m.turnaround} empty="未注明" claim={!catalogueFields}/><Property name="周末节假" value={remarkFact(remark,'weekend')} empty="未注明" claim/><Property name="AI 引用" empty="未提供监测数据" extra/><div className="y-remarks-line"><span>其他要求</span><MarketRemark text={otherRequirements(rules,remark)} media={m} rules={rules}/></div><div className="y-row-bottom"><span className="y-capture-tag">{remark?'其他要求待核验':'其他要求未注明'}</span><button className="link" onClick={onDetails}>资料详情 →</button></div></div>
 {reason&&<div className="y-source-context"><span><strong>{m.taxonomy}</strong>{reason}</span><button className="link" onClick={onDetails}>推荐依据 →</button></div>}</article>;
}
export function MediaRuleTable({rules,media}:{rules?:MediaRules;media:MediaResource}) {return <><table className="x-rule-table"><tbody><tr><td>标题字数</td><td>{ruleText(rules,'title_chars')}</td></tr><tr><td>正文字数</td><td>{ruleText(rules,'body_chars')}</td></tr><tr><td>图片要求</td><td>{ruleText(rules,'images')}</td></tr><tr><td>联系方式（源字段）</td><td>{remarkFact(rules?.rawRemark??media.remark,'contact')||<span className="muted">未注明</span>}</td></tr><tr><td>链接要求（源字段）</td><td>{ruleText(rules,'links')}</td></tr><tr><td>时效条目（源字段）</td><td>{media.turnaround||<span className="muted">未注明</span>}</td></tr><tr><td>结构化状态</td><td>{rules?.rules.some(r=>r.state==='constrained')?'已解析 · 需核对依据':'尚未启用为自动规则'}</td></tr></tbody></table><p className="y-subtle-note">空值 / “-” 表示未注明，按无额外要求参与选媒；不代表媒体已确认支持。“自备短标题”不转换为 30 字。上述提取条目保留原分类，原始数据不会被改写。</p></>;}
export function MediaDetails({media,rules,onClose,onToggle,onQuote,checked=false,catalogueFields=false}:{media?:MediaResource;catalogueFields?:boolean;rules?:MediaRules;onClose:()=>void;onToggle?:()=>void;onQuote?:()=>void;checked?:boolean}) {
 const [editing,setEditing]=useState(false),[error,setError]=useState(''),[titleState,setTitleState]=useState('unknown'),[bodyState,setBodyState]=useState('unknown'),[imageState,setImageState]=useState('unknown'),[links,setLinks]=useState('unknown'),[title,setTitle]=useState(''),[body,setBody]=useState(''),[images,setImages]=useState(''),[evidence,setEvidence]=useState('');
 useEffect(()=>{setEditing(false);setError('');},[media?.id]);
 if(!media)return null;const m=media,remark=rules?.rawRemark??m.remark,close=()=>{setEditing(false);onClose();};
 const modes=(id:string,value:string,onChange:(v:string)=>void)=><select id={id} value={value} onChange={e=>onChange(e.target.value)}><option value="unknown">未注明</option><option value="unlimited">已确认不限</option><option value="limited">已确认上限</option></select>;
 if(editing)return <MediaDialog open title={'录入已核对要求 · '+m.name} confirmLabel="保存人工配置" onCancel={()=>setEditing(false)} onConfirm={()=>setError('人工规则写入接口尚未配置，未保存本次配置。')}><div className="notice">只录入你已核对的规则。不确定的条目保持“未注明”；不会自动把“短标题”换成数字上限，原始数据不变。</div><div className="y-raw-note" style={{marginTop:14}}>{remark||'原备注未注明'}</div><div className="y-rule-line"><label>标题要求</label>{modes('y-rule-title-state',titleState,setTitleState)}<input className="field" type="number" id="y-rule-title" min="1" placeholder="≤ 字数上限" value={title} disabled={titleState!=='limited'} onChange={e=>setTitle(e.target.value)}/></div><div className="y-rule-line"><label>正文要求</label>{modes('y-rule-body-state',bodyState,setBodyState)}<input className="field" type="number" id="y-rule-body" min="1" placeholder="≤ 字数上限" value={body} disabled={bodyState!=='limited'} onChange={e=>setBody(e.target.value)}/></div><div className="y-rule-line"><label>图片要求</label><select id="y-rule-images" value={imageState} onChange={e=>setImageState(e.target.value)}><option value="unknown">未注明</option><option value="yes">已确认允许</option><option value="no">已确认不允许</option></select><input className="field" type="number" id="y-rule-images-max" min="0" placeholder="张数上限（可留空）" value={images} disabled={imageState!=='yes'} onChange={e=>setImages(e.target.value)}/></div><div className="y-rule-line"><label>正文链接</label><select id="y-rule-links" value={links} onChange={e=>setLinks(e.target.value)}><option value="unknown">未注明</option><option value="yes">已确认允许</option><option value="no">已确认不允许</option></select><span className="y-subtle-note">表格规则保留未注明</span></div><label className="label" style={{marginTop:18}} htmlFor="y-rule-evidence">确认依据 / 补充说明 *</label><textarea className="field" id="y-rule-evidence" placeholder="填写确认来源；未注明项仍需要供应商核对" value={evidence} onChange={e=>setEvidence(e.target.value)}/><p className="y-subtle-note">本页输入的字数上限均为“≤”，包含边界；按 Unicode 字符计数，正文不含空白、含标点。未注明的项目不会执行自动长度 / 素材判定。</p><p id="y-rule-error" className="block-error" role="alert">{error}</p></MediaDialog>;
 return <MediaDialog open title="媒体资料" confirmLabel={checked?'移出购物车':'加入购物车'} onCancel={close} onConfirm={()=>{onToggle?.();close();}} footer={<><button className="button quiet" onClick={()=>setError('行业归类写入接口尚未配置，未更改行业。')}>行业归类</button><button className="button secondary" onClick={()=>{setError('');setEditing(true);}}>录入投稿要求</button><button className="button secondary" onClick={()=>{if(onQuote){close();onQuote();}else setError('报价写入接口尚未配置，未更改报价。');}}>修改报价</button><button className="button primary" onClick={()=>{onToggle?.();close();}}>{checked?'移出购物车':'加入购物车'}</button></>}>
 <div className="y-details-top"><span className="y-monogram">{Array.from(m.name)[0]}</span><div><h3>{m.name}</h3><div className="actions"><span className="b-chip neutral">{m.platform}</span><span className="b-chip neutral">目录数据 · 待核验</span></div></div></div><div className="y-details-grid"><Property name="本地资源 ID" value={m.id}/><Property name="供应商媒体 ID" value={m.externalResourceId}/><Property name="发布报价" value={formatPublishingMoney(m.priceTenThousandths)}/><Property name="采集时间" value={rules?.collectedAt}/><Property name="所属行业" value={m.taxonomy}/><Property name="覆盖地区" value={m.region}/><Property name="发布时效" value={catalogueFields?m.turnaround:remarkFact(remark,'speed')} empty="未注明" claim={!catalogueFields}/><Property name="周末 / 节假日" value={remarkFact(remark,'weekend')} empty="未注明" claim/><Property name="收录说明"/><Property name="抓取状态"/><Property name="市场价格"/><Property name="百度权重 / 收录率"/><Property name="月访问量 / 出稿率"/><Property name="备案主体 / 性质"/></div>{catalogueFields&&<><h3 className="y-section-label">目录筛选属性</h3><div className="y-details-grid"><Property name="媒体分类" value={m.kind==='news'?'门户媒体':m.kind==='self_media'?'第三方自媒体':undefined}/><Property name="媒体类型" value={m.mediaType}/><Property name="收录类型" value={m.includeType}/><Property name="发布速度（目录）" value={m.turnaround}/><Property name="入口类型" value={m.entryType}/><Property name="链接类型（原值）" value={m.linkType}/><Property name="百度 PC 权重" value={m.pcWeight}/><Property name="百度移动权重" value={m.mobileWeight}/><Property name="收录率" value={m.includeRate===undefined?undefined:m.includeRate+'%'}/><Property name="发布成功率" value={m.successRate===undefined?undefined:m.successRate+'%'}/><Property name="推荐媒体" value={m.recommended===undefined?undefined:m.recommended?'是':'否'}/><Property name="推荐标签" value={m.recommendationTags?.join('、')}/><Property name="节假日可发" value={m.festivalAvailable===undefined?undefined:m.festivalAvailable?'是':'否'}/></div><p className="y-subtle-note">上述目录字段用于筛选；供应商备注单独保留，未知字段不等于 0 或不支持。</p></>}<div className="summary-row"><span>记录中的链接</span>{m.caseUrl&&/^https?:\/\//.test(m.caseUrl)?<a className="y-external" href={m.caseUrl} target="_blank" rel="noopener noreferrer">查看原链接 ↗</a>:<span className="y-missing">未提供有效链接</span>}</div><p className="y-subtle-note">链接可能是账号主页或示例文章，不把所有链接标为官网。文字首字头像仅用于辨识，不是媒体官方标志。</p><h3 className="y-section-label">完整发布备注</h3><div className="y-raw-note">{remark||'未注明。仍需向供应商核对投稿要求。'}</div><p className="y-subtle-note">供应商关于“收录好”“出稿快”等描述不是实测指标或效果承诺。</p><h3 className="y-section-label">结构化要求</h3><MediaRuleTable media={m} rules={rules}/><details className="y-more"><summary>查看两份文件的完整原始记录</summary><div className="y-subtle-note">供应商目录记录</div><pre className="y-raw-json">{JSON.stringify(m,null,2)}</pre><div className="y-subtle-note">解析后的发布要求</div><pre className="y-raw-json">{JSON.stringify(rules??null,null,2)}</pre></details>{error&&<p className="block-error" role="alert">{error}</p>}</MediaDialog>;
}
export function exportRows(rows:MediaResource[]){const values=[['资源ID','媒体 / 频道','行业','地区','报价','状态','标题要求','正文要求','图片要求','发布备注'],...rows.map(m=>[m.id,m.name,m.taxonomy,m.region,/^\d+$/.test(m.priceTenThousandths)&&BigInt(m.priceTenThousandths)>0n?formatPublishingMoney(m.priceTenThousandths):'待询价',m.active?'可投状态待核验':'停止接单',m.titleLimit?m.titleLimit+' 字':'未注明','未注明',m.capability==='image'?'支持图片':m.capability==='text'?'不支持图片':'未注明',m.remark??''])];const csv='\uFEFF'+values.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='FrontMind-媒体与发布要求.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
