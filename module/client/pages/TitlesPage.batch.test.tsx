// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { configurePublishingHost } from "../host";
import type { SaveDraftTitlesInput } from "../types";
import { beginConfirmation, draft, feeValue, readyToConfirm, setup } from "./titlesConfirmationTestSupport";

afterEach(() => {cleanup(); configurePublishingHost({}); vi.restoreAllMocks(); window.history.replaceState({}, "", "/");});

it.each([
  ["single", "single"], ["per_media", "per_media"], ["single", "per_media"],
] as const)("keeps %s/%s batches on titles without saving or checking on entry", async (a, b) => {
  const task = setup([draft("A", a), draft("B", b)]);
  await readyToConfirm();
  expect(screen.getByRole("heading", {name: "稿件 A"})).toBeTruthy();
  expect(screen.getByRole("heading", {name: "稿件 B"})).toBeTruthy();
  expect(task.location.history.at(-1)).toContain("/titles");
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.updateDraftMedia).not.toHaveBeenCalled();
  expect(task.preflightDraft).not.toHaveBeenCalled();
  expect(task.submitDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByText("内容检查通过")).toBeNull();
  expect(task.container.querySelector(".publishing-review-head")).toBeNull();
});

it("keeps same-media edits independent and checks only locally selected combinations", async () => {
  const task = setup();
  await readyToConfirm();
  fireEvent.change(screen.getByRole("textbox", {name: "稿件 A · 媒体 shared独立标题"}), {target: {value: "A 独立发布标题"}});
  expect((screen.getByRole("textbox", {name: "稿件 B · 媒体 shared独立标题"}) as HTMLInputElement).value).toBe("初始标题");
  for (const [id, mediaId] of [["A", "other"], ["B", "shared"], ["B", "other"]])
    fireEvent.click(screen.getByRole("checkbox", {name: `稿件 ${id} · 媒体 ${mediaId}参与本次发布`}));
  await waitFor(() => expect(feeValue("预计总价")).toBe("¥1.00"));
  expect(task.updateDraftMedia).not.toHaveBeenCalled();
  await beginConfirmation();
  const dialog = await screen.findByRole("alertdialog");
  expect(task.updateDraftMedia).toHaveBeenCalledWith("A", ["shared"], 1);
  expect(task.saveDraftTitles).toHaveBeenCalledTimes(1);
  expect(task.saveDraftTitles).toHaveBeenCalledWith("A", {mode: "per_media", titles: {shared: "A 独立发布标题"}, expectedRevision: 2});
  expect(task.preflightDraft.mock.calls.map(call => call[0])).toEqual(["A"]);
  expect(within(dialog).getByText("稿件 A · v1")).toBeTruthy();
  expect(within(dialog).queryByText("稿件 B · v1")).toBeNull();
  expect(task.location.history.at(-1)).toContain("/titles");
  expect(task.submitDraft).not.toHaveBeenCalled();
  expect(task.container.querySelectorAll(".publishing-title-table thead th")).toHaveLength(10);
});

