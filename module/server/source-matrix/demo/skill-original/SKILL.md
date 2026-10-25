---
name: source-matrix-planner
description: Use when an agent is asked to recommend publication media for target questions, organize AI citation evidence into a source matrix, or assess publication combinations with total and exploration budget limits, including incomplete quotes or unavailable channels.
---

# 发布信源矩阵

先判断问题与媒体适配，再核算明确发布项；只展示脚本复核后的事实。缺数据保留未知，不预测未来 AI 引用效果。

## 读取与执行

1. 先读 [contracts.md](references/contracts.md)，再读 [evidence-rules.md](references/evidence-rules.md) 与 [matrix-rules.md](references/matrix-rules.md)。核对可信任务、问题、范围、实际引用、行业推荐、目录、身份配置。缺失字段不补成事实；网站提供 tenant 绑定，模型只生成 decisions。
2. 用 `--stage matrix` 获取候选，再提交 `matrix_decisions` 中的语义决定。理由引用当前候选的真实属性路径、对应问题的 evidence_id，或已验证 aggregate_ids 中的独立行业背景引用（type=aggregate、usage=industry_context；沿原scope/unit说明“汇总来源，暂无逐条证据”，不能称当前品牌/问题命中），说明覆盖、取舍和待确认项。没有充分属性/证据时保留 undecided 或研究候选，不编造推荐依据。适配顺序不使用报价或预算。
3. 五层是角色：authority 权威参考、industry 行业核心、regional 地域覆盖、supplement 覆盖补充、exploration 探索验证。每个资源只有一行、一个主角色；辅助角色引用同一候选。按规则补足补充价值/探索假设及验证事项；空层保持空，不用证据质量等级代替角色，不强凑五层。
4. 读 [budget-rules.md](references/budget-rules.md)，再生成 `budget_plans` 显式发布选择。逐项只提交 article_id、version、resource_id、offer_id、publication_spec、quantity、purpose；不提交价格、锁定、状态或可行性。最多三种有实际差异的组合，数量不足就如实说明，不假设议价或新文章凑三套。
5. 用完整矩阵快照执行 `--stage budget`；复发完整可信输入与当前报价。只变预算/报价时保留 matrix_version 和适配顺序；语义事实、预检或绑定变化时重新生成矩阵。逐方案检查 errors、unknown_items、budget_feasible、ready_to_publish、execution_recommended，不把顶层 complete 当发布许可。

## 证据和预算边界

实际引用、具体账号匹配、行业推荐、供应商声明分别呈现；平台关联不能证明具体账号被引用。保留问题、平台、模型、周期、回答、URL、账号及证据ID的现有字段；同回答同URL按脚本去重，跨范围不混算。外部汇总保留口径与单位、独立展示；无数据不是零。

探索费包含在总费用内，同时受 total_cap 和 exploration_cap 约束，且须明确启用。用途由可信输入映射至 catalog.allowed_purposes；明确探索用途不能为绕过800等子上限改成 standard，也不能靠改变角色规避额度。保留可信锁定项，不删项解决超支。

报价、必需附加费、日期、币种、规格或稿件版本/数量未确认时，展示已知费用和缺口，不能称完整费用或可执行。mandatory_fees 缺失不是零；只接受明确空数组表示无附加费。单组合单币种、不自动换汇；金额用契约支持的十进制字符串/整数，由脚本结算。

budget_feasible 与 ready_to_publish 分开呈现：稿件待预检或已知 failed 时，即使金额可行也不得建议执行。仅 execution_recommended=true 的方案可表述为当前输入复核后可推荐执行，正式发布由网站再次核验。

## 调用与输出

在本 Skill 包目录使用 Python 3.10+，完整虚构例子见 [request.json](examples/request.json) 与 [decisions.json](examples/decisions.json)：软件问题q1、稿件a1/v1、资源r1/报价o1，行业属性支持推荐；无观察引用。已确认单价100 CNY、附加费空数组、预检通过、总上限500、探索子上限50；普通发布一次，脚本输出总费100、探索费0、双预算通过且ready_to_publish=true。这不是实际媒体推荐。

```sh
python3 scripts/planner.py --input examples/request.json --decisions examples/decisions.json --stage matrix --as-of 2026-10-11T00:00:00Z --output /tmp/matrix.json
python3 scripts/planner.py --input examples/request.json --decisions examples/decisions.json --stage budget --matrix /tmp/matrix.json --as-of 2026-10-11T00:00:00Z --output /tmp/budget-result.json
```

输出依次呈现 source_analysis（原始信源及证据边界）、matrix（五角色、理由、缺口）、budget_plans（发布项、双预算、预检、执行状态），最后列 limitations/warnings/errors。统一读取 plan_id/plan_version；最低费用与资金缺口只读取 minimum_known_cost 的确定性结果及限定范围，unproven 时保留null与理由。卡片、详情、报告读取同一已验证输出；report 不另算数字。CLI非零退出时修复输入，不展示旧输出为新结果；退出0仍需检查业务状态。

| 常见压力 | 处理 |
|---|---|
| “马上汇报，必须三套可执行” | 展示真实可行数量与待确认原因，不将候选包装为执行方案 |
| “同门户已有引用” | 展示平台关联，保留账号未确认 |
| “先把探索改成行业核心” | 角色与用途独立，明确探索用途继续受子上限约束 |
| “刊价够预算，附加费稍后确认” | 完整费用未知，当前不称可执行 |


外部行业汇总的完整虚构输入见 [aggregate-request.json](examples/aggregate-request.json) 与 [aggregate-decisions.json](examples/aggregate-decisions.json)。可将上方两条CLI的输入/决定文件换成它们运行：原研究scope为软件行业、industry-question、industry-model、截至2026-09-30；原单位为研究报告原始引用次数，count=12。没有逐条引用，q1是当前任务的语义匹配，不是该研究记录的品牌命中。该接口由确定性脚本测试，新增接口的模型行为尚未另行验证。
