import { lazy, Suspense } from "react";
import { Redirect, Route, Switch, useSearch } from "wouter";

import { projectWorkspaceUrl } from "./host";
import type { PublisherGateway } from "./gateway";
import { PublishingGatewayProvider } from "./PublishingContext";
import { PreparationContentLayout } from "./components/PreparationContentLayout";
/* The index3 reference sheet loads first: replaced pages are fully scoped under
 * .fm3-root, while the kept source-matrix / catalogue sheets win any tie. */
import "./index3/index3.css";
import "./publishing.tokens.css";
import "./publishing.core.css";
import "./publishing.workflow.css";
import "./publishing.media.css";
import "./publishing.records.css";
import "./publishing.admin.css";
import "./publishing.conversation.css";
import "./publishing.market.css";
import "./publishing.articles.css";
import "./publishing.white-theme.css";

const SourceMatrixPage = lazy(() => import("./source-matrix/SourceMatrixPage"));
const Index3Workbench = lazy(() => import("./index3/Workbench"));
const Index3Articles = lazy(() => import("./index3/Articles"));
const Index3Editor = lazy(() => import("./index3/Editor"));
const Index3Records = lazy(() => import("./index3/Records"));
const Index3Titles = lazy(() => import("./index3/Titles"));
const LegacyPublicationListRedirect = lazy(() =>
  import("./pages/WorkbenchPage").then((module) => ({
    default: module.LegacyPublicationListRedirect,
  })),
);
const ImportPage = lazy(() => import("./pages/ImportPage"));
const MediaLibraryPage = lazy(() => import("./pages/MediaLibraryPage"));
const PublicationDetailPage = lazy(
  () => import("./pages/PublicationDetailPage"),
);

export type PublishingRoutesProps = {
  gateway: PublisherGateway;
};

export default function PublishingRoutes({ gateway }: PublishingRoutesProps) {
  const search=useSearch();
  const titlesDraftHref=(draftId:string)=>projectWorkspaceUrl(
    `/publishing/drafts/${encodeURIComponent(draftId)}/titles${search ? `?${search.replace(/^\?/, '')}` : ''}`,
  )+(typeof window!=='undefined'?window.location.hash:'');
  const matrixDraftHref=(draftId:string,view:'analysis'|'matrix'='matrix')=>{
    const params=new URLSearchParams(search);
    const matrixTask=params.get("task") || params.get("matrixTask");
    params.set("draftId",draftId);
    params.delete("matrixTask");
    if(matrixTask)params.set("task",matrixTask);
    if(!['analysis','matrix'].includes(params.get('tab')??''))params.set('tab',view);
    return projectWorkspaceUrl("/publishing/source-matrix?"+params.toString())+(typeof window!=='undefined'?window.location.hash:'');
  };
  return (
    <PublishingGatewayProvider gateway={gateway}>
      <PreparationContentLayout>
        <Suspense
          fallback={
            <div className="empty" role="status">
              <h3>正在准备媒体发布工作台…</h3>
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
            <Route path="/publishing/articles/new">
              <Index3Editor articleId="new" />
            </Route>
            <Route path="/publishing/articles/records">
              <Index3Records />
            </Route>
            <Route path="/publishing/articles/edit">
              <Redirect to="/publishing/articles" />
            </Route>
            <Route path="/publishing/articles/:articleId/edit">
              {(params) => <Index3Editor articleId={params.articleId} />}
            </Route>
            <Route path="/publishing/articles">
              <Index3Articles />
            </Route>
            <Route path="/publishing/media/matrix"><SourceMatrixPage view="matrix" /></Route>
            <Route path="/publishing/media/sources"><SourceMatrixPage view="analysis" /></Route>
            <Route path="/publishing/media/industry"><SourceMatrixPage view="industry" /></Route>
            <Route path="/publishing/media/report"><SourceMatrixPage view="report" /></Route>
            <Route path="/publishing/drafts/:draftId/media/matrix">
              {(params) => <Redirect to={matrixDraftHref(params.draftId)} />}
            </Route>
            <Route path="/publishing/drafts/:draftId/media/sources">
              {(params) => <Redirect to={matrixDraftHref(params.draftId,'analysis')} />}
            </Route>
            <Route path="/publishing/drafts/:draftId/media/industry">
              {(params) => <Redirect to={matrixDraftHref(params.draftId,'analysis')} />}
            </Route>
            <Route path="/publishing/drafts/:draftId/media/report">
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
              {(params) => <MediaLibraryPage draftId={params.draftId} view="home" />}
            </Route>
            <Route path="/publishing/drafts/:draftId/titles">
              {(params) => <Index3Titles draftId={params.draftId} />}
            </Route>
            <Route path="/publishing/drafts/:draftId/review">
              {(params) => <Redirect replace to={titlesDraftHref(params.draftId)} />}
            </Route>
            <Route path="/publishing/review/:draftId">
              {(params) => <Redirect replace to={titlesDraftHref(params.draftId)} />}
            </Route>
            <Route path="/publishing/records">
              <Index3Records />
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
              <Index3Workbench />
            </Route>
            <Route>
              <Redirect to="/publishing" />
            </Route>
          </Switch>
          </>
        </Suspense>
      </PreparationContentLayout>
    </PublishingGatewayProvider>
  );
}

