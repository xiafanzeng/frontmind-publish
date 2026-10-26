# Excel 导出研究契约

## 输入边界
`read_export(path)` 支持 xlsx。按首 20 行表头识别：引用日期、模型、监控问题、内容标题、内容链接/内容URL、媒体名称、媒体url/媒体URL。顺序与 sheet 名可变。原始单元格保存在 raw；公式只保留文本不执行。多个明细 sheet 有歧义时报错，不静默混合范围。媒体/内容统计分开保留，字段说明不作为统计。

模型筛选按原表 model 字符串，不把媒体域名当 AI 平台，也不从手机版/网页版猜版本。URL 原值不裁参；同域不同媒体名不合并，桌面/移动域不自动映射同一可售账号。外部数据中的名称不等于身份认证。

## 投放要求 brief
品牌/产品→brand_product；目标行业→target_industry；覆盖地区→regions；目标受众→audience；期望发布时效（小时）→expected_publish_hours；素材能力要求→material_requirement；目标问题（逐行）→target_questions；引用样本平台选择→sample_models（原表模型值集合，null 表示全部）。样本文件由 --xlsx 决定。budget 独立。assumptions 记录演示设定的字段与原因。

空地区为 null，不是全国。空时效/素材为未知/未限定，不证明渠道有能力。截图的 Test.docx 已确认 v2 是示意，不是附件中真实稿件，不生成 article_id/version。文件标签只作显示名；监控问题不是用户正式投放目标，演示授权后可明确用作演示问题。

## 观察指标
raw_rows 是非空明细行数。distinct_export_rows 是七字段不同组合数。extra_identical_rows=raw_rows-distinct_export_rows，只描述表格重复；不删除原记录。unique_urls 是内容链接原字符串去重数，不代表独立文章身份或独立回答。exact_citation_count 恒为 null，因为这个导出格式没有 answer_record_id。相同 URL 的 http/https、参数差异保留。raw_rows 为 null 表示无明细表；真实空表或筛选无记录才是 0。

reconciliation 只核对两个汇总次数总和与原明细行数。matched_totals_only 只说明总和相同，不证明逐项对账、完整采样或来源真实性。按模型筛选后原汇总不可比较，状态 not_comparable_filtered。汇总日期区间与明细日期原样分列，不把引用日期当 published_at/collected_at。

## 模型决定
研究决定格式为 {input_version, items, drafts}。items 每项：candidate_key、primary_role、matched_questions（目标问题原文数组）、reason、content_direction、references（真实 locator_key 数组）。可选 media_intro（一句话媒体介绍，新生成候选应提供）、disposition=consider/reference_only/hold、caution、verification_items。media_intro如提供须为非空文本，与content_direction独立；旧输入可缺省。supplement 须 supplemental_to=[已判断核心 candidate_key]、supplemental_value；exploration 须 exploration_hypothesis、verification_items。regional 须明确地区与覆盖待核验项；研究角色不代表已通过地域硬条件。

引用媒体汇总时只能解释原汇总范围，不编当前问题/模型逐条命中；aggregate_only 的 candidates 从媒体汇总行产生。只有内容汇总时，从其媒体名+域名分组保留原汇总合计作为有限候选；明细行数与精确引用未知，不把内容统计改成行业数据。输入缺失或没有判断时保留研究概览。

drafts 每项包含 name、reason、candidate_keys、content_direction；新生成的方案还必须有 explanation：

- objective：方案目标文本。
- selection_logic：非空文本数组，解释组合为何成立及与其他组合的区别。
- content_allocation：逐一覆盖全部已选候选，每项只有 candidate_key、responsibility、content_angle。只解释本组合已选候选，不增加媒体。
- tradeoffs：非空文本数组，说明覆盖、表达、资源准备等取舍；不虚构效果或费用。
- excluded_candidates：数组，可为空；每项只有candidate_key、reason，须为已判断且未纳入本组合的不同候选。
- fit_conditions：非空文本数组，适用人群与材料前提。
- verification_items：非空文本数组，执行前须核验的账号、报价、素材、稿件、时效等。

脚本验证 explanation 的类型、字段白名单和候选归属。兼容旧输入缺少explanation时，explanation_status=needs_explanation；新生成结果须为complete。旧输入不能在界面被伪装成已有详尽解释。脚本限制最多三套、不同候选集、候选均已判断，不接受金额/就绪状态。内容分工是建议，数量和采购未确认；不能称完整媒体矩阵覆盖或最优方案。

