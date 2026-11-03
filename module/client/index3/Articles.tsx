import { useCallback, useMemo, useState } from "react";
import { Link } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { PublishingError } from "../components/PublishingUi";
import { publishingDateTime, type ArticleSummary } from "../types";
import { articleBadge } from "./adapters";
import { Badge, Icon, PageHeading, SearchBox } from "./ui";

type Filter = "all" | "draft" | "frozen";

/** index3 管理稿件: status tabs, search and the compact article table. */
export default function Index3Articles() {
  const gateway = usePublisherGateway();
  const load = useCallback((signal: AbortSignal) => gateway.listArticles(signal), [gateway]);
  const query = usePublisherQuery(load, "index3-articles");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const articles = query.data ?? [];
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return articles.filter((article) => {
      if (filter === "draft" && article.status === "frozen") return false;
      if (filter === "frozen" && article.status !== "frozen") return false;
      if (keyword && !`${article.title}`.toLocaleLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [articles, filter, search]);

  const tabs: Array<[Filter, string, number]> = [
    ["all", "全部稿件", articles.length],
    ["draft", "待继续", articles.filter((a) => a.status !== "frozen").length],
    ["frozen", "已冻结", articles.filter((a) => a.status === "frozen").length],
  ];

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
              onClick={() => setFilter(value)}
            >
              {label}<span className="count numeric">{count}</span>
            </button>
          ))}
        </div>
        <div className="filters">
          <SearchBox value={search} onChange={setSearch} placeholder="搜索稿件标题" />
          <span className="small muted" style={{ marginLeft: "auto" }}>{articles.length} 篇稿件</span>
        </div>
        {query.loading ? (
          <div className="empty"><h3>正在读取稿件…</h3></div>
        ) : query.error ? (
          <div className="panel-body"><PublishingError error={query.error} onRetry={query.reload} /></div>
        ) : filtered.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">稿件列表</caption>
              <thead>
                <tr>
                  <th style={{ width: "43%" }}>稿件标题</th>
                  <th>版本</th>
                  <th className="right">字数</th>
                  <th>状态</th>
                  <th>最近修改</th>
                  <th className="right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((article) => (
                  <ArticleRow key={article.id} article={article} />
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
          <span>第 1 页 / 共 1 页</span>
        </div>
      </section>
    </>
  );
}

function ArticleRow({ article }: { article: ArticleSummary }) {
  const badge = articleBadge(article.status);
  return (
    <tr>
      <td>
        <Link className="link neutral table-title" href={`/publishing/articles/${encodeURIComponent(article.id)}/edit`}>
          {article.title}
        </Link>
        <div className="table-sub">{article.imageCount ? `含 ${article.imageCount} 张配图` : "纯文字稿件"}</div>
      </td>
      <td className="small numeric">v{article.currentVersion}</td>
      <td className="right numeric">{article.wordCount.toLocaleString("zh-CN")}</td>
      <td><Badge tone={badge.tone}>{badge.label}</Badge></td>
      <td className="small muted numeric">{publishingDateTime(article.updatedAt)}</td>
      <td>
        <div className="table-action">
          <Link className="link" href={`/publishing/articles/${encodeURIComponent(article.id)}/edit`}>编辑</Link>
          {article.status === "frozen" && article.currentVersionId ? (
            <Link className="link" href={`/publishing/media?articleVersion=${encodeURIComponent(article.currentVersionId)}`}>继续投放</Link>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
