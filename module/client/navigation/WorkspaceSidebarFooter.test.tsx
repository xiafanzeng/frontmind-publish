// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceSidebarFooter from "./WorkspaceSidebarFooter";

afterEach(cleanup);

function entry() { return screen.getByRole("button", { name: "FrontMind" }); }
function toggle() { return screen.getByRole("button", { name: "显示/隐藏侧边栏" }); }

it("keeps the project capsule chrome and replaces the collapse row with the sidebar toggle", () => {
  const onCollapse = vi.fn();
  render(<WorkspaceSidebarFooter collapsed={false} onCollapse={onCollapse}/>);
  expect(screen.getByRole("button", { name: "项目总览" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "新建企业项目" })).toHaveProperty("disabled", true);
  expect(entry()).toHaveProperty("disabled", false);
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  // 原“收起侧边栏”整行已删除。
  expect(screen.queryByText("收起侧边栏")).toBeNull();
});

it("the toggle only collapses the sidebar and never opens the account menu", () => {
  const onCollapse = vi.fn();
  render(<WorkspaceSidebarFooter collapsed={false} onCollapse={onCollapse}/>);
  fireEvent.click(toggle());
  expect(onCollapse).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("opens the account menu by keyboard and renders only backed entries", async () => {
  render(<WorkspaceSidebarFooter collapsed={false} onCollapse={vi.fn()} ownerUserId={42}/>);
  const account = entry();
  account.focus();
  // Radix 菜单触发器的键盘打开手势是方向键（Enter 不触发 pointerdown 语义）。
  fireEvent.keyDown(account, { key: "ArrowDown" });
  expect(await screen.findByRole("menu")).toBeTruthy();
  expect(screen.getByText("FrontMind 开发工作区 · 用户 42")).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "帮助" })).toBeTruthy();
  // 无真实数据来源的入口不渲染，也不出现假余额。
  for (const label of ["剩余金额", "邀请好友", "设置", "退出登录", "Jo Liu", "成员"]) {
    expect(screen.queryByText(label)).toBeNull();
  }
});

it("keeps the toggle operable in the collapsed rail", () => {
  const onCollapse = vi.fn();
  render(<WorkspaceSidebarFooter collapsed onCollapse={onCollapse}/>);
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle());
  expect(onCollapse).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "项目总览" })).toBeTruthy();
});
