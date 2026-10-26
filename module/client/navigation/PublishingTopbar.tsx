import { CircleHelp, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { BUSINESS_NAV_LEAVES, businessLeafHref, publishingBreadcrumbs } from "../businessNav";
import type { PublisherGateway } from "../gateway";
import { projectWorkspaceUrl } from "../host";
import { DEFAULT_MEDIA_FILTERS } from "../queryState";
import type { MediaResource, PublisherMediaKind } from "../types";
import { followPublishingLink } from "./PublishingNavigation";
import { PUBLISHING_HELP_DOCUMENT_URL } from "../help-links";
import "./publishing.navigation.css";

type Navigate = (href: string, after?: () => void) => void;
type Result = { id: string; label: string; kind: string; href: string };
type RemoteState = {
  gateway?: PublisherGateway | null; query: string; kind: PublisherMediaKind;
  items: MediaResource[]; total: number; loading: boolean; error?: string;
};

function withQuery(href: string, values: Record<string, string>) {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  Object.entries(values).forEach(([key, value]) => params.set(key, value));
  return `${path}?${params}`;
}

/** A single header composed by the host; only the supplied authenticated gateway is queried. */
export default function PublishingTopbar({ path, search, gateway, onNavigate }: {
  path: string; search: string; gateway: PublisherGateway | null; onNavigate: Navigate;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const resultId = useId();
  const q = query.trim();
  const kind: PublisherMediaKind = new URLSearchParams(search).get("kind") === "self_media" ? "self_media" : "news";
  const [remote, setRemote] = useState<RemoteState>({query:"",kind:"news",items:[],total:0,loading:false});

  useEffect(() => { setOpen(false); setActive(-1); }, [path, search, gateway]);
  useEffect(() => { setActive(-1); }, [query, composing]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || input.current?.closest("[inert]")) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        // Do not steal focus from another business dialog.
        const modalOpen = Array.from(document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"], [role="dialog"][data-state="open"], dialog[open]',
        )).some(dialog => !dialog.closest('[hidden],[inert],[aria-hidden="true"],[data-state="closed"]')
          && getComputedStyle(dialog).display !== "none" && getComputedStyle(dialog).visibility !== "hidden");
        if (modalOpen) return;
        event.preventDefault(); input.current?.focus(); setOpen(true);
      }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !region.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("pointerdown", outside); };
  }, []);

  useEffect(() => {
    if (!open || !q || composing || !gateway) return;
    const controller = new AbortController();
    let alive = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setRemote({gateway,query:q,kind,items:[],total:0,loading:true});
    const timer = setTimeout(() => {
      timeout = setTimeout(() => {
        if (!alive) return;
        controller.abort();
        setRemote({gateway,query:q,kind,items:[],total:0,loading:false,error:"媒体查询超时，请重试。"});
      }, 20_000);
      void Promise.resolve().then(() => {
        if (!alive || controller.signal.aborted) return;
        return gateway.listMedia({...DEFAULT_MEDIA_FILTERS,kind,query:q,page:1,pageSize:10},controller.signal);
      }).then(data => {
        if (!alive || controller.signal.aborted || !data) return;
        clearTimeout(timeout);
        setRemote({gateway,query:q,kind,items:data.items.slice(0,10),total:data.total,loading:false});
      }).catch(reason => {
        if (!alive || controller.signal.aborted) return;
        clearTimeout(timeout);
        setRemote({gateway,query:q,kind,items:[],total:0,loading:false,error:reason instanceof Error ? reason.message : "媒体查询失败，请重试。"});
      });
    }, 300);
    return () => { alive=false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [q, open, composing, gateway, kind, retry]);

  const currentRemote = remote.gateway === gateway && remote.query === q && remote.kind === kind && !composing ? remote : undefined;
  const functions: Result[] = composing ? [] : BUSINESS_NAV_LEAVES
    .filter(item => !q || item.label.includes(q))
    .map(item => ({id:item.id,label:item.label,kind:"功能",href:projectWorkspaceUrl(businessLeafHref(item.id,path,search)!)}));
  const articleResult: Result[] = q && !composing ? [{
    id:"find-articles",label:`在稿件管理中搜索“${q}”`,kind:"标题 / ID",
    href:projectWorkspaceUrl(withQuery(businessLeafHref("articles-manage",path,search)!,{query:q})),
  }] : [];
  const mediaResults: Result[] = q && currentRemote ? currentRemote.items.map(item => {
    const mediaQuery: Record<string,string> = {kind};
    if (item.externalResourceId) mediaQuery.batchQuery = item.externalResourceId;
    else mediaQuery.query = item.name;
    return {
      id:`media-${item.id}`,label:item.name,kind:kind === "news" ? "新闻媒体" : "自媒体",
      href:projectWorkspaceUrl(withQuery(businessLeafHref("third-media",path,search)!,mediaQuery)),
    };
  }) : [];
  const results = [...functions,...articleResult,...mediaResults];
  const selected = active >= 0 && active < results.length ? active : -1;
  useEffect(() => {
    if (open && selected >= 0) document.getElementById(`${resultId}-${selected}`)?.scrollIntoView?.({block:"nearest"});
  }, [open, selected, resultId]);
  const go = (result: Result) => onNavigate(result.href, () => {setOpen(false);input.current?.blur();});
  const crumbs = publishingBreadcrumbs(path,search);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return <header className="publish-topbar">
    <nav className="publish-topbar-breadcrumbs" aria-label="当前页面路径"><ol>
      {crumbs.map((item,index) => <li key={`${index}-${item.label}`}>
        {index > 0 && <span className="publish-topbar-separator" aria-hidden="true">/</span>}
        {item.href ? <a href={projectWorkspaceUrl(item.href)} onClick={event => followPublishingLink(event,projectWorkspaceUrl(item.href!),onNavigate)}>{item.label}</a>
          : <span aria-current="page">{item.label}</span>}
      </li>)}
    </ol></nav>
    <div className="publish-topbar-actions">
      <div className="publish-search" ref={region} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}>
        <div className="publish-search-field">
          <Search size={16} aria-hidden="true"/>
          <input ref={input} type="text" role="combobox" aria-label="搜索稿件、媒体或功能"
            aria-autocomplete="list" aria-expanded={open} aria-controls={open ? resultId : undefined}
            aria-activedescendant={open && selected >= 0 ? `${resultId}-${selected}` : undefined}
            placeholder="搜索稿件、媒体或功能" value={query} autoComplete="off"
            onFocus={() => setOpen(true)} onChange={event => {setQuery(event.target.value);setOpen(true);}}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={event => {setComposing(false);setQuery(event.currentTarget.value);}}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || composing || event.keyCode === 229) return;
              if (event.key === "Escape") {event.preventDefault();setOpen(false);setActive(-1);return;}
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();setOpen(true);
                if (results.length) setActive(value => event.key === "ArrowDown"
                  ? (value+1)%results.length : (value <= 0 ? results.length-1 : value-1));
              } else if (event.key === "Enter" && open && results.length) {
                event.preventDefault();go(results[selected >= 0 ? selected : 0]!);
              }
            }}/>
          {query && <button type="button" className="publish-search-clear" aria-label="清空搜索" onClick={() => {
            setQuery("");setActive(-1);input.current?.focus();setOpen(true);
          }}><X size={14} aria-hidden="true"/></button>}
          <kbd aria-hidden="true">{mac ? "⌘ K" : "Ctrl K"}</kbd>
        </div>
        {open && <div className="publish-search-results">
          <p id={`${resultId}-scope`}>功能入口 · 稿件在管理页按标题/ID筛选 · {kind === "news" ? "新闻媒体" : "自媒体"}名称查询，最多显示 10 项</p>
          <div id={resultId} role="listbox" aria-label="搜索结果" aria-describedby={`${resultId}-scope`}>
            {results.map((result,index) => <button type="button" role="option" tabIndex={-1}
              id={`${resultId}-${index}`} key={result.id} aria-selected={index===selected}
              className="publish-search-result" onMouseDown={event => event.preventDefault()} onClick={() => go(result)}>
              <span>{result.label}</span><small>{result.kind}</small>
            </button>)}
          </div>
          <div role="status" aria-live="polite">
            {composing ? <p>正在输入…</p> : q && !gateway ? <p>工作区连接就绪后可查询媒体，目前可搜索功能入口。</p>
              : q && (!currentRemote || currentRemote.loading) ? <p>正在查询媒体…</p>
              : q && currentRemote?.error ? <p>{currentRemote.error}</p>
              : q && !mediaResults.length ? <p>当前媒体类别没有匹配结果；也可通过上方入口搜索稿件。</p>
              : q && currentRemote ? <p>找到 {currentRemote.total} 项媒体，展示前 {mediaResults.length} 项；点击结果进入媒体列表，不会自动勾选。</p> : null}
          </div>
          {q && currentRemote?.error && <button type="button" className="publish-search-retry" onClick={() => setRetry(value=>value+1)}>重试媒体查询</button>}
        </div>}
      </div>
      <a className="publish-help-button" href={PUBLISHING_HELP_DOCUMENT_URL} target="_blank" rel="noopener noreferrer" onClick={()=>setOpen(false)} aria-label="帮助文档（在新标签页打开）"><CircleHelp size={16} aria-hidden="true"/><span>帮助文档</span></a>
    </div>
  </header>;
}
