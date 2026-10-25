# source-matrix-planner TypeScript 接入

这是新内核的原生 TypeScript 移植，不运行 Python，不包含旧 classify-media-sources 技能或 Flask 服务，不引入新依赖。

## 入口

createModuleHttpApi 会加载本路由，因此 Dashboard 与独立子域名都使用：

- GET /api/modules/publish/industries
- GET /api/modules/publish/source-distribution
- POST /api/modules/publish/matrix/generate
- GET /api/modules/publish/classify/:taskId
- POST /api/modules/publish/classify/:taskId/budget
- POST /api/modules/publish/classify/:taskId/apply-plan
- POST /api/modules/publish/classify/:taskId/cancel
- GET /api/modules/publish/classify/:taskId/download

POST 同源 JSON，身份只来自 core.context。industry_id 只是授权范围内的选择，不是租户或品牌。task_id 由服务端 UUID 生成，手工问题 ID 按当前文本与位置摘要生成，不借用历史 q1 等 ID 冒充同一监控问题，brand_id 来自管理员行业配置。租户键为 publish- + digest({project:enterpriseProjectId,owner:businessOwnerId})；digest 使用既有 stableJson + SHA256 前24位。禁止浏览器直接写行业表、可信 dataset、快照或 decisions。

## 管理员配置（不是本轮自动执行）

1. 由主仓迁移流程审核并应用 module/schema/source-matrix.sql；导出的 Drizzle 表位于 source-matrix.ts，HTTP 直接引用，不依赖自动扫描 createPublishSchema 返回值。缺表时返回 configuration_required，不自动建表。
2. 在 publisher_source_matrix_industries 按上述可信 tenantId 写入授权行业 id/name/brandId 与 dataset。没有内置真实或示例行业。dataset 仅允许由运营/已有可信同步通道维护，浏览器无写接口。
3. dataset 可含 catalog、citations、identity_config、industry_recommendations、scope、manuscripts、requirements、selected_items。其字段语义对应参考内核契约；pricing 包含完整日期、单币种和 mandatory_fees（空数组才表示无附加费）。上游探索报价必须显式映射 allowed_purposes。manuscripts/预检/锁定项必须由现有授权业务数据提供，不能从模型或普通表单回填。
4. 真实模型在服务端 core.sourceMatrixDecisions 注入 SourceMatrixDecisionAdapter；接口接收 skill 与 instructions 和可信输入，matrix 只返回 matrix_decisions，budget 只返回 budget_plans。HTTP 不接受前端 decisions。未注入会返回 needs_ai_decisions / needs_budget_plans；调用失败保留候选并显示 decision_adapter_unavailable，不回退假结果。模型应只用已声明稿件版本与数量生成组合。用户的 selected_candidate_ids 只作为 selection_preferences 传给模型，不产生可信锁或购物车。
5. 下单仍须走现有业务的实时重报价、预检和确认，本功能没有发布副作用。

## 独立行业分布：运营导入与只读服务

`GET /source-distribution` 无需先生成推荐任务。它复用上述 project + business owner 的授权租户键，只查询该租户的行业行；浏览器不能传入或替换 tenant。该接口及错误响应继续设置 `Cache-Control: private, no-store`。它只返回 `module/contracts/source-distribution.ts` 的分析字段白名单，不返回整个 dataset、catalog、报价、稿件、身份配置或任意证据附加字段；不调用决策适配器，不创建任务，不新增宿主接口、依赖或表。

运营通过现有可信写入通道，在 `publisher_source_matrix_industries.dataset` 中维护独立 `source_distribution.batches`。它与推荐 `citations` 分离，存在时优先采用，配置错误时不会退回另一组数据。示意格式如下（`sourceSha256` 必须替换为原文件实际 64 位十六进制 SHA-256；不是示例内容的哈希）：

