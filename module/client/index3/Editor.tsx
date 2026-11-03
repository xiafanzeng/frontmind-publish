import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { PublishingError } from "../components/PublishingUi";
import {
  publisherHtmlToPlainText,
  publisherPlainTextToHtml,
  sanitizePublisherEditorHtml,
} from "../editorContent";
import { buildHandwrittenDocxFile } from "../handwrittenArticle";
import { titleModeForFlowMode } from "../components/PublishingFlowSteps";
import {
  performApprovedWorkspaceNavigation,
  requestWorkspaceNavigation,
  useWorkspaceDraftGuard,
} from "../host";
import { publishingDateTime, type ArticleDetail, type ArticleImage, type PublisherEditorContent } from "../types";
import { Btn, Icon, PageHeading, SearchBox, WorkflowPosition, toast } from "./ui";

const TipTapArticleEditor = lazy(() => import("../components/TipTapArticleEditor"));

type EditorMode = "single" | "multi" | "batch";

type Unit = {
  key: string;
  articleId: string | null;
  revision: number;
  version: number;
  title: string;
  content: PublisherEditorContent;
  images: ArticleImage[];
  saved: boolean;
};

const emptyContent = (): PublisherEditorContent => ({ html: "", text: "", json: { type: "doc", content: [] } });
const newUnit = (): Unit => ({
  key: `unit-${Math.random().toString(16).slice(2)}`,
  articleId: null,
  revision: 0,
  version: 0,
  title: "",
  content: emptyContent(),
  images: [],
  saved: true,
});
const unitFromArticle = (article: ArticleDetail): Unit => ({
  key: `article-${article.id}`,
  articleId: article.id,
  revision: article.revision,
  version: article.currentVersion,
  title: article.title,
  content: {
    html: article.bodyHtml ?? publisherPlainTextToHtml(article.bodyText),
    text: article.bodyText,
    json: article.editorJson ?? { type: "doc", content: [] },
  },
  images: article.images,
  saved: true,
});

const modeLabels: Array<[EditorMode, string]> = [
  ["single", "单标题投放"],
  ["multi", "多标题投放"],
  ["batch", "批量投放"],
];

