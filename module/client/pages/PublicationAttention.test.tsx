// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PublicationsPage from "./PublicationsPage";
import PublicationDetailPage from "./PublicationDetailPage";
import type { PublicationBatch } from "../types";

const queryState = vi.hoisted(() => ({ data: undefined as unknown, reload: vi.fn(), navigate: vi.fn() }));
vi.mock("../PublishingContext", () => ({
  usePublisherGateway: () => ({ listBatches: vi.fn(), getBatch: vi.fn(), batchCsvUrl: () => "/synthetic.csv" }),
  usePublisherQuery: () => ({ data: queryState.data, loading: false, refreshing: false, error: null, reload: queryState.reload }),
}));
vi.mock("../PublishingFlowContext", () => ({ usePublishingSummary: vi.fn(), usePublishingFlow: () => null }));
vi.mock("../host", () => ({ PublishExecution: () => null, safePublisherLogoUrl: () => undefined, projectWorkspaceUrl: (path: string) => path }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/publishing", queryState.navigate],
  useSearch: () => "",
}));

afterEach(() => { cleanup(); queryState.data = undefined; vi.clearAllMocks(); });

function batch(status: "submission_unknown" | "auth_blocked" = "submission_unknown"): PublicationBatch {
  return {
    id: "batch-1", articleTitle: "测试稿件", articleVersion: 1, mode: "live", status: "action_required",
    itemCount: 1, successCount: 0, failedCount: status === "auth_blocked" ? 1 : 0,
    unknownCount: status === "submission_unknown" ? 1 : 0,
    newsCount: 1, selfMediaCount: 0, titleMode: "single", totalTenThousandths: "35000",
    consumedTenThousandths: "0", releasedTenThousandths: status === "auth_blocked" ? "35000" : "0",
    frozenTenThousandths: status === "submission_unknown" ? "35000" : "0",
    createdAt: "2026-10-24T08:00:00.000Z", articleVersionId: "version-1", articleVersionHash: "hash",
    items: [{ id: "item-1", media: { id: "media-1", name: "测试媒体", shortName: "测试", kind: "news" },
      title: "测试标题", status, fundStatus: status === "auth_blocked" ? "released" : "frozen",
      priceTenThousandths: "35000", resultMessage: "KolSubmissionUnknownError: authentication token rejected",
      updatedAt: "2026-10-24T08:00:00.000Z" }],
  } as PublicationBatch;
}

describe("publication attention notices", () => {
  it("puts a frozen-result alert above the publication list", () => {
    const { items: _items, ...summary } = batch();
    queryState.data = { items: [summary], total: 1, page: 1, pageSize: 20 };
    const { container } = render(<PublicationsPage />);
    expect(screen.getByRole("alert").textContent).toContain("发布结果待核实");
    expect(screen.getByRole("alert").textContent).toContain("待管理员核对");
    expect(screen.getByRole("alert").textContent).toContain("¥3.50");
    expect(screen.getByRole("alert").textContent).toContain("系统未自动重发");
    const list = screen.getByRole("region", { name: "发布批次" });
    expect(screen.getByRole("alert").compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toContain("KolSubmissionUnknownError");
  });

  it("puts the pending-result alert above the detail and translates the raw provider failure", () => {
    queryState.data = batch();
    const { container } = render(<PublicationDetailPage batchId="batch-1" />);
    expect(screen.getByRole("alert").textContent).toContain("¥3.50");
    expect(screen.getByRole("alert").textContent).toContain("系统未自动重发");
    const results = screen.getByRole("region", { name: "逐家媒体发布结果" });
    expect(screen.getByRole("alert").compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toContain("authentication token rejected");
    expect(container.textContent).not.toContain("KolSubmissionUnknownError");
  });

  it("clearly says credentials failed and the reservation was returned before any resubmission", () => {
    queryState.data = batch("auth_blocked");
    const { container } = render(<PublicationDetailPage batchId="batch-1" />);
    expect(screen.getByRole("alert").textContent).toContain("发布凭证失效");
    expect(screen.getByRole("alert").textContent).toContain("预占已退回");
    expect(screen.getByRole("alert").textContent).toContain("¥3.50 已退回可用余额");
    expect(screen.getByRole("alert").textContent).toContain("系统未自动重发");
    expect(screen.queryByText("发布结果待核实")).toBeNull();
    expect(container.textContent).not.toContain("KolSubmissionUnknownError");
  });
});
