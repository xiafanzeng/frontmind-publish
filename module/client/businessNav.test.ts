import { describe, expect, it } from "vitest";
import { BUSINESS_NAV, activeBusinessLeaf, businessLeafHref, businessModuleOf, publishingBreadcrumbs } from "./businessNav";

const url = (href: string | undefined) => new URL(href!, "https://workspace.invalid");

describe("publishing navigation context", () => {
  it("keeps the overview separate from the two media child destinations", () => {
    const media = BUSINESS_NAV.find(item => item.id === "intent")!;
    expect(media.home?.id).toBe("media-home");
    expect(media.views.map(item => item.id)).toEqual(["source-matrix", "third-media"]);
    expect(businessModuleOf("media-home").id).toBe("intent");
    expect(businessLeafHref("articles-manage", "/publishing/media")).toBe("/publishing/articles");
  });

  it("returns from a matrix to the bound overview without losing identifiers or workspace", () => {
    const target = url(businessLeafHref("media-home", "/publishing/source-matrix",
      "draftId=draft%2Fone&task=matrix-1&workbenchTask=flow-1&articleVersion=v1&mode=multi&enterpriseProjectId=project-1&operatorOwnerId=9&query=old"));
    expect(target.pathname).toBe("/publishing/drafts/draft%2Fone/media");
    expect(Object.fromEntries(target.searchParams)).toEqual({
      workbenchTask:"flow-1", enterpriseProjectId:"project-1", operatorOwnerId:"9",
      mode:"multi", articleVersion:"v1", matrixTask:"matrix-1",
    });
    const matrix = url(businessLeafHref("source-matrix", target.pathname, target.search));
    expect(matrix.pathname).toBe("/publishing/drafts/draft%2Fone/media/matrix");
    expect(matrix.searchParams.get("task")).toBe("matrix-1");
    expect(matrix.searchParams.has("matrixTask")).toBe(false);
    expect(matrix.searchParams.get("articleVersion")).toBe("v1");
    expect(matrix.searchParams.get("enterpriseProjectId")).toBe("project-1");
  });

  it.each([
    ["/publishing/source-matrix", "task=current-matrix&matrixTask=old-alias", "current-matrix"],
    ["/publishing/drafts/d1/media/matrix", "task=current-matrix&matrixTask=old-alias", "current-matrix"],
    ["/publishing/media/third", "task=old-alias&matrixTask=current-matrix", "current-matrix"],
  ])("uses the source page's active task when aliases conflict on %s", (path, search, expected) => {
    const home = url(businessLeafHref("media-home", path, search + "&workbenchTask=flow-1"));
    expect(home.searchParams.get("matrixTask")).toBe(expected);
    expect(home.searchParams.has("task")).toBe(false);
    expect(home.searchParams.get("workbenchTask")).toBe("flow-1");
    const matrix = url(businessLeafHref("source-matrix", path, search + "&workbenchTask=flow-1"));
    expect(matrix.searchParams.get("task")).toBe(expected);
    expect(matrix.searchParams.has("matrixTask")).toBe(false);
    expect(matrix.searchParams.get("workbenchTask")).toBe("flow-1");
  });

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
      workbenchTask:"flow-1", mode:"batch", articleVersion:"v1", task:"matrix-1", tab:"analysis",
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
    ["/publishing/media", "media-home"],
    ["/publishing/media/home/", "media-home"],
    ["/publishing/drafts/d1/media", "media-home"],
    ["/publishing/drafts/d1/media/home", "media-home"],
    ["/publishing/media/third", "third-media"],
    ["/publishing/drafts/d1/media/cart", "third-media"],
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
    expect(crumbs.map(item => item.label)).toEqual(["媒体发布", "媒体选择", "媒体库", "配置标题"]);
    expect(crumbs.at(-1)?.href).toBeUndefined();
    expect(url(crumbs[1]?.href).pathname).toBe("/publishing/drafts/d1/media");
    const parent = url(crumbs[2]?.href);
    expect(parent.pathname).toBe("/publishing/drafts/d1/media/third");
    expect(parent.searchParams.get("matrixTask")).toBe("t1");
    expect(parent.searchParams.get("mode")).toBe("multi");
  });

  it("shows a non-duplicated overview breadcrumb", () => {
    const crumbs = publishingBreadcrumbs("/publishing/media", "articleVersion=v1&mode=multi");
    expect(crumbs.map(item => item.label)).toEqual(["媒体发布", "媒体选择"]);
    expect(crumbs.at(-1)?.href).toBeUndefined();
  });

  it.each([
    ['/publishing/source-matrix', '', '行业信源分布'],
    ['/publishing/source-matrix', 'tab=matrix', '信源矩阵推荐'],
    ['/publishing/source-analysis', '', '行业信源分布'],
    ['/publishing/source-industry', '', '行业信源分布'],
    ['/publishing/source-report', '', '信源矩阵推荐'],
    ['/publishing/media/matrix', '', '信源矩阵推荐'],
    ['/publishing/drafts/d1/media/industry', '', '行业信源分布'],
    ['/publishing/source-report', 'tab=analysis', '行业信源分布'],
  ])('names the two current tabs for %s %s', (path, search, label) => {
    expect(publishingBreadcrumbs(path,search).at(-1)).toEqual({label});
  });
});
