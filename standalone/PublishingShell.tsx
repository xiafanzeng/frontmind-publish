import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { DashboardFrame } from "@frontmind/module-ui/dashboard/DashboardFrame";
import { ModulePresentationProvider } from "@frontmind/module-ui/dashboard/module-presentation";
import { OperatorThemeProvider } from "@frontmind/module-ui/components/ui/operator-theme";
import PublishingNavigation from "../module/client/navigation/PublishingNavigation";
import PublishingTopbar from "../module/client/navigation/PublishingTopbar";
import WorkspaceSidebarFooter from "../module/client/navigation/WorkspaceSidebarFooter";
import { requestWorkspaceNavigation } from "../module/client/host";
import type { PublisherGateway } from "../module/client/gateway";
import { PUBLISH_MODULE_LABEL } from "../module/client/module-label";
import "./standalone.css";

const SIDEBAR_KEY = "frontmind.operator.sidebarCollapsed";
const logo = new URL("../vendor/module-ui/src/assets/frontmind-wordmark.svg",import.meta.url).href;

/** Standalone assembly of public shared primitives; Dashboard keeps its own host composition. */
export default function PublishingShell({gateway,preview,ownerUserId,children}: {
  gateway: PublisherGateway | null; preview: boolean; ownerUserId?: string | number; children: ReactNode;
}) {
  const [path,navigate] = useLocation();
  const search = useSearch();
  const [phone,setPhone] = useState(()=>typeof window!=="undefined" && window.matchMedia("(max-width: 650px)").matches);
  const [mobileOpen,setMobileOpen] = useState(false);
  const [savedCollapsed,setSavedCollapsed] = useState(()=>{try{return localStorage.getItem(SIDEBAR_KEY)==="1";}catch{return false;}});
  const sidebar = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const collapsed = !phone && savedCollapsed;

  useEffect(()=>{
    const media=window.matchMedia("(max-width: 650px)");
    const change=()=>{setPhone(media.matches);setMobileOpen(false);};
    // A viewport resize between first render and this listener attachment would
    // never fire a change event; re-sync once so the shell cannot stay stuck in
    // the boot-time phone state (permanently inert sidebar) at desktop widths.
    change();
    media.addEventListener("change",change);
    return()=>media.removeEventListener("change",change);
  },[]);
  useEffect(()=>{setMobileOpen(false);},[path,search]);
  useEffect(()=>{
    if(!phone || !mobileOpen || !sidebar.current)return;
    const panel=sidebar.current;
    const origin=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const body=main.current;
    const originalInert=body?.inert;
    if(body)body.inert=true;
    const controls=()=>Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]'))
      .filter(node=>!node.closest('[hidden],[inert]'));
    controls()[0]?.focus();
    const keydown=(event:KeyboardEvent)=>{
      if(event.isComposing)return;
      if(event.key==="Escape"){event.preventDefault();setMobileOpen(false);return;}
      if(event.key!=="Tab")return;
      const items=controls(),first=items[0],last=items.at(-1);
      if(!first){event.preventDefault();panel.focus();return;}
      if(event.shiftKey && (document.activeElement===first || !panel.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !panel.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",keydown);
    return()=>{document.removeEventListener("keydown",keydown);if(body)body.inert=originalInert??false;if(origin?.isConnected)origin.focus();};
  },[phone,mobileOpen]);

  const collapse=()=>{
    if(phone){setMobileOpen(false);return;}
    setSavedCollapsed(value=>{const next=!value;try{localStorage.setItem(SIDEBAR_KEY,next?"1":"0");}catch{}return next;});
  };
  const navigateGuarded=(href:string,after?:()=>void)=>requestWorkspaceNavigation(()=>{
    setMobileOpen(false);navigate(href);after?.();
  });

  return <div className="publish-standalone">
    <OperatorThemeProvider>
      <ModulePresentationProvider module={{id:"publishing",label:PUBLISH_MODULE_LABEL,color:"#b33467",actions:[]}} requestNavigation={requestWorkspaceNavigation}>
        <DashboardFrame collapsed={collapsed} mobileOpen={phone && mobileOpen} onMobileOpenChange={setMobileOpen}>
          <aside ref={sidebar} id="operator-project-navigation" className="global-nav operator-sidebar publish-sidebar"
            data-entry="project" data-collapsed={collapsed} aria-label="工作区导航" tabIndex={-1}
            role={phone && mobileOpen?"dialog":undefined} aria-modal={phone && mobileOpen?true:undefined}
            aria-hidden={phone && !mobileOpen?true:undefined} inert={phone && !mobileOpen?true:undefined}>
            <div className="publish-shell-logo"><img src={logo} alt="FrontMind"/></div>
            <PublishingNavigation path={path} search={search} collapsed={collapsed} onNavigate={navigateGuarded}/>
            <div className="operator-sidebar-bottom">
              <WorkspaceSidebarFooter collapsed={collapsed} onCollapse={collapse} ownerUserId={ownerUserId}/>
            </div>
          </aside>
          <main ref={main} className="dashboard-main workbench-main publish-shell-main">
            <PublishingTopbar path={path} search={search} gateway={gateway} onNavigate={navigateGuarded}/>
            {preview && <div className="publish-preview-notice" role="status">本地预览 · 合成示例数据，不会执行真实业务</div>}
            <div className="publish-shell-content monitoring-module">{children}</div>
          </main>
        </DashboardFrame>
      </ModulePresentationProvider>
    </OperatorThemeProvider>
  </div>;
}
