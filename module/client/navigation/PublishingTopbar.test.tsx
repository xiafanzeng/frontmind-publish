// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PublisherGateway } from "../gateway";
import type { MediaList, MediaResource } from "../types";
import PublishingTopbar from "./PublishingTopbar";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

// Only the read method consumed by the topbar is provided. These are test fixtures, not app data.
const gatewayFor = (listMedia: PublisherGateway["listMedia"]) => ({listMedia}) as PublisherGateway;
const mediaList = (items: Array<Partial<MediaResource>>) => ({items,total:items.length}) as MediaList;
const deferred = () => {
  let resolve!: (value: MediaList) => void;
  const promise = new Promise<MediaList>(done => {resolve=done;});
  return {promise,resolve};
};
const advance = async (milliseconds: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
};

it("debounces actual media queries and waits for Chinese composition", async () => {
  vi.useFakeTimers();
  const listMedia = vi.fn<PublisherGateway["listMedia"]>().mockResolvedValue(mediaList([]));
  const navigate = vi.fn();
  render(<PublishingTopbar path="/publishing" search="" gateway={gatewayFor(listMedia)} onNavigate={navigate}/>);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  await advance(500);
  expect(listMedia).not.toHaveBeenCalled();
  fireEvent.compositionStart(input);
  fireEvent.change(input,{target:{value:"新闻"}});
  fireEvent.keyDown(input,{key:"Enter",keyCode:229,isComposing:true});
  await advance(500);
  expect(listMedia).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input,{data:"新闻"});
  await advance(299);
  expect(listMedia).not.toHaveBeenCalled();
  await advance(1);
  expect(listMedia).toHaveBeenCalledWith(expect.objectContaining({query:"新闻",page:1,pageSize:10,kind:"news"}),expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("button",{name:"清空搜索"}));
  await advance(500);
  expect(listMedia).toHaveBeenCalledTimes(1);
});

it("ignores obsolete responses and opens media by provider ID with draft context", async () => {
  vi.useFakeTimers();
  const old = deferred(), latest = deferred();
  const listMedia = vi.fn<PublisherGateway["listMedia"]>()
    .mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const navigate = vi.fn();
  render(<PublishingTopbar path="/publishing/source-matrix" search="draftId=d1&task=t1&mode=multi"
    gateway={gatewayFor(listMedia)} onNavigate={navigate}/>);
  const input = screen.getByRole("combobox");
  fireEvent.change(input,{target:{value:"旧词"}});
  await advance(300);
  fireEvent.change(input,{target:{value:"新词"}});
  expect(listMedia.mock.calls[0]?.[1]?.aborted).toBe(true);
  await advance(300);
  await act(async () => {latest.resolve(mediaList([{id:"internal-uuid",externalResourceId:"provider-42",name:"新词媒体"}]));});
  await act(async () => {old.resolve(mediaList([{id:"old-uuid",externalResourceId:"old-provider",name:"过期媒体"}]));});
  expect(screen.queryByRole("option",{name:/过期媒体/})).toBeNull();
  fireEvent.click(screen.getByRole("option",{name:/新词媒体/}));
  const target = new URL(navigate.mock.calls[0]![0],"https://workspace.invalid");
  expect(target.pathname).toBe("/publishing/drafts/d1/media/third");
  expect(target.searchParams.get("batchQuery")).toBe("provider-42");
  expect(target.searchParams.get("matrixTask")).toBe("t1");
  expect(target.searchParams.get("mode")).toBe("multi");
  // A declined host guard does not run the callback that closes the panel.
  expect(input.getAttribute("aria-expanded")).toBe("true");
});

it("supports keyboard function navigation without fetching article lists", () => {
  const listMedia = vi.fn<PublisherGateway["listMedia"]>();
  const navigate = vi.fn();
  render(<PublishingTopbar path="/publishing" search="" gateway={gatewayFor(listMedia)} onNavigate={navigate}/>);
  fireEvent.keyDown(document,{key:"k",ctrlKey:true});
  const input = screen.getByRole("combobox");
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input,{key:"ArrowDown"});
  fireEvent.keyDown(input,{key:"Enter"});
  expect(navigate.mock.calls[0]?.[0]).toBe("/publishing");
  fireEvent.keyDown(input,{key:"Escape"});
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(listMedia).not.toHaveBeenCalled();
});

it("does not steal focus from an existing modal without Radix data-state", () => {
  render(<>
    <PublishingTopbar path="/publishing/articles/a1/edit" search="" gateway={null} onNavigate={vi.fn()}/>
    <section role="dialog" aria-modal="true" aria-label="稿件预览">
      <button type="button">关闭预览</button>
    </section>
  </>);
  const close = screen.getByRole("button",{name:"关闭预览"});
  close.focus();
  fireEvent.keyDown(close,{key:"k",ctrlKey:true});
  expect(document.activeElement).toBe(close);
  expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("false");
});
