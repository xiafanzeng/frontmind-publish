import "../publishing.titles.css";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  LoaderCircle,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import {
  MediaMark,
  PublishingConfirmDialog,
  PublishingError,
  PublishingLoading,
  PublishingPage,
  PublishingSteps,
} from "../components/PublishingUi";
import { unicodeLength } from "../queryState";
import PublishingFlowSteps, { flowStagesForMode } from "../components/PublishingFlowSteps";
import { formatPublishingMoney, type PublisherTitleMode } from "../types";
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

export default function PublishingTitlesPage({
  draftId,
  onSaved,
}: {
  draftId: string;
  onSaved?: () => void;
}) {
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const operationScope = usePublishingOperationScope(draftId);
  const [, navigate] = useLocation();
  const load = useCallback(
    (signal: AbortSignal) => gateway.getDraft(draftId, signal),
    [draftId, gateway],
  );
  const query = usePublisherQuery(load);
  const [mode, setMode] = useState<PublisherTitleMode>("single");
  const [sharedTitle, setSharedTitle] = useState("");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  // 取消勾选的媒体不参与标题校验、费用与本次发布；重新勾选恢复原标题。
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmSingle, setConfirmSingle] = useState(false);
  const submitting = useRef(false);
  const [savedSignature, setSavedSignature] = useState("");

  useEffect(() => {
    if (!query.data) return;
    setMode(query.data.titleMode);
    setSharedTitle(query.data.sharedTitle ?? query.data.articleTitle);
    setTitles(
      Object.fromEntries(
        query.data.items.map((item) => [item.media.id, item.title]),
      ),
    );
    setChecked(new Set(query.data.items.map((item) => item.media.id)));
    setSavedSignature(
      JSON.stringify([
        query.data.titleMode,
        query.data.sharedTitle ?? query.data.articleTitle,
        Object.fromEntries(
          query.data.items.map((item) => [item.media.id, item.title]),
        ),
      ]),
    );
  }, [query.data]);

  const validation = useMemo(
    () =>
      new Map(
        query.data?.items.map((item) => {
          const value =
            mode === "single" ? sharedTitle : (titles[item.media.id] ?? "");
          const length = unicodeLength(value);
          const message = !checked.has(item.media.id)
            ? ""
            : !value.trim()
              ? "标题不能为空"
              : length > item.media.titleLimit
                ? `超过该媒体 ${item.media.titleLimit} 字限制`
                : "";
          return [item.media.id, { value, length, message }] as const;
        }) ?? [],
      ),
    [mode, query.data, sharedTitle, titles, checked],
  );
  const toggleMedia = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const checkedItems =
    query.data?.items.filter((item) => checked.has(item.media.id)) ?? [];
  const checkedTotal = checkedItems.reduce(
    (total, item) => total + BigInt(item.media.priceTenThousandths),
    0n,
  );
  const invalidCount = [...validation.values()].filter(
    (item) => item.message,
  ).length;
  const signature = JSON.stringify([mode, sharedTitle, titles]);
  useWorkspaceDraftGuard({
    dirty: Boolean(query.data) && signature !== savedSignature,
    label: "发布标题",
  });
  usePublishingSummary({
    title: "发布准备",
    items: [
      { label: "稿件", value: query.data?.articleTitle ?? "读取中" },
      {
        label: "冻结版本",
        value: query.data ? `v${query.data.articleVersion}` : "—",
      },
      { label: "投放媒体", value: `${query.data?.items.length ?? 0} 家` },
      {
        label: "标题状态",
        value: busy
          ? "保存中"
          : invalidCount
            ? `${invalidCount} 项需要修改`
            : "可继续预检",
      },
    ],
  });

  const requestMode = (next: PublisherTitleMode) => {
    if (next === mode) return;
    if (next === "per_media") {
      setTitles(
        Object.fromEntries(
          query.data?.items.map((item) => [item.media.id, sharedTitle]) ?? [],
        ),
      );
      setMode(next);
      return;
    }
    const distinct = new Set(
      Object.values(titles)
        .map((title) => title.trim())
        .filter(Boolean),
    );
    if (distinct.size > 1) setConfirmSingle(true);
    else {
      setSharedTitle([...distinct][0] ?? query.data?.articleTitle ?? "");
      setMode("single");
    }
  };

  const switchToSingle = () => {
    setSharedTitle(query.data?.articleTitle ?? Object.values(titles)[0] ?? "");
    setMode("single");
    setConfirmSingle(false);
  };

  const applyTitleToAll = (value: string) =>
    setTitles(
      Object.fromEntries(
        query.data?.items.map((item) => [item.media.id, value]) ?? [],
      ),
    );

  const submit = async () => {
    if (!query.data || invalidCount || busy || submitting.current) return;
    if (!checked.size) {
      setError("请至少保留一家媒体，或返回选择媒体调整。");
      return;
    }
    const isCurrent = operationScope();
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      let revision = query.data.revision;
      const draftMediaIds = query.data.items.map((item) => item.media.id);
      const sameSet =
        draftMediaIds.length === checked.size &&
        draftMediaIds.every((id) => checked.has(id));
      if (!sameSet) {
        // 未勾选媒体先从投放草稿移除（真实目录接口），再保存标题。
        const reduced = await gateway.updateDraftMedia(
          draftId,
          [...checked],
          revision,
        );
        revision = reduced.revision;
      }
      const saved = await gateway.saveDraftTitles(draftId, {
        mode,
        ...(mode === "single" ? { sharedTitle: sharedTitle.trim() } : {}),
        titles,
        expectedRevision: revision,
      });
      if (!isCurrent()) return;
      setSavedSignature(signature);
      await flow
        ?.record({
          id: `titles:${draftId}:${saved.revision}`,
          label: "发布标题已保存",
          detail: `${query.data.items.length} 家媒体 · ${mode === "single" ? "统一标题" : "逐家标题"}`,
          resources: [{ kind: "publication_draft", id: draftId }],
          outputRefs: [
            {
              resource: {
                kind: "publication_draft",
                id: draftId,
                label: query.data.articleTitle,
              },
              version: String(saved.revision),
              sourceStepId: `titles:${draftId}:${saved.revision}`,
            },
          ],
        })
        .catch(() => undefined);
      if (isCurrent())
        performApprovedWorkspaceNavigation(() =>
          onSaved
            ? onSaved()
            : navigate(
                publishingTaskUrl(
                  `/publishing/drafts/${draftId}/review`,
                  flow?.taskId,
                ),
              ),
        );
    } catch (reason) {
      if (!isCurrent()) return;
      setError(reason instanceof Error ? reason.message : "标题保存失败");
      setBusy(false);
    } finally {
      submitting.current = false;
    }
  };

  const visibleItems =
    query.data?.items.filter(
      (item) => !onlyErrors || validation.get(item.media.id)?.message,
    ) ?? [];

  return (
    <PublishingPage
      title="配置发布标题"
      description="为每家媒体设置正式发布标题；取消勾选的媒体不参与本次发布。"
      busy={query.loading || busy}
    >
      <div className="am-title-config">
      {!flow && (
        <PublishingFlowSteps
          stages={flowStagesForMode(query.data?.titleMode ?? "per_media")}
          doneCount={2}
          activeIndex={2}
        />
      )}
      {query.loading ? <PublishingLoading label="正在读取发布草稿…" /> : null}
      {query.error ? (
        <PublishingError error={query.error} onRetry={query.reload} />
      ) : null}
      {query.data ? (
        <>
          <section className="publishing-panel publishing-title-mode-panel">
            <header className="publishing-draft-summary">
              <span className="publishing-file-icon">
                <FileText size={21} />
              </span>
              <div>
                <strong>{query.data.articleTitle}</strong>
                <span>冻结版本 v{query.data.articleVersion}</span>
              </div>
              <span>{query.data.items.length} 家媒体</span>
            </header>
            <nav className="publishing-title-mode-tabs" aria-label="标题模式">
              <button
                type="button"
                className={mode === "single" ? "is-active" : ""}
                onClick={() => requestMode("single")}
              >
                <strong>单标题</strong>
                <span>所有媒体使用同一标题</span>
              </button>
              <button
                type="button"
                className={mode === "per_media" ? "is-active" : ""}
                onClick={() => requestMode("per_media")}
              >
                <strong>多标题</strong>
                <span>逐家媒体独立配置</span>
              </button>
            </nav>
          </section>

          <div className="publishing-titles-layout">
            <section className="publishing-panel publishing-titles-panel">
              {mode === "single" ? (
                <div className="publishing-shared-title">
                  <label>
                    <span>实际发布标题 · 所有媒体共用</span>
                    <textarea
                      value={sharedTitle}
                      onChange={(event) => setSharedTitle(event.target.value)}
                      rows={3}
                      aria-invalid={Boolean(invalidCount)}
                    />
                    <small>
                      {unicodeLength(sharedTitle)} 字 · 将为 {checked.size}{" "}
                      家媒体分别冻结
                    </small>
                  </label>
                  <p className="publishing-title-selection" role="status">
                    已选 <strong>{checked.size} 家媒体</strong> · 有效费用{" "}
                    <strong>{formatPublishingMoney(checkedTotal.toString())}</strong>
                    <span className="publishing-title-selection-note">
                      取消勾选的媒体不计入费用、校验与本次发布
                    </span>
                  </p>
                  <div className="am-shared-title-rows" aria-label="逐媒体标题校验">
                    {query.data.items.map(item => {
                      const state = validation.get(item.media.id)!;
                      const included = checked.has(item.media.id);
                      return <div className={"am-shared-title-row" + (included ? "" : " is-excluded")} key={item.media.id}>
                        <label className="publishing-title-check">
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={() => toggleMedia(item.media.id)}
                            aria-label={`${item.media.name} 参与本次发布`}
                          />
                        </label>
                        <div><strong>{item.media.name}</strong><small>上限 ≤ {item.media.titleLimit} 字</small></div>
                        <p>{state.value || "尚未填写"}</p><span className={state.message ? "is-invalid" : "is-valid"}>{!included ? "未纳入本次发布 · 重新勾选后恢复" : state.message || "长度有效"}<small>{included ? `${state.length} / ${item.media.titleLimit}` : ""}</small></span>
                      </div>;
                    })}
                  </div>
                  {invalidCount ? (
                    <div className="publishing-title-impact" role="alert">
                      <strong>{invalidCount} 家媒体标题不符合要求</strong>
                      {query.data.items
                        .filter(
                          (item) => validation.get(item.media.id)?.message,
                        )
                        .map((item) => (
                          <span key={item.media.id}>
                            {item.media.name}：
                            {validation.get(item.media.id)?.message}
                          </span>
                        ))}
                    </div>
                  ) : (
                    <div className="publishing-title-valid">
                      <CheckCircle2 size={18} />
                      全部媒体标题长度有效
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <header className="publishing-title-tools">
                    <div>
                      <strong>逐家媒体标题</strong>
                      <span>标题按 Unicode 字符计数</span>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={onlyErrors}
                        onChange={(event) =>
                          setOnlyErrors(event.target.checked)
                        }
                      />
                      只看错误项 ({invalidCount})
                    </label>
                    <button
                      className="publishing-button publishing-button-secondary"
                      type="button"
                      onClick={() => applyTitleToAll(query.data!.articleTitle)}
                    >
                      <WandSparkles size={15} />
                      用稿件标题填充全部
                    </button>
                  </header>
                  <p className="publishing-title-selection" role="status">
                    已选 <strong>{checked.size} 家媒体</strong> · 有效费用{" "}
                    <strong>{formatPublishingMoney(checkedTotal.toString())}</strong>
                    <span className="publishing-title-selection-note">
                      取消勾选的媒体不计入费用、校验与本次发布
                    </span>
                  </p>
                  <div className="publishing-title-list">
                    {visibleItems.map((item, index) => {
                      const state = validation.get(item.media.id)!;
                      return (
                        <article
                          key={item.media.id}
                          className={`publishing-title-item ${state.message ? "is-invalid" : ""} ${checked.has(item.media.id) ? "" : "is-excluded"}`}
                        >
                          <label className="publishing-title-check">
                            <input
                              type="checkbox"
                              checked={checked.has(item.media.id)}
                              onChange={() => toggleMedia(item.media.id)}
                              aria-label={`${item.media.name} 参与本次发布`}
                            />
                          </label>
                          <span className="publishing-title-number">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="publishing-media-name">
                            <MediaMark
                              name={item.media.shortName}
                              id={item.media.id}
                              logoUrl={item.media.logoUrl}
                              logoSource={item.media.logoSource}
                              logoResolutionStatus={
                                item.media.logoResolutionStatus
                              }
                            />
                            <span>
                              <strong>{item.media.name}</strong>
                              <small>
                                {item.media.kind === "self_media"
                                  ? "自媒体"
                                  : "软文媒体"}{" "}
                                ·{" "}
                                {formatPublishingMoney(
                                  item.media.priceTenThousandths,
                                )}
                              </small>
                            </span>
                          </span>
                          <label>
                            <span>实际发布标题 <em>上限 ≤ {item.media.titleLimit} 字</em></span>
                            <input
                              value={state.value}
                              onChange={(event) =>
                                setTitles((current) => ({
                                  ...current,
                                  [item.media.id]: event.target.value,
                                }))
                              }
                              disabled={!checked.has(item.media.id)}
                              aria-invalid={Boolean(state.message)}
                              aria-label={`${item.media.name} 独立标题`}
                              aria-describedby={`title-state-${item.media.id}`}
                            />
                            <small id={`title-state-${item.media.id}`} className={state.message ? "is-error" : ""}>
                              {!checked.has(item.media.id)
                                ? "未纳入本次发布 · 重新勾选后恢复标题"
                                : state.message ||
                                  `长度有效 · ${state.length} / ${item.media.titleLimit} 字`}
                            </small>
                          </label>
                          <button
                            type="button"
                            onClick={() => applyTitleToAll(state.value)}
                          >
                            应用到全部
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
            <aside className="publishing-panel publishing-title-help">
              <CheckCircle2 size={22} />
              <span className="am-title-kicker">交接前核对</span><h2>标题与投放摘要</h2>
              <p>
                标题限制以媒体目录返回值为准；缺失限制时使用服务端 200 字兜底。
              </p>
              <dl>
                <div>
                  <dt>标题模式</dt>
                  <dd>{mode === "single" ? "单标题" : "多标题"}</dd>
                </div>
                <div>
                  <dt>校验通过</dt>
                  <dd>
                    {query.data.items.length - invalidCount} /{" "}
                    {query.data.items.length}
                  </dd>
                </div>
                <div>
                  <dt>软文 / 自媒体</dt>
                  <dd>
                    {
                      query.data.items.filter(
                        (item) => item.media.kind === "news",
                      ).length
                    }{" "}
                    /{" "}
                    {
                      query.data.items.filter(
                        (item) => item.media.kind === "self_media",
                      ).length
                    }
                  </dd>
                </div>
                <div>
                  <dt>预计总价</dt>
                  <dd>
                    {formatPublishingMoney(
                      query.data.items
                        .reduce(
                          (sum, item) =>
                            sum + BigInt(item.media.priceTenThousandths),
                          0n,
                        )
                        .toString(),
                    )}
                  </dd>
                </div>
              </dl>
            </aside>
          </div>
        </>
      ) : null}
      {error ? (
        <p className="publishing-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {query.data ? (
        <footer className="publishing-workflow-footer">
          <Link
            className="publishing-button publishing-button-secondary"
            href={`/publishing/drafts/${draftId}/media`}
          >
            <ArrowLeft size={16} />
            返回选择媒体
          </Link>
          <button
            className="publishing-button publishing-button-accent"
            type="button"
            onClick={submit}
            disabled={Boolean(invalidCount) || busy}
          >
            {busy ? (
              <LoaderCircle className="publishing-spin" size={17} />
            ) : (
              <ArrowRight size={17} />
            )}
            预检与发布
          </button>
        </footer>
      ) : null}
      </div>
      <PublishingConfirmDialog
        open={confirmSingle}
        title="切换为单标题？"
        description="当前媒体使用了不同标题。切换后将用稿件标题覆盖全部独立标题。"
        confirmLabel="覆盖并切换"
        onCancel={() => setConfirmSingle(false)}
        onConfirm={switchToSingle}
      />
    </PublishingPage>
  );
}
