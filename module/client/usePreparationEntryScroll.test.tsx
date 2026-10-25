// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { usePreparationEntryScroll } from "./usePreparationEntryScroll";

let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let previousRequestFrame: PropertyDescriptor | undefined;
let previousCancelFrame: PropertyDescriptor | undefined;
beforeEach(() => {
  frames = new Map();
  frameId = 0;
  // The hook reads ownerDocument.defaultView; do not rely on Vitest making
  // globalThis aliases writable proxies for the jsdom Window.
  previousRequestFrame = Object.getOwnPropertyDescriptor(window, "requestAnimationFrame");
  previousCancelFrame = Object.getOwnPropertyDescriptor(window, "cancelAnimationFrame");
  Object.defineProperties(window, {
    requestAnimationFrame: { configurable: true, writable: true, value: (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    } },
    cancelAnimationFrame: { configurable: true, writable: true, value: (id: number) => { frames.delete(id); } },
  });
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.documentElement.scrollTop = 0;
  if (previousRequestFrame) Object.defineProperty(window, "requestAnimationFrame", previousRequestFrame);
  else Reflect.deleteProperty(window, "requestAnimationFrame");
  if (previousCancelFrame) Object.defineProperty(window, "cancelAnimationFrame", previousCancelFrame);
  else Reflect.deleteProperty(window, "cancelAnimationFrame");
});
function flushFrames() {
  act(() => {
    for (const [id, callback] of [...frames]) {
      if (frames.delete(id)) callback(0);
    }
  });
}
function scrollContainer(parent: HTMLElement, top = 640) {
  const node = document.createElement("div");
  node.style.overflowY = "auto";
  node.style.setProperty("scroll-behavior", "smooth", "important");
  Object.defineProperties(node, { scrollHeight: { value: 1600 }, clientHeight: { value: 600 } });
  node.scrollTop = top;
  parent.appendChild(node);
  return node;
}
function Page({ stage = "titles:task-1:A", ready = false, content = "稿件" }: {
  stage?: string; ready?: boolean; content?: string;
}) {
  const entryRef = usePreparationEntryScroll(stage, ready);
  return <div ref={entryRef}><input aria-label="标题" defaultValue={content} /><div>{content}</div></div>;
}

it("resets actual ancestor viewports without touching sibling panels, dialog scroll, horizontal position or focus", () => {
  const outer = scrollContainer(document.body);
  const inner = scrollContainer(outer, 420);
  const sibling = scrollContainer(document.body, 230);
  const focused = document.createElement("button");
  document.body.appendChild(focused);
  focused.focus();
  inner.scrollLeft = 90;
  document.documentElement.scrollTop = 80;
  const view = render(<Page ready />, { container: inner });
  const dialog = scrollContainer(view.container.firstElementChild as HTMLElement, 150);
  flushFrames(); flushFrames();
  expect([outer.scrollTop, inner.scrollTop, document.documentElement.scrollTop]).toEqual([0, 0, 0]);
  expect([sibling.scrollTop, dialog.scrollTop, inner.scrollLeft]).toEqual([230, 150, 90]);
  expect(inner.style.getPropertyValue("scroll-behavior")).toBe("smooth");
  expect(inner.style.getPropertyPriority("scroll-behavior")).toBe("important");
  expect(document.activeElement).toBe(focused);
});

it("corrects initial asynchronous restoration once, but preserves position across inputs and later preflight reloads", () => {
  const scroller = scrollContainer(document.body);
  const view = render(<Page />, { container: scroller });
  flushFrames(); flushFrames();
  scroller.scrollTop = 520; // A host restores the old stage before initial data arrives.
  view.rerender(<Page ready content="恢复完成" />);
  expect(scroller.scrollTop).toBe(0);
  flushFrames(); flushFrames();
  scroller.scrollTop = 370;
  view.rerender(<Page ready content="标题编辑" />);
  view.rerender(<Page ready={false} content="手动预检中" />);
  view.rerender(<Page ready content="手动预检完成" />);
  expect(frames.size).toBe(0);
  flushFrames(); flushFrames();
  expect(scroller.scrollTop).toBe(370);
});

it("resets on stage/task entries and returns, including a direct ready review entry", () => {
  const scroller = scrollContainer(document.body);
  const view = render(<Page ready />, { container: scroller });
  flushFrames(); flushFrames();
  for (const stage of ["review:task-1:A", "titles:task-1:A", "review:task-2:B"]) {
    scroller.scrollTop = 540;
    view.rerender(<Page stage={stage} ready />);
    expect(scroller.scrollTop).toBe(0);
    flushFrames(); flushFrames();
  }
});

it.each(["wheel", "touchstart", "pointerdown", "keydown"])("does not pull back after a user %s during initial loading", eventType => {
  const scroller = scrollContainer(document.body);
  const view = render(<Page />, { container: scroller });
  fireEvent(view.container.firstElementChild!, new Event(eventType, { bubbles: true }));
  scroller.scrollTop = 280;
  view.rerender(<Page ready />);
  flushFrames(); flushFrames();
  expect(scroller.scrollTop).toBe(280);
});

it("cancels deferred corrections when leaving and does not install global history scroll restoration", () => {
  const scroller = scrollContainer(document.body);
  const previous = window.history.scrollRestoration;
  const view = render(<Page ready />, { container: scroller });
  view.unmount();
  expect(frames.size).toBe(0);
  scroller.scrollTop = 410;
  flushFrames(); flushFrames();
  expect(scroller.scrollTop).toBe(410);
  expect(window.history.scrollRestoration).toBe(previous);
});

it("treats a persisted pageshow as a fresh entry without resetting on ordinary renders", () => {
  const scroller = scrollContainer(document.body);
  const view = render(<Page stage="review:task-1:A" ready />, { container: scroller });
  flushFrames(); flushFrames();
  scroller.scrollTop = 430;
  fireEvent(window, new Event("pageshow"));
  expect(scroller.scrollTop).toBe(430);
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  fireEvent(window, event);
  expect(scroller.scrollTop).toBe(0);
  view.rerender(<Page stage="review:task-1:A" ready={false} />);
  flushFrames(); flushFrames();
  scroller.scrollTop = 340; // Host restoration before the new metadata settles.
  view.rerender(<Page stage="review:task-1:A" ready />);
  expect(scroller.scrollTop).toBe(0);
});

it("cleans up StrictMode's first entrance and settles only the surviving entrance", () => {
  const scroller = scrollContainer(document.body);
  const view = render(<React.StrictMode><Page ready /></React.StrictMode>, { container: scroller });
  expect(frames.size).toBe(1);
  expect(scroller.scrollTop).toBe(0);
  flushFrames();
  expect(frames.size).toBe(1);
  flushFrames();
  expect(frames.size).toBe(0);
  scroller.scrollTop = 320;
  view.rerender(<React.StrictMode><Page ready={false} /></React.StrictMode>);
  view.rerender(<React.StrictMode><Page ready /></React.StrictMode>);
  expect(scroller.scrollTop).toBe(320);
  expect(frames.size).toBe(0);
  view.unmount();
  expect(frames.size).toBe(0);
});
