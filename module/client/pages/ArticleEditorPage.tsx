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
import type {
  ArticleDetail,
  ArticleImage,
  PublisherEditorContent,
} from "../types";
import { publishingDateTime } from "../types";
import PublishingImportPage from "./ImportPage";

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

/**
 * 媒体库正式接入前的占位示例媒体：仅用于本页交互演示，
 * 不来自任何真实接口，也不发起任何请求。
 */
const PLACEHOLDER_MEDIA = [
  { id: "placeholder-1", name: "示例公众号 · 科技观察", price: "占位报价 128" },
  { id: "placeholder-2", name: "示例门户 · 资讯频道", price: "占位报价 260" },
  { id: "placeholder-3", name: "示例自媒体 · 生活号", price: "占位报价 88" },
  { id: "placeholder-4", name: "示例行业站 · 垂直媒体", price: "占位报价 150" },
];

const PUBLISH_STEPS = [
  "1. 填写标题、内容",
  "2. 点击[选择媒体]",
  "3. 勾选媒体",
  "4. 提交订单，发布成功",
];

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
        ? // 新稿状态不请求详情；创建走 DOCX 导入接口。
          new Promise<ArticleDetail>(() => {})
        : gateway.getArticle(articleId, signal),
    [articleId, gateway, isNew],
  );
  const query = usePublisherQuery(load);
  const [article, setArticle] = useState<ArticleDetail>();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<PublisherEditorContent>({
    html: "",
    text: "",
    json: { type: "doc", content: [] },
  });
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
  // 批量投放的本地单元：文章1 为当前稿件；新增单元经 DOCX 导入成为真实稿件。
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [batchAdding, setBatchAdding] = useState(false);
  // 媒体选择占位（媒体库接入前不调用任何 API）。
  const [mediaPickOpen, setMediaPickOpen] = useState(false);
  const [mediaSelection, setMediaSelection] = useState<string[]>([]);
  const [mediaTitles, setMediaTitles] = useState<Record<string, string>>({});
  const [frozenResult, setFrozenResult] = useState<ArticleDetail>();
  const previewObjectUrls = useRef(new Set<string>());

  useEffect(() => {
    if (!isNew && editorMode === "batch" && batchIds.length === 0) {
      setBatchIds([articleId]);
    }
  }, [articleId, batchIds.length, editorMode, isNew]);

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
      { label: "稿件", value: article?.title || "正在读取" },
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
              `/publishing/media?articleVersion=${encodeURIComponent(frozen.currentVersionId!)}`,
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
        route: `/publishing/media?articleVersion=${encodeURIComponent(frozenResult.currentVersionId)}`,
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
              index === 0
                ? "is-active"
                : index <= 2 && mediaSelection.length
                  ? "is-done"
                  : undefined
            }
          >
            <b>{index + 1}</b>
            {step.replace(/^\d+\.\s*/u, "")}
          </li>
        ))}
      </ol>
      <div className="publishing-publish-uploads" aria-label="素材上传">
        <Link
          className="publishing-button publishing-button-secondary"
          href={isNew ? "/publishing/articles/new" : "/publishing/articles/new"}
        >
          <Upload size={16} /> 上传文档
        </Link>
        <button
          type="button"
          className="publishing-button publishing-button-secondary"
          disabled
          title="媒体库接入后开放视频上传"
        >
          <Video size={16} /> 上传视频
        </button>
        <button
          type="button"
          className="publishing-button publishing-button-primary"
          onClick={() => setMediaPickOpen(true)}
        >
          选择媒体
        </button>
        {mediaSelection.length ? (
          <span className="publishing-media-chips">
            {mediaSelection.map((id) => (
              <span className="publishing-media-chip" key={id}>
                {PLACEHOLDER_MEDIA.find((media) => media.id === id)?.name ?? id}
              </span>
            ))}
          </span>
        ) : (
          <span className="publishing-editor-inline-note">
            媒体库接入前为占位交互，不调用真实接口
          </span>
        )}
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

  const mediaPicker = mediaPickOpen ? (
    <div
      className="publishing-article-preview-backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") setMediaPickOpen(false);
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setMediaPickOpen(false);
      }}
    >
      <section
        className="publishing-media-picker"
        role="dialog"
        aria-modal="true"
        aria-label="选择媒体（占位）"
      >
        <header>
          <div>
            <strong>选择媒体</strong>
            <span>占位示例列表 · 媒体库正式接入后替换为真实媒体与报价</span>
          </div>
          <button
            type="button"
            className="publishing-dialog-close"
            aria-label="关闭媒体选择"
            onClick={() => setMediaPickOpen(false)}
          >
            <X size={18} />
          </button>
        </header>
        <div className="publishing-media-picker-body">
          {PLACEHOLDER_MEDIA.map((media) => (
            <label key={media.id} className="publishing-media-option">
              <input
                type="checkbox"
                checked={mediaSelection.includes(media.id)}
                onChange={(event) =>
                  setMediaSelection((current) =>
                    event.target.checked
                      ? [...current, media.id]
                      : current.filter((id) => id !== media.id),
                  )
                }
              />
              <span>
                <strong>{media.name}</strong>
                <small>{media.price} · 占位数据</small>
              </span>
            </label>
          ))}
        </div>
        <footer>
          <span className="publishing-editor-inline-note">
            提交订单在媒体库正式接入后开放
          </span>
          <button
            type="button"
            className="publishing-button publishing-button-primary"
            onClick={() => setMediaPickOpen(false)}
          >
            确认勾选（{mediaSelection.length}）
          </button>
        </footer>
      </section>
    </div>
  ) : null;

  const multiTitleRows =
    editorMode === "multi" && mediaSelection.length ? (
      <section className="publishing-media-title-panel" aria-label="按媒体配置标题">
        <div>
          <strong>按所选媒体填写标题</strong>
          <p>
            多标题逻辑：同一正文发送给已选媒体，并为每个媒体分别填写标题。
            以下标题为本地草拟，媒体库正式接入后随订单提交。
          </p>
        </div>
        {mediaSelection.map((mediaId) => (
          <label key={mediaId}>
            <span>{PLACEHOLDER_MEDIA.find((media) => media.id === mediaId)?.name ?? mediaId}</span>
            <input
              value={mediaTitles[mediaId] ?? ""}
              maxLength={100}
              placeholder="为该媒体填写标题"
              onChange={(event) =>
                setMediaTitles((current) => ({
                  ...current,
                  [mediaId]: event.target.value,
                }))
              }
            />
          </label>
        ))}
      </section>
    ) : null;

  // 新稿：统一发布页 + DOCX 导入创建第一份真实稿件，导入后进入同一编辑页。
  if (isNew) {
    return (
      <PublishingPage
        title="发布文章"
        description="编辑新稿件与继续编辑已有稿件使用同一界面；上传文档后开始填写标题与内容。"
      >
        <nav className="publishing-article-subnav" aria-label="稿件子页面">
          <Link href="/publishing/articles">管理稿件</Link>
          <Link href="/publishing/articles/records">发布记录</Link>
          <Link href="/publishing/articles/edit">编辑稿件</Link>
        </nav>
        {editorChrome}
        <section className="publishing-panel publishing-new-article-import" aria-label="上传文档创建稿件">
          <div>
            <h2>上传文档，创建第一份稿件</h2>
            <p>
              单标题/多标题/批量投放均在下方界面完成；当前网关通过 DOCX 导入创建真实稿件，
              导入完成后自动进入编辑（保留当前选择的模式）。
            </p>
          </div>
          <PublishingImportPage onImported={enterCreatedArticle} />
        </section>
        {mediaPicker}
      </PublishingPage>
    );
  }

  if (editorMode === "batch" && !embedded) {
    const removeUnit = (index: number) => {
      setBatchIds((current) => current.filter((_, i) => i !== index));
    };
    return (
      <PublishingPage
        title="发布文章 · 批量投放"
        description="逐篇准备多份真实稿件：文章1 为当前稿件，继续添加经 DOCX 导入创建。"
      >
        <nav className="publishing-article-subnav" aria-label="稿件子页面">
          <Link href="/publishing/articles">管理稿件</Link>
          <Link href="/publishing/articles/records">发布记录</Link>
          <Link href="/publishing/articles/edit" className="is-active" aria-current="page">编辑稿件</Link>
        </nav>
        {editorChrome}
        {batchIds.length ? (
          <section className="publishing-article-stack" aria-label="批量稿件单元">
            {batchIds.map((unitId, index) => (
              <article className="publishing-article-stack-card" key={unitId}>
                <div className="publishing-batch-unit-head">
                  <span className="publishing-article-stack-number">文章 {index + 1}</span>
                  <div className="publishing-batch-unit-actions">
                    <Link
                      className="publishing-button publishing-button-secondary"
                      href="/publishing/articles/new"
                    >
                      <Upload size={15} /> 上传解析
                    </Link>
                    <button
                      type="button"
                      className="publishing-button publishing-button-secondary"
                      disabled
                      title="媒体库接入后开放视频上传"
                    >
                      <Video size={15} /> 上传视频
                    </button>
                    {batchIds.length >= 2 ? (
                      <button
                        type="button"
                        className="publishing-batch-unit-remove"
                        aria-label={`删除文章 ${index + 1}（仅从本批量列表移除，不删除稿件记录）`}
                        onClick={() => removeUnit(index)}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </div>
                </div>
                <PublishingArticleEditorPage articleId={unitId} embedded />
              </article>
            ))}
          </section>
        ) : (
          <div className="publishing-empty-state">
            <strong>批量投放尚未开始</strong>
            <p>文章 1 会使用当前稿件；也可以先上传一份新文档。</p>
          </div>
        )}
        {batchAdding ? (
          <section className="publishing-panel publishing-batch-add-panel" aria-label="继续添加一篇文章">
            <div>
              <h2>继续添加一篇文章</h2>
              <p>上传 DOCX 创建新的真实稿件，加入本批量列表。</p>
            </div>
            <PublishingImportPage
              onImported={(createdId) => {
                setBatchIds((current) =>
                  current.includes(createdId) ? current : [...current, createdId],
                );
                setBatchAdding(false);
              }}
            />
          </section>
        ) : (
          <button
            type="button"
            className="publishing-batch-add"
            onClick={() => setBatchAdding(true)}
          >
            ＋ 继续添加一篇文章
          </button>
        )}
        <p className="publishing-editor-inline-note">
          删除按钮仅把稿件移出本批量列表，不删除稿件记录（当前网关无删除接口）。
        </p>
        {mediaPicker}
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
      {!embedded ? <nav className="publishing-article-subnav" aria-label="稿件子页面">
        <Link href="/publishing/articles">管理稿件</Link>
        <Link href="/publishing/articles/records">发布记录</Link>
        <Link href="/publishing/articles/edit" className="is-active" aria-current="page">编辑稿件</Link>
      </nav> : null}
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
      {!embedded ? <PublishingBreadcrumbs
        items={[
          { label: "稿件", href: "/publishing/articles" },
          { label: article?.title || "编辑" },
        ]}
      /> : null}
      {!embedded ? editorChrome : null}
      {!embedded ? multiTitleRows : null}
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
                  多标题模式：本模式不填写统一标题，正文保存后由
                  <button
                    type="button"
                    className="publishing-link-button"
                    onClick={() => setMediaPickOpen(true)}
                  >
                    选择媒体
                  </button>
                  并按媒体分别配置标题；正式标题仍以单标题模式或导入内容为准。
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
      {mediaPicker}
    </PublishingPage>
  );
}
