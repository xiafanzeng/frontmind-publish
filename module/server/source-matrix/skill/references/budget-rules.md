# 发布项费用与双预算复核

接口：`price_items(items: list[dict], catalog: list[dict], as_of: str) -> dict`；`verify_plan(plan: dict, matrix: dict, request: dict, as_of: str) -> dict`。只校验确定性事实，不选择媒体、不优化、不联网、不调用模型。输入不被修改；畸形对象/列表/嵌套报价返回结构化 invalid_type 与未知金额。

## 单一输入契约

发布项要求非空字符串 `article_id`、`version`、`resource_id`、`offer_id`、`publication_spec`、正整数 `quantity`、`purpose: standard|exploration`；可带 `locked: true` 和展示字段。身份为 article_id/version × resource_id × publication_spec × quantity，同项跨层去重；同身份不同 offer/purpose 报 conflicting_publication，不静默择一。不同稿件分别计价；主层不会决定费用归属。publication_spec 可为确定性 JSON 对象或非空字符串，但必须与报价完全一致。

`plan.items` 为明确选择的发布项数组。可信 `request.selected_items`（或 task.selected_items）用于保护当前选择：已选 offer 不得由方案换供应商；锁定项遗漏会保留并报 locked_selection_removed，改数量/规格/offer/用途会报冲突，绝不删锁定项解决超支。可信探索用途不得改为 standard。合法用户变更须由网站先更新可信 selected_items，再复核，不接受 AI 声称“用户允许”。

`matrix` 接受 assemble_matrix 的完整结果，也接受 prepare_candidates 输出；须有非空字符串 matrix_version 和 candidates（完整结果在 matrix.candidates）。读取可信 channel_status、manuscript_checks 与 offers；计划不能覆盖这些字段。request.catalog 提供当前报价，省略时使用快照 offers；显式空列表意味着没有当前报价。只允许原候选快照中的 resource_id，新资源必须重新生成矩阵。最新价格不改变 matrix_version/fit_order。

每条 catalog 报价明确 resource_id、offer_id、publication_spec，计费字段只放在 `pricing`，例如：

```json
{
  "resource_id":"r1", "offer_id":"supplier-product-1", "publication_spec":"text",
  "pricing": {
    "kind":"unit", "amount":"100.00", "currency":"CNY",
    "quoted_at":"2026-10-01T00:00:00Z", "valid_until":"2026-11-01T00:00:00Z",
    "mandatory_fees":[{"amount":"10.00","basis":"unit"},{"amount":"5.00","basis":"item"}]
  }
}
```

所有输入金额通过 contracts.parse_money：主单位十进制字符串或主单位整数，禁止浮点。上述一项数量2，费用为 `(100+10)*2+5=225.00`。mandatory_fees=[] 明确已确认没有附加费；缺失、null、费金额null均未知，不当0。报价0是明确免费，仍需日期/币种/附加费用完整。报价起止与 as_of 都必须是有时区的 ISO 日期时间，按实际时间比较，首尾均包含。

- kind=unit：amount 为单次价，乘 quantity。
- kind=range：upper_bound 为已确认上界，采用上界保守核算并在明细标 cost_basis=confirmed_upper_bound；缺上界未知，不用 amount 代替。upper_bound 本身即可信适配器确认的上界字段，不能来自 AI 猜测；结果 is_estimate=true 明示上界估算，不能当固定成交价。
- kind=package：amount 为一次明确套餐总价，included_items 为套餐包含的全部发布项（使用上述身份字段）。所选同 offer 发布项身份集合必须与 included_items 完全相同；只计一次套餐总价，不拆单价。首版套餐只支持同 resource/offer、同 purpose、所有必需费 basis=item；混合探索用途无法可靠分摊，返回未知。套餐金额明细归第一项，其他包含项为0并共享套餐规则，不能解释为其真实单价。需要单次上下限的套餐，应由可信适配器提供明确可比较单次规则；首版遇到套餐与单次上下限同时存在返回 package_unit_limit_unresolved，不声明预算可行。

## 结果与状态

`items` 为去重并保留锁定项的选择；`details` 逐项给 item/currency/cost/known_cost/cost_basis/unknown_reasons。`unknown_items` 给未确认原因；errors 为 code/path/message。完整 total_cost 或 exploration_cost 未知时为 null，known_total_cost/known_exploration_cost 仅累计能确认的金额。混合币种不累加、不转换，currency 和总费用为null。

