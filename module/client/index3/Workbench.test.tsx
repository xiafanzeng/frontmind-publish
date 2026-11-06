// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Index3Workbench from "./Workbench";
import { PublishingGatewayProvider } from "../PublishingContext";
import type { PublisherGateway } from "../gateway";
import type { ArticleSummary, PublicationBatchSummary, PublishingDashboard } from "../types";

// V5 工作台回归：失败批次并入“待继续的稿件”（大红色“发布失败”）、
// 统计卡使用精确总数、“最近投放”更名为“需处理的投放”、列表按最近修改倒序。

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

const dashboard = (overrides: Partial<PublishingDashboard> = {}): PublishingDashboard => ({
  wallet: { availableTenThousandths: "0", reservedTenThousandths: "0", frozenTenThousandths: "0" },
  catalog: { activeRevision: "rev", lastSyncedAt: "2026-11-01T00:00:00Z", stale: false },
  articleCount: 0,
  actionableItemCount: 0,
  resumableDraftCount: 1,
  resumableDrafts: [
    { id: "draft/ready-1", articleTitle: "配置标题中的草稿", articleVersion: 2, status: "ready", updatedAt: "2026-11-06T08:00:00Z" },
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
  const gateway = {
    getDashboard: vi.fn<PublisherGateway["getDashboard"]>(async () => dashboard(data.dashboard)),
    listArticles: vi.fn<PublisherGateway["listArticles"]>(async () => data.articles ?? articles),
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

it("merges failed batches into the resume list with a red failure badge and exact counters", async () => {
  renderWorkbench({});
  await waitFor(() => expect(screen.getByRole("heading", { name: "待继续的稿件" })).toBeTruthy());
  // 待继续 = 2 篇稿件 + 1 条草稿(resumableDraftCount) + 1 个失败批次；需处理 = 1（精确总数）；正在发布 = 2。
  const statusItems = Array.from(document.querySelectorAll(".work-status .status-item")).map(node => node.textContent);
  expect(statusItems[0]).toContain("待继续的稿件");
  expect(statusItems[0]).toContain("4");
  expect(statusItems[1]).toContain("需处理的投放");
  expect(statusItems[1]).toContain("1");
  expect(statusItems[2]).toContain("正在发布");
  expect(statusItems[2]).toContain("2");
  // “需要处理”独立板块不再存在；“最近投放”更名为“需处理的投放”。
  expect(screen.queryByText("需要处理")).toBeNull();
  expect(screen.getByRole("heading", { name: "需处理的投放" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "最近投放" })).toBeNull();
  // 失败批次行：大红色“发布失败” + 停在配置标题 + 查看失败原因入口。
  expect(screen.getByText("发布失败")).toBeTruthy();
  const row = screen.getByText("发布失败的稿件").closest("article")!;
  expect(within(row).getByText("查看失败原因")).toBeTruthy();
  expect(within(row).getByLabelText(/当前步骤：配置标题，发布失败/)).toBeTruthy();
});

it("pins problem batches on top and keeps normal rows by most recent update", async () => {
  renderWorkbench({});
  await waitFor(() => expect(screen.getByText("发布失败的稿件")).toBeTruthy());
  const titles = Array.from(document.querySelectorAll(".task-list h3")).map(node => node.textContent);
  // 失败批次虽是最旧（11-04），但必须置顶展示，避免被普通条数上限截掉；
  // 普通行之间保持与“管理稿件”一致的最近修改倒序。
  expect(titles).toEqual([
    "发布失败的稿件",    // 失败批次 → 配置标题 + 发布失败（置顶）
    "待投放的稿件",      // 11-06 12:00 冻结稿 → 选择媒体
    "配置标题中的草稿",  // 11-06 08:00 草稿 ready → 配置标题
    "编辑中的稿件",      // 11-05 09:00 编辑中 → 编辑稿件
  ]);
});

it("keeps per-stage entries instead of status labels and routes each row to its step", async () => {
  renderWorkbench({});
  await waitFor(() => expect(screen.getByText("编辑中的稿件")).toBeTruthy());
  expect(screen.queryByText("待预检")).toBeNull();
  expect(screen.queryByText("待继续")).toBeNull();
  expect(screen.queryByText("待投放")).toBeNull();
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".task-list a.btn")).map(node => node.getAttribute("href"));
  expect(links).toEqual([
    "/publishing/publications/batch-failed-1",      // 失败批次（置顶）→ 发布详情
    "/publishing/media?articleVersion=version-2",   // 冻结稿 → 选择媒体
    "/publishing/drafts/draft%2Fready-1/titles",    // ready 草稿 → 配置标题
    "/publishing/articles/article-draft/edit",      // 编辑中 → 编辑稿件
  ]);
});
