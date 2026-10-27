// @vitest-environment jsdom
// Regression source only; run with ZCode in the final merged tree.
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ArticleEditorPage from "./ArticleEditorPage";
import { PublishingGatewayProvider } from "../PublishingContext";
import { configurePublishingHost, type PublishingHost } from "../host";
import type { PublisherGateway } from "../gateway";
import type { ArticleDetail, PublisherEditorContent } from "../types";
import type { PublishingArticlePickerProps } from "../components/PublishingArticlePicker";

const article = (id: string): ArticleDetail => ({
  id, title: `原稿 ${id}`, status: "frozen", revision: 4, currentVersion: 2, currentVersionId: `v-${id}`,
  wordCount: 4, imageCount: 0, updatedAt: "2026-10-27T00:00:00Z",
  bodyText: `正文 ${id}`, bodyHtml: `<p><strong>正文 ${id}</strong></p>`,
  editorJson: { type: "doc", content: [{ type: "paragraph" }] }, images: [],
  versions: [{ id: `v-${id}`, version: 2, hash: "immutable", frozen: true, containsImages: false, createdAt: "2026-10-26T00:00:00Z", createdBy: "owner" }],
  importChecks: { docxSafe: true, externalLinkCount: 0, structureValid: true },
});
vi.mock("../components/TipTapArticleEditor", () => ({ default: ({ value, onChange }: {
  value: PublisherEditorContent; onChange: (value: PublisherEditorContent) => void;
}) => <textarea aria-label="测试正文" value={value.text} onChange={event => onChange({
  text: event.target.value, html: `<p>${event.target.value}</p>`, json: { type: "doc", content: [] },
})} /> }));
// The shared picker's list/detail/error/cancel behavior is covered in its own test
// source. Here full details cross its boundary so editor lifecycle is isolated.
vi.mock("../components/PublishingArticlePicker", () => ({
  default: ({ open, onClose, onSelect, disabled, multiple }: PublishingArticlePickerProps) => open ? <section role="dialog" aria-label="测试选择器">
    <button disabled={disabled} onClick={() => void onSelect(multiple ? [article("b"), article("b")] : [article("b")])}>载入 B</button>
    <button disabled={disabled} onClick={() => void onSelect([article("c")])}>载入 C</button>
    <button onClick={onClose}>取消选择</button>
  </section> : null,
}));
function gateway() {
  return {
    getArticle: vi.fn<PublisherGateway["getArticle"]>(async id => article(id)),
    saveArticle: vi.fn<PublisherGateway["saveArticle"]>(async input => ({ ...article(input.articleId), ...input, id: input.articleId, revision: input.expectedRevision + 1, status: "draft" as const })),
    freezeArticle: vi.fn(), importDocx: vi.fn(), createDraft: vi.fn(),
  };
}
function setup(initial: string, api = gateway(), strict = false) {
  window.history.replaceState({}, "", initial);
  const location = memoryLocation({ path: initial, record: true });
  const content = <Router hook={location.hook} searchHook={location.searchHook}>
    <PublishingGatewayProvider gateway={api as unknown as PublisherGateway}>
      <Switch>
        <Route path="/publishing/articles/new"><ArticleEditorPage articleId="new" /></Route>
        <Route path="/publishing/articles/:articleId/edit">{params => <ArticleEditorPage articleId={params.articleId} />}</Route>
      </Switch>
    </PublishingGatewayProvider>
  </Router>;
  const view = render(strict ? <StrictMode>{content}</StrictMode> : content);
  return { ...view, location, api };
}
type Guard = Parameters<NonNullable<PublishingHost["useDraftGuard"]>>[0];
afterEach(() => { cleanup(); configurePublishingHost({}); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

it("guards a new unsaved draft without silently creating it and invalidates a cancelled navigation", async () => {
  let guard!: Guard;
  let approved: (() => void) | undefined;
  configurePublishingHost({ useDraftGuard: input => { guard = input; }, requestNavigation: action => { approved = action; } });
  const { api, location } = setup("/publishing/articles/new");
  fireEvent.change(screen.getByLabelText("稿件标题"), { target: { value: "不能丢失的新稿" } });
  fireEvent.change(await screen.findByLabelText("测试正文"), { target: { value: "未保存正文" } });
  expect(guard.dirty).toBe(true);
  expect(guard.save).toBeUndefined(); // Only explicit Save creates the new article.
  fireEvent.click(screen.getByRole("button", { name: "选择稿件" }));
  fireEvent.click(screen.getByText("载入 B"));
  expect(location.history.at(-1)).toBe("/publishing/articles/new");
  fireEvent.click(screen.getByText("取消选择"));
  act(() => approved?.());
  expect((screen.getByLabelText("稿件标题") as HTMLInputElement).value).toBe("不能丢失的新稿");
  expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe("未保存正文");
  expect(api.importDocx).not.toHaveBeenCalled();
  expect(api.saveArticle).not.toHaveBeenCalled();
});

it("hands full detail to the target route, then saves the original ID without copying or refreezing", async () => {
  configurePublishingHost({ requestNavigation: action => action() });
  const api = gateway();
  api.getArticle.mockRejectedValue(new Error("A second target read must not be needed"));
  const { location } = setup("/publishing/articles/new?mode=multi&draftId=old&workbenchTask=old-task", api, true);
  fireEvent.click(screen.getByRole("button", { name: "选择稿件" }));
  fireEvent.click(screen.getByText("载入 B"));
  await waitFor(() => expect(location.history.at(-1)).toBe("/publishing/articles/b/edit?mode=multi"));
  await waitFor(() => expect((screen.getByLabelText("测试正文") as HTMLTextAreaElement).value).toBe("正文 b"));
  expect(api.getArticle).not.toHaveBeenCalled();
  expect(api.saveArticle).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("测试正文"), { target: { value: "修改原稿正文" } });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(api.saveArticle).toHaveBeenCalledTimes(1));
  expect(api.saveArticle.mock.calls[0]![0].articleId).toBe("b");
  expect(api.saveArticle.mock.calls[0]![0].expectedRevision).toBe(4);
  expect(api.freezeArticle).not.toHaveBeenCalled();
  expect(api.importDocx).not.toHaveBeenCalled();
});

