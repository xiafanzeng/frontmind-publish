import {
  Check,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Eye,
  Image as ImageIcon,
  X,
  LoaderCircle,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  usePublishingFlow,
  usePublishingSummary,
  usePublishingOperationScope,
  publishingTaskUrl,
} from "../PublishingFlowContext";
import {
  performApprovedWorkspaceNavigation,
  useWorkspaceDraftGuard,
} from "../host";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import {
  PublishingBreadcrumbs,
  PublishingError,
  PublishingLoading,
  PublishingPage,
} from "../components/PublishingUi";
import {
  publisherHtmlToPlainText,
  publisherPlainTextToHtml,
  sanitizePublisherEditorHtml,
} from "../editorContent";
import { buildHandwrittenDocxFile } from "../handwrittenArticle";
import type {
  ArticleDetail,
  ArticleImage,
  PublisherEditorContent,
} from "../types";
import { publishingDateTime } from "../types";

const TipTapArticleEditor = lazy(
  () => import("../components/TipTapArticleEditor"),
);

export type ArticleEditorSurfaceProps = {
  value: PublisherEditorContent;
  images: readonly ArticleImage[];
  onChange: (value: PublisherEditorContent) => void;
  onUploadImage: (file: File) => Promise<ArticleImage>;
};

/** A second lazy boundary keeps TipTap out of every non-editor publishing page. */
export function ArticleEditorSurface({
  value,
  images,
  onChange,
  onUploadImage,
}: ArticleEditorSurfaceProps) {
  return (
    <Suspense
      fallback={
        <div className="publishing-editor-loading" role="status">
          正在加载富文本编辑器…
        </div>
      }
    >
      <TipTapArticleEditor
        value={value}
        images={images}
        onChange={onChange}
        onUploadImage={onUploadImage}
      />
    </Suspense>
  );
}

export type EditorMode = "single" | "multi" | "batch";

const EDITOR_MODES: [EditorMode, string, string][] = [
  ["single", "单标题", "一篇文章，一个正式标题"],
  ["multi", "多标题", "同一正文，按所选媒体分别配标题"],
  ["batch", "批量投放", "逐篇准备多份稿件"],
];

const PUBLISH_STEPS = [
  "1. 编辑稿件",
  "2. 选择媒体",
  "3. 配置标题",
  "4. 预检与发布",
];

const EMPTY_CONTENT: PublisherEditorContent = {
  html: "",
  text: "",
  json: { type: "doc", content: [] },
};

const rejectImageBeforeSave = async (): Promise<ArticleImage> => {
  throw new Error("稿件首次保存后即可上传图片");
};

function fallbackTitle(content: PublisherEditorContent): string {
  const head = content.text.replace(/\s/g, "").slice(0, 16);
  return head || "未命名稿件";
}

