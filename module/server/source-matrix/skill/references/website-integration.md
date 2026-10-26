# 网站同源运行契约

网站实际入口：module/server/source-matrix/http.ts → decisions.ts → planner.ts / matrix.ts / budget.ts / content-plans.ts。版本标识 source-matrix-planner/2026.10.26-web.1。Python 文件用于离线复用，网站继续原生 TypeScript。两者金额使用精确最小币种单位；TS 公共 *_minor 是字符串，Python是任意精度整数。哈希序列化与 input_version 适配不承诺跨语言逐字节相同，严禁拿某一路版本替代另一条。

export-research.ts 接受可信导入后的保留行 JSON（含来源文件SHA、sheet/行号、原模型、引用日期、标题、URL、媒体名及媒体URL），用 candidate_key 分组并保留 raw_observations/locator_key。没有回答ID不造 evidence_id，不把样本转成行业汇总。网站原有一航导入产物与运营在所属行业 dataset.brand_exports 配置的同结构批次走同一流程。此版本不增加浏览器上传Excel入口；离线原xlsx解析仍由 export_adapter.py 提供。

网站使用已有服务端模型密钥/适配器。第一阶段 prompt 只输入非价格 task/候选属性，全部分组可参与，单候选样本主题展示前12行并明示范围，完整原行留快照。新增介绍/内容方向/层内排序字段由同一校验器验证；fit_order 保持原结构化兼容。第二阶段才提供预算、最新全部报价、已选/锁定项和用户明确选择。模型不决定价格、身份、状态或权限。

真实目录：module/server/publisher-source-matrix-catalog.ts 从当前授权发布上下文读取现有共享 publisher_media_resources；内部 resource_id、供应商外部ID、具体账号、报价 offer_id、规格各自保留。rawPayload.publisher_offers_v1 或 publisher_quote_v1 是受信任同步的明确报价条款，需 pricing 的kind/amount/currency/quoted_at/valid_until/mandatory_fees和真实规格。只有旧刊价时按现有客户目录人民币口径显示已知刊价；不得为其他未知报价猜币种，也不补造有效期、无附加费或规格。原四位金额必须精确可转成币种小数位，不四舍五入伪造成已确认报价。

按同名/域提出 catalog_matches.suggested；只有明确确认或用户采购选择才能映射研究内容草案到报价。用户选择不把原研究来源改成已确认被引用账号。正式 budget_plans 仍只能选矩阵已做语义判断的真实 resource 候选。关联后具体属性需重新判断时必须重新生成矩阵。

POST /classify/:taskId/budget：原 plan_id/plan_version/budget/as_of，新增 quantity_mode=new_articles|repeat_article、resource_selections=[{candidate_id,resource_id,offer_id,publication_spec}]。重新读取真实报价，用服务端当前时刻检查有效期。只变预算/报价/数量/购物车不重新调用矩阵语义；稿件article/version/contentHash变化拒绝旧矩阵。draft revision和当前锁定项在预算阶段重读，不将已采用方案导致的购物车变化误判为必须重做语义。

POST /classify/:taskId/content-plan 和 /formal-plan：plan_id、plan_version、plan_index、quantities=[{item_index,candidate_id,quantity}]、as_of。从已保存可信决定修改数量，再读最新目录并确定性复核，返回同步 {task_id,state:complete,result}，不调用AI、不写购物车。编辑缺少新内容任务时保留待确认。当前任务latest版本不一致或取消时不能写回旧结果。

正式apply-plan先从数据库读取当前快照，再读取当前目录和绑定复核完整预算，价格变化、未知费用、语义未判断、失败项均阻止写入；同一冻结稿件多次发布需明确intent、供应商repeat_allowed及执行契约。具体单篇供应商执行协议、交易内再次报价、手动/锁定项、幂等、标题和预检见网站 module/server/PUBLICATION_QUANTITY.md（交付快照中提供）。新稿数量草案不编造文章，不直接入车。

正式与内容方案合计最多3套，卡片、详情和报告读取同一保存结果；budget_feasible、ready_to_publish、execution_recommended三者区分。已有一航保存样本留旧版来源和生成时间，没有本轮伪造的新生成状态。
