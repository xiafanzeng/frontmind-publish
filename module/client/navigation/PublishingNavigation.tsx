import { ChevronDown, Database, FileText, Send } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [group]: true });
  useEffect(() => { setExpanded(value => ({ ...value, [group]: true })); }, [group, path, search]);
  const icons = { publishing: Send, content: FileText, intent: Database };
  return <nav className="publish-navigation" aria-label="媒体发布导航" data-compact={collapsed}>
    {BUSINESS_NAV.map(item => {
      const Icon = icons[item.id];
      const nested = item.views.length > 1;
      const open = Boolean(expanded[item.id]);
      const href = projectWorkspaceUrl(businessLeafHref(item.views[0]!.id, path, search)!);
      return <div className="publish-nav-group" key={item.id}>
        <div className={`publish-nav-parent ${group === item.id ? "is-group-current" : ""}`}>
          <a href={href} aria-label={item.label} title={collapsed ? item.label : undefined}
            className={`publish-nav-link ${!nested && active === item.views[0]!.id ? "is-current" : ""}`}
            aria-current={!nested && active === item.views[0]!.id ? "page" : undefined}
            onClick={event => {
              if (nested) setExpanded(value => ({ ...value, [item.id]: true }));
              followPublishingLink(event, href, onNavigate);
            }}>
            <Icon aria-hidden="true" size={17} strokeWidth={1.8}/><span>{item.label}</span>
          </a>
          {nested && !collapsed && <button type="button" className="publish-nav-disclosure"
            aria-label={`${open ? "收起" : "展开"}${item.label}子菜单`}
            aria-expanded={open} aria-controls={`publish-nav-${item.id}`}
            onClick={() => setExpanded(value => ({ ...value, [item.id]: !open }))}>
            <ChevronDown size={14} aria-hidden="true" className={open ? "is-open" : ""}/>
          </button>}
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
