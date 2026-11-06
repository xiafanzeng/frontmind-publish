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
  // V5：稿件与媒体选择不再是独立导航（navHidden），侧栏只保留发布工作台；
  // 页面仍经工作台列表/流程进入。展开组逻辑保留给未隐藏的多子项板块。
  const expandedGroup = BUSINESS_NAV.find(item => item.id === group && item.views.length > 1)?.id;
  const icons = { publishing: Send, content: FileText, intent: Database };
  return <nav className="publish-navigation" aria-label="媒体发布导航" data-compact={collapsed}>
    {BUSINESS_NAV.filter(item => !item.navHidden).map(item => {
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
