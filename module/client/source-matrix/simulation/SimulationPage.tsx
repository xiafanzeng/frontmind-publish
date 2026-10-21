import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearch } from 'wouter';
import { projectWorkspaceUrl, usePublishingWorkspaceKey } from '../../host';
import { MediaShell, Property, RowHead } from '../MediaMarket';
import { display, label, Plan, quote } from '../SourceMatrixPresentation';
import type { Candidate, MatrixResult } from '../types';
import { validateBudget } from './kernel/contracts.js';
import type { Row } from './kernel/common.js';
import { defaultInput, generateSimulationData, industries, SIMULATION_AS_OF, SIMULATION_SEED, SIMULATION_NOTICE, type SimulationInput, type SimulationBudget } from './data';
import { applySimulationBudget, buildSimulationMatrix, exportSimulation, presentSimulation, type SimulationRun } from './pipeline';

export type MatrixView='matrix'|'analysis'|'industry'|'report';
interface SavedSimulation {
  version:1;input:SimulationInput;generated:boolean;budget:SimulationBudget;applied:boolean;selected:string[];
}
const fresh=():SavedSimulation=>({version:1,input:defaultInput(),generated:false,budget:{currency:'CNY',total_cap:'10000',exploration_enabled:true,exploration_cap:'1500'},applied:false,selected:[]});
function restore(key:string):SavedSimulation {
  try {
    const saved:SavedSimulation=JSON.parse(sessionStorage.getItem(key)??'null');
    if(saved?.version!==1||!industries.some(x=>x.id===saved.input?.industryId)||!Array.isArray(saved.input.questions)||!saved.input.questions.every(x=>typeof x==='string')||!Array.isArray(saved.input.regions)||!saved.input.regions.every(x=>typeof x==='string')||!saved.budget||validateBudget(saved.budget).length||!Array.isArray(saved.selected)||!saved.selected.every(x=>typeof x==='string'))return fresh();
    if(!['product','audience','hours','requirement','platform'].every(k=>typeof saved.input[k as keyof SimulationInput]==='string'))return fresh();
    return saved;
  }catch{return fresh();}
}
function replay(saved:SavedSimulation):SimulationRun|null {
  if(!saved.generated)return null;
  try {const run=buildSimulationMatrix(saved.input);return saved.applied?applySimulationBudget(run,saved.budget,saved.selected):run;}catch{return null;}
}
function saveJson(name:string,value:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
}
function Pages({page,count,onChange}:{page:number;count:number;onChange:(page:number)=>void}) {
  const max=Math.max(1,Math.ceil(count/20));
  return <nav className="y-pages" aria-label="模拟数据分页"><span>共 {count} 条 · 第 {page} / {max} 页</span><div className="y-page-buttons"><button disabled={page<=1} onClick={()=>onChange(page-1)} aria-label="上一页">‹</button><span aria-current="page">{page}</span><button disabled={page>=max} onClick={()=>onChange(page+1)} aria-label="下一页">›</button></div></nav>;
}
function JsonDetails({title,value}:{title:string;value:unknown}) {return <details className="sm-sim-details"><summary>{title}</summary><pre className="z-json">{JSON.stringify(value,null,2)}</pre></details>;}
function KernelIssues({run}:{run:SimulationRun|null}) {
  return run?<>{(run.result.errors??[]).length>0&&<div className="block-error" role="alert">{run.result.errors.map((e:Row,i:number)=><p key={i}>{e.path}：{e.message}</p>)}</div>}{(run.result.warnings??[]).map((w:Row,i:number)=><p className="notice warn" key={i}>{w.path}：{w.message}</p>)}</>:null;
}
function CandidateRow({candidate:c,selected,onSelect}:{candidate:Candidate;selected:boolean;onSelect:(id:string)=>void}) {
  const a=c.attributes, extended=c as Candidate & {conflicting_attributes?:string[];attribute_variants?:Row[]};
  const rule=(key:string)=>{const v=a[key];if(!v||typeof v!=='object'||Array.isArray(v))return '待确认';return v.state==='explicitly_unlimited'?'明确不限':v.state==='limited'?`不超过 ${v.max}`:'待确认';};
  return <article className="y-media-row" data-source-id={c.candidate_id}>
    <div className="y-media-identity"><div className="y-media-title"><h3>{display(a.source_name??c.resource_id)}</h3></div><span className="y-capture-tag">模拟媒体 · {label(c.channel_status)}</span><p className="small muted">{display(a.domain)}</p>{c.resource_id&&<label className="sm-sim-select"><input type="checkbox" checked={selected} onChange={()=>onSelect(c.candidate_id)}/>预算偏好（仅模拟）</label>}</div>
    <div><span className="y-price-label">模拟发布报价</span><strong className="y-price-value">{quote(c)}</strong><p className="y-subtle-note">{c.offers.some(o=>o.pricing?.kind==='package')?'套餐含两篇模拟稿，按套餐计费':'逐篇计费；附加费用由内核计入'}</p></div>
    <div className="y-props"><Property name="所属行业" value={display(a.industry)}/><Property name="平台 / 地区" value={`${display(a.platform)} / ${display(a.regions)}`}/><Property name="时效（小时）" value={display(a.publication_hours)}/><Property name="收录 / 权重" value={`${display(a.indexing_type)} / ${display(a.weight)}`}/><Property name="粉丝 / 认证" value={`${display(a.followers)} / ${a.verified===true?'模拟已认证':'模拟未认证'}`}/></div>
    <div className="y-props"><Property name="标题限制" value={rule('title_rule')}/><Property name="正文限制" value={rule('body_rule')}/><Property name="图片限制" value={rule('image_rule')}/><Property name="稿件预检输入" value={label(c.manuscript_status)}/><Property name="证据身份" value={label(c.evidence_relation)}/></div>
    <div><p className="reading">{c.reason_summary}</p><p className="small">硬条件：{c.hard_failures.join('；')||'无失败项'}<br/>待核验：{c.pending_conditions.join('；')||'无'}<br/>属性冲突：{extended.conflicting_attributes?.join('；')||'无'}<br/>明细依据 {c.evidence_ids.length} 条 · 汇总依据 {c.aggregate_ids.length} 条</p><JsonDetails title="查看依据、模拟报价与原始属性" value={{references:c.references,reason_details:c.reason_details,unconfirmed_items:c.unconfirmed_items,offers:c.offers,attributes:a,attribute_variants:extended.attribute_variants}}/></div>
  </article>;
}
function Candidates({result,selected,onSelect,industryOnly=false}:{result:MatrixResult;selected:string[];onSelect:(id:string)=>void;industryOnly?:boolean}) {
  const [query,setQuery]=useState(''),[role,setRole]=useState(''),[status,setStatus]=useState(''),[industry,setIndustry]=useState(''),[page,setPage]=useState(1);
  const searchRef=useRef<HTMLInputElement>(null);
  const rows=result.matrix.candidates.filter(c=>(!role||c.primary_role===role)&&(!status||c.channel_status===status)&&(!industry||c.attributes.industry===industry)&&`${display(c.attributes.source_name)} ${display(c.attributes.industry)} ${c.reason_summary??''}`.toLocaleLowerCase('zh-CN').includes(query.toLocaleLowerCase('zh-CN')));
  useEffect(()=>setPage(1),[query,role,status,industry,result.matrix_version]);
  const max=Math.max(1,Math.ceil(rows.length/20)),current=Math.min(page,max);
  return <section className="panel panel-pad"><div className="panel-title"><h2>{industryOnly?'行业模拟媒体清单':'完整信源矩阵'}</h2><span className="small muted">{result.matrix_version}</span></div>
    <div className="x-summary-grid">{result.matrix.layers.map(l=><button className="x-summary-item sm-sim-layer" aria-pressed={role===l.role} key={l.role} onClick={()=>setRole(role===l.role?'':l.role)}><small>{l.display_name}</small><strong>{l.candidate_ids.length}</strong><span>{label(l.status)}</span></button>)}</div>
    <div className="sm-sim-filters"><label>搜索模拟信源<div className="actions"><input ref={searchRef} type="search" className="field" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="button quiet" onClick={()=>{setQuery('');searchRef.current?.focus();}}>清空搜索</button>}</div></label><label>渠道条件<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部条件</option>{['eligible','pending','ineligible','research_only'].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></label><label>所属行业<select value={industry} onChange={e=>setIndustry(e.target.value)}><option value="">全部模拟行业</option>{industries.map(x=><option key={x.id} value={x.name}>{x.name}</option>)}</select></label><button className="button secondary" onClick={()=>{setRole('');setStatus('');setIndustry('');setQuery('');}}>重置筛选</button></div>
    <p className="small muted">分层与排序来自经过内核校验的模拟决策。偏好只影响预算提案，不改变内容矩阵；未知价格不作为免费媒体。</p>
    <div className="y-catalogue y-horizontal-scroll"><RowHead/><div className="y-media-list">{rows.slice((current-1)*20,current*20).map(c=><CandidateRow key={c.candidate_id} candidate={c} selected={selected.includes(c.candidate_id)} onSelect={onSelect}/>)}{!rows.length&&<p className="x-empty">当前筛选下没有候选，请调整条件。</p>}</div></div><Pages page={current} count={rows.length} onChange={setPage}/>
  </section>;
}
function Evidence({result}:{result:MatrixResult}) {
  const [page,setPage]=useState(1),a=result.source_analysis;
  const rows=a.detail_citations,current=Math.min(page,Math.max(1,Math.ceil(rows.length/20)));
  return <><section className="panel panel-pad"><h2>引用信源分析 · 内核计算</h2><div className="x-summary-grid"><div className="x-summary-item"><small>已知明细数</small><strong>{a.known_detail_count}</strong></div><div className="x-summary-item"><small>完整范围引用总数</small><strong>{a.total_citations??'待确认'}</strong></div><div className="x-summary-item"><small>行业汇总记录</small><strong>{a.external_aggregates.length}</strong></div><div className="x-summary-item"><small>供应商声明</small><strong>{a.supplier_claims.length}</strong></div></div><p>明细证据、行业汇总和供应商声明独立保存。未知分母显示待确认，不合并不同问题、平台或模型版本的比例。</p>
    <div className="table-wrap"><table><thead><tr><th>来源</th><th>问题 / 平台 / 模型版本</th><th>身份状态</th><th>证据 ID / 原始地址（虚构）</th></tr></thead><tbody>{rows.slice((current-1)*20,current*20).map((r,i)=><tr key={i}><td>{display(r.record.source_name)}</td><td>{display(r.scope.question_id)} / {display(r.scope.platform)} / {display(r.scope.model_version)}</td><td>{r.status}</td><td>{r.evidence_ids.join('、')}<br/>{r.normalized_url}</td></tr>)}</tbody></table></div><Pages page={current} count={rows.length} onChange={setPage}/>
    <JsonDetails title="查看按范围分组的真实计数与比例" value={a.groups}/><JsonDetails title="查看域名聚合与内容年龄" value={{domain_rollups:a.domain_rollups,content_age:a.content_age}}/>
    <JsonDetails title={`查看行业汇总（${a.external_aggregates.length} 条，仅限行业语境）`} value={a.external_aggregates}/><JsonDetails title={`查看供应商声明（${a.supplier_claims.length} 条，不作为独立证据）`} value={a.supplier_claims}/><JsonDetails title={`查看未知记录（${a.unknown_records.length} 条）`} value={a.unknown_records}/>
  </section></>;
}
const money=(v:string|null|undefined,currency:string|null)=>v==null?'待确认':`${currency??''} ${v}`;
function Plans({result}:{result:MatrixResult}) {
  return <>{result.budget_plans.map((p,i)=><section className="sm-sim-plan" key={i}><h3>{p.strategy}</h3><Plan plan={p} candidates={result.matrix.candidates} simulation/><div className="sm-sim-verdict"><span>预算可行：{p.budget_feasible?'是':'否'}</span><span>稿件状态：{label(p.manuscript_status)}</span><span>execution_recommended：{String(p.execution_recommended)}</span><span>已知费用：{money(p.known_total_cost,p.currency)}</span><span>探索剩余额度：{money(p.exploration_remaining,p.currency)}</span><span>估算：{p.is_estimate?'是':'否'}</span></div><JsonDetails title="查看内核逐项计费与校验输出" value={p}/></section>)}</>;
}
function SimulationReport({run,result}:{run:SimulationRun;result:MatrixResult}) {
  const report=run.result.report??{};
  return <article className="panel b-report r-report sm-sim-report"><div className="sm-sim-watermark" aria-hidden="true">模拟演示 · 非采购依据</div><div className="sm-sim-report-body"><p className="sm-sim-report-notice">{SIMULATION_NOTICE}</p><h1>信源矩阵模拟报告</h1><p>决策来源：simulated · 种子 {SIMULATION_SEED} · 固定评估时点 {result.as_of}<br/>版本 {result.plan_version}</p>
    <h2>一、任务与输入范围</h2><p>{display(result.scope.task.product)} · {display(result.scope.task.industry)}<br/>受众：{display(result.scope.task.audience)}；覆盖地区：{display(result.scope.task.regions)}<br/>目标问题：{display(result.scope.task.questions)}<br/>素材能力：{display(result.scope.task.requirements)}</p><JsonDetails title="任务、需求与证据范围" value={report.scope}/>
    <h2>二、引用证据与行业依据</h2><p>已知明细 {result.source_analysis.known_detail_count} 条；完整范围总数 {result.source_analysis.total_citations??'待确认'}；行业汇总 {result.source_analysis.external_aggregates.length} 条；供应商声明 {result.source_analysis.supplier_claims.length} 条。</p><p>身份冲突与未知范围仍保留；行业汇总不能充当逐条引用证明。</p><JsonDetails title="内核证据分析" value={report.source_analysis}/>
    <h2>三、完整矩阵与硬条件</h2>{result.matrix.layers.map(l=><section key={l.role}><h3>{l.display_name} · {l.candidate_ids.length} 家</h3>{l.candidate_ids.length?<ul>{l.candidate_ids.map(id=>{const c=result.matrix.candidates.find(x=>x.candidate_id===id)!;return <li key={id}>{display(c.attributes.source_name??c.resource_id)}：{c.reason_summary} · {label(c.channel_status)} · {label(c.manuscript_status)}{c.pending_conditions.length>0&&`；待核验：${c.pending_conditions.join('、')}`}{c.hard_failures.length>0&&`；硬条件失败：${c.hard_failures.join('、')}`}</li>;})}</ul>:<p>暂无支持本层的候选。</p>}</section>)}
    <h2>四、双预算与组合校验</h2>{result.budget_plans.length?<Plans result={result}/>:<p>尚未提交预算。没有预算结论，也不将未知报价当成零。</p>}
    <h2>五、最低已知费用、限制与待确认项</h2><p>最低已知费用状态：<b>{String(run.result.minimum_known_cost?.status??'待确认')}</b>。以下是内核的有限范围证明；unproven 表示尚未证明最低费用，不能将某个组合金额解释为全局最低价。</p><JsonDetails title="最低已知费用的内核原始结论" value={report.minimum_known_cost}/><p>{result.limitations.join('；')||'额外限制见逐项校验与证据范围。'}</p><KernelIssues run={run}/><p>预检结果也是模拟输入，仅演示内核对输入的校验。即使 execution_recommended 为 true，模拟模式也不开放真实下单或提交。</p><JsonDetails title="带来源标记的完整结果与五节报告数据" value={exportSimulation(run)}/>
  </div></article>;
}

