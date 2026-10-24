// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishingConnectionCheck } from "./PublishingConnectionCheck";

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("worker connection check button", () => {
  it("is hidden when a local gateway has no connection-check methods", () => {
    render(<PublishingConnectionCheck gateway={{}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("requests and reads only this check, including repeated requests sharing the minute's id", async () => {
    const gateway = { requestConnectionCheck: vi.fn(async () => ({ checkId: "check-1" })),
      getConnectionCheck: vi.fn(async () => ({ status: "healthy" as const, checkedAt: "2026-10-24T09:00:00Z" })) };
    render(<PublishingConnectionCheck gateway={gateway} />);
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "检查发布连接" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain("发布连接检查成功"));
    }
    expect(gateway.requestConnectionCheck).toHaveBeenCalledTimes(2);
    expect(gateway.getConnectionCheck).toHaveBeenCalledTimes(2);
    expect(gateway.getConnectionCheck).toHaveBeenLastCalledWith("check-1", expect.any(AbortSignal));
  });
  it("polls pending checks and stops after the worker records failure", async () => {
    vi.useFakeTimers();
    const gateway = { requestConnectionCheck: vi.fn(async () => ({ checkId: "check-2" })),
      getConnectionCheck: vi.fn().mockResolvedValueOnce({ status: "pending" }).mockResolvedValue({ status: "failed", message: "RAW_PROVIDER_ERROR" }) };
    render(<PublishingConnectionCheck gateway={gateway} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "检查发布连接" })); });
    expect(screen.getByRole("status").textContent).toContain("不会提交稿件或扣款");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(screen.getByRole("alert").textContent).toContain("本次连接检查未通过");
    expect(screen.queryByText("RAW_PROVIDER_ERROR")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(gateway.getConnectionCheck).toHaveBeenCalledTimes(2);
  });
  it("reports request failures in Chinese without trying to submit a manuscript", async () => {
    const gateway = { requestConnectionCheck: vi.fn(async () => { throw new Error("NETWORK_SECRET"); }), getConnectionCheck: vi.fn() };
    render(<PublishingConnectionCheck gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "检查发布连接" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("本次连接检查未通过"));
    expect(gateway.getConnectionCheck).not.toHaveBeenCalled();
    expect(screen.queryByText("NETWORK_SECRET")).toBeNull();
  });
});
