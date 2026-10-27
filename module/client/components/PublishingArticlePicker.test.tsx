// @vitest-environment jsdom
// Regression source only. Execution is intentionally delegated to the final merged tree.
import React, { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishingGatewayProvider } from "../PublishingContext";
import { configurePublishingHost } from "../host";
import type { PublisherGateway } from "../gateway";
import type { ArticleDetail } from "../types";
import PublishingArticlePicker from "./PublishingArticlePicker";

const article = (id: string, status: ArticleDetail["status"] = "draft"): ArticleDetail => ({
  id, title: `真实稿件 ${id}`, status, revision: 7, currentVersion: status === "frozen" ? 2 : 0,
  currentVersionId: status === "frozen" ? `frozen-${id}` : undefined,
  wordCount: 4, imageCount: 1, updatedAt: "2026-10-27T01:02:03Z",
  bodyText: "完整正文", bodyHtml: '<p><strong>完整正文</strong></p><img src="/real-image" />',
  editorJson: { type: "doc", content: [{ type: "paragraph" }] },
  images: [{ id: `image-${id}`, fileName: "image.png", altText: "正文图片", width: 100, height: 80, previewUrl: "/real-image" }],
  versions: status === "frozen" ? [{ id: `frozen-${id}`, version: 2, hash: "saved-hash", frozen: true, containsImages: true, createdAt: "2026-10-26T00:00:00Z", createdBy: "owner" }] : [],
  importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function gatewayFor(articles: ArticleDetail[]) {
  return {
    listArticles: vi.fn<PublisherGateway["listArticles"]>().mockResolvedValue(articles),
    getArticle: vi.fn<PublisherGateway["getArticle"]>(async (id) => articles.find((item) => item.id === id)!),
    saveArticle: vi.fn(), freezeArticle: vi.fn(), importDocx: vi.fn(), createDraft: vi.fn(),
  };
}
function Harness({ gateway, onSelect, multiple = false, excludedIds = [] }: {
  gateway: ReturnType<typeof gatewayFor>; onSelect: (articles: ArticleDetail[]) => void | Promise<void>;
  multiple?: boolean; excludedIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <PublishingGatewayProvider gateway={gateway as unknown as PublisherGateway}>
    <button ref={trigger} onClick={() => setOpen(true)}>选择已有稿件</button>
    <PublishingArticlePicker open={open} trigger={trigger.current ?? undefined} onClose={() => setOpen(false)} onSelect={onSelect} multiple={multiple} excludedIds={excludedIds} />
  </PublishingGatewayProvider>;
}
const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "选择已有稿件" }));
  return screen.findByRole("dialog");
};
afterEach(() => { cleanup(); configurePublishingHost({}); vi.restoreAllMocks(); });

