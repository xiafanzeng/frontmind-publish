import { useCallback, useMemo, useState } from "react";
import { Link } from "wouter";

import {
  invalidatePublisherQueries,
  usePublisherGateway,
  usePublisherQuery,
} from "../PublishingContext";
import { PublishingError } from "../components/PublishingUi";
import { DEFAULT_PUBLICATION_FILTERS } from "../queryState";
import { publishingDateTime, type ArticleSummary, type PublicationBatchSummary } from "../types";
import { problemStatuses } from "./adapters";
import { Icon, PageHeading, SearchBox, money, toast } from "./ui";

/** V8：管理稿件每页条数与页码按钮分页。 */
const PAGE_SIZE = 10;

type Filter = "all" | "editing" | "succeeded" | "failed";

type UnifiedRow =
  | {
      kind: "article";
      key: string;
      articleId: string;
      title: string;
      version: number;
      wordCount: number;
      /** 全部稿件统一时间轴：稿件用最近修改。 */
      time: string;
      timeLabel: string;
      href: string;
    }
  | {
      kind: "batch";
      key: string;
      batchId: string;
      title: string;
      version: number;
      wordCount: null;
      amountTenThousandths: string;
      /** success | failed | partial_success | action_required */
      status: PublicationBatchSummary["status"];
      time: string;
      timeLabel: string;
    };

const batchStatusLabel: Record<PublicationBatchSummary["status"], string> = {
  queued: "需处理",
  processing: "需处理",
  success: "发布成功",
  failed: "全部失败",
  partial_success: "部分失败",
  action_required: "需处理",
};

