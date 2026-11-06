import { useCallback } from "react";
import { Link } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { PublishingError } from "../components/PublishingUi";
import { DEFAULT_PUBLICATION_FILTERS } from "../queryState";
import { publishingDateTime } from "../types";
import { batchBadge } from "./adapters";
import { Badge, Icon, MiniFlowSteps, PageHeading, money } from "./ui";

/** 工作台“待继续的稿件”最多展示的行数；完整列表经“查看全部”进入管理稿件。 */
const RESUME_DISPLAY_LIMIT = 6;
/** 需处理（失败/部分失败/需处理）批次的状态口径，与统计卡和发布记录“需处理”页签一致。 */
const PROBLEM_BATCH_STATUSES = ["failed", "partial_success", "action_required"] as const;

type ResumeRow =
  | {
      kind: "article";
      key: string;
      title: string;
      /** 0=编辑稿件；冻结稿已可进入选择媒体。 */
      step: 0 | 1;
      version: number;
      updatedAt: string;
      wordCount?: number;
      href: string;
      actionLabel: string;
    }
  | {
      kind: "draft";
      key: string;
      title: string;
      /** 1=选择媒体（draft）；2=配置标题（ready）。 */
      step: 1 | 2;
      version: number;
      updatedAt: string;
      href: string;
    }
  | {
      kind: "problem";
      key: string;
      title: string;
      /** 已提交过发布、停在配置标题阶段且失败。 */
      step: 2;
      version: number;
      updatedAt: string;
      itemCount: number;
      successCount: number;
      href: string;
    };

