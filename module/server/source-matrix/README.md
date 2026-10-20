# source-matrix-planner TypeScript 接入

这是新内核的原生 TypeScript 移植，不运行 Python，不包含旧 classify-media-sources 技能或 Flask 服务，不引入新依赖。

## 入口

createModuleHttpApi 会加载本路由，因此 Dashboard 与独立子域名都使用：

- GET /api/modules/publish/industries
- POST /api/modules/publish/matrix/generate
- GET /api/modules/publish/classify/:taskId
- POST /api/modules/publish/classify/:taskId/budget
- POST /api/modules/publish/classify/:taskId/cancel
- GET /api/modules/publish/classify/:taskId/download

POST 同源 JSON，身份只来自 core.context。industry_id 只是授权范围内的选择，不是租户或品牌。task_id 由服务端 UUID 生成，手工问题 ID 按当前文本与位置摘要生成，不借用历史 q1 等 ID 冒充同一监控问题，brand_id 来自管理员行业配置。租户键为 publish- + digest({project:enterpriseProjectId,owner:businessOwnerId})；digest 使用既有 stableJson + SHA256 前24位。禁止浏览器直接写行业表、可信 dataset、快照或 decisions。

## 管理员配置（不是本轮自动执行）

1. 由主仓迁移流程审核并应用 module/schema/source-matrix.sql；导出的 Drizzle 表位于 source-matrix.ts，HTTP 直接引用，不依赖自动扫描 createPublishSchema 返回值。缺表时返回 configuration_required，不自动建表。
2. 在 publisher_source_matrix_industries 按上述可信 tenantId 写入授权行业 id/name/brandId 与 dataset。没有内置真实或示例行业。dataset 仅允许由运营/已有可信同步通道维护，浏览器无写接口。
3. dataset 可含 catalog、citations、identity_config、industry_recommendations、scope、manuscripts、requirements、selected_items。其字段语义对应参考内核契约；pricing 包含完整日期、单币种和 mandatory_fees（空数组才表示无附加费）。上游探索报价必须显式映射 allowed_purposes。manuscripts/预检/锁定项必须由现有授权业务数据提供，不能从模型或普通表单回填。
4. 真实模型在服务端 core.sourceMatrixDecisions 注入 SourceMatrixDecisionAdapter；接口接收 skill 与 instructions 和可信输入，matrix 只返回 matrix_decisions，budget 只返回 budget_plans。HTTP 不接受前端 decisions。未注入会返回 needs_ai_decisions / needs_budget_plans；调用失败保留候选并显示 decision_adapter_unavailable，不回退假结果。模型应只用已声明稿件版本与数量生成组合。用户的 selected_candidate_ids 只作为 selection_preferences 传给模型，不产生可信锁或购物车。
5. 下单仍须走现有业务的实时重报价、预检和确认，本功能没有发布副作用。

## 快照与任务

通过校验的完整矩阵结果（包括完整 scope.input_snapshot）在事务内按 tenant/plan_id/plan_version 归档；前端只能提供版本键，不能提供或改写 snapshot。预算复用时重新读取同租户行业配置，重算版本和硬条件，再应用原决定。仅预算/报价变化可复用；配置品牌、任务/证据/媒体属性/预检变化返回 stale_matrix。catalog 位置引用按原 resource_id 和整个非价格事实严格重新绑定。无任意 TTL；可信快照若携带 expires_at，过期边界按原内核规则检查。

matrix 阶段按用户显式时间处理，不自动填充证据时间；预算仍须显式 as_of。

生成接口先落真实 running 任务，返回 202 后在当前进程继续执行适配与校验；查询/取消由数据库约束保护，不使用本地文件存储。取消不承诺撤销已发生的模型调用费用，仅阻止接纳结果。没有自动重试模型/收费操作。当前不是持久队列：进程重启中断的 running 任务需取消并重新生成；如主仓有通用执行器，可将相同适配调用转移至执行器而保留仓储与校验。

## 移植差异与限制

- 所有内部金额用 bigint，公共 *_minor 用整数**字符串**而不是 Python 任意精度整数，避免 JS JSON 精度损失；主单位固定小数字符串保持原约定。版本 digest 使用仓库 stableJson，不承诺与 Python 字节哈希一致，但同可信输入确定、任务 plan_id 稳定。
- TypeScript JSON 目录/证据扩展字段采用 Row 字典；已知结构做边界校验，未知字段不解释为可信推断。金额、身份与模型决定有独立白名单。
- 五层可以为空；未判断候选保留原事实；最多三种不同组合。预算/预检/执行建议独立。未知附加费、混合币种、报价过期、套餐成员不全不能变成完整可执行价格。
- 不做统计有效性验证、汇总对账、未来引用概率、自动预算优化、购物车或发稿。minimum_known_cost 只证明唯一候选/唯一完整单价报价/已声明发布项的有限范围。

测试文件覆盖金额、证据分组、身份、角色/模型字段、报价、范围价、套餐、双预算、锁定、快照复用与版本等关键回归。测试源码已提供但本轮未执行；并非宣称完整 Python 测试集逐例等价或运行通过。