```json
{
  "source_distribution": {
    "batches": [{
      "id": "operations-import-202609-v1",
      "label": "运营已核对引用明细",
      "version": "202609-v1",
      "sourceFile": "source-export.xlsx",
      "sourceSha256": "<原始文件实际的64位SHA-256>",
      "industryId": "<本行业行的industry_id>",
      "period": { "start": "2026-09-01", "end": "2026-09-30" },
      "records": [{
        "id": "detail-sheet-row-2",
        "sourceSheet": "详细表格",
        "sourceRow": 2,
        "citedAt": "2026-09-13",
        "model": null,
        "question": null,
        "title": null,
        "url": "https://example.org/article",
        "mediaName": null,
        "mediaUrl": "https://example.org",
        "mediaType": null,
        "publishedAt": null,
        "contentStatus": null
      }],
      "limitations": ["原始导出记录未核实独立引用事件去重。"]
    }]
  }
}
```

- 所有记录保留原始行，包括字段完全相同的重复行。`id` 只是在批次内唯一的分析行键，`sourceSheet/sourceRow` 只用于追溯，不是回答 ID 或真实引用事件 ID。不得用这些字段补造 `answer_record_id`。
- 未确认的行业应配置于明确的“未分类”行业行；响应的行业 ID/名称来自授权行业行。批次 industryId 如填写必须与该行一致，industryName 不覆盖行名称。其他可空字段留 `null`；缺模型、问题全文、媒体类型、状态或发布时间时不填写猜测值。`contentStatus` 保留源值（“未监控”不改为“未发布”）。
- 引用日期只写 `citedAt`；内容实际发布时间只写 `publishedAt`，不得由引用日期、采集时间、文件名、URL 或标题年份推导。日期支持有效 ISO 日期或时间，统计周期是导出声明范围，不代表期间每天完整采集。日期非法会返回未知并增加限制说明；不安全/非法 URL 返回 null。`mediaUrl` 的安全纯域名原值保留、不自动添加协议，以免误合并媒体分组。统计周期倒置、重复行 ID 或无效结构会使整视图不可用，避免给出错误统计。
- 原文件指纹由可信导入方对原文件字节计算并核对，禁止用任意 ID 代替。导入必须按 `sourceSha256` 防重：重复导入同一文件不叠加分母，原始行键也须稳定；同一 SHA 下行内容、范围或行业矛盾时服务返回 `invalid_data`，由运营修复。一个文件拆分到不同范围时，须由可信流程定义独立导出文件与新指纹，不能复用原文件 SHA 冒充两份独立数据。服务端没有原始文件访问权限，不声称再次验证了原文件哈希。
- `sourceFile` 应仅包含可公开的文件名，未知留 null，不存放私有本机路径。额外字段不会透传。字符串超长或错误结构不会静默裁切后冒充完整数据。

兼容模式：仅当 `source_distribution` 缺失时，可读取既有 `citations` 的 `data_kind: "detail"` 原始行；不展开 aggregate.count、不接纳 supplier_claim。逐行保留重复，`citation_url → url`、`source_name → mediaName`、`model/scope.model → model`、`question_text → question`、`cited_at → citedAt`、`published_at → publishedAt`、`media_url（缺失时仅用显式 domain）/media_type/content_status/source_sheet/source_row` 映射到对应字段；其他未声明的字段不猜测，`question_id` 不冒充问题全文、`collected_at` 不冒充引用日期。period 仅来自 dataset.scope.period。兼容批次 version/sourceSha256 为白名单记录视图的 SHA-256，sourceFile 为 null，并显式说明它不是原始文件哈希。推荐内核仍按自己的 answer_record_id、scope、身份与证据质量契约计算独立事件；本接口的行数只代表可查导出记录数，不能与内核可能为 null 的 `total_citations` 混称，也不能将分析记录自动变为有效 detail 或 aggregate 证据。

