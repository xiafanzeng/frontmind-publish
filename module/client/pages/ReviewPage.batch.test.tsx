// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublisherGatewayError } from "../gateway";
import { configurePublishingHost } from "../host";
import type { PublicationBatch, PublicationPreflight, PublishingDashboard } from "../types";
import { acceptedBatch, beginConfirmation, confirmFinal, dashboard, draft, feeValue, readyToConfirm, setup, snapshot, taskFlow } from "./titlesConfirmationTestSupport";

// Confirmation is exercised through the real title-page entry, including title persistence.
afterEach(() => {cleanup(); configurePublishingHost({}); vi.restoreAllMocks(); window.history.replaceState({}, "", "/");});

it.each([false, true])("requires a modal acknowledgement after save/check in flow=%s before the original submit pipeline", async inFlow => {
  const task = setup(undefined, "", inFlow ? taskFlow() : undefined);
  await beginConfirmation();
  const dialog = await screen.findByRole("alertdialog");
  const finalButton = within(dialog).getByRole("button", {name: "确认模拟发布 ¥4.00"}) as HTMLButtonElement;
  expect(finalButton.disabled).toBe(true);
  expect(task.events).toEqual(["save:A", "save:B", "preflight:A", "preflight:B"]);
  expect(task.submitDraft).not.toHaveBeenCalled();
  fireEvent.click(finalButton);
  expect(task.submitDraft).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("checkbox"));
  expect(finalButton.disabled).toBe(false);
  fireEvent.click(finalButton);
  fireEvent.click(finalButton);
  await waitFor(() => expect(task.submitDraft).toHaveBeenCalledTimes(2));
  expect(task.events).toEqual(["save:A", "save:B", "preflight:A", "preflight:B", "preflight:A", "submit:A", "preflight:B", "submit:B"]);
  expect(task.submitDraft).toHaveBeenNthCalledWith(1, {draftId: "A", preflightRevision: "preflight-A-2",
    quoteFingerprint: "quote-A-2", acknowledged: true, idempotencyKey: "publisher-submit:A:quote-A-2"});
  expect(task.submitDraft).toHaveBeenNthCalledWith(2, {draftId: "B", preflightRevision: "preflight-B-2",
    quoteFingerprint: "quote-B-2", acknowledged: true, idempotencyKey: "publisher-submit:B:quote-B-2"});
  expect(await screen.findByText("全部发布请求已受理，请查看各稿件结果")).toBeTruthy();
  expect(task.location.history.at(-1)).toContain("/titles");
});

it("shows the selected quantity-inclusive fee immediately without saving or approving content", async () => {
  const quoted = draft("A");
  quoted.items = [quoted.items[0]!];
  quoted.items[0]!.publication = {schemaVersion: 1, source: "source_matrix_budget_plan", taskId: "task-1",
    planId: "plan-1", planVersion: "v1", planIndex: 0, articleId: quoted.articleId, articleVersionId: quoted.articleVersionId,
    articleVersion: "v1", resourceId: "shared", offerId: "offer-1", publicationSpec: "article", quantity: 3,
    quantityMeaning: "repeat_same_article", purpose: "standard", unitPriceTenThousandths: "10000",
    totalPriceTenThousandths: "35000", quoteFingerprint: "a".repeat(64), locked: false};
  const task = setup([quoted, draft("B")]);
  await readyToConfirm();
  await waitFor(() => expect(feeValue("预计总价")).toBe("¥5.50"));
  expect(feeValue("本次待预占")).toBe("待发布前核验后确定");
  fireEvent.click(screen.getByRole("checkbox", {name: "稿件 B · 媒体 other参与本次发布"}));
  await waitFor(() => expect(feeValue("预计总价")).toBe("¥4.50"));
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.updateDraftMedia).not.toHaveBeenCalled();
  expect(task.preflightDraft).not.toHaveBeenCalled();
  expect(screen.queryByText("内容检查通过")).toBeNull();
});