it("ignores an older host approval after a more recent selection", async () => {
  const approvals: Array<() => void> = [];
  configurePublishingHost({ requestNavigation: action => { approvals.push(action); } });
  const { location } = setup("/publishing/articles/new");
  fireEvent.click(screen.getByRole("button", { name: "选择稿件" }));
  fireEvent.click(screen.getByText("载入 B"));
  fireEvent.click(screen.getByText("载入 C"));
  expect(approvals).toHaveLength(2);
  act(() => approvals[0]!());
  expect(location.history.at(-1)).toBe("/publishing/articles/new");
  act(() => approvals[1]!());
  await waitFor(() => expect(location.history.at(-1)).toContain("/publishing/articles/c/edit"));
  expect((await screen.findByLabelText("稿件标题") as HTMLInputElement).value).toBe("原稿 c");
});

it("reports a failed existing-article save to the host guard without switching", async () => {
  let guard!: Guard;
  configurePublishingHost({ useDraftGuard: input => { guard = input; }, requestNavigation: () => {} });
  const api = gateway();
  api.saveArticle.mockRejectedValue(new Error("保存冲突"));
  const { location } = setup("/publishing/articles/a/edit", api);
  await waitFor(() => expect((screen.getByLabelText("稿件标题") as HTMLInputElement).value).toBe("原稿 a"));
  fireEvent.change(screen.getByLabelText("稿件标题"), { target: { value: "未保存修改" } });
  fireEvent.click(screen.getByRole("button", { name: "选择稿件" })); // Pause autosave while choosing.
  let saved: boolean | undefined;
  await act(async () => { saved = await guard.save?.(); });
  expect(saved).toBe(false);
  expect(location.history.at(-1)).toBe("/publishing/articles/a/edit");
  expect((screen.getByLabelText("稿件标题") as HTMLInputElement).value).toBe("未保存修改");
});

it("appends each existing article once while preserving unsaved batch cards and both entry points", async () => {
  let batchGuard!: Guard;
  configurePublishingHost({ useDraftGuard: input => { if (input.label.startsWith("批量")) batchGuard = input; } });
  const { api } = setup("/publishing/articles/new?mode=batch");
  fireEvent.change(screen.getByLabelText("文章 1 标题"), { target: { value: "本地未保存稿" } });
  fireEvent.change(await screen.findByLabelText("测试正文"), { target: { value: "保留这一篇" } });
  fireEvent.click(screen.getByRole("button", { name: "选择稿件" }));
  fireEvent.click(screen.getByText("载入 B"));
  await screen.findByLabelText("文章 2 标题");
  expect((screen.getByLabelText("文章 1 标题") as HTMLInputElement).value).toBe("本地未保存稿");
  expect((screen.getByLabelText("文章 2 标题") as HTMLInputElement).value).toBe("原稿 b");
  expect(screen.queryByLabelText("文章 3 标题")).toBeNull();
  expect(batchGuard.dirty).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /从稿件库选择已有稿件/ }));
  fireEvent.click(screen.getByText("载入 B"));
  expect(screen.queryByLabelText("文章 3 标题")).toBeNull();
  expect(api.saveArticle).not.toHaveBeenCalled();
  expect(api.freezeArticle).not.toHaveBeenCalled();
  expect(api.importDocx).not.toHaveBeenCalled();
});

it("recovers one explicit batch article and offers retry after recovery failure", async () => {
  const api = gateway();
  api.getArticle.mockRejectedValueOnce(new Error("暂时无法读取")).mockResolvedValue(article("a"));
  setup("/publishing/articles/new?mode=batch&batchArticle=a", api);
  const retry = await screen.findByRole("button", { name: "重试恢复稿件" });
  await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(retry);
  await waitFor(() => expect((screen.getByLabelText("文章 1 标题") as HTMLInputElement).value).toBe("原稿 a"));
  expect((screen.getByRole("button", { name: "选择稿件" }) as HTMLButtonElement).disabled).toBe(false);
});

