import { describe, expect, it } from "vitest";
import { activeBusinessLeaf, businessLeafHref, publishingBreadcrumbs } from "./businessNav";

const url = (href: string | undefined) => new URL(href!, "https://workspace.invalid");

describe("publishing navigation context", () => {
  it("keeps a matrix draft and converts its task for the media catalogue", () => {
    const target = url(businessLeafHref("third-media", "/publishing/source-matrix",
      "draftId=draft%2Fone&task=matrix-1&workbenchTask=flow-1&articleVersion=v1&mode=multi&query=old"));
    expect(target.pathname).toBe("/publishing/drafts/draft%2Fone/media/third");
    expect(Object.fromEntries(target.searchParams)).toEqual({
      workbenchTask:"flow-1", mode:"multi", articleVersion:"v1", matrixTask:"matrix-1",
    });
  });

  it("converts the catalogue task back to the matrix task without losing the draft", () => {
    const target = url(businessLeafHref("source-matrix", "/publishing/drafts/d1/media/cart",
      "matrixTask=matrix-1&articleVersion=v1&mode=batch&workbenchTask=flow-1"));
    expect(target.pathname).toBe("/publishing/drafts/d1/media/matrix");
    expect(Object.fromEntries(target.searchParams)).toEqual({
      workbenchTask:"flow-1", mode:"batch", articleVersion:"v1", task:"matrix-1",
    });
  });

  it("retains the current editor and its return destination", () => {
    const target = url(businessLeafHref("article-edit", "/publishing/articles/a1/edit",
      "mode=multi&returnTo=%2Fpublishing%2Farticles&draftId=d1&workbenchTask=f1"));
    expect(target.pathname).toBe("/publishing/articles/a1/edit");
    expect(target.searchParams.get("returnTo")).toBe("/publishing/articles");
    expect(target.searchParams.get("draftId")).toBe("d1");
    expect(target.searchParams.get("mode")).toBe("multi");
    expect(url(businessLeafHref("article-edit", "/publishing/articles/new", "mode=batch")).searchParams.get("mode")).toBe("batch");
  });

  it.each([
    ["/publishing/articles?mode=edit", "article-edit"],
    ["/publishing/articles/records/", "records"],
    ["/publishing/articles/a1/edit", "article-edit"],
    ["/publishing/drafts/d1/media/matrix", "source-matrix"],
    ["/publishing/source-analysis", "source-matrix"],
    ["/publishing/drafts/d1/titles", "third-media"],
    ["/publishing/review/d1", "third-media"],
  ])("derives selection from the deep link %s", (path, leaf) => {
    expect(activeBusinessLeaf(path)).toBe(leaf);
  });

  it("uses Chinese breadcrumbs and a non-linked current page", () => {
    const crumbs = publishingBreadcrumbs("/publishing/drafts/d1/titles", "matrixTask=t1&mode=multi");
    expect(crumbs.map(item => item.label)).toEqual(["媒体发布", "媒体选择", "第三方媒体", "配置发布标题"]);
    expect(crumbs.at(-1)?.href).toBeUndefined();
    const parent = url(crumbs[2]?.href);
    expect(parent.pathname).toBe("/publishing/drafts/d1/media/third");
    expect(parent.searchParams.get("matrixTask")).toBe("t1");
    expect(parent.searchParams.get("mode")).toBe("multi");
  });
});
