# 信源规划界面约定

本轮为既有中文发布工作台增加产品页面，不重做品牌或外壳。依据：PRO_TASK.md 的矩阵、分析和 B_report 结构；现有 PublishingUi、publishing.tokens.css、publishing.core.css；新版设计附件只参考行业 chips、来源卡片、矩阵导航和分布布局，不采用其虚构数据和本地分配算法。

## Colors

使用既有运行时变量：白色 surface #fff，ink #202134，muted #77798d，line #e8e9f1，purple #3636e2，green #079553，gold #e9a900。颜色由原 tokens 拥有，本轮不改变。状态必须同时有文字，图例同时显示域名及数值。

## Typography

沿用 PublishingPage 的 Inter / PingFang SC / Microsoft YaHei / system-ui 字体。标题 19px，卡片标题 16px，正文 14px，辅助 12–13px。金额采用 tabular-nums；主单位字符串原样展示，不转浮点。

## Layout

复用 PublishingPage、Loading、Error、Empty；本轮 CSS 仅 .sm-*，不接触全局、侧栏、顶栏或原业务页。桌面三列来源卡、四列汇总，窄屏降至一列来源卡、两列汇总。信息特征是每个来源同时呈现语义适配、渠道条件、稿件状态和证据关联，不制造总分。

## Components and behavior

- 表单：业务拥有校验与文本错误；noValidate；每个字段关联 label；金额输入 text/inputMode=decimal；提交中防重复。
- Select：本功能采用浏览器原生 select，明确接受平台弹层尺寸和键盘行为，无自绘弹层。
- Navigation：wouter + projectWorkspaceUrl，task 查询参数恢复服务器任务；不把品牌/租户放到用户可编辑绑定中。新增入口仅挂在 PublishingRoutes 的工作台路由，不修改 WorkbenchPage。
- Feedback：复用 PublishingError/Loading/Empty，新状态使用页面内 role=status/alert，无新弹窗。草稿保护复用现有 host.useDraftGuard。
- Data table：只读语义 table；横向滚动保留窄屏列信息。环图仅使用当前完整范围的域名分布，未知分母不画比例。
- 数据状态：未配置、等待模型、处理中、取消、过期、错误均有文本；预算可行、预检与正式发布就绪分开。加入是预算偏好，不是购物车。
- 异步：同源凭据；AbortController 与请求序号忽略旧响应；有限轮询，超时提供刷新；取消标记会阻止结果落库。

## Verification

本轮仅代码阅读自查。未启动页面、未运行样式审计、类型检查、测试或构建，未验证键盘、对比度、窄屏视觉或代理环境同源行为。由 ZCode 在集成后运行验证。


## A 板块界面与契约收尾（本轮）

继续使用上文原 tokens 和字体，不将设计参考中的粉色变量、演示数据或本地规则分配算法引入真实业务。

- 媒体市场：MediaLibraryPage 消费 publishing.market.css，身份/勾选、价格、要点三栏，选中侧线；原真实筛选、20 家上限、禁选、报价和清单保存保持。右侧模块内交接摘要在窄屏回到文档流，不修改 host 的共享侧栏。
- 实际标题：MediaLibraryPage 展示当前真实草稿逐媒体标题摘要，编辑仍进入原 TitlesPage；后者只调整呈现和 publishing.titles.css，不复制保存或预检流程。单标题也逐媒体展示上限和长度结果，长度有效与预检通过明确分开。
- 媒体要求：publishing.requirements.css 拥有市场行、只读官方要求、实际稿件编辑、预检修复表、回退与摘要样式。官方规则不可在本地伪造覆盖。新增搜索仅过滤当前目录页，避免暗示全库搜索。
- 备注：PublishingRemark + publishing.remarks.css 为这几页的唯一备注提示实现，悬停/聚焦/触摸查看，Esc 或失焦关闭。原有弹窗不变。
- 信源：SourceMatrixPage 保留请求和状态处理；SourceMatrixPresentation 只展示同一结果。导航采用底线激活态；表单分非金额需求、内容矩阵、预算三个实际阶段；来源卡片保留原组合偏好语义。来源排名/图例仅过滤明细，范围分母不变。
- 报告：五节阅读布局、版本标识、输入范围、分层、逐来源依据和非金额要求。保持未知金额、未知引用为待确认，不引入演示数据、效果预测或独立统计。
- 契约：flow-contracts 区分设计参考的三个 CustomEvent.detail 与真实仓库 flow.handoff/record 载荷；类型不派发事件、不替代服务端验证。参考媒体交接最后生效版本为 schemaVersion=3。
- 本轮仅源码与差异阅读自查，未执行类型检查、测试、构建或浏览器验证；视觉、焦点、窄屏与回归由 ZCode 验收。

