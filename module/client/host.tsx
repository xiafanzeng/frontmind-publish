import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import type { PublicationBatch } from './types';
import * as Defaults from './Workflow';

type DraftInput = {dirty:boolean;label:string;save?:()=>Promise<boolean>;discard?:()=>Promise<boolean>};
const drafts = new Set<()=>boolean>();
function useLocalDraftGuard(input: DraftInput) {
  const current=useRef(input);current.current=input;
  useEffect(()=>{const dirty=()=>current.current.dirty;drafts.add(dirty);const unload=(e:BeforeUnloadEvent)=>{if(dirty()){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{drafts.delete(dirty);window.removeEventListener('beforeunload',unload);};},[]);
}
function localNavigate(action:()=>void) {if(![...drafts].some(d=>d()) || window.confirm('当前修改尚未保存，确定离开吗？')) action();}
export type PublishingHost = {
  workspaceUrl?:(path:string)=>string;
  useWorkspaceKey?:()=>number|undefined;
  requestNavigation?:(action:()=>void)=>void;
  approveNavigation?:(action:()=>void)=>void;
  useDraftGuard?:(input:DraftInput)=>void;
  workflow?:typeof Defaults;
  renderExecution?:(batch:PublicationBatch)=>ReactNode;
};
// The browser host supplies functions, never credentials or role management.
// Main sets these once in its thin integration entry; standalone uses defaults.
let host:PublishingHost={};
export function configurePublishingHost(value:PublishingHost) {host=value;}
export function projectWorkspaceUrl(path:string) {return host.workspaceUrl?.(path) ?? path;}
export function usePublishingWorkspaceKey() {return host.useWorkspaceKey?.() ?? 1;}
export function requestWorkspaceNavigation(action:()=>void) {(host.requestNavigation??localNavigate)(action);}
export function performApprovedWorkspaceNavigation(action:()=>void) {(host.approveNavigation??((run:()=>void)=>run()))(action);}
export function useWorkspaceDraftGuard(input:DraftInput) {(host.useDraftGuard??useLocalDraftGuard)(input);}
export function WorkflowQuestion(props:ComponentProps<typeof Defaults.WorkflowQuestion>) {const C=host.workflow?.WorkflowQuestion??Defaults.WorkflowQuestion;return <C {...props}/>;}
export function WorkflowSection(props:ComponentProps<typeof Defaults.WorkflowSection>) {const C=host.workflow?.WorkflowSection??Defaults.WorkflowSection;return <C {...props}/>;}
export function WorkflowCompleted(props:ComponentProps<typeof Defaults.WorkflowCompleted>) {const C=host.workflow?.WorkflowCompleted??Defaults.WorkflowCompleted;return <C {...props}/>;}
export function WorkflowFeedback(props:ComponentProps<typeof Defaults.WorkflowFeedback>) {const C=host.workflow?.WorkflowFeedback??Defaults.WorkflowFeedback;return <C {...props}/>;}
export function WorkflowPagination(props:ComponentProps<typeof Defaults.WorkflowPagination>) {const C=host.workflow?.WorkflowPagination??Defaults.WorkflowPagination;return <C {...props}/>;}
export function safePublisherLogoUrl(value?:string) {const pattern=/^\/api\/monitoring\/publisher\/media-logos\/[0-9a-f-]{36}\/[a-f0-9]{64}$/iu;return value&&pattern.exec(value)?.[0]===value?value:undefined;}
export function PublishExecution({batch}:{batch:PublicationBatch}) {
  if(host.renderExecution) return <>{host.renderExecution(batch)}</>;
  return <details><summary>查看发布过程</summary><ol>{batch.items.map(item=><li key={item.id}>{item.media.name} · {item.status}{item.resultMessage?` · ${item.resultMessage}`:''}</li>)}</ol></details>;
}
