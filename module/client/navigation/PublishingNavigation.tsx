import { Database, FileText, Send } from "lucide-react";
import type { MouseEvent } from "react";
import { BUSINESS_NAV, activeBusinessLeaf, businessLeafHref, businessModuleOf } from "../businessNav";
import { projectWorkspaceUrl } from "../host";
import "./publishing.navigation.css";

export function followPublishingLink(event: MouseEvent<HTMLAnchorElement>, href: string, onNavigate: (href: string) => void) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onNavigate(href);
}

/** Business navigation content only. The host supplies its one sidebar and draft-guarded navigation. */
export default function PublishingNavigation({ path, search, collapsed, onNavigate }: {
  path: string; search: string; collapsed: boolean; onNavigate: (href: string) => void;
}) {
  const active = activeBusinessLeaf(path, search);
  const group = businessModuleOf(active).id;
  // 选中板块后自动展开子菜单：展开组只由当前路由推导，两组互斥，无独立展开按钮；
  // 点击一级导航按默认落地规则跳转后自然展开本组、收起另一组，重复点击当前板块保持展开，
  // 进入无子菜单板块（发布工作台）时不展开任何组；深链、刷新与前进/后退同样按路由恢复。
  const expandedGroup = BUSINESS_NAV.find(item => item.id === group && item.views.length > 1)?.id;
  const icons = { publishing: Send, content: FileText, intent: Database };
  return <nav className="publish-navigation" aria-label="媒体发布导航" data-compact={collapsed}>
    {BUSINESS_NAV.map(item => {
      const Icon = icons[item.id];
      const nested = item.views.length > 1;
      const open = expandedGroup === item.id;
      const parent = item.home ?? item.views[0]!;
      const parentIsCurrent = active === parent.id && Boolean(item.home || !nested);
      const href = projectWorkspaceUrl(businessLeafHref(parent.id, path, search)!);
      return <div className="publish-nav-group" key={item.id}>
        <div className={`publish-nav-parent ${group === item.id ? "is-group-current" : ""}`}>
          <a href={href} aria-label={item.label} title={collapsed ? item.label : undefined}
            className={`publish-nav-link ${parentIsCurrent ? "is-current" : ""}`}
            aria-current={parentIsCurrent ? "page" : undefined}
            onClick={event => followPublishingLink(event, href, onNavigate)}>
            <Icon aria-hidden="true" size={17} strokeWidth={1.8}/><span>{item.label}</span>
          </a>
        </div>
        {nested && !collapsed && <div id={`publish-nav-${item.id}`} className="publish-nav-children" hidden={!open}>
          {item.views.map(leaf => {
            const to = projectWorkspaceUrl(businessLeafHref(leaf.id, path, search)!);
            return <a key={leaf.id} href={to} className={`publish-nav-child ${active === leaf.id ? "is-current" : ""}`}
              aria-current={active === leaf.id ? "page" : undefined}
              onClick={event => followPublishingLink(event, to, onNavigate)}>{leaf.label}</a>;
          })}
        </div>}
      </div>;
    })}
  </nav>;
}
