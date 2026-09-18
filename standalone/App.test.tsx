// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
afterEach(() => {cleanup();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("keeps unsaved article edits when standalone navigation is cancelled", async () => {
  vi.stubGlobal("matchMedia", () => ({matches:false,addEventListener(){},removeEventListener(){}}));
  const confirm = vi.spyOn(window,"confirm").mockReturnValue(false);
  const {default:App} = await import("./App");
  const location = memoryLocation({path:"/publishing/articles/preview-article/edit",record:true});
  render(<Router hook={location.hook} searchHook={location.searchHook}><App preview/></Router>);
  const title = await screen.findByRole("textbox",{name:"稿件标题"});
  fireEvent.change(title,{target:{value:"尚未保存的投放标题"}});
  fireEvent.click(screen.getByRole("button",{name:"媒体库"}));
  expect(confirm).toHaveBeenCalledOnce();
  expect(location.history.at(-1)).toBe("/publishing/articles/preview-article/edit");
  expect((title as HTMLInputElement).value).toBe("尚未保存的投放标题");
});
