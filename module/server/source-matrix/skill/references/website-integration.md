# 网站同源运行契约

网站实际入口：module/server/source-matrix/http.ts → decisions.ts → planner.ts / matrix.ts / budget.ts / content-plans.ts / recommendation-pricing.ts。版本标识 source-matrix-planner/2026.11.09-web.1。Python 文件用于离线复用，网站继续原生 TypeScript。两者金额使用精确最小币种单位；TS 公共 *_minor 是字符串，Python是任意精度整数。哈希序列化与 input_version 适配不承诺跨语言逐字节相同，严禁拿某一路版本替代另一条。网站新增能力见 [platform-industry-context.md](platform-industry-context.md)，不宣称离线Python已实现新的全行业校验。

export-research.ts 接受可信导入后的保留行 JSON（含来源文件SHA、sheet/行号、原模型、引用日期、标题、URL、媒体名及媒体URL），用 candidate_key 分组并保留 raw_observations/locator_key。没有回答ID不造 evidence_id，不把样本转成行业汇总。网站原有一航导入产物与运营在所属行业 dataset.brand_exports 配置的同结构批次走同一流程。网站当前已有导入弹窗和 /matrix/imports/auto 服务端解析保存入口；仅 confirmed 数据集可选用，任务保存当时的不可变研究快照。导入数据与行业分布独立，不能以其中一项成功推断另一项可用。离线 xlsx 解析仍由 export_adapter.py 提供。

网站统一使用后台XTY平台模型；无明确模型、密钥或匹配白名单时不可用，不选个人连接或core.sourceMatrixDecisions。第一阶段 prompt 只输入非价格 task/候选属性（含授权冻结正文片段与真实行业快照）；授权共享目录按400条keyset分页扫描全部激活资源；每层按真实行业、分类、地域、描述、问题与当前稿件匹配保留前24个检索候选并按resource_id合并，不再取ID前800。完整保留池及研究候选每批最多24个进入模型，全部批次共用240秒截止时间；每项须分类或给出排除理由，失败与未处理不会当作空层。单候选原表观察最多展示3行，长文本截取并明示范围，完整输入留快照。新增介绍/内容方向/层内排序字段由同一校验器验证；跨批次先按真实任务属性排序，同等条件保留批次语义次序，最后生成连续layer_rank和fit_order。矩阵独立于组合，页面每层展示前3项，不足显示实际数量。第二阶段才提供预算、入选候选的最新全部报价、已选/锁定项和用户明确选择，并沿用已保存行业快照。模型不决定价格、身份、状态或权限。

task.industry_context来自与行业分布板块同源的免费filters/distributions，保留真实行业scopeId、周期/日期、模型、取数时间、版本、状态和限制。每媒体aggregate_matches随对应候选携带完整记录；全行业完整快照只在task.industry_context保留一份，全部候选共享其中已核验ID，prompt不按候选重复全局记录或全量ID，结果industry_aggregate_ids只保存候选实际使用的全行业ID。全行业类型/时间桶只辅助宏观组合，不能变成媒体身份、品牌命中或逐条citation。引用只用aggregate契约，不能用task.industry_context的attribute路径绕过。快照与正文进入matrix_version，预算不重新取数；不兼容历史任务要求平台重新生成。

真实行业目录与推荐共用 canonical scopeId；legacyMappings 仍用于旧任务身份迁移，不作为新任务是否允许生成的判断。无本地 dataset 的新任务保存稳定的输入模式和内部 brand 标识，不向运营行业表插入运行时配置。预算、数量编辑、正式组合采用均从同一模式重建请求，不重新采用后来新增的本地富化；本地行业任务保持原有富化能力。完整规则见 platform-industry-context.md。

真实目录：module/server/publisher-source-matrix-catalog.ts 从当前授权发布上下文读取现有共享 publisher_media_resources；内部 resource_id、供应商外部ID、具体账号、报价 offer_id、规格各自保留。rawPayload.publisher_offers_v1 或 publisher_quote_v1 是受信任同步的明确报价条款，需 pricing 的kind/amount/currency/quoted_at/valid_until/mandatory_fees和真实规格。只有旧刊价时按现有客户目录人民币口径显示已知刊价；不得为其他未知报价猜币种，也不补造有效期、无附加费或规格。原四位金额必须精确可转成币种小数位，不四舍五入伪造成已确认报价。

按同名/域提出 catalog_matches.suggested；只有明确确认或用户采购选择才能映射研究内容草案到报价。用户选择不把原研究来源改成已确认被引用账号。正式 budget_plans 仍只能选矩阵已做语义判断的真实 resource 候选。关联后具体属性需重新判断时必须重新生成矩阵。

