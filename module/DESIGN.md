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