/** index3 编辑稿件: document rail, batch units, segmented mode and the freeze-to-matrix handoff. */
export default function Index3Editor({ articleId }: { articleId: string }) {
  const gateway = usePublisherGateway();
  const [path, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search.replace(/^\?/u, ""));
  const initialMode = (["single", "multi", "batch"] as const).includes(params.get("mode") as EditorMode)
    ? (params.get("mode") as EditorMode)
    : "single";
  const isNew = articleId === "new";

  const loadArticle = useCallback(
    (signal: AbortSignal) => (isNew ? Promise.resolve(null) : gateway.getArticle(articleId, signal)),
    [gateway, articleId, isNew],
  );
  const articleQuery = usePublisherQuery(loadArticle, `index3-editor-${articleId}`);
  const articlesQuery = usePublisherQuery(
    useCallback((signal: AbortSignal) => gateway.listArticles(signal), [gateway]),
    "index3-editor-rail",
  );

  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [units, setUnits] = useState<Unit[]>([]);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; content?: string }>({});
  const [saveState, setSaveState] = useState("尚未修改");
  const [busy, setBusy] = useState(false);
  const [railQuery, setRailQuery] = useState("");
  const [uploadNote, setUploadNote] = useState("");

  useEffect(() => {
    if (!ready && articleQuery.data !== undefined) {
      setUnits([articleQuery.data ? unitFromArticle(articleQuery.data) : newUnit()]);
      setReady(true);
    }
  }, [articleQuery.data, ready]);

  const unit = units[index];
  const dirty = useMemo(
    () => units.some((item) => !item.saved),
    [units],
  );
  useWorkspaceDraftGuard({
    dirty,
    label: "稿件正文与图片，切换后将离开当前稿件",
    save: async () => {
      if (busy) return false;
      try {
        await saveUnits(false);
        return true;
      } catch {
        return false;
      }
    },
    discard: async () => !busy,
  });

  const patchUnit = (patch: Partial<Unit>, which = index) => {
    setUnits((current) => current.map((item, i) => (i === which ? { ...item, ...patch, saved: false } : item)));
    setSaveState("有未保存修改");
  };

  const charCount = unit ? unit.content.text.replace(/\s/g, "").length : 0;

  const validateUnit = (item: Unit) => {
    const next: { title?: string; content?: string } = {};
    if (!item.title.trim()) next.title = "请填写稿件标题。";
    if (!item.content.text.trim()) next.content = "请填写稿件正文。";
    return next;
  };

  const persistUnit = async (item: Unit): Promise<Unit> => {
    const bodyHtml = sanitizePublisherEditorHtml(item.content.html, item.images);
    const bodyText = publisherHtmlToPlainText(bodyHtml);
    if (item.articleId) {
      const saved = await gateway.saveArticle({
        articleId: item.articleId,
        expectedRevision: item.revision,
        title: item.title.trim(),
        bodyText,
        bodyHtml,
        editorJson: item.content.json,
        images: item.images,
      });
      return { ...item, revision: saved.revision, version: saved.currentVersion, saved: true };
    }
    // 方案 A 桥接：手写内容 → 最小 DOCX → 现有导入接口创建 → saveArticle 覆写。
    const file = buildHandwrittenDocxFile(item.title.trim(), item.content.text);
    const imported = await gateway.importDocx(file);
    const created = await gateway.getArticle(imported.articleId);
    const saved = await gateway.saveArticle({
      articleId: imported.articleId,
      expectedRevision: created.revision,
      title: item.title.trim(),
      bodyText,
      bodyHtml,
      editorJson: item.content.json,
      images: item.images,
    });
    return {
      ...item,
      articleId: saved.id,
      revision: saved.revision,
      version: saved.currentVersion,
      saved: true,
    };
  };

  const saveUnits = async (announce = true): Promise<Unit[]> => {
    if (!units.length || busy) return units;
    setBusy(true);
    try {
      const saved: Unit[] = [];
      for (let i = 0; i < units.length; i += 1) {
        const item = units[i]!;
        const problems = validateUnit(item);
        if (problems.title || problems.content) {
          if (i === index) setErrors(problems);
          throw new Error(`第 ${i + 1} 篇稿件还未填写标题或正文。`);
        }
        saved.push(await persistUnit(item));
      }
      setUnits(saved);
      setErrors({});
      setSaveState(`已保存 ${publishingDateTime(new Date().toISOString())}`);
      if (announce) toast(`已保存 ${saved.length} 篇稿件。`);
      return saved;
    } catch (reason) {
      setSaveState(reason instanceof Error ? reason.message : "保存失败");
      throw reason;
    } finally {
      setBusy(false);
    }
  };

  const goMatrix = async () => {
    if (busy) return;
    try {
      const saved = await saveUnits(false);
      const target = saved[index] ?? saved[0]!;
      if (!target.articleId) return;
      const frozen = await gateway.freezeArticle(target.articleId, target.revision);
      const matrixParams = new URLSearchParams();
      matrixParams.set("articleVersion", frozen.currentVersionId ?? "");
      matrixParams.set("mode", mode);
      matrixParams.set("titleMode", titleModeForFlowMode(mode));
      // The real flow enters media selection with the frozen version; its hub
      // routes on to the source matrix and the catalogue.
      performApprovedWorkspaceNavigation(() => {
        navigate(`/publishing/media?${matrixParams.toString()}`);
        window.scrollTo({ top: 0 });
      });
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "无法完成保存，请重试。");
    }
  };

  const importDocument = async (file: File) => {
    if (!/\.(docx?|txt|md)$/i.test(file.name)) {
      setUploadNote("文件类型不支持，请选择 .docx、.doc、.txt 或 .md。");
      return;
    }
    setBusy(true);
    try {
      const imported = await gateway.importDocx(file);
      const created = await gateway.getArticle(imported.articleId);
      setUnits([unitFromArticle(created)]);
      setIndex(0);
      setSaveState("已导入，尚未保存修改");
      setUploadNote(`已从「${file.name}」导入稿件。`);
      if (isNew) {
        const next = new URLSearchParams(search);
        navigate(`/publishing/articles/${encodeURIComponent(imported.articleId)}/edit${next.size ? `?${next}` : ""}`, { replace: true });
      }
    } catch (reason) {
      setUploadNote(reason instanceof Error ? reason.message : "导入失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  const railArticles = (articlesQuery.data ?? []).filter((article) =>
    !railQuery.trim() || article.title.toLocaleLowerCase().includes(railQuery.trim().toLocaleLowerCase()),
  );

  if (!ready) {
    return (
      <>
        <PageHeading title={isNew ? "编辑新稿件" : "编辑稿件"} />
        <div className="empty">
          <h3>{articleQuery.loading ? "正在读取稿件…" : "正在准备编辑器…"}</h3>
          {articleQuery.error ? <PublishingError error={articleQuery.error} onRetry={articleQuery.reload} /> : null}
        </div>
      </>
    );
  }
  if (!unit) return null;

  return (
    <>
      <PageHeading title={unit.articleId ? "编辑稿件" : "编辑新稿件"}>
        <Link className="btn" href="/publishing/articles">返回稿件列表</Link>
      </PageHeading>
      <WorkflowPosition step={0} />

      <div className="editor-workspace">
        <aside className="document-rail" aria-label="文档列表">
          <div className="rail-heading">
            <h2>文档</h2>
            <Link className="btn subtle small" href="/publishing/articles/new" aria-label="新建文档"><Icon name="plus" /></Link>
          </div>
          <SearchBox value={railQuery} onChange={setRailQuery} placeholder="搜索文档" />
          <div className="document-list">
            {railArticles.length ? (
              railArticles.map((article) => (
                <Link
                  key={article.id}
                  href={`/publishing/articles/${encodeURIComponent(article.id)}/edit`}
                  className={`document-item ${article.id === unit.articleId ? "active" : ""}`}
                  onClick={(event) => {
                    if (article.id === unit.articleId) return;
                    event.preventDefault();
                    requestWorkspaceNavigation(() =>
                      navigate(`/publishing/articles/${encodeURIComponent(article.id)}/edit`));
                  }}
                >
                  <strong>{article.title}</strong>
                  <small>v{article.currentVersion} · {publishingDateTime(article.updatedAt)}</small>
                </Link>
              ))
            ) : (
              <div className="batch-empty">没有匹配文档，请调整关键词。</div>
            )}
          </div>
          <div className="rail-foot">文档按最近修改排序。</div>
        </aside>

        <div style={{ minWidth: 0 }}>
          <div className="space-between" style={{ marginBottom: 16 }}>
            <div className="segmented" role="group" aria-label="投放方式">
              {modeLabels.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={mode === value ? "active" : ""}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "batch" ? (
            <>
              <div className="batch-units" aria-label="批量稿件单元">
                {units.map((item, i) => (
                  <section className={`batch-unit ${index === i ? "active" : ""}`} key={item.key}>
                    <div className="space-between">
                      <div>
                        <h3>{i + 1}. {item.title || "未命名稿件"}</h3>
                        <div className="unit-meta">
                          v{item.version || 1} · {item.content.text.replace(/\s/g, "").length} 字{index === i ? " · 正在下方编辑" : ""}
                        </div>
                      </div>
                      <div className="actions">
                        <button type="button" className="btn small" onClick={() => setIndex(i)}>编辑此单元</button>
                        {units.length > 1 ? (
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => {
                              setUnits((current) => current.filter((_, which) => which !== i));
                              setIndex((current) => Math.max(0, Math.min(current, units.length - 2)));
                            }}
                          >
                            移除
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <p>{item.title || "尚未填写标题"}</p>
                  </section>
                ))}
              </div>
              <div className="batch-add-row">
                <button type="button" className="btn" onClick={() => { setUnits((current) => [...current, newUnit()]); setIndex(units.length); }}>
                  <Icon name="plus" />新建空白单元
                </button>
              </div>
            </>
          ) : null}

          <div className="editor-layout">
            <section className="panel">
              <div className="panel-body">
                <form className="editor-form" noValidate onSubmit={(event) => { event.preventDefault(); void saveUnits(); }}>
                  {!unit.articleId ? (
                    <div className="upload-line">
                      <div>
                        <strong>从文档开始</strong>
                        <p>.docx / .doc / .txt / .md</p>
                      </div>
                      <label className="btn small">
                        <Icon name="upload" />选择文档
                        <input
                          type="file"
                          accept=".doc,.docx,.txt,.md"
                          hidden
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void importDocument(file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  ) : null}
                  {uploadNote ? <p className="small muted">{uploadNote}</p> : null}
                  <div className="field">
                    <label htmlFor="article-title">稿件标题 <span className="danger-text" aria-hidden="true">*</span></label>
                    <input
                      id="article-title"
                      className="control"
                      value={unit.title}
                      aria-label="稿件标题"
                      aria-invalid={errors.title ? "true" : undefined}
                      aria-describedby="article-title-error"
                      onChange={(event) => patchUnit({ title: event.target.value })}
                    />
                    <span className="field-error" id="article-title-error" role="alert">{errors.title ?? ""}</span>
                  </div>
                  <div className="field">
                    <label htmlFor="article-content">稿件正文 <span className="danger-text">*</span></label>
                    <Suspense fallback={<div className="rich-body" role="status">正在载入编辑器…</div>}>
                      <TipTapArticleEditor
                        value={unit.content}
                        images={unit.images}
                        onChange={(content) => patchUnit({ content })}
                        onUploadImage={async (file) => {
                          if (!unit.articleId) {
                            toast("请先保存稿件，再插入配图。");
                            throw new Error("请先保存稿件，再插入配图。");
                          }
                          return gateway.uploadArticleImage(unit.articleId, file, file.name);
                        }}
                      />
                    </Suspense>
                    <span className="field-error" id="article-content-error" role="alert">{errors.content ?? ""}</span>
                  </div>
                  <p className="field-hint">
                    {mode === "single"
                      ? "单标题投放：所有媒体沿用此处的稿件标题。"
                      : mode === "multi"
                        ? "多标题投放：选择媒体后，可分别调整各家媒体的发布标题。"
                        : "批量投放：所有单元一起保存；冻结后进入信源矩阵。"}
                  </p>
                </form>
              </div>
            </section>
            <aside className="panel">
              <div className="panel-header">
                <h2>稿件信息</h2>
              </div>
              <div className="panel-body editor-summary">
                <div className="definition"><span>版本</span><strong className="numeric">v{unit.version || 1}</strong></div>
                <div className="definition"><span>正文字符</span><strong className="numeric">{charCount}</strong></div>
                <div className="definition"><span>保存状态</span><span>{saveState}</span></div>
              </div>
            </aside>
          </div>

          <div className="bottom-actions">
            <span className="small muted">{mode === "batch" ? `共 ${units.length} 篇稿件` : "修改仅影响当前稿件"}</span>
            <div className="actions">
              <Btn onClick={() => void saveUnits()} disabled={busy}>{busy ? "保存中…" : "保存稿件"}</Btn>
              <Btn variant="primary" onClick={() => void goMatrix()} disabled={busy}>
                {busy ? "处理中…" : "保存并进入信源矩阵"}<Icon name="arrow" />
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