it("blocks an entirely unchecked selection without writes or preflight", async () => {
  const task = setup();
  await readyToConfirm();
  for (const id of ["A", "B"]) for (const mediaId of ["shared", "other"])
    fireEvent.click(screen.getByRole("checkbox", {name: `稿件 ${id} · 媒体 ${mediaId}参与本次发布`}));
  expect((screen.getByRole("button", {name: "确认发布"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("本次未选择投放媒体，无法确认发布；请重新勾选或返回选择媒体。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "确认发布"}));
  expect(task.updateDraftMedia).not.toHaveBeenCalled();
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.preflightDraft).not.toHaveBeenCalled();
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("retains excluded titles after cancelling confirmation and re-entering titles", async () => {
  const task = setup();
  await readyToConfirm();
  fireEvent.change(screen.getByRole("textbox", {name: "稿件 A · 媒体 other独立标题"}), {target: {value: "返回时保留"}});
  fireEvent.click(screen.getByRole("checkbox", {name: "稿件 A · 媒体 other参与本次发布"}));
  await beginConfirmation();
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", {name: "返回检查"}));
  task.unmount();
  render(task.view());
  await readyToConfirm();
  const restored = screen.getByRole("textbox", {name: "稿件 A · 媒体 other独立标题"}) as HTMLInputElement;
  expect(restored.value).toBe("返回时保留");
  expect((screen.getByRole("checkbox", {name: "稿件 A · 媒体 other参与本次发布"}) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", {name: "稿件 A · 媒体 other参与本次发布"}));
  expect(restored.disabled).toBe(false);
  await beginConfirmation();
  await screen.findByRole("alertdialog");
  expect(task.updateDraftMedia).toHaveBeenLastCalledWith("A", ["shared", "other"], 3);
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("stops before writes and checks when the server selection changed", async () => {
  const task = setup();
  await readyToConfirm();
  const current = task.drafts.get("A")!;
  task.drafts.set("A", {...current, revision: 2, items: current.items.filter(item => item.media.id === "shared")});
  await beginConfirmation();
  await screen.findByText("部分草稿已更新，已同步最新媒体和版本并保留可用标题。请核对后再次点击确认发布。");
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.updateDraftMedia).not.toHaveBeenCalled();
  expect(task.preflightDraft).not.toHaveBeenCalled();
  expect(task.submitDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole("checkbox", {name: "稿件 A · 媒体 other参与本次发布"})).toBeNull();
});

it("waits for every title save and retries a partial save with the latest revisions", async () => {
  const task = setup();
  const originalSave = task.saveDraftTitles.getMockImplementation()!;
  let failed = false;
  task.saveDraftTitles.mockImplementation(async (id, input) => {
    if (id === "B" && !failed) {failed = true; throw new Error("暂时无法保存");}
    return originalSave(id, input);
  });
  await beginConfirmation();
  await screen.findByText(/稿件 B：暂时无法保存/);
  expect(task.drafts.get("A")?.revision).toBe(2);
  expect(task.preflightDraft).not.toHaveBeenCalled();
  expect(task.submitDraft).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await beginConfirmation();
  await screen.findByRole("alertdialog");
  const aCalls = task.saveDraftTitles.mock.calls.filter(([id]) => id === "A");
  expect((aCalls.at(-1)![1] as SaveDraftTitlesInput).expectedRevision).toBe(2);
  expect(task.events).toEqual(["save:A", "save:A", "save:B", "preflight:A", "preflight:B"]);
  expect(task.drafts.get("B")?.revision).toBe(2);
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("shows single and independent title rows together and saves both modes after confirmation", async () => {
  const task = setup([draft("A", "single"), draft("B")]);
  await readyToConfirm();
  expect(screen.getByLabelText("稿件 A · 媒体 shared统一标题").textContent).toBe("A 的上游确认标题");
  expect(screen.queryByRole("textbox", {name: "稿件 A · 媒体 shared独立标题"})).toBeNull();
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", {name: "稿件 B · 媒体 shared独立标题"}), {target: {value: "B 独立标题"}});
  await beginConfirmation();
  await screen.findByRole("alertdialog");
  expect(task.saveDraftTitles).toHaveBeenCalledWith("A", expect.objectContaining({mode: "single", sharedTitle: "A 的上游确认标题", titles: {shared: "A 的上游确认标题", other: "A 的上游确认标题"}}));
  expect(task.saveDraftTitles).toHaveBeenCalledWith("B", expect.objectContaining({mode: "per_media", titles: {shared: "B 独立标题", other: "初始标题"}}));
  expect(task.events).toEqual(["save:A", "save:B", "preflight:A", "preflight:B"]);
  expect(task.location.history.at(-1)).toContain("/titles");
});

it("leaves a missing shared title actionable instead of saving a filename", async () => {
  const task = setup([{...draft("A", "single"), sharedTitle: undefined, articleTitle: "upload.docx"}]);
  await screen.findByText(/单标题尚未确认或不符合已选媒体要求/);
  expect((screen.getByRole("button", {name: "确认发布"}) as HTMLButtonElement).disabled).toBe(true);
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.preflightDraft).not.toHaveBeenCalled();
  expect(task.location.history.at(-1)).toContain("/titles");
  expect(screen.getByRole("link", {name: "返回选择媒体"}).getAttribute("href")).toContain("/drafts/A/media");
});

it("checks the server-normalized title on the first confirmation while preserving an excluded local title", async () => {
  const task = setup([draft("A")]);
  const originalSave = task.saveDraftTitles.getMockImplementation()!;
  task.saveDraftTitles.mockImplementation(async (id, raw) => {
    const input = raw as SaveDraftTitlesInput;
    return originalSave(id, {...input, titles: Object.fromEntries(Object.entries(input.titles).map(([mediaId, title]) => [mediaId, title.trim()]))});
  });
  await readyToConfirm();
  fireEvent.change(screen.getByRole("textbox", {name: "稿件 A · 媒体 shared独立标题"}), {target: {value: "  发布标题  "}});
  fireEvent.change(screen.getByRole("textbox", {name: "稿件 A · 媒体 other独立标题"}), {target: {value: "  未选行保留  "}});
  fireEvent.click(screen.getByRole("checkbox", {name: "稿件 A · 媒体 other参与本次发布"}));
  await beginConfirmation();
  const dialog = await screen.findByRole("alertdialog");
  expect(task.saveDraftTitles).toHaveBeenCalledTimes(1);
  expect(task.preflightDraft).toHaveBeenCalledTimes(1);
  expect(task.events).toEqual(["media:A", "save:A", "preflight:A"]);
  expect((screen.getByRole("textbox", {name: "稿件 A · 媒体 shared独立标题"}) as HTMLInputElement).value).toBe("发布标题");
  expect((screen.getByRole("textbox", {name: "稿件 A · 媒体 other独立标题"}) as HTMLInputElement).value).toBe("  未选行保留  ");
  expect(within(dialog).getByText("标题：发布标题")).toBeTruthy();
  expect(task.submitDraft).not.toHaveBeenCalled();
});

