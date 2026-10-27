import { RepositoryError } from "@frontmind/module-contracts/errors";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { createPublishRoutes } from "./routes.js";

function reader(error: Error) {
  const fail = vi.fn(async () => { throw error; });
  const authorize = vi.fn(async (_context: object, _capability: "customer" | "admin") => ({
    user: { id: "current-owner" },
    publishingRepository: {
      listPublisherMedia: fail,
      getPublisherMediaFacets: fail,
      getPublisherDraft: fail,
    },
  }));
  const { publisherRouter } = createPublishRoutes({ authorize } as never);
  return { caller: publisherRouter.createCaller({}), authorize, fail };
}

describe("media browser read errors", () => {
  it("keeps database diagnostics in the server cause while returning safe per-request messages", async () => {
    const driver = new Error("private database diagnostic code");
    const database = new Error("Failed query: select private_columns from private_table params: private-owner", { cause: driver });
    const { caller, authorize, fail } = reader(database);
    const draftId = "c62ce15a-e403-4f99-a3d3-b02c6d4c19e0";
    const cases = [
      { read: () => caller.media.list({}), message: "媒体列表读取失败，请稍后重试。" },
      { read: () => caller.media.facets({}), message: "媒体筛选项读取失败，请稍后重试。" },
      { read: () => caller.drafts.get({ draftId }), message: "投放草稿读取失败，请重试读取草稿。" },
    ];
    for (const { read, message } of cases) {
      await expect(read()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message, cause: database });
    }
    expect(database.cause).toBe(driver);
    expect(authorize.mock.calls.every((call) => call[1] === "customer")).toBe(true);
    expect(fail).toHaveBeenLastCalledWith("current-owner", draftId);
  });

  it("preserves actionable catalogue changes and permission errors", async () => {
    const changed = new RepositoryError("CONFLICT", "媒体目录已更新，请重试读取筛选项。");
    await expect(reader(changed).caller.media.facets({})).rejects.toMatchObject({
      code: "CONFLICT", message: changed.message, cause: changed,
    });
    const forbidden = new TRPCError({ code: "FORBIDDEN", message: "当前工作区不可读取此稿件。" });
    await expect(reader(forbidden).caller.drafts.get({ draftId: "c62ce15a-e403-4f99-a3d3-b02c6d4c19e0" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: forbidden.message });
  });

  it("sanitizes a prewrapped internal error without losing its original cause", async () => {
    const database = new Error("Failed query: select private_values");
    const internal = new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: database.message, cause: database });
    await expect(reader(internal).caller.media.list({})).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR", message: "媒体列表读取失败，请稍后重试。", cause: internal,
    });
  });
});
