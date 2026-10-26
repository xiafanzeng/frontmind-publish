# 证据与身份接口

纯字典离线接口：`analyze_evidence(records: list[dict], scope: dict, identity_config: dict) -> dict`，`match_identity(source: dict, resource: dict, identity_config: dict) -> dict`。输入不修改，不获取网络数据。

明细 `data_kind=detail`；统计键由 tenant_id/question_id/platform/model/model_version/period、answer_record_id 和规范 URL 组成。字段可位于记录或记录的 scope；缺少范围字段不得借用调用范围补成精确事实。调用 scope 中明确不符的范围排除并保留 excluded_records。不同模型、问题、周期绝不共用去重键。

输出 `detail_citations` 保存去重条目，条目包含 scope、normalized_url、domain、record 原记录、全部 evidence_ids；`groups` 保存分组及 known_detail_count。`actual_sources` 为域名上卷及已知但字段不完整的信源，包含 count/share/evidence_ids/citations。known_detail_count 是可识别明细数，total_citations 仅在存在完整明细且没有未知记录时返回整数；否则 null。无明细为 no_detail_data，缺字段为 incomplete。share 分母为当前全范围有效明细，局部展示不可重算；明细不完整时为 null。

`unknown_records` 保留原记录；`external_aggregates` 保留汇总原口径、单位和有效 0，不参与明细总数；`supplier_claims` 不视为观察引用；data_quality 标记精确统计与对账状态。未实现外部汇总对账，不输出混合比例。

URL 只移除配置 tracking_parameters 中明确确认的参数，语义参数、路径与片段保留。不删除名称前缀。没有公共后缀数据库时不猜根域：platform_domains 仅提供明确的平台关联；independent_domains 为明确独立域名。confirmed_account_mappings 条目要求 account_id/resource_id/domain；confirmed_aliases 要求 domain/names。账号映射、同内容 URL、无域冲突的规范名称或确认别名、独立域、平台关联依次判断；域冲突待核验。同门户不证明某供应商账号。身份接口输出 relation（exact/platform_related/unverified/none）与 evidence_ids；供应商声明与汇总返回 none。

采样 collected_at 与内容 published_at 分别保存，不互相填充。默认内容年龄区间为 0–7、8–30、31–365、366–1095、1096+ 天；缺周期结束日时 content_age.buckets=null/status=missing_period_end；可显式提供 scope.content_age_intervals=[{label,min_days,max_days}]（闭区间，max_days=null 表示无上限），以 scope.period.end 为基准计算 published_at 日期差；未知日期、未来日期和重叠区间无法单独归类时计 unknown_count。不自行创造区间或发布时间。

## 评审修订后的形状（优先于上文旧域名上卷描述）

actual_sources 现在是按完整 scope + 观察身份（source_name/account_id/channel_id/source_identity/domain）分开的行；records 保存该身份全部原记录。不同账号或名称共享域名仍是不同信源。detail_citations 中 records 保留同回答/同URL全部原始行，identity_variants 保存身份差异，差异时 status=identity_conflict，不能自动升级具体媒体。所有 evidence_ids 原样关联，不用后来的记录覆盖前者。缺字段记录也出现在 actual_sources，不只留在 unknown_records。

domain_rollups 明确另列，每行有完整 scope，count/share 只在自己的范围分母可确认时计算。groups 同样包含 scope、citations、unknown_records、total_citations、known_detail_count。顶层 total_citations 只有一个范围组且完整时为精确值；跨范围合计仅 combined_summary.total_citations/known_detail_count，share 永远 null。身份行 share 可能因同内容的身份争议有重叠，不能相加为总数。

match_identity 先检查冲突与确认账号映射，再检查可确认内容与身份、规范名称/别名、独立域、平台关联。资源指定的账号/频道必须在观察中已确认；相同 URL 不能为缺账号或媒体名称的信源补出该身份。确认平台根域从用户附件列出的门户种子维护；baijiahao.baidu.com 只提供该子平台关联，baidu.com 不在配置中。没有通用公共后缀推断。

content_age.pending 为 {reason,evidence_ids,published_at_values} 列表。缺日期、非法格式、未来日期、多来源发布时间冲突、区间不唯一分别标明 missing_publication_date/invalid_publication_date/future_publication_date/conflicting_publication_dates/invalid_interval_assignment。接受严格 ISO 日期或 ISO T 时间戳，不截取非法字符串前十位。缺周期基准/非法周期基准分别 missing_period_end/invalid_period_end，分布 null。

具体 source_identity 与账号/频道相同：资源声明而观察未提供时，内容URL、名称或独立域均不得升为 exact。两个名称不一致须有相同域名下的 confirmed_aliases，内容URL相等也不能跳过名称确认。已确认 account_id → resource_id/domain 映射仍作为可审计资源身份依据优先使用；显式 source_identity 冲突保持 unverified。


## 独立行业汇总引用契约

`citations[]` 的行业汇总使用 `data_kind="aggregate"`、`source_type="external_data"`，另有非空字符串 `aggregate_id`、`source_id`（数据来源标识）、`data_version`、`unit`，原始 `scope`（至少明确 `industry`，其他原有问题/平台/模型/周期等原样保留），以及 `applicability={kind:"industry_context",industry:"任务行业"}`。`count` 为原单位下有限数值，0保留为0；只有正值可用作本接口的正向行业推荐依据。缺字段、负值、零值及未知值仍可独立展示，但不进入可引用 aggregate_ids。不得补造URL、文章、样本量或占比。

显式行业背景保留自己的问题/模型/周期，不按当前品牌测试scope改写；仍遵守调用scope明确的tenant边界。汇总scope.industry、applicability.industry与task.industry须一致。只有可信适配器明确提供行业背景时可走此路径；没有applicability不得自动猜成行业数据。supplier_claim优先分到supplier_claims，即使声明aggregate也不能成为可用外部观察。external_aggregates中重复aggregate_id不能直接引用。

候选 `aggregate_matches=[{aggregate_id,identity_relation:"exact",applicability:"industry_context",record:原汇总记录,detail_status:"汇总来源，暂无逐条证据"}]` 及 `aggregate_ids` 独立于 evidence_relation/evidence_ids/identity_matches。只在既有身份规则可确认该媒体，且没有目录身份冲突时关联；域名、账号、名称/source_identity冲突规则不放宽。明细 matcher 对aggregate仍返回none，内部只使用其已提供身份字段作独立身份映射，不把汇总送入计数。

当前aggregate引用仅支持行业背景；不支持把它直接声明为当前q1/品牌测试观察。matched_questions仍是AI的语义适配判断，不能表示统计命中。如要表达品牌/问题的逐条观察，需真实detail及其范围。未做行业统计有效性、来源真实性或线上接入验证。