响应为 `{status,batches,message?}`：仅 `ready` 表示可消费批次；空库或没有可转换明细为 `configuration_required`，不把未知全局量写成 0。`invalid_data`、`data_limit_exceeded`、授权失败和服务不可用均不返回部分批次，不回退一航样本。当前全量响应上限为 200 个行业、200 个唯一批次、50,000 行、8 MiB JSON；超出上限时返回 `data_limit_exceeded` 和容量提示，请运营缩小可信导入范围。没有隐式分页/截断，前端不得把错误响应的空 batches 当成“0 条”。以后如增加分页，必须先实现同一数据版本全页拉取与完整性校验才能统计总量。迁移等技术信息只以固定诊断码进入服务日志，不把 SQL、dataset、租户或项目 ID 写进日志/业务常驻提示。

## 快照与任务

通过校验的完整矩阵结果（包括完整 scope.input_snapshot）在事务内按 tenant/plan_id/plan_version 归档；前端只能提供版本键，不能提供或改写 snapshot。预算复用时重新读取同租户行业配置，重算版本和硬条件，再应用原决定。仅预算/报价变化可复用；配置品牌、任务/证据/媒体属性/预检变化返回 stale_matrix。catalog 位置引用按原 resource_id 和整个非价格事实严格重新绑定。无任意 TTL；可信快照若携带 expires_at，过期边界按原内核规则检查。

报告下载可带成对的 `?plan_id=plan-<24位小写十六进制>&plan_version=plan-version-<24位小写十六进制>`；服务端仅从当前授权租户、当前 taskId 的可信归档快照读取对应 report，避免下载比当前所见更新的 latest。缺一项、格式错误、重复键或额外 query 键会拒绝；快照不存在、任务已取消或无 report 时返回不可用，不回退 latest。完全不带参数时保留既有 latest 下载兼容。下载继续采用原项目权限及 private/no-store，不改变发布流程。

matrix 阶段按用户显式时间处理，不自动填充证据时间；预算仍须显式 as_of。

生成接口先落真实 running 任务，返回 202 后在当前进程继续执行适配与校验；查询/取消由数据库约束保护，不使用本地文件存储。取消不承诺撤销已发生的模型调用费用，仅阻止接纳结果。没有自动重试模型/收费操作。当前不是持久队列：进程重启中断的 running 任务需取消并重新生成；如主仓有通用执行器，可将相同适配调用转移至执行器而保留仓储与校验。

## 移植差异与限制

- 所有内部金额用 bigint，公共 *_minor 用整数**字符串**而不是 Python 任意精度整数，避免 JS JSON 精度损失；主单位固定小数字符串保持原约定。版本 digest 使用仓库 stableJson，不承诺与 Python 字节哈希一致，但同可信输入确定、任务 plan_id 稳定。
- TypeScript JSON 目录/证据扩展字段采用 Row 字典；已知结构做边界校验，未知字段不解释为可信推断。金额、身份与模型决定有独立白名单。
- 五层可以为空；未判断候选保留原事实；最多三种不同组合。预算/预检/执行建议独立。未知附加费、混合币种、报价过期、套餐成员不全不能变成完整可执行价格。
- 不做统计有效性验证、汇总对账、未来引用概率、自动预算优化、购物车或发稿。minimum_known_cost 只证明唯一候选/唯一完整单价报价/已声明发布项的有限范围。

测试文件覆盖金额、证据分组、身份、角色/模型字段、报价、范围价、套餐、双预算、锁定、快照复用与版本等关键回归。测试源码已提供但本轮未执行；并非宣称完整 Python 测试集逐例等价或运行通过。

## 2026-10-25 修订：两类数据链与真实模型适配器

