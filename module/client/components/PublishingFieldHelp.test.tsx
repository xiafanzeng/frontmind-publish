// @vitest-environment jsdom
// This light Popover replacement verifies component wiring only. Actual Radix
// focus restoration, Escape, outside clicks and portal layout need browser acceptance.
import React, { type ReactNode, type MouseEventHandler } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PublishingFieldHelp from "./PublishingFieldHelp";
import PublishingReservationHelp from "./PublishingReservationHelp";

vi.mock("@frontmind/module-ui/components/ui/popover", async () => {
  const React = await import("react");
  const Open = React.createContext(false);
  return {
    Popover: ({ open, children }: { open: boolean; children: ReactNode }) => <Open.Provider value={open}>{children}</Open.Provider>,
    PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    PopoverContent: React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
      const open = React.useContext(Open);
      return open ? <div ref={ref} role="dialog" aria-label={String(props["aria-label"])}
        aria-describedby={String(props["aria-describedby"])} onMouseEnter={props.onMouseEnter as MouseEventHandler<HTMLDivElement>}
        onMouseLeave={props.onMouseLeave as MouseEventHandler<HTMLDivElement>}>{props.children as ReactNode}</div> : null;
    }),
  };
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("shared publishing help wiring", () => {
  it("opens on hover, associates the explanation and dismisses after leaving without changing a filter", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    render(<form onSubmit={submit}><PublishingFieldHelp label="预计发布时效说明" explanation="范围按较慢一端，具体起算以媒体要求为准。" /></form>);
    const trigger = screen.getByRole("button", { name: "预计发布时效说明" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.mouseEnter(trigger);
    const description = screen.getByText("范围按较慢一端，具体起算以媒体要求为准。");
    expect(trigger.getAttribute("aria-describedby")).toBe(description.id);
    fireEvent.mouseLeave(trigger);
    act(() => vi.advanceTimersByTime(160));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("opens on focus and pins the first click even when focus opened it first", () => {
    vi.useFakeTimers();
    render(<PublishingFieldHelp label="节假日发布说明" explanation="不直接等同于周末。" />);
    const trigger = screen.getByRole("button", { name: "节假日发布说明" });
    fireEvent.focus(trigger);
    expect(screen.getByRole("dialog", { name: "节假日发布说明" })).toBeTruthy();
    fireEvent.click(trigger);
    fireEvent.mouseLeave(trigger);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "关闭说明" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the reservation wrapper's original label and amount explanation", () => {
    render(<PublishingReservationHelp />);
    const trigger = screen.getByRole("button", { name: "本次待预占说明" });
    expect(trigger.getAttribute("type")).toBe("button");
    fireEvent.mouseEnter(trigger);
    expect(screen.getByText(/当前展示不代表资金已冻结/)).toBeTruthy();
  });
});
