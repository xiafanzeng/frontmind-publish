// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PublishingNavigation from "./PublishingNavigation";

afterEach(cleanup);

it("expands the selected section from the route without any disclosure buttons", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/articles" search="" collapsed={false} onNavigate={navigate}/>);
  expect(screen.getByRole("link",{name:"管理稿件"}).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link",{name:"编辑稿件"})).toBeTruthy();
  expect(screen.getByRole("link",{name:"发布记录"})).toBeTruthy();
  // 媒体选择子菜单收起：隐藏子链接不出现在可访问树。
  expect(screen.queryByRole("link",{name:"信源矩阵"})).toBeNull();
  expect(screen.queryByRole("link",{name:"媒体库"})).toBeNull();
  // 本轮已移除独立的展开/收起箭头按钮。
  expect(screen.queryByRole("button",{name:/子菜单/})).toBeNull();
});

it("switches the expanded group after a deep route change and restores highlight by route", () => {
  const navigate = vi.fn();
  const view = render(<PublishingNavigation path="/publishing/articles" search="" collapsed={false} onNavigate={navigate}/>);
  view.rerender(<PublishingNavigation path="/publishing/drafts/d1/media/matrix" search="task=t1" collapsed={false} onNavigate={navigate}/>);
  expect(screen.getByRole("link",{name:"信源矩阵"}).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByRole("link",{name:"管理稿件"})).toBeNull();
  expect(screen.queryByRole("link",{name:"媒体库"})).toBeTruthy();
});

it("keeps the current section expanded when its parent link is clicked again", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/articles" search="" collapsed={false} onNavigate={navigate}/>);
  fireEvent.click(screen.getByRole("link",{name:"稿件"}));
  expect(navigate).toHaveBeenCalledWith("/publishing/articles");
  expect(screen.getByRole("link",{name:"管理稿件"})).toBeTruthy();
});

it("collapses both sections on a section without child destinations", () => {
  render(<PublishingNavigation path="/publishing" search="" collapsed={false} onNavigate={vi.fn()}/>);
  expect(screen.getByRole("link",{name:"发布工作台"}).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByRole("link",{name:"管理稿件"})).toBeNull();
  expect(screen.queryByRole("link",{name:"信源矩阵"})).toBeNull();
  expect(screen.queryByRole("link",{name:"媒体库"})).toBeNull();
});

it("targets the media overview from the media parent while carrying task context", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/media" search="articleVersion=v1&mode=multi&workbenchTask=f1&matrixTask=m1&enterpriseProjectId=p1" collapsed={false} onNavigate={navigate}/>);
  const parent = screen.getByRole("link", {name:"媒体选择"});
  expect(parent.getAttribute("aria-current")).toBe("page");
  expect(document.querySelectorAll("#publish-nav-intent .publish-nav-child")).toHaveLength(2);
  fireEvent.click(parent);
  const target = new URL(navigate.mock.calls[0]![0], "https://workspace.invalid");
  expect(target.pathname).toBe("/publishing/media");
  expect(target.searchParams.get("articleVersion")).toBe("v1");
  expect(target.searchParams.get("workbenchTask")).toBe("f1");
  expect(target.searchParams.get("matrixTask")).toBe("m1");
  expect(target.searchParams.get("enterpriseProjectId")).toBe("p1");
});

it("keeps the collapsed media parent linked to the current draft overview without children", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/drafts/d1/media/third" search="articleVersion=v1&mode=multi" collapsed onNavigate={navigate}/>);
  fireEvent.click(screen.getByRole("link",{name:"媒体选择"}));
  expect(new URL(navigate.mock.calls[0]![0], "https://workspace.invalid").pathname).toBe("/publishing/drafts/d1/media");
  expect(screen.queryByRole("link",{name:"信源矩阵"})).toBeNull();
  expect(screen.queryByRole("link",{name:"管理稿件"})).toBeNull();
});
