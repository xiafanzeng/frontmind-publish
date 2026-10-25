import { ChevronDown, ChevronRight, CircleHelp, FolderOpen, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Send, Settings, Wallet } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent } from "@frontmind/module-ui/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@frontmind/module-ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontmind/module-ui/components/ui/tooltip";
import PublishingHelpBody from "./PublishingHelpBody";
import "./publishing.navigation.css";

export const SIDEBAR_TOGGLE_LABEL = "显示/隐藏侧边栏";

export type WorkspaceAccountInfo = { label: string; workspaceLabel: string; ownerUserId?: string | number };

/**
 * 工作区侧栏底部：项目总览胶囊（与共享 operator 外壳完全一致）+ 账户入口菜单 + 侧栏显隐开关。
 * 供应商 vendor 组件把“胶囊 + 账户行 + 收起行”捆绑导出且只读，故由本组合层重建底部：
 * 胶囊保持与 vendor 现版相同的 DOM/类名/行为，账户行改为真实交互，原“收起侧边栏”整行移除。
 * 菜单按设计稿完整呈现六项；其中仅“帮助”接真实能力（共享对话框），账户资料/余额/邀请/设置/
 * 退出登录平台暂无数据来源——项保留但无动作、不写死演示账号、不编造金额数值。
 */
export default function WorkspaceSidebarFooter({ collapsed, onCollapse, ownerUserId }: {
  collapsed: boolean; onCollapse: () => void; ownerUserId?: string | number;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const account: WorkspaceAccountInfo = { label: "FrontMind", workspaceLabel: "FrontMind 开发工作区", ownerUserId };
  const avatar = account.label.slice(0, 1) || "F";
  const identityLine = [
    account.workspaceLabel,
    account.ownerUserId === undefined || account.ownerUserId === null || account.ownerUserId === "" ? "" : `用户 ${account.ownerUserId}`,
  ].filter(Boolean).join(" · ");
  return <>
    <div className="operator-project-group operator-project-capsule is-active">
      <div className="operator-project-heading">
        <button type="button" className="operator-nav-entry operator-project-entry active" aria-label="项目总览" title={`项目总览 · ${account.workspaceLabel}`} onClick={() => { if (collapsed) onCollapse(); }}>
          <FolderOpen size={20} />
          <span className="operator-project-capsule-label"><strong>项目总览</strong><small>{account.workspaceLabel}</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button type="button" className="operator-project-menu-trigger" aria-label="新建企业项目" title="新建企业项目" disabled><Plus size={18} /></button>
      </div>
    </div>
    <div className="operator-account-row">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="operator-account-identity" aria-label={account.label} title={account.label}>
            <span aria-hidden="true">{avatar}</span><strong>{account.label}</strong>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="operator-account-menu publish-account-menu">
          <DropdownMenuLabel className="publish-account-header">
            <span className="publish-account-avatar" aria-hidden="true">{avatar}</span>
            <span className="publish-account-id">
              <strong>{account.label}</strong>
              {identityLine && <small>{identityLine}</small>}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="publish-account-separator" />
          <DropdownMenuItem className="publish-account-item">
            <Wallet size={16} aria-hidden="true" /><span>剩余金额</span>
            <ChevronRight size={14} aria-hidden="true" className="publish-account-more"/>
          </DropdownMenuItem>
          <DropdownMenuItem className="publish-account-item">
            <Send size={16} aria-hidden="true" /><span>邀请好友</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="publish-account-item">
            <Settings size={16} aria-hidden="true" /><span>设置</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="publish-account-separator" />
          <DropdownMenuItem className="publish-account-item" onSelect={() => setHelpOpen(true)}>
            <CircleHelp size={16} aria-hidden="true" /><span>帮助</span>
            <ChevronRight size={14} aria-hidden="true" className="publish-account-more"/>
          </DropdownMenuItem>
          <DropdownMenuItem className="publish-account-item">
            <LogOut size={16} aria-hidden="true" /><span>退出登录</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="operator-account-settings publish-sidebar-toggle"
            aria-label={SIDEBAR_TOGGLE_LABEL} aria-expanded={!collapsed} onClick={onCollapse}>
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true"/> : <PanelLeftClose size={18} aria-hidden="true"/>}
          </button>
        </TooltipTrigger>
        <TooltipContent>{SIDEBAR_TOGGLE_LABEL}</TooltipContent>
      </Tooltip>
    </div>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="publish-help-dialog" showCloseButton={false}>
        <PublishingHelpBody/>
      </DialogContent>
    </Dialog>
  </>;
}