`research_matrix(analysis, brief, decisions=None)` 返回 export-research/1.0。关键字段：observation、matrix、research_drafts、input_version、brief、limitations、errors。status 为 needs_requirements / needs_semantic_decisions / empty_selection / stale_decisions / invalid_decisions / research_draft。input_version 绑定文件哈希、规范投放要求、模型筛选；预算及 assumptions 展示元数据不参与语义版本。

每项 channel_status=research_only、resource_id/offer_id=null、identity_relation=unverified。budget_plans 始终空；费用、预算可行与正式可发布状态为 null。原 planner 的输入/预算规则不修改。

## 交付
默认页面是完整展开的投放要求 + 单个“信源矩阵推荐”板块。桌面左侧是五角色固定五行矩阵，层名在左、同层媒体横向放在右；带独立理由入口的组合草案保持在右侧。无候选仍保留对应层空行。

不显示样本范围横条、指标卡、案例总结补充横条及信源观察/输入核验子板块；保留底层数据和按需回查。HTML支持案例切换、样本模型筛选、媒体理由与样本弹窗、方案完整解释弹窗、导出当前快照；编辑语义需求后旧建议隐藏并要求新判断。无需网络可打开，不表示网站已集成或运行了线上模型。


### 紧凑展示补充（2026-10-26）
投放要求始终完整展开，切换案例和提交结果均不折叠。媒体卡片头部同一行：左为名称，右为“查看推荐理由”；下方显示域名与一句媒体介绍（可以自然换行），不显示黄色选取/待确认标签。完整名称、内容、状态及待核验信息保留在详情和JSON。

五层一次看全适用于矩阵区域：滚动到结果标题时，参考1280×720、1366×768、1440×900应同时看到五层；允许用户自然滚动经过上方完整表单。提交后滚动并聚焦结果标题。矩阵的纵向高度适配桌面视口，五行均匀分配上下空间，媒体卡片留出适度纵向余量；保持左矩阵、右组合的排布，不因调整高度改变左右宽度或把组合移到下方。高度约束只作用于矩阵表格，短屏和窄屏恢复自然高度。不要隐藏层级或真实候选、锁定页面高度、遮挡内容或依赖极小字号。同层候选超出可用宽度可横向滚动，手机和放大场景使用自然滚动。输入和理由详情仍保留原有状态与证据边界。

### 媒体说明与层级帮助
reason保持字符串，建议用空行分成两段，说明已知样本主题、目标问题关联与角色分工。content_direction同为字符串，建议用空行分段，展开拟定主题、读者问题、内容结构、材料和内容衔接；它是编辑建议，不代表新增能力事实。verification_items承接具体账号、资源、资质、效果和报价等缺口；caution与研究状态也显示在“需要核验”内。媒体详情先显示适配理由与内容方向，再显示探索假设（如有）、需要核验和附件样本。不要把负面限制写进适配理由后又在核验区重复。

五层问号说明由预览的ROLE_HELP统一维护，包含purpose、sources、usage三项，分别对应用途、适合内容和使用方式。帮助属于层级释义，不替代逐媒体判断。悬停、聚焦与点击均可打开，Esc/外部点击关闭，浮层保持视口内；桌面左右双栏与矩阵高度规则继续有效。

矩阵卡片读取media_intro，介绍来源类型或内容领域；content_direction只用于推荐理由详情，保留完整编辑建议。旧数据缺少media_intro时显示中性的来源说明，不使用content_direction作为回退。

### 同层排序与展示
研究items新增可选layer_rank（正整数）与ranking_reason（非空文本）。使用任一排序字段后，整组已判断项必须同时提供两字段；每层序号从1连续到本层项数，不接受重复、缺号、布尔值或自动综合分。旧输入完全不含排序字段时仍按原决定顺序兼容。该接口只用于export_research，不修改原结构化网站matrix_decisions的fit_order契约。

排序由本轮语义判断给出，脚本校验范围和序号，预览按序展示前三个非hold候选。更多候选可展开，仍在同层横向排布；模型筛选保留原排序、只显示有样本的候选，不能补造新判断。切换案例或模型范围后收起更多候选。详情显示本层序号与ranking_reason，并有共用的“查看排序依据”入口。扩充研究池时允许账号、报价、合作条件待核验，价格与导出次数不能直接控制顺序；已知硬失败不放宽。地域候选须关联明确目标地区及样本场景，实际覆盖仍待核验，不代替可信地域硬条件。

实际实验的ranking_policy记录本轮方法、五个比较维度、观察分组数与已判断候选数；未判断分组继续保留在observation，不进入已完成排序的统计。
