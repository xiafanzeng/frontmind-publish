# 一航软件样本模式

当前改造基线：`c6eef05c0d6f78bcc4376aea74ab097a7864722f`。当前用户可见入口已替换为工作簿真实导出样本；不再执行固定种子的虚构媒体、行业、报价或浏览器推荐生成。

## 当前入口

- `SourceMatrixPage.tsx` 是模式边界。正式环境默认真实模式；`?simulation=1` 显示“一航软件样本”，`?simulation=0` 明确选择真实服务。standalone 原开发预览 context 仍可以默认打开样本；不绕过生产工作区授权。
- 两个页签是“行业信源分布”和“信源矩阵推荐”，默认分布。旧 analysis/industry 映射分布、matrix/report 映射推荐；切换页签保留 query/hash。模式切换沿用隔离策略，主动清理真实 task/draft/version/workbench 参数，避免样本参与真实业务。
- `SimulationPage.tsx` 不调用 gateway、matrixApi、模型或数据库，不产生真实采购。样本分布使用 `../industry/IndustryDistribution.tsx`，输入为 `../industry/yihang.ts` 的 `YIHANG_SOURCE_BATCH`；原文件、行号、字段映射和四张工作表在 `yihang-data.json` 中保留。
- 底部复用 `MediaCartFooter` 的实际测量定位，但使用 `researchNotice` 显示研究模式说明，不显示伪造的“真实购物车 0 家 / 0 元”。真实购物车保持不变，切回真实模式恢复查看；这不是第二份购物车或存储。

## 数据含义

原文件 `一航软件-信源分析-20260913-214944.xlsx`；SHA-256 为 `639e43735887ff20852f99aa4bc643853259dbd7f44aba163598064720a60e0d`。四表转换与重算方法见 `../industry/README.md`、`module/scripts/convert-source-distribution.py`。

原统计区间 2026-09-07 至 2026-09-13；明细 502 行、114 个内容 URL、61 个媒体名称＋媒体 URL 分组。明细只有 9月12日262行、9月13日240行。原重复行完整保留，既不是事件去重总量，也不是回答引用率。

文件缺标准行业、媒体类型、发布时间、回答 ID、模型版本、完整账号身份、可售资源、报价与规格。行业归未分类，类型与发布时间真实显示未知；不会把引用日期作为发布时间。未自动送入推荐内核的有效 detail/aggregate 证据计数。

推荐页先呈现五层结构及全部61个未分层研究来源，可搜索、分页、查看原始行；没有用引用次数机械分层。原行号只是追溯键，不是 answer_record_id。没有价格、采购按钮或假预算组合。右侧说明缺少真实目录、报价、稿件/版本和适配结论，生成组合不可用；真实推荐使用服务模式的两阶段入口。

## 历史回归夹具

`fixtures.ts`、`decisions.ts`、`pipeline.ts` 和 `kernel/` 等旧模拟文件保留供既有回归源码引用，当前 `SimulationPage` 不导入、不调用它们。它们的虚构媒体和价格不是当前页面数据，也不能作为真实证据。内核镜像的来源仍以 `kernel/ORIGIN.json` 为准，本轮没有修改镜像或宣称与当前服务运行等价。

## 验证状态

已执行离线 XLSX 解析与计数对账、源码阅读和增量包核对。新增/修改测试仅为源码。本轮未执行运行验证，交由智谱 ZCode 和网站验收。没有安装依赖、启动应用、运行类型检查/测试/构建或调用业务 API。
