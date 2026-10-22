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
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "wouter";
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

export default function PublishingArticleEditorPage({
  articleId,
  embedded = false,
}: {
  articleId: string;
  embedded?: boolean;
}) {
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const operationScope = usePublishingOperationScope(articleId);
  const [, navigate] = useLocation();
  const load = useCallback(
    (signal: AbortSignal) => gateway.getArticle(articleId, signal),
    [articleId, gateway],
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
  // Presentation-only organization modes. They do not add fields to the gateway contract.
  const [editorMode, setEditorMode] = useState<"single" | "multi" | "batch">("single");
  const [alternateTitles, setAlternateTitles] = useState(["", ""]);
  const loadArticleStack = useCallback(
    (signal: AbortSignal) => gateway.listArticles(signal),
    [gateway],
  );
  const articleStack = usePublisherQuery(loadArticleStack, "article-editor-stack");
  const [frozenResult, setFrozenResult] = useState<ArticleDetail>();
  const previewObjectUrls = useRef(new Set<string>());

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

  if (editorMode === "batch" && !embedded) {
    return (
      <PublishingPage title="批量投放 · 稿件准备" description="按 DEMO 的 article-stack 组织多篇真实稿件。每张卡关联现有稿件记录，编辑与保存仍使用真实稿件 API；本轮不创建虚构批量任务。" busy={articleStack.loading}>
        <nav className="publishing-article-subnav" aria-label="稿件子页面">
          <Link href="/publishing/articles">管理稿件</Link>
          <Link href="/publishing/records">发布记录</Link>
          <Link href="/publishing/articles/edit" className="is-active" aria-current="page">编辑稿件</Link>
        </nav>
        <div className="publishing-editor-mode-switch" role="tablist" aria-label="编辑模式">
          {([["single", "单标题", "一篇文章，一个正式标题"], ["multi", "多标题", "同一正文，多个备选标题"], ["batch", "批量投放", "逐篇准备真实稿件"]] as const).map(([mode,label,hint]) => <button key={mode} type="button" role="tab" aria-selected={editorMode===mode} className={editorMode===mode ? "is-active" : ""} onClick={() => setEditorMode(mode)}><strong>{label}</strong><span>{hint}</span></button>)}
        </div>
        <div className="publishing-article-stack-heading"><div><h2>批量稿件堆栈</h2><p>每张卡都是通过稿件列表 / 导入 API 建立的真实稿件，不会虚构批量任务字段。</p></div><Link className="publishing-button publishing-button-primary" href="/publishing/articles/new/import">＋ 添加稿件（导入 DOCX）</Link></div>
        {articleStack.loading ? <PublishingLoading label="正在读取真实稿件…" /> : null}
        {articleStack.error ? <PublishingError error={articleStack.error} onRetry={articleStack.reload} /> : null}
        {articleStack.data?.length ? <section className="publishing-article-stack" aria-label="批量稿件卡片">{articleStack.data.map((item,index) => <article className="publishing-article-stack-card publishing-article-stack-editor" key={item.id}><div className="publishing-article-stack-heading"><span className="publishing-article-stack-number">文章 {index+1}</span><span className="publishing-editor-inline-note">真实稿件 ID：{item.id}</span></div><PublishingArticleEditorPage articleId={item.id} embedded /></article>)}</section> : <div className="publishing-empty-state"><strong>还没有可加入批量准备的稿件</strong><p>导入 DOCX 后，稿件会作为真实记录出现在此处。</p><Link className="publishing-button publishing-button-primary" href="/publishing/articles/new/import">导入第一篇稿件</Link></div>}
        <p className="publishing-editor-inline-note">当前 Gateway 没有删除稿件或创建空白稿件的接口，因此此处不提供伪删除按钮；新稿件通过现有 DOCX 导入流程逐篇落库。</p>
      </PublishingPage>
    );
  }

  return (
    <PublishingPage
      title={embedded ? (article?.title || "文章编辑") : "稿件编辑"}
      description={embedded ? "批量准备中的独立真实稿件卡；保存与冻结均作用于此稿件。" : "编辑正文并冻结可追溯版本"}
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
        <Link href="/publishing/records">发布记录</Link>
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
      {!embedded ? <section className="publishing-editor-mode-panel" aria-label="编辑组织模式">
        <div className="publishing-editor-mode-heading">
          <div>
            <span className="publishing-overview-kicker">CONTENT WORKSPACE</span>
            <h2>内容编辑方式</h2>
            <p>切换编辑工作视图；模式选择仅用于当前页面组织内容，不改变保存、冻结或媒体交接的数据契约。</p>
          </div>
          <span className="publishing-local-mode-note">本页临时视图</span>
        </div>
        <div className="publishing-editor-mode-switch" role="tablist" aria-label="编辑模式">
          {([
            ["single", "单标题", "一篇文章，一个正式标题"],
            ["multi", "多标题", "同一正文，准备不同标题"],
            ["batch", "批量投放", "逐篇准备真实稿件"],
          ] as const).map(([mode, label, hint]) => (
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
        {editorMode === "multi" ? (
          <div className="publishing-alternate-titles">
            <div><strong>标题草拟区</strong><p>以下备选标题只保存在当前编辑页面，不会写入稿件 API；请在实际媒体流程中按媒体规则确认最终标题。</p></div>
            {alternateTitles.map((value, index) => (
              <div className="publishing-alternate-title-row" key={index}>
                <label>
                  <span>备选标题 {index + 1}</span>
                  <input
                    value={value}
                    maxLength={100}
                    placeholder={title || "输入备选标题"}
                    onChange={(event) => setAlternateTitles((current) => current.map((item, i) => i === index ? event.target.value : item))}
                  />
                </label>
                <div className="publishing-inline-actions">
                  <button type="button" className="publishing-button publishing-button-primary" disabled={!value.trim() || saving || freezing} onClick={() => { setTitle(value.trim()); setSaveError(""); }}>应用为正式标题</button>
                  <button type="button" className="publishing-button publishing-button-secondary" disabled={!value.trim()} onClick={() => { void navigator.clipboard?.writeText(value).catch(() => setSaveError("复制失败，请手动复制标题")); }}>复制</button>
                  <button type="button" className="publishing-button publishing-button-secondary" disabled={alternateTitles.length <= 1} onClick={() => setAlternateTitles((current) => current.filter((_, i) => i !== index))}>删除</button>
                </div>
              </div>
            ))}
            <button type="button" className="publishing-button publishing-button-secondary" onClick={() => setAlternateTitles((current) => [...current, ""])} disabled={alternateTitles.length >= 5}>＋ 添加备选标题</button>
          </div>
        ) : null}
      </section> : null}
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
              <label className="publishing-title-field">
                <span>稿件标题</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-label="稿件标题"
                  maxLength={100}
                />
              </label>
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
