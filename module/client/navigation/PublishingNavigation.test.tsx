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

it("opens the overview from the media parent while keeping exactly two distinct child links", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/media" search="articleVersion=v1&mode=multi&workbenchTask=f1&matrixTask=m1&enterpriseProjectId=p1" collapsed={false} onNavigate={navigate}/>);
  const parent = screen.getByRole("link", {name:"媒体选择"});
  expect(parent.getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", {name:"信源矩阵"}).hasAttribute("aria-current")).toBe(false);
  expect(screen.getByRole("link", {name:"第三方媒体"}).hasAttribute("aria-current")).toBe(false);
  expect(document.querySelectorAll("#publish-nav-intent .publish-nav-child")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", {name:"收起媒体选择子菜单"}));
  fireEvent.click(parent);
  const target = new URL(navigate.mock.calls[0]![0], "https://workspace.invalid");
  expect(target.pathname).toBe("/publishing/media");
  expect(target.searchParams.get("articleVersion")).toBe("v1");
  expect(target.searchParams.get("workbenchTask")).toBe("f1");
  expect(target.searchParams.get("matrixTask")).toBe("m1");
  expect(target.searchParams.get("enterpriseProjectId")).toBe("p1");
  expect(screen.getByRole("button", {name:"收起媒体选择子菜单"}).getAttribute("aria-expanded")).toBe("true");
});

it("keeps the collapsed media parent linked to the current draft overview", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/drafts/d1/media/third" search="articleVersion=v1&mode=multi" collapsed onNavigate={navigate}/>);
  fireEvent.click(screen.getByRole("link", {name:"媒体选择"}));
  expect(new URL(navigate.mock.calls[0]![0], "https://workspace.invalid").pathname).toBe("/publishing/drafts/d1/media");
  expect(screen.queryByRole("link", {name:"信源矩阵"})).toBeNull();
});
