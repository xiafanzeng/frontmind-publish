// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { configurePublishingHost, PublishExecution } from "./host";
import type { PublicationBatch } from "./types";
afterEach(() => {cleanup();configurePublishingHost({});});
it("uses the original execution display without treating an unknown submission as accepted", () => {
  const batch = {id:"batch",createdAt:"2026-09-10T01:00:00Z",status:"processing",items:[{id:"item",media:{name:"合成媒体"},status:"submission_unknown",updatedAt:"2026-09-10T01:00:04Z",resultMessage:"private raw provider error",submissionAttempts:[{id:"attempt",number:1,startedAt:"2026-09-10T01:00:02Z",result:"submission_unknown"}]}]} as unknown as PublicationBatch;
  const {container}=render(<PublishExecution batch={batch}/>);
  expect(container.querySelector('.business-execution-disclosure')).not.toBeNull();
  expect(screen.getByLabelText("执行过程")).toBeTruthy();
  expect(screen.getByText(/创建发布批次/)).toBeTruthy();
  expect(screen.getByText(/提交发布 · 合成媒体/)).toBeTruthy();
  expect(screen.getByText(/等待发布结果 · 合成媒体/)).toBeTruthy();
  expect(container.textContent).not.toContain("private raw provider error");
  expect(container.textContent).not.toContain("受理发布");
});
