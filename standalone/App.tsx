import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import {ModuleShell} from '@frontmind/module-ui/dashboard/ModuleShell';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { createPublishRoutes } from '../module/server/routes';
import PublishingRoutes from '../module/client/PublishingRoutes';
import { PUBLISH_MODULE_LABEL } from '../module/client/module-label';
import { createServerBackedPublisherGateway } from '../module/client/ProductionPublishingEntry';
import type { PublisherGateway } from '../module/client/gateway';
import { requestWorkspaceNavigation } from '../module/client/host';
import { BUSINESS_NAV, activeBusinessLeaf, businessLeafPath } from '../module/client/businessNav';
import BusinessSubNav from '../module/client/components/BusinessSubNav';
import '../module/client/publishing.nav.css';
import { createPreviewGateway } from './preview';
import { StandalonePublishingFlow } from './StandalonePublishingFlow';
import './standalone.css';
import { SourceMatrixPreviewContext } from '../module/client/source-matrix/simulation/mode';

type PublisherRouter=ReturnType<typeof createPublishRoutes>['publisherRouter'];
export default function App({preview=false}:{preview?:boolean}) {
  const [path,navigate]=useLocation();
  // 业务导航统一在左侧：一级（发布工作台/稿件/媒体选择）经 navigationModules 交给共享外壳侧栏，
  // 二级由 BusinessSubNav 渲染；顶部 views 置空，外壳只保留模块名顶栏，不再出现业务标签。
  const activeView=activeBusinessLeaf(path);
  const [gateway,setGateway]=useState<PublisherGateway|null>(()=>preview?createPreviewGateway():null);
  const [error,setError]=useState('');
  const [workspaceKey,setWorkspaceKey]=useState('local-preview');
  useEffect(()=>{
    if(preview)return;
    const abort=new AbortController();
    void fetch('/api/module/context',{credentials:'same-origin',signal:abort.signal}).then(async response=>{
      if(!response.ok)throw new Error('无法读取开发工作区，请重新通过域名门禁。');
      const context=await response.json();if(context.module!=='publish'||!context.workspace?.id)throw new Error('当前运行入口不是发布模块。');
      setWorkspaceKey(`${context.workspace.id}:${context.workspace.ownerUserId}`);
      const publisher=createTRPCProxyClient<PublisherRouter>({links:[()=>({op,next})=>next({...op,path:`publisher.${op.path}`}),httpBatchLink({url:'/api/monitoring/trpc',fetch:(url,options)=>fetch(url,{...options,credentials:'same-origin'})})]});
      setGateway(createServerBackedPublisherGateway({publisher}));
    }).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>abort.abort();
  },[preview]);
  const navigateGuarded=(next:string)=>requestWorkspaceNavigation(()=>navigate(next));
return <ModuleShell requestNavigation={requestWorkspaceNavigation} module={{id:'publishing',label:PUBLISH_MODULE_LABEL,color:'#b33467'}} views={[]} activeView={activeView} navigationModules={BUSINESS_NAV.map(moduleItem=>({id:moduleItem.id,label:moduleItem.label,color:'#b33467',views:moduleItem.views.map(leaf=>({id:leaf.id,label:leaf.label}))}))} onSelectView={id=>{const next=businessLeafPath(id);if(next)navigateGuarded(next);}} preview={preview}><div className="business-nav-shell"><BusinessSubNav activeLeaf={activeView} onSelect={navigateGuarded}/><div className="business-nav-content monitoring-module">{error?<p role="alert">{error}</p>:gateway?<StandalonePublishingFlow key={workspaceKey} workspaceKey={workspaceKey}><SourceMatrixPreviewContext.Provider value={preview}><PublishingRoutes gateway={gateway}/></SourceMatrixPreviewContext.Provider></StandalonePublishingFlow>:<p role="status">正在打开发布工作台…</p>}</div></div></ModuleShell>;
}
