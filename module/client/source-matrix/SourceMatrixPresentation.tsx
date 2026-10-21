import { useId, useState } from "react";
import { PublishingEmpty } from "../components/PublishingUi";
import type { Analysis, BudgetPlan, Candidate, Json, MatrixResult } from "./types";

export const roleNames: Record<string, string> = { authority: "权威参考", industry: "行业核心", regional: "地域覆盖", supplement: "覆盖补充", exploration: "探索验证" };
const states: Record<string, string> = { complete: "结果已装配", needs_ai_decisions: "等待模型适配判断", needs_budget_plans: "等待模型生成发布组合", stale_matrix: "矩阵已过期，请重新生成", invalid_decisions: "模型结果未通过校验", invalid_input: "输入不符合规则", needs_matrix: "需要已验证矩阵", eligible: "渠道条件通过", pending: "渠道待确认", ineligible: "渠道不符合", research_only: "仅供研究", passed: "稿件预检通过", failed: "稿件预检失败", needs_manuscript_check: "稿件待预检", budget_feasible: "预算可行", no_feasible_plan: "预算或渠道条件不满足", estimate: "费用待确认", recommended: "推荐候选", alternative: "备选", undecided: "尚未判断", none: "暂无引用证据", exact: "身份明确匹配", platform_related: "仅平台关联", unverified: "身份待确认", needs_budget: "待设置预算" };
export const label = (s: string) => states[s] ?? s;
export const display = (v: Json | undefined): string => v === null || v === undefined ? "未提供" : typeof v === "string" ? v : JSON.stringify(v);
function moneyText(value: string | null | undefined, currency: string | null) { return value == null ? "待确认" : `${currency ?? ""} ${value}`; }
export function quote(c: Candidate): string {
  const offers = c.offers.map(o => {
    const p = o.pricing;
    if (!p?.currency) return "报价待确认";
    const raw = p.kind === "range" ? p.upper_bound : p.kind === "unit" || p.kind === "package" ? p.amount : undefined;
    if ((typeof raw !== "string" && !(typeof raw === "number" && Number.isSafeInteger(raw))) || !/^\d+(?:\.\d+)?$/.test(String(raw))) return "报价待确认";
    const precision = p.currency === "JPY" ? 0 : ["CNY", "USD", "EUR"].includes(p.currency) ? 2 : null;
    if (precision === null) return "币种待确认";
    const [whole = "0", fraction = ""] = String(raw).split(".");
    if (fraction.length > precision) return "报价待确认";
    return `${p.currency} ${whole}${precision ? "." + fraction.padEnd(precision, "0") : ""}${p.kind === "range" ? "（上界）" : p.kind === "package" ? "（套餐）" : ""}`;
  });
  return offers.length ? [...new Set(offers)].join(" / ") : "暂无报价";
}
export function Detail({ title, value }: { title: string; value: unknown }) {
  return <details className="sm-detail"><summary>{title}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}