金额公共字段 `total_cost`、`exploration_cost`、`known_total_cost`、`known_exploration_cost`、`total_cap`、`exploration_cap`、`total_remaining`、`exploration_remaining` 以及明细 cost/known_cost 均为主单位定点十进制字符串或null。每个金额字段配同名 `*_minor` 最小单位整数或null供确定性校验；不得将这些字段当主单位传回 parse_money。CNY "5000.00" 对应 500000。余额可以是负数字符串用于呈现超额。

price_items.complete 只表示发布身份、数量、报价和计费依据完整。verify_plan.budget_feasible 另要求非空选择、有效 budget、单币种匹配、原矩阵成员、channel_status=eligible、报价/必需费用完整及双上限均通过。探索全部费用包含在总费用中，且不得超过 exploration_cap；enabled 必须为true且子上限>0才可选择探索。探索未启用/上限缺失时仍能核验普通方案。缺预算 status=needs_budget；费用未完整 status=estimate；完整且不通过 status=no_feasible_plan；通过 status=budget_feasible。

锁定项超出任何额度报 locked_selection_conflict，仍保留选择和已知费用；锁定项任何费用未知时两个余额均null，不声明预算可行。缺稿件版本或数量只能暂估，不声明完整任务费用。启用探索而未给子额度、但本方案没有探索项时允许普通方案，探索额度/余额保持null。

manuscript_checks 逐发布项匹配候选内的 article_id/version，manuscript_status 为 passed/failed/needs_manuscript_check。金额可行与稿件正式预检分开：失败或未知预检仍可展示金额可行，但 ready_to_publish=false，不得推荐执行发布。只有预算通过且所有稿件预检passed才 ready_to_publish=true；这仍是当前输入的确定性复核，正式发布前网站应重新报价和预检。没有效果预测、全局最优承诺、真实网站执行或自动购物车操作。


## 审查后补充的可信约束

catalog[].allowed_purposes 若显式提供，必须是非空列表且元素只允许 standard 或 exploration，是可信 offer 的用途限制。`["exploration"]` 的报价只允许探索发布项，AI不能改standard；显式 null、字符串、空数组、非法值均返回 allowed_purposes_invalid，不能当无限制。缺该字段保持原用途模型。网站适配器须把上游明确探索用途映射到此字段；不得用矩阵主层推断用途。`["standard","exploration"]` 同时允许同资源不同稿件分别承担不同用途。

锁定恢复按包含 quantity 的完整身份保留每一项；同稿件/版本/资源/规格、不同数量的两条可信锁定项不会互相覆盖。数量修改不能消除已有探索用途保护。套餐同一 offer_id 关联多个资源时超出首版合同，返回 package_cross_resource_unresolved，并排除其未确认报价金额；不依赖发布项顺序决定价格。套餐有任意成员锁定时，按完整方案中该套餐的已确认计费记录核验锁定成本，不截断成员重新报价；完整套餐的双余额继续可知。

range 的 upper_bound 只能证明总额上限和单价上限。配置 unit_price_min 时另要求可信 pricing.lower_bound；缺下界报 unit_price_min_unresolved，低于下限报 unit_price_below_min。lower_bound 不能大于 upper_bound，显式无效下界为未知。明细 lower_cost/lower_cost_minor 给包含已确认附加费的费用下界；不得用上界证明下限。


## 解释与执行状态补充

planner给每套方案添加semantic_ready/semantic_pending；未经第一阶段合法语义决定的目录资源不能execution_recommended。budget_feasible仍为金额/渠道约束复核，ready_to_publish仍为费用及稿件预检状态；语义门槛不使已知费用变未知。锁定项仍完整保留。

顶层warnings包含exploration_cap_required（开启探索但缺子上限），不阻止普通方案。plan_id/plan_version与report一致。minimum_known_cost只在唯一候选/唯一明确完整单价报价/一套已声明发布项的限定范围可证明时返回费用及资金缺口；复杂覆盖、套餐、多候选或多报价为null并说明原因。不是三套方案取最小值、全局优化或整个任务覆盖承诺。字段见contracts.md。
