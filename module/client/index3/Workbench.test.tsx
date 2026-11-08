// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Index3Workbench from "./Workbench";
import { PublishingGatewayProvider } from "../PublishingContext";
import type { PublisherGateway } from "../gateway";
import type { ArticleSummary, PublicationBatchSummary, PublishingDashboard } from "../types";

// V5-R4 工作台回归：待继续的稿件 = 每篇真实稿件一行（计数与管理稿件一致），
// 失败批次只出现在独立的“需处理的投放”板块；投放草稿仅折叠推进步骤条。

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

const dashboard = (overrides: Partial<PublishingDashboard> = {}): PublishingDashboard => ({
  wallet: { availableTenThousandths: "0", reservedTenThousandths: "0", frozenTenThousandths: "0" },
  catalog: { activeRevision: "rev", lastSyncedAt: "2026-11-01T00:00:00Z", stale: false },
  articleCount: 0,
  actionableItemCount: 0,
  resumableDraftCount: 9,
  resumableDrafts: [
    // 与“待投放的稿件”v2 唯一匹配 → 步骤条推进到配置标题。
    { id: "draft/ready-1", articleTitle: "待投放的稿件", articleVersion: 2, status: "ready", updatedAt: "2026-11-06T08:00:00Z" },
    // 与两篇“同名冻结稿”v1 均匹配（歧义）→ 不推进，保持选择媒体。
    { id: "draft/ready-2", articleTitle: "同名冻结稿", articleVersion: 1, status: "ready", updatedAt: "2026-11-05T07:00:00Z" },
  ],
  processingBatchCount: 2,
  processingBatches: [],
  recentBatches: [],
  resumableArticles: [],
  ...overrides,
});

const articles: ArticleSummary[] = [
  { id: "article-draft", title: "编辑中的稿件", status: "draft", currentVersion: 1,
    wordCount: 10, imageCount: 0, updatedAt: "2026-11-05T09:00:00Z" },
  { id: "article-frozen", title: "待投放的稿件", status: "frozen", currentVersion: 2,
    currentVersionId: "version-2", wordCount: 20, imageCount: 0, updatedAt: "2026-11-06T12:00:00Z" },
  { id: "article-twin-a", title: "同名冻结稿", status: "frozen", currentVersion: 1,
    currentVersionId: "version-twin-a", wordCount: 5, imageCount: 0, updatedAt: "2026-11-06T10:00:00Z" },
  { id: "article-twin-b", title: "同名冻结稿", status: "frozen", currentVersion: 1,
    currentVersionId: "version-twin-b", wordCount: 5, imageCount: 0, updatedAt: "2026-11-05T20:00:00Z" },
];

const failedBatch = (overrides: Partial<PublicationBatchSummary> = {}): PublicationBatchSummary => ({
  id: "batch-failed-1",
  articleTitle: "发布失败的稿件",
  articleVersion: 1,
  mode: "live",
  status: "failed",
  itemCount: 2,
  successCount: 0,
  failedCount: 2,
  unknownCount: 0,
  totalTenThousandths: "35000",
  consumedTenThousandths: "0",
  releasedTenThousandths: "35000",
  frozenTenThousandths: "0",
  createdAt: "2026-11-04T10:00:00Z",
  updatedAt: "2026-11-04T10:30:00Z",
  ...overrides,
});

function renderWorkbench(data: {
  dashboard?: Partial<PublishingDashboard>;
  articles?: ArticleSummary[];
  problemItems?: PublicationBatchSummary[];
  problemTotal?: number;
}) {
  // 删除测试需要“删除后列表变化”：用可变集合支撑 listArticles 的后续调用。
  let liveArticles = [...(data.articles ?? articles)];
  const gateway = {
    getDashboard: vi.fn<PublisherGateway["getDashboard"]>(async () => dashboard(data.dashboard)),
    listArticles: vi.fn<PublisherGateway["listArticles"]>(async () => [...liveArticles]),
    deleteArticle: vi.fn<PublisherGateway["deleteArticle"]>(async (articleId: string) => {
      liveArticles = liveArticles.filter((article) => article.id !== articleId);
    }),
    listBatches: vi.fn<PublisherGateway["listBatches"]>(async (filters) => ({
      items: (filters?.status && filters.status !== "failed" ? [] : data.problemItems ?? [failedBatch()]),
      total: filters?.status === "failed" ? data.problemTotal ?? 1 : 0,
      page: 1,
      pageSize: filters?.pageSize ?? 5,
    })),
  };
  window.history.replaceState({}, "", "/publishing");
  const location = memoryLocation({ path: "/publishing", record: true });
  render(<Router hook={location.hook} searchHook={location.searchHook}>
    <PublishingGatewayProvider gateway={gateway as unknown as PublisherGateway}>
      <Index3Workbench />
    </PublishingGatewayProvider>
  </Router>);
  return { gateway, location };
}

