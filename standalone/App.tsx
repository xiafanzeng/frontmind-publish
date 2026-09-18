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
import { createPreviewGateway } from './preview';
import { StandalonePublishingFlow } from './StandalonePublishingFlow';
import './standalone.css';

type PublisherRouter=ReturnType<typeof createPublishRoutes>['publisherRouter'];
export default function App({preview=false}:{preview?:boolean}) {
  const [path,navigate]=useLocation();
  const activeView=path.startsWith('/publishing/articles')?'articles':path.startsWith('/publishing/media')?'media':'publishing';
  const views=[{id:'publishing',label:'发布工作台'},{id:'articles',label:'稿件'},{id:'media',label:'媒体库'}];
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
  return <ModuleShell requestNavigation={requestWorkspaceNavigation} module={{id:'publishing',label:PUBLISH_MODULE_LABEL,color:'#b33467'}} views={views} activeView={activeView} onSelectView={id=>navigate(id==='publishing'?'/publishing':`/publishing/${id}`)} preview={preview}><div className="monitoring-module">{error?<p role="alert">{error}</p>:gateway?<StandalonePublishingFlow key={workspaceKey} workspaceKey={workspaceKey}><PublishingRoutes gateway={gateway}/></StandalonePublishingFlow>:<p role="status">正在打开发布工作台…</p>}</div></ModuleShell>;
}
