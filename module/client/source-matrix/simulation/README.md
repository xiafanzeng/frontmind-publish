# 信源矩阵模拟模式

基线：`ed93e6443c71bafc02d89dac3ae61a518c7859de`。只提供离线演示，不上传模拟输入、草稿、购物车或订单。

## 实际入口与边界

- `SourceMatrixPage.tsx` 是模式边界。正式环境缺省为真实模式；`?simulation=1` 开启模拟，`?simulation=0` 强制真实模式。切换清除 task/draftId/matrixTask 查询参数，卸载原模式组件。
- `standalone/App.tsx` 仅通过 `SourceMatrixPreviewContext` 在 `preview=true`（原有开发预览入口）时默认开启模拟。不改动其它页面和 gateway。生产 standalone 仍保留原工作区门禁；无服务端的离线使用指 standalone 开发预览，不绕过生产身份校验。
- 模拟矩阵/分析/行业/报告四个路由通过 simulation 参数保留模式。模拟页面不使用 gateway、matrixApi、购物车、服务端规则查询、模型或数据库。`MediaShell`、`Property`、`RowHead`、`Plan` 是已有的呈现组件；`Plan simulation` 分支移除真实选入入口。
- 仅保存工作区隔离的 sessionStorage 输入配置与已应用预算，不保存或信任计算输出。重新进入页面时，以固定种子与固定 as_of 重新执行两阶段内核。浏览器禁止存储时显示提示，当前页仍可计算。

## 浏览器内核入口

不能直接运行服务端 `common.ts`，因为其哈希工具引用 `node:crypto`。因此在允许的 client 范围增加 `simulation/kernel/`：

- `contracts/evidence/matrix/budget/planner.ts` 从准确基线逐字复制；算法、白名单、保守分支和金额运算不变。
- `common.ts` 只将 `../domain/hash.js` 导入改为 `./hash.js`。
- `hash.ts` 保留基线的 `stableJson`；提供同步 UTF-8 SHA-256 浏览器实现，供同一 digest 契约使用。不加依赖、不改 Vite、不修改 server 任何文件。
- `kernel/ORIGIN.json` 记录来源与 SHA-256。以后升级服务端内核时必须重新同步这些镜像，不能分别修改计算规则。
- 对外入口 `pipeline.ts` 调用该镜像的 `runPlanner`。`simulation.test.ts` 提供浏览器哈希与 node 哈希、完整两阶段输出与服务端 runPlanner 的对照用例，本轮没有执行。

## 数据与决策

固定种子 `0x5eed2026`，固定评估时间 `2026-10-21T08:00:00Z`。224 家媒体、7 个虚构行业；每个行业 32 家中有 5 家边角输入，共 35 家（约 15.6%）。冲突资源额外产生报价行，所以 catalog 行数大于媒体数。观察证据还可能产生仅研究候选，所以内核候选数也可能大于媒体数。

字段包含行业、平台、地区、报价、CNY/USD/EUR/JPY、单篇/区间/完整双稿套餐、附加费用、时效、素材能力、收录描述、权重、虚构案例 URL、粉丝和认证属性。`.invalid` 地址不指向真实媒体。明细 usage=detail_evidence，行业汇总 usage=industry_context，供应商声明 usage=supplier_claim；实际分类和用途限制由内核依据 data_kind/source_type/applicability 检验，不依赖 usage 文案推断。

模拟稿件及其预检记录是模拟输入，不表示系统实际对真实文章做过预检。标题/正文/图片的“明确不限”保留在输入属性中供观察；不扩展原内核的规则解释能力。支持的需求通过原 requirements 契约进入内核；时效先生成带实际值和阈值的模拟 hard_conditions，再由原内核保守汇总。

`decisions.ts` 显式定义白名单决策类型。内容按行业匹配、身份明确的明细数量、模拟认证属性排序；不使用价格决定内容层级。地域层仅在声明局部地区且覆盖属性明确时出现。补充与探索字段遵守原契约。预算按行业、证据、偏好和内核报价试算提出组合，所有金额均用内核 parseMoney/priceItems/verifyPlan，不使用浮点金额结论。

最多提出三种组合：经济适配、内容覆盖、边界观察。最后一种明确是含异常输入的诊断提案，不冒充可行组合；其它提案也可能因低预算或硬条件失败而不可执行。内核会去重、计价和作最终判断，不强行凑足三套。启发式不声称求出全局最优。

来源标记存放在外层 simulation 与导出的 decisions.source=simulated。不会把 source 字段塞进内核严格白名单造成 invalid_decisions。内核结果与 report 保持原样。

## 报告与金额语义

模拟报告使用同一 `runPlanner` 产生的 report/result 排版成五节：任务范围、证据分析、矩阵与硬条件、双预算组合、最低已知费用与限制。持久横幅、页面水印、打印水印和 JSON 外层标记均保留模拟身份。没有加入真实购物车、配置订单或提交发布的入口。

预算可行、稿件状态、execution_recommended、估算、未知费用分别展示；混合币种不合并为虚构总价。最低已知费用直接展示原内核的有限范围证明。本模拟有多个候选，因此常见结论为 unproven；不会硬编码一个“最低价”。

## 验证状态

本轮仅源码阅读、差异/指纹核对及打包。没有安装依赖、执行生成器或应用、运行类型检查、测试、构建、浏览器验证或线上 API。测试源码仅供 ZCode 后续执行，不代表已通过。
