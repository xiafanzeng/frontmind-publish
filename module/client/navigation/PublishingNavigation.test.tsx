// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PublishingNavigation from "./PublishingNavigation";

afterEach(cleanup);

// V5：稿件与媒体选择不再是独立导航，左侧业务导航只保留发布工作台；
// 页面本身仍存在，经工作台列表与流程入口进入（businessNav 模型保留用于面包屑/搜索）。

it("renders only the workbench entry", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing" search="" collapsed={false} onNavigate={navigate}/>);
  expect(screen.getByRole("link", {name: "发布工作台"}).getAttribute("aria-current")).toBe("page");
  // 稿件 / 媒体选择及其二级导航不再出现。
  expect(screen.queryByRole("link", {name: "稿件"})).toBeNull();
  expect(screen.queryByRole("link", {name: "媒体选择"})).toBeNull();
  expect(screen.queryByRole("link", {name: "管理稿件"})).toBeNull();
  expect(screen.queryByRole("link", {name: "编辑稿件"})).toBeNull();
  expect(screen.queryByRole("link", {name: "发布记录"})).toBeNull();
  expect(screen.queryByRole("link", {name: "信源矩阵"})).toBeNull();
  expect(screen.queryByRole("link", {name: "媒体库"})).toBeNull();
});

it("keeps the single workbench link on deep routes without exposing hidden groups", () => {
  const navigate = vi.fn();
  const view = render(<PublishingNavigation path="/publishing/articles" search="" collapsed={false} onNavigate={navigate}/>);
  expect(screen.getByRole("link", {name: "发布工作台"})).toBeTruthy();
  expect(screen.queryByRole("link", {name: "管理稿件"})).toBeNull();
  view.rerender(<PublishingNavigation path="/publishing/drafts/d1/media/matrix" search="task=t1" collapsed={false} onNavigate={navigate}/>);
  expect(screen.getByRole("link", {name: "发布工作台"})).toBeTruthy();
  expect(screen.queryByRole("link", {name: "信源矩阵"})).toBeNull();
});

it("navigates to the workbench landing from the remaining entry", () => {
  const navigate = vi.fn();
  render(<PublishingNavigation path="/publishing/articles" search="" collapsed={false} onNavigate={navigate}/>);
  fireEvent.click(screen.getByRole("link", {name: "发布工作台"}));
  expect(navigate).toHaveBeenCalledWith("/publishing");
  expect(navigate).toHaveBeenCalledTimes(1);
});
