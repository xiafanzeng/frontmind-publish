# 无预算矩阵与 AI 判断边界

`prepare_candidates(request: dict, analysis: dict) -> dict` 返回 matrix_version、完整 candidates 和 limitations。
`validate_decisions(decisions: dict, candidates: dict, request: dict) -> list[dict]` 返回 `{code,path,message}` 错误；第二参数是 prepare_candidates 的完整结果。
`assemble_matrix(request: dict, analysis: dict, decisions: dict) -> dict` 返回可信事实与已校验语义决定，不修改输入、不联网、不执行文档中的指令。

调用前先用 contracts.validate_request 校验 task；analysis 来自 evidence.analyze_evidence。目录与属性必须由网站可信适配器提供，不能从 AI 决定对象回填。缺 AI 决定时 status=needs_ai_decisions，matrix.fit_order=[]，不伪造语义推荐。校验失败时 status=invalid_decisions，保留完整候选与事实，但不接纳部分决定。

## 目录和稿件输入

catalog 是扁平列表，每行包含 resource_id（具体渠道）、offer_id（供应商报价）和媒体非价格属性。同 resource_id 生成唯一候选，多个 offer_id 保留为备选报价。只有 offer_id 而无 resource_id 的记录是 research_only，不能仅靠名称购买。多个供应商的非价格属性冲突进入 pending；任一明确硬条件失败仍是 ineligible。目录顺序不影响身份版本。

publication_status=available 表示渠道在售；unavailable/inactive/closed/not_for_sale/suspended 为不可用；缺失或其他值 pending。task.requirements 当前支持 formats（目录 supported_formats）、links/images/video/tables（目录 supports_links/supports_images/supports_video/supports_tables），另支持目录 allowed_industries、prohibited_industries、restricted_regions 和 hard_conditions=[{rule_id,status:pass|fail|pending}]。未知硬要求保留 pending。一般 industry/regions 属性用于语义适配；只有明示 allowed/prohibited/restricted 条件才作为硬限制。

`task.manuscripts` 是稿件列表，每项保留 article_id、version 及内容属性。不要求只一篇；只在显式提供 legacy task.manuscript 对象且没有非空 manuscripts 时才转成一篇。绝不凭空生成 article_id/version/篇数。

目录可提供可信的 `manuscript_checks=[{article_id,version,status:"pass"|"fail"|"pending",...}]`。候选输出逐稿 `manuscript_checks=[{article_id,version,status:"passed"|"failed"|"needs_manuscript_check",checks:[原记录]}]`。任一明确 fail 为 failed，全部明确 pass 为 passed，否则 needs_manuscript_check。没有稿件时独立标记 needs_manuscript_check；正文存在不等于已预检。channel_status 与 manuscript_status 分开。预算可行与正式发布可行也是独立结果：第二阶段可在稿件版本/数量明确、金额完整、渠道约束满足时核算预算，但需保留稿件待预检说明；已知稿件硬失败不得推荐该稿投放，不能因未人工预检而把已知价格改成未知。

## 候选可信字段

每项包含 candidate_id（resource:<resource_id> 或研究标识）、resource_id（可 null）、attributes、attribute_variants（多报价属性副本）、attribute_paths、offers（原报价列表）、channel_status、hard_failures、pending_conditions、manuscript_status、manuscripts、evidence_relation、identity_matches、evidence_ids、recommendation_basis。

channel_status 为 eligible / pending / ineligible / research_only。eligible 仅表示已知渠道硬条件满足，不承诺刊发或未来 AI 引用。offers 在候选适配事实构造后附带，报价不参与适配决定或排序；第二阶段必须重新验证报价、规格、币种、日期和费用，不可仅因 offers 非空就声称预算可行。

actual_sources 全集原样保存在 source_analysis。身份匹配由 evidence.match_identity 计算，exact/platform_related/unverified/none 不接受 AI 覆盖。证据引用必须同时属于当前候选匹配和 matched_questions 中的问题；不能用 q2 支撑仅 q1 的推荐。平台关联证据可解释平台联系，不能升级为具体账号被引用。外部汇总、供应商声明不是观察证据。无已知可售资源的行业推荐保留 research_only；明确 resource_id 的推荐才绑定该目录资源，原始依据保存在 recommendation_basis。

## AI 决定 JSON

以下仅为接口示例，理由不是内置推荐：

```json
{
  "items": [{
    "candidate_id": "resource:r1",
    "primary_role": "industry",
    "auxiliary_roles": [],
    "matched_questions": ["q1"],
    "references": [{"type":"attribute","path":"catalog[0].industry"}],
    "reason_summary": "明确说明企业与问题的适配关系",
    "reason_details": ["解释证据粒度、覆盖增量及条件取舍"],
    "unconfirmed_items": ["说明尚未确认的事实"],
    "selection": "recommended"
  }],
  "fit_order": ["resource:r1"]
}
```

