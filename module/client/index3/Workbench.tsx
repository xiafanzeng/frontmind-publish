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

type ResumeRow = {
  key: string;
  title: string;
  /** 0=编辑稿件；1=选择媒体（已冻结待投放）；2=配置标题（该稿有已就绪的投放草稿）。 */
  step: 0 | 1 | 2;
  version: number;
  updatedAt: string;
  wordCount?: number;
  href: string;
  actionLabel: string;
};

/** index3 发布工作台: compact heading, status strip, per-article resume list and problem batches. */
export default function Index3Workbench() {
  const gateway = usePublisherGateway();
  const load = useCallback(async (signal: AbortSignal) => {
    // 待继续的稿件按“真实存在的稿件”计数与展示（与管理稿件一致）；
    // 投放草稿不再单独成行计数，只用于把对应稿件的步骤条推进到配置标题。
    // 失败批次需要精确总数（recentBatches 只有最近 5 条），按状态各取一页。
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
      problemBatches: problemLists
        .flatMap((list) => list.items)
        .sort((left, right) => (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt)),
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

  const { dashboard, problemTotal, problemBatches } = data;
  const processingCount = dashboard.processingBatchCount ?? dashboard.processingBatches.length;

  // 与“管理稿件”一致的可继续口径：编辑中与已冻结（待投放）都算待继续。
  const resumableArticles = data.articles.filter(
    (article) => article.status === "draft" || article.status === "frozen",
  );

  // 投放草稿（服务端仅返回最近数条）按 标题+版本 折叠进对应稿件：
  // 仅当该组合在稿件中唯一对应时才推进步骤显示，避免同名稿件误关联。
  const readyDrafts = (dashboard.resumableDrafts ?? []).filter((draft) => draft.status === "ready");
  const draftFor = (article: { title: string; currentVersion: number }) => {
    const matched = readyDrafts.filter(
      (draft) => draft.articleTitle === article.title && draft.articleVersion === article.currentVersion,
    );
    if (matched.length !== 1) return undefined;
    const sameTitle = resumableArticles.filter(
      (item) => item.title === article.title && item.currentVersion === article.currentVersion,
    );
    return sameTitle.length === 1 ? matched[0] : undefined;
  };

  const rows: ResumeRow[] = resumableArticles.map((article) => {
    const readyDraft = article.status === "frozen" ? draftFor(article) : undefined;
    return {
      key: `article-${article.id}`,
      title: article.title,
      step: article.status === "frozen" ? (readyDraft ? 2 : 1) : 0,
      version: article.currentVersion,
      updatedAt: article.updatedAt,
      ...(article.wordCount ? { wordCount: article.wordCount } : {}),
      ...(readyDraft
        ? {
            href: `/publishing/drafts/${encodeURIComponent(readyDraft.id)}/titles`,
            actionLabel: "继续配置",
          }
        : article.status === "frozen" && article.currentVersionId
          ? {
              href: `/publishing/media?articleVersion=${encodeURIComponent(article.currentVersionId)}`,
              actionLabel: "继续投放",
            }
          : {
              href: `/publishing/articles/${encodeURIComponent(article.id)}/edit`,
              actionLabel: "继续编辑",
            }),
    };
  });
  // 与“管理稿件”页统一的排序：最近修改时间倒序（最新在前）。
  rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const visibleRows = rows.slice(0, RESUME_DISPLAY_LIMIT);

  return (
    <>
      <PageHeading title="发布工作台">
        <Link className="btn primary" href="/publishing/articles/new">
          <Icon name="plus" />编辑新稿件
        </Link>
      </PageHeading>

      <div className="work-status" aria-label="工作台任务摘要">
        <div className="status-item">待继续的稿件 <strong>{rows.length}</strong></div>
        <div className="status-item">需处理的投放 <strong className={problemTotal ? "warning-text" : undefined}>{problemTotal}</strong></div>
        <div className="status-item">正在发布 <strong>{processingCount}</strong></div>
      </div>

      <section className="panel" aria-label="待继续的稿件">
        <div className="panel-header">
          <h2>待继续的稿件</h2>
          <Link className="btn small primary" href="/publishing/articles">查看全部</Link>
        </div>
        {visibleRows.length ? (
          <div className="task-list">
            {visibleRows.map((row) => (
              <article className="task-row" key={row.key}>
                <div>
                  <h3>{row.title}</h3>
                  <div className="task-meta">
                    <MiniFlowSteps step={row.step} />
                    <span>v{row.version}</span>
                    {row.wordCount ? <span>{row.wordCount.toLocaleString("zh-CN")} 字</span> : null}
                    <span>{publishingDateTime(row.updatedAt)}</span>
                  </div>
                </div>
                <Link className="btn small primary" href={row.href}>
                  {row.actionLabel}
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

      <section className="panel" aria-label="需处理的投放">
        <div className="panel-header">
          <h2>需处理的投放</h2>
          <Link className="btn small primary" href="/publishing/articles/records">全部发布记录</Link>
        </div>
        {problemBatches.length ? (
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
                {problemBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <Link className="link neutral table-title" href={`/publishing/publications/${encodeURIComponent(batch.id)}`}>
                        {batch.articleTitle}
                      </Link>
                      <div className="table-sub">发布批次 · {batch.itemCount} 家媒体</div>
                    </td>
                    <td className="right numeric">{money(batch.totalTenThousandths)}</td>
                    <td><Badge tone={batchBadge(batch.status).tone}>{batchBadge(batch.status).label}</Badge></td>
                    <td className="small muted numeric">{publishingDateTime(batch.updatedAt ?? batch.createdAt)}</td>
                    <td className="right">
                      <Link className="btn small primary" href={`/publishing/publications/${encodeURIComponent(batch.id)}`}>查看详情</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>暂无需要处理的投放</h3>
            <p>发布批次出现失败或需处理项目时会显示在这里。</p>
            <Link className="btn" href="/publishing/articles/records">查看发布记录</Link>
          </div>
        )}
      </section>
    </>
  );
}
