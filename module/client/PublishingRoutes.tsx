import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { Link, Redirect, Route, Switch, useLocation, useSearch } from "wouter";
import { FileText, LayoutDashboard, LibraryBig } from "lucide-react";

import { projectWorkspaceUrl } from "./host";
import type { PublisherGateway } from "./gateway";
import { PublishingGatewayProvider } from "./PublishingContext";
import { PublishingLoading } from "./components/PublishingUi";
import "./publishing.tokens.css";
import "./publishing.core.css";
import "./publishing.workflow.css";
import "./publishing.media.css";
import "./publishing.records.css";
import "./publishing.admin.css";
import "./publishing.conversation.css";
import "./publishing.market.css";

const SourceMatrixPage = lazy(() => import("./source-matrix/SourceMatrixPage"));
const WorkbenchPage = lazy(() => import("./pages/WorkbenchPage"));
const LegacyPublicationListRedirect = lazy(() =>
  import("./pages/WorkbenchPage").then((module) => ({
    default: module.LegacyPublicationListRedirect,
  })),
);
const ArticlesPage = lazy(() => import("./pages/ArticlesPage"));
const PublicationsPage = lazy(() => import("./pages/PublicationsPage"));
const ReviewPage = lazy(() => import("./pages/ReviewPage"));
const ImportPage = lazy(() => import("./pages/ImportPage"));
const ArticleEditorPage = lazy(() => import("./pages/ArticleEditorPage"));
const MediaLibraryPage = lazy(() => import("./pages/MediaLibraryPage"));
const DraftConversationPage = lazy(
  () => import("./pages/DraftConversationPage"),
);
const PublicationDetailPage = lazy(
  () => import("./pages/PublicationDetailPage"),
);

export type PublishingRoutesProps = {
  gateway: PublisherGateway;
};

export default function PublishingRoutes({ gateway }: PublishingRoutesProps) {
  const search=useSearch();
  const matrixDraftHref=(draftId:string)=>{const params=new URLSearchParams(search);params.set("draftId",draftId);return projectWorkspaceUrl("/publishing/source-matrix?"+params.toString());};
  return (
    <PublishingGatewayProvider gateway={gateway}>
      <PublishingWorkspaceShell>
        <Suspense
          fallback={
            <div className="publishing-page publishing-page-loading">
              <PublishingLoading label="正在准备媒体发布工作台…" />
            </div>
          }
        >
          <>
          <Switch>
            <Route path="/publishing/source-industry"><SourceMatrixPage view="industry" /></Route>
            <Route path="/publishing/source-matrix"><SourceMatrixPage /></Route>
            <Route path="/publishing/source-analysis"><SourceMatrixPage view="analysis" /></Route>
            <Route path="/publishing/source-report"><SourceMatrixPage view="report" /></Route>
            <Route path="/publishing/articles/new/import">
              <ImportPage />
            </Route>
            <Route path="/publishing/articles/:articleId/edit">
              {(params) => <ArticleEditorPage articleId={params.articleId} />}
            </Route>
            <Route path="/publishing/articles">
              <ArticlesPage />
            </Route>
            <Route path="/publishing/media/matrix"><SourceMatrixPage /></Route>
            <Route path="/publishing/media/sources"><SourceMatrixPage view="analysis" /></Route>
            <Route path="/publishing/media/industry"><SourceMatrixPage view="industry" /></Route>
            <Route path="/publishing/media/report"><SourceMatrixPage view="report" /></Route>
            <Route path="/publishing/drafts/:draftId/media/matrix">
              {(params) => <Redirect to={matrixDraftHref(params.draftId)} />}
            </Route>
            <Route path="/publishing/media/:view">
              {(params) => <MediaLibraryPage view={(["home","owned","third","cart"] as const).find(v=>v===params.view)??"third"} />}
            </Route>
            <Route path="/publishing/drafts/:draftId/media/:view">
              {(params) => <MediaLibraryPage draftId={params.draftId} view={(["home","owned","third","cart"] as const).find(v=>v===params.view)??"third"} />}
            </Route>
            <Route path="/publishing/media">
              <MediaLibraryPage view="home" />
            </Route>
            <Route path="/publishing/drafts/:draftId/media">
              {(params) => <MediaLibraryPage draftId={params.draftId} />}
            </Route>
            <Route path="/publishing/drafts/:draftId/titles">
              {(params) => (
                <DraftConversationPage
                  draftId={params.draftId}
                  initialStage="titles"
                />
              )}
            </Route>
            <Route path="/publishing/drafts/:draftId/review">
              {(params) => (
                <DraftConversationPage
                  draftId={params.draftId}
                  initialStage="review"
                />
              )}
            </Route>
            <Route path="/publishing/review/:draftId">
              {(params) => <ReviewPage draftId={params.draftId} />}
            </Route>
            <Route path="/publishing/records">
              <PublicationsPage />
            </Route>
            <Route path="/publishing/record/:batchId">
              {(params) => <PublicationDetailPage batchId={params.batchId} />}
            </Route>
            <Route path="/publishing/publications/:batchId">
              {(params) => <PublicationDetailPage batchId={params.batchId} />}
            </Route>
            <Route path="/publishing/publications">
              <LegacyPublicationListRedirect />
            </Route>
            <Route path="/publishing">
              <WorkbenchPage />
            </Route>
            <Route>
              <Redirect to="/publishing" />
            </Route>
          </Switch>
          </>
        </Suspense>
      </PublishingWorkspaceShell>
    </PublishingGatewayProvider>
  );
}

function PublishingWorkspaceShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const search = useSearch();
  const isRecords = location === "/publishing/records" ||
    (location === "/publishing" && new URLSearchParams(search.replace(/^\?/u, "")).get("tab") === "records");
  const isArticles = location.startsWith("/publishing/articles");
  const isMedia = location.startsWith("/publishing/media") || location.startsWith("/publishing/source-") || location.startsWith("/publishing/drafts/") && location.includes("/media");
  const articleNavActive = isArticles || location.startsWith("/publishing/drafts/") || location.startsWith("/publishing/review/");
  return (
    <div className="publishing-workspace-shell">
      <aside className="publishing-sidebar" aria-label="发布模块导航">
        <Link className="publishing-sidebar-brand" href="/publishing" aria-label="FrontMind Publish 首页">
          <span className="publishing-sidebar-brand-mark">FM</span>
          <span>FrontMind<small>Publish</small></span>
        </Link>
        <nav className="publishing-sidebar-nav">
          <Link className={`publishing-sidebar-link${location === "/publishing" && !isRecords ? " is-active" : ""}`} href="/publishing" aria-current={location === "/publishing" && !isRecords ? "page" : undefined}>
            <LayoutDashboard size={18} /><span>发布工作台</span>
          </Link>
          <Link className={`publishing-sidebar-link${articleNavActive ? " is-active" : ""}`} href="/publishing/articles" aria-current={articleNavActive ? "page" : undefined}>
            <FileText size={18} /><span>稿件</span>
          </Link>
          <div className="publishing-sidebar-subnav" aria-label="稿件子页面">
            <Link className={`publishing-sidebar-sublink${location === "/publishing/articles" && new URLSearchParams(search.replace(/^\?/u, "")).get("mode") !== "edit" ? " is-active" : ""}`} href="/publishing/articles">管理稿件</Link>
            <Link className={`publishing-sidebar-sublink${isArticles && new URLSearchParams(search.replace(/^\?/u, "")).get("mode") === "edit" ? " is-active" : ""}`} href="/publishing/articles?mode=edit">编辑稿件</Link>
            <Link className={`publishing-sidebar-sublink${isRecords ? " is-active" : ""}`} href="/publishing?tab=records">发布记录</Link>
          </div>
          <Link className={`publishing-sidebar-link${isMedia ? " is-active" : ""}`} href="/publishing/media" aria-current={isMedia ? "page" : undefined}>
            <LibraryBig size={18} /><span>媒体库</span>
          </Link>
        </nav>
        <div className="publishing-sidebar-foot">媒体发布模块<small>稿件 · 媒体 · 发布记录</small></div>
      </aside>
      <div className="publishing-workspace-content">{children}</div>
    </div>
  );
}
