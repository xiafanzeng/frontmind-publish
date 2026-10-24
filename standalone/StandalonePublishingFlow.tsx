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
  const draft = /^\/publishing\/drafts\/([^/]+)\/(media|titles|review)(?:\/|$)/.exec(path);
  const article = /^\/publishing\/articles\/([^/]+)\/edit/.exec(path);
  const batch = /^\/publishing\/publications\/([^/]+)/.exec(path);
  const mediaPage = /^\/publishing\/(?:media(?:\/|$)|source-(?:matrix|industry|analysis|report)(?:\/|$))/.test(path);
  const agentId: Agent = mediaPage || draft?.[2] === "media" ? "media" : path.startsWith("/publishing/articles") ? "articles" : "publishing";
  const decode = (value: string) => {try {return decodeURIComponent(value);} catch {return value;}};
  const queryDraft = mediaPage ? params.get("draftId") : null;
  const resource: PublishingResource | undefined = draft ? {kind:"publication_draft",id:decode(draft[1]!)} : queryDraft ? {kind:"publication_draft",id:queryDraft} : article ? {kind:"article",id:decode(article[1]!)} : batch ? {kind:"publication_batch",id:decode(batch[1]!)} : params.get("articleVersion") ? {kind:"article_version",id:params.get("articleVersion")!} : undefined;
  const resources = resource ? [resource] : [];
  const version = params.get("articleVersion");
  if (version && !resources.some(item => item.kind === "article_version")) resources.push({kind:"article_version",id:version});
  const key = `${agentId}:${resource ? `${resource.kind}:${resource.id}` : "entry"}`;
  return {agentId, resource, resources, key, seedKey: JSON.stringify([key,resources])};
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

// A media task owns both the frozen version and the server draft created from
// it. Register those references as aliases, rather than starting another task
// when selection persistence changes the URL from version to draft.
function indexEntry(active: FlowDocument["active"], entry: FlowEntry) {
  const entryKey = `${entry.agentId}:entry`;
  const next = Object.fromEntries(Object.entries(active).filter(([key,id]) => id !== entry.id || key === entryKey));
  if (!entry.resources.length) next[`${entry.agentId}:entry`] = entry.id;
  for (const resource of entry.resources) next[`${entry.agentId}:${resource.kind}:${resource.id}`] = entry.id;
  return next;
}

function matchesScope(entry: FlowEntry | undefined, scope: ReturnType<typeof publishingFlowScope>) {
  return entry?.agentId === scope.agentId && scope.resources.every(expected =>
    entry.resources.some(resource => resource.kind === expected.kind && resource.id === expected.id));
}

// An explicit workbenchTask continuation owns a page while it merely lacks some
// of the page's references — its first registration may have failed before it
// recorded this draft, and the retry must extend that same task instead of
// seeding a second one. Only a real contradiction (same resource kind bound to
// a different id, or a different agent) ends the continuation.
function conflictsScope(entry: FlowEntry | undefined, scope: ReturnType<typeof publishingFlowScope>) {
  return !entry || entry.agentId !== scope.agentId || scope.resources.some(expected =>
    entry.resources.some(resource => resource.kind === expected.kind && resource.id !== expected.id));
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
  const activeEntry = document.entries[document.active[scope.key] ?? ""];
  let entry = conflictsScope(requestedEntry, scope) ? undefined : requestedEntry;
  if (!entry) entry = matchesScope(activeEntry,scope) ? activeEntry : undefined;
  if (!entry) {
    const seed = seeds.current.get(scope.seedKey);
    const savedSeed = seed ? document.entries[seed.id] : undefined;
    entry = savedSeed ? (matchesScope(savedSeed,scope) ? savedSeed : undefined) : seed;
    if (!entry) {entry = {id:crypto.randomUUID(),agentId:scope.agentId,step:"",values:{},records:[],resources:scope.resources};seeds.current.set(scope.seedKey,entry);}
  }
  const currentEntry = useRef(entry);currentEntry.current = entry;
  const persist = useCallback((next: FlowDocument) => {
    try {localStorage.setItem(storageKey, JSON.stringify(next));}
    catch {throw new Error("引导选择尚未保存，请检查浏览器存储后重试；业务草稿仍保存在服务器。");}
    currentDocument.current = next;setDocument(next);
  },[storageKey]);
  const update = useCallback((owner: FlowEntry, transform: (value: FlowEntry) => FlowEntry) => {
    const latest = currentDocument.current;
    const saved = transform(latest.entries[owner.id] ?? owner);
    persist({...latest,active:indexEntry(latest.active,saved),entries:{...latest.entries,[saved.id]:saved}});
    return saved;
  },[persist]);
  const value = useMemo<PublishingFlow>(() => {
    const owner = entry;
    return {
      taskId:owner.id,scopeKey:workspaceKey,agentId:owner.agentId,pending:false,outcomePending:false,
      selections:owner.values,resources:owner.resources as PublishingResource[],records:owner.records,
      async ensureTask() {update(owner,current=>current);return owner.id;},
      setSummary:()=>{},
      async saveSelections(values) {update(owner,current=>({...current,step:"media-selection",values:{...current.values,...values}}));},
      async saveValues(values) {update(owner,current=>({...current,values:{...current.values,...values}}));},
      async record(record) {
        update(owner,current=>({...current,step:record.id.split(":")[0] ?? record.id,resources:mergeResources(current.resources,record.resources),records:[...current.records.filter(item=>item.id!==record.id),{id:record.id,label:record.label,detail:record.detail,status:"completed",timestamp:Date.now()}]}));
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
        const saved = {...source,records:[...source.records.filter(item=>item.id!==id),{id,label:input.title,status:"completed" as const,timestamp:Date.now(),targetTask:{conversationId:target.id,agentId:target.agentId}}]};
        persist({...latest,active:indexEntry(indexEntry(latest.active,saved),target),entries:{...latest.entries,[source.id]:saved,[target.id]:target},handoffs:{...latest.handoffs,[handoffKey]:target.id}});
        if (currentEntry.current.id !== owner.id) return;
        url.searchParams.set("workbenchTask",target.id);
        navigate(`${url.pathname}${url.search}${url.hash}`);
      },
    };
  },[entry,scope.key,workspaceKey,navigate,persist,update]);
  return <PublishingFlowProvider value={value}>{children}</PublishingFlowProvider>;
}