export function Plan({plan:p,candidates=[]}:{plan:BudgetPlan;candidates?:Candidate[]}) {
 return <article className="z-budget-result"><div className="x-section-title"><div><h3>{p.strategy}</h3><p>{p.reason_summary}</p></div><span className="b-chip">{label(p.status)}</span></div><div className="z-matrix-meta"><span>预计总费用 <b>{moneyText(p.total_cost,p.currency)}</b></span><span>其中探索 <b>{moneyText(p.exploration_cost,p.currency)}</b></span><span>剩余额度 <b>{moneyText(p.total_remaining,p.currency)}</b></span></div><p className="small muted">{p.unknown_items.length?`${p.unknown_items.length} 项费用待确认，已知费用不代表完整费用。`:''}稿件：{label(p.manuscript_status)} · {p.ready_to_publish?'校验就绪':'正式发布未就绪'}</p><div className="table-wrap"><table><thead><tr><th>媒体</th><th>角色</th><th>费用</th><th>筛选说明</th></tr></thead><tbody>{p.items.map((item,i)=>{const x:Record<string,Json>=item&&typeof item==='object'&&!Array.isArray(item)?item:{};const detail=p.details?.[i],purpose=x.purpose==='exploration'?'探索':x.purpose==='standard'?'核心 / 补充':display(x.role??x.primary_role);return <tr key={i}><td>{display(x.source_name??candidates.find(c=>c.resource_id===x.resource_id)?.attributes.source_name??candidates.find(c=>c.resource_id===x.resource_id)?.attributes.name??x.resource_id??x.candidate_id)}</td><td>{purpose}</td><td>{detail?moneyText(detail.cost,detail.currency):'待确认'}</td><td>{detail?.unknown_reasons.length?'报价或发布条件待确认':display(x.reason??x.reason_summary??'按本次组合校验')}</td></tr>;})}</tbody></table></div>{p.errors.map((e,i)=><p className="block-error" key={i}>{e.message}</p>)}</article>;
}
function Donut({title,items,unit='引用次数'}:{title:string;items:Array<{name:string;value:number}>;unit?:string}) {
 const palette=['#b33467','#6d5998','#70a69a','#d6a258','#a5b3cf'],total=items.reduce((n,x)=>n+x.value,0);let start=0;
 const stops=items.map((x,i)=>{const end=start+x.value/total*100,s=`${palette[i%palette.length]} ${start}% ${end}%`;start=end;return s;});
 return <section className="r-subpanel"><header><h3>{title}</h3><span>{unit==='引用次数'?'按引用次数统计':'按去重内容发布时间统计'}</span></header><div className="r-distribution"><div className="r-donut" role="img" aria-label={items.map(x=>x.name+' '+x.value).join('；')||'暂无可统计样本'} style={{background:total?`conic-gradient(${stops.join(',')})`:'#edf0f5'}}><div><strong>{total||'—'}</strong><span>{unit}</span></div></div><div className="r-legend">{total?items.map((x,i)=><div key={x.name}><span><i style={{background:palette[i%palette.length]}}/>{x.name}</span><span>{x.value} <b>{(x.value/total*100).toFixed(1)}%</b></span></div>):<p className="muted">暂无可统计的引用样本</p>}</div></div></section>;
}
export function SourceAnalysis({analysis:a}:{analysis:Analysis}) {
 const scopeId=useId(),[index,setIndex]=useState(0),[domain,setDomain]=useState('');
 const g=a.groups[index],same=(s:unknown)=>JSON.stringify(s)===JSON.stringify(g?.scope);
 const all=g?a.detail_citations.filter(d=>same(d.scope)):[],rows=all.filter(d=>!domain||(()=>{try{return new URL(d.normalized_url).hostname.toLowerCase().replace(/\.$/,'')===domain;}catch{return false;}})());
 const ranks=g?a.domain_rollups.filter(r=>same(r.scope)).sort((x,y)=>(y.count??-1)-(x.count??-1)):[];
 const types=new Map<string,number>();
 // A detail is one deduplicated observed citation. Do not import supplier claims
 // or independently scoped aggregates into either chart's denominator.
 for(const d of all){const t=typeof d.record.content_type==='string'?d.record.content_type:'类型未提供';types.set(t,(types.get(t)??0)+1);}
 const age:Record<string,Json>=a.content_age&&typeof a.content_age==='object'&&!Array.isArray(a.content_age)?a.content_age:{};
 const buckets:Record<string,Json>=age.buckets&&typeof age.buckets==='object'&&!Array.isArray(age.buckets)?age.buckets:{};
 const ages=a.groups.length===1?Object.entries(buckets).flatMap(([name,value])=>typeof value==='number'&&value>0?[{name:name+' 天',value}]:[]):[];
 return <><div className="r-data-note small muted"><label htmlFor={scopeId}>统计范围 </label><select id={scopeId} value={index} disabled={!a.groups.length} onChange={e=>{setIndex(Number(e.target.value));setDomain('');}}>{a.groups.length?a.groups.map((x,i)=><option key={i} value={i}>{display(x.scope.question_id)} · {display(x.scope.platform)} · {display(x.scope.model)} · {display(x.scope.period)}</option>):<option>暂无真实引用样本</option>}</select></div>
 <section className="panel panel-pad r-source"><h2>引用信源</h2><div className="r-source-grid"><section className="r-subpanel"><header><h3>媒体排行</h3><span>媒体 {ranks.length} 个 / 引用 {g?.total_citations??'待确认'} 次</span></header><div className="r-ranking">{ranks.length?ranks.map((r,i)=><button className={'r-rank '+(domain===r.domain?'active':'')} key={r.domain} onClick={()=>setDomain(d=>d===r.domain?'':r.domain)}><span className="r-number">{i+1}</span><span className="r-logo">{r.domain.slice(0,1)}</span><strong>{r.domain}</strong><span className="r-rank-value"><b>{r.count??'待确认'}</b><small>{r.share===null?'占比待确认':(r.share*100).toFixed(1)+'%'}</small></span></button>):<div className="b-empty-small">暂无媒体引用排行</div>}</div></section><section className="r-subpanel"><header><h3>内容明细 · {domain||'全部媒体'}</h3><span>内容 {rows.length} 条</span><button className="link small" onClick={()=>setDomain('')}>全部媒体</button></header><div className="table-wrap r-detail"><table><thead><tr><th>序号</th><th>内容标题</th><th>媒体名称</th><th>内容类型</th><th>引用次数 ↓</th><th>引用占比</th></tr></thead><tbody>{rows.length?rows.map((d,i)=><tr key={d.normalized_url}><td>{i+1}</td><td><a className="link r-title" href={d.normalized_url} target="_blank" rel="noopener noreferrer">{display(d.record.title??d.record.url??d.normalized_url)}</a></td><td>{display(d.record.source_name)}</td><td><span className="b-chip neutral">{display(d.record.content_type)}</span></td><td>1</td><td>{g?.total_citations&&g.total_citations>0?(100/g.total_citations).toFixed(1)+'%':'待确认'}</td></tr>):<tr><td colSpan={6}><div className="b-empty-small">接入引用样本后显示文章、来源及引用统计</div></td></tr>}</tbody></table></div></section></div></section>
 <section className="panel panel-pad r-source"><h2>信源分布</h2><div className="r-distribution-grid"><Donut title="类型分布" items={g?.total_citations===all.length?[...types].map(([name,value])=>({name,value})):[]}/><Donut title="时间分布" items={ages} unit="引用内容"/></div></section></>;
}
function readable(v:Json|undefined):string {if(Array.isArray(v))return v.map(readable).join('、');if(v&&typeof v==='object')return typeof v.text==='string'?v.text:Object.entries(v).map(([k,x])=>k+'：'+readable(x)).join('；');return display(v);}
export function Report({result:r}:{result:MatrixResult}) {
 return <article className="panel b-report r-report"><div className="x-kicker">FRONTMIND / CONTENT FIRST, BUDGET LAST</div><h1 style={{marginTop:16}}>信源矩阵与预算筛选报告</h1><p>{display(r.scope.task.product)} · {display(r.scope.task.industry)} · 内容矩阵 {r.plan_version} · {r.as_of}</p>
 <h2>一、非金额投放要求</h2><p>目标问题：{readable(r.scope.task.questions)}<br/>目标受众：{display(r.scope.task.audience)}；覆盖地区：{readable(r.scope.task.regions)}；素材要求：{readable(r.scope.task.requirements)}。</p><p>引用记录 {r.source_analysis.known_detail_count} 条；行业依据 {r.source_analysis.external_aggregates.length} 条。不同统计范围分别核验，不与供应商声明混算。</p>
 <h2>二、完整内容推荐（不考虑预算）</h2><p>内容矩阵与预算阶段分别校验。未提供报价的来源保留为待确认；推荐不代表审核或 AI 引用效果承诺。</p>{r.matrix.layers.map(layer=><section key={layer.role}><h3>{layer.display_name}</h3>{layer.candidate_ids.length?layer.candidate_ids.map(id=>{const c=r.matrix.candidates.find(x=>x.candidate_id===id);return c?<p key={id}><b>{display(c.attributes.source_name??c.attributes.name??c.resource_id)}</b>：{c.reason_summary??'推荐依据待确认'}{c.pending_conditions.length?'；待确认：'+c.pending_conditions.join('；'):''}</p>:null;}):<p>暂无支持本层的输入依据，不补充虚构媒体。</p>}</section>)}
 <h2>三、最后一步的独立预算筛选</h2>{r.budget_plans.length?r.budget_plans.map((p,i)=><Plan key={i} plan={p} candidates={r.matrix.candidates}/>):<p>尚未进行预算筛选。此报告只包含内容推荐，不能将未知费用解释为 0 元。</p>}
 <h2>四、执行与修正</h2><p>确认预算内组合 → 加入购物车 → 分配稿件 → 配置标题 → 一键预检。预检失败可回到编辑页修正，保留原有媒体与标题配置。提交前按实际费用再次验证总预算与探索上限。</p>{r.limitations.map((x,i)=><p className="small muted" key={i}>{x}</p>)}{r.errors.map((e,i)=><p className="block-error" key={i}>{e.message}</p>)}
 </article>;
}
