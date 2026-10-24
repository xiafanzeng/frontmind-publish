import { useEffect, useState } from 'react';
import { createTRPCProxyClient } from '@trpc/client';
import type { createPublishRoutes } from '../module/server/routes';
import PublishingRoutes from '../module/client/PublishingRoutes';
import { createServerBackedPublisherGateway } from '../module/client/ProductionPublishingEntry';
import { createPublisherTransportLink } from '../module/client/publisherTransport';
import type { PublisherGateway } from '../module/client/gateway';
import PublishingShell from './PublishingShell';
import { createPreviewGateway } from './preview';
import { StandalonePublishingFlow } from './StandalonePublishingFlow';
import './standalone.css';
import { SourceMatrixPreviewContext } from '../module/client/source-matrix/simulation/mode';

type PublisherRouter=ReturnType<typeof createPublishRoutes>['publisherRouter'];
export default function App({preview=false}:{preview?:boolean}) {
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
      const publisher=createTRPCProxyClient<PublisherRouter>({links:[()=>({op,next})=>next({...op,path:`publisher.${op.path}`}),createPublisherTransportLink<PublisherRouter>({url:'/api/monitoring/trpc',fetch:(url,options)=>fetch(url,{...options,credentials:'same-origin'})})]});
      setGateway(createServerBackedPublisherGateway({publisher}));
    }).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>abort.abort();
  },[preview]);
return <PublishingShell key={workspaceKey} gateway={gateway} preview={preview}>{error?<p role="alert">{error}</p>:gateway?<StandalonePublishingFlow key={workspaceKey} workspaceKey={workspaceKey}><SourceMatrixPreviewContext.Provider value={preview}><PublishingRoutes gateway={gateway}/></SourceMatrixPreviewContext.Provider></StandalonePublishingFlow>:<p role="status">正在打开发布工作台…</p>}</PublishingShell>;
}
