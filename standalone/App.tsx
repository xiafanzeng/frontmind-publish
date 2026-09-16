import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { createPublishRoutes } from '../module/server/routes';
import ModuleWorkspace from '../module/client/ModuleWorkspace';
import { PUBLISH_MODULE_LABEL } from '../module/client/module-label';
import { createServerBackedPublisherGateway } from '../module/client/ProductionPublishingEntry';
import type { PublisherGateway } from '../module/client/gateway';
import { createPreviewGateway } from './preview';
import './standalone.css';

type PublisherRouter=ReturnType<typeof createPublishRoutes>['publisherRouter'];
export default function App({preview=false}:{preview?:boolean}) {
  const [gateway,setGateway]=useState<PublisherGateway|null>(()=>preview?createPreviewGateway():null);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(preview)return;
    const abort=new AbortController();
    void fetch('/api/module/context',{credentials:'same-origin',signal:abort.signal}).then(async response=>{
      if(!response.ok)throw new Error('无法读取开发工作区，请重新通过域名门禁。');
      const context=await response.json();if(context.module!=='publish'||!context.workspace?.id)throw new Error('当前运行入口不是发布模块。');
      const publisher=createTRPCProxyClient<PublisherRouter>({links:[()=>({op,next})=>next({...op,path:`publisher.${op.path}`}),httpBatchLink({url:'/api/monitoring/trpc',fetch:(url,options)=>fetch(url,{...options,credentials:'same-origin'})})]});
      setGateway(createServerBackedPublisherGateway({publisher}));
    }).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:String(cause));});
    return()=>abort.abort();
  },[preview]);
  return <div className="publish-standalone monitoring-module"><header><strong>{PUBLISH_MODULE_LABEL}</strong><nav aria-label="发布模块页面"><Link href="/publishing">发布工作台</Link><Link href="/publishing/articles">稿件</Link><Link href="/publishing/media">媒体目录</Link><Link href="/publishing?tab=records">发布结果</Link></nav></header>{preview&&<aside role="status" className="preview-banner">本地预览 · 合成数据仅保存在此页面，不连接真实供应商或测试数据库。</aside>}{error?<p role="alert">{error}</p>:gateway?<ModuleWorkspace gateway={gateway}/>:<p role="status">正在打开发布工作台…</p>}</div>;
}
