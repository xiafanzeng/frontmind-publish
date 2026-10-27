import { describe, expect, it } from "vitest";
import { mediaReadError } from "./mediaReadError";

describe("media error presentation", () => {
  it.each([
    "Failed query: select `id` from `publisher_runtime_state` where id = ? params: kol,1",
    "筛选读取失败：select count(*) from publisher_media_resources",
    "数据库读取失败 SQLSTATE 42S22",
    "配置 PUBLISHER_KOL_ACCESS_TOKEN 后重试",
  ])("hides technical detail without mutating the original error", message => {
    const original = new Error(message);
    expect(mediaReadError(original, "媒体目录暂不可用，请重试。")).toBe("媒体目录暂不可用，请重试。");
    expect(original.message).toBe(message);
  });
  it("retains actionable business reasons and localizes network failures", () => {
    expect(mediaReadError(new Error("稿件版本已变化，请返回稿件页面确认。"))).toBe("稿件版本已变化，请返回稿件页面确认。");
    expect(mediaReadError(new Error("Failed to fetch"))).toBe("连接暂时不可用，请稍后重试。");
    expect(mediaReadError(new Error("ETIMEDOUT"))).toBe("读取超时，请重试。");
  });
});