export default function PublishingArticleEditorPage({
  articleId,
  embedded = false,
}: {
  articleId: string;
  embedded?: boolean;
}) {
  const isNew = articleId === "new";
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const [, navigate] = useLocation();
  const search = useSearch();
  const modeParam = new URLSearchParams(search.replace(/^\?/u, "")).get("mode");
  const operationScope = usePublishingOperationScope(articleId);
  const load = useCallback(
    (signal: AbortSignal) =>
      isNew
        ? // 新稿状态不请求详情；直接撰写经桥接落库，或经 DOCX 导入创建。
          new Promise<ArticleDetail>(() => {})
        : gateway.getArticle(articleId, signal),
    [articleId, gateway, isNew],
  );
  const query = usePublisherQuery(load);
  const [article, setArticle] = useState<ArticleDetail>();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<PublisherEditorContent>(EMPTY_CONTENT);
  const [images, setImages] = useState<ArticleImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedSignature, setSavedSignature] = useState("");
  const saveRequest = useRef(0);
  const freezeLock = useRef(false);
  const [freezing, setFreezing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  // 组织模式仅用于本页交互组织，不新增网关字段。
  const [editorMode, setEditorMode] = useState<EditorMode>(
    modeParam === "multi" || modeParam === "batch" ? modeParam : "single",
  );
  const [frozenResult, setFrozenResult] = useState<ArticleDetail>();
  const previewObjectUrls = useRef(new Set<string>());
  const newFileInput = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (typeof URL.revokeObjectURL === "function") {
        previewObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      }
      previewObjectUrls.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!query.data) return;
    const html = sanitizePublisherEditorHtml(
      query.data.bodyHtml ?? publisherPlainTextToHtml(query.data.bodyText),
      query.data.images,
    );
    setArticle(query.data);
    setTitle(query.data.title);
    setContent({
      html,
      text: query.data.bodyText || publisherHtmlToPlainText(html),
      json: query.data.editorJson ?? { type: "doc", content: [] },
    });
    setImages(query.data.images);
    query.data.images.forEach((image) => {
      if (image.previewUrlIsObject && image.previewUrl) {
        previewObjectUrls.current.add(image.previewUrl);
      }
    });
    setSavedSignature(
      JSON.stringify([query.data.title, html, query.data.images]),
    );
  }, [query.data]);

  const signature = JSON.stringify([title, content.html, images]);
  const dirty = Boolean(article) && signature !== savedSignature;
  usePublishingSummary({
    title: "当前稿件",
    items: [
      { label: "稿件", value: article?.title || (isNew ? "新稿件（未保存）" : "正在读取") },
      {
        label: "保存状态",
        value:
          saveError || (saving ? "保存中" : dirty ? "有未保存修改" : "已保存"),
      },
      {
        label: "版本",
        value: article?.currentVersion
          ? `v${article.currentVersion}`
          : "尚未冻结",
      },
      { label: "图片", value: `${article?.images.length ?? 0} 张` },
    ],
    note: frozenResult ? "版本已冻结，可交给媒体助手选择投放资源。" : undefined,
    outputs: article?.currentVersionId
      ? [
          {
            id: `article-version:${article.currentVersionId}`,
            title: `稿件冻结版本 v${article.currentVersion}`,
            description: `关联稿件：${article.title}`,
            type: "冻结稿件",
            version: article.currentVersion,
            status:
              dirty || article.status !== "frozen"
                ? "新修改保存在当前草稿，已冻结版本继续保留"
                : "已冻结",
            pendingChanges: dirty || article.status !== "frozen",
            onOpen: () =>
              document
                .getElementById("publishing-current-article")
                ?.scrollIntoView({ block: "start", behavior: "smooth" }),
            onRevise: () =>
              document
                .querySelector<HTMLInputElement>('[aria-label="稿件标题"]')
                ?.focus(),
          },
        ]
      : [],
  });

  /** 方案 A 桥接：手写内容 → 浏览器生成最小 DOCX → 现有导入接口创建 → saveArticle 覆写。 */
  const persistHandwritten = useCallback(
    async (draftTitle: string, draftContent: PublisherEditorContent) => {
      const file = buildHandwrittenDocxFile(draftTitle, draftContent.text);
      const imported = await gateway.importDocx(file);
      const created = await gateway.getArticle(imported.articleId);
      return gateway.saveArticle({
        articleId: imported.articleId,
        expectedRevision: created.revision,
        title: draftTitle.trim() || fallbackTitle(draftContent),
        bodyText: draftContent.text,
        bodyHtml: sanitizePublisherEditorHtml(draftContent.html, []),
        editorJson: draftContent.json,
        images: [],
      });
    },
    [gateway],
  );

  const saveNow = useCallback(async () => {
    if (!article || !dirty) return article;
    const request = ++saveRequest.current;
    const submittedSignature = signature;
    setSaving(true);
    setSaveError("");
    try {
      const bodyHtml = sanitizePublisherEditorHtml(content.html, images);
      const bodyText = publisherHtmlToPlainText(bodyHtml);
      const saved = await gateway.saveArticle({
        articleId: article.id,
        expectedRevision: article.revision,
        title,
        bodyText,
        bodyHtml,
        editorJson: content.json,
        images,
      });
      if (request === saveRequest.current) {
        setArticle(saved);
        setSavedSignature(submittedSignature);
      }
      return saved;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "保存失败";
      if (request === saveRequest.current) setSaveError(message);
      throw reason;
    } finally {
      if (request === saveRequest.current) setSaving(false);
    }
  }, [article, content, dirty, gateway, images, signature, title]);
  useWorkspaceDraftGuard({
    dirty,
    label: "稿件正文与图片",
    save: async () => {
      try {
        await saveNow();
        return true;
      } catch {
        return false;
      }
    },
  });

  useEffect(() => {
    if (!dirty || saving) return;
    const timer = window.setTimeout(
      () => void saveNow().catch(() => undefined),
      800,
    );
    return () => window.clearTimeout(timer);
  }, [dirty, saveNow, saving, signature]);

  const freezeAndContinue = async () => {
    if (!article || saving || freezeLock.current || flow?.outcomePending)
      return;
    const isCurrent = operationScope();
    freezeLock.current = true;
    setFreezing(true);
    setSaveError("");
    try {
      const saved = (await saveNow()) ?? article;
      if (!isCurrent()) return;
      const frozen = await gateway.freezeArticle(saved.id, saved.revision);
      if (!isCurrent()) return;
      setArticle(frozen);
      setSavedSignature(
        JSON.stringify([
          frozen.title,
          sanitizePublisherEditorHtml(
            frozen.bodyHtml ?? publisherPlainTextToHtml(frozen.bodyText),
            frozen.images,
          ),
          frozen.images,
        ]),
      );
      if (flow) {
        setFrozenResult(frozen);
        await flow
          .record({
            id: `article-frozen:${frozen.currentVersionId}`,
            label: "稿件版本已冻结",
            detail: `${frozen.title} · v${frozen.currentVersion}`,
            resources: [
              { kind: "article", id: frozen.id },
              { kind: "article_version", id: frozen.currentVersionId! },
            ],
            outputRefs: [
              {
                resource: {
                  kind: "article_version",
                  id: frozen.currentVersionId!,
                  label: frozen.title,
                },
                version: String(frozen.currentVersion),
                sourceStepId: `article-frozen:${frozen.currentVersionId}`,
              },
            ],
          })
          .catch(() => undefined);
      } else
        performApprovedWorkspaceNavigation(() =>
          navigate(
            publishingTaskUrl(
              `/publishing/media?articleVersion=${encodeURIComponent(frozen.currentVersionId!)}&mode=${editorMode}`,
            ),
          ),
        );
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "无法冻结版本");
    } finally {
      freezeLock.current = false;
      setFreezing(false);
    }
  };
  const handoffToMedia = async () => {
    if (!flow || !frozenResult?.currentVersionId || dirty || freezeLock.current)
      return;
    freezeLock.current = true;
    setFreezing(true);
    try {
      await flow.handoff({
        targetAgentId: "media",
        title: `媒体选择 · ${frozenResult.title}`,
        resources: [
          { kind: "article", id: frozenResult.id },
          { kind: "article_version", id: frozenResult.currentVersionId },
        ],
        idempotencyKey: `article-media-${frozenResult.currentVersionId}`,
        route: `/publishing/media?articleVersion=${encodeURIComponent(frozenResult.currentVersionId)}&mode=${editorMode}`,
      });
    } catch (reason) {
      setSaveError(
        reason instanceof Error ? reason.message : "交接未完成，请重试",
      );
    } finally {
      freezeLock.current = false;
      setFreezing(false);
    }
  };

  const updateAlt = (id: string, altText: string) => {
    setImages((current) =>
      current.map((image) => (image.id === id ? { ...image, altText } : image)),
    );
  };

  const uploadImage = useCallback(
    async (file: File) => {
      if (!article) throw new Error("稿件尚未就绪");
      const isCurrent = operationScope();
      const defaultAlt = file.name.replace(/\.[^.]+$/u, "").trim();
      const uploaded = await gateway.uploadArticleImage(
        article.id,
        file,
        defaultAlt,
      );
      if (!isCurrent()) {
        if (uploaded.previewUrlIsObject && uploaded.previewUrl)
          URL.revokeObjectURL(uploaded.previewUrl);
        throw new Error("任务已切换，请在原稿件任务查看上传结果。");
      }
      if (uploaded.previewUrlIsObject && uploaded.previewUrl) {
        previewObjectUrls.current.add(uploaded.previewUrl);
      }
      setImages((current) => [
        ...current.filter((image) => image.id !== uploaded.id),
        uploaded,
      ]);
      return uploaded;
    },
    [article, gateway, operationScope],
  );

  const goToMediaSelection = () => {
    if (isNew || embedded) return;
    if (article?.currentVersionId) {
      performApprovedWorkspaceNavigation(() =>
        navigate(
          publishingTaskUrl(`/publishing/media?articleVersion=${encodeURIComponent(article.currentVersionId!)}&mode=${editorMode}`),
        ),
      );
      return;
    }
    void freezeAndContinue();
  };

  const enterCreatedArticle = (createdId: string) => {
    performApprovedWorkspaceNavigation(() =>
      navigate(
        `/publishing/articles/${encodeURIComponent(createdId)}/edit${
          editorMode === "single" ? "" : `?mode=${editorMode}`
        }`,
      ),
    );
  };

  /** 编辑页统一结构：步骤提示 + 上传行 + 模式切换（嵌入单元内不重复渲染）。 */
  const editorChrome = (
    <>
      <ol className="publishing-publish-steps" aria-label="发布步骤">
        {PUBLISH_STEPS.map((step, index) => (
          <li
            key={step}
            className={
              article?.currentVersionId
                ? index === 0
                  ? "is-done"
                  : index === 1
                    ? "is-active"
                    : undefined
                : index === 0
                  ? "is-active"
                  : undefined
            }
          >
            <b>{index + 1}</b>
            {step.replace(/^\d+\.\s*/u, "")}
          </li>
        ))}
      </ol>
      <div className="publishing-publish-uploads" aria-label="素材上传">
        {isNew ? (
          <button
            type="button"
            className="publishing-button publishing-button-secondary"
            onClick={() => newFileInput.current?.click()}
          >
            <Upload size={16} /> 上传文档
          </button>
        ) : (
          <Link
            className="publishing-button publishing-button-secondary"
            href="/publishing/articles/new"
          >
            <Upload size={16} /> 上传文档
          </Link>
        )}
        <button
          type="button"
          className="publishing-button publishing-button-secondary"
          disabled
          title="视频上传能力随媒体库完善后开放"
        >
          <Video size={16} /> 上传视频
        </button>
        <button
          type="button"
          className="publishing-button publishing-button-primary"
          onClick={goToMediaSelection}
          disabled={isNew || embedded || saving || freezing || flow?.outcomePending}
          title={article?.currentVersionId ? "进入媒体选择首页" : "先冻结当前版本，再进入媒体选择首页"}
        >
          选择媒体
        </button>
        <span className="publishing-editor-inline-note">
          {article?.currentVersionId
            ? "当前版本已冻结，可进入媒体选择首页，再选择适合的选媒方式"
            : isNew
              ? "新稿件可直接撰写标题与正文；首次保存后即可选择媒体"
              : "尚未冻结版本：点击后自动保存并冻结，再进入媒体选择首页"}
        </span>
      </div>
      <div className="publishing-editor-mode-switch" role="tablist" aria-label="编辑模式">
        {EDITOR_MODES.map(([mode, label, hint]) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={editorMode === mode}
            className={editorMode === mode ? "is-active" : ""}
            onClick={() => setEditorMode(mode)}
          >
            <strong>{label}</strong><span>{hint}</span>
          </button>
        ))}
      </div>
    </>
  );

  const subnav = (activeEdit: boolean) => (
    <nav className="publishing-article-subnav" aria-label="稿件子页面">
      <Link href="/publishing/articles">管理稿件</Link>
      <Link href="/publishing/articles/records">发布记录</Link>
      <Link href="/publishing/articles/edit" className={activeEdit ? "is-active" : undefined} aria-current={activeEdit ? "page" : undefined}>编辑稿件</Link>
    </nav>
  );

  // 新稿：与已有稿件同一界面——直接撰写标题/正文，首次保存经桥接落库为真实稿件。
  if (isNew) {
    const saveNewDraft = async () => {
      if (saving) return;
      setSaving(true);
      setSaveError("");
      try {
        const saved = await persistHandwritten(
          editorMode === "multi" ? fallbackTitle(content) : title,
          content,
        );
        enterCreatedArticle(saved.id);
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : "保存失败，请重试");
      } finally {
        setSaving(false);
      }
    };
    if (editorMode === "batch") {
      return (
        <PublishingPage
          title="发布文章 · 批量投放"
          description="逐篇准备多份稿件：文章 1 直接撰写，继续添加新单元或上传解析。"
        >
          {subnav(false)}
          {editorChrome}
          <BatchUnitsEditor />
        </PublishingPage>
      );
    }
    return (
      <PublishingPage
        title="发布文章"
        description="编辑新稿件：直接填写标题与正文，或上传文档导入内容；保存后即为真实稿件。"
        busy={saving}
        actions={
          <button
            className="publishing-button publishing-button-primary"
            type="button"
            onClick={() => void saveNewDraft()}
            disabled={saving || (!title.trim() && !content.text.trim())}
          >
            {saving ? <LoaderCircle className="publishing-spin" size={16} /> : <Save size={16} />}
            {saving ? "保存中…" : "保存草稿"}
          </button>
        }
      >
        {subnav(false)}
        {editorChrome}
        {saveError ? (
          <p className="publishing-form-error" role="alert">{saveError}</p>
        ) : null}
        <div className="publishing-editor-meta">
          <span className="publishing-save-state">
            {content.text.trim() ? "已有正文内容，保存后创建真实稿件" : "直接撰写，或点击“上传文档”导入"}
          </span>
          <span>
            {content.text.replace(/\s/g, "").length.toLocaleString("zh-CN")} 字
          </span>
        </div>
        <section className="publishing-panel publishing-editor-card">
          {editorMode === "multi" ? (
            <p className="publishing-editor-inline-note publishing-multi-title-note">
              多标题模式：不填写统一标题；正文保存后经“选择媒体”进入媒体选择首页，
              逐个媒体确认并配置标题后提交订单。
            </p>
          ) : (
            <label className="publishing-title-field">
              <span>稿件标题</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-label="稿件标题"
                maxLength={100}
              />
            </label>
          )}
          <ArticleEditorSurface
            value={content}
            images={[]}
            onChange={setContent}
            onUploadImage={rejectImageBeforeSave}
          />
          <footer className="publishing-editor-count">
            {content.text.replace(/\s/g, "").length.toLocaleString("zh-CN")} 字 · 首次保存后可上传图片
          </footer>
        </section>
        <input
          ref={newFileInput}
          type="file"
          accept=".docx"
          className="publishing-visually-hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file || saving) return;
            setSaving(true);
            setSaveError("");
            try {
              const imported = await gateway.importDocx(file);
              enterCreatedArticle(imported.articleId);
            } catch (reason) {
              setSaveError(reason instanceof Error ? reason.message : "导入失败，请重试");
            } finally {
              setSaving(false);
            }
          }}
        />
      </PublishingPage>
    );
  }

  if (editorMode === "batch" && !embedded) {
    return (
      <PublishingPage
        title="发布文章 · 批量投放"
        description="逐篇准备多份真实稿件：文章 1 为当前稿件，可继续添加直接撰写或导入的新单元。"
        busy={query.loading}
      >
        {subnav(true)}
        {editorChrome}
        {query.loading ? <PublishingLoading label="正在读取稿件…" /> : null}
        {query.error ? (
          <PublishingError error={query.error} onRetry={query.reload} />
        ) : null}
        <BatchUnitsEditor
          initialBound={
            article
              ? {
                  articleId: article.id,
                  revision: article.revision,
                  title,
                  content,
                }
              : undefined
          }
        />
      </PublishingPage>
    );
  }

  return (
    <PublishingPage
      title={embedded ? (article?.title || "文章编辑") : "发布文章"}
      description={embedded ? "批量准备中的独立真实稿件卡；保存与冻结均作用于此稿件。" : editorMode === "multi" ? "多标题：填写内容后选择媒体，再按媒体分别配置标题" : "编辑正文并冻结可追溯版本"}
      busy={query.loading || saving}
      actions={
        article ? (
          <>
            <button
              className="publishing-button publishing-button-secondary"
              type="button"
              onClick={() => setPreviewOpen(true)}
              disabled={!article}
            >
              <Eye size={16} />
              预览稿件
            </button>
            <button
              className="publishing-button publishing-button-secondary"
              type="button"
              onClick={() => void saveNow().catch(() => undefined)}
              disabled={!dirty || saving}
            >
              {saving ? (
                <LoaderCircle className="publishing-spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              {saving ? "保存中…" : dirty ? "保存草稿" : "已保存"}
            </button>
            <button
              className="publishing-button publishing-button-primary"
              type="button"
              onClick={freezeAndContinue}
              disabled={
                saving ||
                freezing ||
                flow?.outcomePending ||
                !title.trim() ||
                !content.text.trim()
              }
            >
              <FileCheck2 size={17} />
              {freezing ? "正在冻结…" : "冻结当前版本"}
            </button>
          </>
        ) : undefined
      }
    >
      {!embedded ? subnav(true) : null}
      {flow && frozenResult && !dirty && (
        <section className="publishing-flow-result" aria-label="稿件冻结完成">
          <CheckCircle2 size={20} />
          <div>
            <strong>稿件 v{frozenResult.currentVersion} 已冻结</strong>
            <p>
              {frozenResult.title}。后续编辑会保留本次冻结版本及其历史引用。
            </p>
            <button
              type="button"
              className="publishing-button publishing-button-primary"
              disabled={freezing}
              onClick={() => void handoffToMedia()}
            >
              交给媒体助手
            </button>
          </div>
        </section>
      )}
      {!embedded ? (
        <PublishingBreadcrumbs
          items={[
            { label: "稿件", href: "/publishing/articles" },
            { label: article?.title || "编辑" },
          ]}
        />
      ) : null}
      {!embedded ? editorChrome : null}
      {query.loading ? <PublishingLoading label="正在读取稿件编辑器…" /> : null}
      {query.error ? (
        <PublishingError error={query.error} onRetry={query.reload} />
      ) : null}
      {previewOpen && article ? (
        <div
          className="publishing-article-preview-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") setPreviewOpen(false);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewOpen(false);
          }}
        >
          <section
            className={`publishing-article-preview ${previewDevice === "mobile" ? "is-mobile" : "is-desktop"}`}
            role="dialog"
            aria-modal="true"
            aria-label="稿件预览"
          >
            <header>
              <div>
                <strong>稿件预览</strong>
                <span>预览当前编辑内容，不代表媒体最终排版</span>
              </div>
              <div className="publishing-inline-actions">
                <button
                  type="button"
                  className={`publishing-button ${previewDevice === "desktop" ? "publishing-button-primary" : "publishing-button-secondary"}`}
                  onClick={() => setPreviewDevice("desktop")}
                >
                  桌面
                </button>
                <button
                  type="button"
                  className={`publishing-button ${previewDevice === "mobile" ? "publishing-button-primary" : "publishing-button-secondary"}`}
                  onClick={() => setPreviewDevice("mobile")}
                >
                  手机
                </button>
                <button
                  type="button"
                  className="publishing-dialog-close"
                  aria-label="关闭稿件预览"
                  onClick={() => setPreviewOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            <article className="publishing-article-preview-paper">
              <h1>{title.trim() || "未命名稿件"}</h1>
              <div
                className="publishing-article-preview-content"
                dangerouslySetInnerHTML={{
                  __html: sanitizePublisherEditorHtml(content.html, images),
                }}
              />
            </article>
          </section>
        </div>
      ) : null}
      {article ? (
        <>
          <div className="publishing-editor-meta">
            <span className="publishing-save-state">
              {saveError ? (
                <>
                  <span className="is-error" /> {saveError}
                </>
              ) : saving ? (
                <>
                  <span className="is-saving" /> 自动保存中
                </>
              ) : (
                <>
                  <span className="is-saved" />{" "}
                  {dirty
                    ? "等待自动保存"
                    : `已保存于 ${publishingDateTime(article.updatedAt)}`}
                </>
              )}
            </span>
            <span>
              {content.text.replace(/\s/g, "").length.toLocaleString("zh-CN")}{" "}
              字 · {images.length} 张图片
            </span>
          </div>
          <div className="publishing-editor-layout">
            <section
              className="publishing-panel publishing-editor-card"
              id="publishing-current-article"
              data-reading-anchor="article-editor"
            >
              {editorMode === "multi" && !embedded ? (
                <p className="publishing-editor-inline-note publishing-multi-title-note">
                  多标题模式：本模式不填写统一标题；正文保存后点击
                  <button
                    type="button"
                    className="publishing-link-button"
                    onClick={goToMediaSelection}
                    disabled={saving || freezing || flow?.outcomePending}
                  >
                    选择媒体
                  </button>
                  进入媒体选择首页，完成选媒后逐个媒体确认并配置标题。
                </p>
              ) : (
                <label className="publishing-title-field">
                  <span>稿件标题</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    aria-label="稿件标题"
                    maxLength={100}
                  />
                </label>
              )}
              <ArticleEditorSurface
                value={content}
                images={images}
                onChange={setContent}
                onUploadImage={uploadImage}
              />
              {images.length ? (
                <section
                  className="publishing-editor-images"
                  aria-labelledby="publishing-editor-images-title"
                >
                  <h2 id="publishing-editor-images-title">
                    <ImageIcon size={18} />
                    正文图片与替代文本
                  </h2>
                  {images.map((image) => (
                    <label key={image.id} className="publishing-image-row">
                      <span className="publishing-image-preview">
                        <ImageIcon size={22} />
                        <small>
                          {image.width} × {image.height}
                        </small>
                      </span>
                      <span>
                        <strong>{image.fileName}</strong>
                        <small>描述图片内容，帮助媒体校验和无障碍阅读。</small>
                      </span>
                      <input
                        value={image.altText}
                        onChange={(event) =>
                          updateAlt(image.id, event.target.value)
                        }
                        aria-label={`${image.fileName} 的 Alt 文本`}
                      />
                    </label>
                  ))}
                </section>
              ) : null}
              <footer className="publishing-editor-count">
                {content.text.replace(/\s/g, "").length.toLocaleString("zh-CN")}{" "}
                字 · {images.length} 张图片 ·{" "}
                {article.importChecks.externalLinkCount} 个链接
              </footer>
            </section>
            {!flow && (
              <aside className="publishing-editor-inspector">
                <section className="publishing-panel">
                  <h2>版本与发布准备</h2>
                  <div className="publishing-version-current">
                    <span>当前版本</span>
                    <strong>v{article.currentVersion}</strong>
                    <code>
                      {article.currentVersionHash?.slice(0, 12) || "尚未冻结"}
                    </code>
                  </div>
                  <div className="publishing-check-list">
                    <p>
                      <ShieldCheck size={17} />
                      DOCX 导入检查 <strong>已通过</strong>
                    </p>
                    <p>
                      <CheckCircle2 size={17} />
                      正文结构 <strong>已通过</strong>
                    </p>
                    <p>
                      <ImageIcon size={17} />
                      图片 <strong>{images.length} 张</strong>
                    </p>
                  </div>
                </section>
                <section className="publishing-panel">
                  <h2>
                    版本历史{" "}
                    <small>
                      最近 {Math.min(article.versions.length, 3)} 版
                    </small>
                  </h2>
                  <ol className="publishing-version-list">
                    {article.versions.slice(0, 3).map((version) => (
                      <li key={version.id}>
                        <span>v{version.version}</span>
                        <div>
                          <strong>{version.frozen ? "已冻结" : "草稿"}</strong>
                          <small>
                            {publishingDateTime(version.createdAt)} ·{" "}
                            {version.createdBy}
                          </small>
                        </div>
                        {version.version === article.currentVersion ? (
                          <Check size={15} />
                        ) : (
                          <Clock3 size={15} />
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
                {!flow && (
                  <button
                    className="publishing-button publishing-button-accent publishing-button-block"
                    type="button"
                    onClick={freezeAndContinue}
                    disabled={
                      saving ||
                      freezing ||
                      !title.trim() ||
                      !content.text.trim()
                    }
                  >
                    选择媒体
                  </button>
                )}
                <Link
                  className="publishing-button publishing-button-secondary publishing-button-block"
                  href="/publishing/articles"
                >
                  返回稿件列表
                </Link>
              </aside>
            )}
          </div>
        </>
      ) : null}
    </PublishingPage>
  );
}

type BatchUnit = {
  key: number;
  articleId?: string;
  revision?: number;
  title: string;
  content: PublisherEditorContent;
  saving: boolean;
  note: string;
};

/** 批量投放单元列表：文章 1 无删除键；≥2 篇时每单元显红色垃圾桶；每单元含标题/上传解析/上传视频/正文。 */
function BatchUnitsEditor({
  initialBound,
}: {
  initialBound?: {
    articleId: string;
    revision: number;
    title: string;
    content: PublisherEditorContent;
  };
}) {
  const gateway = usePublisherGateway();
  const [units, setUnits] = useState<BatchUnit[]>(() => [
    initialBound
      ? {
          key: 1,
          articleId: initialBound.articleId,
          revision: initialBound.revision,
          title: initialBound.title,
          content: initialBound.content,
          saving: false,
          note: "当前稿件（已保存）",
        }
      : { key: 1, title: "", content: EMPTY_CONTENT, saving: false, note: "直接撰写或上传解析" },
  ]);
  const [unitError, setUnitError] = useState("");
  const nextKey = useRef(2);
  const fileTargets = useRef(new Map<number, HTMLInputElement>());

  const patchUnit = (key: number, patch: Partial<BatchUnit>) =>
    setUnits((current) =>
      current.map((unit) => (unit.key === key ? { ...unit, ...patch } : unit)),
    );

  const saveUnit = async (key: number) => {
    const unit = units.find((item) => item.key === key);
    if (!unit || unit.saving) return;
    patchUnit(key, { saving: true });
    setUnitError("");
    try {
      if (unit.articleId && unit.revision !== undefined) {
        const saved = await gateway.saveArticle({
          articleId: unit.articleId,
          expectedRevision: unit.revision,
          title: unit.title.trim() || fallbackTitle(unit.content),
          bodyText: unit.content.text,
          bodyHtml: sanitizePublisherEditorHtml(unit.content.html, []),
          editorJson: unit.content.json,
          images: [],
        });
        patchUnit(key, {
          revision: saved.revision,
          saving: false,
          note: `已保存 · ${publishingDateTime(saved.updatedAt)}`,
        });
      } else {
        const file = buildHandwrittenDocxFile(unit.title, unit.content.text);
        const imported = await gateway.importDocx(file);
        const created = await gateway.getArticle(imported.articleId);
        const saved = await gateway.saveArticle({
          articleId: imported.articleId,
          expectedRevision: created.revision,
          title: unit.title.trim() || fallbackTitle(unit.content),
          bodyText: unit.content.text,
          bodyHtml: sanitizePublisherEditorHtml(unit.content.html, []),
          editorJson: unit.content.json,
          images: [],
        });
        patchUnit(key, {
          articleId: saved.id,
          revision: saved.revision,
          saving: false,
          note: `已保存为真实稿件 · ${saved.id.slice(0, 8)}`,
        });
      }
    } catch (reason) {
      patchUnit(key, { saving: false });
      setUnitError(reason instanceof Error ? reason.message : "保存失败，请重试");
    }
  };

  const importIntoUnit = async (key: number, file: File) => {
    const unit = units.find((item) => item.key === key);
    if (!unit || unit.saving) return;
    if (unit.title.trim() || unit.content.text.trim()) {
      const confirmed = window.confirm(
        `文章 ${units.findIndex((item) => item.key === key) + 1} 已有内容，导入将替换该单元的标题与正文。继续吗？`,
      );
      if (!confirmed) return;
    }
    patchUnit(key, { saving: true });
    setUnitError("");
    try {
      const imported = await gateway.importDocx(file);
      const detail = await gateway.getArticle(imported.articleId);
      const html = sanitizePublisherEditorHtml(
        detail.bodyHtml ?? publisherPlainTextToHtml(detail.bodyText),
        detail.images,
      );
      patchUnit(key, {
        articleId: detail.id,
        revision: detail.revision,
        title: detail.title,
        content: {
          html,
          text: detail.bodyText || publisherHtmlToPlainText(html),
          json: detail.editorJson ?? { type: "doc", content: [] },
        },
        saving: false,
        note: `已导入并保存 · ${detail.id.slice(0, 8)}`,
      });
    } catch (reason) {
      patchUnit(key, { saving: false });
      setUnitError(reason instanceof Error ? reason.message : "导入失败，请重试");
    }
  };

  const removable = units.length >= 2;

  return (
    <>
      <section className="publishing-article-stack" aria-label="批量稿件单元">
        {units.map((unit, index) => (
          <article className="publishing-article-stack-card publishing-batch-unit" key={unit.key}>
            <div className="publishing-batch-unit-head">
              <span className="publishing-article-stack-number">文章 {index + 1}</span>
              <div className="publishing-batch-unit-actions">
                <button
                  type="button"
                  className="publishing-button publishing-button-secondary"
                  disabled={unit.saving}
                  onClick={() => fileTargets.current.get(unit.key)?.click()}
                >
                  <Upload size={15} /> 上传解析
                </button>
                <button
                  type="button"
                  className="publishing-button publishing-button-secondary"
                  disabled
                  title="视频上传能力随媒体库完善后开放"
                >
                  <Video size={15} /> 上传视频
                </button>
                {removable ? (
                  <button
                    type="button"
                    className="publishing-batch-unit-remove"
                    aria-label={`删除文章 ${index + 1}（仅从本批量列表移除，不删除已保存的稿件记录）`}
                    onClick={() =>
                      setUnits((current) => current.filter((item) => item.key !== unit.key))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </div>
            </div>
            <label className="publishing-title-field">
              <span>稿件标题</span>
              <input
                value={unit.title}
                onChange={(event) => patchUnit(unit.key, { title: event.target.value })}
                aria-label={`文章 ${index + 1} 标题`}
                maxLength={100}
              />
            </label>
            <ArticleEditorSurface
              value={unit.content}
              images={[]}
              onChange={(value) => patchUnit(unit.key, { content: value })}
              onUploadImage={rejectImageBeforeSave}
            />
            <div className="publishing-batch-unit-foot">
              <span className="publishing-editor-inline-note">
                {unit.articleId ? `真实稿件 ${unit.articleId.slice(0, 8)} · ` : "未保存 · "}
                {unit.note}
              </span>
              <button
                type="button"
                className="publishing-button publishing-button-primary"
                disabled={unit.saving || (!unit.title.trim() && !unit.content.text.trim())}
                onClick={() => void saveUnit(unit.key)}
              >
                {unit.saving ? <LoaderCircle className="publishing-spin" size={15} /> : <Save size={15} />}
                {unit.saving ? "保存中…" : unit.articleId ? "保存修改" : "保存这篇"}
              </button>
            </div>
            <input
              ref={(element) => {
                if (element) fileTargets.current.set(unit.key, element);
                else fileTargets.current.delete(unit.key);
              }}
              type="file"
              accept=".docx"
              className="publishing-visually-hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importIntoUnit(unit.key, file);
              }}
            />
          </article>
        ))}
      </section>
      <button
        type="button"
        className="publishing-batch-add"
        onClick={() =>
          setUnits((current) => [
            ...current,
            {
              key: nextKey.current++,
              title: "",
              content: EMPTY_CONTENT,
              saving: false,
              note: "直接撰写或上传解析",
            },
          ])
        }
      >
        ＋ 继续添加一篇文章
      </button>
      {unitError ? (
        <p className="publishing-form-error" role="alert">{unitError}</p>
      ) : null}
      <p className="publishing-editor-inline-note">
        每个单元独立保存为一篇真实稿件；删除按钮仅把单元移出本批量列表，不删除已保存的稿件记录。
      </p>
    </>
  );
}