it("keeps a live submission behind the final explicit acknowledgement", async () => {
  const task = setup([draft("A")]);
  task.preflightDraft.mockImplementation(async id => ({...snapshot(task.drafts.get(id)!), mode: "live"}));
  await beginConfirmation();
  const dialog = await screen.findByRole("alertdialog", {name: "这是一次真实投稿"});
  const submit = within(dialog).getByRole("button", {name: "提交并预占 ¥2.00"}) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  expect(task.submitDraft).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", {name: "返回检查"}));
  expect(task.submitDraft).not.toHaveBeenCalled();
  await beginConfirmation();
  await confirmFinal();
  await waitFor(() => expect(task.submitDraft).toHaveBeenCalledTimes(1));
  expect(task.preflightDraft).toHaveBeenCalledTimes(3);
});

it("keeps checked wallet authoritative when an older dashboard balance arrives late", async () => {
  let resolveBalance!: (value: PublishingDashboard) => void;
  const task = setup(undefined, "", undefined, {getDashboard: vi.fn(() => new Promise<PublishingDashboard>(resolve => {resolveBalance = resolve;}))});
  await beginConfirmation();
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("checkbox"));
  expect(feeValue("可用余额")).toBe("¥10.00");
  await act(async () => resolveBalance(dashboard("990000")));
  expect(feeValue("可用余额")).toBe("¥10.00");
  expect((within(dialog).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect((within(dialog).getByRole("button", {name: "确认模拟发布 ¥4.00"}) as HTMLButtonElement).disabled).toBe(false);
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("blocks the final dialog when preflight balance cannot cover all selected manuscripts", async () => {
  const task = setup();
  task.preflightDraft.mockImplementation(async id => snapshot(task.drafts.get(id)!, "30000"));
  await readyToConfirm();
  await waitFor(() => expect(feeValue("可用余额")).toBe("¥10.00"));
  await beginConfirmation();
  await screen.findByText("可用余额不足以覆盖本次全部待提交组合，请调整媒体后重新预检。");
  expect(feeValue("可用余额")).toBe("¥3.00");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("does not treat a failed preflight request as content failure or approve an incomplete run", async () => {
  const task = setup();
  let failing = true;
  task.preflightDraft.mockImplementation(async id => {
    if (id === "B" && failing) throw new Error("第二稿服务暂不可用");
    return snapshot(task.drafts.get(id)!);
  });
  await beginConfirmation();
  await screen.findByText(/第二稿服务暂不可用/);
  expect(screen.getAllByText("内容检查通过")).toHaveLength(2);
  expect(screen.queryByText("内容检查不通过")).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(feeValue("本次待预占")).toBe("待发布前核验后确定");
  expect(task.submitDraft).not.toHaveBeenCalled();
  failing = false;
  await beginConfirmation();
  await screen.findByRole("alertdialog");
  expect(screen.getAllByText("内容检查通过")).toHaveLength(4);
  expect(task.preflightDraft).toHaveBeenCalledTimes(4);
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("lists only passed combinations in final confirmation and narrows failed media only on final submit", async () => {
  const task = setup([draft("A")]);
  task.preflightDraft.mockImplementation(async id => {
    const value = snapshot(task.drafts.get(id)!);
    const blocked = value.items.find(item => item.media.id === "other");
    if (blocked) {blocked.blockers = ["正文不支持图片"]; blocked.checks = [{label: "正文能力匹配", passed: false}];}
    return value;
  });
  await beginConfirmation();
  const dialog = await screen.findByRole("alertdialog");
  expect(screen.getByText("内容检查不通过")).toBeTruthy();
  expect(screen.getByText("正文不支持图片")).toBeTruthy();
  expect(within(dialog).getByRole("button", {name: "确认模拟发布 ¥1.00"})).toBeTruthy();
  expect(within(dialog).queryByText("媒体 other")).toBeNull();
  expect(task.updateDraftMedia).not.toHaveBeenCalled();
  expect(task.submitDraft).not.toHaveBeenCalled();
  await confirmFinal();
  await waitFor(() => expect(task.submitDraft).toHaveBeenCalledTimes(1));
  expect(task.updateDraftMedia).toHaveBeenCalledWith("A", ["shared"], 2);
  expect(task.submitDraft).toHaveBeenCalledWith({draftId: "A", preflightRevision: "preflight-A-3",
    quoteFingerprint: "quote-A-3", acknowledged: true, idempotencyKey: "publisher-submit:A:quote-A-3"});
});

it("locks edits and starts no duplicate saves or checks while confirmation is in flight", async () => {
  const resolvers: Array<() => void> = [];
  const task = setup();
  task.preflightDraft.mockImplementation(id => new Promise<PublicationPreflight>(resolve =>
    resolvers.push(() => resolve(snapshot(task.drafts.get(id)!)))));
  const button = await readyToConfirm();
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(resolvers).toHaveLength(2));
  expect(task.saveDraftTitles).toHaveBeenCalledTimes(2);
  expect((screen.getByRole("textbox", {name: "稿件 A · 媒体 shared独立标题"}) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", {name: "正在核验…"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("内容检查通过")).toBeNull();
  await act(async () => {resolvers.forEach(resolve => resolve());});
  await screen.findByRole("alertdialog");
  expect(task.preflightDraft).toHaveBeenCalledTimes(2);
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("invalidates checked results and final consent after editing a title or selection", async () => {
  const task = setup();
  await beginConfirmation();
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", {name: "返回检查"}));
  fireEvent.change(screen.getByRole("textbox", {name: "稿件 A · 媒体 shared独立标题"}), {target: {value: "修改后的标题"}});
  expect(screen.queryByText("内容检查通过")).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(task.submitDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", {name: "稿件 B · 媒体 other参与本次发布"}));
  await beginConfirmation();
  const nextDialog = await screen.findByRole("alertdialog");
  expect((within(nextDialog).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(within(nextDialog).getByText("标题：修改后的标题")).toBeTruthy();
  expect(within(nextDialog).getByRole("button", {name: "确认模拟发布 ¥3.00"})).toHaveProperty("disabled", true);
  expect(task.preflightDraft).toHaveBeenCalledTimes(4);
});

it("rejects a late approval when the frozen manuscript changes during preflight", async () => {
  const task = setup();
  task.preflightDraft.mockImplementation(async id => {
    const value = snapshot(task.drafts.get(id)!);
    if (id === "A") {
      const current = task.drafts.get(id)!;
      task.drafts.set(id, {...current, revision: current.revision + 1, articleVersionId: "changed-version", articleVersionHash: "changed-hash"});
    }
    return value;
  });
  await beginConfirmation();
  await screen.findByText("稿件版本或标题已变化，请确认更新后的内容，再点击确认发布。");
  await waitFor(() => expect(screen.queryByText("内容检查通过")).toBeNull());
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("invalidates the open modal after browser restoration without automatically saving or checking again", async () => {
  const task = setup();
  await beginConfirmation();
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("checkbox"));
  act(() => {
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", {value: true});
    window.dispatchEvent(event);
  });
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await readyToConfirm();
  expect(screen.queryByText("内容检查通过")).toBeNull();
  expect(task.saveDraftTitles).toHaveBeenCalledTimes(2);
  expect(task.preflightDraft).toHaveBeenCalledTimes(2);
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("ignores an old check after the selected route context changes", async () => {
  const resolvers: Array<() => void> = [];
  const task = setup();
  task.preflightDraft.mockImplementation(id => new Promise<PublicationPreflight>(resolve =>
    resolvers.push(() => resolve(snapshot(task.drafts.get(id)!)))));
  await beginConfirmation();
  await waitFor(() => expect(resolvers).toHaveLength(2));
  act(() => task.location.navigate("/publishing/drafts/A/titles?batchDraft=A&batchDraft=B&batchArticleVersion=new-selection"));
  await readyToConfirm();
  await act(async () => {resolvers.forEach(resolve => resolve());});
  expect(screen.queryByText("内容检查通过")).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("opens the matching frozen body and returns focus without checking or submitting again", async () => {
  const task = setup();
  await beginConfirmation();
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", {name: "返回检查"}));
  const card = screen.getByRole("region", {name: "稿件 A"});
  const trigger = within(card).getByRole("button", {name: "查看冻结正文"});
  trigger.focus();
  fireEvent.click(trigger);
  const preview = await screen.findByRole("dialog");
  expect(within(preview).getByText("A 的冻结正文")).toBeTruthy();
  expect(within(preview).queryByText("B 的冻结正文")).toBeNull();
  fireEvent.click(within(preview).getByRole("button", {name: "关闭冻结正文"}));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(task.preflightDraft).toHaveBeenCalledTimes(2);
  expect(task.submitDraft).not.toHaveBeenCalled();
});

it("restores accepted receipts and exact unknown requests after task hydration despite URL exclusion", async () => {
  const request = {draftId: "B", preflightRevision: "original-B", quoteFingerprint: "original-quote-B",
    acknowledged: true, idempotencyKey: "publisher-submit:B:original-quote-B"};
  const pendingFlow = taskFlow({}, true);
  const task = setup(undefined, "&excludedDraft=B", pendingFlow);
  await act(async () => undefined);
  expect(pendingFlow.saveValues).not.toHaveBeenCalled();
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.preflightDraft).not.toHaveBeenCalled();
  const flow = taskFlow({"publishingBatchReview:A,B": JSON.stringify({acceptedBatchIds: {A: "batch-A"}, requests: {B: request}})});
  task.rerender(task.view(flow));
  await screen.findByRole("link", {name: "查看本稿发布结果"});
  await screen.findByText("发布请求受理结果待确认，当前配置已锁定；请核实原请求。");
  expect(feeValue("预计总价")).toBe("受理结果待确认");
  expect((screen.getByRole("textbox", {name: "稿件 A · 媒体 shared独立标题"}) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("textbox", {name: "稿件 B · 媒体 shared独立标题"}) as HTMLInputElement).disabled).toBe(true);
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.preflightDraft).not.toHaveBeenCalled();
  expect(task.submitDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name: "核实原请求受理结果"}));
  expect(task.submitDraft).not.toHaveBeenCalled();
  await confirmFinal();
  await waitFor(() => expect(task.submitDraft).toHaveBeenCalledTimes(1));
  expect(task.submitDraft).toHaveBeenCalledWith(request);
  expect(task.preflightDraft).not.toHaveBeenCalled();
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.updateDraftMedia).not.toHaveBeenCalled();
});

it("skips accepted drafts while saving and confirming the remaining manuscript", async () => {
  const flow = taskFlow({"publishingBatchReview:A,B": JSON.stringify({acceptedBatchIds: {A: "batch-A"}, requests: {}})});
  const task = setup(undefined, "&batchArticle=article-A&batchArticle=article-B&batchArticleVersion=version-A&batchArticleVersion=version-B", flow);
  await readyToConfirm();
  expect((screen.getByRole("textbox", {name: "稿件 A · 媒体 shared独立标题"}) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("textbox", {name: "稿件 B · 媒体 shared独立标题"}) as HTMLInputElement).disabled).toBe(false);
  const revise = new URL(screen.getByRole("link", {name: "修改待提交稿件"}).getAttribute("href")!, window.location.origin);
  expect(revise.searchParams.getAll("batchDraft")).toEqual(["B"]);
  expect(revise.searchParams.getAll("batchArticle")).toEqual(["article-B"]);
  expect(revise.searchParams.getAll("batchArticleVersion")).toEqual(["version-B"]);
  await beginConfirmation();
  const dialog = await screen.findByRole("alertdialog");
  expect(task.saveDraftTitles.mock.calls.map(call => call[0])).toEqual(["B"]);
  expect(task.preflightDraft.mock.calls.map(call => call[0])).toEqual(["B"]);
  expect(within(dialog).queryByText("稿件 A · v1")).toBeNull();
  await confirmFinal();
  await waitFor(() => expect(task.submitDraft).toHaveBeenCalledTimes(1));
  expect(task.submitDraft.mock.calls[0]![0].draftId).toBe("B");
});

it("refreshes an accepted attention batch read-only before allowing remaining confirmation", async () => {
  const flow = taskFlow({"publishingBatchReview:A,B": JSON.stringify({acceptedBatchIds: {A: "batch-A"}, requests: {}})});
  const getBatch = vi.fn(async () => acceptedBatch("A", true));
  const task = setup(undefined, "", flow, {getBatch});
  await screen.findByText(/已受理批次有待核实结果/);
  expect((screen.getByRole("button", {name: "确认发布"}) as HTMLButtonElement).disabled).toBe(true);
  getBatch.mockResolvedValue(acceptedBatch("A"));
  fireEvent.click(screen.getByRole("button", {name: "刷新受理状态"}));
  await readyToConfirm();
  expect(task.saveDraftTitles).not.toHaveBeenCalled();
  expect(task.preflightDraft).not.toHaveBeenCalled();
  expect(task.submitDraft).not.toHaveBeenCalled();
  await beginConfirmation();
  await screen.findByRole("alertdialog");
  expect(task.preflightDraft.mock.calls.map(call => call[0])).toEqual(["B"]);
});

it("keeps accepted receipts and the original unknown request when a later submission loses its response", async () => {
  const task = setup();
  task.submitDraft.mockImplementation(async input => {
    if (input.draftId === "B") throw new PublisherGatewayError("连接中断", "unavailable");
    return acceptedBatch("A");
  });
  await beginConfirmation();
  await confirmFinal();
  await screen.findByText(/受理结果尚未确认，后续稿件已暂停/);
  expect(task.submitDraft.mock.calls.map(call => call[0].draftId)).toEqual(["A", "B", "B"]);
  const original = task.submitDraft.mock.calls[1]![0];
  expect(task.submitDraft.mock.calls[2]![0]).toEqual(original);
  expect(screen.getByRole("link", {name: "查看本稿发布结果"})).toBeTruthy();
  task.submitDraft.mockImplementation(async input => acceptedBatch(input.draftId));
  fireEvent.click(screen.getByRole("button", {name: "核实原请求受理结果"}));
  await confirmFinal();
  await waitFor(() => expect(task.submitDraft).toHaveBeenCalledTimes(4));
  expect(task.submitDraft.mock.calls[3]![0]).toEqual(original);
  expect(task.saveDraftTitles).toHaveBeenCalledTimes(2);
  expect(task.preflightDraft).toHaveBeenCalledTimes(4);
});

it("keeps the adjusted wallet while the later accepted response is still unresolved", async () => {
  const task = setup();
  let resolveSecond!: (value: PublicationBatch) => void;
  let checks = 0;
  task.preflightDraft.mockImplementation(async id => snapshot(task.drafts.get(id)!, ++checks > 2 && id === "B" ? "80000" : "100000"));
  task.submitDraft.mockImplementation(input => input.draftId === "A" ? Promise.resolve(acceptedBatch("A"))
    : new Promise(resolve => {resolveSecond = resolve;}));
  await beginConfirmation();
  await confirmFinal();
  await waitFor(() => expect(task.submitDraft).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(feeValue("预计可用余额")).toBe("¥8.00"));
  expect(feeValue("预计总价")).toBe("受理结果待确认");
  await act(async () => resolveSecond(acceptedBatch("B")));
  await screen.findByText("全部发布请求已受理，请查看各稿件结果");
});