/** index3 管理稿件: 待编辑/发布成功/发布失败统一列表（V8 重构，含分页）。 */
export default function Index3Articles() {
  const gateway = usePublisherGateway();
  const load = useCallback(async (signal: AbortSignal) => {
    // 稿件（待编辑）+ 成功批次 + 需处理批次（三种失败口径统一为“发布失败”分类）
    // + 工作台数据（仅用其中的就绪草稿做“直达配置标题”折叠，与工作台同口径）。
    const [articles, succeeded, dashboard, ...problemLists] = await Promise.all([
      gateway.listArticles(signal),
      gateway.listBatches({ ...DEFAULT_PUBLICATION_FILTERS, status: "success", page: 1, pageSize: 100 }, signal),
      gateway.getDashboard(signal),
      ...problemStatuses.map((status) =>
        gateway.listBatches({ ...DEFAULT_PUBLICATION_FILTERS, status, page: 1, pageSize: 100 }, signal),
      ),
    ]);
    const problems = problemLists
      .flatMap((list) => list.items)
      .sort((left, right) => (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt));
    return { articles, succeeded: succeeded.items, problems, dashboard };
  }, [gateway]);
  const query = usePublisherQuery(load, "index3-articles-v8");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const articles = query.data?.articles ?? [];
  const succeeded = query.data?.succeeded ?? [];
  const problems = query.data?.problems ?? [];

  // 稿件行：编辑/已冻结同属“待编辑”（可经流程回退互转）。按钮统一“继续投放”，
  // 目的地与工作台同口径：就绪草稿（标题+版本唯一匹配）直达配置标题，
  // 其余冻结稿进媒体选择，编辑中进编辑器。
  const articleRows: UnifiedRow[] = useMemo(() => {
    const readyDrafts = (query.data?.dashboard?.resumableDrafts ?? []).filter(
      (draft) => draft.status === "ready",
    );
    return articles.map((article) => {
      const readyMatched = readyDrafts.filter(
        (draft) => draft.articleTitle === article.title && draft.articleVersion === article.currentVersion,
      );
      const titleUnique =
        articles.filter((x) => x.title === article.title && x.currentVersion === article.currentVersion).length === 1;
      const readyDraft =
        article.status === "frozen" && readyMatched.length === 1 && titleUnique ? readyMatched[0]! : undefined;
      return {
        kind: "article" as const,
        key: `article-${article.id}`,
        articleId: article.id,
        title: article.title,
        version: article.currentVersion,
        wordCount: article.wordCount,
        time: article.updatedAt,
        timeLabel: publishingDateTime(article.updatedAt),
        href: readyDraft
          ? `/publishing/drafts/${encodeURIComponent(readyDraft.id)}/titles`
          : article.status === "frozen" && article.currentVersionId
            ? `/publishing/media?articleVersion=${encodeURIComponent(article.currentVersionId)}`
            : `/publishing/articles/${encodeURIComponent(article.id)}/edit`,
      };
    });
  }, [articles, query.data]);

  const succeededRows: UnifiedRow[] = useMemo(
    () =>
      succeeded
        .map((batch) => ({
          kind: "batch" as const,
          key: `batch-${batch.id}`,
          batchId: batch.id,
          title: batch.articleTitle,
          version: batch.articleVersion,
          wordCount: null as null,
          amountTenThousandths: batch.totalTenThousandths,
          status: batch.status,
          time: batch.updatedAt ?? batch.createdAt,
          timeLabel: publishingDateTime(batch.updatedAt ?? batch.createdAt),
        }))
        .sort((left, right) => right.time.localeCompare(left.time)),
    [succeeded],
  );

  const failedRows: UnifiedRow[] = useMemo(
    () =>
      problems
        .map((batch) => ({
          kind: "batch" as const,
          key: `batch-${batch.id}`,
          batchId: batch.id,
          title: batch.articleTitle,
          version: batch.articleVersion,
          wordCount: null as null,
          amountTenThousandths: batch.totalTenThousandths,
          status: batch.status,
          time: batch.updatedAt ?? batch.createdAt,
          timeLabel: publishingDateTime(batch.updatedAt ?? batch.createdAt),
        }))
        .sort((left, right) => right.time.localeCompare(left.time)),
    [problems],
  );

  const rowsByTab = useMemo(() => {
    switch (filter) {
      case "editing":
        return articleRows.slice().sort((l, r) => r.time.localeCompare(l.time));
      case "succeeded":
        return succeededRows;
      case "failed":
        return failedRows;
      default: {
        // 全部稿件：三类合并，统一按“最近修改”（成功/失败行的时间整合在此列）倒序。
        return [...articleRows, ...succeededRows, ...failedRows].sort((l, r) =>
          r.time.localeCompare(l.time),
        );
      }
    }
  }, [filter, articleRows, succeededRows, failedRows]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return rowsByTab;
    return rowsByTab.filter((row) => row.title.toLocaleLowerCase().includes(keyword));
  }, [rowsByTab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const switchTab = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };

  const tabs: Array<[Filter, string, number]> = [
    ["all", "全部稿件", articleRows.length + succeededRows.length + failedRows.length],
    ["editing", "待编辑", articleRows.length],
    ["succeeded", "发布成功", succeededRows.length],
    ["failed", "发布失败", failedRows.length],
  ];

  // V8：删除稿件（与工作台一致：软删除=归档，草稿从列表消失）。
  const removeArticle = async (row: Extract<UnifiedRow, { kind: "article" }>) => {
    const okDelete = window.confirm(
      `确定删除《${row.title}》吗？该草稿尚未交付媒体，删除后不再显示（已产生的发布记录不受影响）。`,
    );
    if (!okDelete) return;
    try {
      await gateway.deleteArticle(row.articleId);
      invalidatePublisherQueries(gateway);
      toast("已删除稿件。");
      query.reload();
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "删除失败，请重试。");
    }
  };

  return (
    <>
      <PageHeading title="管理稿件">
        <Link className="btn primary" href="/publishing/articles/new">
          <Icon name="plus" />编辑新稿件
        </Link>
      </PageHeading>

      <section className="panel">
        <div className="filter-tabs" aria-label="稿件状态">
          {tabs.map(([value, label, count]) => (
            <button
              type="button"
              key={value}
              className={`filter-tab ${filter === value ? "active" : ""}`}
              aria-pressed={filter === value}
              onClick={() => switchTab(value)}
            >
              {label}<span className="count numeric">{count}</span>
            </button>
          ))}
        </div>
        <div className="filters">
          <SearchBox value={search} onChange={(next) => { setSearch(next); setPage(1); }} placeholder="搜索稿件标题" />
          <span className="small muted" style={{ marginLeft: "auto" }}>{filtered.length} 篇稿件</span>
        </div>
        {query.loading ? (
          <div className="empty"><h3>正在读取稿件…</h3></div>
        ) : query.error ? (
          <div className="panel-body"><PublishingError error={query.error} onRetry={query.reload} /></div>
        ) : visible.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">稿件列表</caption>
              <thead>
                <tr>
                  <th style={{ width: "34%" }}>稿件标题</th>
                  <th>版本</th>
                  {filter === "failed" || filter === "succeeded" ? <th className="right">金额</th> : null}
                  <th>字数</th>
                  <th>状态</th>
                  <th>{filter === "succeeded" ? "发布时间" : filter === "failed" ? "失败时间" : "最近修改"}</th>
                  <th className="right">操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <UnifiedRowView key={row.key} row={row} tab={filter} onDelete={() => { void removeArticle(row as Extract<UnifiedRow, { kind: "article" }>); }} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>没有找到匹配的稿件</h3>
            <p>试试其他关键词，或清空搜索条件。</p>
            <button type="button" className="btn" onClick={() => setSearch("")}>清空搜索</button>
          </div>
        )}
        <div className="pagination">
          <span>共 {filtered.length} 篇</span>
          <div className="page-buttons" aria-label="分页">
            <button
              type="button"
              aria-label="上一页"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((n) => totalPages <= 8 || n === 1 || n === totalPages || Math.abs(n - currentPage) < 2)
              .map((n) => (
                <button
                  type="button"
                  key={n}
                  className={n === currentPage ? "active" : ""}
                  aria-current={n === currentPage ? "page" : undefined}
                  aria-label={`第 ${n} 页`}
                  onClick={() => setPage(n)}
                >{n}</button>
              ))}
            <button
              type="button"
              aria-label="下一页"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
            >›</button>
          </div>
        </div>
      </section>
    </>
  );
}