export default function SimulationPage({view='matrix'}:{view?:MatrixView}) {
  const workspace=usePublishingWorkspaceKey(),search=useSearch(),storageKey=`frontmind:source-matrix:simulation:v1:${workspace}`;
  const [initial]=useState(()=>restore(storageKey));
  const [input,setInput]=useState<SimulationInput>(initial.input),[budget,setBudget]=useState<SimulationBudget>(initial.budget),[selected,setSelected]=useState<string[]>(initial.selected);
  const [run,setRun]=useState<SimulationRun|null>(()=>replay(initial)),[error,setError]=useState(''),[storageError,setStorageError]=useState(''),[busy,setBusy]=useState(false);
  const [applied,setApplied]=useState(initial.applied),[appliedInput,setAppliedInput]=useState(initial.generated?initial.input:null),[appliedBudget,setAppliedBudget]=useState(initial.applied?initial.budget:null),[appliedSelected,setAppliedSelected]=useState(initial.applied?initial.selected:[]);
  const formRef=useRef<HTMLFormElement>(null),budgetRef=useRef<HTMLFormElement>(null);
  const dataset=useMemo(()=>generateSimulationData(),[]),result=run?presentSimulation(run):null;
  const inputChanged=!!appliedInput&&JSON.stringify(input)!==JSON.stringify(appliedInput);
  const budgetChanged=applied&&(JSON.stringify(budget)!==JSON.stringify(appliedBudget)||JSON.stringify(selected)!==JSON.stringify(appliedSelected));
  useEffect(()=>{
    try {sessionStorage.setItem(storageKey,JSON.stringify({version:1,input:appliedInput??input,generated:!!run,budget:appliedBudget??budget,applied,selected:applied?appliedSelected:selected} satisfies SavedSimulation));setStorageError('');}
    catch {setStorageError('浏览器未允许保存模拟输入；刷新或切换页面后需重新生成。');}
  },[storageKey,run,appliedInput,input,appliedBudget,budget,applied,selected,appliedSelected]);
  useEffect(()=>{document.title=`${view==='report'?'模拟信源报告':'模拟信源矩阵'} · FrontMind`;},[view]);
  const href=(v:MatrixView)=>{const p=new URLSearchParams(search);p.set('simulation','1');p.delete('task');p.delete('draftId');return projectWorkspaceUrl(`/publishing/source-${v}?${p}`);};
  function generate(e:FormEvent) {
    e.preventDefault();if(busy||(e.nativeEvent as Event & {isComposing?:boolean}).isComposing)return;
    setError('');setBusy(true);
    try {const next=buildSimulationMatrix(input);setRun(next);setAppliedInput(structuredClone(input));setApplied(false);setAppliedBudget(null);setSelected([]);}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));formRef.current?.querySelector<HTMLElement>('select')?.focus();}
    finally{setBusy(false);}
  }
  function calculate(e:FormEvent) {
    e.preventDefault();if(!run||busy||(e.nativeEvent as Event & {isComposing?:boolean}).isComposing)return;
    if(inputChanged){setError('需求已变化，请先重新生成内容矩阵，再筛选预算。');return;}
    const issues=validateBudget(budget);
    if(issues.length){setError(issues.map(x=>`${x.path}：${x.message}`).join('；'));budgetRef.current?.querySelector<HTMLElement>('input')?.focus();return;}
    setError('');setBusy(true);
    try {setRun(applySimulationBudget(run,budget,selected));setApplied(true);setAppliedBudget(structuredClone(budget));setAppliedSelected([...selected]);}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  }
  const toggle=(id:string)=>setSelected(xs=>xs.includes(id)?xs.filter(x=>x!==id):[...xs,id]);
  const inputField=<K extends keyof SimulationInput>(key:K,value:SimulationInput[K])=>setInput(old=>({...old,[key]:value}));
  const budgetField=(key:'exploration_cap'|'unit_price_min'|'unit_price_max',value:string)=>setBudget(old=>{const next={...old};if(value==='')delete next[key];else next[key]=value;if(key==='exploration_cap')next.exploration_enabled=value!==''&&Number(value)>0;return next;});
  const actions:ReactNode=<>{run&&<button className="button secondary" onClick={()=>saveJson('FrontMind-simulated-source-matrix.json',exportSimulation(run))}>导出模拟结果</button>}{view==='report'&&result&&<button className="button secondary" onClick={()=>window.print()}>打印模拟报告</button>}</>;
  return <MediaShell title={view==='analysis'?'引用信源分析':view==='industry'?'行业信源推荐':view==='report'?'信源方案报告':'信源矩阵'} note="固定模拟数据与启发式决策；所有分层校验、费用与执行建议由现有计算内核执行。" actions={actions}>
    <nav className="x-matrix-nav sm-sim-nav" aria-label="信源矩阵子板块">{(['matrix','analysis','industry','report'] as const).map((v,i)=><Link key={v} className={view===v?'active':''} aria-current={view===v?'page':undefined} href={href(v)}>{['信源推荐','引用信源分析','行业信源推荐','方案报告'][i]}</Link>)}</nav>
    {storageError&&<p className="notice warn" role="status">{storageError}</p>}{error&&<p id="sm-sim-error" className="block-error" role="alert">{error}</p>}<KernelIssues run={run}/>
    {view==='matrix'&&<>
      <div className="z-flow"><div className="z-flow-step"><span className="z-flow-number">01</span><div><strong>输入投放要求</strong><small>固定种子模拟输入</small></div></div><div className="z-flow-step"><span className="z-flow-number">02</span><div><strong>生成信源矩阵</strong><small>内容先行，不按价格分层</small></div></div><div className="z-flow-step"><span className="z-flow-number">03</span><div><strong>真实预算计算</strong><small>总额与探索额度同时校验</small></div></div></div>
      <section className="panel panel-pad"><h2>模拟数据已就绪</h2><p>{new Set(dataset.catalog.map(x=>x.resource_id)).size} 家虚构媒体 · {industries.length} 个行业 · 固定种子 {SIMULATION_SEED} · 固定评估时间 {SIMULATION_AS_OF}</p><p>约 {Math.round(new Set(dataset.catalog.filter(x=>x.simulation_edge).map(x=>x.resource_id)).size/new Set(dataset.catalog.map(x=>x.resource_id)).size*100)}% 媒体包含边角输入。币种不会自动换算，套餐按声明成员计价；案例地址均为不可采购的虚构地址。</p><JsonDetails title="查看生成器的媒体、行业汇总、明细与供应商声明输入" value={dataset}/></section>
      <form noValidate className="panel panel-pad sm-sim-form" ref={formRef} onSubmit={generate} aria-describedby={error?'sm-sim-error':undefined}>
        <h2>01 · 本次非金额需求</h2><div className="b-form"><label>品牌 / 产品<input className="field" value={input.product} onChange={e=>inputField('product',e.target.value)}/></label><label>目标模拟行业<select value={input.industryId} onChange={e=>inputField('industryId',e.target.value)}>{industries.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>覆盖地区<select value={input.regions[0]??'全国'} onChange={e=>inputField('regions',[e.target.value])}>{['全国','上海','广东','北京','江苏','浙江','四川'].map(x=><option key={x}>{x}</option>)}</select></label><label>目标受众<input className="field" value={input.audience} onChange={e=>inputField('audience',e.target.value)}/></label><label>期望发布时效（小时）<input className="field" inputMode="numeric" placeholder="留空不限定" value={input.hours} onChange={e=>inputField('hours',e.target.value)}/></label><label>素材能力<select value={input.requirement} onChange={e=>inputField('requirement',e.target.value)}><option value="">不限定</option><option value="images">图片</option><option value="tables">表格</option><option value="links">链接</option></select></label><label>引用样本平台<select value={input.platform} onChange={e=>inputField('platform',e.target.value)}><option value="">全部模拟平台</option><option>模拟问答甲</option><option>模拟问答乙</option></select></label><label className="wide">目标问题（每行一个）<textarea className="field z-question" value={input.questions.join('\n')} onChange={e=>inputField('questions',e.target.value.split('\n'))}/></label></div>
        <div className="x-form-actions"><span className="small muted">两篇预检状态为模拟输入的稿件，用于单篇和套餐计价演示。</span><button type="submit" className="button primary" disabled={busy}>{busy?'正在计算…':'生成模拟信源矩阵 →'}</button></div>{inputChanged&&<p className="notice warn">需求已变化；下方仍为上次生成结果，请重新生成。</p>}
      </form>
      {result&&<><Candidates result={result} selected={selected} onSelect={toggle}/><form noValidate className="panel panel-pad sm-sim-form" ref={budgetRef} onSubmit={calculate} aria-describedby={error?'sm-sim-error':undefined}><h2>03 · 独立预算筛选</h2><p>内容矩阵不因金额改变。已选 {selected.length} 项预算偏好，不代表已加入真实购物车。</p><div className="b-form"><label>预算币种<select value={budget.currency} onChange={e=>setBudget(x=>({...x,currency:e.target.value}))}>{['CNY','USD','EUR','JPY'].map(x=><option key={x}>{x}</option>)}</select></label><label>任务总预算<input className="field" inputMode="decimal" value={budget.total_cap} onChange={e=>setBudget(x=>({...x,total_cap:e.target.value}))}/></label><label>其中探索额度上限<input className="field" inputMode="decimal" placeholder="留空不启用" value={budget.exploration_cap??''} onChange={e=>budgetField('exploration_cap',e.target.value)}/></label><label>单篇最低价<input className="field" inputMode="decimal" placeholder="不限" value={budget.unit_price_min??''} onChange={e=>budgetField('unit_price_min',e.target.value)}/></label><label>单篇最高价<input className="field" inputMode="decimal" placeholder="不限" value={budget.unit_price_max??''} onChange={e=>budgetField('unit_price_max',e.target.value)}/></label><label className="sm-sim-select"><input type="checkbox" checked={budget.exploration_enabled} onChange={e=>setBudget(x=>({...x,exploration_enabled:e.target.checked}))}/>启用探索（须有明确正额度）</label></div><div className="x-form-actions"><p className="small muted">最多三种不同组合。边界观察为故意包含异常输入的诊断提案。</p><button type="submit" className="button primary" disabled={busy||inputChanged||result.matrix.status!=='complete'}>按预算真实计算 →</button></div>{budgetChanged&&<p className="notice warn">金额或偏好已变化；下方组合属于上次计算，请重新筛选。</p>}</form><Plans result={result}/><JsonDetails title="最低已知费用（内核结论）" value={run?.result.minimum_known_cost}/></>}
    </>}
    {view==='analysis'&&(result?<Evidence result={result}/>:<Empty href={href('matrix')}/>)}
    {view==='industry'&&(result?<Candidates result={result} selected={selected} onSelect={toggle} industryOnly/>:<Empty href={href('matrix')}/>)}
    {view==='report'&&(result&&run?<SimulationReport run={run} result={result}/>:<Empty href={href('matrix')}/>)}
  </MediaShell>;
}
function Empty({href}:{href:string}) {return <div className="x-empty"><strong>还没有生成模拟矩阵</strong><p>先设定模拟行业与目标问题；计算结果将同步用于分析和报告。</p><Link className="button primary" href={href}>前往生成模拟矩阵</Link></div>;}