- **行业分布链**：GET /source-distribution 保持唯一上游（运营维护 dataset.source_distribution.batches），前端图2三筛选（行业/模型/日期复合下拉，弹层按日/按周/按月，周期由数据引用日期归纳、按周为周一至周日本地规则），三张总量卡删除；失败/空不回退任何样本。
- **品牌样本链（推荐输入）**：module/server/source-matrix/brand-data.ts 从 module/shared? 否——从 module/client/.../yihang-data.json（离线转换产物，含指纹/行号）读取批次；generate 接受 brand_data（批次 id）+ sample_platforms（模型过滤，保留原值四项）+ hours + requirements（图片/表格/链接 → task.requirements.images/tables/links），映射为 planner citations（data_kind=detail、缺 answer_record_id → 契约记 incomplete 观察，不冒充有效 detail/回答ID）；task.brand 持久化批次与平台，budget 阶段重建同一 citations。/industries 响应新增 brand_data_batches（id/label/version/sourceFile/recordCount/period/models）。
- **真实模型适配器**：decisions.ts 的 createEnvDecisionAdapter(core.environment) —— 服务端环境变量 FRONTMIND_SOURCE_MATRIX_LLM_API_KEY（必需）、_BASE_URL（默认 bigmodel chat completions）、_MODEL（默认 glm-4.6），OpenAI 兼容 json_object 输出；宿主注入 core.sourceMatrixDecisions 优先。无密钥→needs_ai_decisions（不模拟）。模型输出一律经内核 validateDecisions/verifyPlan 复核。
- 客户端：删除模拟模式开关与“尚未分层的样本来源”区（未决定候选不再渲染，追溯在推荐理由内）；投放要求恢复时效/素材/平台/品牌批次字段并实际入 schema；一次点击“生成推荐矩阵”串两阶段（水合渲染后自动按当前预算生成组合）；演示预算默认 CNY 3000（标注示例、可改）。

## 当前 UI 与业务交接边界（2026-10-24，ZCode 合并轮更新）

- 新页面复用上述真实服务和两阶段内核，未调用 Python，也未改动矩阵/预算算法。预算运行中的202响应是尚未归档的预处理结果，前端保留先前可复用快照，仅在当前条件一致且任务终态返回后采用新plan版本。
- **稿件可信绑定已接入**：`matrix/generate` 额外接受可选 `draft_id`/`article_version_id`（UUID）。服务端在 core.context 授权的 businessOwner + enterpriseProject 范围内重读 publisher_drafts/publisher_article_versions/publisher_articles（原生 SQL，见 binding.ts），核对草稿与冻结版本归属后，以服务端核验的 manuscripts（article_id + vN + contentHash + 标题 + 含图）和当前草稿已选项（非锁定 selected_items）替换 dataset 配置稿；绑定指纹（版本内容、草稿与已选集合）写入 task.binding 并随快照归档，GET /classify/:taskId 可见。`budget` 与 `apply-plan` 重新加载绑定并比对指纹，稿件/版本/草稿变化返回 409 stale_binding，不静默沿用旧矩阵。无绑定输入时保持原 dataset 行为（研究模式）。
- **组合应用已接入**：`POST /classify/:taskId/apply-plan`（body：plan_id、plan_version、plan_index、draft_id、article_version_id、expected_revision、preview）。服务端从归档快照取组合（不接受客户端成员/价格），校验 plan 可应用（budget_feasible 且无未知费用/错误）、绑定一致，逐项解析到真实媒体目录（active + 有效报价），复用图片规则（publisherImageCompatibilityBlocker + mediaRulesImageBlocker）与稿件版本身份校验；preview=true 只返回差异（新增/已选保留/暂不加入原因/合并数量与已知费用），preview=false 在单事务内 FOR UPDATE 锁草稿、按 expected_revision 比较写入新增 publisher_draft_items（报价/规格/数量/组合身份保存在 mediaSnapshot.publication 命名空间，未加列、未改 vendor 契约），既有行原样保留。超 20 家、版本不符、数量≠1、未映射/停用/无报价一律跳过或拒绝并说明原因；revision 冲突返回 409 由前端刷新重试。加入组合不等于发稿：仍走现有重新报价、标题配置与预检。
- 前端 `SourceMatrixPage` 生成矩阵时自动携带当前草稿/版本标识；应用组合前强制先取服务端预览，用户确认后写入并以 gateway.getDraft 回读统一购物车；手选、标题与锁定项不受影响。旧 mediaIds 保存链路保持不变，兼容既有草稿。
- 本轮未执行运行验证，交由智谱 ZCode 和网站验收；服务可用性、真实模型注入、数据库迁移状态、保存刷新与发布预检均未在线验证。