describe("shared article picker", () => {
  it("reads the complete gateway list, filters by ID/status and clears search without mutations", async () => {
    const gateway = gatewayFor([article("later-page"), article("frozen", "frozen")]);
    render(<Harness gateway={gateway} onSelect={vi.fn()} />);
    await open();
    await screen.findByRole("radio", { name: /ID：later-page/ });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "later-page" } });
    expect(screen.queryByRole("radio", { name: /ID：frozen/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "清空稿件搜索" }));
    fireEvent.change(screen.getByRole("combobox", { name: "稿件状态" }), { target: { value: "frozen" } });
    expect(screen.queryByRole("radio", { name: /ID：later-page/ })).toBeNull();
    expect(screen.getByText(/当前版本 v2/)).toBeTruthy();
    expect(gateway.getArticle).not.toHaveBeenCalled();
    expect(gateway.saveArticle).not.toHaveBeenCalled();
    expect(gateway.freezeArticle).not.toHaveBeenCalled();
    expect(gateway.createDraft).not.toHaveBeenCalled();
  });

  it("loads full detail with rich text/assets/version identity and invokes the parent once", async () => {
    const full = article("frozen", "frozen");
    const gateway = gatewayFor([full]);
    const pending = deferred<ArticleDetail>();
    gateway.getArticle.mockImplementation(() => pending.promise);
    const onSelect = vi.fn();
    render(<Harness gateway={gateway} onSelect={onSelect} />);
    const dialog = await open();
    fireEvent.click(await screen.findByRole("radio"));
    const confirm = within(dialog).getByRole("button", { name: "使用此稿件" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    await waitFor(() => expect(gateway.getArticle).toHaveBeenCalledTimes(1));
    expect(onSelect).not.toHaveBeenCalled();
    pending.resolve(full);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith([full]);
    expect(gateway.listArticles).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog")).toBeTruthy(); // Parent owns closing/navigation.
    expect(gateway.saveArticle).not.toHaveBeenCalled();
  });

  it("keeps importing/failed/existing rows unavailable and appends only selected distinct complete details", async () => {
    const gateway = gatewayFor([article("existing"), article("importing", "importing"), article("failed", "import_failed"), article("a"), article("b")]);
    const onSelect = vi.fn();
    render(<Harness gateway={gateway} onSelect={onSelect} multiple excludedIds={["existing"]} />);
    await open();
    await screen.findByRole("checkbox", { name: /ID：existing/ });
    for (const id of ["existing", "importing", "failed"]) expect((screen.getByRole("checkbox", { name: new RegExp(`ID：${id}`) }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("已在当前批量中")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /ID：a/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /ID：b/ }));
    fireEvent.click(screen.getByRole("button", { name: "追加所选稿件" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith([article("a"), article("b")]);
    expect(gateway.getArticle.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
  });

  it("cancels an uncooperative detail read and restores opener focus without applying old content", async () => {
    const gateway = gatewayFor([article("a")]);
    const pending = deferred<ArticleDetail>();
    gateway.getArticle.mockImplementation(() => pending.promise);
    const onSelect = vi.fn();
    render(<Harness gateway={gateway} onSelect={onSelect} />);
    await open();
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "使用此稿件" }));
    await waitFor(() => expect(gateway.getArticle).toHaveBeenCalledTimes(1));
    const signal = gateway.getArticle.mock.calls[0]![1]!;
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(signal.aborted).toBe(true);
    pending.resolve(article("a"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "选择已有稿件" })));
  });

  it("rejects a target removed since selection and keeps the original editor under parent control", async () => {
    const gateway = gatewayFor([article("a")]);
    gateway.listArticles.mockResolvedValueOnce([article("a")]).mockResolvedValue([]);
    const onSelect = vi.fn();
    render(<Harness gateway={gateway} onSelect={onSelect} />);
    await open();
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "使用此稿件" }));
    await screen.findByText("所选稿件已不可用，请重新选择。");
    expect(gateway.getArticle).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("separates list failure, empty list and no search matches with a working list retry", async () => {
    const gateway = gatewayFor([article("a")]);
    gateway.listArticles.mockRejectedValueOnce(new Error("network"));
    render(<Harness gateway={gateway} onSelect={vi.fn()} />);
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "重试列表" }));
    await screen.findByRole("radio");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing-id" } });
    expect(screen.getByText("没有匹配的稿件，请调整搜索或状态筛选。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    gateway.listArticles.mockResolvedValue([]);
    await open();
    await screen.findByText("暂无稿件，请先上传文档或撰写稿件。");
  });

  it("retries failed detail reads and waits for an async parent without reporting premature success", async () => {
    const gateway = gatewayFor([article("a")]);
    gateway.getArticle.mockRejectedValueOnce(new Error("forbidden"));
    const applied = deferred<void>();
    const onSelect = vi.fn(() => applied.promise);
    render(<Harness gateway={gateway} onSelect={onSelect} />);
    await open();
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "使用此稿件" }));
    fireEvent.click(await screen.findByRole("button", { name: "重试载入" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("正在切换稿件…")).toBeTruthy();
    applied.resolve();
    await waitFor(() => expect((screen.getByRole("button", { name: "使用此稿件" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("discards details that resolve after a workspace change even when the gateway ignores abort", async () => {
    let workspaceKey = 1;
    configurePublishingHost({ useWorkspaceKey: () => workspaceKey });
    const gateway = gatewayFor([article("a")]);
    const pending = deferred<ArticleDetail>();
    gateway.getArticle.mockImplementation(() => pending.promise);
    const onSelect = vi.fn();
    const { rerender } = render(<Harness gateway={gateway} onSelect={onSelect} />);
    await open();
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "使用此稿件" }));
    await waitFor(() => expect(gateway.getArticle).toHaveBeenCalledTimes(1));
    workspaceKey = 2;
    rerender(<Harness gateway={gateway} onSelect={onSelect} />);
    pending.resolve(article("a"));
    await waitFor(() => expect(gateway.listArticles).toHaveBeenCalledTimes(3));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
