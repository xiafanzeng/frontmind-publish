# 离线研究组合契约 v1

本契约是原 `source-matrix-planner` 的独立研究扩展，不替换或放宽其正式 `budget_plans`。原 Skill 的脚本及四份规则在 `skill-original/` 原样保存。网站当前在线生成、绑定、报价、apply-plan 的语义不改变。

## 研究属性适配

原 Excel 的明细没有回答 ID、确切账号、稿件、资源或报价身份。`prepare_input.py` 将按原始媒体名称和媒体 URL 精确分组后的观察保存在 `catalog[].observation_context.records`，同时明确 `data_kind=raw_brand_observation_context`。这是研究属性行，不声明可售目录：不提供 `resource_id`、`offer_id`、价格、发布状态、媒体能力或独立行业推荐。原始 Skill 据此产生 `research_only` 候选，`unverified_offer:<index>` 是它自带的研究键，不是实际 offer_id。

`citations=[]` 和 `industry_recommendations=[]`。Excel 行号标识只做来源追溯，不生成证据 ID、回答 ID 或 aggregate_id。原 Skill 的 `evidence_relation=none`、`evidence_ids=[]` 保持原样。文件里的媒体名称与标题也不等于原文真实性、资质或官方背书已经核验。

AI 的矩阵决定只使用原 Skill 白名单字段；属性引用指向本候选的原始标题、名称、域名与当前演示问题。候选的媒体属性没有从 AI 决定中回填。五个层是语义角色，地域层因全国目标及缺少可核验地域覆盖而留空。

## 两阶段运行

1. 原 Skill `--stage matrix`：先提取全部研究候选，再用保存的 `matrix_decisions` 运行，必须 `status=complete`、`matrix.status=complete`、`errors=[]`。第一阶段输入没有 budget、报价或发布选择。
2. 原 Skill `--stage budget`：用完整原矩阵及添加假设预算后的输入实际执行。它的目录引用回绑要求 `resource_id`，本样本没有，因此返回 `invalid_input`，CLI 退出 2；真实输出保存在运行记录与 `formal-budget-compatibility.json`。这是正式发布契约不适用于未绑定观察的实际限制，没有把失败标成通过。
3. `research_combinations.py`：为第二阶段的研究目标提供独立入口。先比较原快照与当前输入的全部非价格事实，再调用未修改的原 Skill `run(..., stage='matrix')` 重新验证保存的 AI 决定，确认 matrix_version 与 fit_order 没有因预算变化。随后校验 AI 提交的研究组合，不走原正式发布账单或购物车。

## 输入白名单

顶层仅接受 `research_combinations`，1 至 3 套。每套必须恰好包含：

- `strategy`、`reason_summary`：非空解释。
- `items`：非空数组，每项仅含 `candidate_id`、`purpose`、`usage`。
- `coverage`、`gaps`、`tradeoffs`、`unconfirmed_items`：非空说明列表。

`candidate_id` 必须来自本次已校验矩阵，`selection` 为 recommended 或 alternative，不能是 ineligible，组合内不可重复，同一候选集合不能换名字凑方案。

`purpose` 为 standard 或 exploration。演示探索候选必须保留探索用途，启用探索且正子上限存在才可选择；600 元子上限包含在 3000 元总额中。这里只核验预算输入和用途授权，不证明未知费用满足额度。

`usage` 为 reference（参考阅读，非购买发布位）或 publication_research（待确认账号与刊发条件的渠道研究）。本演示权威层只允许 reference，不能被装成商业发布位。

禁止 AI 提交 `article_id`、`resource_id`、`offer_id`、价格、刊发状态、费用可行性、预检结果或锁定标记。本契约完全不写真实业务对象。

## 输出语义

校验完成为 `research_complete`，每套状态 `research_draft`。这只表示研究组合结构与来源合法，不表示财务或发布通过。输出必定：

- `total_cost`、`known_total_cost`、`exploration_cost`、各余额和 `budget_feasible` 为 null；未知费用不能是 0。
- `ready_to_publish=false`、`execution_recommended=false`、`cart_eligible=false`。
- `total_cap`、`exploration_cap` 是演示预算输入，不是媒体报价。
- `purpose_by_candidate`、`usage_by_candidate` 保留研究用途，展示时参考项不能标为待购买。
- `matrix_version` 与 `matrix_fit_order` 沿用原矩阵；`research_revision` 对预算和 AI 研究选择生成独立版本。

页面、理由详情与报告共用 `yihang-demo.json` 中同一份矩阵与研究组合。矩阵的 `plan_id/plan_version` 来自原 Skill；研究组合使用独立 `research_revision`，不伪造在线任务 ID。原完整快照保存在 `outputs/matrix.json`，紧凑页面产物只保留已判断候选及首条原始来源，其余原始行仍在归档中。
