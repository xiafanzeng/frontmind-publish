// @vitest-environment jsdom
import React, { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicationPreflight } from "../types";
import PublishingFrozenArticleDialog from "./PublishingFrozenArticleDialog";

const first: PublicationPreflight["article"] = {
  id: "article-a", title: "同名稿件", version: 2, versionId: "version-a-2", hash: "hash-a-2",
  wordCount: 4, imageCount: 1, bodyHtml: '<p>甲稿冻结内容</p><img src="https://example.test/frozen-a.png" alt="甲稿图片">',
  images: [{ id: "image-a", altText: "甲稿图片", previewUrl: "https://example.test/frozen-a.png" }],
};
const second: PublicationPreflight["article"] = {
  ...first, id: "article-b", version: 3, versionId: "version-b-3", hash: "hash-b-3",
  imageCount: 0, bodyHtml: "<p>乙稿冻结内容</p>", images: [],
};

function Harness() {
  const opener = useRef<HTMLButtonElement>(null);
  const [article, setArticle] = useState<PublicationPreflight["article"]>();
  return <>
    <button ref={opener} type="button" onClick={() => setArticle(first)}>查看稿 A</button>
    <PublishingFrozenArticleDialog article={article} trigger={article ? opener.current ?? undefined : undefined} onClose={() => setArticle(undefined)} />
  </>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("frozen article dialog", () => {
  it("only opens for a supplied frozen article and renders its actual title, version and HTML in the shared portal", async () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<PublishingFrozenArticleDialog onClose={onClose} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<PublishingFrozenArticleDialog article={first} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: "同名稿件" });
    expect(container.contains(dialog)).toBe(false);
    expect(within(dialog).getByRole("heading", { name: first.title })).toBeTruthy();
    expect(within(dialog).getByText("冻结版本 v2 · 只读 · 1 张图片")).toBeTruthy();
    expect(within(dialog).getByText("甲稿冻结内容")).toBeTruthy();
    expect(within(dialog).getByRole("img", { name: "甲稿图片" }).getAttribute("src")).toBe("https://example.test/frozen-a.png");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not retain the previous same-name article or its scroll surface when the current frozen identity changes", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<PublishingFrozenArticleDialog article={first} onClose={onClose} />);
    const oldSurface = await screen.findByRole("region", { name: "冻结正文内容" });
    oldSurface.scrollTop = 250;
    rerender(<PublishingFrozenArticleDialog article={second} onClose={onClose} />);
    expect(screen.queryByText("甲稿冻结内容")).toBeNull();
    expect(screen.getByText("乙稿冻结内容")).toBeTruthy();
    expect(screen.getByText("冻结版本 v3 · 只读 · 0 张图片")).toBeTruthy();
    const surface = screen.getByRole("region", { name: "冻结正文内容" });
    expect(surface).not.toBe(oldSurface);
    expect(surface.scrollTop).toBe(0);
    rerender(<PublishingFrozenArticleDialog onClose={onClose} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("乙稿冻结内容")).toBeNull();
  });

  it("restores the connected trigger without scrolling even after the parent clears its selected trigger", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "查看稿 A" });
    const focus = vi.spyOn(trigger, "focus");
    fireEvent.click(trigger);
    const close = await screen.findByRole("button", { name: "关闭冻结正文" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it("uses the shared dialog Escape dismissal and restores focus to the opener", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "查看稿 A" });
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("copies the resolved publishing theme into the portal and reports missing body content without a substitute", async () => {
    const trigger = document.createElement("button");
    trigger.style.setProperty("--publishing-purple", "#883366");
    trigger.style.fontFamily = '"Microsoft YaHei"';
    document.body.append(trigger);
    try {
      render(<PublishingFrozenArticleDialog article={{ ...first, bodyHtml: "" }} trigger={trigger} onClose={vi.fn()} />);
      const dialog = await screen.findByRole("dialog");
      expect(dialog.style.getPropertyValue("--publishing-purple")).toBe("#883366");
      expect(within(dialog).getByRole("status").textContent).toBe("该冻结版本未返回正文内容。");
      expect(screen.queryByText("甲稿冻结内容")).toBeNull();
    } finally {
      trigger.remove();
    }
  });
});
