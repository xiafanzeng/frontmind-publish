/**
 * 业务导航统一模型：左侧一级导航（发布工作台 / 稿件 / 媒体选择）与各自二级页面。
 * 供宿主组合的单侧栏、面包屑与搜索共用；不在业务正文内创建外壳。
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
  /** A parent overview is separate from its child menu destinations. */
  home?: BusinessNavLeaf;
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
    home: { id: "media-home", label: "媒体库", path: "/publishing/media" },
    views: [
      { id: "source-matrix", label: "信源矩阵", path: "/publishing/source-matrix" },
      { id: "third-media", label: "第三方媒体", path: "/publishing/media/third" },
    ],
  },
];

export const BUSINESS_NAV_LEAVES: BusinessNavLeaf[] =
  BUSINESS_NAV.flatMap(moduleItem => moduleItem.home ? [moduleItem.home, ...moduleItem.views] : moduleItem.views);

export function businessLeafPath(id: string): string | undefined {
  return BUSINESS_NAV_LEAVES.find(leaf => leaf.id === id)?.path;
}

/** 由真实路由推导当前二级页面；刷新、前进、返回与深层链接均以路由为准。 */
export function activeBusinessLeaf(path: string, search = ""): string {
  const cleanPath = path.split("?")[0]!.replace(/\/$/, "") || "/";
  const params = new URLSearchParams(search || path.split("?")[1] || "");
  path = cleanPath;
  if (/^\/publishing\/(?:drafts\/[^/]+\/)?media(?:\/home)?$/.test(path)) return "media-home";
  if (/\/media\/(matrix|sources|industry|report)$/.test(path)) return "source-matrix";
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
  if (path === "/publishing/articles" && params.get("mode") === "edit") return "article-edit";
  if (path.startsWith("/publishing/articles")) return "articles-manage";
  if (
    path.startsWith("/publishing/records") ||
    path.startsWith("/publishing/record/") ||
    path.startsWith("/publishing/publications")
  )
    return "records";
  return "workbench";
}

/** Build only known destinations, carrying task/version context without copying list filters. */
export function businessLeafHref(id: string, path: string, search = ""): string | undefined {
  const base = businessLeafPath(id);
  if (!base) return undefined;
  const current = new URLSearchParams(search || path.split("?")[1] || "");
  path = path.split("?")[0]!.replace(/\/$/, "");
  const params = new URLSearchParams();
  for (const key of ["workbenchTask", "task", "matrixTask", "operatorOwnerId", "enterpriseProjectId"]) {
    const value = current.get(key);
    if (value) params.set(key, value);
  }
  const draft = /^\/publishing\/drafts\/([^/]+)/.exec(path)?.[1]
    ?? /^\/publishing\/review\/([^/]+)/.exec(path)?.[1]
    ?? (current.get("draftId") ? encodeURIComponent(current.get("draftId")!) : undefined);
  let destination = base;
  if (["article-edit", "media-home", "third-media", "source-matrix"].includes(id)) {
    const mode = current.get("mode");
    if (mode && ["single", "multi", "batch", "per_media"].includes(mode)) params.set("mode", mode);
  }
  if (id === "article-edit" && /^\/publishing\/articles\/[^/]+\/edit$/.test(path)) {
    destination = path;
    for (const key of ["returnTo", "draftId"]) {
      const value = current.get(key);
      if (value) params.set(key, value);
    }
  }
  if (id === "media-home" || id === "third-media" || id === "source-matrix") {
    const version = current.get("articleVersion");
    if (version) params.set("articleVersion", version);
    // Resolve an alias using the source page's own parameter first. A legacy
    // alias may remain in copied URLs and must not replace the displayed task.
    const fromMatrix = path.startsWith("/publishing/source-") || /\/media\/(matrix|sources|industry|report)$/.test(path);
    const matrixTask = fromMatrix
      ? current.get("task") || current.get("matrixTask")
      : current.get("matrixTask") || current.get("task");
    params.delete("task");
    params.delete("matrixTask");
    if (matrixTask) params.set(id === "source-matrix" ? "task" : "matrixTask", matrixTask);
    // A fresh sidebar entry opens distribution. Within this module retain the current tab.
    if (id === "source-matrix") params.set("tab", fromMatrix && (current.get("tab")==="matrix" || (current.get("tab")!=='analysis'&&/\/media\/(matrix|report)$|\/source-report$/.test(path))) ? "matrix" : "analysis");
    if (draft) destination = `/publishing/drafts/${draft}/media${id === "media-home" ? "" : id === "third-media" ? "/third" : "/matrix"}`;
  }
  return destination + (params.size ? `?${params}` : "");
}

export type PublishingCrumb = { label: string; href?: string };
export function publishingBreadcrumbs(path: string, search = ""): PublishingCrumb[] {
  search = search || path.split("?")[1] || "";
  path = path.split("?")[0]!.replace(/\/$/, "");
  const leaf = activeBusinessLeaf(path, search);
  const tab=new URLSearchParams(search).get('tab');
  const matrixDetail=leaf==='source-matrix'
    ? (tab==='matrix'||(tab!=='analysis'&&/\/media\/(matrix|report)$|\/source-report$/.test(path))?'信源矩阵推荐':'行业信源分布')
    : undefined;
  const items: PublishingCrumb[] = [
    { label: "媒体发布", href: businessLeafHref("workbench", path, search) },
  ];
  const detail = /\/titles$/.test(path) ? "配置发布标题"
    : /\/review(?:\/[^/]+)?$/.test(path) ? "预检与发布"
    : /\/media\/cart$/.test(path) ? "购物车"
    : matrixDetail ? matrixDetail
    : /\/articles\/new\/import$/.test(path) ? "导入稿件"
    : /\/record\/[^/]+$|\/publications\/[^/]+$/.test(path) ? "发布详情"
    : undefined;
  const label = BUSINESS_NAV_LEAVES.find(item => item.id === leaf)?.label ?? "发布工作台";
  if (leaf === "source-matrix" || leaf === "third-media") {
    items.push({ label: "媒体选择", href: businessLeafHref("media-home", path, search) });
  }
  items.push({ label, ...(detail ? { href: businessLeafHref(leaf, path, search) } : {}) });
  if (detail) items.push({ label: detail });
  return items;
}

export function businessModuleOf(leafId: string): BusinessNavModule {
  return (
    BUSINESS_NAV.find(moduleItem =>
      moduleItem.home?.id === leafId || moduleItem.views.some(leaf => leaf.id === leafId),
    ) ?? BUSINESS_NAV[0]!
  );
}
