import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { PublishingFlowProvider, publishingHandoffRecordId, type PublishingFlow, type PublishingResource } from "../module/client/PublishingFlowContext";
import type { WorkbenchTaskState } from "../module/client/flow-contracts";

type Agent = "publishing" | "media" | "articles";
type FlowEntry = WorkbenchTaskState & {id: string; agentId: Agent};
type FlowDocument = {version: 1; active: Record<string,string>; entries: Record<string,FlowEntry>; handoffs: Record<string,string>};
const empty = (): FlowDocument => ({version: 1, active: {}, entries: {}, handoffs: {}});
const validAgents = new Set<Agent>(["publishing","media","articles"]);
const validKinds = new Set(["article","article_version","publication_draft","publication_batch"]);

export function publishingFlowScope(path: string, search = "") {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  const draft = /^\/publishing\/drafts\/([^/]+)\/(media|titles|review)/.exec(path);
  const article = /^\/publishing\/articles\/([^/]+)\/edit/.exec(path);
  const batch = /^\/publishing\/publications\/([^/]+)/.exec(path);
  const agentId: Agent = path.startsWith("/publishing/media") || draft?.[2] === "media" ? "media" : path.startsWith("/publishing/articles") ? "articles" : "publishing";
  const decode = (value: string) => {try {return decodeURIComponent(value);} catch {return value;}};
  const resource: PublishingResource | undefined = draft ? {kind:"publication_draft",id:decode(draft[1]!)} : article ? {kind:"article",id:decode(article[1]!)} : batch ? {kind:"publication_batch",id:decode(batch[1]!)} : params.get("articleVersion") ? {kind:"article_version",id:params.get("articleVersion")!} : undefined;
  return {agentId, resource, key: `${agentId}:${resource ? `${resource.kind}:${resource.id}` : "entry"}`};
}
function read(key: string): FlowDocument {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "null");
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("entries" in value) || !value.entries || typeof value.entries !== "object" || !("active" in value) || !("handoffs" in value)) return empty();
    const result = value as FlowDocument;
    if (!result.active || typeof result.active !== "object" || !result.handoffs || typeof result.handoffs !== "object") return empty();
    if (Object.values(result.entries).some(entry => !entry || typeof entry.id !== "string" || !validAgents.has(entry.agentId) || !Array.isArray(entry.resources) || entry.resources.some(resource => !validKinds.has(resource.kind) || typeof resource.id !== "string") || !Array.isArray(entry.records) || !entry.values || typeof entry.values !== "object")) return empty();
    return result;
  } catch { return empty(); }
}
function mergeResources(previous: FlowEntry["resources"], incoming: FlowEntry["resources"] = []) {
  const kinds = new Set(incoming.map(resource => resource.kind));
  return [...previous.filter(resource => !kinds.has(resource.kind)), ...incoming];
}

/** Only UI choices and resource references are browser-owned. Drafts, revisions,
 * quotes, orders and results continue through the existing publisher gateway. */
export function StandalonePublishingFlow({workspaceKey,children}: {workspaceKey: string;children: ReactNode}) {
  const [path,navigate] = useLocation();
  const search = useSearch();
  const storageKey = `frontmind.publishing.flow.v1:${workspaceKey}`;
  const [document,setDocument] = useState(() => read(storageKey));
  const currentDocument = useRef(document);currentDocument.current = document;
  const seeds = useRef(new Map<string,FlowEntry>());
  const scope = publishingFlowScope(path,search);
  const requested = new URLSearchParams(search.replace(/^\?/, "")).get("workbenchTask");
  const requestedEntry = requested ? document.entries[requested] : undefined;
  const requestedResourceMatches = !scope.resource || requestedEntry?.resources.some(resource => resource.kind === scope.resource!.kind && resource.id === scope.resource!.id);
  const selectedId = requestedEntry?.agentId === scope.agentId && requestedResourceMatches ? requested : document.active[scope.key];
  let entry = selectedId ? document.entries[selectedId] : undefined;
  if (!entry) {
    entry = seeds.current.get(scope.key);
    if (!entry) {entry = {id:crypto.randomUUID(),agentId:scope.agentId,step:"",values:{},records:[],resources:scope.resource?[scope.resource]:[]};seeds.current.set(scope.key,entry);}
  }
  const currentEntry = useRef(entry);currentEntry.current = entry;
  const persist = useCallback((next: FlowDocument) => {
    try {localStorage.setItem(storageKey, JSON.stringify(next));}
    catch {throw new Error("引导选择尚未保存，请检查浏览器存储后重试；业务草稿仍保存在服务器。");}
    currentDocument.current = next;setDocument(next);
  },[storageKey]);
  const update = useCallback((owner: FlowEntry, key: string, transform: (value: FlowEntry) => FlowEntry) => {
    const latest = currentDocument.current;
    const saved = transform(latest.entries[owner.id] ?? owner);
    persist({...latest,active:{...latest.active,[key]:saved.id},entries:{...latest.entries,[saved.id]:saved}});
    return saved;
  },[persist]);
  const value = useMemo<PublishingFlow>(() => {
    const owner = entry;
    return {
      taskId:owner.id,scopeKey:workspaceKey,agentId:owner.agentId,pending:false,outcomePending:false,
      selections:owner.values,resources:owner.resources as PublishingResource[],records:owner.records,
      async ensureTask() {update(owner,scope.key,current=>current);return owner.id;},
      setSummary:()=>{},
      async saveSelections(values) {update(owner,scope.key,current=>({...current,step:"media-selection",values:{...current.values,...values}}));},
      async saveValues(values) {update(owner,scope.key,current=>({...current,values:{...current.values,...values}}));},
      async record(record) {
        update(owner,scope.key,current=>({...current,step:record.id.split(":")[0] ?? record.id,resources:mergeResources(current.resources,record.resources),records:[...current.records.filter(item=>item.id!==record.id),{id:record.id,label:record.label,detail:record.detail,status:"completed",timestamp:Date.now()}]}));
      },
      async handoff(input) {
        const id = await publishingHandoffRecordId(input.idempotencyKey);
        const latest = currentDocument.current;
        const source = latest.entries[owner.id] ?? owner;
        const handoffKey = `${owner.id}:${input.idempotencyKey}`;
        const previousId = latest.handoffs[handoffKey];
        const destination = previousId ? latest.entries[previousId] : undefined;
        const target: FlowEntry = destination ?? {id:crypto.randomUUID(),agentId:input.targetAgentId,step:"",values:{},records:[],resources:input.resources};
        const url = new URL(input.route,window.location.origin);
        const targetScope = publishingFlowScope(url.pathname,url.search);
        const saved = {...source,records:[...source.records.filter(item=>item.id!==id),{id,label:input.title,status:"completed" as const,timestamp:Date.now(),targetTask:{conversationId:target.id,agentId:target.agentId}}]};
        persist({...latest,active:{...latest.active,[scope.key]:source.id,[targetScope.key]:target.id},entries:{...latest.entries,[source.id]:saved,[target.id]:target},handoffs:{...latest.handoffs,[handoffKey]:target.id}});
        if (currentEntry.current.id !== owner.id) return;
        url.searchParams.set("workbenchTask",target.id);
        navigate(`${url.pathname}${url.search}${url.hash}`);
      },
    };
  },[entry,scope.key,workspaceKey,navigate,persist,update]);
  return <PublishingFlowProvider value={value}>{children}</PublishingFlowProvider>;
}
