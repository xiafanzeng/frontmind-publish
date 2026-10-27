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

it("opens the editor from the article parent and orders its independent child links", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/articles" search="" collapsed={false} onNavigate={navigate}/>);
  fireEvent.click(screen.getByRole("link",{name:"稿件"}));
  expect(navigate).toHaveBeenCalledWith("/publishing/articles/new");
  expect(screen.getByRole("link",{name:"管理稿件"})).toBeTruthy();
  expect(Array.from(document.querySelectorAll("#publish-nav-content .publish-nav-child")).map(link => link.textContent)).toEqual(["编辑稿件", "管理稿件", "发布记录"]);
});

it("keeps the existing editor route and its context on repeated parent clicks", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/articles/article-7/edit" search="mode=multi&draftId=d7&returnTo=%2Fpublishing%2Farticles&workbenchTask=t7" collapsed={false} onNavigate={navigate}/>);
  expect(screen.getByRole("link", {name:"编辑稿件"}).getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("link", {name:"稿件"}));
  const target = new URL(navigate.mock.calls[0]![0], "https://workspace.invalid");
  expect(target.pathname).toBe("/publishing/articles/article-7/edit");
  expect(target.searchParams.get("draftId")).toBe("d7");
  expect(target.searchParams.get("workbenchTask")).toBe("t7");
  expect(target.searchParams.get("mode")).toBe("multi");
  expect(target.searchParams.get("returnTo")).toBe("/publishing/articles");
  expect(navigate).toHaveBeenCalledTimes(1);
});

it("derives article highlighting when moving between new, existing, list and records routes", () => {
  const navigate = vi.fn();
  const view = render(<PublishingNavigation path="/publishing/articles/new" search="" collapsed={false} onNavigate={navigate}/>);
  for (const [path, active] of [
    ["/publishing/articles/new", "编辑稿件"],
    ["/publishing/articles/article-7/edit", "编辑稿件"],
    ["/publishing/articles", "管理稿件"],
    ["/publishing/articles/records", "发布记录"],
    ["/publishing/articles/article-7/edit", "编辑稿件"],
  ]) {
    view.rerender(<PublishingNavigation path={path!} search="" collapsed={false} onNavigate={navigate}/>);
    expect(screen.getByRole("link", {name: active!}).getAttribute("aria-current")).toBe("page");
  }
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
