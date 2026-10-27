// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PublishingTitleInput } from "./PublishingTitleInput";

afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();});

it("grows for wrapped content, shrinks for short titles, and remeasures when its container narrows", () => {
  let contentHeight = 42;
  let onResize: ResizeObserverCallback | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) {onResize = callback;}
    observe = vi.fn();
    disconnect = disconnect;
  });
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(() => contentHeight);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(44);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(42);
  const view = render(<PublishingTitleInput aria-label="发布标题" value="短标题" onChange={() => undefined} />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(input.rows).toBe(1);
  expect(input.style.height).toBe("44px");

  contentHeight = 84;
  view.rerender(<PublishingTitleInput aria-label="发布标题" value="更长的发布标题" onChange={() => undefined} />);
  expect(input.style.height).toBe("86px");
  contentHeight = 42;
  view.rerender(<PublishingTitleInput aria-label="发布标题" value="短标题" onChange={() => undefined} />);
  expect(input.style.height).toBe("44px");

  contentHeight = 105;
  act(() => onResize?.([{contentRect:{width:120}} as ResizeObserverEntry], {} as ResizeObserver));
  expect(input.style.height).toBe("107px");
  contentHeight = 42;
  act(() => onResize?.([{contentRect:{width:600}} as ResizeObserverEntry], {} as ResizeObserver));
  expect(input.style.height).toBe("44px");
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
