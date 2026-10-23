// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PublishingNavigation from "./PublishingNavigation";

afterEach(cleanup);

it("opens children inline even when the parent targets the unchanged current route", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/articles" search="" collapsed={false} onNavigate={navigate}/>);
  fireEvent.click(screen.getByRole("button",{name:"收起稿件子菜单"}));
  expect(screen.queryByRole("link",{name:"管理稿件"})).toBeNull();
  fireEvent.click(screen.getByRole("link",{name:"稿件"}));
  expect(screen.getByRole("link",{name:"管理稿件"}).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button",{name:"收起稿件子菜单"}).getAttribute("aria-expanded")).toBe("true");
  expect(navigate).toHaveBeenCalledWith("/publishing/articles");
});

it("updates the open parent and active child after a deep route change", () => {
  const navigate = vi.fn();
  const view = render(<PublishingNavigation path="/publishing/articles" search="" collapsed={false} onNavigate={navigate}/>);
  view.rerender(<PublishingNavigation path="/publishing/drafts/d1/media/matrix" search="task=t1" collapsed={false} onNavigate={navigate}/>);
  expect(screen.getByRole("button",{name:"收起媒体选择子菜单"}).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("link",{name:"信源矩阵"}).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link",{name:"管理稿件"}).hasAttribute("aria-current")).toBe(false);
});
