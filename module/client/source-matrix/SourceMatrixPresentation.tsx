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
export function Plan({ plan }: { plan: BudgetPlan }) {
  return <article className="sm-card sm-plan">
    <header className="sm-section-heading"><div><span className="sm-kicker">显式发布组合</span><h3>{plan.strategy}</h3></div><span className="sm-badge">{label(plan.status)}</span></header>
    <p>{plan.reason_summary}</p>
    <dl className="sm-stats"><div><dt>总费用{plan.is_estimate ? "（含估算）" : ""}</dt><dd>{moneyText(plan.total_cost, plan.currency)}</dd></div><div><dt>其中探索费用</dt><dd>{moneyText(plan.exploration_cost, plan.currency)}</dd></div><div><dt>总预算余额</dt><dd>{moneyText(plan.total_remaining, plan.currency)}</dd></div></dl>
    <div className="sm-readiness"><div data-ready={plan.budget_feasible}><span>预算复核</span><strong>{plan.budget_feasible ? "可行" : "未通过"}</strong></div><div data-ready={plan.manuscript_status === "passed"}><span>稿件预检</span><strong>{label(plan.manuscript_status)}</strong></div><div data-ready={plan.ready_to_publish}><span>正式可发布</span><strong>{plan.ready_to_publish ? "当前校验通过" : "未就绪"}</strong></div><div data-ready={plan.execution_recommended}><span>建议执行</span><strong>{plan.execution_recommended ? "是" : "否"}</strong></div></div>
    {!!plan.unknown_items.length && <p className="sm-notice">有 {plan.unknown_items.length} 项费用待确认；已知部分为 {moneyText(plan.known_total_cost, plan.currency)}，不代表完整费用。</p>}
    {plan.errors.length > 0 && <ul className="sm-issues">{plan.errors.map((e, i) => <li key={i}>{e.code}：{e.message}</li>)}</ul>}
    <Detail title="发布明细与待确认事项" value={{ items: plan.items, unknown_items: plan.unknown_items, semantic_pending: plan.semantic_pending }}/>
  </article>;
}
export function SourceAnalysis({ analysis: a }: { analysis: Analysis }) {
  const scopeId = useId();
  const [index, setIndex] = useState(0), [domain, setDomain] = useState("");
  const g = a.groups[index], same = (s: unknown) => JSON.stringify(s) === JSON.stringify(g?.scope), rollups = g ? a.domain_rollups.filter(r => same(r.scope)) : [];
  const palette = ["var(--publishing-purple)", "var(--publishing-green)", "var(--publishing-gold)", "var(--publishing-muted)", "var(--publishing-orange)"];
  let angle = 0;
  const segments = rollups.filter(r => r.share !== null).map((r, i) => { const from = angle; angle += (r.share ?? 0) * 360; return `${palette[i % palette.length]} ${from}deg ${angle}deg`; });
  const ranked = a.actual_sources.filter(r => same(r.scope)).sort((a, b) => (b.count ?? -1) - (a.count ?? -1));
  const details = a.detail_citations.filter(d => same(d.scope) && (!domain || (() => { try { return new URL(d.normalized_url).hostname.toLowerCase().replace(/\.$/, "") === domain; } catch { return false; } })()));
  return <div className="sm-analysis">
    <div className="sm-summary"><div><span>已识别明细（跨范围汇总）</span><strong>{a.known_detail_count}</strong></div><div><span>单一范围精确总数</span><strong>{a.total_citations ?? "待确认"}</strong></div><div><span>字段不完整记录</span><strong>{a.unknown_records.length}</strong></div><div><span>独立行业汇总记录</span><strong>{a.external_aggregates.length}</strong></div></div>
    {!a.groups.length ? <PublishingEmpty title="暂无引用明细" description="行业推荐与供应商声明不会被当成实际引用。接入真实记录后显示分布。"/> : <>
      <section className="sm-scope-panel"><div><label htmlFor={scopeId}>统计范围</label><p>不同问题、平台、模型与周期分别查看</p></div><select id={scopeId} value={index} onChange={e => { setIndex(Number(e.target.value)); setDomain(""); }}>{a.groups.map((x, i) => <option key={i} value={i}>{display(x.scope.question_id)} · {display(x.scope.platform)} · {display(x.scope.model)} · {display(x.scope.model_version)} · {display(x.scope.period)}</option>)}</select><Detail title="查看完整范围" value={g?.scope}/></section>
      <section className="sm-card sm-distribution-panel"><header className="sm-section-heading"><div><h2>引用信源分布</h2><p>按域名聚合 · 当前完整统计范围</p></div><span className="sm-badge">只描述当前样本构成</span></header>
        {g?.total_citations !== null && segments.length ? <div className="sm-distribution"><div className="sm-donut" role="img" aria-label={`当前范围共 ${g?.total_citations} 条引用，域名分布见图例`} style={{ background: `conic-gradient(${segments.join(",")})` }}><span>{g?.total_citations}<small>当前范围引用</small></span></div><div className="sm-legend">{rollups.map((r, i) => <button type="button" key={r.domain} aria-pressed={!!domain && domain === r.domain} onClick={() => setDomain(d => d === r.domain ? "" : r.domain)}><span><i className="sm-dot" style={{ background: palette[i % palette.length] }}/>{r.domain || "未知域名"}</span><strong>{r.count ?? "待确认"}<small>{r.share === null ? "占比待确认" : (r.share * 100).toFixed(1) + "%"}</small></strong></button>)}</div></div> : <div className="sm-no-chart" role="status"><strong>分布待确认</strong><p>此范围明细不完整，分母与占比待确认。</p></div>}
        <p className="sm-caption">比例仅描述该范围的引用构成，不是未来 AI 引用率、收录率或推荐概率。筛选明细不会改变图表分母。</p>
      </section>
      <div className="sm-analysis-grid"><section className="sm-subpanel"><header><h3>来源排名</h3><span>仅当前统计范围</span></header><div className="sm-ranking">{ranked.map((r, i) => <button className="sm-rank" key={i} type="button" aria-pressed={!!domain && domain === r.domain} onClick={() => setDomain(d => d === r.domain ? "" : r.domain)}><span className="sm-rank-number">{String(i + 1).padStart(2, "0")}</span><span className="sm-rank-identity"><strong>{display(r.identity.source_name)}</strong><small>{r.domain || "域名未提供"} · {display(r.identity.account_id)}</small><small>{r.status}</small></span><span className="sm-rank-count">{r.count ?? "待确认"}<small>{r.share === null ? "占比待确认" : (r.share * 100).toFixed(1) + "%"}</small></span></button>)}</div><p className="sm-caption">身份争议可能让来源行重叠，不能将行数或占比相加为总数。</p></section>
        <section className="sm-subpanel"><header><div><h3>媒体引用明细</h3><span>{domain || "全部当前范围来源"} · {details.length} 条明细</span></div>{domain && <button type="button" onClick={() => setDomain("")}>显示全部来源</button>}</header><div className="sm-table"><table><thead><tr><th>引用信源 / 原文</th><th>证据 ID / 状态</th><th>采集时间</th><th>发布时间</th></tr></thead><tbody>{details.map((d, i) => <tr key={i}><td><strong>{display(d.record.source_name)}</strong><a className="sm-source-url" href={d.normalized_url} target="_blank" rel="noreferrer">{d.normalized_url} ↗</a></td><td>{d.evidence_ids.join("、") || "未提供"}<small>{d.status}</small></td><td>{display(d.record.collected_at)}</td><td>{display(d.record.published_at)}</td></tr>)}</tbody></table></div>{!details.length && <p className="sm-caption">当前来源没有可展示的完整引用明细，缺失数据不代表从未被引用。</p>}</section></div>
    </>}
    <div className="sm-provenance"><Detail title="行业汇总（独立口径，不与明细混算）" value={a.external_aggregates}/><Detail title="内容年龄与未知日期" value={a.content_age}/><Detail title="供应商声明（非观察事实）" value={a.supplier_claims}/></div>
  </div>;
}
export function Report({ result: r }: { result: MatrixResult }) {
  return <article className="sm-report">
    <header className="sm-report-cover"><span className="sm-kicker">FRONTMIND / SOURCE MATRIX</span><h1>信源矩阵与预算筛选报告</h1><p>{display(r.scope.task.industry)} · 数据时间 {r.as_of}</p><div className="sm-report-versions"><span>方案 {r.plan_id}</span><span>版本 {r.plan_version}</span><span>矩阵 {r.matrix_version}</span></div></header>
    <section><h2>一、任务与输入范围</h2><dl className="sm-report-scope"><div><dt>目标行业</dt><dd>{display(r.scope.task.industry)}</dd></div><div><dt>产品 / 目标受众</dt><dd>{display(r.scope.task.product)} / {display(r.scope.task.audience)}</dd></div><div><dt>覆盖地区</dt><dd>{display(r.scope.task.regions)}</dd></div><div><dt>非金额投放要求</dt><dd>{display(r.scope.task.requirements)}</dd></div></dl><Detail title="目标问题、任务与完整证据范围" value={r.scope}/></section>
    <section><h2>二、结论摘要与信源分布</h2><p>{label(r.status)}。矩阵覆盖为语义适配，不承诺未来引用效果；结果装配完成不代表可以发布。</p><SourceAnalysis analysis={r.source_analysis}/></section>
    <section><h2>三、分层配置说明</h2><div className="sm-report-layers">{r.matrix.layers.map(l => <div key={l.role}><span className="sm-badge">{l.display_name}</span><strong>{l.candidate_ids.length} 个主层来源</strong><p>{l.auxiliary_candidate_ids.length} 个辅助角色{l.status === "empty" ? " · 当前为空层" : ""}</p></div>)}</div></section>
    <section><h2>四、逐媒体推荐清单</h2><div className="sm-report-sources">{r.matrix.candidates.map((c, i) => <article key={c.candidate_id}><div className="sm-report-source-heading"><span>{String(i + 1).padStart(2, "0")}</span><div><h3>{display(c.attributes.source_name ?? c.attributes.name ?? c.resource_id)}</h3><p>{roleNames[c.primary_role ?? ""] ?? "未分层"} · {label(c.selection)} · {label(c.channel_status)} · {label(c.evidence_relation)}</p></div></div><p>{c.reason_summary ?? "尚无已校验适配判断"}</p><Detail title="推荐依据与待确认项" value={{ references: c.references, evidence_ids: c.evidence_ids, aggregate_ids: c.aggregate_ids, reason_details: c.reason_details, unconfirmed_items: c.unconfirmed_items }}/></article>)}</div></section>
    <section><h2>五、下一步行动与预算</h2>{r.budget_plans.length ? r.budget_plans.map((p, i) => <Plan key={i} plan={p}/>) : <p>尚无已校验发布组合，请完成预算阶段。</p>}<aside className="sm-report-action"><h3>非金额投放要求与发布前核对</h3><p>发布前需重新获取有效报价、核对媒体硬条件并完成当前稿件版本预检；本页不会自动下单或发稿。</p></aside><Detail title="硬条件与待确认事项" value={r.matrix.candidates.map(c => ({ candidate_id: c.candidate_id, hard_failures: c.hard_failures, pending_conditions: c.pending_conditions, manuscript_status: c.manuscript_status }))}/><Detail title="限制与错误" value={{ limitations: r.limitations, warnings: r.warnings, errors: r.errors }}/><Detail title="最低已知费用的有限证明" value={r.minimum_known_cost}/></section>
  </article>;
}
