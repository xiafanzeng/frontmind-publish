import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import {
  activeBusinessLeaf,
  businessLeafHref,
  BUSINESS_NAV_LEAVES,
} from "../module/client/businessNav";
import { requestWorkspaceNavigation, projectWorkspaceUrl } from "../module/client/host";
import type { PublisherGateway } from "../module/client/gateway";
import { DEFAULT_MEDIA_FILTERS } from "../module/client/queryState";
import type { MediaResource, PublisherMediaKind } from "../module/client/types";
import { PUBLISHING_HELP_DOCUMENT_URL } from "../module/client/help-links";
import {
  DialogProvider,
  Icon,
  ToastHost,
  Btn,
  useIndex3Dialog,
} from "../module/client/index3/ui";
import "../module/client/index3/index3.css";
import "./standalone.css";

const logo = new URL("../vendor/module-ui/src/assets/frontmind-wordmark.svg", import.meta.url).href;

/** Standalone shell transcribed from the week3 index3 reference (白底操作台).
 * The accent color is fixed to blue per the confirmed design decision. */
export default function PublishingShell({ gateway, preview, children }: {
  gateway: PublisherGateway | null; preview: boolean; children: ReactNode;
}) {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const [navOpen, setNavOpen] = useState(false);
  const leaf = activeBusinessLeaf(path, search);
  const titlesFlow = /\/titles$/.test(path.split("?")[0] ?? "");
  const currentLeaf = titlesFlow ? "article-edit" : leaf;
  const label = titlesFlow
    ? "配置标题"
    : BUSINESS_NAV_LEAVES.find((item) => item.id === leaf)?.label ?? "发布工作台";

  useEffect(() => setNavOpen(false), [path, search]);

  const go = useCallback((href: string) => {
    requestWorkspaceNavigation(() => navigate(projectWorkspaceUrl(href)));
  }, [navigate]);

  const navItem = (view: string, text: string, sub = true) => {
    const href = businessLeafHref(view, path, search) ?? "/publishing";
    const active = currentLeaf === view || (view === "editor" && titlesFlow);
    return (
      <a
        key={view}
        href={projectWorkspaceUrl(href)}
        className={`nav-item ${sub ? "sub" : ""} ${active ? "active" : ""}`.trim()}
        aria-current={active ? "page" : undefined}
        onClick={(event) => {
          event.preventDefault();
          go(href);
        }}
      >
        {text}
      </a>
    );
  };

  // V5：业务统一从发布工作台进入（先编辑稿件、再在流程内选择媒体），
  // 稿件与媒体选择不再是独立侧栏导航；对应页面经工作台列表与流程入口到达。
  const workbenchHref = businessLeafHref("workbench", path, search) ?? "/publishing";

  return (
    <div className="fm3-root publish-standalone" data-accent="blue">
      <DialogProvider>
        <a href="#main" className="skip">跳到主要内容</a>
      <div className={`mobile-overlay ${navOpen ? "visible" : ""}`} onClick={() => setNavOpen(false)} />
      <aside className={`sidebar ${navOpen ? "open" : ""}`} aria-label="主导航">
        <div className="brand">
          <img src={logo} alt="FrontMind" />
          <Btn variant="subtle icon-only nav-close" aria-label="关闭导航" onClick={() => setNavOpen(false)}>
            <Icon name="close" />
          </Btn>
        </div>
        <nav className="side-nav">
          {navItem("workbench", "发布工作台", false)}
        </nav>
        <div className="side-bottom">
          <div className="side-project">
            <Icon name="folder" />
            <span>项目总览<br /><strong style={{ fontWeight: 500, color: "var(--text)" }}>FrontMind 开发工作区</strong></span>
          </div>
          <div className="account">
            <span className="avatar">FM</span>
            <span><strong>FrontMind</strong><small>媒体发布工作台</small></span>
          </div>
        </div>
      </aside>
      <div className="shell">
        <div className="demo-bar">
          {preview ? "本地预览 · 合成示例数据，不会执行真实业务" : "媒体发布工作台"}
        </div>
        <header className="topbar">
          <div className="actions">
            <Btn variant="subtle icon-only mobile-menu" aria-label="打开导航" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
              <Icon name="menu" />
            </Btn>
            <div className="crumb">
              {/* V5：首段面包屑即发布工作台，可点击返回；工作台页本身不重复显示。 */}
              {label === "发布工作台" ? null : (
                <>
                  <a
                    href={projectWorkspaceUrl(workbenchHref)}
                    onClick={(event) => {
                      event.preventDefault();
                      go(workbenchHref);
                    }}
                  >
                    发布工作台
                  </a>
                  <span className="slash">/</span>
                </>
              )}
              <strong>{label}</strong>
            </div>
          </div>
          <div className="actions">
            <ShellSearch gateway={gateway} onNavigate={go} />
            <HelpButton />
          </div>
        </header>
        <main className="main publish-shell-main" id="main" tabIndex={-1}>
          <div className="publish-shell-content monitoring-module">{children}</div>
        </main>
      </div>
      <ToastHost />
    </DialogProvider>
    </div>
  );
}

