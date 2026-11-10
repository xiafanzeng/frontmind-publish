# 网站 recommendation/1.0 单层组合契约

网站运行入口为 `instructions.ts + decisions.ts → planner.ts → content-plans.ts / recommendation-pricing.ts`。版本 `2026.11.10-web.1`：组合候选池=已推荐渠道（≤20）∪行业排名前20且已映射真实目录资源的媒体（同一媒体去重后最多40个）；旧五层任务在重新生成前沿用按层 top3+3 的旧范围。预算阶段新 decisions 只提交 `recommendations` 数组，最多三套有实际资源或篇数差异的组合；不再生成正式/内容两类数组。兼容旧记录时读取旧 content_plans、budget_plans，不批量改写历史记录。输出的旧数组可保留为空以兼容消费者；正式发布内部核验仍可显式调用原 budget_plans / verifyPlan。

每套仅 `strategy, reason_summary, items, explanation`。每项仅 `candidate_id, resource_id, offer_id, publication_spec, quantity, quantity_mode, content_tasks, purpose, quantity_reason`。quantity 为 1 至 100 正整数；quantity_mode 沿用可信请求的 new_articles / repeat_article，表示计划意图，不表示稿件已经创建、不同内容已经完成或冻结版本已经绑定。content_tasks 为当前文章标题、正文、目标和对应媒体要求的简短修改建议，不要求条数等于 quantity。数量调整不会触发新的改稿、保存、冻结或真实订单。

explanation 使用 objective、selection_logic、content_allocation（candidate_id/responsibility/content_angle，恰覆盖选中候选）、tradeoffs、excluded_candidates（只引用本次已判断但未选的候选）、fit_conditions、verification_items。内容须有真实依据，不编造企业资质、数据或效果。

资源只能来自候选自身 resource_id、可信 confirmed 映射或用户原有 resource_selections。按真实 resource_id + offer_id + publication_spec 精确取价；同名或同域不作为取价键。缺项仅在真实适用且有价的目录记录唯一时补齐，保留目录原值。真实目录 offer_id/spec 为 null 时不伪造替代 ID；单个资源唯一目录记录可估算已知基价，规格尚未提供写局部范围说明。多账号、多规格或报价歧义保留具体缺口，生成时优先采用其他适合且可计价资源。

网站独立 `priceRecommendationItems` 计算推荐估算，原 `priceItems` / `verifyPlan` 及下单 `resolvePublisherQuote` 不放宽。目录有效期缺失只产生 scope_notes，明确已过期、尚未生效、无效日期、不可售或不符合报价数量/用途的记录不作为有效基价。稿件未冻结、研究引用或域名缺失不隐藏目录价格。未知费用不当作零，也不抹掉已知基价。必需费 basis=unit 乘数量，basis=item 每媒体项计一次；显式其他币种费用不直接相加。套餐只在可信成员精确限定同资源/规格/数量/用途时估算一次，不制造单价，不推断跨资源分摊。

金额继续使用 contracts.money / amounts 的 bigint 与币种小数位，输出主单位十进制字符串及对应 *_minor 字符串。单项输出 unit_price、base_cost、known_mandatory_cost、known_cost、cost、lower_cost、price_source、cost_basis、scope_notes、unknown_reasons。完整费用未知时 cost=null，known_cost 保留已知部分；没有已知费用时保持 null。known_mandatory_fees 只列实际可计算的费用，没有提供附加费信息时不显示默认零元。

组合输出 `recommendations[]`，schema_version=recommendation/1.0、kind=recommendation。保留 total_articles、total_cost、known_total_cost；total_cost_known 表示费用是否完整，is_estimate 始终为 true。部分费用未知时 total_remaining / known_total_remaining 仍为预算减已知费用，remaining_is_estimate=true，不能解读为最终可用余额。已知费用超预算仍报 total_cap_exceeded / exploration_cap_exceeded；探索费用同时计入总额。币种不同不混加、不换汇。锁定正式发布项另存 retained_locked_items，不覆盖、不删除，也不把其未计入部分解释为零。

推荐永远 ready_to_publish=false、execution_recommended=false、cart_eligible=false。金额完整且条件通过才 budget_feasible=true；未完整且无已知失败为 null，已知超支/限制错误为 false。正式稿件绑定、复核与发布仍走原链路。

新生成的组合按真实资源、规格、篇数、用途及数量意图去重；仅更换标题、理由、内容建议或报价 ID 不算新组合。已保存组合由服务端 quantity_edits 标记的显式数量编辑复算时，若用户把两个配置调成相同，保留原有组合槽位与顺序并说明，不删除另一个组合或丢失其待提交编辑；模型 decisions 无权设置该标记。推荐 ID 排除 quantity，保证数量或价格更新时客户端能稳定关联同一组合；plan_version 仍随结果变化。重复组合合并后连续编号并说明不足，不补造第三套。报告与页面读取同一确定性结果。

## 离线 Python 边界

`scripts/content_planning.py` 仍是原 content-planning/1.0 离线接口，原 new_articles 逐篇内容任务、repeat_article 稿件条件和旧价格校验未在本轮迁移。`scripts/planner.py`、示例和历史预览也保留原契约；不能用它们证明新版网站行为。网站不读取 skill 文档或 Python 脚本作为运行配置，不新增 Python 依赖。仓库外安装的 Skill 或提示模板需由部署方更新到本版本约定；本包不声称已更改线上配置。

本轮未执行运行验证，交由智谱 ZCode 和网站验收。新增和修改的测试仅为测试源码。