references 另支持 `{"type":"evidence","evidence_id":"e1"}` 与下文独立aggregate类型。各类型只接受规定字段；attribute 路径必须真实存在且有值，属于当前候选对应目录/行业推荐行或 task。价格、预算和其他候选属性不可作为依据。无引用数据时仍可凭明确属性成为行业核心，不自动归探索层。可追溯校验只验证来源与作用范围，不替代人工/AI对文字推理的语义审阅。

严格字段白名单：AI 不得提交 channel_status、resource_id、offers、identity_matches、evidence_relation、金额或 score/probability 字段。理由由 AI 解释，不用关键词算法判断媒体类型，不输出综合评分或未来引用概率。fit_order 完整、不重复地列出本次已判断候选；未判断候选保留在快照但 selection=undecided。selection=recommended 或 alternative；备选不自动加入购物车。已判断候选不等于可购买，后续仍需校验可信状态。

五个主层：authority 权威参考、industry 行业核心、regional 地域覆盖、supplement 覆盖补充、exploration 探索验证。主层唯一；auxiliary_roles 不重复且不可重复主层；每个资源只存一行，层中仅引用 candidate_id。

regional 需要明确局部地域目标及目录 regions/region_coverage 匹配；缺地区不推断全国，显式 nationwide 不强凑地域层。supplement 还需非空 supplemental_value 与 supplemental_to=[核心候选ID]，所指候选本次主层须为 authority/industry/regional。exploration 还需非空 exploration_hypothesis 及 verification_items=[待验证事项]。辅助探索同样受此要求约束；假设完整保留供第二阶段识别探索用途。具体发布项 purpose 决定探索费用归属，不能通过修改主层逃避探索上限。

## 输出与版本

assemble_matrix 输出 schema_version、matrix_version、status、source_analysis、data_quality、scope、matrix、research_only、pending_items、limitations、errors 和空 budget_plans。matrix 包含 status/candidates/layers/fit_order/coverage_kind=semantic_relevance。layers 每层有 role、display_name、status（populated/empty）、candidate_ids、auxiliary_candidate_ids。候选补充通过校验的 AI 字段；无决定时 primary_role=null、auxiliary_roles=[]、selection=undecided、matched_questions=[]。

版本哈希包含任务目标/要求、完整证据分析、身份配置、行业推荐及目录非价格属性；剔除预算、已选项、文章数量、报价身份、供应商及明确计费/报价字段。媒体非价格属性变化生成新版本。仅修改预算、报价、报价有效期不改变 matrix_version；同样 AI 决定保持适配顺序。新增未知计费字段必须先由适配器映射成已声明字段并更新规则，不能直接混入媒体属性。第二阶段不得将新报价内容反写为新的语义适配顺序。

第一阶段不生成购物车动作、不计算总任务费用、不推断数量，不清空 selected_items。第二阶段只从此候选快照选择发布项，并以 article_id/version × resource_id × publication_spec × quantity，关联明确 offer_id 计价。

## 同资源多报价冲突合并

同一 resource_id 的 attributes 仅包含所有非价格属性副本中一致且存在的字段；不选首个供应商作为可信版本。attribute_variants 为去重并稳定排序的非价格属性，conflicting_attributes 明示值冲突或部分副本缺失的字段。硬失败与待确认条件也稳定排序。

身份字段冲突时，按各副本保留有来源关联的证据，但候选 evidence_relation/identity_matches 只能为 unverified，不能确认 exact 渠道；原实际信源继续独立保留。身份没有冲突时，其他属性冲突不会抹去已确认身份。地域字段冲突不得确认地域角色，指向冲突字段（包括整个冲突目录行）的 attribute 引用无效。交换同资源报价顺序不改变证据归属、身份关系或相同决定的校验结果。

报价专属 `publication_spec` 与 `allowed_purposes` 不属于媒体语义属性：从 attributes/attribute_variants、属性引用与 matrix_version 剔除，仅在原始 offers 中完整保留，第二阶段逐 offer 校验。这使同资源不同规格/用途报价可合法并存；不会因不同报价规格把渠道误判为属性冲突。supported_formats 等真实媒体能力仍是语义和硬条件字段。


## 行业汇总与执行建议接口补充

references新增 `{type:"aggregate",aggregate_id:"ag1",usage:"industry_context"}`，必须恰好这三个字段。aggregate_id必须位于当前候选aggregate_ids；缺适用性、身份、原scope/单位/来源/版本、非正值、重复ID或供应商声明均不可引用。完整契约见evidence-rules.md。理由应沿原单位原scope说明“汇总来源，暂无逐条证据”；不得把行业统计写成matched_questions中的当前品牌观察。可用原统计辅助语义适配，不改变evidence_relation或明细分母。

`semantic_decision_validated` 为脚本输出，不能由AI提交。仅当整组matrix_decisions通过校验，且候选有合法决定时为true。未判断候选保持undecided与false。预算项可显式选用recommended或alternative；execution_recommended还需该标记、非空matched_questions及发布预检就绪。锁定未判断项保留全部原发布信息、已知费用及预检状态，semantic_pending提示补齐矩阵，不自动删除或制造未知价格。
