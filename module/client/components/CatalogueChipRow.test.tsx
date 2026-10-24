// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CatalogueChipRow from "./CatalogueChipRow";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function geometry(available: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains("mc-chip-body") ? available : 70;
    return { width, height: 34, top: 0, left: 0, right: width, bottom: 34, x: 0, y: 0, toJSON: () => ({}) };
  });
}

describe("single-line catalogue choices", () => {
  it("only mounts complete visible choices; expand/collapse never applies a filter", () => {
    geometry(170);
    const change = vi.fn();
    render(<CatalogueChipRow label="频道" value="第三项" options={["第一项", "第二项", "第三项"].map(value => ({ value, label: value }))} onChange={change} />);
    expect(screen.queryByRole("button", { name: "第三项" })).toBeNull();
    expect(screen.getByText(/频道已选：第三项/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "展开频道选项" }));
    expect(screen.getByRole("button", { name: "第三项" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "收起频道选项" }));
    expect(screen.queryByRole("button", { name: "第三项" })).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it("does not show an expand affordance when all choices fit", () => {
    geometry(600);
    render(<CatalogueChipRow label="频道" value="" options={[{ value: "新闻", label: "新闻" }]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "新闻" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "展开频道选项" })).toBeNull();
  });
});
