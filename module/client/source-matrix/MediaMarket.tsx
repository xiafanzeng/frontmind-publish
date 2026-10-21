/** Design-owned media library shell and rows. Data remains supplied by the live gateways. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { projectWorkspaceUrl, usePublishingWorkspaceKey } from '../host';
import { createPortal } from 'react-dom';
import { PublishingConfirmDialog } from '../components/PublishingUi';
import { formatPublishingMoney, type MediaResource } from '../types';
import type { MediaRules, RulePreflight, RuleField } from '../../server/providers/kol/media-rules';
import '../publishing.market.css';
import {mediaShortlistKey} from '../mediaShortlist';

const api = '/api/modules/publish/media-requirements';
export async function rulesRequest<T>(path: string, signal?: AbortSignal, input?: unknown): Promise<T> {
 const response = await fetch(api + path, {credentials:'same-origin',signal,...(input === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})});
 const body = await response.json().catch(()=>null);
 if (!response.ok) throw new Error(body?.message ?? '媒体资料暂时不可用');
 return body as T;
}
export const credentialHelp = '请管理员准备：PUBLISHER_FEATURE_ENABLED=true、PUBLISHER_PROVIDER_ENABLED=true、PUBLISHER_MODE=live（或 test）、HTTPS 的 PUBLISHER_KOL_BASE_URL，以及 PUBLISHER_KOL_ACCESS_TOKEN；也可使用完整登录字段 PUBLISHER_KOL_API_KEY、MOBILE、PASSWORD、IDENTITY、CAPTCHA、CAPTCHA_TOKEN（后五项同样带 PUBLISHER_KOL_ 前缀）。凭据仅在服务端配置。';
export function useMarketRules(ids: string[], revision = ''): {key:string;rules:Record<string,MediaRules>;ready:boolean;error:string;loading:boolean} {
 const workspace = usePublishingWorkspaceKey(), idsKey = ids.join(','), key = `${workspace}:${revision}:${idsKey}`;
 const [state,setState] = useState<{key:string;rules:Record<string,MediaRules>;ready:boolean;error:string;loading:boolean}>({key:'',rules:{},ready:false,error:'',loading:true});
 useEffect(()=>{const abort=new AbortController();setState({key,rules:{},ready:false,error:'',loading:true});
  void rulesRequest<{configured:boolean;message?:string}>('/status',abort.signal).then(async status=>{
   if(abort.signal.aborted)return;
   if (!status.configured) {setState({key,rules:{},ready:false,error:status.message ?? credentialHelp,loading:false});return;}
   const items:Array<{id:string;rules:MediaRules}>=[];const all=idsKey?idsKey.split(','):[];for(let i=0;i<all.length;i+=100){const data=await rulesRequest<{items:Array<{id:string;rules:MediaRules}>}>('?ids='+encodeURIComponent(all.slice(i,i+100).join(',')),abort.signal);items.push(...data.items);}const data={items};
   if(!abort.signal.aborted)setState({key,rules:Object.fromEntries(data.items.map(x=>[x.id,x.rules])),ready:true,error:'',loading:false});
  }).catch(e=>{if(!abort.signal.aborted)setState({key,rules:{},ready:false,error:e instanceof Error?e.message:'读取失败',loading:false});});
  return()=>abort.abort();
 },[key,workspace,revision,idsKey]);
 return state.key===key?state:{key,rules:{},ready:false,error:'',loading:true};
}
export function MediaTabs({active, base='/publishing/media', query=''}:{active:string;base?:string;query?:string}) {
 const workspace=usePublishingWorkspaceKey(),params=new URLSearchParams(query);
 const contextDraft=/^\/publishing\/drafts\/([^/]+)\/media$/.exec(base)?.[1];if(contextDraft)params.set('draftId',decodeURIComponent(contextDraft));
 if(!params.has('task')){try{const task=sessionStorage.getItem(`source-matrix:last-task:${mediaShortlistKey(workspace,query)??workspace}`);if(task)params.set('task',task);}catch{/* Navigation still works without storage. */}}
 const matrixTail=params.size?'?'+params.toString():'';
 const tail=query?'?'+query:'';
 return <nav className="b-subtabs" aria-label="媒体库模块">{[['home','媒体库首页'],['matrix','信源矩阵'],['owned','自有社媒发布'],['third','第三方媒体'],['cart','第三方购物车']].map(([id,text])=><Link key={id} className={active===id?'active':''} aria-current={active===id?'page':undefined} href={projectWorkspaceUrl(id==='matrix'?'/publishing/source-matrix'+matrixTail:base+'/'+id+tail)}>{text}</Link>)}</nav>;
}
export function MediaTaskbar({title,count=0,total,children,cartHref='/publishing/media/cart'}:{title?:string;count?:number;total?:string;children?:ReactNode;cartHref?:string}) {
 return <section className="panel b-task"><div className="grow"><strong>{title || '独立浏览媒体库'}</strong><span className="small muted">{title?'保留当前已确认稿件版本':'可研究、收藏和保存方案；配置标题前需绑定已确认稿件'}</span></div>{children??<select aria-label="当前投放任务" disabled><option>{title??'独立浏览 / 研究'}</option></select>}<div className="b-taskbar-total"><Link href={projectWorkspaceUrl(cartHref)} className="button secondary">购物车 {count} · {total === undefined?'待确认':formatPublishingMoney(total)}</Link></div></section>;
}
export function RowHead(){return <div className="y-row-head" aria-hidden="true">{['媒体 / 账号','价格信息','平台与覆盖','稿件要求','发布条件与备注'].map(x=><span key={x}>{x}</span>)}</div>;}
export function Property({name,value}:{name:string;value?:ReactNode}){return <dl className="y-prop"><dt>{name}</dt><dd title={typeof value==='string'?value:undefined} className={value==null||value===''?'y-missing':''}>{value==null||value===''?'未注明':value}</dd></dl>;}
export function ruleText(rules:MediaRules|undefined,field:RuleField) {
 const rule=rules?.rules.find(r=>r.field===field);
 if(!rule||rule.state==='unknown')return '未注明';
 if(rule.state==='conflict')return '规则冲突 · 待核验';
 if(rule.state==='explicitly_unlimited')return '明确不限';
 return (rule.exclusive?'少于 ':'不超过 ')+rule.max+(field.endsWith('chars')?' 字':field==='images'?' 张':' 个');
}
/** A viewport tooltip avoids clipping in the reference horizontal directory. */
export function MarketRemark({text}:{text?:string}) {
 const [open,setOpen]=useState(false),[position,setPosition]=useState({left:12,top:12}),id=useId(),anchor=useRef<HTMLButtonElement>(null),tip=useRef<HTMLDivElement>(null);
 const content=text?.trim()?text:'未注明发布备注';
 useLayoutEffect(()=>{if(!open)return;const rect=anchor.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(490,window.innerWidth-24),height=tip.current?.offsetHeight??180;setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:Math.max(12,rect.bottom+height+12<window.innerHeight?rect.bottom+10:rect.top-height-10)});},[open,content]);
 useEffect(()=>{if(!open)return;const close=()=>setOpen(false);window.addEventListener('scroll',close,true);window.addEventListener('resize',close);return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};},[open]);
 return <span className="fm-remark-anchor" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}><button ref={anchor} className="x-remarks" type="button" aria-describedby={open?id:undefined} aria-label={'发布备注：'+content} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onClick={()=>setOpen(true)} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);e.stopPropagation();}}}>{content}</button>{open&&createPortal(<div className="fm-media" style={{position:'fixed',left:position.left,top:position.top,zIndex:10000,pointerEvents:'none',width:'min(490px, calc(100vw - 24px))'}}><div id={id} ref={tip} role="tooltip" className="y-tip"><h4>发布备注原文</h4><div className="y-full-remark">{content}</div><p className="y-tip-status">原文来自官方目录，解析规则与未明确项请在资料详情中核验。</p></div></div>,document.body)}</span>;
}
export function MarketRow({media:m,rules,checked=false,disabled=false,favorite=false,onToggle,onFavorite,onDetails,reason}:{media:MediaResource;rules?:MediaRules;checked?:boolean;disabled?:boolean;favorite?:boolean;onToggle?:()=>void;onFavorite?:()=>void;onDetails?:()=>void;reason?:string}) {
 return <article className={'y-media-row '+(checked?'selected':'')}>
  <div className="y-media-identity"><div className="y-media-title"><span className="y-monogram" aria-hidden="true">{Array.from(m.name)[0]}</span><h3><button className="y-media-name" onClick={onDetails}>{m.name}</button></h3></div><div className="y-identity-controls"><input type="checkbox" checked={checked} disabled={disabled||!onToggle} onChange={onToggle} aria-label={'选择 '+m.name}/><span className="y-platform-pill">{m.platform||'平台未注明'}</span><button className={'y-star '+(favorite?'active':'')} aria-label={(favorite?'取消收藏 ':'收藏 ')+m.name} aria-pressed={favorite} disabled={!onFavorite} onClick={onFavorite}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.55 4.43 1.08 6.27L12 17.34l-5.63 2.96 1.08-6.27L2.9 9.6l6.3-.9Z"/></svg></button>{m.caseUrl&&/^https?:\/\//i.test(m.caseUrl)&&<a href={m.caseUrl} target="_blank" rel="noopener noreferrer" aria-label={'查看 '+m.name+' 链接'}>↗</a>}</div><div className="y-row-origin"><span>ID {m.externalResourceId??m.id}</span><span>{checked?'已加入购物车':'官方目录记录'}</span></div></div>
  <div><span className="y-price-label">发布报价</span><div className="y-price-value">{formatPublishingMoney(m.priceTenThousandths)}<small className="y-price-unit">/ 篇</small></div><div className="y-price-detail"><span>目录报价 · 发布前复核</span><span className="y-extra">市场价：未提供</span><button className="link" onClick={onDetails}>查看详情 ↗</button></div></div>
  <div className="y-props"><Property name="媒体平台" value={m.platform}/><Property name="覆盖地区" value={m.region}/><Property name="所属行业" value={m.taxonomy}/><Property name="收录表现" value={m.includeRate===undefined?undefined:m.includeRate+'%'}/><Property name="通过率" value={m.successRate===undefined?undefined:m.successRate+'%'}/></div>
  <div className="y-props"><Property name="标题字数" value={ruleText(rules,'title_chars')}/><Property name="正文字数" value={ruleText(rules,'body_chars')}/><Property name="图片要求" value={ruleText(rules,'images')}/><Property name="链接要求" value={ruleText(rules,'links')}/></div>
  <div className="y-last-column"><Property name="发布时效" value={m.turnaround}/><Property name="周末节假" value={m.festivalAvailable===true?'节假日可发':undefined}/><Property name="AI 引用" value="未提供监测数据"/><div className="y-remarks-line"><span>发布备注</span><MarketRemark text={rules?.rawRemark??m.remark}/></div><div className="y-row-bottom"><span className="y-capture-tag">{rules?.rawRemark?'备注待核验':'备注未注明'}</span><button className="link" onClick={onDetails}>资料详情 →</button></div></div>
  {reason&&<div className="y-source-context">{reason}</div>}
 </article>;
}
export function MediaDetails({media,rules,onClose}:{media?:MediaResource;rules?:MediaRules;onClose:()=>void}) {
 const workspace=usePublishingWorkspaceKey(),request=useRef<AbortController|null>(null);
 const [title,setTitle]=useState(''),[body,setBody]=useState(''),[images,setImages]=useState('0'),[links,setLinks]=useState('0'),[result,setResult]=useState<RulePreflight>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setTitle('');setBody('');setImages('0');setLinks('0');setResult(undefined);setError('');setBusy(false);},[media?.id,workspace]);
 useEffect(()=>setResult(undefined),[title,body,images,links]);

 const signature=[media?.id,workspace,title,body,images,links].join('\0');
 useEffect(()=>{request.current?.abort();setBusy(false);return()=>request.current?.abort();},[signature]);
 const [pendingSignature,setPendingSignature]=useState('');
 const [resultSignature,setResultSignature]=useState('');
 const names:Record<string,string>={title_chars:'标题字数',body_chars:'正文字数',images:'图片要求',links:'链接要求',editorial:'其他要求',article:'稿件内容'};
 return <PublishingConfirmDialog description="发布备注与结构化要求来自官方目录；未明确项需人工核验。" wide open={!!media} title={'资料详情 · '+(media?.name??'')} confirmLabel="关闭" onCancel={onClose} onConfirm={onClose}>
  {media&&<><div className="fm-media"><div className="y-details-grid"><Property name="媒体平台" value={media.platform}/><Property name="资源编号" value={media.externalResourceId}/><Property name="发布报价" value={formatPublishingMoney(media.priceTenThousandths)}/><Property name="采集时间" value={rules?.collectedAt}/></div><h3 className="y-section-label">发布备注原文</h3><p className="y-raw-note">{rules?.rawRemark??media.remark??'未注明发布备注'}</p><h3 className="y-section-label">稿件要求</h3>{(['title_chars','body_chars','images','links'] as RuleField[]).map(field=><Property key={field} name={names[field]??field} value={ruleText(rules,field)}/>)}{rules?.unresolved.map((x,i)=><p className="small muted" key={i}>待核验：{x}</p>)}<details><summary>稿件预检</summary><div className="b-form"><label>实际发布标题<input id="fm-check-title" className="field" value={title} onChange={e=>setTitle(e.target.value)}/></label><label className="wide">稿件正文<textarea id="fm-check-body" className="field" rows={6} value={body} onChange={e=>setBody(e.target.value)}/></label><label>图片数量<input className="field" type="number" min="0" value={images} onChange={e=>setImages(e.target.value)}/></label><label>链接数量<input className="field" type="number" min="0" value={links} onChange={e=>setLinks(e.target.value)}/></label></div><button className="button primary" disabled={busy||!rules} onClick={async()=>{setPendingSignature(signature);if(![images,links].every(x=>/^\d+$/.test(x)&&Number(x)<=10000)){setError('图片与链接数量须为 0 至 10000 的整数');return;}request.current?.abort();const abort=new AbortController();request.current=abort;setBusy(true);setError('');setPendingSignature(signature);try{const data=await rulesRequest<RulePreflight>('/preflight',abort.signal,{mediaId:media.id,title,body,images:Number(images),links:Number(links)});if(!abort.signal.aborted){setResult(data);setResultSignature(signature);}}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'预检失败');}finally{if(!abort.signal.aborted)setBusy(false);}}}>{busy?'正在预检…':'运行预检'}</button>{error&&pendingSignature===signature&&<p role="alert">{error}</p>}{result&&resultSignature===signature&&<div className="table-wrap"><table><thead><tr><th>要求</th><th>当前稿件</th><th>结果</th><th>修复</th></tr></thead><tbody>{result.items.map((x,i)=><tr key={i}><td>{names[x.field]??x.field}<p>{x.evidence.join('；')}</p></td><td>{x.actual}</td><td>{{pass:'通过',fail:'未通过',needs_review:'待人工核验'}[x.status]}</td><td>{x.status!=='pass'&&<button className="link" onClick={()=>{setResult(undefined);document.getElementById(x.field==='title_chars'?'fm-check-title':'fm-check-body')?.focus();}}>返回修改</button>}</td></tr>)}</tbody></table></div>}</details></div></>}
 </PublishingConfirmDialog>;
}
export function exportRows(rows:MediaResource[]){const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='媒体清单.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
