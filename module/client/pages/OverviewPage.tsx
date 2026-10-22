import { ArrowRight, Clock3, FileText } from "lucide-react";
import { useCallback } from "react";
import { Link } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import {
  BatchStatusBadge,
  PublishingEmpty,
  PublishingError,
  PublishingLoading,
} from "../components/PublishingUi";
import { formatPublishingMoney, publishingDateTime } from "../types";
import { usePublishingSummary } from "../PublishingFlowContext";

export default function PublishingOverviewPage() {
  const gateway = usePublisherGateway();
  const load = useCallback(
    (signal: AbortSignal) => gateway.getDashboard(signal),
    [gateway],
  );
  const query = usePublisherQuery(load, "overview");
  usePublishingSummary({
    title: "发布工作台",
    items: [],
    note: "从稿件继续准备内容，并追踪可追溯的发布记录。",
  });

  return (
    <div className="publishing-page publishing-overview-page">
      {query.loading ? <PublishingLoading /> : null}
      {query.error ? (
        <PublishingError error={query.error} onRetry={query.reload} />
      ) : null}
      {query.data ? (
        <>
          <section className="publishing-overview-hero" aria-label="工作台摘要">
            <div>
              <span className="publishing-overview-kicker">FRONTMIND / PUBLISHING</span>
              <h1>从稿件，到可追溯的发布记录</h1>
              <p>继续准备真实稿件，查看每一笔发布任务及其执行结果。</p>
              <div className="publishing-inline-actions">
                <Link className="publishing-button publishing-button-primary" href="/publishing/articles/new/import">
                  <FileText size={16} /> 编辑新稿件
                </Link>
                <Link className="publishing-button publishing-button-secondary" href="/publishing?tab=records">
                  查看发布记录 <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          </section>
          <div className="publishing-overview-columns publishing-overview-primary-columns">
            <section className="publishing-panel" aria-label="待继续的稿件">
              <header className="publishing-panel-heading">
                <div>
                  <h2>待继续的稿件</h2>
                  <p>最近的稿件与投放草稿</p>
                </div>
                <Link href="/publishing/articles">查看全部</Link>
              </header>
              {query.data.resumableDrafts.length || query.data.resumableArticles.length ? (
                <div className="publishing-list">
                  {query.data.resumableDrafts.map((draft) => (
                    <Link
                      key={`draft-${draft.id}`}
                      className="publishing-list-row"
                      href={`/publishing/drafts/${encodeURIComponent(draft.id)}/${draft.status === "ready" ? "review" : "media"}`}
                    >
                      <span className="publishing-file-icon"><FileText size={20} /></span>
                      <span className="publishing-list-copy">
                        <strong>{draft.articleTitle}</strong>
                        <span>投放草稿 · v{draft.articleVersion} · {draft.status === "ready" ? "待预检" : "待继续"}</span>
                      </span>
                      <span className="publishing-row-time">{publishingDateTime(draft.updatedAt)}</span>
                      <ArrowRight size={17} />
                    </Link>
                  ))}
                  {query.data.resumableArticles.map((article) => (
                    <Link
                      key={`article-${article.id}`}
                      className="publishing-list-row"
                      href={`/publishing/articles/${encodeURIComponent(article.id)}/edit`}
                    >
                      <span className="publishing-file-icon"><FileText size={20} /></span>
                      <span className="publishing-list-copy">
                        <strong>{article.title}</strong>
                        <span>稿件 · {article.wordCount.toLocaleString("zh-CN")} 字 · v{article.currentVersion}</span>
                      </span>
                      <span className="publishing-row-time">{publishingDateTime(article.updatedAt)}</span>
                      <ArrowRight size={17} />
                    </Link>
                  ))}
                </div>
              ) : (
                <PublishingEmpty
                  title="暂无待继续的稿件"
                  description="导入或新建稿件后，可在这里继续编辑与投放。"
                />
              )}
            </section>
            <section className="publishing-panel" aria-label="最近订单">
              <header className="publishing-panel-heading">
                <div>
                  <h2>最近订单</h2>
                  <p>最近发布批次及其状态</p>
                </div>
                <Link href="/publishing?tab=records">查看全部</Link>
              </header>
              {query.data.recentBatches.length ? (
                <div className="publishing-list">
                  {query.data.recentBatches.map((batch) => (
                    <Link
                      key={batch.id}
                      className="publishing-list-row"
                      href={`/publishing/publications/${encodeURIComponent(batch.id)}`}
                    >
                      <span className="publishing-file-icon"><Clock3 size={20} /></span>
                      <span className="publishing-list-copy">
                        <strong>{batch.articleTitle}</strong>
                        <span>{batch.id} · {batch.itemCount} 家媒体 · {publishingDateTime(batch.createdAt)}</span>
                      </span>
                      <BatchStatusBadge status={batch.status} />
                      <ArrowRight size={17} />
                    </Link>
                  ))}
                </div>
              ) : (
                <PublishingEmpty
                  title="暂无发布订单"
                  description="完成投放并生成发布批次后，订单会显示在这里。"
                  action={<Link className="publishing-button publishing-button-secondary" href="/publishing?tab=records">查看发布记录</Link>}
                />
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