## 2026-10-23 侧栏与顶栏

本节只更新导航与外框约定；前文正文页面的字体、颜色和业务约定继续适用。依据用户图 2 与 FrontMind-Publish-v1.html 的最后覆盖规则。

- 归属：`module/client/businessNav.ts` 提供路由、上下文和面包屑；`navigation/PublishingNavigation.tsx` 提供菜单内容，`navigation/PublishingTopbar.tsx` 提供顶栏。组件由宿主选择挂载，不嵌在 PublishingRoutes 业务正文中。当前只有 `standalone/PublishingShell.tsx` 消费，复用公开 DashboardFrame、主题、presentation 与原底部控件；不修改 vendor。Dashboard 宿主装配不在本包中，需另行接入，不能因文件在 module/ 就认定主站生效。
- 单侧栏：桌面 184px，651–1150px 为 176px；收起态 56px；<=650px 复用共享 frame 的菜单按钮及遮罩，使用无正文占位的抽屉。父级与子级在同一 nav 中；沿用实际稿件、媒体和工作台路由，保留草稿保护、草稿/版本/任务与投放模式；矩阵 task 和媒体 matrixTask 在对应入口互转。保留旧 BusinessSubNav 文件供未提供的其他消费者兼容，独立站不再渲染它。
- 外框字体：Microsoft YaHei / PingFang SC / system-ui / Arial / sans-serif。父级 13px/500、子级 12px/400、17px 图标/1.8 描边；菜单圆角 7px、选中背景 #f9eff5、文字 #b33467、3px #4c1467 竖线；边框 #e6e8f1。仅 `.publish-*` 及 `.publish-standalone` 作用域生效。
- 顶栏：常规桌面最小高度 60px；<=850px 允许两行，避免路径与搜索挤压；<=650px 最小 70px。搜索 36px/8px 圆角/12px 字号，手机 34px；本地限定高优先级 selector 防止共享表单的 16px 规则覆盖。当前面包屑不链接自身。
- 搜索：仅已存在的功能入口、管理页标题/ID 筛选、授权 gateway 当前新闻/自媒体类别的分页名称查询（10 条）；不增加全文检索或批量抓取稿件。外部资源编号用于媒体结果跳转，无编号时退回名称过滤；不会自动勾选。300ms 防抖、取消与过期响应屏蔽，输入法组词期间不提交。Esc/上下键/Enter 与 Ctrl+K/⌘K 可用。
- 帮助：复用共享 Dialog 的焦点管理，站内说明当前真实流程；移动菜单层低于共享弹窗，不更改其他业务弹窗。抽屉使用 inert、Tab 循环、Esc 和关闭后的焦点恢复。原有账户/项目控件与禁用状态保留，不复制原型账号。
- 本轮未执行运行验证，交由智谱 ZCode 和网站验收。新增回归文件仅已编写、阅读，未执行；计算样式、键盘、弹窗层级、窄屏与真实数据跳转均需在最终合并版本验收。

## 2026-10-24 媒体首页入口恢复

- 媒体父菜单单独拥有 `media-home` 总览入口，指向 `/publishing/media` 或当前草稿的 `/publishing/drafts/:draftId/media`；同一父级下仍只显示信源矩阵和第三方媒体两个子菜单。父链接跳转与展开按钮各自可操作，未新增侧栏层。
- 首页激活态和面包屑单独识别，子页面面包屑的“媒体选择”返回同一上下文的首页。稿件菜单、管理稿件入口、媒体搜索结果和子模块深层链接保留各自含义。
- 已冻结稿件的“选择媒体”与原新冻结交接都进入总览页，再由用户选择子模块；草稿裸媒体路径也显式呈现首页。概览复用原页面，不引入参考截图的演示数据或重做外壳。
- 导航保留稿件版本、草稿、投放模式、工作台任务及工作区参数；矩阵 `task` 与媒体 `matrixTask` 仅在相应目的页按既有含义转换。
- 本轮仅修改与阅读自查，新增导航、实际路由分发和编辑器点击回归源码未执行，交由 ZCode 运行并完成网站验收。
