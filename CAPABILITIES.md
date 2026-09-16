# 媒体发布：能力与验收记录

## 记录基线

- 模块：`publish`。
- 审阅的业务源码：[`257387648c7491f47e7b2e147a36547bef7b11f0`](https://github.com/xiafanzeng/frontmind-publish/tree/257387648c7491f47e7b2e147a36547bef7b11f0)。
- 整理日期：2026-09-16。本清单记录已执行检查与仍待补充的验收。
- 开发域名：[publish.frontmind.cn](https://publish.frontmind.cn)。实际运行版本以 `/api/version` 的 `moduleSha` 和 `coreSha` 为准。

“源码已包含”“本地检查通过”“真实业务验收通过”分别记录，不能互相替代。文档合并不会更新正在运行的镜像。

## 能力清单

| 能力 | 源码能力 | 主要源码 | 本地验证 | 真实业务验收 |
|---|---|---|---|---|
| 稿件工作台 | 已包含：稿件列表、粘贴/导入、富文本编辑、保存、版本和冻结稿件业务。 | `module/client/pages/`；`module/client/components/TipTapArticleEditor.tsx`；`module/server/routes.ts`；`module/server/publisher-repository.ts` | 见下方本地检查；不据此推定真实业务通过。 | 真实 API 创建草稿、UI 正文编辑和保存后刷新通过；UI 新建、DOCX/图片导入待单独验收。 |
| 媒体目录与选择 | 已包含：媒体目录、筛选、候选清单、稿件和媒体选择草稿。 | `module/client/pages/MediaLibraryPage.tsx`；`module/client/mediaShortlist.ts`；`module/server/publisher-repository.ts` | 见下方本地检查；不据此推定真实业务通过。 | 真实目录来源、筛选和选择保存待验收；合成媒体不能当作供应商可用媒体。 |
| 报价与下单前检查 | 已包含：媒体报价、稿件规范检查、预检、订单/批次创建、业务金额和状态规则。 | `module/server/domain/preflight.ts`；`module/server/domain/money.ts`；`module/server/routes.ts`；`module/server/publisher-repository.ts` | 见下方本地检查；不据此推定真实业务通过。 | 真实报价和预检待验收；付费订单与真实提交均未执行。 |
| 发布队列与供应商结果 | 已包含：发布 worker、提交/同步/结果处理、错误和状态机、发布结果持久化。 | `module/worker/engine.ts`；`module/worker/processor.ts`；`module/server/publisher-worker-repository.ts`；`module/server/domain/state-machine.ts` | 见下方本地检查；不据此推定真实业务通过。 | 真实媒体外发、付费、回调/同步和失败重试均未验收；需要供应商配置及指定测试目标和额度。 |
| 订单和结果页面 | 已包含：发布列表、批次/条目详情、状态和发布链接呈现。 | `module/client/pages/PublicationsPage.tsx`；`module/client/pages/PublicationDetailPage.tsx`；`module/server/routes.ts` | 见下方本地检查；不据此推定真实业务通过。 | 真实订单及供应商结果页面待验收；列表能打开不代表外发完成。 |

## 已完成的本地检查

名称修改基线完成 frozen install、typecheck、4 个 Vitest 文件 / 20 项测试和完整 build，覆盖发布上下文、编辑器内容、媒体候选和查询状态。独立壳样式作用域修复完成 frozen install、typecheck 和完整 build。

本轮修改包均经过 delivery skill 的路径检查、准确基线候选和隔离三方合并，没有未解决冲突。以上测试使用本地或合成场景，不产生真实供应商任务。

## 开发域名实际验收记录

| 范围 | 已有证据与待完成项 |
|---|---|
| 目标版本页面 | 目标 moduleSha 的首页、稿件、媒体目录、发布页、深链和刷新已通过。已查看真实页面截图，独立壳样式恢复，无名称测试后缀、预览标记或浏览器错误。 |
| 普通保存与刷新 | 在真实测试域名通过 API 创建合成草稿，再由 UI 编辑正文、自动保存、刷新验证持久化。该记录没有冻结或发稿；不等于已验证 UI 新建全部流程、DOCX 或图片导入。 |
| 供应商流程 | 媒体目录当前为空，真实目录、报价、预检、付费下单、媒体外发、回调同步和失败重试均未验收。 |

后续部署应重新记录实际两个 SHA，并对变更交互复验。停用的 worker 不记为任务执行通过；旧版本结果不直接作为新镜像验收。公开文档只记录检查结论，不包含账号凭据、私有路径、业务记录正文或运行数据。

## 仍保留的能力边界

媒体目录为空不等于供应商已接通；稿件编辑保存通过不证明报价、订单、扣款或外发通过。

## 运行与公开范围

`module/` 包含公开业务源码、业务依赖和所属工作流，`standalone/` 包含独立壳与合成预览，`vendor/` 由主仓维护并按版本下发。`pnpm dev` 明确显示“本地预览”，不连接真实测试数据库或付费供应商。真实持久化、后台任务、授权文件和供应商连接由私有 Core 运行入口提供。

开发域名进入固定测试工作区；子仓不实现产品登录、成员、租户或通用智能体。主仓注入真实用户和工作区上下文，并按需提供跨模块入口。独立模块保留自己的输入流程。

普通 ZIP 导入、CI 和页面检查不触发付费生成、监控采集、媒体外发或客户域名发布。没有供应商配置、指定测试目标或额度时，明确记录未配置或未执行；不以合成预览替代真实验收。

## 下一轮修改

先让 `frontmind-module-delivery` 读取开发域名 `/api/version` 并导出精确线上源码、完整 SHA 和交接模板。`main` 可能含尚未上线的文档或代码，不能直接当线上基线。

Pro 按 [PRO_GUIDE.md](https://github.com/xiafanzeng/frontmind-publish/blob/main/PRO_GUIDE.md) 返回 ZIP 后，delivery skill 在隔离工作树中合并、验证并部署指定子域名。验收后使用 `frontmind-module-sync` 合回业务源码；独立壳、预览数据和开发门禁不回灌主仓。源码同步不自动部署生产 Dashboard。
