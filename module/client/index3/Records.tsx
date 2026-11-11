import { useCallback, useMemo, useState } from "react";
import { Link } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { PublishingError } from "../components/PublishingUi";
import { DEFAULT_PUBLICATION_FILTERS } from "../queryState";
import { publishingDateTime, type PublicationBatch } from "../types";
import { batchBadge, moneyBreakdown, problemStatuses } from "./adapters";
import { Badge, Btn, Icon, PageHeading, SearchBox, money, toast, useIndex3Dialog } from "./ui";

type Filter = "all" | "running" | "attention" | "success";

/** index3 发布记录: status tabs, search, money ledger rows and the batch detail dialog. */
export default function Index3Records() {
  const gateway = usePublisherGateway();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const load = useCallback(
    (signal: AbortSignal) => gateway.listBatches({ ...DEFAULT_PUBLICATION_FILTERS, page: 1, pageSize: 50 }, signal),
    [gateway],
  );
  const query = usePublisherQuery(load, "index3-records");
  const dialog = useIndex3Dialog();

  const batches = query.data?.items ?? [];
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return batches.filter((batch) => {
      if (filter === "running" && batch.status !== "processing" && batch.status !== "queued") return false;
      if (filter === "attention" && !problemStatuses.includes(batch.status)) return false;
      if (filter === "success" && batch.status !== "success") return false;
      if (keyword && !batch.articleTitle.toLocaleLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [batches, filter, search]);

  const openDetail = useCallback(
    (batchId: string) => {
      dialog.open({
        title: "发布详情",
        body: <p className="small muted">正在读取批次…</p>,
        footer: <Btn onClick={dialog.close}>关闭</Btn>,
      });
      void gateway
        .getBatch(batchId)
        .then((batch) => {
          dialog.open({ title: "发布详情", body: <BatchDetail batch={batch} />, footer: <Btn onClick={dialog.close}>关闭</Btn> });
        })
        .catch((reason) => {
          dialog.open({
            title: "发布详情",
            body: <p className="small muted">{reason instanceof Error ? reason.message : "读取发布详情失败。"}</p>,
            footer: <Btn onClick={dialog.close}>关闭</Btn>,
          });
        });
    },
    [dialog, gateway],
  );

  const tabs: Array<[Filter, string]> = [
    ["all", "全部"],
    ["running", "发布中"],
    ["attention", "需处理"],
    ["success", "已完成"],
  ];

  return (
    <>
      <PageHeading title="发布记录">
        <Btn icon="refresh" onClick={() => { void query.reload(); toast("已刷新发布记录。"); }}>刷新状态</Btn>
      </PageHeading>

      <section className="panel">
        <div className="filter-tabs record-tabs" aria-label="发布状态筛选">
          {tabs.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`filter-tab ${filter === value ? "active" : ""}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filters">
          <SearchBox value={search} onChange={setSearch} placeholder="搜索稿件或批次名称" />
        </div>
        {query.loading ? (
          <div className="empty"><h3>正在读取发布记录…</h3></div>
        ) : query.error ? (
          <div className="panel-body"><PublishingError error={query.error} onRetry={query.reload} /></div>
        ) : filtered.length ? (
          <div className="table-wrap">
            <table>
              <caption className="sr-only">发布批次列表</caption>
              <thead>
                <tr>
                  <th>稿件 / 批次</th>
                  <th className="right">总额</th>
                  <th>资金进展</th>
                  <th>执行状态</th>
                  <th>更新时间</th>
                  <th className="right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((batch) => {
                  const badge = batchBadge(batch.status);
                  return (
                    <tr key={batch.id}>
                      <td>
                        <Link className="link neutral table-title" href={`/publishing/publications/${encodeURIComponent(batch.id)}`}>
                          {batch.articleTitle}
                        </Link>
                        <div className="table-sub">发布批次 · {batch.itemCount} 家媒体</div>
                      </td>
                      <td className="right numeric">{money(batch.totalTenThousandths)}</td>
                      <td>
                        <dl className="money-breakdown">
                          {moneyBreakdown(batch).map((line) => (
                            <div key={line.label}>
                              <dt>{line.label}</dt>
                              <dd>{money(line.value)}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                      <td><Badge tone={badge.tone}>{badge.label}</Badge></td>
                      <td className="small muted numeric">{publishingDateTime(batch.createdAt)}</td>
                      <td className="right">
                        <button type="button" className="btn small primary compact" onClick={() => openDetail(batch.id)}>查看详情</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>没有匹配的发布记录</h3>
            <p>调整状态或搜索关键词后重试。</p>
            <button type="button" className="btn" onClick={() => { setFilter("all"); setSearch(""); }}>重置筛选</button>
          </div>
        )}
        <div className="pagination">
          <span>共 {filtered.length} 个批次</span>
          <span>第 1 页 / 共 1 页</span>
        </div>
      </section>
    </>
  );
}

function BatchDetail({ batch }: { batch: PublicationBatch }) {
  const badge = batchBadge(batch.status);
  return (
    <>
      <div className="space-between" style={{ alignItems: "flex-start" }}>
        <div>
          <h3>{batch.articleTitle}</h3>
          <p className="small muted" style={{ marginTop: 5 }}>发布批次 {batch.id.slice(0, 8).toUpperCase()} · {publishingDateTime(batch.createdAt)}</p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <dl className="details-grid" style={{ margin: "20px 0" }}>
        <div><dt>发布媒体</dt><dd>{batch.itemCount} 家</dd></div>
        <div><dt>金额</dt><dd className="numeric">{money(batch.totalTenThousandths)}</dd></div>
        <div><dt>已完成 / 失败</dt><dd>{batch.successCount} / {batch.failedCount}</dd></div>
        <div><dt>请求状态</dt><dd>已受理，不重复提交</dd></div>
      </dl>
      <dl className="money-ledger">
        <div><dt>总额</dt><dd>{money(batch.totalTenThousandths)}</dd></div>
        <div><dt>实扣</dt><dd>{money(batch.consumedTenThousandths)}</dd></div>
        <div><dt>预占</dt><dd>{money(batch.frozenTenThousandths)}</dd></div>
        <div><dt>退回</dt><dd>{money(batch.releasedTenThousandths)}</dd></div>
      </dl>
      {batch.failedCount > 0 ? (
        <div className="notice">有 {batch.failedCount} 家媒体未发布成功；已成功的媒体保持原结果，处理失败项后重新提交即可。</div>
      ) : (
        <div className="notice info">以下为各媒体的执行状态，可复制结果链接。</div>
      )}
      <div className="record-detail-media">
        {batch.items.map((item) => {
          const failed = item.status === "failed" || item.status === "auth_blocked";
          const done = item.status === "success";
          return (
            <div className="detail-row" key={item.media.id}>
              <div>
                <strong style={{ fontSize: 13, fontWeight: 500 }}>{item.media.name}</strong>
                <p>单价 <span className="numeric">{money(item.priceTenThousandths)}</span></p>
                <p>{failed ? (item.resultMessage || "未发布成功，请查看原因后重试。") : done ? "已发布，结果链接可查看或复制。" : "已受理，等待执行结果。"}</p>
                {done && item.resultUrl ? (
                  <div className="copy-field" style={{ marginTop: 8 }}>
                    <input className="control" readOnly aria-label="结果链接" value={item.resultUrl} />
                    <Btn
                      variant="small"
                      icon="copy"
                      aria-label="复制结果链接"
                      onClick={() => {
                        void navigator.clipboard?.writeText(item.resultUrl ?? "").then(
                          () => toast("已复制结果链接。"),
                          () => toast("复制失败，请手动选择链接复制。"),
                        );
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <Badge tone={failed ? "danger" : done ? "success" : "info"}>
                {failed ? "失败" : done ? "成功" : "处理中"}
              </Badge>
            </div>
          );
        })}
      </div>
      <div className="timeline">
        <div className="timeline-item">
          <strong>发布请求已受理</strong>
          <p>{publishingDateTime(batch.createdAt)} · 使用原请求身份追踪。</p>
        </div>
        <div className="timeline-item">
          <strong>{batch.failedCount > 0 ? "部分媒体返回结果" : batch.status === "success" ? "全部媒体执行完成" : "等待后续结果"}</strong>
          <p>{batch.failedCount > 0 ? "先处理失败项，已成功的媒体不重复发布。" : "可在发布记录持续跟进执行进度。"}</p>
        </div>
      </div>
    </>
  );
}