function HelpButton() {
  const dialog = useIndex3Dialog();
  return (
    <Btn
      variant="subtle top-help"
      aria-label="帮助与使用说明"
      onClick={() => dialog.open({
        title: "如何使用这份工作台",
        body: (
          <div className="help-list">
            <section><h3>1. 从工作台继续任务</h3><p>工作台汇总待继续的稿件、需要处理的投放和最近发布批次，可一键回到对应步骤。</p></section>
            <section><h3>2. 编辑稿件</h3><p>支持从 .docx / .doc / .txt / .md 文档导入，或直接在线编辑正文；保存并冻结后进入媒体选择。</p></section>
            <section><h3>3. 信源矩阵与媒体库</h3><p>先在信源矩阵确认投放结构，再到媒体库筛选并选择第三方媒体。</p></section>
            <section><h3>4. 配置标题并提交</h3><p>逐媒体核对发布标题与费用，预检通过后确认提交，可在发布记录中追踪执行状态。</p></section>
          </div>
        ),
        footer: (
          <>
            <a className="btn" href={PUBLISHING_HELP_DOCUMENT_URL} target="_blank" rel="noopener noreferrer">
              <Icon name="external" />打开帮助文档
            </a>
            <Btn variant="primary" onClick={dialog.close}>关闭</Btn>
          </>
        ),
      })}
    >
      <Icon name="help" />
      <span className="top-help-text">帮助</span>
    </Btn>
  );
}

type SearchResult = { id: string; label: string; kind: string; href: string };

function ShellSearch({ gateway, onNavigate }: { gateway: PublisherGateway | null; onNavigate: (href: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MediaResource[]>([]);
  const kind: PublisherMediaKind = new URLSearchParams(useSearch()).get("kind") === "self_media" ? "self_media" : "news";
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!gateway || !q) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void gateway
        .listMedia({ ...DEFAULT_MEDIA_FILTERS, kind, query: q, page: 1, pageSize: 6 }, controller.signal)
        .then((data) => setItems(data.items.slice(0, 6)))
        .catch(() => setItems([]));
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, gateway, kind]);

  const q = query.trim();
  const functions: SearchResult[] = BUSINESS_NAV_LEAVES.filter((item) => !q || item.label.includes(q)).map((item) => ({
    id: item.id,
    label: item.label,
    kind: "功能",
    href: projectWorkspaceUrl(businessLeafHref(item.id, "/", "") ?? "/publishing"),
  }));
  const articleResult: SearchResult[] = q ? [{
    id: "find-articles",
    label: `在稿件管理中搜索“${q}”`,
    kind: "稿件",
    href: "/publishing/articles",
  }] : [];
  const mediaResults: SearchResult[] = q ? items.map((item) => ({
    id: `media-${item.id}`,
    label: item.name,
    kind: kind === "news" ? "新闻媒体" : "自媒体",
    href: "/publishing/media/third",
  })) : [];
  const results = [...functions, ...articleResult, ...mediaResults];

  return (
    <div className="search-box top-search" ref={box}>
      <Icon name="search" />
      <input
        className="control"
        placeholder="搜索稿件、媒体或功能"
        aria-label="搜索稿件、媒体或功能"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      <span className="kbd">Ctrl K</span>
      {open && q !== "" ? (
        <div className="publish-search-results fm3-search-results">
          {results.length ? (
            results.map((result) => (
              <button
                type="button"
                className="fm3-search-result"
                key={result.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  onNavigate(result.href);
                }}
              >
                <span>{result.label}</span>
                <small>{result.kind}</small>
              </button>
            ))
          ) : (
            <p className="fm3-search-empty">没有找到匹配结果，请换一个关键词。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
