// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Index3Articles from "./Articles";
import { PublishingGatewayProvider } from "../PublishingContext";
import type { PublisherGateway } from "../gateway";
import type { ArticleSummary, PublicationBatchSummary, PublishingDashboard } from "../types";

// V8 管理稿件回归：四页签（全部/待编辑/发布成功/发布失败）、统一状态徽标、
// 统一“继续投放/删除稿件”操作、10 条分页、批次金额列。

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

const articles: ArticleSummary[] = Array.from({ length: 12 }, (_, i) => ({
  id: `article-${i}`,
  title: `稿件${i}`,
  status: i % 3 === 0 ? "draft" : "frozen",
  currentVersion: 1,
  currentVersionId: i % 3 === 0 ? undefined : `version-${i}`,
  wordCount: 100 + i,
  imageCount: 0,
  updatedAt: `2026-11-0${(i % 8) + 1}T10:00:00Z`,
}));

const batch = (id: string, status: PublicationBatchSummary["status"], title: string): PublicationBatchSummary => ({
  id, articleTitle: title, articleVersion: 2, mode: "live", status,
  itemCount: 1, successCount: status === "success" ? 1 : 0, failedCount: status === "success" ? 0 : 1,
  unknownCount: 0, totalTenThousandths: "35000", consumedTenThousandths: "0",
  releasedTenThousandths: "35000", frozenTenThousandths: "0",
  createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:30:00Z",
});

function renderArticles(overrides: {
  articles?: ArticleSummary[];
  succeeded?: PublicationBatchSummary[];
  problems?: PublicationBatchSummary[];
} = {}) {
  let liveArticles = [...(overrides.articles ?? articles)];
  const dashboard: PublishingDashboard = {
    wallet: { availableTenThousandths: "0", reservedTenThousandths: "0", frozenTenThousandths: "0" },
    catalog: { activeRevision: "rev", lastSyncedAt: "2026-11-01T00:00:00Z", stale: false },
    articleCount: 0, actionableItemCount: 0, resumableDraftCount: 0, resumableDrafts: [],
    processingBatchCount: 0, processingBatches: [], recentBatches: [], resumableArticles: [],
  };
  const gateway = {
    listArticles: vi.fn<PublisherGateway["listArticles"]>(async () => [...liveArticles]),
    getDashboard: vi.fn<PublisherGateway["getDashboard"]>(async () => dashboard),
    deleteArticle: vi.fn<PublisherGateway["deleteArticle"]>(async (id: string) => {
      liveArticles = liveArticles.filter((a) => a.id !== id);
    }),
    listBatches: vi.fn<PublisherGateway["listBatches"]>(async (filters) => ({
      // 三种失败状态调用时仅 failed 返回数据，避免 mock 造成重复计数。
      items: filters?.status === "success"
        ? (overrides.succeeded ?? [batch("batch-ok-1", "success", "成功稿件")])
        : filters?.status === "failed"
          ? (overrides.problems ?? [batch("batch-bad-1", "failed", "失败稿件")])
          : [],
      total: filters?.status === "success" || filters?.status === "failed" ? 1 : 0,
      page: 1, pageSize: filters?.pageSize ?? 20,
    })),
  };
  window.history.replaceState({}, "", "/publishing/articles");
  const location = memoryLocation({ path: "/publishing/articles", record: true });
  render(<Router hook={location.hook} searchHook={location.searchHook}>
    <PublishingGatewayProvider gateway={gateway as unknown as PublisherGateway}>
      <Index3Articles />
    </PublishingGatewayProvider>
  </Router>);
  return { gateway };
}

async function rowsOfCurrentPage() {
  return Array.from(document.querySelectorAll("tbody tr")).map((tr) => ({
    title: tr.querySelector(".table-title")?.textContent,
    cells: Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim()),
    buttons: Array.from(tr.querySelectorAll("a.btn, button.btn")).map((b) => b.textContent?.trim()),
  }));
}

it("shows four tabs with unified status badges and operations", async () => {
  renderArticles();
  await waitFor(() => expect(screen.getByRole("button", { name: /全部稿件/ })).toBeTruthy());
  // 页签计数：全部 14（12 稿件 + 1 成功 + 1 失败），待编辑 12，成功 1，失败 1
  for (const [label, count] of [["全部稿件", "14"], ["待编辑", "12"], ["发布成功", "1"], ["发布失败", "1"]] as const) {
    const tab = Array.from(document.querySelectorAll<HTMLButtonElement>(".filter-tab"))
      .find((b) => b.textContent?.includes(label));
    expect(tab?.textContent).toContain(count);
  }
  // 默认全部稿件：第一页 10 行（分页生效）
  expect(document.querySelectorAll("tbody tr").length).toBe(10);
  // 稿件行：状态=编辑中（蓝），操作=继续投放+删除稿件；批次行：红/绿徽标 + 查看详情
  const all = await rowsOfCurrentPage();
  // “稿件7”为最新的稿件行，必定位于第一页。
  const articleRow = all.find((r) => r.title === "稿件7");
  expect(articleRow?.cells.join(",")).toContain("编辑中");
  expect(articleRow?.buttons).toEqual(["继续投放", "删除稿件"]);
  // 切到发布失败页签：金额列 + 全部失败红标 + 查看详情
  fireEvent.click(Array.from(document.querySelectorAll<HTMLButtonElement>(".filter-tab")).find((b) => b.textContent?.includes("发布失败"))!);
  await waitFor(async () => {
    const failed = (await rowsOfCurrentPage())[0]!;
    expect(failed.cells.join(",")).toContain("全部失败");
    expect(failed.cells.join(",")).toContain("¥3.50");
    expect(failed.buttons).toEqual(["查看详情"]);
  });
  // 切到发布成功：绿标
  fireEvent.click(Array.from(document.querySelectorAll<HTMLButtonElement>(".filter-tab")).find((b) => b.textContent?.includes("发布成功"))!);
  await waitFor(async () => {
    const ok = (await rowsOfCurrentPage())[0]!;
    expect(ok.cells.join(",")).toContain("发布成功");
  });
});

it("paginates ten rows per page with clickable page buttons", async () => {
  renderArticles();
  await waitFor(() => expect(document.querySelectorAll("tbody tr").length).toBe(10));
  // 14 条 → 2 页；第 2 页 4 条
  const pageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".page-buttons button"));
  const page2 = pageButtons.find((b) => b.textContent === "2");
  expect(page2).toBeTruthy();
  fireEvent.click(page2!);
  await waitFor(() => expect(document.querySelectorAll("tbody tr").length).toBe(4));
  expect(document.querySelector(".pagination span")?.textContent).toContain("共 14 篇");
});

it("deletes a draft article with confirmation", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const { gateway } = renderArticles();
  await waitFor(() => expect(screen.getByRole("button", { name: /全部稿件/ })).toBeTruthy());
  fireEvent.click(Array.from(document.querySelectorAll<HTMLButtonElement>(".filter-tab")).find((b) => b.textContent?.includes("待编辑"))!);
  await waitFor(() => expect(document.querySelectorAll("tbody tr").length).toBe(10));
  const firstRow = document.querySelector("tbody tr")!;
  const title = firstRow.querySelector(".table-title")?.textContent ?? "";
  fireEvent.click(firstRow.querySelector("button.btn.danger-solid")!);
  await waitFor(() => expect(gateway.deleteArticle).toHaveBeenCalledTimes(1));
  await waitFor(() => {
    const still = Array.from(document.querySelectorAll(".table-title")).some((n) => n.textContent === title);
    expect(still).toBe(false);
  });
  confirm.mockRestore();
});
