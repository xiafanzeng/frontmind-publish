import { DialogClose, DialogDescription, DialogTitle } from "@frontmind/module-ui/components/ui/dialog";

/**
 * 共享帮助内容：顶栏“帮助文档”对话框与侧栏账户菜单的帮助入口使用同一份实现，
 * 供 DialogContent 直接渲染，不复制两份文案。
 */
export default function PublishingHelpBody() {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return <>
    <DialogTitle>媒体发布帮助</DialogTitle>
    <DialogDescription>以下入口沿用当前工作区的稿件、媒体与发布流程。</DialogDescription>
    <section><h3>管理与编辑稿件</h3><p>在“管理稿件”导入稿件或选择既有稿件继续编辑。稿件修改后按原流程保存、冻结版本；编辑入口不会自动提交或发布。</p></section>
    <section><h3>媒体选择与标题配置</h3><p>在“信源矩阵”查看规划，在“媒体库”筛选媒体并保留当前任务。沿用购物车、标题配置与预检流程核对发布要求。</p></section>
    <section><h3>预检与发布记录</h3><p>处理预检提示后，仍需在原发布流程中确认操作。发布记录用于查看实际状态和详情，导航或搜索不会触发发稿、扣费。</p></section>
    <section><h3>搜索与快捷键</h3><p>按 {mac ? "⌘K" : "Ctrl+K"} 聚焦搜索。媒体查询当前类别并显示前 10 项；稿件搜索会跳转到管理页按标题或 ID 筛选。上下键选择结果，Enter 打开，Esc 关闭。</p></section>
    <DialogClose asChild><button type="button" className="publish-help-close">关闭帮助</button></DialogClose>
  </>;
}