POST /classify/:taskId/budget：原 plan_id/plan_version/budget/as_of，新增 quantity_mode=new_articles|repeat_article、resource_selections=[{candidate_id,resource_id,offer_id,publication_spec}]。重新读取真实报价，用服务端当前时刻检查有效期。只变预算/报价/数量/购物车不重新调用矩阵语义；稿件article/version/contentHash变化拒绝旧矩阵。draft revision和当前锁定项在预算阶段重读，不将已采用方案导致的购物车变化误判为必须重做语义。

POST /classify/:taskId/content-plan 和 /formal-plan：plan_id、plan_version、plan_index、quantities=[{item_index,candidate_id,quantity}]、as_of。从已保存可信决定修改数量，再读最新目录并确定性复核，返回同步 {task_id,state:complete,result}，不调用AI、不写购物车。新增统一 POST /classify/:taskId/recommendation 使用 recommendations 索引及稳定推荐 ID；旧两个路径继续兼容原记录。content_tasks 为当前文章建议，不与 quantity 绑定；合法数量修改即重新计算已知基价、真实费用、总量和预算，不调用 AI 或创建新文章。当前任务latest版本不一致或取消时不能写回旧结果。

正式apply-plan先从数据库读取当前快照，再读取当前目录和绑定复核完整预算，价格变化、未知费用、语义未判断、失败项均阻止写入；同一冻结稿件多次发布需明确intent、供应商repeat_allowed及执行契约。具体单篇供应商执行协议、交易内再次报价、手动/锁定项、幂等、标题和预检见业务仓库 module/server/PUBLICATION_QUANTITY.md（完整源码输入包 source/ 中提供，独立 Skill 包不包含该文件）。新稿数量草案不编造文章，不直接入车。

网站生成只输出最多3套 recommendations；按真实资源/规格/数量配置去重，标题不同不算新组合。旧正式/内容数组仅兼容读取，正式订单严格核验保持。卡片、详情和报告读取同一保存结果；budget_feasible、ready_to_publish、execution_recommended三者区分。已有一航保存样本留旧版来源和生成时间，没有本轮伪造的新生成状态。

网站推荐估算独立于正式报价：唯一真实目录记录的 null offer/spec 保持原值，已知目录价可计算；缺日期只作范围说明，明确过期/未生效不能使用。未知必要费用保留 known_cost，不补0，也不隐藏其他明细；相异币种不相加。推荐永远不提供发布或购物车许可。更详尽字段见 content-planning.md。

本轮只改网站 TypeScript、模拟镜像及规则文档，未迁移离线 Python 的双数组和旧内容数量契约。runtime 不读取 skill/ 文档；仓库外的安装 Skill、宿主接入和线上配置必须由 ZCode 部署核实。本轮未执行运行验证，交由智谱 ZCode 和网站验收。

初次目录扫描有60秒截止时间和取消信号；动态增删导致扫描数与边界总数不一致时记录incomplete。这是有明确上边界的实时扫描，不承诺数据库事务快照。完整读取仅证明目录属性筛选完成，不能声称全部目录都经过模型分类。matrix.coverage.catalog记录total_resources/scanned_resources/pages/eligible_by_role/shortlisted_resources/excluded_by_reason及status/reason；matrix.coverage.model分别记录保留、已审阅、已分类、已排除和未处理数量。目录失败/未完或新批次审阅未完时矩阵不完成，不能进入组合计价。历史无覆盖元数据记unknown，不倒填全量扫描证据。预算/数量修改只分批重读已存候选的精确资源ID和现价，不再扫描全目录，不改变候选池。

预算组合提示只包含每层排名前3及另外3个有真实可计价记录的备选，并保留全部显式选择/锁定资源；candidate_scope报告可选总数与输入数，未输入者不等于被拒绝。报价身份、金额、规格和费用数组不截断。两个阶段都检查实际提示字符上限120000，超过时明确失败并保留重试状态，不发送巨型请求。研究记录分批传入时保留reference_path中的原始数组索引，禁止用批内序号重写证据路径。

独立复核补充：推荐目录保留供应商显式quote_status，expired/invalid/inactive/unavailable不能被缺日期目录估算放行；正式默认适配和报价指纹保持原契约。组合额外3个可计价备选优先满足当前预算币种、单价范围、总额度及探索额度，比较最小真实数量和已知必要费用后的成本，保留低价可行替代，不改变语义前三；未知附加费仍仅为估算边界。提示另传planning_objective的真实行业、产品、受众、问题ID/文字、地区、时效和要求。实际观察来源没有目录路径时，真实官方域名允许通过该来源exact身份、完整记录、同问题合法evidence引用支持权威角色；仅名称、跨问题、platform_related或身份冲突不能通过。
