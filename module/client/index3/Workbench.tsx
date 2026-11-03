import { useCallback } from "react";
import { Link } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { PublishingError } from "../components/PublishingUi";
import { publishingDateTime } from "../types";
import { batchBadge, problemStatuses } from "./adapters";
import { Badge, Icon, PageHeading, money } from "./ui";

/** index3 发布工作台: compact heading, status strip, task cards and recent batches. */
export default function Index3Workbench() {
  const gateway = usePublisherGateway();
  const load = useCallback((signal: AbortSignal) => gateway.getDashboard(signal), [gateway]);
  const query = usePublisherQuery(load, "index3-workbench");

  if (query.loading) return <div className="empty"><h3>正在读取工作台…</h3></div>;
  if (query.error) {
    return (
      <PublishingError
        error={query.error}
        onRetry={query.reload}
      />
    );
  }
  const data = query.data;
  if (!data) return null;

  const drafts = data.resumableDrafts;
  const articles = data.resumableArticles;
  const resumeCount = drafts.length + articles.length;
  const problems = data.recentBatches.filter((batch) => problemStatuses.includes(batch.status));
  const firstProblem = problems[0];

  return (
    <>
      <PageHeading title="发布工作台">
        <Link className="btn primary" href="/publishing/articles/new">
          <Icon name="plus" />编辑新稿件
        </Link>
      </PageHeading>

      <div className="work-status" aria-label="工作台任务摘要">
        <div className="status-item">待继续的稿件 <strong>{resumeCount}</strong></div>
        <div className="status-item">需处理的投放 <strong className={problems.length ? "warning-text" : undefined}>{problems.length}</strong></div>
        <div className="status-item">正在发布 <strong>{data.processingBatches.length}</strong></div>
      </div>

      <div className={`work-grid ${firstProblem ? "" : "is-single"}`}>
        <section className="panel" aria-label="待继续的稿件">
          <div className="panel-header">
            <h2>待继续的稿件</h2>
            <Link className="link" href="/publishing/articles">查看全部</Link>
          </div>
          {resumeCount ? (
            <div className="task-list">
              {drafts.map((draft) => (
                <article className="task-row" key={draft.id}>
                  <div>
                    <h3>{draft.articleTitle}</h3>
                    <div className="task-meta">
                      <Badge tone={draft.status === "ready" ? "warning" : ""}>{draft.status === "ready" ? "待预检" : "待继续"}</Badge>
                      <span>v{draft.articleVersion}</span>
                      <span>{publishingDateTime(draft.updatedAt)}</span>
                    </div>
                  </div>
                  <Link
                    className="btn small"
                    href={`/publishing/drafts/${encodeURIComponent(draft.id)}/${draft.status === "ready" ? "review" : "media"}`}
                  >
                    继续配置
                  </Link>
                </article>
              ))}
              {articles.map((article) => (
                <article className="task-row" key={article.id}>
                  <div>
                    <h3>{article.title}</h3>
                    <div className="task-meta">
                      <Badge tone={article.status === "frozen" ? "warning" : ""}>{article.status === "frozen" ? "待投放" : "编辑中"}</Badge>
                      <span>v{article.currentVersion}</span>
                      <span>{article.wordCount.toLocaleString("zh-CN")} 字</span>
                      <span>{publishingDateTime(article.updatedAt)}</span>
                    </div>
                  </div>
                  <Link className="btn small" href={`/publishing/articles/${encodeURIComponent(article.id)}/edit`}>
                    继续编辑
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty">
              <h3>暂无待继续的稿件</h3>
              <p>导入或新建稿件后，可在这里继续编辑与投放。</p>
            </div>
          )}
        </section>

        {firstProblem ? (
          <section className="panel" aria-label="需要处理">
            <div className="panel-header">
              <h2>需要处理</h2>
              <span className="tag">{problems.length} 项</span>
            </div>
            <div className="exception">
              <Badge tone={batchBadge(firstProblem.status).tone}>{batchBadge(firstProblem.status).label}</Badge>
              <h3>{firstProblem.articleTitle}</h3>
              <p className="small muted">{firstProblem.itemCount} 家媒体 · 已成功 {firstProblem.successCount} 家</p>
              <div className="exception-reason">
                有 {firstProblem.failedCount + firstProblem.unknownCount} 家媒体未发布成功。
                请查看发布详情中的失败原因，处理后重新提交失败项。
              </div>
              <Link className="btn small" href={`/publishing/publications/${encodeURIComponent(firstProblem.id)}`}>
                查看原因与处理方式
              </Link>
            </div>
            <div className="exception-foot">
              <Icon name="info" />已成功的发布不会重复提交。
            </div>
          </section>
        ) : null}
      </div>

      <section className="panel" aria-label="最近投放">
        <div className="panel-header">
          <h2>最近投放</h2>
          <Link className="link" href="/publishing/articles/records">全部发布记录</Link>
        </div>
        {data.recentBatches.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">最近投放列表</caption>
              <thead>
                <tr>
                  <th>稿件 / 批次</th>
                  <th className="right">金额</th>
                  <th>执行状态</th>
                  <th>更新时间</th>
                  <th className="right">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.recentBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <Link className="link neutral table-title" href={`/publishing/publications/${encodeURIComponent(batch.id)}`}>
                        {batch.articleTitle}
                      </Link>
                      <div className="table-sub">发布批次 · {batch.itemCount} 家媒体</div>
                    </td>
                    <td className="right numeric">{money(batch.totalTenThousandths)}</td>
                    <td><Badge tone={batchBadge(batch.status).tone}>{batchBadge(batch.status).label}</Badge></td>
                    <td className="small muted numeric">{publishingDateTime(batch.createdAt)}</td>
                    <td className="right">
                      <Link className="link" href={`/publishing/publications/${encodeURIComponent(batch.id)}`}>查看详情</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>暂无发布订单</h3>
            <p>完成投放并生成发布批次后，订单会显示在这里。</p>
            <Link className="btn" href="/publishing/articles/records">查看发布记录</Link>
          </div>
        )}
      </section>
    </>
  );
}
