// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import PublishingReservationHelp from "./PublishingReservationHelp";

afterEach(() => {cleanup(); vi.restoreAllMocks();});

it("opens on hover in the shared portal and dismisses without taking focus", async () => {
  const {container} = render(<><input aria-label="当前标题" /><PublishingReservationHelp /></>);
  const input = screen.getByRole("textbox");
  act(() => input.focus());
  fireEvent.mouseEnter(screen.getByRole("button", {name: "本次待预占说明"}));
  const help = await screen.findByRole("dialog", {name: "本次待预占说明"});
  expect(container.contains(help)).toBe(false);
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(document, {key: "Escape"});
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(input);
});

it("supports focus and Escape without immediately reopening the help", async () => {
  render(<PublishingReservationHelp />);
  const trigger = screen.getByRole("button", {name: "本次待预占说明"});
  act(() => trigger.focus());
  const help = await screen.findByRole("dialog", {name: "本次待预占说明"});
  act(() => within(help).getByRole("button", {name: "关闭说明"}).focus());
  fireEvent.keyDown(document, {key: "Escape"});
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it("returns focus to the help trigger when a hover-opened explanation is closed from inside", async () => {
  render(<PublishingReservationHelp />);
  const trigger = screen.getByRole("button", {name:"本次待预占说明"});
  fireEvent.mouseEnter(trigger);
  const help = await screen.findByRole("dialog", {name:"本次待预占说明"});
  const close = within(help).getByRole("button", {name:"关闭说明"});
  act(() => close.focus());
  fireEvent.click(close);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it("pins the first touch/click, closes outside, and never submits its surrounding form", async () => {
  const submit = vi.fn((event: FormEvent) => event.preventDefault());
  render(<><form onSubmit={submit}><PublishingReservationHelp /></form><button type="button">外部操作</button></>);
  const trigger = screen.getByRole("button", {name: "本次待预占说明"});
  // A real touch focuses the trigger before its synthetic click.
  act(() => trigger.focus());
  fireEvent.click(trigger);
  await screen.findByRole("dialog", {name: "本次待预占说明"});
  fireEvent.mouseLeave(trigger);
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 200));});
  expect(screen.getByRole("dialog", {name: "本次待预占说明"})).toBeTruthy();
  const outside = screen.getByRole("button", {name: "外部操作"});
  fireEvent.pointerDown(outside, {button:0, pointerType:"mouse"});
  act(() => outside.focus());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(outside);
  expect(submit).not.toHaveBeenCalled();
});