function UnifiedRowView({ row, tab, onDelete }: {
  row: UnifiedRow;
  tab: Filter;
  onDelete: () => void;
}) {
  if (row.kind === "article") {
    return (
      <tr>
        <td>
          <Link className="link neutral table-title" href={row.href}>
            {row.title}
          </Link>
        </td>
        <td className="small numeric">v{row.version}</td>
        {tab === "failed" || tab === "succeeded" ? <td /> : null}
        <td className="right numeric">{row.wordCount.toLocaleString("zh-CN")}</td>
        <td><span className="badge solid-blue">编辑中</span></td>
        <td className="small muted numeric">{row.timeLabel}</td>
        <td>
          <div className="table-action">
            <Link className="btn small primary compact" href={row.href}>继续投放</Link>
            <button type="button" className="btn small danger-solid compact" onClick={onDelete}>删除稿件</button>
          </div>
        </td>
      </tr>
    );
  }
  const statusClass = row.status === "success" ? "solid-green" : "solid-red";
  const statusText = batchStatusLabel[row.status];
  return (
    <tr>
      <td>
        <Link className="link neutral table-title" href={`/publishing/publications/${encodeURIComponent(row.batchId)}`}>
          {row.title}
        </Link>
      </td>
      <td className="small numeric">v{row.version}</td>
      <td className="right numeric">{money(row.amountTenThousandths)}</td>
      <td className="right numeric">—</td>
      <td><span className={`badge ${statusClass}`}>{statusText}</span></td>
      <td className="small muted numeric">{row.timeLabel}</td>
      <td className="right">
        <Link className="btn small primary compact" href={`/publishing/publications/${encodeURIComponent(row.batchId)}`}>查看详情</Link>
      </td>
    </tr>
  );
}
