// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkflowQuestion } from "./Workflow";

afterEach(cleanup);
it("keeps Dashboard entry rows in the standalone publishing flow", () => {
  const select = vi.fn();
  const { container, getByRole } = render(<WorkflowQuestion variant="entry" module="publishing" question="发布入口" choices={[{ id: "draft", label: "导入稿件", description: "选择已有稿件" }]} onSelect={select} />);
  expect(container.querySelector(".operator-action-list")).not.toBeNull();
  expect(container.querySelector(".workflow-choices")).toBeNull();
  fireEvent.click(getByRole("button", { name: /导入稿件/ }));
  expect(select).toHaveBeenCalledWith("draft");
});