it("keeps failed batches out of the resume list and shows exact per-article counters", async () => {
  renderWorkbench({});
  await waitFor(() => expect(screen.getByRole("heading", { name: "待继续的稿件" })).toBeTruthy());
  // 待继续 = 真实稿件数（4，与“管理稿件”全部稿件一致）；需处理 = 1；正在发布 = 2。
  const statusItems = Array.from(document.querySelectorAll(".work-status .status-item")).map(node => node.textContent);
  expect(statusItems[0]).toContain("待继续的稿件");
  expect(statusItems[0]).toContain("4");
  expect(statusItems[1]).toContain("需处理的投放");
  expect(statusItems[1]).toContain("1");
  expect(statusItems[2]).toContain("正在发布");
  expect(statusItems[2]).toContain("2");
  // 失败信息只在“需处理的投放”板块，列表内不再出现红色“发布失败”行。
  expect(screen.queryByText("发布失败")).toBeNull();
  expect(screen.queryByText("查看失败原因")).toBeNull();
  expect(screen.queryByText("需要处理")).toBeNull();
  const panel = screen.getByRole("region", { name: "需处理的投放" });
  expect(panel.textContent).toContain("发布失败的稿件");
  expect(panel.textContent).toContain("全部失败");
});

it("lists one row per article ordered by recent update with folded step indicators", async () => {
  renderWorkbench({});
  await waitFor(() => expect(screen.getByText("编辑中的稿件")).toBeTruthy());
  const rows = Array.from(document.querySelectorAll(".task-list article"));
  const summary = rows.map(row => ({
    title: row.querySelector("h3")?.textContent,
    step: row.querySelector(".mini-steps")?.getAttribute("aria-label"),
    action: row.querySelector("a.btn")?.textContent,
    href: row.querySelector("a.btn")?.getAttribute("href"),
    hasDelete: !!row.querySelector("button.btn.danger-solid"),
  }));
  expect(summary).toEqual([
    // 唯一匹配的已就绪草稿把步骤推进到配置标题，并直达配置标题页。
    { title: "待投放的稿件", step: "当前步骤：配置标题", action: "继续投放", hasDelete: true, href: "/publishing/drafts/draft%2Fready-1/titles" },
    // 同名歧义：不折叠，保持选择媒体，入口按冻结版本定位。
    { title: "同名冻结稿", step: "当前步骤：选择媒体", action: "继续投放", hasDelete: true, href: "/publishing/media?articleVersion=version-twin-a" },
    { title: "同名冻结稿", step: "当前步骤：选择媒体", action: "继续投放", hasDelete: true, href: "/publishing/media?articleVersion=version-twin-b" },
    { title: "编辑中的稿件", step: "当前步骤：编辑稿件", action: "继续投放", hasDelete: true, href: "/publishing/articles/article-draft/edit" },
  ]);
});

it("deletes a draft article after confirmation and refreshes the list", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const { gateway } = renderWorkbench({});
  await waitFor(() => expect(screen.getByText("编辑中的稿件")).toBeTruthy());
  // 删除第一行（待投放的稿件）
  const firstRow = document.querySelector(".task-list article")!;
  const title = firstRow.querySelector("h3")?.textContent ?? "";
  fireEvent.click(firstRow.querySelector("button.btn.danger-solid")!);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect((confirm.mock.calls[0] as unknown[])[0]).toContain(title);
  await waitFor(() => expect(gateway.deleteArticle).toHaveBeenCalledTimes(1));
  // 删除后列表刷新：该行消失，计数同步减少。
  await waitFor(() => expect(screen.queryByText(title)).toBeNull());
  const statusItems = Array.from(document.querySelectorAll(".work-status .status-item")).map(node => node.textContent);
  expect(statusItems[0]).toContain("3");
  confirm.mockRestore();
});

it("keeps the draft when the delete confirmation is cancelled", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { gateway } = renderWorkbench({});
  await waitFor(() => expect(screen.getByText("编辑中的稿件")).toBeTruthy());
  const firstRow = document.querySelector(".task-list article")!;
  const title = firstRow.querySelector("h3")?.textContent ?? "";
  fireEvent.click(firstRow.querySelector("button.btn.danger-solid")!);
  expect(gateway.deleteArticle).not.toHaveBeenCalled();
  expect(screen.getByText(title)).toBeTruthy();
  confirm.mockRestore();
});
