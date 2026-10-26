# content-planning/1.0

研究篇数和报价规划是独立契约，不能混入旧 research_drafts 或伪造 budget_plans。

输入为可信 request、已校验 matrix 快照、AI content_plans 数组和带时区 as_of。Python 离线入口 additionally 要求 request.matrix_version 等于快照 matrix_version（结构化）或 input_version（export_research）；网站从授权数据库读取完整快照。candidate_key、locator_key 不转换成真实资源或回答ID。离线研究候选以原 candidate_key 作为本契约 candidate_id，必须保持一一映射。

每套仅 strategy、reason_summary、items、explanation。items 每项仅 candidate_id、可空 resource_id/offer_id/publication_spec、quantity、quantity_mode、content_tasks、purpose、quantity_reason。quantity 为1到100正整数。new_articles 每篇应有一个内容任务，未逐篇提供或后续数量编辑缺少任务时保持待确认；repeat_article 需要可信 publication_intent=repeat_existing_article、真实 manuscripts 及报价 repeat_allowed=true。没有虚构 article_id/version。

explanation 采用七部分：objective、selection_logic、content_allocation（candidate_id/responsibility/content_angle，恰覆盖选中候选）、tradeoffs、excluded_candidates（candidate_id/reason，仅已判断未选候选）、fit_conditions、verification_items。除两项列表允许空的 excluded_candidates 外，说明列表应非空；不填写预测效果。

资源必须是该候选真实 resource_id、可信映射，或用户显式 resource_selections 中的采购选择；同名同域只提出选择，不确认账号。Python 离线映射为 adapter-owned candidate_to_resource=[{candidate_id,resource_id,status:confirmed}]，不得从模型字段读取。网站 source_mappings 由受控行业配置维护，不能由浏览器写入。

使用现有价格计算器的非发布身份模式 price_items(...,publication_identity=False) / priceItems(...,false)：不要求也不填充文章ID，仅计算声明数量的报价费用。默认正式模式不变。套餐缺准确成员仍未知；不得拆假单价。费用、日期、币种、min/max数量、单价上下界、必付费、总预算和探索子额度都需复核。锁定正式发布项保留在 retained_locked_items，内容草案不能无声删除锁定项后宣布预算可行。

输出 kind=research_content_plan 或 quoted_content_plan；budget_feasible 可为 null/false/true，ready_to_publish/execution_recommended/cart_eligible 永远 false。真实报价完整且预算核算通过，可以说“报价规划在预算内”，仍不能说已绑定并可发布。身份、费用或约束未知时总可行性为 null；已知金额单独展示。逐篇稿件完成真实绑定后需重新走正式 budget_plans，不自动升级。

Python 调用（本轮未执行）：

```sh
python scripts/content_planning.py --input trusted-request.json --matrix matrix.json --decisions content-plans.json --as-of 2026-10-26T12:00:00+08:00 --output content-plan-result.json
```

输入或决定失败退出2，不覆盖旧输出；成功退出0仍需阅读每套 errors、unknown_items、budget_feasible。不安装依赖、不调用模型、不联网、不写真实购物车。