/** index3 发布工作台: compact heading, status strip, merged resume list and recent batches. */
export default function Index3Workbench() {
  const gateway = usePublisherGateway();
  const load = useCallback(async (signal: AbortSignal) => {
    // 失败批次需要精确总数（recentBatches 只有最近 5 条，不足以统计需处理数量），
    // 按状态各取一页；稿件取全量以获得准确的待继续总数与统一排序。
    const [dashboard, articles, ...problemLists] = await Promise.all([
      gateway.getDashboard(signal),
      gateway.listArticles(signal),
      ...PROBLEM_BATCH_STATUSES.map((status) =>
        gateway.listBatches({ ...DEFAULT_PUBLICATION_FILTERS, status, page: 1, pageSize: 5 }, signal),
      ),
    ]);
    return {
      dashboard,
      articles,
      problemBatches: problemLists.flatMap((list) => list.items),
      problemTotal: problemLists.reduce((total, list) => total + list.total, 0),
    };
  }, [gateway]);
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

  const { dashboard, problemTotal } = data;
  const drafts = dashboard.resumableDrafts ?? [];
  const processingCount = dashboard.processingBatchCount ?? dashboard.processingBatches.length;

  // 与“管理稿件”一致的可继续口径：编辑中与已冻结（待投放）都算待继续。
  const resumableArticles = data.articles.filter(
    (article) => article.status === "draft" || article.status === "frozen",
  );
  // 统计卡使用精确总数：草稿列表受服务端条数限制，改用 resumableDraftCount；
  // 失败批次用按状态筛选的 total 汇总，展示列表只是同一数据的顶部切片。
  const resumeTotal =
    (dashboard.resumableDraftCount ?? drafts.length) + resumableArticles.length + problemTotal;

  const rows: ResumeRow[] = [
    ...resumableArticles.map<ResumeRow>((article) => ({
      kind: "article",
      key: `article-${article.id}`,
      title: article.title,
      step: article.status === "frozen" ? 1 : 0,
      version: article.currentVersion,
      updatedAt: article.updatedAt,
      ...(article.status === "frozen" && article.currentVersionId
        ? {
            href: `/publishing/media?articleVersion=${encodeURIComponent(article.currentVersionId)}`,
            actionLabel: "继续投放",
          }
        : {
            href: `/publishing/articles/${encodeURIComponent(article.id)}/edit`,
            actionLabel: "继续编辑",
          }),
      ...(article.wordCount ? { wordCount: article.wordCount } : {}),
    })),
    ...drafts.map<ResumeRow>((draft) => ({
      kind: "draft",
      key: `draft-${draft.id}`,
      title: draft.articleTitle,
      step: draft.status === "ready" ? 2 : 1,
      version: draft.articleVersion,
      updatedAt: draft.updatedAt,
      href: `/publishing/drafts/${encodeURIComponent(draft.id)}/${draft.status === "ready" ? "titles" : "media"}`,
    })),
    ...data.problemBatches.map<ResumeRow>((batch) => ({
      kind: "problem",
      key: `problem-${batch.id}`,
      title: batch.articleTitle,
      step: 2,
      version: batch.articleVersion,
      updatedAt: batch.updatedAt ?? batch.createdAt,
      itemCount: batch.itemCount,
      successCount: batch.successCount,
      href: `/publishing/publications/${encodeURIComponent(batch.id)}`,
    })),
  ];
  // 展示顺序：失败批次置顶（需要优先处理，全部展示，避免被普通条数上限截掉），
  // 其余按最近修改时间倒序取前几条——普通稿件之间的相对顺序与“管理稿件”页一致。
  const byUpdatedAtDesc = (left: ResumeRow, right: ResumeRow) =>
    right.updatedAt.localeCompare(left.updatedAt);
  const visibleRows = [
    ...rows.filter((row) => row.kind === "problem").sort(byUpdatedAtDesc),
    ...rows
      .filter((row) => row.kind !== "problem")
      .sort(byUpdatedAtDesc)
      .slice(0, RESUME_DISPLAY_LIMIT),
  ];

  const recentBatches = dashboard.recentBatches ?? [];

  return (
    <>
      <PageHeading title="发布工作台">
        <Link className="btn primary" href="/publishing/articles/new">
          <Icon name="plus" />编辑新稿件
        </Link>
      </PageHeading>

      <div className="work-status" aria-label="工作台任务摘要">
        <div className="status-item">待继续的稿件 <strong>{resumeTotal}</strong></div>
        <div className="status-item">需处理的投放 <strong className={problemTotal ? "warning-text" : undefined}>{problemTotal}</strong></div>
        <div className="status-item">正在发布 <strong>{processingCount}</strong></div>
      </div>

      <section className="panel" aria-label="待继续的稿件">
        <div className="panel-header">
          <h2>待继续的稿件</h2>
          <Link className="link" href="/publishing/articles">查看全部</Link>
        </div>
        {visibleRows.length ? (
          <div className="task-list">
            {visibleRows.map((row) => (
              <ResumeTaskRow key={row.key} row={row} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <h3>暂无待继续的稿件</h3>
            <p>导入或新建稿件后，可在这里继续编辑与投放。</p>
          </div>
        )}
      </section>

      <section className="panel" aria-label="需处理的投放">
        <div className="panel-header">
          <h2>需处理的投放</h2>
          <Link className="link" href="/publishing/articles/records">全部发布记录</Link>
        </div>
        {recentBatches.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">需处理的投放列表</caption>
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
                {recentBatches.map((batch) => (
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

/** 单条待继续稿件：迷你步骤条标识当前阶段；发布失败的稿件加大红色标识。 */
function ResumeTaskRow({ row }: { row: ResumeRow }) {
  return (
    <article className="task-row">
      <div>
        <h3>{row.title}</h3>
        <div className="task-meta">
          <MiniFlowSteps step={row.step} failed={row.kind === "problem"} />
          {row.kind === "problem" ? <span className="publish-fail-badge">发布失败</span> : null}
          <span>v{row.version}</span>
          {row.kind === "article" && row.wordCount ? (
            <span>{row.wordCount.toLocaleString("zh-CN")} 字</span>
          ) : null}
          <span>{publishingDateTime(row.updatedAt)}</span>
        </div>
        {row.kind === "problem" ? (
          <div className="task-submeta">
            {row.itemCount} 家媒体 · 已成功 {row.successCount} 家，查看失败原因后可重新提交失败项。
          </div>
        ) : null}
      </div>
      <Link className="btn small" href={row.href}>
        {row.kind === "article" ? row.actionLabel : row.kind === "draft" ? "继续配置" : "查看失败原因"}
      </Link>
    </article>
  );
}
