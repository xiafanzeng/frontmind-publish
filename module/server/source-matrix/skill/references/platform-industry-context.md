# 网站平台 AI 与真实行业快照（2026.11.07-web.2）

本文件是网站原生 TypeScript 路径的增补契约；与 instructions.ts 的 SOURCE_MATRIX_INSTRUCTIONS 及 decisions.ts 的 decisionRules/budgetRules 同步。离线 Python 接口保留原有输入能力，不自行获取行业数据，也不自动获得网站新增的全行业引用校验能力。

## 平台调用和稿件

网站 matrix、budget、稿件四字段 identify 统一由后台环境配置的平台模型执行。数据库个人连接、历史 model_source=user/host、core.sourceMatrixDecisions 均不能被选为模型适配器。旧个人连接表及数据保留，但不读取、不解密、不作为恢复条件；个人 models/test/save/remove 端点移除。GET /matrix/connection 仅返回 connection:null、mode:environment|none、available 和安全 message，不公开模型名、端点、密钥、个人连接或配置摘要。配置可用仅表示本地配置满足约束，不表示已测试调用成功。

平台端点固定为 https://api.xty.app/v1/chat/completions；可信服务端 BASE_URL 可写该域名根、/v1 或完整端点（可带尾斜杠），统一只形成一次完整路径。无 BASE_URL 时采用上述已指定平台端点；模型名必须由 FRONTMIND_SOURCE_MATRIX_LLM_MODEL 明确提供，没有默认模型。密钥仅从 FRONTMIND_SOURCE_MATRIX_LLM_API_KEY 读取。FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS 必须包含匹配的 XTY 根、/v1 或完整端点，matrix/budget 和 identify 都受 endpointFor 白名单约束。任何客户端文本、历史连接或研究资料不能提供服务地址或凭据。LLM 配置与 FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN 完全独立。

task.manuscripts 的 article_id/version、正文片段 content_excerpt、content_excerpt_truncated 和 content_source 来自服务端授权冻结版本；模型不能改写绑定。截断为 true 时只读了片段，必须如实限定，不声称已读全文。四字段识别继续读取完整授权正文、使用既有长度上限与 HMAC revision，并在模型响应后重新核验身份、稿件权限、冻结内容、行业选项和配置 revision。平台配置或密钥轮换会使旧识别失效；用户无需配置个人 API。

矩阵/预算请求上限为 240 秒，响应最多 2,000,000 字节；识别仍使用原有 45 秒和有界传输。禁跟随重定向；HTTP失败、超时、refusal/content_filter、不完整finish_reason、空内容、无效JSON和超限响应均不产生成功结果。矩阵仅接纳单个完整JSON对象（可带完整JSON围栏），再经确定性内核逐项校验。不得以失败回退到另一个模型、模拟决定或成功空数据。

## 行业快照输入

服务端从与行业分布板块同源的 molizhishu 免费 filters/distributions 构造 task.industry_context 并持久化。推荐链不新增 media-ranking/contents 计费调用。行业树 scopeId 可靠映射到当前任务行业；显式查询范围也须核对行业一致，不能映射时保留失败与限制，不降为全行业或用旧 dataset/品牌样本代替。

行业 dataset 中可由运营明确配置字符串 industry_source_scope_id。该可信映射必须指向供应商真实行业树中的唯一 ID，允许两边行业名称不同，但 provenance 同时保存本地名称与供应商名称；浏览器不能创建或覆盖映射。未配置时只接受唯一的精确同名节点，不做模糊猜测。未传显式查询时，使用 filters 返回的最新可用日及第一个真实模型，并标明默认选择；日期范围或模型信息不全时给出限制，不猜测。

快照包含 status、message、source、industry_id、industry_name、query、fetched_at、data_version、aggregates、limitations、source_type_distribution 和 publish_time_distribution。query 保存真实 scopeId/scopeType、periodType/date、modelCode；取数时间与供应商数据版本不能互相冒充。模型同时读取状态、口径、时间、完整记录与限制；失败、缺配置、映射失败、真实空分布分别如实说明，不把未知当0或空成功。

每个全行业统计记录包含 aggregate_id、source_id、data_version、unit、count（十进制整数字符串）、scope、applicability、aggregate_scope:"industry_distribution"、dimension、bucket。类型分布与发布时间分布的单位/分母各自保留，不能混加、转为浮点数或推算未给出的占比。真实count=0原样保留，可作宏观缺口/限制引用，但不能作为正向表现证明；旧每媒体身份匹配aggregate仍要求正count。统计桶不含具体媒体身份，不能从桶构造媒体、账号、资源、报价或采购候选。

## 两种 aggregate 关联

1. 每媒体汇总仍要求原有身份匹配与口径校验。候选 aggregate_ids 和 aggregate_matches（包含完整 record）只供该候选引用；账号、频道、域名、名称和 source_identity 的既有规则不放宽。
2. 全行业分布不通过单媒体身份匹配。服务端单独校验，全局允许ID集合只保存一次；全部候选均可引用共享task.industry_context.aggregates中的已核验ID作industry_context。prompt只在task中携带一份完整行业快照，不在120个候选中重复全局记录或全量ID；每媒体aggregate_matches仍随对应候选完整保留。prepared候选industry_aggregate_ids为空，结果候选该字段只保存该候选实际引用的全行业ID，不代表媒体身份。它只是共享的行业背景，不改变 evidence_relation、identity_matches、逐条引用分母或可售状态。

两者仅可输出 {type:"aggregate",aggregate_id:"真实ID",usage:"industry_context"}。必须读取被引用完整记录的来源、版本、单位、scope、applicability、dimension/bucket，不能只凭ID猜意义。task.industry_context 的任何attribute路径均不能引用，必须走aggregate校验，不得绕过引用边界。理由沿原口径说明“汇总来源，暂无逐条证据”。不把行业分布写成当前品牌或 matched_questions 的统计命中，不编造URL、answer_record_id、citation或账号引用。matched_questions仍是语义适配判断。

真实行业分布用于宏观五层组合、类型互补、内容时效及理由；具体媒体适配仍需该媒体真实非价格属性、当前问题与稿件内容。无地域或覆盖依据时地域层留空；不为填层造媒体。候选窗口最多120个，导入与现有候选交替且各组保留顺序；单候选原观察最多展示12行，不能声称读过未展示原行。没有进入窗口的候选保留在可信快照，但本轮未做语义决定。

## 版本、预算与验证边界

industry_context 与冻结稿件都属于 task，进入 matrix_version；切行业、周期、模型、查询范围或稿件版本需重新生成矩阵。预算阶段沿用该任务已保存行业快照，重读报价及既有授权绑定，不再次取行业数据，不因仅改预算、报价或数量重排适配顺序。历史缺少兼容快照的任务提示重新生成，不能以个人连接 revision 阻塞。

五层 authority/industry/regional/supplement/exploration、attribute/evidence/aggregate 三种引用、补充/探索要求、层内连续排序、矩阵先于预算、真实目录与报价分离、锁定项保留等规则不变。budget_plans 与 content_plans 合计最多三套有实质差异的组合。行业统计不能填充价格、购买身份、稿件数量、预算可行性或发布许可；未知费用不是0。总预算与包含于其中的探索子额度均由可信校验器核算；发布前继续重读绑定、报价与购物车核验。

本轮仅改源码与规则并做阅读自查；未运行Python脚本、测试、类型检查、构建、模型/行业API或发布流程。测试源码不构成通过证据，运行验收由后续集成阶段完成。
