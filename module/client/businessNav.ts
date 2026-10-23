/**
 * 业务导航统一模型：左侧一级导航（发布工作台 / 稿件 / 媒体选择）与各自二级页面。
 * 供外壳 ModuleShell 的 navigationModules（一级）与 BusinessSubNav（二级）共用，
 * 所有路径必须是真实存在的业务路由。
 */
export type BusinessNavLeaf = {
  id: string;
  label: string;
  path: string;
};

export type BusinessNavModule = {
  /** id 同时决定共享侧栏图标（publishing→_SEND、content→PenLine、intent→Target）。 */
  id: "publishing" | "content" | "intent";
  label: string;
  views: BusinessNavLeaf[];
};

export const BUSINESS_NAV: BusinessNavModule[] = [
  {
    id: "publishing",
    label: "发布工作台",
    views: [{ id: "workbench", label: "发布工作台", path: "/publishing" }],
  },
  {
    id: "content",
    label: "稿件",
    views: [
      { id: "articles-manage", label: "管理稿件", path: "/publishing/articles" },
      // 编辑新稿是无需稿件上下文的真实编辑器入口；继续编辑既有稿件仍从管理稿件进入。
      { id: "article-edit", label: "编辑稿件", path: "/publishing/articles/new" },
      { id: "records", label: "发布记录", path: "/publishing/articles/records" },
    ],
  },
  {
    id: "intent",
    label: "媒体选择",
    views: [
      { id: "source-matrix", label: "信源矩阵", path: "/publishing/source-matrix" },
      { id: "third-media", label: "第三方媒体", path: "/publishing/media/third" },
    ],
  },
];

export const BUSINESS_NAV_LEAVES: BusinessNavLeaf[] =
  BUSINESS_NAV.flatMap(moduleItem => moduleItem.views);

export function businessLeafPath(id: string): string | undefined {
  return BUSINESS_NAV_LEAVES.find(leaf => leaf.id === id)?.path;
}

/** 由真实路由推导当前二级页面；刷新、前进、返回与深层链接均以路由为准。 */
export function activeBusinessLeaf(path: string): string {
  if (path.startsWith("/publishing/source-")) return "source-matrix";
  if (
    path.startsWith("/publishing/media") ||
    path.startsWith("/publishing/drafts/") ||
    path.startsWith("/publishing/review/")
  )
    return "third-media";
  if (path.startsWith("/publishing/articles/records")) return "records";
  if (
    path === "/publishing/articles/new" ||
    path.startsWith("/publishing/articles/new/") ||
    path.startsWith("/publishing/articles/edit") ||
    /^\/publishing\/articles\/[^/]+\/edit$/.test(path)
  )
    return "article-edit";
  if (path.startsWith("/publishing/articles")) return "articles-manage";
  if (
    path.startsWith("/publishing/records") ||
    path.startsWith("/publishing/record/") ||
    path.startsWith("/publishing/publications")
  )
    return "records";
  return "workbench";
}

export function businessModuleOf(leafId: string): BusinessNavModule {
  return (
    BUSINESS_NAV.find(moduleItem =>
      moduleItem.views.some(leaf => leaf.id === leafId),
    ) ?? BUSINESS_NAV[0]!
  );
}
